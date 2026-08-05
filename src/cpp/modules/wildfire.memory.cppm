module;

#include <cstddef>
#include <cstdint>
#include <memory_resource>
#include <span>

export module wildfire.memory;

import wildfire.core;

export namespace wildfire::memory {

class AllocationTelemetry {
public:
    void record_allocation(std::size_t bytes) noexcept;
    void record_release(std::size_t bytes) noexcept;
    void record_failure() noexcept;
    void reset() noexcept;

    [[nodiscard]] std::size_t current_bytes() const noexcept;
    [[nodiscard]] std::size_t high_water_bytes() const noexcept;
    [[nodiscard]] std::size_t allocation_count() const noexcept;
    [[nodiscard]] std::size_t failed_allocation_count() const noexcept;

private:
    std::size_t current_bytes_{};
    std::size_t high_water_bytes_{};
    std::size_t allocation_count_{};
    std::size_t failed_allocation_count_{};
};

class BoundedArena {
public:
    explicit BoundedArena(
        std::span<std::byte> storage,
        AllocationTelemetry* telemetry = nullptr
    ) noexcept;

    BoundedArena(const BoundedArena&) = delete;
    BoundedArena& operator=(const BoundedArena&) = delete;

    [[nodiscard]] void* allocate(
        std::size_t bytes,
        std::size_t alignment = alignof(std::max_align_t)
    ) noexcept;
    void reset() noexcept;

    [[nodiscard]] std::size_t capacity() const noexcept;
    [[nodiscard]] std::size_t used() const noexcept;
    [[nodiscard]] std::size_t remaining() const noexcept;
    [[nodiscard]] std::size_t high_water() const noexcept;

private:
    std::span<std::byte> storage_;
    AllocationTelemetry* telemetry_{};
    std::size_t offset_{};
    std::size_t high_water_{};
    std::size_t live_bytes_{};
};

class ArenaResource final : public std::pmr::memory_resource {
public:
    explicit ArenaResource(BoundedArena& arena) noexcept;

private:
    void* do_allocate(std::size_t bytes, std::size_t alignment) override;
    void do_deallocate(void*, std::size_t, std::size_t) override;
    [[nodiscard]] bool do_is_equal(
        const std::pmr::memory_resource& other
    ) const noexcept override;

    BoundedArena* arena_;
};

class SlabPool {
public:
    SlabPool(
        std::span<std::byte> storage,
        std::size_t block_size,
        std::size_t block_alignment,
        AllocationTelemetry* telemetry = nullptr
    ) noexcept;

    SlabPool(const SlabPool&) = delete;
    SlabPool& operator=(const SlabPool&) = delete;

    [[nodiscard]] void* allocate() noexcept;
    [[nodiscard]] bool deallocate(void* block) noexcept;
    void reset() noexcept;

    [[nodiscard]] std::size_t block_size() const noexcept;
    [[nodiscard]] std::size_t capacity_blocks() const noexcept;
    [[nodiscard]] std::size_t used_blocks() const noexcept;
    [[nodiscard]] std::size_t high_water_blocks() const noexcept;

private:
    [[nodiscard]] bool configure(
        std::span<std::byte> storage,
        std::size_t block_size,
        std::size_t block_alignment
    ) noexcept;
    [[nodiscard]] bool is_free(std::size_t index) const noexcept;
    void write_next(std::size_t index, std::size_t next) noexcept;
    [[nodiscard]] std::size_t read_next(std::size_t index) const noexcept;
    [[nodiscard]] std::byte* block_at(std::size_t index) const noexcept;

    std::byte* storage_{};
    AllocationTelemetry* telemetry_{};
    std::size_t block_size_{};
    std::size_t stride_{};
    std::size_t capacity_blocks_{};
    std::size_t used_blocks_{};
    std::size_t high_water_blocks_{};
    std::size_t free_head_{};
};

enum class TargetKind : std::uint8_t {
    host,
    worker_wasm,
    browser_wasm,
    native_ncnn
};

struct TargetMemoryLayout {
    std::size_t arena_bytes;
    std::size_t slab_storage_bytes;
    std::size_t slab_block_bytes;
    std::size_t slab_alignment;
    bool telemetry_enabled;
};

[[nodiscard]] constexpr TargetMemoryLayout target_memory_layout(
    const TargetKind target
) noexcept {
    switch (target) {
    case TargetKind::worker_wasm:
        return {8u * 1024u * 1024u, 2u * 1024u * 1024u, 256u, 16u, true};
    case TargetKind::browser_wasm:
        return {32u * 1024u * 1024u, 4u * 1024u * 1024u, 512u, 16u, true};
    case TargetKind::native_ncnn:
        return {64u * 1024u * 1024u, 8u * 1024u * 1024u, 4096u, 64u, true};
    case TargetKind::host:
    default:
        return {4u * 1024u * 1024u, 1u * 1024u * 1024u, 256u, 16u, true};
    }
}

} // namespace wildfire::memory
