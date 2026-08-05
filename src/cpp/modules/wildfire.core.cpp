module wildfire.core;

import std;

namespace wildfire::core {

bool is_power_of_two(const std::size_t value) noexcept {
    return value != 0u && (value & (value - 1u)) == 0u;
}

bool checked_add(
    const std::size_t left,
    const std::size_t right,
    std::size_t& result
) noexcept {
    if (right > std::numeric_limits<std::size_t>::max() - left) return false;
    result = left + right;
    return true;
}

bool checked_multiply(
    const std::size_t left,
    const std::size_t right,
    std::size_t& result
) noexcept {
    if (left != 0u && right > std::numeric_limits<std::size_t>::max() / left) return false;
    result = left * right;
    return true;
}

bool checked_align_up(
    const std::size_t value,
    const std::size_t alignment,
    std::size_t& result
) noexcept {
    if (!is_power_of_two(alignment)) return false;
    const std::size_t mask = alignment - 1u;
    std::size_t adjusted{};
    if (!checked_add(value, mask, adjusted)) return false;
    result = adjusted & ~mask;
    return true;
}

namespace {

bool has_bytes(
    const std::span<const std::byte> bytes,
    const std::size_t offset,
    const std::size_t count
) noexcept {
    return offset <= bytes.size() && count <= bytes.size() - offset;
}

} // namespace

bool load_u16_le(
    const std::span<const std::byte> bytes,
    const std::size_t offset,
    std::uint16_t& result
) noexcept {
    if (!has_bytes(bytes, offset, sizeof(result))) return false;
    const auto* cursor = bytes.data() + offset;
    result = static_cast<std::uint16_t>(std::to_integer<std::uint8_t>(cursor[0]))
        | static_cast<std::uint16_t>(std::to_integer<std::uint8_t>(cursor[1]) << 8u);
    return true;
}

bool load_u32_le(
    const std::span<const std::byte> bytes,
    const std::size_t offset,
    std::uint32_t& result
) noexcept {
    if (!has_bytes(bytes, offset, sizeof(result))) return false;
    const auto* cursor = bytes.data() + offset;
    result = static_cast<std::uint32_t>(std::to_integer<std::uint8_t>(cursor[0]))
        | (static_cast<std::uint32_t>(std::to_integer<std::uint8_t>(cursor[1])) << 8u)
        | (static_cast<std::uint32_t>(std::to_integer<std::uint8_t>(cursor[2])) << 16u)
        | (static_cast<std::uint32_t>(std::to_integer<std::uint8_t>(cursor[3])) << 24u);
    return true;
}

bool load_f32_le(
    const std::span<const std::byte> bytes,
    const std::size_t offset,
    float& result
) noexcept {
    std::uint32_t bits{};
    if (!load_u32_le(bytes, offset, bits)) return false;
    result = std::bit_cast<float>(bits);
    return true;
}

BoundedReader::BoundedReader(const std::span<const std::byte> bytes) noexcept
    : bytes_(bytes) {}

std::size_t BoundedReader::position() const noexcept {
    return offset_;
}

std::size_t BoundedReader::remaining() const noexcept {
    return bytes_.size() - offset_;
}

bool BoundedReader::skip(const std::size_t count) noexcept {
    if (count > remaining()) return false;
    offset_ += count;
    return true;
}

bool BoundedReader::read_bytes(
    const std::size_t count,
    std::span<const std::byte>& result
) noexcept {
    if (count > remaining()) return false;
    result = bytes_.subspan(offset_, count);
    offset_ += count;
    return true;
}

bool BoundedReader::read_u16_le(std::uint16_t& result) noexcept {
    if (!load_u16_le(bytes_, offset_, result)) return false;
    offset_ += sizeof(result);
    return true;
}

bool BoundedReader::read_u32_le(std::uint32_t& result) noexcept {
    if (!load_u32_le(bytes_, offset_, result)) return false;
    offset_ += sizeof(result);
    return true;
}

bool BoundedReader::read_f32_le(float& result) noexcept {
    if (!load_f32_le(bytes_, offset_, result)) return false;
    offset_ += sizeof(result);
    return true;
}

} // namespace wildfire::core
