export module wildfire.inference.runtime;

import std;
import wildfire.inference.options;

export namespace wildfire::inference {

[[nodiscard]] int run_native(const Options& options);

} // namespace wildfire::inference
