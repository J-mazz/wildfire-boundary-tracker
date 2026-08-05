module;

#include <ncnn/gpu.h>
#include <ncnn/net.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <iostream>
#include <limits>
#include <memory_resource>
#include <mutex>
#include <new>
#include <span>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

module wildfire.inference.runtime;

import wildfire.inference.options;
import wildfire.inference.scheduler;
import wildfire.memory;
import wildfire.tensor;

namespace wildfire::inference {

namespace {

class VulkanInstance {
public:
    [[nodiscard]] bool initialize() noexcept {
        initialized_ = ncnn::create_gpu_instance() == 0;
        return initialized_;
    }

    ~VulkanInstance() {
        if (initialized_) ncnn::destroy_gpu_instance();
    }

private:
    bool initialized_{};
};

class NetworkResources {
public:
    NetworkResources() {
        blob_allocator_.set_size_compare_ratio(0.0f);
        workspace_allocator_.set_size_compare_ratio(0.0f);
        network_.opt.blob_allocator = &blob_allocator_;
        network_.opt.workspace_allocator = &workspace_allocator_;
        network_.opt.use_vulkan_compute = true;
        network_.opt.use_fp16_packed = true;
        network_.opt.use_fp16_storage = true;
        network_.opt.use_fp16_arithmetic = true;
        network_.opt.num_threads = 1;
    }

    ~NetworkResources() {
        network_.clear();
        blob_allocator_.clear();
        workspace_allocator_.clear();
    }

    [[nodiscard]] bool load(const Options& options) {
        network_.set_vulkan_device(options.device_index);
        return network_.load_param(options.parameter_path.c_str()) == 0
            && network_.load_model(options.model_path.c_str()) == 0;
    }

    [[nodiscard]] ncnn::Extractor create_extractor(const unsigned threads) {
        std::lock_guard lock(extractor_mutex_);
        network_.opt.num_threads = static_cast<int>(threads);
        ncnn::Extractor extractor = network_.create_extractor();
        network_.opt.num_threads = 1;
        return extractor;
    }

    [[nodiscard]] ncnn::Allocator* blob_allocator() noexcept {
        return &blob_allocator_;
    }

private:
    ncnn::PoolAllocator blob_allocator_;
    ncnn::PoolAllocator workspace_allocator_;
    ncnn::Net network_;
    std::mutex extractor_mutex_;
};

struct JobOutcome {
    int status{};
    std::string error;
};

bool ncnn_dimensions_supported(const wildfire::tensor::InputLayout& layout) noexcept {
    constexpr auto maximum = static_cast<std::uint32_t>(std::numeric_limits<int>::max());
    return layout.width <= maximum && layout.height <= maximum && layout.channels <= maximum;
}

wildfire::tensor::OutputLayout output_layout(const ncnn::Mat& output) noexcept {
    return {
        static_cast<std::uint32_t>(output.dims),
        static_cast<std::uint32_t>(output.w),
        static_cast<std::uint32_t>(output.h),
        static_cast<std::uint32_t>(output.d),
        static_cast<std::uint32_t>(output.c),
        output.total() > std::numeric_limits<std::uint32_t>::max()
            ? 0u
            : static_cast<std::uint32_t>(output.total())
    };
}

bool load_input(
    const std::filesystem::path& input_path,
    NetworkResources& resources,
    ncnn::Mat& input,
    std::string& error
) {
    wildfire::tensor::InputLayout layout;
    if (!wildfire::tensor::inspect_nct1(input_path, layout, error)) return false;
    if (!ncnn_dimensions_supported(layout)) {
        error = "invalid NCT1 dimensions";
        return false;
    }
    input = ncnn::Mat(
        static_cast<int>(layout.width),
        static_cast<int>(layout.height),
        static_cast<int>(layout.channels),
        sizeof(float),
        resources.blob_allocator()
    );
    if (input.empty()) {
        error = "ncnn tensor allocation failed";
        return false;
    }
    const std::span input_values(static_cast<float*>(input.data), input.total());
    return wildfire::tensor::read_nct1_data(
        input_path,
        layout,
        input_values,
        input.cstep,
        error
    );
}

int infer(
    const Options& options,
    const unsigned extractor_threads,
    NetworkResources& resources,
    const ncnn::Mat& input,
    ncnn::Mat& output
) {
    ncnn::Extractor extractor = resources.create_extractor(extractor_threads);
    const int input_status = extractor.input(options.input_name.c_str(), input);
    return input_status == 0
        ? extractor.extract(options.output_name.c_str(), output)
        : input_status;
}

bool write_output(
    const Options& options,
    const std::filesystem::path& input_path,
    const ncnn::Mat& output,
    std::string& error
) {
    if (output.empty() || output.elemsize != sizeof(float) || output.elempack != 1) {
        error = "output is not unpacked float32";
        return false;
    }
    const auto layout_out = output_layout(output);
    const std::span output_values(static_cast<const float*>(output.data), output.total());
    return wildfire::tensor::write_nco1(
        output_path(options, input_path),
        layout_out,
        output_values,
        error
    );
}

JobOutcome execute_job(
    const Options& options,
    const std::filesystem::path& input_path,
    const unsigned extractor_threads,
    NetworkResources& resources
) {
    JobOutcome outcome;
    ncnn::Mat input;
    if (!load_input(input_path, resources, input, outcome.error)) {
        outcome.status = -1;
        return outcome;
    }
    ncnn::Mat output;
    outcome.status = infer(options, extractor_threads, resources, input, output);
    if (outcome.status != 0) {
        outcome.error = "ncnn inference failed with code " + std::to_string(outcome.status);
        return outcome;
    }
    if (!write_output(options, input_path, output, outcome.error)) outcome.status = -1;
    return outcome;
}

bool populate_queue(BoundedJobQueue& queue, const std::size_t count) {
    for (std::size_t index = 0u; index < count; ++index) {
        if (!queue.try_push(index)) return false;
    }
    return true;
}

std::size_t report_failures(
    const Options& options,
    const std::span<const JobReport> reports
) {
    std::size_t failures{};
    for (std::size_t index = 0u; index < reports.size(); ++index) {
        if (reports[index].status == 0) continue;
        ++failures;
        std::cerr << options.inputs[index] << ": " << reports[index].error << '\n';
    }
    return failures;
}

int run_batch(const Options& options, NetworkResources& resources) {
    std::filesystem::create_directories(options.output_directory);
    const CpuPartition partition = partition_cpu_budget(
        options.workers,
        options.inputs.size(),
        std::thread::hardware_concurrency()
    );

    std::size_t storage_bytes{};
    if (!scheduler_storage_bytes(options.inputs.size(), storage_bytes)) {
        std::cerr << "Failed to allocate bounded inference scheduler.\n";
        return inference_exit_code;
    }
    std::vector<std::byte> storage(storage_bytes);
    wildfire::memory::AllocationTelemetry telemetry;
    wildfire::memory::BoundedArena arena(storage, &telemetry);
    wildfire::memory::ArenaResource resource(arena);
    BoundedJobQueue queue(options.inputs.size(), resource);
    OrderedReports reports(options.inputs.size(), resource);
    if (!populate_queue(queue, options.inputs.size())) {
        std::cerr << "Failed to populate bounded inference scheduler.\n";
        return inference_exit_code;
    }

    std::pmr::vector<std::jthread> workers(&resource);
    workers.reserve(partition.worker_count());
    for (unsigned worker = 0u; worker < partition.worker_count(); ++worker) {
        workers.emplace_back([&, worker]() {
            std::size_t index{};
            while (queue.try_pop(index)) {
                try {
                    const JobOutcome outcome = execute_job(
                        options,
                        options.inputs[index],
                        partition.extractor_threads[worker],
                        resources
                    );
                    static_cast<void>(reports.record(index, outcome.status, outcome.error));
                } catch (const std::exception& exception) {
                    static_cast<void>(reports.record(index, -1, exception.what()));
                }
            }
        });
    }
    workers.clear();

    const std::size_t failures = report_failures(options, reports.values());
    std::cout << "ncnn Vulkan batch: " << options.inputs.size() - failures << " succeeded, "
              << failures << " failed, " << partition.worker_count()
              << " concurrent extractor(s).\n";
    return batch_exit_code(failures);
}

} // namespace

int run_native(const Options& options) {
    VulkanInstance vulkan;
    if (!vulkan.initialize()) {
        std::cerr << "Failed to initialize Vulkan.\n";
        return vulkan_exit_code;
    }

    const int gpu_count = ncnn::get_gpu_count();
    if (options.list_devices) {
        for (int index = 0; index < gpu_count; ++index) {
            std::cout << index << '\t' << ncnn::get_gpu_info(index).device_name() << '\n';
        }
        return gpu_count > 0 ? success_exit_code : device_exit_code;
    }
    if (options.device_index < 0 || options.device_index >= gpu_count) {
        std::cerr << "Vulkan device index " << options.device_index
                  << " is unavailable; detected " << gpu_count << " device(s).\n";
        return device_exit_code;
    }

    try {
        NetworkResources resources;
        if (!resources.load(options)) {
            std::cerr << "Failed to load ncnn parameter/model files.\n";
            return model_exit_code;
        }
        return run_batch(options, resources);
    } catch (const std::bad_alloc&) {
        std::cerr << "Failed to allocate bounded inference scheduler.\n";
    } catch (const std::filesystem::filesystem_error& error) {
        std::cerr << error.what() << '\n';
    }
    return inference_exit_code;
}

} // namespace wildfire::inference
