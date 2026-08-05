module wildfire.firms.model;

import std;
import wildfire.memory;

namespace wildfire::firms {

EngineState::EngineState(wildfire::memory::BoundedArena& arena) noexcept {
    input_ = static_cast<std::uint8_t*>(
        arena.allocate(kInputCapacity, 16u)
    );
    if (input_ != nullptr) {
        records_ = static_cast<DetectionRecord*>(
            arena.allocate(
                static_cast<std::size_t>(kRecordCapacity) * sizeof(DetectionRecord),
                alignof(DetectionRecord)
            )
        );
    }
    if (input_ == nullptr || records_ == nullptr) {
        input_ = nullptr;
        records_ = nullptr;
    }
}

bool EngineState::ready() const noexcept {
    return input_ != nullptr && records_ != nullptr;
}

std::uint8_t* EngineState::input() noexcept {
    return input_;
}

const std::uint8_t* EngineState::input() const noexcept {
    return input_;
}

DetectionRecord* EngineState::records() noexcept {
    return records_;
}

const DetectionRecord* EngineState::records() const noexcept {
    return records_;
}

std::uint32_t EngineState::count() const noexcept {
    return count_;
}

void EngineState::set_count(const std::uint32_t count) noexcept {
    count_ = count;
}

DetectionRecord* EngineState::next_record() noexcept {
    if (!ready() || count_ >= kRecordCapacity) return nullptr;
    return records_ + count_;
}

void EngineState::commit_record() noexcept {
    ++count_;
    if (count_ > record_high_water_) record_high_water_ = count_;
}

double* EngineState::bounds() noexcept {
    return bounds_;
}

const double* EngineState::bounds() const noexcept {
    return bounds_;
}

void EngineState::reset() noexcept {
    count_ = 0u;
}

void EngineState::note_input_bytes(const std::size_t bytes) noexcept {
    if (bytes > input_high_water_) input_high_water_ = bytes;
}

void EngineState::reset_working_set_telemetry() noexcept {
    input_high_water_ = 0u;
    record_high_water_ = 0u;
}

std::size_t EngineState::working_set_high_water() const noexcept {
    return input_high_water_ + record_high_water_ * sizeof(DetectionRecord);
}

} // namespace wildfire::firms
