module;

#include <array>
#include <cstddef>
#include <memory_resource>
#include <mutex>
#include <span>
#include <string>
#include <string_view>
#include <vector>

export module wildfire.inference.scheduler;

export namespace wildfire::inference {

struct CpuPartition {
    unsigned total_threads{};
    unsigned active_workers{};
    std::array<unsigned, 32> extractor_threads{};

    [[nodiscard]] unsigned worker_count() const noexcept {
        return active_workers;
    }
};

[[nodiscard]] CpuPartition partition_cpu_budget(
    unsigned requested_workers,
    std::size_t job_count,
    unsigned detected_threads
);
[[nodiscard]] bool scheduler_storage_bytes(
    std::size_t job_count,
    std::size_t& bytes
) noexcept;
[[nodiscard]] int batch_exit_code(std::size_t failure_count) noexcept;

class BoundedJobQueue {
public:
    BoundedJobQueue(
        std::size_t capacity,
        std::pmr::memory_resource& resource
    );

    BoundedJobQueue(const BoundedJobQueue&) = delete;
    BoundedJobQueue& operator=(const BoundedJobQueue&) = delete;

    [[nodiscard]] bool try_push(std::size_t job);
    [[nodiscard]] bool try_pop(std::size_t& job);
    [[nodiscard]] std::size_t capacity() const noexcept;
    [[nodiscard]] std::size_t size() const noexcept;

private:
    mutable std::mutex mutex_;
    std::pmr::vector<std::size_t> jobs_;
    std::size_t capacity_{};
    std::size_t head_{};
};

struct JobReport {
    int status{};
    std::pmr::string error;

    explicit JobReport(std::pmr::memory_resource* resource);
};

class OrderedReports {
public:
    OrderedReports(
        std::size_t count,
        std::pmr::memory_resource& resource
    );

    OrderedReports(const OrderedReports&) = delete;
    OrderedReports& operator=(const OrderedReports&) = delete;

    [[nodiscard]] bool record(
        std::size_t index,
        int status,
        std::string_view error
    );
    [[nodiscard]] std::span<const JobReport> values() const noexcept;

private:
    std::pmr::memory_resource* resource_;
    mutable std::mutex mutex_;
    std::pmr::vector<JobReport> reports_;
};

} // namespace wildfire::inference
