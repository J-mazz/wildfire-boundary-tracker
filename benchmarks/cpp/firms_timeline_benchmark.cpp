#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <iomanip>
#include <iostream>

import wildfire.firms.engine;
import wildfire.memory;

namespace {

constexpr std::int64_t kHourMs = 3'600'000;
constexpr std::int64_t kCadenceMs = 3 * kHourMs;
constexpr std::uint32_t kRecordCount = 32768u;
constexpr std::uint32_t kFrameCount = 81u;

alignas(16) std::array<std::byte, wildfire::firms::kReservedArenaBytes> engine_storage{};
wildfire::memory::BoundedArena engine_arena{engine_storage};
wildfire::firms::EngineState engine{engine_arena};

alignas(16) std::array<std::byte, wildfire::firms::kTimelineScratchBytes> query_storage{};
wildfire::memory::AllocationTelemetry query_allocations;
wildfire::memory::BoundedArena query_arena{query_storage, &query_allocations};
wildfire::firms::TimelineQueryState query{query_arena};

bool prepare() {
    constexpr std::int64_t base = 200'000 * kCadenceMs;
    for (std::uint32_t index = 0u; index < kRecordCount; ++index) {
        wildfire::firms::DetectionRecord* const record = engine.next_record();
        if (record == nullptr) return false;
        *record = {};
        record->observed_at_ms = base
            - static_cast<std::int64_t>(kRecordCount - index) * 5 * 60'000;
        record->latitude = 30.0 + static_cast<double>(index % 1000u) / 1000.0;
        record->longitude = -120.0 + static_cast<double>(index % 2000u) / 1000.0;
        engine.commit_record();
    }
    if (wildfire::firms::finalize(engine, -121.0, 29.0, -117.0, 32.0, 0.0, 360.0)
        != kRecordCount) return false;
    for (std::uint32_t index = 0u; index < kFrameCount; ++index) {
        query.frames()[index] = base - (kFrameCount - 1u - index) * kCadenceMs;
    }
    return wildfire::firms::query_coverage(engine, query, kFrameCount, 168u)
        == static_cast<std::int32_t>(kFrameCount);
}

} // namespace

int main(const int argc, char** argv) {
    const std::uint32_t iterations = argc > 1
        ? static_cast<std::uint32_t>(std::stoul(argv[1]))
        : 20'000u;
    if (!prepare()) return 2;
    const auto start = std::chrono::steady_clock::now();
    for (std::uint32_t iteration = 0u; iteration < iterations; ++iteration) {
        if (wildfire::firms::query_coverage(engine, query, kFrameCount, 168u)
            != static_cast<std::int32_t>(kFrameCount)) return 3;
    }
    const auto finish = std::chrono::steady_clock::now();
    const double seconds = std::chrono::duration<double>(finish - start).count();
    const auto frames = static_cast<std::uint64_t>(iterations) * kFrameCount;
    std::cout << std::fixed << std::setprecision(3)
              << "{\"benchmark\":\"firms_timeline_query\""
              << ",\"frames\":" << frames
              << ",\"iterations\":" << iterations
              << ",\"elapsed_ms\":" << seconds * 1000.0
              << ",\"throughput_frames_per_second\":"
              << static_cast<double>(frames) / seconds
              << ",\"scratch_high_water_bytes\":" << query.scratch_high_water()
              << ",\"bounded_allocation_count\":" << query_allocations.allocation_count()
              << "}\n";
}
