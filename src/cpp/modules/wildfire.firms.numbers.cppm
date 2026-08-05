export module wildfire.firms.numbers;

import std;
import wildfire.firms.model;

export namespace wildfire::firms {

[[nodiscard]] bool parse_double(Field field, double& output) noexcept;
[[nodiscard]] bool parse_unsigned(
    const char* begin,
    const char* end,
    std::uint32_t& output
) noexcept;

} // namespace wildfire::firms
