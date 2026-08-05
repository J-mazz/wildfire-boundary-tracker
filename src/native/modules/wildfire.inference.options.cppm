module;

#include <filesystem>
#include <span>
#include <string>
#include <string_view>
#include <vector>

export module wildfire.inference.options;

export namespace wildfire::inference {

inline constexpr int success_exit_code = 0;
inline constexpr int usage_exit_code = 2;
inline constexpr int vulkan_exit_code = 3;
inline constexpr int device_exit_code = 4;
inline constexpr int model_exit_code = 5;
inline constexpr int inference_exit_code = 6;

struct Options {
    std::filesystem::path parameter_path;
    std::filesystem::path model_path;
    std::filesystem::path output_directory;
    std::string input_name;
    std::string output_name;
    int device_index = 0;
    unsigned workers = 2u;
    bool list_devices = false;
    std::vector<std::filesystem::path> inputs;
};

enum class ParseAction {
    run,
    help,
    invalid
};

struct ParsedOptions {
    ParseAction action{ParseAction::invalid};
    Options options;
};

[[nodiscard]] ParsedOptions parse_options(std::span<const std::string_view> arguments);
[[nodiscard]] std::string_view usage_text() noexcept;
[[nodiscard]] std::filesystem::path output_path(
    const Options& options,
    const std::filesystem::path& input
);
[[nodiscard]] int parse_exit_code(ParseAction action) noexcept;

} // namespace wildfire::inference
