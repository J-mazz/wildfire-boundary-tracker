#include "boundary_fixtures.hpp"

#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string_view>

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

} // namespace

int main() {
    test_input_contract();
    test_header_validation();
    test_boundary_rows_sort_and_dedupe();
    test_invalid_boundary_rows();
    test_sort_identity_includes_satellite();
}
