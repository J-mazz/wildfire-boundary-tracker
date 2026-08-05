module;

#include <cstddef>
#include <cstdint>
#include <span>

export module wildfire.geosplat.storage;

import wildfire.memory;

export namespace wildfire::geosplat::storage {

class PayloadStorage {
public:
    PayloadStorage() noexcept;

    [[nodiscard]] void* allocate(std::size_t bytes) noexcept;
    [[nodiscard]] bool release(void* payload) noexcept;
    void reset() noexcept;

    [[nodiscard]] std::size_t capacity() const noexcept;
    [[nodiscard]] const wildfire::memory::AllocationTelemetry& telemetry() const noexcept;
    void reset_telemetry() noexcept;

private:
    wildfire::memory::AllocationTelemetry telemetry_;
    wildfire::memory::ExactAllocation allocation_;
};

class DecodedStorage {
public:
    DecodedStorage() noexcept;

    [[nodiscard]] std::span<float> replace(std::size_t float_count) noexcept;
    [[nodiscard]] bool release(std::uint32_t generation) noexcept;
    void reset() noexcept;

    [[nodiscard]] const float* data() const noexcept;
    [[nodiscard]] std::size_t float_count() const noexcept;
    [[nodiscard]] std::uint32_t generation() const noexcept;
    [[nodiscard]] std::size_t capacity() const noexcept;
    [[nodiscard]] const wildfire::memory::AllocationTelemetry& telemetry() const noexcept;
    void reset_telemetry() noexcept;

private:
    wildfire::memory::AllocationTelemetry telemetry_;
    wildfire::memory::ExactAllocation allocation_;
};

} // namespace wildfire::geosplat::storage
