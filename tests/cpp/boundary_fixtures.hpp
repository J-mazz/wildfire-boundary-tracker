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

} // namespace wildfire::tests::fixtures
