module wildfire.geosplat.decode;

import std;
import wildfire.core;
import wildfire.geosplat.format;

namespace wildfire::geosplat::algorithm {
namespace {

float signed_normal_component(const std::byte value) noexcept {
    return static_cast<float>(
        std::bit_cast<std::int8_t>(std::to_integer<std::uint8_t>(value))
    ) / 127.0f;
}

void decode_one(
    const std::size_t index,
    const format::Layout& layout,
    const std::span<const std::byte> heights,
    const std::span<const std::byte> colors,
    const std::span<const std::byte> normals,
    float* const output
) noexcept {
    std::uint16_t quantized{};
    const bool loaded = wildfire::core::load_u16_le(heights, index * 2u, quantized);
    if (!loaded) return;
    const float nx = signed_normal_component(normals[index * 2u]);
    const float ny = signed_normal_component(normals[index * 2u + 1u]);
    const float normal_z_squared = 1.0f - nx * nx - ny * ny;
    const float span = layout.header.max_height - layout.header.min_height;
    const std::size_t row = index / layout.header.grid_width;
    const std::size_t column = index % layout.header.grid_width;

    output[0] = (static_cast<float>(column) + 0.5f)
        / static_cast<float>(layout.header.grid_width);
    output[1] = (static_cast<float>(row) + 0.5f)
        / static_cast<float>(layout.header.grid_height);
    output[2] = layout.header.min_height
        + static_cast<float>(quantized) / 65535.0f * span;
    output[3] = static_cast<float>(std::to_integer<std::uint8_t>(colors[index * 3u]))
        / 255.0f;
    output[4] = static_cast<float>(std::to_integer<std::uint8_t>(colors[index * 3u + 1u]))
        / 255.0f;
    output[5] = static_cast<float>(std::to_integer<std::uint8_t>(colors[index * 3u + 2u]))
        / 255.0f;
    output[6] = nx;
    output[7] = ny;
    output[8] = normal_z_squared > 0.0f ? std::sqrt(normal_z_squared) : 0.0f;
}

} // namespace

void decode(
    const std::span<const std::byte> bytes,
    const format::Layout& layout,
    const std::span<float> output
) noexcept {
    const auto payload = bytes.subspan(format::kHeaderBytes);
    const auto heights = payload.first(layout.height_bytes);
    const auto colors = payload.subspan(
        layout.height_bytes, layout.color_bytes
    );
    const auto normals = payload.subspan(
        layout.height_bytes + layout.color_bytes
    );
    for (std::size_t index = 0u; index < layout.count; ++index) {
        decode_one(
            index,
            layout,
            heights,
            colors,
            normals,
            output.data() + index * format::kFloatsPerSplat
        );
    }
}

} // namespace wildfire::geosplat::algorithm
