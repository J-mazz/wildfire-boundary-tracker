#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

namespace {

constexpr std::uint32_t kInputCapacity = 8u * 1024u * 1024u;
constexpr std::uint32_t kRecordCapacity = 131072u;
constexpr std::uint32_t kMaxColumns = 40u;

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

struct Field {
    const char* begin;
    const char* end;
};

alignas(16) std::uint8_t g_input[kInputCapacity];
alignas(16) DetectionRecord g_records[kRecordCapacity];
std::uint32_t g_count = 0u;
double g_bounds[4]{};

bool equals(const Field field, const char* text) {
    const auto length = static_cast<std::size_t>(field.end - field.begin);
    return std::strlen(text) == length && std::memcmp(field.begin, text, length) == 0;
}

void copy_field(char* destination, const std::size_t capacity, const Field field) {
    if (capacity == 0u) return;
    const auto length = std::min(capacity - 1u, static_cast<std::size_t>(field.end - field.begin));
    std::memcpy(destination, field.begin, length);
    destination[length] = '\0';
}

bool parse_double(const Field field, double& output) {
    if (field.begin == field.end) return false;
    const char* cursor = field.begin;
    double sign = 1.0;
    if (*cursor == '-') {
        sign = -1.0;
        ++cursor;
    } else if (*cursor == '+') {
        ++cursor;
    }

    double value = 0.0;
    bool digit = false;
    while (cursor < field.end && *cursor >= '0' && *cursor <= '9') {
        digit = true;
        value = value * 10.0 + static_cast<double>(*cursor++ - '0');
    }
    if (cursor < field.end && *cursor == '.') {
        ++cursor;
        double place = 0.1;
        while (cursor < field.end && *cursor >= '0' && *cursor <= '9') {
            digit = true;
            value += static_cast<double>(*cursor++ - '0') * place;
            place *= 0.1;
        }
    }
    if (!digit || cursor != field.end) return false;
    output = sign * value;
    return std::isfinite(output);
}

bool parse_unsigned(const char* begin, const char* end, std::uint32_t& output) {
    if (begin == end) return false;
    std::uint32_t value = 0u;
    const char* cursor = begin;
    while (cursor < end && *cursor >= '0' && *cursor <= '9') {
        const auto digit = static_cast<std::uint32_t>(*cursor++ - '0');
        if (value > (std::numeric_limits<std::uint32_t>::max() - digit) / 10u) return false;
        value = value * 10u + digit;
    }
    if (cursor != end) return false;
    output = value;
    return true;
}

constexpr bool leap_year(const std::uint32_t year) noexcept {
    return year % 4u == 0u && (year % 100u != 0u || year % 400u == 0u);
}

constexpr std::uint32_t days_in_month(const std::uint32_t year, const std::uint32_t month) noexcept {
    constexpr std::uint32_t days[] = {31u, 28u, 31u, 30u, 31u, 30u, 31u, 31u, 30u, 31u, 30u, 31u};
    if (month < 1u || month > 12u) return 0u;
    return month == 2u && leap_year(year) ? 29u : days[month - 1u];
}

// Howard Hinnant's civil calendar transform, reduced to the Gregorian days needed here.
constexpr std::int64_t days_from_civil(int year, const unsigned month, const unsigned day) noexcept {
    year -= month <= 2u;
    const int era = (year >= 0 ? year : year - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(year - era * 400);
    const unsigned adjusted_month = month > 2u ? month - 3u : month + 9u;
    const unsigned doy = (153u * adjusted_month + 2u) / 5u + day - 1u;
    const unsigned doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
    return static_cast<std::int64_t>(era) * 146097 + static_cast<std::int64_t>(doe) - 719468;
}

bool parse_observed_at(const Field date, const Field time, std::int64_t& output_ms) {
    if (date.end - date.begin != 10 || date.begin[4] != '-' || date.begin[7] != '-') return false;
    std::uint32_t year{}, month{}, day{}, hhmm{};
    if (!parse_unsigned(date.begin, date.begin + 4, year)
        || !parse_unsigned(date.begin + 5, date.begin + 7, month)
        || !parse_unsigned(date.begin + 8, date.end, day)
        || !parse_unsigned(time.begin, time.end, hhmm)) return false;
    const auto hour = hhmm / 100u;
    const auto minute = hhmm % 100u;
    if (day < 1u || day > days_in_month(year, month) || hour > 23u || minute > 59u) return false;
    const auto seconds = days_from_civil(static_cast<int>(year), month, day) * 86400
        + static_cast<std::int64_t>(hour) * 3600 + static_cast<std::int64_t>(minute) * 60;
    output_ms = seconds * 1000;
    return true;
}

std::uint32_t split_csv_line(const char* begin, const char* end, Field* fields) {
    std::uint32_t count = 0u;
    const char* cursor = begin;
    while (cursor <= end && count < kMaxColumns) {
        const char* field_begin = cursor;
        const char* field_end = cursor;
        if (cursor < end && *cursor == '"') {
            field_begin = ++cursor;
            while (cursor < end) {
                if (*cursor == '"') {
                    if (cursor + 1 < end && cursor[1] == '"') {
                        cursor += 2;
                        continue;
                    }
                    field_end = cursor++;
                    break;
                }
                ++cursor;
            }
            while (cursor < end && *cursor != ',') ++cursor;
        } else {
            while (cursor < end && *cursor != ',') ++cursor;
            field_end = cursor;
        }
        fields[count++] = {field_begin, field_end};
        if (cursor >= end) break;
        ++cursor;
    }
    return count;
}

struct Columns {
    int latitude{-1};
    int longitude{-1};
    int acq_date{-1};
    int acq_time{-1};
    int satellite{-1};
    int instrument{-1};
    int confidence{-1};
    int frp{-1};
    int bright_ti4{-1};
    int bright_ti5{-1};
    int daynight{-1};
};

void resolve_columns(const Field* fields, const std::uint32_t count, Columns& columns) {
    for (std::uint32_t index = 0u; index < count; ++index) {
        const int column = static_cast<int>(index);
        if (equals(fields[index], "latitude")) columns.latitude = column;
        else if (equals(fields[index], "longitude")) columns.longitude = column;
        else if (equals(fields[index], "acq_date")) columns.acq_date = column;
        else if (equals(fields[index], "acq_time")) columns.acq_time = column;
        else if (equals(fields[index], "satellite")) columns.satellite = column;
        else if (equals(fields[index], "instrument")) columns.instrument = column;
        else if (equals(fields[index], "confidence")) columns.confidence = column;
        else if (equals(fields[index], "frp")) columns.frp = column;
        else if (equals(fields[index], "bright_ti4")) columns.bright_ti4 = column;
        else if (equals(fields[index], "bright_ti5")) columns.bright_ti5 = column;
        else if (equals(fields[index], "daynight")) columns.daynight = column;
    }
}

bool has_required_columns(const Columns& columns) {
    return columns.latitude >= 0 && columns.longitude >= 0
        && columns.acq_date >= 0 && columns.acq_time >= 0;
}

float optional_float(const Field* fields, const std::uint32_t count, const int index) {
    if (index < 0 || static_cast<std::uint32_t>(index) >= count) return NAN;
    double value{};
    return parse_double(fields[index], value) ? static_cast<float>(value) : NAN;
}

Field optional_field(const Field* fields, const std::uint32_t count, const int index) {
    static constexpr char empty[] = "";
    if (index < 0 || static_cast<std::uint32_t>(index) >= count) return {empty, empty};
    return fields[index];
}

bool record_less(const DetectionRecord& left, const DetectionRecord& right) {
    if (left.observed_at_ms != right.observed_at_ms) return left.observed_at_ms < right.observed_at_ms;
    const int satellite = std::memcmp(left.satellite, right.satellite, sizeof(left.satellite));
    if (satellite != 0) return satellite < 0;
    if (left.latitude != right.latitude) return left.latitude < right.latitude;
    return left.longitude < right.longitude;
}

bool same_identity(const DetectionRecord& left, const DetectionRecord& right) {
    return left.observed_at_ms == right.observed_at_ms
        && left.latitude == right.latitude
        && left.longitude == right.longitude
        && std::memcmp(left.satellite, right.satellite, sizeof(left.satellite)) == 0;
}

} // namespace

extern "C" {

std::uint8_t* firms_input() { return g_input; }
std::uint32_t firms_input_capacity() { return kInputCapacity; }
void firms_reset() { g_count = 0u; }

int firms_ingest_csv(const std::uint32_t byte_length) {
    if (byte_length == 0u || byte_length > kInputCapacity) return -1;
    const char* cursor = reinterpret_cast<const char*>(g_input);
    const char* const finish = cursor + byte_length;
    const char* header_end = cursor;
    while (header_end < finish && *header_end != '\n' && *header_end != '\r') ++header_end;

    Field fields[kMaxColumns]{};
    const auto header_count = split_csv_line(cursor, header_end, fields);
    Columns columns{};
    resolve_columns(fields, header_count, columns);
    if (!has_required_columns(columns)) return -2;

    cursor = header_end;
    while (cursor < finish && (*cursor == '\n' || *cursor == '\r')) ++cursor;
    while (cursor < finish) {
        const char* line_end = cursor;
        while (line_end < finish && *line_end != '\n' && *line_end != '\r') ++line_end;
        const auto field_count = split_csv_line(cursor, line_end, fields);
        if (g_count >= kRecordCapacity) return -3;

        double latitude{}, longitude{};
        std::int64_t observed_at_ms{};
        if (static_cast<std::uint32_t>(columns.latitude) < field_count
            && static_cast<std::uint32_t>(columns.longitude) < field_count
            && static_cast<std::uint32_t>(columns.acq_date) < field_count
            && static_cast<std::uint32_t>(columns.acq_time) < field_count
            && parse_double(fields[columns.latitude], latitude)
            && parse_double(fields[columns.longitude], longitude)
            && latitude >= -90.0 && latitude <= 90.0
            && longitude >= -180.0 && longitude <= 180.0
            && parse_observed_at(fields[columns.acq_date], fields[columns.acq_time], observed_at_ms)) {
            DetectionRecord& record = g_records[g_count++];
            std::memset(&record, 0, sizeof(record));
            record.latitude = latitude;
            record.longitude = longitude;
            record.observed_at_ms = observed_at_ms;
            record.frp_mw = optional_float(fields, field_count, columns.frp);
            record.brightness_i4_k = optional_float(fields, field_count, columns.bright_ti4);
            record.brightness_i5_k = optional_float(fields, field_count, columns.bright_ti5);
            copy_field(record.satellite, sizeof(record.satellite), optional_field(fields, field_count, columns.satellite));
            copy_field(record.instrument, sizeof(record.instrument), optional_field(fields, field_count, columns.instrument));
            copy_field(record.confidence, sizeof(record.confidence), optional_field(fields, field_count, columns.confidence));
            copy_field(record.day_night, sizeof(record.day_night), optional_field(fields, field_count, columns.daynight));
        }

        cursor = line_end;
        while (cursor < finish && (*cursor == '\n' || *cursor == '\r')) ++cursor;
    }
    return static_cast<int>(g_count);
}

std::uint32_t firms_finalize(
    const double west,
    const double south,
    const double east,
    const double north,
    const double padding_degrees,
    const double max_span_degrees
) {
    std::sort(g_records, g_records + g_count, record_less);
    std::uint32_t write = 0u;
    for (std::uint32_t read = 0u; read < g_count; ++read) {
        if (write == 0u || !same_identity(g_records[write - 1u], g_records[read])) {
            if (write != read) g_records[write] = g_records[read];
            ++write;
        }
    }
    g_count = write;

    double w = west;
    double s = south;
    double e = east;
    double n = north;
    const DetectionRecord* record = g_records;
    const DetectionRecord* const end = g_records + g_count;
    for (; record < end; ++record) {
        w = std::min(w, record->longitude - padding_degrees);
        s = std::min(s, record->latitude - padding_degrees);
        e = std::max(e, record->longitude + padding_degrees);
        n = std::max(n, record->latitude + padding_degrees);
    }
    const double center_x = (w + e) * 0.5;
    const double center_y = (s + n) * 0.5;
    const double half_span = max_span_degrees * 0.5;
    g_bounds[0] = std::max(w, center_x - half_span);
    g_bounds[1] = std::max(s, center_y - half_span);
    g_bounds[2] = std::min(e, center_x + half_span);
    g_bounds[3] = std::min(n, center_y + half_span);
    return g_count;
}

const DetectionRecord* firms_records() { return g_records; }
std::uint32_t firms_count() { return g_count; }
std::uint32_t firms_record_stride() { return sizeof(DetectionRecord); }
double firms_bound(const std::uint32_t index) { return index < 4u ? g_bounds[index] : NAN; }

} // extern "C"
