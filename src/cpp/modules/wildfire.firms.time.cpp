module wildfire.firms.time;

import std;
import wildfire.firms.numbers;

namespace wildfire::firms {

namespace {

constexpr std::int64_t days_from_civil(
    int year,
    const unsigned month,
    const unsigned day
) noexcept {
    year -= month <= 2u;
    const int era = (year >= 0 ? year : year - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(year - era * 400);
    const unsigned adjusted_month = month > 2u ? month - 3u : month + 9u;
    const unsigned doy = (153u * adjusted_month + 2u) / 5u + day - 1u;
    const unsigned doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
    return static_cast<std::int64_t>(era) * 146097
        + static_cast<std::int64_t>(doe) - 719468;
}

bool parse_date(
    const Field date,
    std::uint32_t& year,
    std::uint32_t& month,
    std::uint32_t& day
) noexcept {
    if (date.end - date.begin != 10) return false;
    if (date.begin[4] != '-' || date.begin[7] != '-') return false;
    return parse_unsigned(date.begin, date.begin + 4, year)
        && parse_unsigned(date.begin + 5, date.begin + 7, month)
        && parse_unsigned(date.begin + 8, date.end, day);
}

bool valid_clock_and_date(
    const std::uint32_t year,
    const std::uint32_t month,
    const std::uint32_t day,
    const std::uint32_t hour,
    const std::uint32_t minute
) noexcept {
    return day >= 1u
        && day <= days_in_month(year, month)
        && hour <= 23u
        && minute <= 59u;
}

} // namespace

bool leap_year(const std::uint32_t year) noexcept {
    return year % 4u == 0u && (year % 100u != 0u || year % 400u == 0u);
}

std::uint32_t days_in_month(
    const std::uint32_t year,
    const std::uint32_t month
) noexcept {
    constexpr std::uint32_t days[] = {
        31u, 28u, 31u, 30u, 31u, 30u,
        31u, 31u, 30u, 31u, 30u, 31u
    };
    if (month < 1u || month > 12u) return 0u;
    return month == 2u && leap_year(year) ? 29u : days[month - 1u];
}

bool parse_observed_at(
    const Field date,
    const Field time,
    std::int64_t& output_ms
) noexcept {
    std::uint32_t year{};
    std::uint32_t month{};
    std::uint32_t day{};
    std::uint32_t hhmm{};
    if (!parse_date(date, year, month, day)) return false;
    if (!parse_unsigned(time.begin, time.end, hhmm)) return false;
    const std::uint32_t hour = hhmm / 100u;
    const std::uint32_t minute = hhmm % 100u;
    if (!valid_clock_and_date(year, month, day, hour, minute)) return false;
    const std::int64_t seconds =
        days_from_civil(static_cast<int>(year), month, day) * 86400
        + static_cast<std::int64_t>(hour) * 3600
        + static_cast<std::int64_t>(minute) * 60;
    output_ms = seconds * 1000;
    return true;
}

} // namespace wildfire::firms
