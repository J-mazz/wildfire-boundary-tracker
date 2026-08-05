#include "boundary_fixtures.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

import wildfire.geosplat;

namespace {

void test_rejects_invalid_headers() {
    const auto& valid = wildfire::tests::fixtures::geosplat_one_cell;
    assert(wildfire::geosplat::decode(nullptr, valid.size()) == 0u);
    assert(wildfire::geosplat::decode(valid.data(), 15u) == 0u);

    auto invalid = valid;
    invalid[0] = 0u;
    assert(wildfire::geosplat::decode(invalid.data(), invalid.size()) == 0u);

    invalid = valid;
    invalid[4] = 0u;
    assert(wildfire::geosplat::decode(invalid.data(), invalid.size()) == 0u);
    assert(wildfire::geosplat::decode(valid.data(), valid.size() - 1u) == 0u);
}

void test_rejects_overflow_dimensions() {
    const auto& wasm_overflow = wildfire::tests::fixtures::geosplat_wasm32_overflow_header;
    assert(wildfire::geosplat::decode(
        wasm_overflow.data(),
        wasm_overflow.size()
    ) == 0u);
    constexpr std::size_t maximum_grid_count = 65535ull * 65535ull;
    constexpr std::size_t maximum_grid_length = 16ull + maximum_grid_count * 7ull;
    assert(!wildfire::geosplat::validate_layout_for_testing(
        wasm_overflow.data(),
        maximum_grid_length,
        std::numeric_limits<std::uint32_t>::max(),
        std::numeric_limits<std::uint32_t>::max()
    ));

    const auto& capacity_overflow =
        wildfire::tests::fixtures::geosplat_capacity_overflow_header;
    assert(wildfire::geosplat::decode(
        capacity_overflow.data(),
        capacity_overflow.size()
    ) == 0u);
    constexpr std::size_t oversized_count = 4097u * 1024u;
    constexpr std::size_t oversized_length = 16u + oversized_count * 7u;
    assert(!wildfire::geosplat::validate_layout_for_testing(
        capacity_overflow.data(),
        oversized_length,
        std::numeric_limits<std::size_t>::max(),
        wildfire::geosplat::kMaxSplatCount
    ));
    assert(wildfire::geosplat::validate_layout_for_testing(
        capacity_overflow.data(),
        oversized_length,
        std::numeric_limits<std::size_t>::max(),
        oversized_count
    ));
    assert(wildfire::geosplat::kMaxSplatCount == 4u * 1024u * 1024u);
}

void test_decodes_one_cell_fixture() {
    const auto& fixture = wildfire::tests::fixtures::geosplat_one_cell;
    assert(wildfire::geosplat::decode(fixture.data(), fixture.size()) == 1u);
    assert(wildfire::geosplat::kFloatsPerSplat == 9u);
    assert(wildfire::geosplat::splat_count() == 1u);
    assert(wildfire::geosplat::grid_width() == 1u);
    assert(wildfire::geosplat::grid_height() == 1u);
    assert(wildfire::geosplat::min_height() == 100.0f);
    assert(wildfire::geosplat::max_height() == 300.0f);

    const float* instance = wildfire::geosplat::instance_data();
    assert(instance[0] == 0.5f);
    assert(instance[1] == 0.5f);
    assert(std::abs(instance[2] - 200.0015f) < 0.01f);
    assert(instance[3] == 1.0f);
    assert(std::abs(instance[4] - 128.0f / 255.0f) < 0.0001f);
    assert(instance[5] == 0.0f);
    assert(instance[6] == 0.0f);
    assert(instance[7] == 0.0f);
    assert(instance[8] == 1.0f);

    wildfire::geosplat::release();
    assert(wildfire::geosplat::splat_count() == 0u);
}

} // namespace

int main() {
    test_rejects_invalid_headers();
    test_rejects_overflow_dimensions();
    test_decodes_one_cell_fixture();
}
