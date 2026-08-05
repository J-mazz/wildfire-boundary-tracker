#include "boundary_fixtures.hpp"

#include <cassert>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <string_view>

import wildfire.firms.engine;
import wildfire.memory;

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
const void* firms_records();
std::uint32_t firms_count();
std::uint32_t firms_record_stride();
double firms_bound(std::uint32_t index);
std::int64_t* firms_query_frames();
std::uint32_t firms_query_frame_capacity();
std::uint32_t firms_query_frame_stride();
const void* firms_query_results();
std::uint32_t firms_query_result_count();
std::uint32_t firms_query_result_stride();
std::int32_t firms_query_coverage(std::uint32_t frame_count, std::uint32_t persistence_hours);
std::int32_t firms_query_range(std::uint32_t persistence_hours);
}

namespace {

struct DetectionRecord {
    double latitude;
    double longitude;
    std::int64_t observed_at_ms;
    float frp_mw;
    float brightness_i4_k;
    float brightness_i5_k;
    char satellite[8];
    char instrument[8];
    char confidence[8];
    char day_night[2];
    std::uint8_t padding[2];
};

static_assert(sizeof(DetectionRecord) == 64u);
static_assert(offsetof(DetectionRecord, observed_at_ms) == 16u);
static_assert(offsetof(DetectionRecord, satellite) == 36u);
static_assert(offsetof(DetectionRecord, day_night) == 60u);

int ingest(const std::string_view csv) {
    assert(csv.size() <= firms_input_capacity());
    std::memcpy(firms_input(), csv.data(), csv.size());
    return firms_ingest_csv(static_cast<std::uint32_t>(csv.size()));
}

void test_input_contract() {
    firms_reset();
    assert(firms_input() != nullptr);
    assert(firms_input_capacity() == 8u * 1024u * 1024u);
    assert(firms_record_stride() == sizeof(DetectionRecord));
    assert(firms_ingest_csv(0u) == -1);
    assert(firms_ingest_csv(firms_input_capacity() + 1u) == -1);
    assert(firms_count() == 0u);
}

void test_header_validation() {
    firms_reset();
    assert(ingest("Exceeded transaction limit") == -2);
    assert(firms_count() == 0u);
    firms_reset();
    assert(ingest("latitude,longitude\n42,-116") == -2);
}

void test_quoted_crlf_and_reordered_columns() {
    constexpr std::string_view csv =
        "\"satellite\",\"acq_time\",\"longitude\",\"acq_date\",\"latitude\",\"frp\",\"instrument\"\r\n"
        "\"N\"\"20\",\"0001\",\"-116.5\",\"2000-02-29\",\"42.5\",\"12.5\",\"VIIRS\"\r\n";
    firms_reset();
    assert(ingest(csv) == 1);
    const auto* records = static_cast<const DetectionRecord*>(firms_records());
    assert(records[0].latitude == 42.5);
    assert(records[0].longitude == -116.5);
    assert(records[0].frp_mw == 12.5f);
    assert(std::strcmp(records[0].satellite, "N\"20") == 0);
    assert(std::strcmp(records[0].instrument, "VIIRS") == 0);
    assert(std::isnan(records[0].brightness_i4_k));
}

void test_malformed_quotes_and_sparse_rows() {
    firms_reset();
    assert(ingest(
        "latitude,longitude,acq_date,acq_time,satellite,frp\n"
        "\"42\",\"-116\",\"2026-01-01\",\"0000\n"
        "42,-116,2026-01-01,0000\n"
    ) == 1);
    const auto* records = static_cast<const DetectionRecord*>(firms_records());
    assert(records[0].satellite[0] == '\0');
    assert(std::isnan(records[0].frp_mw));

    firms_reset();
    assert(ingest(
        "\"latitude,longitude,acq_date,acq_time\n"
        "42,-116,2026-01-01,0000\n"
    ) == -2);
}

void test_numeric_and_gregorian_boundaries() {
    constexpr std::string_view csv =
        "latitude,longitude,acq_date,acq_time,frp,satellite\n"
        "0,0,2000-02-29,2359,999999999999999999999999999999999999999,N\n"
        "0,0,1900-02-29,0000,1,N\n"
        "999999999999999999999999999999999999999999999999,0,2028-02-29,0000,1,N\n"
        "0,0,2028-02-29,42949672960,1,N\n";
    firms_reset();
    assert(ingest(csv) == 1);
    const auto* records = static_cast<const DetectionRecord*>(firms_records());
    assert(std::isnan(records[0].frp_mw));
    assert(records[0].observed_at_ms == 951868740000LL);
}

void test_boundary_rows_sort_and_dedupe() {
    firms_reset();
    assert(ingest(wildfire::tests::fixtures::firms_boundary_csv) == 3);
    assert(firms_finalize(-1.0, -1.0, 1.0, 1.0, 0.0, 360.0) == 2u);
    assert(firms_count() == 2u);

    const auto* records = static_cast<const DetectionRecord*>(firms_records());
    assert(records[0].latitude == -90.0);
    assert(records[0].longitude == -180.0);
    assert(std::strcmp(records[0].satellite, "N") == 0);
    assert(records[1].latitude == 90.0);
    assert(records[1].longitude == 180.0);
    assert(std::strcmp(records[1].satellite, "N20") == 0);
    assert(records[1].frp_mw == 1.5f);
    assert(std::isnan(firms_bound(4u)));
}

void test_invalid_boundary_rows() {
    firms_reset();
    assert(ingest(wildfire::tests::fixtures::firms_invalid_csv) == 0);
    assert(firms_count() == 0u);
}

void test_sort_identity_includes_satellite() {
    constexpr std::string_view csv =
        "latitude,longitude,acq_date,acq_time,satellite\n"
        "42,-116,2026-08-01,1200,Z\n"
        "42,-116,2026-08-01,1200,A\n"
        "42,-116,2026-08-01,1200,A\n";
    firms_reset();
    assert(ingest(csv) == 3);
    assert(firms_finalize(-117.0, 41.0, -115.0, 43.0, 0.1, 4.0) == 2u);
    const auto* records = static_cast<const DetectionRecord*>(firms_records());
    assert(std::strcmp(records[0].satellite, "A") == 0);
    assert(std::strcmp(records[1].satellite, "Z") == 0);
    assert(firms_bound(2u) - firms_bound(0u) <= 4.0);
    assert(firms_bound(3u) - firms_bound(1u) <= 4.0);
}

void test_record_capacity_and_reset() {
    std::string csv = "latitude,longitude,acq_date,acq_time\n";
    constexpr std::string_view row = "0,0,2028-02-29,0000\n";
    csv.reserve(csv.size() + row.size() * wildfire::firms::kRecordCapacity);
    for (std::uint32_t index = 0u; index < wildfire::firms::kRecordCapacity; ++index) {
        csv.append(row);
    }
    assert(csv.size() < firms_input_capacity());

    firms_reset();
    assert(ingest(csv) == static_cast<int>(wildfire::firms::kRecordCapacity));
    assert(ingest(
        "latitude,longitude,acq_date,acq_time\n"
        "1,1,2028-02-29,0001\n"
    ) == -3);
    firms_reset();
    assert(firms_count() == 0u);
    assert(ingest(
        "latitude,longitude,acq_date,acq_time\n"
        "1,1,2028-02-29,0001\n"
    ) == 1);
}

void test_allocator_exhaustion_is_explicit() {
    alignas(16) std::array<std::byte, 1024u> storage{};
    wildfire::memory::AllocationTelemetry telemetry;
    wildfire::memory::BoundedArena arena{storage, &telemetry};
    wildfire::firms::EngineState state{arena};
    assert(!state.ready());
    assert(state.input() == nullptr);
    assert(state.records() == nullptr);
    assert(telemetry.failed_allocation_count() == 1u);
    assert(wildfire::firms::ingest_csv(state, 1u) == -1);
    assert(wildfire::firms::finalize(
        state,
        -1.0,
        -2.0,
        3.0,
        4.0,
        0.1,
        360.0
    ) == 0u);
    assert(state.bounds()[0] == -1.0);
    assert(state.bounds()[1] == -2.0);
    assert(state.bounds()[2] == 3.0);
    assert(state.bounds()[3] == 4.0);
    state.reset();
    assert(state.count() == 0u);
}

void test_timeline_query_abi() {
    constexpr std::string_view csv =
        "latitude,longitude,acq_date,acq_time,satellite\n"
        "42,-116,2026-07-18,1200,N\n"
        "43,-117,2026-07-25,1200,N\n"
        "44,-118,2026-07-25,1230,N\n"
        "45,-119,2026-07-25,1500,N\n";
    firms_reset();
    assert(ingest(csv) == 4);
    assert(firms_finalize(-120.0, 40.0, -115.0, 46.0, 0.0, 360.0) == 4u);
    assert(firms_query_frame_capacity() == wildfire::firms::kTimelineQueryCapacity);
    assert(firms_query_frame_stride() == sizeof(std::int64_t));
    assert(firms_query_result_stride() == sizeof(wildfire::firms::TimelineQueryResult));

    std::int64_t* const frames = firms_query_frames();
    frames[0] = 1'784'980'800'000LL;
    assert(firms_query_range(168u) == 1);
    assert(firms_query_result_count() == 1u);
    const auto* results = static_cast<const wildfire::firms::TimelineQueryResult*>(
        firms_query_results()
    );
    assert(results[0].begin_index == 0u);
    assert(results[0].feature_count == 3u);
    assert(results[0].newest_observed_at_ms == 1'784'982'600'000LL);

    frames[0] = 1'784'970'000'000LL;
    frames[1] = 1'784'980'800'000LL;
    assert(firms_query_coverage(2u, 168u) == 2);
    assert(firms_query_result_count() == 2u);
    assert(results[0].feature_count == 1u);
    assert(results[1].feature_count == 3u);
    assert(firms_query_coverage(firms_query_frame_capacity() + 1u, 168u) == -3);
}

} // namespace

int main() {
    test_input_contract();
    test_header_validation();
    test_quoted_crlf_and_reordered_columns();
    test_malformed_quotes_and_sparse_rows();
    test_numeric_and_gregorian_boundaries();
    test_boundary_rows_sort_and_dedupe();
    test_invalid_boundary_rows();
    test_sort_identity_includes_satellite();
    test_record_capacity_and_reset();
    test_allocator_exhaustion_is_explicit();
    test_timeline_query_abi();
}
