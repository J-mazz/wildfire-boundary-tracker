module wildfire.memory;

import std;

namespace wildfire::memory {

namespace {

constexpr std::size_t kNoBlock = std::numeric_limits<std::size_t>::max();

std::size_t allocation_size(const std::size_t requested) noexcept {
    return std::max<std::size_t>(requested, 1u);
}

} // namespace

void AllocationTelemetry::record_allocation(const std::size_t bytes) noexcept {
    ++allocation_count_;
    current_bytes_ += bytes;
    high_water_bytes_ = std::max(high_water_bytes_, current_bytes_);
}

void AllocationTelemetry::record_release(const std::size_t bytes) noexcept {
    current_bytes_ = bytes > current_bytes_ ? 0u : current_bytes_ - bytes;
}

void AllocationTelemetry::record_failure() noexcept {
    ++failed_allocation_count_;
}

void AllocationTelemetry::reset() noexcept {
    current_bytes_ = 0u;
    high_water_bytes_ = 0u;
    allocation_count_ = 0u;
    failed_allocation_count_ = 0u;
}

std::size_t AllocationTelemetry::current_bytes() const noexcept {
    return current_bytes_;
}

std::size_t AllocationTelemetry::high_water_bytes() const noexcept {
    return high_water_bytes_;
}

std::size_t AllocationTelemetry::allocation_count() const noexcept {
    return allocation_count_;
}

std::size_t AllocationTelemetry::failed_allocation_count() const noexcept {
    return failed_allocation_count_;
}

BoundedArena::BoundedArena(
    const std::span<std::byte> storage,
    AllocationTelemetry* const telemetry
) noexcept
    : storage_(storage), telemetry_(telemetry) {}

void* BoundedArena::allocate(
    const std::size_t bytes,
    const std::size_t alignment
) noexcept {
    if (!wildfire::core::is_power_of_two(alignment)) {
        if (telemetry_ != nullptr) telemetry_->record_failure();
        return nullptr;
    }
    const auto base = reinterpret_cast<std::uintptr_t>(storage_.data());
    const std::size_t misalignment = (base + offset_) & (alignment - 1u);
    const std::size_t padding = misalignment == 0u ? 0u : alignment - misalignment;
    std::size_t start{};
    std::size_t finish{};
    const std::size_t consumed = allocation_size(bytes);
    if (!wildfire::core::checked_add(offset_, padding, start)
        || !wildfire::core::checked_add(start, consumed, finish)
        || finish > storage_.size()) {
        if (telemetry_ != nullptr) telemetry_->record_failure();
        return nullptr;
    }
    offset_ = finish;
    high_water_ = std::max(high_water_, offset_);
    live_bytes_ += consumed;
    if (telemetry_ != nullptr) telemetry_->record_allocation(consumed);
    return storage_.data() + start;
}

void BoundedArena::reset() noexcept {
    if (telemetry_ != nullptr) telemetry_->record_release(live_bytes_);
    offset_ = 0u;
    live_bytes_ = 0u;
}

std::size_t BoundedArena::capacity() const noexcept {
    return storage_.size();
}

std::size_t BoundedArena::used() const noexcept {
    return offset_;
}

std::size_t BoundedArena::remaining() const noexcept {
    return storage_.size() - offset_;
}

std::size_t BoundedArena::high_water() const noexcept {
    return high_water_;
}

ExactAllocation::ExactAllocation(
    const std::size_t byte_limit,
    const AllocateFunction allocate,
    const DeallocateFunction deallocate,
    AllocationTelemetry* const telemetry
) noexcept
    : allocate_(allocate),
      deallocate_(deallocate),
      telemetry_(telemetry),
      byte_limit_(byte_limit) {}

ExactAllocation::~ExactAllocation() {
    reset();
}

bool ExactAllocation::valid_request(const std::size_t bytes) noexcept {
    const bool valid = bytes != 0u && bytes <= byte_limit_
        && allocate_ != nullptr && deallocate_ != nullptr;
    if (!valid && telemetry_ != nullptr) telemetry_->record_failure();
    return valid;
}

void ExactAllocation::advance_generation() noexcept {
    ++generation_;
    if (generation_ == 0u) ++generation_;
}

void* ExactAllocation::acquire(const std::size_t bytes) noexcept {
    if (data_ != nullptr || !valid_request(bytes)) {
        if (data_ != nullptr && telemetry_ != nullptr) telemetry_->record_failure();
        return nullptr;
    }
    data_ = allocate_(bytes);
    if (data_ == nullptr) {
        if (telemetry_ != nullptr) telemetry_->record_failure();
        return nullptr;
    }
    size_ = bytes;
    advance_generation();
    if (telemetry_ != nullptr) telemetry_->record_allocation(bytes);
    return data_;
}

void* ExactAllocation::replace(const std::size_t bytes) noexcept {
    if (!valid_request(bytes)) return nullptr;
    reset();
    void* const replacement = allocate_(bytes);
    if (replacement == nullptr) {
        if (telemetry_ != nullptr) telemetry_->record_failure();
        return nullptr;
    }
    if (telemetry_ != nullptr) telemetry_->record_allocation(bytes);
    data_ = replacement;
    size_ = bytes;
    advance_generation();
    return data_;
}

bool ExactAllocation::release(const std::uint32_t generation) noexcept {
    if (data_ == nullptr || generation == 0u || generation != generation_) return false;
    reset();
    return true;
}

void ExactAllocation::reset() noexcept {
    if (data_ == nullptr) return;
    if (telemetry_ != nullptr) telemetry_->record_release(size_);
    deallocate_(data_);
    data_ = nullptr;
    size_ = 0u;
    advance_generation();
}

void* ExactAllocation::data() const noexcept {
    return data_;
}

std::size_t ExactAllocation::size() const noexcept {
    return size_;
}

std::size_t ExactAllocation::byte_limit() const noexcept {
    return byte_limit_;
}

std::uint32_t ExactAllocation::generation() const noexcept {
    return generation_;
}

ArenaResource::ArenaResource(BoundedArena& arena) noexcept
    : arena_(&arena) {}

void* ArenaResource::do_allocate(
    const std::size_t bytes,
    const std::size_t alignment
) {
    void* const allocation = arena_->allocate(bytes, alignment);
    if (allocation == nullptr) throw std::bad_alloc{};
    return allocation;
}

void ArenaResource::do_deallocate(void*, std::size_t, std::size_t) {}

bool ArenaResource::do_is_equal(
    const std::pmr::memory_resource& other
) const noexcept {
    return this == &other;
}

SlabPool::SlabPool(
    const std::span<std::byte> storage,
    const std::size_t block_size,
    const std::size_t block_alignment,
    AllocationTelemetry* const telemetry
) noexcept
    : telemetry_(telemetry), free_head_(kNoBlock) {
    if (configure(storage, block_size, block_alignment)) reset();
}

bool SlabPool::configure(
    const std::span<std::byte> storage,
    const std::size_t block_size,
    const std::size_t block_alignment
) noexcept {
    if (storage.empty() || block_size == 0u
        || !wildfire::core::is_power_of_two(block_alignment)) return false;
    std::size_t stride{};
    const std::size_t payload = std::max(block_size, sizeof(std::size_t));
    if (!wildfire::core::checked_align_up(payload, block_alignment, stride)) return false;

    const auto address = reinterpret_cast<std::uintptr_t>(storage.data());
    const std::size_t misalignment = address & (block_alignment - 1u);
    const std::size_t padding = misalignment == 0u ? 0u : block_alignment - misalignment;
    if (padding > storage.size()) return false;

    storage_ = storage.data() + padding;
    block_size_ = block_size;
    stride_ = stride;
    capacity_blocks_ = (storage.size() - padding) / stride_;
    return capacity_blocks_ != 0u;
}

void* SlabPool::allocate() noexcept {
    if (free_head_ == kNoBlock) {
        if (telemetry_ != nullptr) telemetry_->record_failure();
        return nullptr;
    }
    const std::size_t index = free_head_;
    free_head_ = read_next(index);
    ++used_blocks_;
    high_water_blocks_ = std::max(high_water_blocks_, used_blocks_);
    if (telemetry_ != nullptr) telemetry_->record_allocation(block_size_);
    return block_at(index);
}

bool SlabPool::deallocate(void* const block) noexcept {
    if (block == nullptr || storage_ == nullptr) return false;
    auto* const bytes = static_cast<std::byte*>(block);
    if (bytes < storage_ || bytes >= storage_ + stride_ * capacity_blocks_) return false;
    const std::size_t distance = static_cast<std::size_t>(bytes - storage_);
    if (distance % stride_ != 0u) return false;
    const std::size_t index = distance / stride_;
    if (is_free(index)) return false;
    write_next(index, free_head_);
    free_head_ = index;
    --used_blocks_;
    if (telemetry_ != nullptr) telemetry_->record_release(block_size_);
    return true;
}

void SlabPool::reset() noexcept {
    if (telemetry_ != nullptr) telemetry_->record_release(used_blocks_ * block_size_);
    used_blocks_ = 0u;
    free_head_ = capacity_blocks_ == 0u ? kNoBlock : 0u;
    for (std::size_t index = 0u; index < capacity_blocks_; ++index) {
        const std::size_t next = index + 1u < capacity_blocks_ ? index + 1u : kNoBlock;
        write_next(index, next);
    }
}

std::size_t SlabPool::block_size() const noexcept {
    return block_size_;
}

std::size_t SlabPool::capacity_blocks() const noexcept {
    return capacity_blocks_;
}

std::size_t SlabPool::used_blocks() const noexcept {
    return used_blocks_;
}

std::size_t SlabPool::high_water_blocks() const noexcept {
    return high_water_blocks_;
}

bool SlabPool::is_free(const std::size_t index) const noexcept {
    std::size_t cursor = free_head_;
    while (cursor != kNoBlock) {
        if (cursor == index) return true;
        cursor = read_next(cursor);
    }
    return false;
}

void SlabPool::write_next(
    const std::size_t index,
    const std::size_t next
) noexcept {
    std::memcpy(block_at(index), &next, sizeof(next));
}

std::size_t SlabPool::read_next(const std::size_t index) const noexcept {
    std::size_t next{};
    std::memcpy(&next, block_at(index), sizeof(next));
    return next;
}

std::byte* SlabPool::block_at(const std::size_t index) const noexcept {
    return storage_ + index * stride_;
}

} // namespace wildfire::memory
