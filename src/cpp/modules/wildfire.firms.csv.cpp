module wildfire.firms.csv;

import std;

namespace wildfire::firms {

namespace {

bool parse_quoted_field(
    const char*& cursor,
    const char* const end,
    Field& field
) noexcept {
    field.begin = ++cursor;
    field.quoted = true;
    while (cursor < end) {
        if (*cursor != '"') {
            ++cursor;
            continue;
        }
        if (cursor + 1 < end && cursor[1] == '"') {
            cursor += 2;
            continue;
        }
        field.end = cursor++;
        if (cursor < end && *cursor != ',') return false;
        if (cursor < end) ++cursor;
        return true;
    }
    return false;
}

bool parse_unquoted_field(
    const char*& cursor,
    const char* const end,
    Field& field
) noexcept {
    field.begin = cursor;
    field.quoted = false;
    while (cursor < end && *cursor != ',') {
        if (*cursor == '"') return false;
        ++cursor;
    }
    field.end = cursor;
    if (cursor < end) ++cursor;
    return true;
}

} // namespace

CsvLine tokenize_csv_line(
    const char* const begin,
    const char* const end,
    Field* const fields,
    const std::uint32_t capacity
) noexcept {
    std::uint32_t count = 0u;
    const char* cursor = begin;
    while (cursor <= end) {
        if (count >= capacity) return {count, false};
        const bool quoted = cursor < end && *cursor == '"';
        const bool valid = quoted
            ? parse_quoted_field(cursor, end, fields[count])
            : parse_unquoted_field(cursor, end, fields[count]);
        if (!valid) return {count, false};
        ++count;
        if (cursor >= end) break;
    }
    return {count, true};
}

bool field_equals(const Field field, const char* const text) noexcept {
    const auto length = static_cast<std::size_t>(field.end - field.begin);
    return std::strlen(text) == length
        && std::memcmp(field.begin, text, length) == 0;
}

void copy_field(
    char* const destination,
    const std::size_t capacity,
    const Field field
) noexcept {
    if (capacity == 0u) return;
    std::size_t written = 0u;
    const char* cursor = field.begin;
    while (cursor < field.end && written + 1u < capacity) {
        destination[written++] = *cursor++;
        if (field.quoted && cursor < field.end
            && destination[written - 1u] == '"' && *cursor == '"') {
            ++cursor;
        }
    }
    destination[written] = '\0';
}

} // namespace wildfire::firms
