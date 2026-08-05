#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <vector>

import wildfire.geosplat;

namespace {

void store_u16_le(std::uint8_t* destination, const std::uint16_t value) {
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8u);
}

void store_u32_le(std::uint8_t* destination, const std::uint32_t value) {
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8u);
    destination[2] = static_cast<std::uint8_t>(value >> 16u);
    destination[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::vector<std::uint8_t> make_fixture(
    const std::uint16_t width,
    const std::uint16_t height
) {
    constexpr std::size_t header_bytes = 16u;
    const std::size_t count = static_cast<std::size_t>(width) * height;
    std::vector<std::uint8_t> bytes(header_bytes + count * 7u);
    store_u32_le(bytes.data(), 0x31505347u);
    store_u16_le(bytes.data() + 4u, width);
    store_u16_le(bytes.data() + 6u, height);
    const float min_height = 100.0f;
    const float max_height = 2500.0f;
    std::memcpy(bytes.data() + 8u, &min_height, sizeof(min_height));
    std::memcpy(bytes.data() + 12u, &max_height, sizeof(max_height));

    std::uint8_t* heights = bytes.data() + header_bytes;
    std::uint8_t* colors = heights + count * 2u;
    std::uint8_t* normals = colors + count * 3u;
    for (std::size_t index = 0u; index < count; ++index) {
        store_u16_le(heights + index * 2u, static_cast<std::uint16_t>(index));
        colors[index * 3u] = static_cast<std::uint8_t>(index);
        colors[index * 3u + 1u] = static_cast<std::uint8_t>(index >> 2u);
        colors[index * 3u + 2u] = static_cast<std::uint8_t>(index >> 4u);
        normals[index * 2u] = 0u;
        normals[index * 2u + 1u] = 0u;
    }
    return bytes;
}

} // namespace

int main(const int argc, char** argv) {
    const auto width = static_cast<std::uint16_t>(argc > 1 ? std::stoul(argv[1]) : 256u);
    const auto height = static_cast<std::uint16_t>(argc > 2 ? std::stoul(argv[2]) : 256u);
    const std::size_t iterations = argc > 3 ? std::stoul(argv[3]) : 40u;
    const std::size_t count = static_cast<std::size_t>(width) * height;
    const std::vector<std::uint8_t> fixture = make_fixture(width, height);

    if (wildfire::geosplat::decode(fixture.data(), fixture.size()) != count) return 2;
    wildfire::geosplat::release();
    wildfire::geosplat::benchmark_reset_telemetry();
    const auto start = std::chrono::steady_clock::now();
    for (std::size_t iteration = 0u; iteration < iterations; ++iteration) {
        if (wildfire::geosplat::decode(fixture.data(), fixture.size()) != count) return 2;
        wildfire::geosplat::release();
    }
    const auto finish = std::chrono::steady_clock::now();
    const double seconds = std::chrono::duration<double>(finish - start).count();
    const double throughput = static_cast<double>(count * iterations) / seconds;

    std::cout << std::fixed << std::setprecision(3)
              << "{\"benchmark\":\"geosplat_decode\""
              << ",\"items\":" << count * iterations
              << ",\"iterations\":" << iterations
              << ",\"elapsed_ms\":" << seconds * 1000.0
              << ",\"throughput_items_per_second\":" << throughput
              << ",\"dynamic_allocation_count\":" << wildfire::geosplat::benchmark_allocation_count()
              << ",\"allocation_high_water_bytes\":"
              << wildfire::geosplat::benchmark_allocation_high_water_bytes()
              << ",\"input_bytes\":" << fixture.size()
              << "}\n";
}
