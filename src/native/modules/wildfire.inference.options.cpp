module wildfire.inference.options;

import std;

namespace wildfire::inference {

namespace {

bool parse_integer(const std::string_view text, int& value) {
    std::string_view normalized = text;
    while (!normalized.empty()
        && std::isspace(static_cast<unsigned char>(normalized.front())) != 0) {
        normalized.remove_prefix(1u);
    }
    if (!normalized.empty() && normalized.front() == '+') normalized.remove_prefix(1u);
    if (normalized.empty()) return false;

    int parsed{};
    const auto [end, error] = std::from_chars(
        normalized.data(),
        normalized.data() + normalized.size(),
        parsed
    );
    if (error != std::errc{} || end != normalized.data() + normalized.size()) return false;
    value = parsed;
    return true;
}

bool next_value(
    const std::span<const std::string_view> arguments,
    std::size_t& index,
    std::string_view& value
) noexcept {
    if (++index >= arguments.size()) return false;
    value = arguments[index];
    return true;
}

bool assign_option(
    const std::string_view argument,
    const std::string_view value,
    Options& options
) {
    if (argument == "--param") options.parameter_path = value;
    else if (argument == "--model") options.model_path = value;
    else if (argument == "--input-name") options.input_name = value;
    else if (argument == "--output-name") options.output_name = value;
    else if (argument == "--output-dir") options.output_directory = value;
    else return false;
    return true;
}

bool assign_integer_option(
    const std::string_view argument,
    const std::string_view value,
    Options& options
) {
    int parsed{};
    if (!parse_integer(value, parsed)) return false;
    if (argument == "--device") {
        options.device_index = parsed;
        return true;
    }
    if (argument == "--workers" && parsed >= 1 && parsed <= 32) {
        options.workers = static_cast<unsigned>(parsed);
        return true;
    }
    return false;
}

bool complete(const Options& options) noexcept {
    return options.list_devices || (!options.parameter_path.empty()
        && !options.model_path.empty()
        && !options.output_directory.empty()
        && !options.input_name.empty()
        && !options.output_name.empty()
        && !options.inputs.empty());
}

bool is_dash_argument(const std::string_view argument) noexcept {
    return !argument.empty() && argument.front() == '-';
}

} // namespace

ParsedOptions parse_options(const std::span<const std::string_view> arguments) {
    ParsedOptions parsed;
    for (std::size_t index = 0u; index < arguments.size(); ++index) {
        const std::string_view argument = arguments[index];
        if (argument == "--help") {
            parsed.action = ParseAction::help;
            return parsed;
        }
        if (argument == "--list-devices") {
            parsed.options.list_devices = true;
            continue;
        }
        if (argument.starts_with("--")) {
            std::string_view value;
            if (!next_value(arguments, index, value)) return parsed;
            const bool assigned = assign_option(argument, value, parsed.options)
                || assign_integer_option(argument, value, parsed.options);
            if (!assigned) return parsed;
            continue;
        }
        if (is_dash_argument(argument)) return parsed;
        parsed.options.inputs.emplace_back(argument);
    }
    if (complete(parsed.options)) parsed.action = ParseAction::run;
    return parsed;
}

std::string_view usage_text() noexcept {
    return "Usage: ncnn-vulkan-batch --param MODEL.param --model MODEL.bin "
        "--input-name NAME --output-name NAME --output-dir DIR "
        "[--device INDEX] [--workers N] INPUT.nct...\n"
        "       ncnn-vulkan-batch --list-devices\n"
        "Input NCT1: five little-endian uint32 values (magic,width,height,channels,elements), "
        "then channel-major float32 data.\n";
}

std::filesystem::path output_path(
    const Options& options,
    const std::filesystem::path& input
) {
    return options.output_directory / (input.filename().string() + ".nco");
}

int parse_exit_code(const ParseAction action) noexcept {
    return action == ParseAction::invalid ? usage_exit_code : success_exit_code;
}

} // namespace wildfire::inference
