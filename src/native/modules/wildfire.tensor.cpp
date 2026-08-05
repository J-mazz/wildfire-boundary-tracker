module wildfire.tensor;

import std;
import wildfire.core;

namespace wildfire::tensor {

namespace {

constexpr std::size_t kInputHeaderBytes = 5u * sizeof(std::uint32_t);
constexpr std::size_t kOutputHeaderBytes = 7u * sizeof(std::uint32_t);

void store_u32_le(
    const std::uint32_t value,
    const std::span<std::byte, sizeof(std::uint32_t)> destination
) noexcept {
    destination[0] = static_cast<std::byte>(value & 0xffu);
    destination[1] = static_cast<std::byte>((value >> 8u) & 0xffu);
    destination[2] = static_cast<std::byte>((value >> 16u) & 0xffu);
    destination[3] = static_cast<std::byte>((value >> 24u) & 0xffu);
}

bool payload_bytes(const std::uint32_t elements, std::size_t& bytes) noexcept {
    return wildfire::core::checked_multiply(elements, sizeof(float), bytes)
        && bytes <= static_cast<std::size_t>(std::numeric_limits<std::streamsize>::max());
}

bool valid_input_layout(const InputLayout& layout) noexcept {
    std::size_t plane{};
    std::size_t expected{};
    return layout.width != 0u && layout.height != 0u && layout.channels != 0u
        && wildfire::core::checked_multiply(layout.width, layout.height, plane)
        && wildfire::core::checked_multiply(plane, layout.channels, expected)
        && expected == layout.elements;
}

bool strided_destination(
    const InputLayout& layout,
    const std::size_t destination_size,
    const std::size_t channel_stride,
    std::size_t& plane
) noexcept {
    std::size_t channel_offset{};
    std::size_t required{};
    return valid_input_layout(layout)
        && wildfire::core::checked_multiply(layout.width, layout.height, plane)
        && channel_stride >= plane
        && wildfire::core::checked_multiply(
            layout.channels - 1u,
            channel_stride,
            channel_offset
        )
        && wildfire::core::checked_add(channel_offset, plane, required)
        && destination_size >= required;
}

bool read_channels(
    std::ifstream& input,
    const InputLayout& layout,
    const std::span<float> destination,
    const std::size_t channel_stride,
    const std::size_t plane_bytes,
    std::string& error
) {
    for (std::size_t channel = 0u; channel < layout.channels; ++channel) {
        float* const channel_data = destination.data() + channel * channel_stride;
        if (!input.read(
            reinterpret_cast<char*>(channel_data),
            static_cast<std::streamsize>(plane_bytes)
        )) {
            error = "truncated NCT1 tensor";
            return false;
        }
    }
    return true;
}

void normalize_channel_endian(
    const InputLayout& layout,
    const std::span<float> destination,
    const std::size_t channel_stride,
    const std::size_t plane
) noexcept {
    if constexpr (std::endian::native == std::endian::big) {
        for (std::size_t channel = 0u; channel < layout.channels; ++channel) {
            for (float& value : destination.subspan(channel * channel_stride, plane)) {
                auto bits = std::bit_cast<std::uint32_t>(value);
                bits = std::byteswap(bits);
                value = std::bit_cast<float>(bits);
            }
        }
    }
}

bool expected_output_elements(
    const OutputLayout& layout,
    std::size_t& expected
) noexcept {
    expected = layout.width;
    if (layout.dimensions >= 2u
        && !wildfire::core::checked_multiply(expected, layout.height, expected)) return false;
    if (layout.dimensions == 4u
        && !wildfire::core::checked_multiply(expected, layout.depth, expected)) return false;
    if (layout.dimensions >= 3u
        && !wildfire::core::checked_multiply(expected, layout.channels, expected)) return false;
    return true;
}

bool valid_output_dimensions(const OutputLayout& layout) noexcept {
    if (layout.dimensions < 1u || layout.dimensions > 4u || layout.width == 0u) return false;
    if (layout.dimensions >= 2u && layout.height == 0u) return false;
    if (layout.dimensions == 4u && layout.depth == 0u) return false;
    return layout.dimensions < 3u || layout.channels != 0u;
}

void store_output_header(
    const OutputLayout& layout,
    const std::span<std::byte, kOutputHeaderBytes> bytes
) noexcept {
    const std::array values{
        nco1_magic,
        layout.dimensions,
        layout.width,
        layout.height,
        layout.depth,
        layout.channels,
        layout.elements
    };
    for (std::size_t index = 0u; index < values.size(); ++index) {
        store_u32_le(
            values[index],
            std::span<std::byte, sizeof(std::uint32_t)>{
                bytes.data() + index * sizeof(std::uint32_t),
                sizeof(std::uint32_t)
            }
        );
    }
}

} // namespace

bool inspect_nct1(
    const std::filesystem::path& path,
    InputLayout& layout,
    std::string& error
) {
    std::ifstream input(path, std::ios::binary);
    std::array<std::byte, kInputHeaderBytes> header{};
    if (!input.read(reinterpret_cast<char*>(header.data()), header.size())) {
        error = "cannot read NCT1 header";
        return false;
    }

    wildfire::core::BoundedReader reader(header);
    std::uint32_t magic{};
    if (!reader.read_u32_le(magic)
        || !reader.read_u32_le(layout.width)
        || !reader.read_u32_le(layout.height)
        || !reader.read_u32_le(layout.channels)
        || !reader.read_u32_le(layout.elements)
        || magic != nct1_magic
        || !valid_input_layout(layout)) {
        error = "invalid NCT1 dimensions";
        return false;
    }
    return true;
}

bool read_nct1_data(
    const std::filesystem::path& path,
    const InputLayout& layout,
    const std::span<float> destination,
    const std::size_t channel_stride,
    std::string& error
) {
    std::size_t plane{};
    if (!strided_destination(layout, destination.size(), channel_stride, plane)) {
        error = "invalid NCT1 dimensions";
        return false;
    }

    std::ifstream input(path, std::ios::binary);
    input.seekg(static_cast<std::streamoff>(kInputHeaderBytes));
    std::size_t plane_bytes{};
    if (!input || !payload_bytes(static_cast<std::uint32_t>(plane), plane_bytes)) {
        error = "invalid NCT1 dimensions";
        return false;
    }
    if (!read_channels(
        input,
        layout,
        destination,
        channel_stride,
        plane_bytes,
        error
    )) return false;
    normalize_channel_endian(layout, destination, channel_stride, plane);
    return true;
}

bool valid_output_layout(const OutputLayout& layout) noexcept {
    std::size_t expected{};
    return valid_output_dimensions(layout)
        && expected_output_elements(layout, expected)
        && expected <= layout.elements;
}

bool write_nco1(
    const std::filesystem::path& path,
    const OutputLayout& layout,
    const std::span<const float> values,
    std::string& error
) {
    std::size_t bytes{};
    if (!valid_output_layout(layout) || values.size() != layout.elements
        || !payload_bytes(layout.elements, bytes)) {
        error = "output is not unpacked float32";
        return false;
    }

    std::array<std::byte, kOutputHeaderBytes> header{};
    store_output_header(layout, header);
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output.write(reinterpret_cast<const char*>(header.data()), header.size())) {
        error = "cannot write NCO1 tensor";
        return false;
    }
    if constexpr (std::endian::native == std::endian::little) {
        if (!output.write(
            reinterpret_cast<const char*>(values.data()),
            static_cast<std::streamsize>(bytes)
        )) {
            error = "cannot write NCO1 tensor";
            return false;
        }
    } else {
        for (const float value : values) {
            std::array<std::byte, sizeof(float)> encoded{};
            store_u32_le(std::bit_cast<std::uint32_t>(value), encoded);
            if (!output.write(reinterpret_cast<const char*>(encoded.data()), encoded.size())) {
                error = "cannot write NCO1 tensor";
                return false;
            }
        }
    }
    return true;
}

} // namespace wildfire::tensor
