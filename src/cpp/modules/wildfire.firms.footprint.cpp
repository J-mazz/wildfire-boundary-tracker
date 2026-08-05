module wildfire.firms.footprint;

import std;

namespace wildfire::firms {

void grow_footprint(
    EngineState& state,
    double west,
    double south,
    double east,
    double north,
    const double padding_degrees,
    const double max_span_degrees
) noexcept {
    const DetectionRecord* const records = state.records();
    for (std::uint32_t index = 0u; index < state.count(); ++index) {
        west = std::min(west, records[index].longitude - padding_degrees);
        south = std::min(south, records[index].latitude - padding_degrees);
        east = std::max(east, records[index].longitude + padding_degrees);
        north = std::max(north, records[index].latitude + padding_degrees);
    }
    const double center_x = (west + east) * 0.5;
    const double center_y = (south + north) * 0.5;
    const double half_span = max_span_degrees * 0.5;
    double* const bounds = state.bounds();
    bounds[0] = std::max(west, center_x - half_span);
    bounds[1] = std::max(south, center_y - half_span);
    bounds[2] = std::min(east, center_x + half_span);
    bounds[3] = std::min(north, center_y + half_span);
}

} // namespace wildfire::firms
