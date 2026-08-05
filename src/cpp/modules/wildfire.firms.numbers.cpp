module;

#include <cmath>
#include <cstdint>
#include <limits>

module wildfire.firms.numbers;

namespace wildfire::firms {

namespace {

void parse_integer_digits(
    const char*& cursor,
    const char* const end,
    double& value,
    bool& found_digit
) noexcept {
    while (cursor < end && *cursor >= '0' && *cursor <= '9') {
        const double digit = static_cast<double>(*cursor++ - '0');
        value = value * 10.0 + digit;
        found_digit = true;
    }
}

void parse_fraction_digits(
    const char*& cursor,
    const char* const end,
    double& value,
    bool& found_digit
) noexcept {
    double place = 0.1;
    while (cursor < end && *cursor >= '0' && *cursor <= '9') {
        value += static_cast<double>(*cursor++ - '0') * place;
        place *= 0.1;
        found_digit = true;
    }
}

} // namespace

bool parse_double(const Field field, double& output) noexcept {
    if (field.begin == field.end) return false;
    const char* cursor = field.begin;
    double sign = 1.0;
    if (*cursor == '-') {
        sign = -1.0;
        ++cursor;
    } else if (*cursor == '+') {
        ++cursor;
    }

    double value = 0.0;
    bool found_digit = false;
    parse_integer_digits(cursor, field.end, value, found_digit);
    if (cursor < field.end && *cursor == '.') {
        ++cursor;
        parse_fraction_digits(cursor, field.end, value, found_digit);
    }
    if (!found_digit || cursor != field.end) return false;
    output = sign * value;
    return std::isfinite(output);
}

bool parse_unsigned(
    const char* const begin,
    const char* const end,
    std::uint32_t& output
) noexcept {
    if (begin == end) return false;
    std::uint32_t value = 0u;
    const char* cursor = begin;
    while (cursor < end && *cursor >= '0' && *cursor <= '9') {
        const auto digit = static_cast<std::uint32_t>(*cursor++ - '0');
        if (value > (std::numeric_limits<std::uint32_t>::max() - digit) / 10u) return false;
        value = value * 10u + digit;
    }
    if (cursor != end) return false;
    output = value;
    return true;
}

} // namespace wildfire::firms
