module wildfire.firms.engine;

import std;
import wildfire.firms.footprint;
import wildfire.firms.ingest;
import wildfire.firms.order;

namespace wildfire::firms {

std::uint32_t finalize(
    EngineState& state,
    const double west,
    const double south,
    const double east,
    const double north,
    const double padding_degrees,
    const double max_span_degrees
) noexcept {
    sort_and_dedupe(state);
    grow_footprint(
        state,
        west,
        south,
        east,
        north,
        padding_degrees,
        max_span_degrees
    );
    state.mark_finalized();
    return state.count();
}

} // namespace wildfire::firms
