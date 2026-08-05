#include <array>
#include <cassert>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <memory_resource>
#include <span>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

import wildfire.inference.options;
import wildfire.inference.scheduler;
import wildfire.memory;
import wildfire.tensor;

namespace {

namespace fs = std::filesystem;

class TemporaryDirectory {
public:
    TemporaryDirectory() {
        const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
        path_ = fs::temp_directory_path() / ("wildfire-native-tests-" + std::to_string(stamp));
        fs::create_directories(path_);
    }

    ~TemporaryDirectory() {
        std::error_code error;
        fs::remove_all(path_, error);
    }

    [[nodiscard]] const fs::path& path() const noexcept {
        return path_;
    }

private:
    fs::path path_;
};

void append_u32(std::vector<std::byte>& bytes, const std::uint32_t value) {
    bytes.push_back(static_cast<std::byte>(value & 0xffu));
    bytes.push_back(static_cast<std::byte>((value >> 8u) & 0xffu));
    bytes.push_back(static_cast<std::byte>((value >> 16u) & 0xffu));
    bytes.push_back(static_cast<std::byte>((value >> 24u) & 0xffu));
}

void write_bytes(const fs::path& path, const std::span<const std::byte> bytes) {
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    output.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
    assert(output.good());
}

std::vector<std::byte> nct1_bytes(
    const std::uint32_t magic,
    const std::uint32_t width,
    const std::uint32_t height,
    const std::uint32_t channels,
    const std::uint32_t elements,
    const std::span<const float> values
) {
    std::vector<std::byte> bytes;
    append_u32(bytes, magic);
    append_u32(bytes, width);
    append_u32(bytes, height);
    append_u32(bytes, channels);
    append_u32(bytes, elements);
    const auto payload = std::as_bytes(values);
    bytes.insert(bytes.end(), payload.begin(), payload.end());
    return bytes;
}

void test_tensor_io_and_validation(const fs::path& directory) {
    const std::array values{1.0f, 2.0f, 3.0f, 4.0f};
    const fs::path input_path = directory / "valid.nct";
    write_bytes(input_path, nct1_bytes(
        wildfire::tensor::nct1_magic,
        2u,
        1u,
        2u,
        4u,
        values
    ));

    wildfire::tensor::InputLayout layout;
    std::string error;
    assert(wildfire::tensor::inspect_nct1(input_path, layout, error));
    assert(layout.width == 2u && layout.height == 1u);
    assert(layout.channels == 2u && layout.elements == values.size());
    std::array<float, 4> decoded{};
    assert(wildfire::tensor::read_nct1_data(input_path, layout, decoded, 2u, error));
    assert(decoded == values);

    const fs::path output_path = directory / "valid.nco";
    const wildfire::tensor::OutputLayout output_layout{3u, 2u, 1u, 1u, 2u, 4u};
    assert(wildfire::tensor::write_nco1(output_path, output_layout, values, error));
    std::ifstream output(output_path, std::ios::binary | std::ios::ate);
    assert(output.tellg() == static_cast<std::streamoff>(28u + sizeof(values)));
    output.seekg(0);
    std::array<std::byte, 4> magic{};
    output.read(reinterpret_cast<char*>(magic.data()), magic.size());
    assert((magic == std::array{
        std::byte{0x4e}, std::byte{0x43}, std::byte{0x4f}, std::byte{0x31}
    }));
}

void test_tensor_rejections(const fs::path& directory) {
    std::string error;
    wildfire::tensor::InputLayout layout;
    const std::array one_value{1.0f};

    const fs::path invalid_magic = directory / "magic.nct";
    write_bytes(invalid_magic, nct1_bytes(0u, 1u, 1u, 1u, 1u, one_value));
    assert(!wildfire::tensor::inspect_nct1(invalid_magic, layout, error));
    assert(error == "invalid NCT1 dimensions");

    const fs::path overflow = directory / "overflow.nct";
    write_bytes(overflow, nct1_bytes(
        wildfire::tensor::nct1_magic,
        std::numeric_limits<std::uint32_t>::max(),
        std::numeric_limits<std::uint32_t>::max(),
        2u,
        1u,
        one_value
    ));
    assert(!wildfire::tensor::inspect_nct1(overflow, layout, error));

    const fs::path truncated = directory / "truncated.nct";
    write_bytes(truncated, nct1_bytes(
        wildfire::tensor::nct1_magic,
        2u,
        1u,
        1u,
        2u,
        one_value
    ));
    assert(wildfire::tensor::inspect_nct1(truncated, layout, error));
    std::array<float, 2> destination{};
    assert(!wildfire::tensor::read_nct1_data(
        truncated,
        layout,
        destination,
        2u,
        error
    ));
    assert(error == "truncated NCT1 tensor");

    const wildfire::tensor::OutputLayout invalid_output{4u, 2u, 2u, 2u, 2u, 15u};
    assert(!wildfire::tensor::valid_output_layout(invalid_output));
    const wildfire::tensor::OutputLayout padded_output{3u, 3u, 1u, 1u, 2u, 8u};
    assert(wildfire::tensor::valid_output_layout(padded_output));

    const std::array packed{1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f};
    const fs::path strided = directory / "strided.nct";
    write_bytes(strided, nct1_bytes(
        wildfire::tensor::nct1_magic,
        3u,
        1u,
        2u,
        6u,
        packed
    ));
    assert(wildfire::tensor::inspect_nct1(strided, layout, error));
    std::array<float, 8> padded;
    padded.fill(-1.0f);
    assert(wildfire::tensor::read_nct1_data(strided, layout, padded, 4u, error));
    assert((padded == std::array{1.0f, 2.0f, 3.0f, -1.0f, 4.0f, 5.0f, 6.0f, -1.0f}));
}

wildfire::inference::ParsedOptions parse(
    const std::initializer_list<std::string_view> arguments
) {
    return wildfire::inference::parse_options(
        std::span<const std::string_view>{arguments.begin(), arguments.size()}
    );
}

void test_options() {
    const auto valid = parse({
        "--param", "model.param",
        "--model", "model.bin",
        "--input-name", "input",
        "--output-name", "output",
        "--output-dir", "results",
        "--device", "-1",
        "--workers", "32",
        "a.nct", "b.nct"
    });
    assert(valid.action == wildfire::inference::ParseAction::run);
    assert(valid.options.device_index == -1 && valid.options.workers == 32u);
    assert(valid.options.inputs.size() == 2u);
    assert(wildfire::inference::output_path(valid.options, "x/a.nct")
        == fs::path{"results/a.nct.nco"});

    assert(parse({"--list-devices"}).action == wildfire::inference::ParseAction::run);
    assert(parse({"--help", "--unknown"}).action == wildfire::inference::ParseAction::help);
    assert(parse({"--workers", "0"}).action == wildfire::inference::ParseAction::invalid);
    assert(parse({"--workers", "33"}).action == wildfire::inference::ParseAction::invalid);
    assert(parse({"--workers", "+2"}).action == wildfire::inference::ParseAction::invalid);
    assert(parse({"--device", "999999999999"}).action
        == wildfire::inference::ParseAction::invalid);
    assert(parse({"--unknown"}).action == wildfire::inference::ParseAction::invalid);
    assert(wildfire::inference::parse_exit_code(wildfire::inference::ParseAction::invalid)
        == wildfire::inference::usage_exit_code);
    assert(wildfire::inference::parse_exit_code(wildfire::inference::ParseAction::help)
        == wildfire::inference::success_exit_code);
}

void test_cpu_partitioning() {
    const auto balanced = wildfire::inference::partition_cpu_budget(3u, 20u, 8u);
    assert(balanced.total_threads == 8u);
    assert(balanced.worker_count() == 3u);
    assert(balanced.extractor_threads[0] == 3u);
    assert(balanced.extractor_threads[1] == 3u);
    assert(balanced.extractor_threads[2] == 2u);

    const auto capped = wildfire::inference::partition_cpu_budget(32u, 50u, 8u);
    assert(capped.worker_count() == 8u);
    unsigned assigned{};
    for (unsigned index = 0u; index < capped.worker_count(); ++index) {
        const unsigned threads = capped.extractor_threads[index];
        assert(threads >= 1u);
        assigned += threads;
    }
    assert(assigned == capped.total_threads);

    const auto unknown = wildfire::inference::partition_cpu_budget(2u, 2u, 0u);
    assert(unknown.total_threads == 1u && unknown.worker_count() == 1u);
    const auto empty = wildfire::inference::partition_cpu_budget(2u, 0u, 8u);
    assert(empty.worker_count() == 0u);
}

void test_bounded_queue_and_ordered_reports() {
    alignas(64) std::array<std::byte, 32768> storage{};
    wildfire::memory::AllocationTelemetry telemetry;
    wildfire::memory::BoundedArena arena(storage, &telemetry);
    wildfire::memory::ArenaResource resource(arena);
    wildfire::inference::BoundedJobQueue queue(16u, resource);
    wildfire::inference::OrderedReports reports(16u, resource);

    for (std::size_t index = 0u; index < 16u; ++index) {
        assert(queue.try_push(index));
    }
    assert(!queue.try_push(16u));
    std::vector<std::jthread> workers;
    for (unsigned worker = 0u; worker < 4u; ++worker) {
        workers.emplace_back([&]() {
            std::size_t index{};
            while (queue.try_pop(index)) {
                assert(reports.record(index, index % 3u == 0u ? -1 : 0, std::to_string(index)));
            }
        });
    }
    workers.clear();

    const auto ordered = reports.values();
    for (std::size_t index = 0u; index < ordered.size(); ++index) {
        assert(std::string_view{ordered[index].error} == std::to_string(index));
    }
    assert(queue.size() == 0u);
    assert(telemetry.allocation_count() >= 2u);
    assert(telemetry.failed_allocation_count() == 0u);
}

void test_scheduler_overflow_and_exit_mapping() {
    std::size_t bytes{};
    assert(wildfire::inference::scheduler_storage_bytes(10u, bytes));
    assert(bytes >= 10u * 512u);
    assert(!wildfire::inference::scheduler_storage_bytes(
        std::numeric_limits<std::size_t>::max(),
        bytes
    ));
    assert(wildfire::inference::batch_exit_code(0u)
        == wildfire::inference::success_exit_code);
    assert(wildfire::inference::batch_exit_code(1u)
        == wildfire::inference::inference_exit_code);
}

} // namespace

int main() {
    TemporaryDirectory directory;
    test_tensor_io_and_validation(directory.path());
    test_tensor_rejections(directory.path());
    test_options();
    test_cpu_partitioning();
    test_bounded_queue_and_ordered_reports();
    test_scheduler_overflow_and_exit_mapping();
}
