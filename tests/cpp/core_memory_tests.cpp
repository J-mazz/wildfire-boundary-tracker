#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory_resource>
#include <new>
#include <span>
#include <vector>

import wildfire.core;
import wildfire.memory;

namespace {

void test_checked_arithmetic() {
    std::size_t result{};
    assert(wildfire::core::checked_add(4u, 5u, result) && result == 9u);
    assert(!wildfire::core::checked_add(
        std::numeric_limits<std::size_t>::max(),
        1u,
        result
    ));
    assert(wildfire::core::checked_multiply(7u, 9u, result) && result == 63u);
    assert(!wildfire::core::checked_multiply(
        std::numeric_limits<std::size_t>::max(),
        2u,
        result
    ));
    assert(wildfire::core::checked_align_up(17u, 16u, result) && result == 32u);
    assert(!wildfire::core::checked_align_up(17u, 3u, result));
}

void test_little_endian_reader() {
    constexpr std::array bytes{
        std::byte{0x34}, std::byte{0x12},
        std::byte{0x78}, std::byte{0x56}, std::byte{0x34}, std::byte{0x12},
        std::byte{0x00}, std::byte{0x00}, std::byte{0x20}, std::byte{0x41}
    };
    wildfire::core::BoundedReader reader(bytes);
    std::uint16_t short_value{};
    std::uint32_t word_value{};
    float float_value{};
    assert(reader.read_u16_le(short_value) && short_value == 0x1234u);
    assert(reader.read_u32_le(word_value) && word_value == 0x12345678u);
    assert(reader.read_f32_le(float_value) && float_value == 10.0f);
    assert(reader.remaining() == 0u);
    assert(!reader.read_u16_le(short_value));
    assert(reader.position() == bytes.size());
}

void test_arena_alignment_exhaustion_and_reset() {
    alignas(64) std::array<std::byte, 128> storage{};
    wildfire::memory::AllocationTelemetry telemetry;
    wildfire::memory::BoundedArena arena(storage, &telemetry);

    void* const first = arena.allocate(7u, 8u);
    void* const second = arena.allocate(16u, 32u);
    assert(first != nullptr && reinterpret_cast<std::uintptr_t>(first) % 8u == 0u);
    assert(second != nullptr && reinterpret_cast<std::uintptr_t>(second) % 32u == 0u);
    assert(arena.allocate(256u) == nullptr);
    assert(arena.allocate(1u, 3u) == nullptr);
    assert(telemetry.allocation_count() == 2u);
    assert(telemetry.failed_allocation_count() == 2u);
    assert(telemetry.high_water_bytes() == 23u);
    const std::size_t high_water = arena.high_water();

    arena.reset();
    assert(arena.used() == 0u);
    assert(arena.high_water() == high_water);
    assert(telemetry.current_bytes() == 0u);
    assert(arena.allocate(7u, 8u) == first);
}

void test_pmr_adapter() {
    alignas(64) std::array<std::byte, 256> storage{};
    wildfire::memory::BoundedArena arena(storage);
    wildfire::memory::ArenaResource resource(arena);
    std::pmr::vector<std::uint32_t> values(&resource);
    values.reserve(16u);
    values.push_back(42u);
    assert(values.front() == 42u);

    bool exhausted = false;
    try {
        values.reserve(1024u);
    } catch (const std::bad_alloc&) {
        exhausted = true;
    }
    assert(exhausted);
}

void test_slab_pool() {
    alignas(64) std::array<std::byte, 256> storage{};
    wildfire::memory::AllocationTelemetry telemetry;
    wildfire::memory::SlabPool pool(storage, 24u, 16u, &telemetry);
    assert(pool.capacity_blocks() == 8u);

    std::array<void*, 8> blocks{};
    for (void*& block : blocks) {
        block = pool.allocate();
        assert(block != nullptr);
        assert(reinterpret_cast<std::uintptr_t>(block) % 16u == 0u);
    }
    assert(pool.allocate() == nullptr);
    assert(pool.high_water_blocks() == blocks.size());
    assert(telemetry.failed_allocation_count() == 1u);

    assert(pool.deallocate(blocks[3]));
    assert(!pool.deallocate(blocks[3]));
    assert(!pool.deallocate(static_cast<std::byte*>(blocks[0]) + 1));
    assert(pool.allocate() == blocks[3]);
    pool.reset();
    assert(pool.used_blocks() == 0u);
    assert(telemetry.current_bytes() == 0u);
}

void test_invalid_slab_configuration() {
    std::array<std::byte, 32> storage{};
    wildfire::memory::SlabPool empty_pool({}, 8u, 8u);
    wildfire::memory::SlabPool zero_block_pool(storage, 0u, 8u);
    wildfire::memory::SlabPool invalid_alignment_pool(storage, 8u, 3u);
    assert(empty_pool.capacity_blocks() == 0u);
    assert(zero_block_pool.capacity_blocks() == 0u);
    assert(invalid_alignment_pool.capacity_blocks() == 0u);
    assert(empty_pool.allocate() == nullptr);
    assert(zero_block_pool.allocate() == nullptr);
    assert(invalid_alignment_pool.allocate() == nullptr);
}

void test_target_layouts() {
    constexpr auto worker = wildfire::memory::target_memory_layout(
        wildfire::memory::TargetKind::worker_wasm
    );
    constexpr auto browser = wildfire::memory::target_memory_layout(
        wildfire::memory::TargetKind::browser_wasm
    );
    constexpr auto native = wildfire::memory::target_memory_layout(
        wildfire::memory::TargetKind::native_ncnn
    );
    static_assert(worker.arena_bytes < browser.arena_bytes);
    static_assert(browser.arena_bytes < native.arena_bytes);
    static_assert(native.slab_alignment == 64u);
}

} // namespace

int main() {
    test_checked_arithmetic();
    test_little_endian_reader();
    test_arena_alignment_exhaustion_and_reset();
    test_pmr_adapter();
    test_slab_pool();
    test_invalid_slab_configuration();
    test_target_layouts();
}
