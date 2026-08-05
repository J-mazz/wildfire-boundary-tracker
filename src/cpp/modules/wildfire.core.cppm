export module wildfire.core;

import std;

export namespace wildfire::core {

inline constexpr std::size_t default_new_alignment = __STDCPP_DEFAULT_NEW_ALIGNMENT__;

[[nodiscard]] bool is_power_of_two(std::size_t value) noexcept;
[[nodiscard]] bool checked_add(
    std::size_t left,
    std::size_t right,
    std::size_t& result
) noexcept;
[[nodiscard]] bool checked_multiply(
    std::size_t left,
    std::size_t right,
    std::size_t& result
) noexcept;
[[nodiscard]] bool checked_align_up(
    std::size_t value,
    std::size_t alignment,
    std::size_t& result
) noexcept;

[[nodiscard]] bool load_u16_le(
    std::span<const std::byte> bytes,
    std::size_t offset,
    std::uint16_t& result
) noexcept;
[[nodiscard]] bool load_u32_le(
    std::span<const std::byte> bytes,
    std::size_t offset,
    std::uint32_t& result
) noexcept;
[[nodiscard]] bool load_f32_le(
    std::span<const std::byte> bytes,
    std::size_t offset,
    float& result
) noexcept;

class BoundedReader {
public:
    explicit BoundedReader(std::span<const std::byte> bytes) noexcept;

    [[nodiscard]] std::size_t position() const noexcept;
    [[nodiscard]] std::size_t remaining() const noexcept;
    [[nodiscard]] bool skip(std::size_t count) noexcept;
    [[nodiscard]] bool read_bytes(
        std::size_t count,
        std::span<const std::byte>& result
    ) noexcept;
    [[nodiscard]] bool read_u16_le(std::uint16_t& result) noexcept;
    [[nodiscard]] bool read_u32_le(std::uint32_t& result) noexcept;
    [[nodiscard]] bool read_f32_le(float& result) noexcept;

private:
    std::span<const std::byte> bytes_;
    std::size_t offset_{};
};

} // namespace wildfire::core
