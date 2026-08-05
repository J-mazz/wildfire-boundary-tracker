module;

#include <array>
#include <algorithm>
#include <cstddef>
#include <memory_resource>
#include <mutex>
#include <span>
#include <string_view>
#include <vector>

module wildfire.inference.scheduler;

import wildfire.core;

namespace wildfire::inference {

namespace {

constexpr std::size_t kPerJobStorageBytes = 512u;
constexpr std::size_t kSchedulerBaseBytes = 4096u;
constexpr std::size_t kMaximumErrorBytes = 255u;

} // namespace

CpuPartition partition_cpu_budget(
    const unsigned requested_workers,
    const std::size_t job_count,
    const unsigned detected_threads
) {
    CpuPartition partition;
    partition.total_threads = std::max(1u, detected_threads);
    const std::size_t workers = std::min({
        static_cast<std::size_t>(std::max(1u, requested_workers)),
        job_count,
        static_cast<std::size_t>(partition.total_threads),
        partition.extractor_threads.size()
    });
    partition.active_workers = static_cast<unsigned>(workers);
    if (workers == 0u) return partition;

    const unsigned base = partition.total_threads / static_cast<unsigned>(workers);
    const unsigned remainder = partition.total_threads % static_cast<unsigned>(workers);
    for (std::size_t index = 0u; index < workers; ++index) {
        partition.extractor_threads[index] = base + (index < remainder ? 1u : 0u);
    }
    return partition;
}

bool scheduler_storage_bytes(
    const std::size_t job_count,
    std::size_t& bytes
) noexcept {
    std::size_t job_bytes{};
    return wildfire::core::checked_multiply(job_count, kPerJobStorageBytes, job_bytes)
        && wildfire::core::checked_add(job_bytes, kSchedulerBaseBytes, bytes);
}

int batch_exit_code(const std::size_t failure_count) noexcept {
    return failure_count == 0u ? 0 : 6;
}

BoundedJobQueue::BoundedJobQueue(
    const std::size_t capacity,
    std::pmr::memory_resource& resource
) : jobs_(&resource), capacity_(capacity) {
    jobs_.reserve(capacity_);
}

bool BoundedJobQueue::try_push(const std::size_t job) {
    std::lock_guard lock(mutex_);
    if (jobs_.size() >= capacity_) return false;
    jobs_.push_back(job);
    return true;
}

bool BoundedJobQueue::try_pop(std::size_t& job) {
    std::lock_guard lock(mutex_);
    if (head_ >= jobs_.size()) return false;
    job = jobs_[head_++];
    return true;
}

std::size_t BoundedJobQueue::capacity() const noexcept {
    return capacity_;
}

std::size_t BoundedJobQueue::size() const noexcept {
    std::lock_guard lock(mutex_);
    return jobs_.size() - head_;
}

JobReport::JobReport(std::pmr::memory_resource* const resource)
    : error(resource) {
    error.reserve(kMaximumErrorBytes);
}

OrderedReports::OrderedReports(
    const std::size_t count,
    std::pmr::memory_resource& resource
) : resource_(&resource), reports_(&resource) {
    reports_.reserve(count);
    for (std::size_t index = 0u; index < count; ++index) {
        reports_.emplace_back(resource_);
    }
}

bool OrderedReports::record(
    const std::size_t index,
    const int status,
    const std::string_view error
) {
    std::lock_guard lock(mutex_);
    if (index >= reports_.size()) return false;
    reports_[index].status = status;
    reports_[index].error.assign(error.substr(0u, kMaximumErrorBytes));
    return true;
}

std::span<const JobReport> OrderedReports::values() const noexcept {
    return reports_;
}

} // namespace wildfire::inference
