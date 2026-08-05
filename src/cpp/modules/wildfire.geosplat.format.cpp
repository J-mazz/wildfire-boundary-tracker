module wildfire.geosplat.format;

import std;
import wildfire.core;

namespace wildfire::geosplat::format {
namespace {

bool multiply_limited(
    const std::size_t left,
    const std::size_t right,
    const std::size_t limit,
    std::size_t& result
) noexcept {
    return wildfire::core::checked_multiply(left, right, result)
        && result <= limit;
}

bool add_limited(
    const std::size_t left,
    const std::size_t right,
    const std::size_t limit,
    std::size_t& result
) noexcept {
    return wildfire::core::checked_add(left, right, result)
        && result <= limit;
}

bool read_header(
    const std::span<const std::byte> bytes,
    Header& header
) noexcept {
    wildfire::core::BoundedReader reader(bytes);
    std::uint32_t magic{};
    return reader.read_u32_le(magic)
        && magic == kMagic
        && reader.read_u16_le(header.grid_width)
        && reader.read_u16_le(header.grid_height)
        && reader.read_f32_le(header.min_height)
        && reader.read_f32_le(header.max_height);
}

bool resolve_payload(
    const Header header,
    const std::size_t address_limit,
    Layout& layout,
    std::size_t& expected_length
) noexcept {
    std::size_t payload_bytes{};
    return multiply_limited(
        header.grid_width, header.grid_height, address_limit, layout.count
    )
        && layout.count != 0u
        && multiply_limited(layout.count, 2u, address_limit, layout.height_bytes)
        && multiply_limited(layout.count, 3u, address_limit, layout.color_bytes)
        && multiply_limited(layout.count, kBytesPerSplat, address_limit, payload_bytes)
        && add_limited(kHeaderBytes, payload_bytes, address_limit, expected_length);
}

bool resolve_output(
    const std::size_t address_limit,
    Layout& layout
) noexcept {
    return multiply_limited(
        layout.count, kFloatsPerSplat, address_limit, layout.output_floats
    )
        && multiply_limited(
            layout.output_floats, sizeof(float), address_limit, layout.output_bytes
        );
}

} // namespace

bool resolve(
    const Header header,
    const std::size_t logical_length,
    const std::size_t address_limit,
    const std::size_t splat_limit,
    Layout& layout
) noexcept {
    std::size_t expected_length{};
    return resolve_payload(header, address_limit, layout, expected_length)
        && layout.count <= splat_limit
        && resolve_output(address_limit, layout)
        && expected_length == logical_length
        && ((layout.header = header), true);
}

bool inspect(
    const std::span<const std::byte> bytes,
    Layout& layout
) noexcept {
    Header header{};
    return bytes.size() >= kHeaderBytes
        && read_header(bytes.first(kHeaderBytes), header)
        && resolve(
            header,
            bytes.size(),
            std::numeric_limits<std::size_t>::max(),
            kMaxSplatCount,
            layout
        );
}

} // namespace wildfire::geosplat::format
