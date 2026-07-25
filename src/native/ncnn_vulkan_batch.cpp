#include <ncnn/net.h>
#include <ncnn/gpu.h>

#include <atomic>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace {

constexpr std::uint32_t kInputMagic = 0x3154434eu;  // "NCT1", little-endian
constexpr std::uint32_t kOutputMagic = 0x314f434eu; // "NCO1", little-endian

struct InputHeader {
    std::uint32_t magic;
    std::uint32_t width;
    std::uint32_t height;
    std::uint32_t channels;
    std::uint32_t elements;
};

struct OutputHeader {
    std::uint32_t magic;
    std::uint32_t dimensions;
    std::uint32_t width;
    std::uint32_t height;
    std::uint32_t depth;
    std::uint32_t channels;
    std::uint32_t elements;
};

struct Options {
    fs::path parameter_path;
    fs::path model_path;
    fs::path output_directory;
    std::string input_name;
    std::string output_name;
    int device_index = 0;
    unsigned workers = 2u;
    bool list_devices = false;
    std::vector<fs::path> inputs;
};

void usage() {
    std::cerr
        << "Usage: ncnn-vulkan-batch --param MODEL.param --model MODEL.bin "
        << "--input-name NAME --output-name NAME --output-dir DIR "
        << "[--device INDEX] [--workers N] INPUT.nct...\n"
        << "       ncnn-vulkan-batch --list-devices\n"
        << "Input NCT1: five little-endian uint32 values (magic,width,height,channels,elements), "
        << "then channel-major float32 data.\n";
}

bool parse_integer(const char* text, int& value) {
    char* end = nullptr;
    const long parsed = std::strtol(text, &end, 10);
    if (end == text || *end != '\0') return false;
    value = static_cast<int>(parsed);
    return true;
}

bool parse_options(const int argc, char** argv, Options& options) {
    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        auto next = [&]() -> const char* {
            if (++index >= argc) return nullptr;
            return argv[index];
        };
        if (argument == "--param") {
            const char* value = next(); if (!value) return false; options.parameter_path = value;
        } else if (argument == "--model") {
            const char* value = next(); if (!value) return false; options.model_path = value;
        } else if (argument == "--input-name") {
            const char* value = next(); if (!value) return false; options.input_name = value;
        } else if (argument == "--output-name") {
            const char* value = next(); if (!value) return false; options.output_name = value;
        } else if (argument == "--output-dir") {
            const char* value = next(); if (!value) return false; options.output_directory = value;
        } else if (argument == "--device") {
            const char* value = next(); if (!value || !parse_integer(value, options.device_index)) return false;
        } else if (argument == "--workers") {
            int value{};
            const char* text = next();
            if (!text || !parse_integer(text, value) || value < 1 || value > 32) return false;
            options.workers = static_cast<unsigned>(value);
        } else if (argument == "--list-devices") {
            options.list_devices = true;
        } else if (argument == "--help") {
            usage();
            std::exit(0);
        } else if (!argument.empty() && argument.front() == '-') {
            return false;
        } else {
            options.inputs.emplace_back(argument);
        }
    }
    return options.list_devices || (!options.parameter_path.empty() && !options.model_path.empty()
        && !options.output_directory.empty() && !options.input_name.empty()
        && !options.output_name.empty() && !options.inputs.empty());
}

bool read_tensor(const fs::path& path, ncnn::Mat& tensor, std::string& error) {
    std::ifstream input(path, std::ios::binary);
    InputHeader header{};
    if (!input.read(reinterpret_cast<char*>(&header), sizeof(header))) {
        error = "cannot read NCT1 header";
        return false;
    }
    const std::uint64_t expected = static_cast<std::uint64_t>(header.width)
        * header.height * header.channels;
    if (header.magic != kInputMagic || expected == 0u || expected != header.elements) {
        error = "invalid NCT1 dimensions";
        return false;
    }

    tensor = ncnn::Mat(
        static_cast<int>(header.width),
        static_cast<int>(header.height),
        static_cast<int>(header.channels),
        sizeof(float)
    );
    if (tensor.empty()) {
        error = "ncnn tensor allocation failed";
        return false;
    }
    const auto bytes = static_cast<std::streamsize>(expected * sizeof(float));
    if (!input.read(static_cast<char*>(tensor.data), bytes)) {
        error = "truncated NCT1 tensor";
        return false;
    }
    return true;
}

bool write_tensor(const fs::path& path, const ncnn::Mat& tensor, std::string& error) {
    if (tensor.empty() || tensor.elemsize != sizeof(float) || tensor.elempack != 1) {
        error = "output is not unpacked float32";
        return false;
    }
    OutputHeader header{
        kOutputMagic,
        static_cast<std::uint32_t>(tensor.dims),
        static_cast<std::uint32_t>(tensor.w),
        static_cast<std::uint32_t>(tensor.h),
        static_cast<std::uint32_t>(tensor.d),
        static_cast<std::uint32_t>(tensor.c),
        static_cast<std::uint32_t>(tensor.total())
    };
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output.write(reinterpret_cast<const char*>(&header), sizeof(header))
        || !output.write(static_cast<const char*>(tensor.data), static_cast<std::streamsize>(tensor.total() * sizeof(float)))) {
        error = "cannot write NCO1 tensor";
        return false;
    }
    return true;
}

fs::path output_path(const Options& options, const fs::path& input) {
    return options.output_directory / (input.filename().string() + ".nco");
}

} // namespace

int main(const int argc, char** argv) {
    Options options;
    if (!parse_options(argc, argv, options)) {
        usage();
        return 2;
    }

    if (ncnn::create_gpu_instance() != 0) {
        std::cerr << "Failed to initialize Vulkan.\n";
        return 3;
    }
    struct VulkanGuard {
        ~VulkanGuard() { ncnn::destroy_gpu_instance(); }
    } vulkan_guard;

    const int gpu_count = ncnn::get_gpu_count();
    if (options.list_devices) {
        for (int index = 0; index < gpu_count; ++index) {
            std::cout << index << '\t' << ncnn::get_gpu_info(index).device_name() << '\n';
        }
        return gpu_count > 0 ? 0 : 4;
    }
    if (options.device_index < 0 || options.device_index >= gpu_count) {
        std::cerr << "Vulkan device index " << options.device_index
                  << " is unavailable; detected " << gpu_count << " device(s).\n";
        return 4;
    }

    ncnn::Net network;
    network.opt.use_vulkan_compute = true;
    network.opt.use_fp16_packed = true;
    network.opt.use_fp16_storage = true;
    network.opt.use_fp16_arithmetic = true;
    network.opt.num_threads = std::max(1u, std::thread::hardware_concurrency());
    network.set_vulkan_device(options.device_index);
    if (network.load_param(options.parameter_path.c_str()) != 0
        || network.load_model(options.model_path.c_str()) != 0) {
        std::cerr << "Failed to load ncnn parameter/model files.\n";
        return 5;
    }

    fs::create_directories(options.output_directory);
    std::atomic_size_t next{0u};
    std::atomic_uint failures{0u};
    std::mutex log_mutex;
    const unsigned worker_count = std::min<unsigned>(options.workers, options.inputs.size());
    std::vector<std::jthread> workers;
    workers.reserve(worker_count);
    for (unsigned worker = 0u; worker < worker_count; ++worker) {
        workers.emplace_back([&]() {
            for (;;) {
                const std::size_t index = next.fetch_add(1u);
                if (index >= options.inputs.size()) return;
                const fs::path& input_path = options.inputs[index];
                std::string error;
                ncnn::Mat input;
                ncnn::Mat output;
                int status = 0;
                if (!read_tensor(input_path, input, error)) {
                    status = -1;
                } else {
                    ncnn::Extractor extractor = network.create_extractor();
                    status = extractor.input(options.input_name.c_str(), input);
                    if (status == 0) status = extractor.extract(options.output_name.c_str(), output);
                    if (status != 0) error = "ncnn inference failed with code " + std::to_string(status);
                    else if (!write_tensor(output_path(options, input_path), output, error)) status = -1;
                }
                if (status != 0) {
                    failures.fetch_add(1u);
                    std::lock_guard lock(log_mutex);
                    std::cerr << input_path << ": " << error << '\n';
                }
            }
        });
    }
    workers.clear(); // jthread destructors join all parallel inference jobs

    const unsigned failed = failures.load();
    std::cout << "ncnn Vulkan batch: " << options.inputs.size() - failed << " succeeded, "
              << failed << " failed, " << worker_count << " concurrent extractor(s).\n";
    return failed == 0u ? 0 : 6;
}
