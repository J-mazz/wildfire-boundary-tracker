#include <emscripten/emscripten.h>
#include <cstddef>

import wildfire.geosplat;

extern "C" {

EMSCRIPTEN_KEEPALIVE
void* ext_allocate_wasm_buffer(size_t size) {
    return wildfire::geosplat::allocate_payload(size);
}

EMSCRIPTEN_KEEPALIVE
void ext_free_wasm_buffer(void* ptr) {
    wildfire::geosplat::release_payload(ptr);
}

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_decode(const unsigned char* data, unsigned int byte_length) {
    return wildfire::geosplat::decode(data, byte_length);
}

EMSCRIPTEN_KEEPALIVE
const float* geosplat_data() {
    return wildfire::geosplat::instance_data();
}

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_count() {
    return wildfire::geosplat::splat_count();
}

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_floats_per_splat() {
    return wildfire::geosplat::kFloatsPerSplat;
}

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_generation() {
    return wildfire::geosplat::generation();
}

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_release_generation(unsigned int generation) {
    return wildfire::geosplat::release_generation(generation);
}

EMSCRIPTEN_KEEPALIVE
void geosplat_release() {
    wildfire::geosplat::release();
}

}
