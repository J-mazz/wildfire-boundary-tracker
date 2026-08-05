module;

#include <cstddef>
#include <cstdint>

export module wildfire.geosplat;

export namespace wildfire::geosplat {

constexpr std::uint32_t kFloatsPerSplat = 9u;
constexpr std::size_t kMaxSplatCount = 4u * 1024u * 1024u;

[[nodiscard]] void* allocate_payload(std::size_t bytes) noexcept;
void release_payload(void* payload) noexcept;

[[nodiscard]] std::uint32_t decode(
    const std::uint8_t* data,
    std::size_t length
) noexcept;
[[nodiscard]] const float* instance_data() noexcept;
[[nodiscard]] std::uint32_t splat_count() noexcept;
[[nodiscard]] std::uint16_t grid_width() noexcept;
[[nodiscard]] std::uint16_t grid_height() noexcept;
[[nodiscard]] float min_height() noexcept;
[[nodiscard]] float max_height() noexcept;
void release() noexcept;
[[nodiscard]] std::uint32_t generation() noexcept;
[[nodiscard]] bool release_generation(std::uint32_t generation) noexcept;

#if defined(WILDFIRE_GEOSPLAT_TESTING)
[[nodiscard]] bool validate_layout_for_testing(
    const std::uint8_t* header,
    std::size_t logical_length,
    std::size_t address_limit,
    std::size_t splat_limit
) noexcept;
[[nodiscard]] std::uint32_t generation_for_testing() noexcept;
[[nodiscard]] bool release_generation_for_testing(
    std::uint32_t generation
) noexcept;
#endif

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)
void benchmark_reset_telemetry() noexcept;
[[nodiscard]] std::size_t benchmark_allocation_count() noexcept;
[[nodiscard]] std::size_t benchmark_allocation_high_water_bytes() noexcept;
[[nodiscard]] std::size_t benchmark_payload_allocation_count() noexcept;
[[nodiscard]] std::size_t benchmark_payload_high_water_bytes() noexcept;
[[nodiscard]] std::size_t benchmark_decoded_allocation_count() noexcept;
[[nodiscard]] std::size_t benchmark_decoded_high_water_bytes() noexcept;
[[nodiscard]] std::size_t benchmark_storage_limit_bytes() noexcept;
#endif

} // namespace wildfire::geosplat
