export module wildfire.firms.ingest;

import std;
import wildfire.firms.model;

export namespace wildfire::firms {

[[nodiscard]] int ingest_csv(
    EngineState& state,
    std::uint32_t byte_length
) noexcept;

} // namespace wildfire::firms
