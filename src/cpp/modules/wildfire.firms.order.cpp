module wildfire.firms.order;

import std;

namespace wildfire::firms {

namespace {

bool record_less(
    const DetectionRecord& left,
    const DetectionRecord& right
) noexcept {
    if (left.observed_at_ms != right.observed_at_ms) {
        return left.observed_at_ms < right.observed_at_ms;
    }
    const int satellite = std::memcmp(
        left.satellite,
        right.satellite,
        sizeof(left.satellite)
    );
    if (satellite != 0) return satellite < 0;
    if (left.latitude != right.latitude) return left.latitude < right.latitude;
    return left.longitude < right.longitude;
}

bool same_identity(
    const DetectionRecord& left,
    const DetectionRecord& right
) noexcept {
    return left.observed_at_ms == right.observed_at_ms
        && left.latitude == right.latitude
        && left.longitude == right.longitude
        && std::memcmp(
            left.satellite,
            right.satellite,
            sizeof(left.satellite)
        ) == 0;
}

} // namespace

void sort_and_dedupe(EngineState& state) noexcept {
    if (state.count() < 2u) return;
    DetectionRecord* const records = state.records();
    std::sort(records, records + state.count(), record_less);
    std::uint32_t write = 0u;
    for (std::uint32_t read = 0u; read < state.count(); ++read) {
        if (write != 0u && same_identity(records[write - 1u], records[read])) continue;
        if (write != read) records[write] = records[read];
        ++write;
    }
    state.set_count(write);
}

} // namespace wildfire::firms
