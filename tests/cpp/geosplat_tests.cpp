#include "boundary_fixtures.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>

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
    test_decodes_one_cell_fixture();
}
