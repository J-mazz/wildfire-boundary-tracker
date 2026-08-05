#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

extern "C" {
std::uint8_t* firms_input();
std::uint32_t firms_input_capacity();
void firms_reset();
int firms_ingest_csv(std::uint32_t byte_length);
std::uint32_t firms_finalize(
    double west,
    double south,
    double east,
    double north,
    double padding_degrees,
    double max_span_degrees
);
void firms_benchmark_reset_telemetry();
std::size_t firms_benchmark_working_set_high_water();
std::size_t firms_benchmark_reserved_storage_bytes();
}

namespace {

std::string make_csv(const std::size_t records) {
    std::ostringstream csv;
    csv << "latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,bright_ti4,bright_ti5,daynight\n";
    const std::size_t unique = std::max<std::size_t>(1u, records * 7u / 8u);
    for (std::size_t index = 0u; index < records; ++index) {
        const std::size_t value = index % unique;
        const double latitude = 30.0 + static_cast<double>(value % 500u) / 100.0;
        const double longitude = -125.0 + static_cast<double>(value % 700u) / 100.0;
        const unsigned time = static_cast<unsigned>(value % 1440u);
        csv << latitude << ',' << longitude << ",2026-08-01,"
            << std::setfill('0') << std::setw(2) << time / 60u
            << std::setw(2) << time % 60u << std::setfill(' ')
            << ",N,VIIRS,n,12.5,336.2,300.5,D\n";
    }
    return csv.str();
}

bool run_once(const std::string& csv, const std::size_t expected_rows) {
    firms_reset();
    std::memcpy(firms_input(), csv.data(), csv.size());
    const int ingested = firms_ingest_csv(static_cast<std::uint32_t>(csv.size()));
    if (ingested != static_cast<int>(expected_rows)) return false;
    const std::uint32_t finalized = firms_finalize(-126.0, 29.0, -117.0, 36.0, 0.02, 12.0);
    return finalized != 0u && finalized <= expected_rows;
}

} // namespace

int main(const int argc, char** argv) {
    const std::size_t records = argc > 1 ? std::stoul(argv[1]) : 8192u;
    const std::size_t iterations = argc > 2 ? std::stoul(argv[2]) : 30u;
    const std::string csv = make_csv(records);
    if (csv.size() > firms_input_capacity()) {
        std::cerr << "benchmark CSV exceeds FIRMS input capacity\n";
        return 2;
    }

    if (!run_once(csv, records)) return 3;
    firms_benchmark_reset_telemetry();
    const auto start = std::chrono::steady_clock::now();
    for (std::size_t iteration = 0u; iteration < iterations; ++iteration) {
        if (!run_once(csv, records)) return 3;
    }
    const auto finish = std::chrono::steady_clock::now();
    const double seconds = std::chrono::duration<double>(finish - start).count();
    const double throughput = static_cast<double>(records * iterations) / seconds;

    std::cout << std::fixed << std::setprecision(3)
              << "{\"benchmark\":\"firms_parse_sort_dedupe\""
              << ",\"items\":" << records * iterations
              << ",\"iterations\":" << iterations
              << ",\"elapsed_ms\":" << seconds * 1000.0
              << ",\"throughput_items_per_second\":" << throughput
              << ",\"working_set_high_water_bytes\":" << firms_benchmark_working_set_high_water()
              << ",\"reserved_storage_bytes\":" << firms_benchmark_reserved_storage_bytes()
              << ",\"input_bytes\":" << csv.size()
              << "}\n";
}
