module;

#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>

module wildfire.geosplat;

import wildfire.core;
import wildfire.geosplat.decode;
import wildfire.geosplat.format;
import wildfire.geosplat.storage;

namespace wildfire::geosplat {
namespace {

struct Metadata {
    std::uint32_t count{};
    std::uint16_t grid_width{};
    std::uint16_t grid_height{};
    float min_height{};
    float max_height{};
};

storage::PayloadStorage payload_storage;
storage::DecodedStorage decoded_storage;
Metadata metadata;

void clear_metadata() noexcept {
    metadata = {};
}

} // namespace

void* allocate_payload(const std::size_t bytes) noexcept {
    return payload_storage.allocate(bytes);
}

void release_payload(void* const payload) noexcept {
    static_cast<void>(payload_storage.release(payload));
}

std::uint32_t decode(
    const std::uint8_t* const data,
    const std::size_t length
) noexcept {
    if (data == nullptr) return 0u;
    const auto bytes = std::span(
        reinterpret_cast<const std::byte*>(data), length
    );
    format::Layout layout{};
    if (!format::inspect(bytes, layout)) return 0u;
    clear_metadata();
    const std::span<float> output = decoded_storage.replace(layout.output_floats);
    if (output.empty()) return 0u;
    algorithm::decode(bytes, layout, output);
    metadata = {
        static_cast<std::uint32_t>(layout.count),
        layout.header.grid_width,
        layout.header.grid_height,
        layout.header.min_height,
        layout.header.max_height
    };
    return metadata.count;
}

const float* instance_data() noexcept {
    return decoded_storage.data();
}

std::uint32_t splat_count() noexcept {
    return metadata.count;
}

std::uint16_t grid_width() noexcept {
    return metadata.grid_width;
}

std::uint16_t grid_height() noexcept {
    return metadata.grid_height;
}

float min_height() noexcept {
    return metadata.min_height;
}

float max_height() noexcept {
    return metadata.max_height;
}

void release() noexcept {
    static_cast<void>(release_generation(generation()));
}

std::uint32_t generation() noexcept {
    return decoded_storage.generation();
}

bool release_generation(const std::uint32_t generation_value) noexcept {
    const bool released = decoded_storage.release(generation_value);
    if (released) clear_metadata();
    return released;
}

#if defined(WILDFIRE_GEOSPLAT_TESTING)
bool validate_layout_for_testing(
    const std::uint8_t* const header,
    const std::size_t logical_length,
    const std::size_t address_limit,
    const std::size_t splat_limit
) noexcept {
    if (header == nullptr) return false;
    const auto bytes = std::span(
        reinterpret_cast<const std::byte*>(header), format::kHeaderBytes
    );
    wildfire::geosplat::format::Layout layout{};
    wildfire::geosplat::format::Header parsed{};
    return wildfire::core::load_u16_le(bytes, 4u, parsed.grid_width)
        && wildfire::core::load_u16_le(bytes, 6u, parsed.grid_height)
        && wildfire::geosplat::format::resolve(
            parsed, logical_length, address_limit, splat_limit, layout
        );
}

std::uint32_t generation_for_testing() noexcept {
    return generation();
}

bool release_generation_for_testing(
    const std::uint32_t generation_value
) noexcept {
    return release_generation(generation_value);
}
#endif

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)
void benchmark_reset_telemetry() noexcept {
    payload_storage.reset_telemetry();
    decoded_storage.reset_telemetry();
}

std::size_t benchmark_allocation_count() noexcept {
    return benchmark_payload_allocation_count()
        + benchmark_decoded_allocation_count();
}

std::size_t benchmark_allocation_high_water_bytes() noexcept {
    return benchmark_payload_high_water_bytes()
        + benchmark_decoded_high_water_bytes();
}

std::size_t benchmark_payload_allocation_count() noexcept {
    return payload_storage.telemetry().allocation_count();
}

std::size_t benchmark_payload_high_water_bytes() noexcept {
    return payload_storage.telemetry().high_water_bytes();
}

std::size_t benchmark_decoded_allocation_count() noexcept {
    return decoded_storage.telemetry().allocation_count();
}

std::size_t benchmark_decoded_high_water_bytes() noexcept {
    return decoded_storage.telemetry().high_water_bytes();
}

std::size_t benchmark_storage_limit_bytes() noexcept {
    return payload_storage.capacity() + decoded_storage.capacity();
}
#endif

} // namespace wildfire::geosplat
