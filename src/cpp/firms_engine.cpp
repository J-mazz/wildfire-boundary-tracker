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

FirmsAdapter& adapter() {
    static FirmsAdapter instance;
    return instance;
}

} // namespace

extern "C" {

std::uint8_t* firms_input() {
    return adapter().engine.input();
}

std::uint32_t firms_input_capacity() {
    return wildfire::firms::kInputCapacity;
}

void firms_reset() {
    adapter().engine.reset();
}

int firms_ingest_csv(const std::uint32_t byte_length) {
    return wildfire::firms::ingest_csv(adapter().engine, byte_length);
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
        adapter().engine,
        west,
        south,
        east,
        north,
        padding_degrees,
        max_span_degrees
    );
}

const wildfire::firms::DetectionRecord* firms_records() {
    return adapter().engine.records();
}

std::uint32_t firms_count() {
    return adapter().engine.count();
}

std::uint32_t firms_record_stride() {
    return sizeof(wildfire::firms::DetectionRecord);
}

double firms_bound(const std::uint32_t index) {
    return index < 4u
        ? adapter().engine.bounds()[index]
        : std::numeric_limits<double>::quiet_NaN();
}

#if defined(WILDFIRE_BENCHMARK_TELEMETRY)

void firms_benchmark_reset_telemetry() {
    adapter().engine.reset_working_set_telemetry();
}

std::size_t firms_benchmark_working_set_high_water() {
    return adapter().engine.working_set_high_water();
}

std::size_t firms_benchmark_reserved_storage_bytes() {
    return wildfire::firms::kReservedStorageBytes;
}

#endif

} // extern "C"
