#include "boundary_fixtures.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

import wildfire.geosplat;
import wildfire.geosplat.storage;

namespace {

void test_rejects_truncated_and_invalid_inputs() {
    const auto& valid = wildfire::tests::fixtures::geosplat_one_cell;
    assert(wildfire::geosplat::decode(nullptr, valid.size()) == 0u);
    for (std::size_t length = 0u; length < valid.size(); ++length) {
        assert(wildfire::geosplat::decode(valid.data(), length) == 0u);
    }

    auto invalid = valid;
    invalid[0] = 0u;
    assert(wildfire::geosplat::decode(invalid.data(), invalid.size()) == 0u);

    invalid = valid;
    invalid[4] = 0u;
    assert(wildfire::geosplat::decode(invalid.data(), invalid.size()) == 0u);

    invalid = valid;
    invalid[4] = 0u;
    invalid[5] = 1u;
    assert(wildfire::geosplat::decode(invalid.data(), invalid.size()) == 0u);

    std::array<std::uint8_t, 24> extended{};
    std::copy(valid.begin(), valid.end(), extended.begin());
    assert(wildfire::geosplat::decode(extended.data(), extended.size()) == 0u);
}

void test_invalid_decode_preserves_current_generation() {
    const auto& valid = wildfire::tests::fixtures::geosplat_one_cell;
    assert(wildfire::geosplat::decode(valid.data(), valid.size()) == 1u);
    const std::uint32_t generation = wildfire::geosplat::generation_for_testing();
    assert(wildfire::geosplat::decode(valid.data(), valid.size() - 1u) == 0u);
    assert(wildfire::geosplat::generation_for_testing() == generation);
    assert(wildfire::geosplat::splat_count() == 1u);
    wildfire::geosplat::release();
}

void test_rejects_checked_arithmetic_failures() {
    const auto& wasm_overflow = wildfire::tests::fixtures::geosplat_wasm32_overflow_header;
    constexpr std::size_t maximum_grid_count = 65535ull * 65535ull;
    constexpr std::size_t maximum_grid_length = 16ull + maximum_grid_count * 7ull;
    assert(!wildfire::geosplat::validate_layout_for_testing(
        wasm_overflow.data(),
        maximum_grid_length,
        std::numeric_limits<std::uint32_t>::max(),
        std::numeric_limits<std::uint32_t>::max()
    ));

    const auto& valid = wildfire::tests::fixtures::geosplat_one_cell;
    assert(!wildfire::geosplat::validate_layout_for_testing(
        valid.data(), valid.size(), valid.size() - 1u, 1u
    ));

    auto output_overflow = wasm_overflow;
    output_overflow[4] = 0x00u;
    output_overflow[5] = 0x04u;
    output_overflow[6] = 0x00u;
    output_overflow[7] = 0x04u;
    constexpr std::size_t million_count = 1024u * 1024u;
    constexpr std::size_t million_length = 16u + million_count * 7u;
    assert(!wildfire::geosplat::validate_layout_for_testing(
        output_overflow.data(), million_length, 30u * 1024u * 1024u, million_count
    ));
}

void test_enforces_splat_cap_boundaries() {
    const auto& cap = wildfire::tests::fixtures::geosplat_cap_header;
    constexpr std::size_t cap_length =
        16u + wildfire::geosplat::kMaxSplatCount * 7u;
    assert(wildfire::geosplat::validate_layout_for_testing(
        cap.data(),
        cap_length,
        std::numeric_limits<std::size_t>::max(),
        wildfire::geosplat::kMaxSplatCount
    ));

    const auto& capacity_overflow =
        wildfire::tests::fixtures::geosplat_capacity_overflow_header;
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

void test_decodes_little_endian_fixture() {
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
    assert(wildfire::geosplat::instance_data() == nullptr);

    const auto& endian = wildfire::tests::fixtures::geosplat_endian_probe;
    assert(wildfire::geosplat::decode(endian.data(), endian.size()) == 1u);
    instance = wildfire::geosplat::instance_data();
    assert(instance[2] == 1.0f);
    assert(std::abs(instance[3] - 1.0f / 255.0f) < 0.0001f);
    assert(instance[6] == -1.0f);
    assert(instance[7] == 1.0f);
    assert(instance[8] == 0.0f);
    wildfire::geosplat::release();
}

void test_generation_safe_repeated_decode_release() {
    const auto& fixture = wildfire::tests::fixtures::geosplat_one_cell;
    assert(wildfire::geosplat::decode(fixture.data(), fixture.size()) == 1u);
    const std::uint32_t first = wildfire::geosplat::generation_for_testing();
    assert(wildfire::geosplat::decode(fixture.data(), fixture.size()) == 1u);
    const std::uint32_t second = wildfire::geosplat::generation_for_testing();
    assert(second != first);
    assert(!wildfire::geosplat::release_generation_for_testing(first));
    assert(wildfire::geosplat::splat_count() == 1u);
    assert(wildfire::geosplat::release_generation_for_testing(second));
    assert(wildfire::geosplat::splat_count() == 0u);
    assert(!wildfire::geosplat::release_generation_for_testing(second));
}

void test_bounded_storage_exhaustion_and_reset() {
    wildfire::geosplat::storage::PayloadStorage payload;
    void* const first = payload.allocate(23u);
    assert(first != nullptr);
    assert(payload.allocate(1u) == nullptr);
    assert(!payload.release(nullptr));
    assert(payload.release(first));
    assert(payload.allocate(23u) != nullptr);
    payload.reset();

    wildfire::geosplat::storage::DecodedStorage decoded;
    assert(decoded.replace(
        (wildfire::geosplat::kMaxSplatCount + 1u)
            * wildfire::geosplat::kFloatsPerSplat
    ).empty());
    const std::span<float> values = decoded.replace(
        wildfire::geosplat::kFloatsPerSplat
    );
    assert(values.size() == wildfire::geosplat::kFloatsPerSplat);
    const std::uint32_t generation = decoded.generation();
    decoded.reset();
    assert(decoded.data() == nullptr);
    assert(!decoded.release(generation));
}

} // namespace

int main() {
    test_rejects_truncated_and_invalid_inputs();
    test_invalid_decode_preserves_current_generation();
    test_rejects_checked_arithmetic_failures();
    test_enforces_splat_cap_boundaries();
    test_decodes_little_endian_fixture();
    test_generation_safe_repeated_decode_release();
    test_bounded_storage_exhaustion_and_reset();
}
