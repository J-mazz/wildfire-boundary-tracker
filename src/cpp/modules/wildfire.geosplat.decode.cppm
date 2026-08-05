export module wildfire.geosplat.decode;

import std;
import wildfire.geosplat.format;

export namespace wildfire::geosplat::algorithm {

void decode(
    std::span<const std::byte> bytes,
    const format::Layout& layout,
    std::span<float> output
) noexcept;

} // namespace wildfire::geosplat::algorithm
