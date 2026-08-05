module;

#include <cstdint>
#include <cstring>

module wildfire.firms.ingest;

import wildfire.firms.csv;
import wildfire.firms.numbers;
import wildfire.firms.schema;
import wildfire.firms.time;

namespace wildfire::firms {

namespace {

const char* line_end(const char* cursor, const char* const finish) noexcept {
    while (cursor < finish && *cursor != '\n' && *cursor != '\r') ++cursor;
    return cursor;
}

const char* skip_line_end(const char* cursor, const char* const finish) noexcept {
    while (cursor < finish && (*cursor == '\n' || *cursor == '\r')) ++cursor;
    return cursor;
}

bool required_fields_present(
    const Columns& columns,
    const std::uint32_t count
) noexcept {
    const int required[] = {
        columns.latitude,
        columns.longitude,
        columns.acq_date,
        columns.acq_time
    };
    for (const int index : required) {
        if (index < 0 || static_cast<std::uint32_t>(index) >= count) return false;
    }
    return true;
}

bool parse_coordinates(
    const Field latitude_field,
    const Field longitude_field,
    double& latitude,
    double& longitude
) noexcept {
    if (!parse_double(latitude_field, latitude)) return false;
    if (!parse_double(longitude_field, longitude)) return false;
    return latitude >= -90.0 && latitude <= 90.0
        && longitude >= -180.0 && longitude <= 180.0;
}

bool populate_record(
    DetectionRecord& record,
    const Field* const fields,
    const std::uint32_t count,
    const Columns& columns
) noexcept {
    double latitude{};
    double longitude{};
    std::int64_t observed_at_ms{};
    if (!required_fields_present(columns, count)) return false;
    if (!parse_coordinates(
        fields[columns.latitude],
        fields[columns.longitude],
        latitude,
        longitude
    )) return false;
    if (!parse_observed_at(
        fields[columns.acq_date],
        fields[columns.acq_time],
        observed_at_ms
    )) return false;

    std::memset(&record, 0, sizeof(record));
    record.latitude = latitude;
    record.longitude = longitude;
    record.observed_at_ms = observed_at_ms;
    record.frp_mw = optional_float(fields, count, columns.frp);
    record.brightness_i4_k = optional_float(fields, count, columns.bright_ti4);
    record.brightness_i5_k = optional_float(fields, count, columns.bright_ti5);
    copy_field(
        record.satellite,
        sizeof(record.satellite),
        optional_field(fields, count, columns.satellite)
    );
    copy_field(
        record.instrument,
        sizeof(record.instrument),
        optional_field(fields, count, columns.instrument)
    );
    copy_field(
        record.confidence,
        sizeof(record.confidence),
        optional_field(fields, count, columns.confidence)
    );
    copy_field(
        record.day_night,
        sizeof(record.day_night),
        optional_field(fields, count, columns.daynight)
    );
    return true;
}

bool ingest_line(
    EngineState& state,
    const char* const begin,
    const char* const end,
    const Columns& columns,
    Field* const fields
) noexcept {
    const CsvLine line = tokenize_csv_line(begin, end, fields, kMaxColumns);
    if (!line.valid) return false;
    DetectionRecord* const destination = state.next_record();
    if (destination == nullptr) return false;
    if (!populate_record(*destination, fields, line.count, columns)) return false;
    state.commit_record();
    return true;
}

} // namespace

int ingest_csv(EngineState& state, const std::uint32_t byte_length) noexcept {
    if (!state.ready() || byte_length == 0u || byte_length > kInputCapacity) return -1;
    state.note_input_bytes(byte_length);
    const char* cursor = reinterpret_cast<const char*>(state.input());
    const char* const finish = cursor + byte_length;
    const char* const header_end = line_end(cursor, finish);

    Field fields[kMaxColumns]{};
    const CsvLine header = tokenize_csv_line(cursor, header_end, fields, kMaxColumns);
    if (!header.valid) return -2;
    Columns columns{};
    resolve_columns(fields, header.count, columns);
    if (!has_required_columns(columns)) return -2;

    cursor = skip_line_end(header_end, finish);
    while (cursor < finish) {
        if (state.count() >= kRecordCapacity) return -3;
        const char* const end = line_end(cursor, finish);
        static_cast<void>(ingest_line(state, cursor, end, columns, fields));
        cursor = skip_line_end(end, finish);
    }
    return static_cast<int>(state.count());
}

} // namespace wildfire::firms
