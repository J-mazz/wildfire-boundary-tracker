module;

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <span>
#include <string>

export module wildfire.tensor;

export namespace wildfire::tensor {

inline constexpr std::uint32_t nct1_magic = 0x3154434eu;
inline constexpr std::uint32_t nco1_magic = 0x314f434eu;

struct InputLayout {
    std::uint32_t width{};
    std::uint32_t height{};
    std::uint32_t channels{};
    std::uint32_t elements{};
};

struct OutputLayout {
    std::uint32_t dimensions{};
    std::uint32_t width{};
    std::uint32_t height{};
    std::uint32_t depth{};
    std::uint32_t channels{};
    std::uint32_t elements{};
};

[[nodiscard]] bool inspect_nct1(
    const std::filesystem::path& path,
    InputLayout& layout,
    std::string& error
);
[[nodiscard]] bool read_nct1_data(
    const std::filesystem::path& path,
    const InputLayout& layout,
    std::span<float> destination,
    std::size_t channel_stride,
    std::string& error
);
[[nodiscard]] bool write_nco1(
    const std::filesystem::path& path,
    const OutputLayout& layout,
    std::span<const float> values,
    std::string& error
);
[[nodiscard]] bool valid_output_layout(const OutputLayout& layout) noexcept;

} // namespace wildfire::tensor
