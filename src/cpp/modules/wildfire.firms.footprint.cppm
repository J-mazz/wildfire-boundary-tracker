module;

export module wildfire.firms.footprint;

import wildfire.firms.model;

export namespace wildfire::firms {

void grow_footprint(
    EngineState& state,
    double west,
    double south,
    double east,
    double north,
    double padding_degrees,
    double max_span_degrees
) noexcept;

} // namespace wildfire::firms
