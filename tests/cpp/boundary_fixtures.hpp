#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace wildfire::tests::fixtures {

inline constexpr std::string_view firms_boundary_csv =
    "latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,bright_ti4,bright_ti5,daynight\r\n"
    "-90,-180,2028-02-29,0001,N,VIIRS,n,0,0,0,D\r\n"
    "90,180,2028-02-29,2359,N20,VIIRS,h,1.5,655.5,300.25,N\r\n"
    "-90,-180,2028-02-29,0001,N,VIIRS,n,0,0,0,D\r\n";

inline constexpr std::string_view firms_invalid_csv =
    "latitude,longitude,acq_date,acq_time,satellite\n"
    "90.0001,0,2026-01-01,0000,N\n"
    "0,-180.0001,2026-01-01,0000,N\n"
    "0,0,2100-02-29,0000,N\n"
    "0,0,2028-02-29,2400,N\n"
    "nan,0,2028-02-29,0000,N\n";

inline constexpr std::array<std::uint8_t, 23> geosplat_one_cell{
    0x47, 0x53, 0x50, 0x31, // GSP1
    0x01, 0x00,             // width
    0x01, 0x00,             // height
    0x00, 0x00, 0xc8, 0x42, // min height: 100.0f
    0x00, 0x00, 0x96, 0x43, // max height: 300.0f
    0x00, 0x80,             // quantized height
    0xff, 0x80, 0x00,       // RGB
    0x00, 0x00              // octahedral normal
};

inline constexpr std::array<std::uint8_t, 23> geosplat_endian_probe{
    0x47, 0x53, 0x50, 0x31, // GSP1
    0x01, 0x00,             // width
    0x01, 0x00,             // height
    0x00, 0x00, 0x80, 0x3f, // min height: 1.0f
    0x00, 0x00, 0x80, 0x3f, // max height: 1.0f
    0x34, 0x12,             // quantized height: 0x1234
    0x01, 0x02, 0x03,       // RGB
    0x81, 0x7f              // signed normal xy: -127, 127
};

inline constexpr std::array<std::uint8_t, 16> geosplat_cap_header{
    0x47, 0x53, 0x50, 0x31, // GSP1
    0x00, 0x10,             // width: 4096
    0x00, 0x04,             // height: 1024
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
};

inline constexpr std::array<std::uint8_t, 16> geosplat_wasm32_overflow_header{
    0x47, 0x53, 0x50, 0x31, // GSP1
    0xff, 0xff,             // width: 65535
    0xff, 0xff,             // height: 65535
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
};

inline constexpr std::array<std::uint8_t, 16> geosplat_capacity_overflow_header{
    0x47, 0x53, 0x50, 0x31, // GSP1
    0x01, 0x10,             // width: 4097
    0x00, 0x04,             // height: 1024
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
};

} // namespace wildfire::tests::fixtures
