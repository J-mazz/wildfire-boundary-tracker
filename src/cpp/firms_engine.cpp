#include <cstddef>
#include <cstdint>
#include <limits>

import wildfire.firms.engine;
import wildfire.memory;

namespace {

struct FirmsAdapter {
    alignas(16) std::byte storage[wildfire::firms::kReservedArenaBytes]{};
    alignas(16) std::byte query_storage[wildfire::firms::kTimelineScratchBytes]{};
    wildfire::memory::AllocationTelemetry allocations{};
    wildfire::memory::AllocationTelemetry query_allocations{};
    wildfire::memory::BoundedArena arena{storage, &allocations};
    wildfire::memory::BoundedArena query_arena{query_storage, &query_allocations};
    wildfire::firms::EngineState engine{arena};
    wildfire::firms::TimelineQueryState query{query_arena};
};

FirmsAdapter g_adapter;

} // namespace

extern "C" {

std::uint8_t* firms_input() {
    return g_adapter.engine.input();
}

std::uint32_t firms_input_capacity() {
    return wildfire::firms::kInputCapacity;
}

void firms_reset() {
    g_adapter.engine.reset();
    g_adapter.query.reset();
}

int firms_ingest_csv(const std::uint32_t byte_length) {
    return wildfire::firms::ingest_csv(g_adapter.engine, byte_length);
}

std::uint32_t firms_finalize(
    const double west,
    const double south,
    const double east,
    const double north,
    const double padding_degrees,
    const double max_span_degrees
) {
    return wildfire::firms::finalize(
        g_adapter.engine,
        west,
        south,
        east,
        north,
        padding_degrees,
        max_span_degrees
    );
}

const wildfire::firms::DetectionRecord* firms_records() {
    return g_adapter.engine.records();
}

std::uint32_t firms_count() {
    return g_adapter.engine.count();
}

std::uint32_t firms_record_stride() {
    return sizeof(wildfire::firms::DetectionRecord);
}

double firms_bound(const std::uint32_t index) {
    return index < 4u
        ? g_adapter.engine.bounds()[index]
        : std::numeric_limits<double>::quiet_NaN();
}

std::int64_t* firms_query_frames() {
    return g_adapter.query.frames();
}

std::uint32_t firms_query_frame_capacity() {
    return wildfire::firms::kTimelineQueryCapacity;
}

std::uint32_t firms_query_frame_stride() {
    return wildfire::firms::kTimelineFrameStride;
}

const wildfire::firms::TimelineQueryResult* firms_query_results() {
    return g_adapter.query.results();
}

std::uint32_t firms_query_result_count() {
    return g_adapter.query.result_count();
}

std::uint32_t firms_query_result_stride() {
    return wildfire::firms::kTimelineResultStride;
}

std::int32_t firms_query_coverage(
    const std::uint32_t frame_count,
    const std::uint32_t persistence_hours
) {
    return wildfire::firms::query_coverage(
        g_adapter.engine,
        g_adapter.query,
        frame_count,
        persistence_hours
    );
}

std::int32_t firms_query_range(const std::uint32_t persistence_hours) {
    return wildfire::firms::query_range(
        g_adapter.engine,
        g_adapter.query,
        persistence_hours
    );
}

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)

void firms_benchmark_reset_telemetry() {
    g_adapter.engine.reset_working_set_telemetry();
}

std::size_t firms_benchmark_working_set_high_water() {
    return g_adapter.engine.working_set_high_water();
}

std::size_t firms_benchmark_reserved_storage_bytes() {
    return wildfire::firms::kReservedStorageBytes
        + wildfire::firms::kTimelineScratchBytes;
}

std::size_t firms_benchmark_query_scratch_high_water() {
    return g_adapter.query.scratch_high_water();
}

std::size_t firms_benchmark_query_allocation_count() {
    return g_adapter.query_allocations.allocation_count();
}

#endif

} // extern "C"
