module wildfire.firms.timeline;

import std;
import wildfire.firms.model;
import wildfire.memory;

namespace wildfire::firms {

namespace {

constexpr std::int64_t kHourMs = 3'600'000;
constexpr std::int64_t kCadenceMs = 3 * kHourMs;

bool checked_add(
    const std::int64_t left,
    const std::int64_t right,
    std::int64_t& result
) noexcept {
    if (right > 0 && left > std::numeric_limits<std::int64_t>::max() - right) return false;
    if (right < 0 && left < std::numeric_limits<std::int64_t>::min() - right) return false;
    result = left + right;
    return true;
}

bool window_bounds(
    const std::int64_t frame,
    const std::uint32_t persistence_hours,
    std::int64_t& lower,
    std::int64_t& upper
) noexcept {
    const auto persistence = static_cast<std::int64_t>(persistence_hours) * kHourMs;
    return checked_add(frame, -persistence, lower)
        && checked_add(frame, kCadenceMs, upper);
}

bool valid_frames(
    const TimelineQueryState& query,
    const std::uint32_t frame_count
) noexcept {
    const std::int64_t* const frames = query.frames();
    for (std::uint32_t index = 0u; index < frame_count; ++index) {
        if (frames[index] % kCadenceMs != 0) return false;
        if (index != 0u && frames[index] < frames[index - 1u]) return false;
    }
    return true;
}

std::int32_t validate_query(
    const EngineState& engine,
    TimelineQueryState& query,
    const std::uint32_t frame_count
) noexcept {
    query.reset();
    if (!query.ready() || !engine.ready()) {
        return static_cast<std::int32_t>(TimelineQueryError::invalid_storage);
    }
    if (!engine.finalized()) {
        return static_cast<std::int32_t>(TimelineQueryError::not_finalized);
    }
    if (frame_count > kTimelineQueryCapacity) {
        return static_cast<std::int32_t>(TimelineQueryError::capacity_exceeded);
    }
    if (!valid_frames(query, frame_count)) {
        return static_cast<std::int32_t>(TimelineQueryError::invalid_frames);
    }
    return 0;
}

void write_result(
    TimelineQueryResult& result,
    const DetectionRecord* records,
    const std::uint32_t begin,
    const std::uint32_t end
) noexcept {
    result.begin_index = begin;
    result.feature_count = end - begin;
    result.newest_observed_at_ms = begin < end
        ? records[end - 1u].observed_at_ms
        : kNoObservation;
}

std::uint32_t lower_index(
    const DetectionRecord* records,
    const std::uint32_t count,
    const std::int64_t timestamp
) noexcept {
    const DetectionRecord* const found = std::lower_bound(
        records,
        records + count,
        timestamp,
        [](const DetectionRecord& record, const std::int64_t value) {
            return record.observed_at_ms < value;
        }
    );
    return static_cast<std::uint32_t>(found - records);
}

} // namespace

TimelineQueryState::TimelineQueryState(
    wildfire::memory::BoundedArena& arena
) noexcept : arena_(&arena) {
    frames_ = static_cast<std::int64_t*>(arena.allocate(
        static_cast<std::size_t>(kTimelineQueryCapacity) * kTimelineFrameStride,
        alignof(std::int64_t)
    ));
    if (frames_ != nullptr) {
        results_ = static_cast<TimelineQueryResult*>(arena.allocate(
            static_cast<std::size_t>(kTimelineQueryCapacity) * kTimelineResultStride,
            alignof(TimelineQueryResult)
        ));
    }
    if (frames_ == nullptr || results_ == nullptr) {
        frames_ = nullptr;
        results_ = nullptr;
    }
}

bool TimelineQueryState::ready() const noexcept {
    return frames_ != nullptr && results_ != nullptr;
}

std::int64_t* TimelineQueryState::frames() noexcept {
    return frames_;
}

const std::int64_t* TimelineQueryState::frames() const noexcept {
    return frames_;
}

TimelineQueryResult* TimelineQueryState::results() noexcept {
    return results_;
}

const TimelineQueryResult* TimelineQueryState::results() const noexcept {
    return results_;
}

std::uint32_t TimelineQueryState::result_count() const noexcept {
    return result_count_;
}

void TimelineQueryState::set_result_count(const std::uint32_t count) noexcept {
    result_count_ = count;
}

void TimelineQueryState::reset() noexcept {
    result_count_ = 0u;
}

std::size_t TimelineQueryState::scratch_high_water() const noexcept {
    return arena_ != nullptr ? arena_->high_water() : 0u;
}

std::int32_t query_coverage(
    const EngineState& engine,
    TimelineQueryState& query,
    const std::uint32_t frame_count,
    const std::uint32_t persistence_hours
) noexcept {
    const std::int32_t validation = validate_query(engine, query, frame_count);
    if (validation != 0) return validation;
    const DetectionRecord* const records = engine.records();
    std::uint32_t head = 0u;
    std::uint32_t tail = 0u;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        std::int64_t lower = 0;
        std::int64_t upper = 0;
        if (!window_bounds(query.frames()[frame], persistence_hours, lower, upper)) {
            query.reset();
            return static_cast<std::int32_t>(TimelineQueryError::time_overflow);
        }
        while (head < engine.count() && records[head].observed_at_ms < upper) ++head;
        while (tail < head && records[tail].observed_at_ms < lower) ++tail;
        write_result(query.results()[frame], records, tail, head);
    }
    query.set_result_count(frame_count);
    return static_cast<std::int32_t>(frame_count);
}

std::int32_t query_range(
    const EngineState& engine,
    TimelineQueryState& query,
    const std::uint32_t persistence_hours
) noexcept {
    const std::int32_t validation = validate_query(engine, query, 1u);
    if (validation != 0) return validation;
    std::int64_t lower = 0;
    std::int64_t upper = 0;
    if (!window_bounds(query.frames()[0], persistence_hours, lower, upper)) {
        return static_cast<std::int32_t>(TimelineQueryError::time_overflow);
    }
    const std::uint32_t begin = lower_index(engine.records(), engine.count(), lower);
    const std::uint32_t end = lower_index(engine.records(), engine.count(), upper);
    write_result(query.results()[0], engine.records(), begin, end);
    query.set_result_count(1u);
    return 1;
}

} // namespace wildfire::firms
