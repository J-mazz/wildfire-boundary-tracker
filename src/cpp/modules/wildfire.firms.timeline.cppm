export module wildfire.firms.timeline;

import std;
import wildfire.firms.model;
import wildfire.memory;

export namespace wildfire::firms {

inline constexpr std::uint32_t kTimelineQueryCapacity = 128u;
inline constexpr std::uint32_t kTimelineFrameStride = sizeof(std::int64_t);
inline constexpr std::uint32_t kTimelineResultStride = 16u;
inline constexpr std::size_t kTimelineScratchBytes =
    static_cast<std::size_t>(kTimelineQueryCapacity)
        * (kTimelineFrameStride + kTimelineResultStride);
inline constexpr std::int64_t kNoObservation = std::numeric_limits<std::int64_t>::min();

enum class TimelineQueryError : std::int32_t {
    invalid_storage = -1,
    not_finalized = -2,
    capacity_exceeded = -3,
    invalid_frames = -4,
    time_overflow = -5
};

struct TimelineQueryResult {
    std::int64_t newest_observed_at_ms;
    std::uint32_t begin_index;
    std::uint32_t feature_count;
};

static_assert(sizeof(TimelineQueryResult) == kTimelineResultStride);
static_assert(__builtin_offsetof(TimelineQueryResult, begin_index) == 8u);
static_assert(__builtin_offsetof(TimelineQueryResult, feature_count) == 12u);

class TimelineQueryState {
public:
    explicit TimelineQueryState(wildfire::memory::BoundedArena& arena) noexcept;

    [[nodiscard]] bool ready() const noexcept;
    [[nodiscard]] std::int64_t* frames() noexcept;
    [[nodiscard]] const std::int64_t* frames() const noexcept;
    [[nodiscard]] TimelineQueryResult* results() noexcept;
    [[nodiscard]] const TimelineQueryResult* results() const noexcept;
    [[nodiscard]] std::uint32_t result_count() const noexcept;
    void set_result_count(std::uint32_t count) noexcept;
    void reset() noexcept;
    [[nodiscard]] std::size_t scratch_high_water() const noexcept;

private:
    wildfire::memory::BoundedArena* arena_{};
    std::int64_t* frames_{};
    TimelineQueryResult* results_{};
    std::uint32_t result_count_{};
};

[[nodiscard]] std::int32_t query_coverage(
    const EngineState& engine,
    TimelineQueryState& query,
    std::uint32_t frame_count,
    std::uint32_t persistence_hours
) noexcept;

[[nodiscard]] std::int32_t query_range(
    const EngineState& engine,
    TimelineQueryState& query,
    std::uint32_t persistence_hours
) noexcept;

} // namespace wildfire::firms
