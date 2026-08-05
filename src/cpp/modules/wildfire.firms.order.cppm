module;

#include <cstdint>

export module wildfire.firms.order;

import wildfire.firms.model;

export namespace wildfire::firms {

void sort_and_dedupe(EngineState& state) noexcept;

} // namespace wildfire::firms
