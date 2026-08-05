#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

import wildfire.firms.engine;
import wildfire.memory;

namespace {

constexpr std::int64_t kHourMs = 3'600'000;
constexpr std::int64_t kCadenceMs = 3 * kHourMs;
constexpr std::int64_t kBaseFrame = 200'000 * kCadenceMs;

alignas(16) std::array<std::byte, wildfire::firms::kReservedArenaBytes> engine_storage{};
wildfire::memory::BoundedArena engine_arena{engine_storage};
wildfire::firms::EngineState engine{engine_arena};

alignas(16) std::array<std::byte, wildfire::firms::kTimelineScratchBytes> query_storage{};
wildfire::memory::AllocationTelemetry query_telemetry;
wildfire::memory::BoundedArena query_arena{query_storage, &query_telemetry};
wildfire::firms::TimelineQueryState query{query_arena};

void add_record(
    const std::int64_t observed_at_ms,
    const double latitude,
    const double longitude = -116.0
) {
    wildfire::firms::DetectionRecord* const record = engine.next_record();
    assert(record != nullptr);
    *record = {};
    record->observed_at_ms = observed_at_ms;
    record->latitude = latitude;
    record->longitude = longitude;
    engine.commit_record();
}

void finalize_records() {
    const std::uint32_t count = wildfire::firms::finalize(
        engine,
        -117.0,
        41.0,
        -115.0,
        43.0,
        0.0,
        360.0
    );
    assert(count == engine.count());
}

wildfire::firms::TimelineQueryResult reference(
    const std::int64_t frame,
    const std::uint32_t persistence_hours
) {
    const std::int64_t lower = frame - static_cast<std::int64_t>(persistence_hours) * kHourMs;
    const std::int64_t upper = frame + kCadenceMs;
    std::uint32_t begin = engine.count();
    std::uint32_t count = 0u;
    std::int64_t newest = wildfire::firms::kNoObservation;
    for (std::uint32_t index = 0u; index < engine.count(); ++index) {
        const std::int64_t observed = engine.records()[index].observed_at_ms;
        if (observed < lower || observed >= upper) continue;
        if (begin == engine.count()) begin = index;
        ++count;
        newest = observed;
    }
    if (count == 0u) begin = 0u;
    return {newest, begin, count};
}

void assert_result(
    const wildfire::firms::TimelineQueryResult& actual,
    const wildfire::firms::TimelineQueryResult& expected
) {
    assert(actual.newest_observed_at_ms == expected.newest_observed_at_ms);
    assert(actual.feature_count == expected.feature_count);
    if (actual.feature_count != 0u) assert(actual.begin_index == expected.begin_index);
}

void test_empty_and_one_record() {
    engine.reset();
    finalize_records();
    query.frames()[0] = kBaseFrame;
    assert(wildfire::firms::query_range(engine, query, 168u) == 1);
    assert_result(query.results()[0], reference(kBaseFrame, 168u));

    engine.reset();
    add_record(kBaseFrame + 30 * 60'000, 42.0);
    finalize_records();
    assert(wildfire::firms::query_range(engine, query, 168u) == 1);
    assert_result(query.results()[0], reference(kBaseFrame, 168u));
}

void test_boundaries_duplicates_and_future_records() {
    engine.reset();
    add_record(kBaseFrame - 168 * kHourMs - 1, 1.0);
    add_record(kBaseFrame - 168 * kHourMs, 2.0);
    add_record(kBaseFrame, 3.0);
    add_record(kBaseFrame, 4.0);
    add_record(kBaseFrame + kHourMs, 5.0);
    add_record(kBaseFrame + kCadenceMs, 6.0);
    finalize_records();
    query.frames()[0] = kBaseFrame;
    assert(wildfire::firms::query_range(engine, query, 168u) == 1);
    assert_result(query.results()[0], reference(kBaseFrame, 168u));
    assert(query.results()[0].feature_count == 4u);
    assert(query.results()[0].newest_observed_at_ms == kBaseFrame + kHourMs);
}

void test_unsorted_pre_finalize_and_reset() {
    engine.reset();
    add_record(kBaseFrame + kHourMs, 1.0);
    add_record(kBaseFrame - kHourMs, 2.0);
    query.frames()[0] = kBaseFrame;
    assert(wildfire::firms::query_range(engine, query, 168u)
        == static_cast<std::int32_t>(wildfire::firms::TimelineQueryError::not_finalized));
    assert(query.result_count() == 0u);
    finalize_records();
    assert(wildfire::firms::query_range(engine, query, 168u) == 1);
    assert(query.result_count() == 1u);
    query.reset();
    assert(query.result_count() == 0u);
}

void test_long_history_matches_reference() {
    engine.reset();
    for (std::uint32_t index = 0u; index < 4096u; ++index) {
        const std::int64_t offset = static_cast<std::int64_t>((index * 7919u) % 7200u) * 60'000;
        add_record(kBaseFrame - 300 * kHourMs + offset, static_cast<double>(index));
    }
    finalize_records();
    constexpr std::uint32_t frame_count = 81u;
    for (std::uint32_t index = 0u; index < frame_count; ++index) {
        query.frames()[index] = kBaseFrame - 120 * kHourMs + index * kCadenceMs;
    }
    assert(wildfire::firms::query_coverage(engine, query, frame_count, 168u)
        == static_cast<std::int32_t>(frame_count));
    for (std::uint32_t index = 0u; index < frame_count; ++index) {
        assert_result(query.results()[index], reference(query.frames()[index], 168u));
    }
}

void test_capacity_exhaustion_and_integer_boundaries() {
    query.frames()[0] = kBaseFrame + 1;
    assert(wildfire::firms::query_range(engine, query, 168u)
        == static_cast<std::int32_t>(wildfire::firms::TimelineQueryError::invalid_frames));
    query.frames()[0] = kBaseFrame;
    assert(wildfire::firms::query_coverage(
        engine,
        query,
        std::numeric_limits<std::uint32_t>::max(),
        168u
    ) == static_cast<std::int32_t>(wildfire::firms::TimelineQueryError::capacity_exceeded));

    query.frames()[0] = std::numeric_limits<std::int64_t>::max()
        - std::numeric_limits<std::int64_t>::max() % kCadenceMs;
    assert(wildfire::firms::query_range(engine, query, 168u)
        == static_cast<std::int32_t>(wildfire::firms::TimelineQueryError::time_overflow));

    alignas(16) std::array<std::byte, 64u> tiny_storage{};
    wildfire::memory::AllocationTelemetry telemetry;
    wildfire::memory::BoundedArena tiny_arena{tiny_storage, &telemetry};
    wildfire::firms::TimelineQueryState exhausted{tiny_arena};
    assert(!exhausted.ready());
    assert(telemetry.failed_allocation_count() == 1u);
    assert(wildfire::firms::query_coverage(engine, exhausted, 0u, 168u)
        == static_cast<std::int32_t>(wildfire::firms::TimelineQueryError::invalid_storage));

    wildfire::memory::BoundedArena tiny_engine_arena{tiny_storage};
    wildfire::firms::EngineState exhausted_engine{tiny_engine_arena};
    const std::uint32_t finalized = wildfire::firms::finalize(
        exhausted_engine,
        -1.0,
        -1.0,
        1.0,
        1.0,
        0.0,
        360.0
    );
    assert(finalized == 0u);
    query.frames()[0] = kBaseFrame;
    assert(wildfire::firms::query_range(exhausted_engine, query, 168u)
        == static_cast<std::int32_t>(wildfire::firms::TimelineQueryError::invalid_storage));
}

void test_query_storage_metrics() {
    assert(query.scratch_high_water() == wildfire::firms::kTimelineScratchBytes);
    assert(query_telemetry.allocation_count() == 2u);
    assert(query_telemetry.failed_allocation_count() == 0u);
}

} // namespace

int main() {
    test_empty_and_one_record();
    test_boundaries_duplicates_and_future_records();
    test_unsorted_pre_finalize_and_reset();
    test_long_history_matches_reference();
    test_capacity_exhaustion_and_integer_boundaries();
    test_query_storage_metrics();
}
