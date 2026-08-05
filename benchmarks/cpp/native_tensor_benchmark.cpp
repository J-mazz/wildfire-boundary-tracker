#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <span>
#include <string>
#include <vector>

import wildfire.tensor;

namespace {

void append_u32(std::vector<std::byte>& bytes, const std::uint32_t value) {
    bytes.push_back(static_cast<std::byte>(value & 0xffu));
    bytes.push_back(static_cast<std::byte>((value >> 8u) & 0xffu));
    bytes.push_back(static_cast<std::byte>((value >> 16u) & 0xffu));
    bytes.push_back(static_cast<std::byte>((value >> 24u) & 0xffu));
}

} // namespace

int main() {
    constexpr std::size_t elements = 256u * 256u * 4u;
    constexpr std::size_t iterations = 24u;
    std::vector<float> values(elements, 1.25f);
    std::vector<std::byte> encoded;
    encoded.reserve(20u + values.size() * sizeof(float));
    append_u32(encoded, wildfire::tensor::nct1_magic);
    append_u32(encoded, 256u);
    append_u32(encoded, 256u);
    append_u32(encoded, 4u);
    append_u32(encoded, static_cast<std::uint32_t>(elements));
    const auto payload = std::as_bytes(std::span{values});
    encoded.insert(encoded.end(), payload.begin(), payload.end());

    const auto directory = std::filesystem::temp_directory_path();
    const auto input_path = directory / "wildfire-native-tensor-benchmark.nct";
    const auto output_path = directory / "wildfire-native-tensor-benchmark.nco";
    {
        std::ofstream output(input_path, std::ios::binary | std::ios::trunc);
        output.write(reinterpret_cast<const char*>(encoded.data()), encoded.size());
    }

    wildfire::tensor::InputLayout input_layout;
    const wildfire::tensor::OutputLayout output_layout{3u, 256u, 256u, 1u, 4u, elements};
    std::string error;
    const auto started = std::chrono::steady_clock::now();
    for (std::size_t iteration = 0u; iteration < iterations; ++iteration) {
        if (!wildfire::tensor::inspect_nct1(input_path, input_layout, error)
            || !wildfire::tensor::read_nct1_data(
                input_path,
                input_layout,
                values,
                256u * 256u,
                error
            )
            || !wildfire::tensor::write_nco1(output_path, output_layout, values, error)) {
            std::cerr << error << '\n';
            return 1;
        }
    }
    const auto elapsed = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - started
    ).count();
    std::error_code ignored;
    std::filesystem::remove(input_path, ignored);
    std::filesystem::remove(output_path, ignored);

    const double transferred = static_cast<double>(
        iterations * elements * sizeof(float) * 2u
    );
    std::cout << "{\"benchmark\":\"native_tensor_io\""
              << ",\"throughput_bytes_per_second\":" << transferred / elapsed
              << ",\"buffer_bytes\":" << values.size() * sizeof(float)
              << "}\n";
}
