#include <iostream>
#include <string_view>
#include <vector>

import wildfire.inference.options;
import wildfire.inference.runtime;

int main(const int argc, char** argv) {
    std::vector<std::string_view> arguments;
    arguments.reserve(static_cast<std::size_t>(argc > 0 ? argc - 1 : 0));
    for (int index = 1; index < argc; ++index) arguments.emplace_back(argv[index]);

    const auto parsed = wildfire::inference::parse_options(arguments);
    if (parsed.action != wildfire::inference::ParseAction::run) {
        std::cerr << wildfire::inference::usage_text();
        return wildfire::inference::parse_exit_code(parsed.action);
    }
    return wildfire::inference::run_native(parsed.options);
}
