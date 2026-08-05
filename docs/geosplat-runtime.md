# Geosplat browser runtime

The browser decoder keeps the `GSP1` wire format and exported Wasm C ABI stable while
separating format validation, decode arithmetic, and ownership:

- `wildfire.geosplat.format` reads the 16-byte little-endian header and resolves every input
  and output offset with checked arithmetic before allocation or pointer movement.
- `wildfire.geosplat.decode` transforms validated height, RGB, and signed-normal planes into
  the nine-float interleaved GPU record.
- `wildfire.geosplat.storage` owns independent exact-allocation policies for compressed
  payloads and decoded output. Both use `wildfire.memory::ExactAllocation`, enforce explicit
  byte limits, report allocation telemetry, and reset deterministically.
- `wildfire.geosplat` is the compatibility facade used by host callers and `src/cpp/main.cpp`.

The payload policy permits one live allocation up to 29,360,144 bytes. The decoded policy
permits one live allocation up to 150,994,944 bytes. Those bounds derive from the
4,194,304-splat cap; they are limits, not eagerly reserved static storage. A successful output
replacement resets the prior output before exact allocation and advances its generation.
Release and browser upload only succeed for the current generation, so a stale owner cannot
access or release newer decoded data. Format-invalid inputs are rejected before this reset; a
valid replacement that exhausts memory leaves decoded storage deterministically empty.

## Wasm ABI and browser lifetime

The existing exports remain `_ext_allocate_wasm_buffer`, `_ext_free_wasm_buffer`,
`_geosplat_decode`, `_geosplat_data`, `_geosplat_count`, `_geosplat_floats_per_splat`, and
`_geosplat_release`. Additive `_geosplat_generation` and `_geosplat_release_generation`
exports let browser owners release only the decode generation they acquired. Payload
allocation and release now route through the bounded payload policy rather than the default
heap API directly.

`GeosplatLayer.load` copies the fetched binary into the bounded Wasm payload once, decodes it,
then releases that payload. It does not clone the decoded floats into JavaScript. During
`onAdd`, `WasmDecodedInstances` reacquires `HEAPU8` and constructs a `Float32Array` immediately
before the synchronous `WebGL2RenderingContext.bufferData` call. No Wasm call or retained view
exists between view construction and upload, so memory growth cannot invalidate an in-flight
view. The decoded allocation remains owned for a possible later GL resource upload and is
released idempotently by layer removal or explicit stale-load disposal.

WebGL programs, vertex arrays, and both buffers remain TypeScript-owned. Partial `onAdd`
failure deletes every resource created so far. `onRemove` deletes all GL resources and releases
the decoded Wasm generation.

## Binary layout

All scalar fields are little-endian:

| Field | Bytes |
| --- | ---: |
| Magic `GSP1` | 4 |
| Grid width and height (`u16`, `u16`) | 4 |
| Minimum and maximum height (`f32`, `f32`) | 8 |
| Quantized heights (`u16[count]`) | `2 * count` |
| RGB (`u8[3 * count]`) | `3 * count` |
| Signed normal X/Y (`i8[2 * count]`) | `2 * count` |

The payload length must equal `16 + 7 * count`. Zero-sized grids, truncated or extended
payloads, arithmetic overflow, and grids above the splat cap return zero without decoding.
