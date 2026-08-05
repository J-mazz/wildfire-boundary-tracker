#include <cstddef>
#include <cstdint>
#include <limits>

import wildfire.firms.engine;
import wildfire.memory;

namespace {

struct FirmsAdapter {
    alignas(16) std::byte storage[wildfire::firms::kReservedArenaBytes]{};
    wildfire::memory::AllocationTelemetry allocations{};
    wildfire::memory::BoundedArena arena{storage, &allocations};
    wildfire::firms::EngineState engine{arena};
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

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)

void firms_benchmark_reset_telemetry() {
    g_adapter.engine.reset_working_set_telemetry();
}

std::size_t firms_benchmark_working_set_high_water() {
    return g_adapter.engine.working_set_high_water();
}

std::size_t firms_benchmark_reserved_storage_bytes() {
    return wildfire::firms::kReservedStorageBytes;
}

#endif

} // extern "C"
