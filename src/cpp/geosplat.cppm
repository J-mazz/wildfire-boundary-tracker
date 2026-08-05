// geosplat.cppm - decodes the quantized DEM splat binary into GPU-ready instances.
module;
#include <cstdint>
#include <cstring>
#include <cmath>
#include <cstddef>
#include <vector>
#include <algorithm>

export module wildfire.geosplat;

namespace {
    constexpr std::uint32_t kMagic = 0x31505347u; // 'GSP1'
    constexpr std::size_t kHeaderBytes = 4 + 2 + 2 + 4 + 4;

    std::vector<float> g_instances;
    std::uint32_t g_count = 0;
    std::uint16_t g_grid_w = 0;
    std::uint16_t g_grid_h = 0;
    float g_min_height = 0.0f;
    float g_max_height = 0.0f;

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)
    std::size_t g_allocation_count = 0;
    std::size_t g_allocation_high_water_bytes = 0;
#endif

    template <typename T>
    T read_le(const std::uint8_t* cursor) {
        T value;
        std::memcpy(&value, cursor, sizeof(T));
        return value;
    }
}

export namespace wildfire::geosplat {

    // Interleaved layout per splat: u, v (grid 0..1), heightMeters, r, g, b, nx, ny, nz.
    constexpr std::uint32_t kFloatsPerSplat = 9;

    std::uint32_t decode(const std::uint8_t* data, std::size_t length) {
        if (data == nullptr || length < kHeaderBytes) return 0;
        if (read_le<std::uint32_t>(data) != kMagic) return 0;

        const auto grid_w = read_le<std::uint16_t>(data + 4);
        const auto grid_h = read_le<std::uint16_t>(data + 6);
        const auto min_height = read_le<float>(data + 8);
        const auto max_height = read_le<float>(data + 12);
        const std::size_t count = static_cast<std::size_t>(grid_w) * grid_h;
        if (count == 0) return 0;
        if (length != kHeaderBytes + count * (2 + 3 + 2)) return 0;

        const std::uint8_t* heights = data + kHeaderBytes;
        const std::uint8_t* colors = heights + count * 2;
        const auto* normals = reinterpret_cast<const std::int8_t*>(colors + count * 3);
        const float span = max_height - min_height;

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)
        const std::size_t previous_capacity = g_instances.capacity();
#endif
        g_instances.assign(count * kFloatsPerSplat, 0.0f);
#if defined(WILDFIRE_BENCHMARK_TELEMETRY)
        g_allocation_count += static_cast<std::size_t>(
            g_instances.capacity() > previous_capacity
        );
        g_allocation_high_water_bytes = std::max(
            g_allocation_high_water_bytes,
            g_instances.capacity() * sizeof(float)
        );
#endif
        float* out = g_instances.data();
        for (std::size_t index = 0; index < count; ++index) {
            const std::size_t row = index / grid_w;
            const std::size_t col = index % grid_w;
            const auto quantized = read_le<std::uint16_t>(heights + index * 2);
            const float nx = static_cast<float>(normals[index * 2]) / 127.0f;
            const float ny = static_cast<float>(normals[index * 2 + 1]) / 127.0f;
            const float nz_sq = 1.0f - nx * nx - ny * ny;

            out[0] = (static_cast<float>(col) + 0.5f) / static_cast<float>(grid_w);
            out[1] = (static_cast<float>(row) + 0.5f) / static_cast<float>(grid_h);
            out[2] = min_height + static_cast<float>(quantized) / 65535.0f * span;
            out[3] = static_cast<float>(colors[index * 3]) / 255.0f;
            out[4] = static_cast<float>(colors[index * 3 + 1]) / 255.0f;
            out[5] = static_cast<float>(colors[index * 3 + 2]) / 255.0f;
            out[6] = nx;
            out[7] = ny;
            out[8] = nz_sq > 0.0f ? std::sqrt(nz_sq) : 0.0f;
            out += kFloatsPerSplat;
        }

        g_count = static_cast<std::uint32_t>(count);
        g_grid_w = grid_w;
        g_grid_h = grid_h;
        g_min_height = min_height;
        g_max_height = max_height;
        return g_count;
    }

    const float* instance_data() { return g_instances.data(); }
    std::uint32_t splat_count() { return g_count; }
    std::uint16_t grid_width() { return g_grid_w; }
    std::uint16_t grid_height() { return g_grid_h; }
    float min_height() { return g_min_height; }
    float max_height() { return g_max_height; }

    void release() {
        g_instances.clear();
        g_instances.shrink_to_fit();
        g_count = 0;
    }

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)
    void benchmark_reset_telemetry() {
        g_allocation_count = 0;
        g_allocation_high_water_bytes = 0;
    }

    std::size_t benchmark_allocation_count() {
        return g_allocation_count;
    }

    std::size_t benchmark_allocation_high_water_bytes() {
        return g_allocation_high_water_bytes;
    }
#endif

} // namespace wildfire::geosplat
