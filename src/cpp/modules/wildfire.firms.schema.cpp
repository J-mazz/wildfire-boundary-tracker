module wildfire.firms.schema;

import std;
import wildfire.firms.csv;
import wildfire.firms.numbers;

namespace wildfire::firms {

namespace {

struct ColumnBinding {
    const char* name;
    int Columns::*member;
};

constexpr ColumnBinding kBindings[] = {
    {"latitude", &Columns::latitude},
    {"longitude", &Columns::longitude},
    {"acq_date", &Columns::acq_date},
    {"acq_time", &Columns::acq_time},
    {"satellite", &Columns::satellite},
    {"instrument", &Columns::instrument},
    {"confidence", &Columns::confidence},
    {"frp", &Columns::frp},
    {"bright_ti4", &Columns::bright_ti4},
    {"bright_ti5", &Columns::bright_ti5},
    {"daynight", &Columns::daynight}
};

} // namespace

void resolve_columns(
    const Field* const fields,
    const std::uint32_t count,
    Columns& columns
) noexcept {
    for (std::uint32_t index = 0u; index < count; ++index) {
        for (const ColumnBinding& binding : kBindings) {
            if (field_equals(fields[index], binding.name)) {
                columns.*(binding.member) = static_cast<int>(index);
                break;
            }
        }
    }
}

bool has_required_columns(const Columns& columns) noexcept {
    return columns.latitude >= 0
        && columns.longitude >= 0
        && columns.acq_date >= 0
        && columns.acq_time >= 0;
}

float optional_float(
    const Field* const fields,
    const std::uint32_t count,
    const int index
) noexcept {
    constexpr float missing = std::numeric_limits<float>::quiet_NaN();
    if (index < 0 || static_cast<std::uint32_t>(index) >= count) return missing;
    double value{};
    if (!parse_double(fields[index], value)) return missing;
    const double maximum = static_cast<double>(std::numeric_limits<float>::max());
    if (value < -maximum || value > maximum) return missing;
    return static_cast<float>(value);
}

Field optional_field(
    const Field* const fields,
    const std::uint32_t count,
    const int index
) noexcept {
    static constexpr char empty[] = "";
    if (index < 0 || static_cast<std::uint32_t>(index) >= count) {
        return {empty, empty, false};
    }
    return fields[index];
}

} // namespace wildfire::firms
