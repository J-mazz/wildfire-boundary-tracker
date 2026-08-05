module;

#include <cstdint>

export module wildfire.firms.engine;

export import wildfire.firms.model;
export import wildfire.firms.ingest;

export namespace wildfire::firms {

[[nodiscard]] std::uint32_t finalize(
    EngineState& state,
    double west,
    double south,
    double east,
    double north,
    double padding_degrees,
    double max_span_degrees
) noexcept;

} // namespace wildfire::firms
