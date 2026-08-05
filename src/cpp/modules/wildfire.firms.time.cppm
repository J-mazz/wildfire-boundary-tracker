module;

#include <cstdint>

export module wildfire.firms.time;

import wildfire.firms.model;

export namespace wildfire::firms {

[[nodiscard]] bool leap_year(std::uint32_t year) noexcept;
[[nodiscard]] std::uint32_t days_in_month(
    std::uint32_t year,
    std::uint32_t month
) noexcept;
[[nodiscard]] bool parse_observed_at(
    Field date,
    Field time,
    std::int64_t& output_ms
) noexcept;

} // namespace wildfire::firms
