module;

#include <cstdint>

export module wildfire.firms.schema;

import wildfire.firms.model;

export namespace wildfire::firms {

void resolve_columns(
    const Field* fields,
    std::uint32_t count,
    Columns& columns
) noexcept;
[[nodiscard]] bool has_required_columns(const Columns& columns) noexcept;
[[nodiscard]] float optional_float(
    const Field* fields,
    std::uint32_t count,
    int index
) noexcept;
[[nodiscard]] Field optional_field(
    const Field* fields,
    std::uint32_t count,
    int index
) noexcept;

} // namespace wildfire::firms
