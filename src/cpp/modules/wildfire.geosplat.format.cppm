export module wildfire.geosplat.format;

import std;

export namespace wildfire::geosplat::format {

constexpr std::uint32_t kMagic = 0x31505347u;
constexpr std::size_t kHeaderBytes = 16u;
constexpr std::size_t kBytesPerSplat = 7u;
constexpr std::size_t kFloatsPerSplat = 9u;
constexpr std::size_t kMaxSplatCount = 4u * 1024u * 1024u;
constexpr std::size_t kMaxPayloadBytes =
    kHeaderBytes + kMaxSplatCount * kBytesPerSplat;
constexpr std::size_t kMaxDecodedBytes =
    kMaxSplatCount * kFloatsPerSplat * sizeof(float);

struct Header {
    std::uint16_t grid_width;
    std::uint16_t grid_height;
    float min_height;
    float max_height;
};

struct Layout {
    Header header;
    std::size_t count;
    std::size_t height_bytes;
    std::size_t color_bytes;
    std::size_t output_floats;
    std::size_t output_bytes;
};

[[nodiscard]] bool inspect(
    std::span<const std::byte> bytes,
    Layout& layout
) noexcept;
[[nodiscard]] bool resolve(
    Header header,
    std::size_t logical_length,
    std::size_t address_limit,
    std::size_t splat_limit,
    Layout& layout
) noexcept;

} // namespace wildfire::geosplat::format
