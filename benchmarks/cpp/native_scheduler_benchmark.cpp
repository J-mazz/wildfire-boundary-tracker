#include <chrono>
#include <cstddef>
#include <iostream>
#include <memory_resource>
#include <thread>
#include <vector>

import wildfire.inference.scheduler;
import wildfire.memory;

int main() {
    constexpr std::size_t jobs = 65536u;
    std::size_t storage_bytes{};
    if (!wildfire::inference::scheduler_storage_bytes(jobs, storage_bytes)) return 1;
    std::vector<std::byte> storage(storage_bytes);
    wildfire::memory::AllocationTelemetry telemetry;
    wildfire::memory::BoundedArena arena(storage, &telemetry);
    wildfire::memory::ArenaResource resource(arena);
    wildfire::inference::BoundedJobQueue queue(jobs, resource);
    wildfire::inference::OrderedReports reports(jobs, resource);
    for (std::size_t index = 0u; index < jobs; ++index) {
        if (!queue.try_push(index)) return 1;
    }

    const auto partition = wildfire::inference::partition_cpu_budget(
        8u,
        jobs,
        std::thread::hardware_concurrency()
    );
    const auto started = std::chrono::steady_clock::now();
    std::pmr::vector<std::jthread> workers(&resource);
    workers.reserve(partition.worker_count());
    for (unsigned worker = 0u; worker < partition.worker_count(); ++worker) {
        workers.emplace_back([&]() {
            std::size_t index{};
            while (queue.try_pop(index)) {
                if (!reports.record(index, 0, {})) return;
            }
        });
    }
    workers.clear();
    const auto elapsed = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - started
    ).count();

    std::cout << "{\"benchmark\":\"native_scheduler\""
              << ",\"throughput_jobs_per_second\":" << static_cast<double>(jobs) / elapsed
              << ",\"allocation_count\":" << telemetry.allocation_count()
              << ",\"allocation_high_water_bytes\":" << telemetry.high_water_bytes()
              << ",\"reserved_storage_bytes\":" << storage.size()
              << ",\"worker_count\":" << partition.worker_count()
              << "}\n";
}
