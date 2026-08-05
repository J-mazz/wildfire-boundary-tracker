module;

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <span>

module wildfire.geosplat.storage;

import wildfire.core;
import wildfire.geosplat.format;
import wildfire.memory;

namespace wildfire::geosplat::storage {
namespace {

void* allocate_bytes(const std::size_t bytes) noexcept {
    return std::malloc(bytes);
}

void release_bytes(void* const allocation) noexcept {
    std::free(allocation);
}

} // namespace

PayloadStorage::PayloadStorage() noexcept
    : allocation_(
        format::kMaxPayloadBytes, allocate_bytes, release_bytes, &telemetry_
    ) {}

void* PayloadStorage::allocate(const std::size_t bytes) noexcept {
    return allocation_.acquire(bytes);
}

bool PayloadStorage::release(void* const payload) noexcept {
    if (payload == nullptr || payload != allocation_.data()) return false;
    return allocation_.release(allocation_.generation());
}

void PayloadStorage::reset() noexcept {
    allocation_.reset();
}

std::size_t PayloadStorage::capacity() const noexcept {
    return allocation_.byte_limit();
}

const wildfire::memory::AllocationTelemetry&
PayloadStorage::telemetry() const noexcept {
    return telemetry_;
}

void PayloadStorage::reset_telemetry() noexcept {
    telemetry_.reset();
}

DecodedStorage::DecodedStorage() noexcept
    : allocation_(
        format::kMaxDecodedBytes, allocate_bytes, release_bytes, &telemetry_
    ) {}

std::span<float> DecodedStorage::replace(
    const std::size_t float_count
) noexcept {
    std::size_t bytes{};
    if (!wildfire::core::checked_multiply(float_count, sizeof(float), bytes)) return {};
    auto* const output = static_cast<float*>(allocation_.replace(bytes));
    return output == nullptr ? std::span<float>{} : std::span(output, float_count);
}

bool DecodedStorage::release(const std::uint32_t generation) noexcept {
    return allocation_.release(generation);
}

void DecodedStorage::reset() noexcept {
    allocation_.reset();
}

const float* DecodedStorage::data() const noexcept {
    return static_cast<const float*>(allocation_.data());
}

std::size_t DecodedStorage::float_count() const noexcept {
    return allocation_.size() / sizeof(float);
}

std::uint32_t DecodedStorage::generation() const noexcept {
    return allocation_.generation();
}

std::size_t DecodedStorage::capacity() const noexcept {
    return allocation_.byte_limit();
}

const wildfire::memory::AllocationTelemetry&
DecodedStorage::telemetry() const noexcept {
    return telemetry_;
}

void DecodedStorage::reset_telemetry() noexcept {
    telemetry_.reset();
}

} // namespace wildfire::geosplat::storage
