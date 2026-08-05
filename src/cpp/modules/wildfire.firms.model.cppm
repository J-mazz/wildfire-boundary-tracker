module;

#include <cstddef>
#include <cstdint>

export module wildfire.firms.model;

import wildfire.memory;

export namespace wildfire::firms {

inline constexpr std::uint32_t kInputCapacity = 8u * 1024u * 1024u;
inline constexpr std::uint32_t kRecordCapacity = 131072u;
inline constexpr std::uint32_t kMaxColumns = 40u;
inline constexpr std::size_t kReservedArenaBytes =
    static_cast<std::size_t>(kInputCapacity)
    + static_cast<std::size_t>(kRecordCapacity) * 64u;
inline constexpr std::size_t kReservedStorageBytes =
    kReservedArenaBytes + 4u * sizeof(double);

struct DetectionRecord {
    double latitude;
    double longitude;
    std::int64_t observed_at_ms;
    float frp_mw;
    float brightness_i4_k;
    float brightness_i5_k;
    char satellite[8];
    char instrument[8];
    char confidence[8];
    char day_night[2];
    std::uint8_t padding[2];
};

static_assert(sizeof(DetectionRecord) == 64u);
static_assert(offsetof(DetectionRecord, observed_at_ms) == 16u);
static_assert(offsetof(DetectionRecord, satellite) == 36u);
static_assert(offsetof(DetectionRecord, day_night) == 60u);

struct Field {
    const char* begin;
    const char* end;
    bool quoted;
};

struct Columns {
    int latitude{-1};
    int longitude{-1};
    int acq_date{-1};
    int acq_time{-1};
    int satellite{-1};
    int instrument{-1};
    int confidence{-1};
    int frp{-1};
    int bright_ti4{-1};
    int bright_ti5{-1};
    int daynight{-1};
};

class EngineState {
public:
    explicit EngineState(wildfire::memory::BoundedArena& arena) noexcept;

    [[nodiscard]] bool ready() const noexcept;
    [[nodiscard]] std::uint8_t* input() noexcept;
    [[nodiscard]] const std::uint8_t* input() const noexcept;
    [[nodiscard]] DetectionRecord* records() noexcept;
    [[nodiscard]] const DetectionRecord* records() const noexcept;
    [[nodiscard]] std::uint32_t count() const noexcept;
    void set_count(std::uint32_t count) noexcept;
    [[nodiscard]] DetectionRecord* next_record() noexcept;
    void commit_record() noexcept;
    [[nodiscard]] double* bounds() noexcept;
    [[nodiscard]] const double* bounds() const noexcept;
    void reset() noexcept;

    void note_input_bytes(std::size_t bytes) noexcept;
    void reset_working_set_telemetry() noexcept;
    [[nodiscard]] std::size_t working_set_high_water() const noexcept;

private:
    std::uint8_t* input_{};
    DetectionRecord* records_{};
    std::uint32_t count_{};
    double bounds_[4]{};
    std::size_t input_high_water_{};
    std::size_t record_high_water_{};
};

} // namespace wildfire::firms
