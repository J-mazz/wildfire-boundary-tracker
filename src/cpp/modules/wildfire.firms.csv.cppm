export module wildfire.firms.csv;

import std;
import wildfire.firms.model;

export namespace wildfire::firms {

struct CsvLine {
    std::uint32_t count;
    bool valid;
};

[[nodiscard]] CsvLine tokenize_csv_line(
    const char* begin,
    const char* end,
    Field* fields,
    std::uint32_t capacity
) noexcept;
[[nodiscard]] bool field_equals(Field field, const char* text) noexcept;
void copy_field(char* destination, std::size_t capacity, Field field) noexcept;

} // namespace wildfire::firms
