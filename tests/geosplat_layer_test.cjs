const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const outfile = path.join(root, 'build', 'tests', 'geosplat-layer.cjs');
void (async () => {
await build({
  entryPoints: [path.join(root, 'src/ts/core/GeosplatLayer.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  plugins: [{
    name: 'maplibre-stub',
    setup(build) {
      build.onResolve({ filter: /^maplibre-gl$/ }, () => ({
        path: 'maplibre-gl',
        namespace: 'stub'
      }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: `export default {
          MercatorCoordinate: {
            fromLngLat: ({ lng, lat }) => ({
              x: lng,
              y: lat,
              meterInMercatorCoordinateUnits: () => 0.001
            })
          }
        };`
      }));
    }
  }]
});

class FakeWebGL2 {
  constructor() {
    this.ARRAY_BUFFER = 1;
    this.STATIC_DRAW = 2;
    this.VERTEX_SHADER = 3;
    this.FRAGMENT_SHADER = 4;
    this.COMPILE_STATUS = 5;
    this.LINK_STATUS = 6;
    this.FLOAT = 7;
    this.uploads = [];
    this.deletedBuffers = [];
    this.deletedPrograms = [];
    this.deletedVertexArrays = [];
    this.nextId = 1;
  }
  createShader() { return { id: this.nextId++ }; }
  shaderSource() {}
  compileShader() {}
  getShaderParameter() { return true; }
  getShaderInfoLog() { return ''; }
  deleteShader() {}
  createProgram() { return { id: this.nextId++ }; }
  attachShader() {}
  linkProgram() {}
  getProgramParameter() { return true; }
  getProgramInfoLog() { return ''; }
  deleteProgram(value) { this.deletedPrograms.push(value); }
  getUniformLocation() { return {}; }
  createVertexArray() { return { id: this.nextId++ }; }
  bindVertexArray() {}
  deleteVertexArray(value) { this.deletedVertexArrays.push(value); }
  createBuffer() { return { id: this.nextId++ }; }
  bindBuffer() {}
  bufferData(_target, data) { this.uploads.push(data); }
  deleteBuffer(value) { this.deletedBuffers.push(value); }
  getAttribLocation() { return 0; }
  enableVertexAttribArray() {}
  vertexAttribPointer() {}
  vertexAttribDivisor() {}
}
global.WebGL2RenderingContext = FakeWebGL2;

const { GeosplatLayer, WasmDecodedInstances } = require(outfile);

const memoryA = new ArrayBuffer(256);
let currentGeneration = 7;
const wasm = {
  HEAPU8: new Uint8Array(memoryA),
  releaseCount: 0,
  _geosplat_generation() { return currentGeneration; },
  _geosplat_release_generation(generation) {
    assert.equal(generation, 7);
    ++this.releaseCount;
    return 1;
  }
};
const decoded = new WasmDecodedInstances(wasm, 64, 1, 9);
const uploadGl = new FakeWebGL2();
decoded.upload(uploadGl);
assert.strictEqual(uploadGl.uploads[0].buffer, memoryA, 'upload must use current Wasm memory directly');

const memoryB = new ArrayBuffer(256);
wasm.HEAPU8 = new Uint8Array(memoryB);
decoded.upload(uploadGl);
assert.strictEqual(uploadGl.uploads[1].buffer, memoryB, 'each upload must reacquire the Wasm memory view');
assert.equal(wasm.releaseCount, 0, 'decoded output must remain owned until layer disposal');
currentGeneration = 8;
assert.throws(() => decoded.upload(uploadGl), /ownership is stale/);
currentGeneration = 7;
decoded.dispose();
decoded.dispose();
assert.equal(wasm.releaseCount, 1, 'decoded output release must be idempotent');
assert.throws(() => decoded.upload(uploadGl), /already released/);

const meta = {
  bounds: [-121, 39, -119, 41],
  grid: [1, 1],
  minHeightMeters: 0,
  maxHeightMeters: 1,
  url: 'terrain.splat'
};
const layer = new GeosplatLayer(meta, new Float32Array(9), 9);
const gl = new FakeWebGL2();
layer.onAdd({ triggerRepaint() {} }, gl);
assert.equal(gl.uploads.length, 2, 'corner and instance buffers must both upload');
layer.onAdd({ triggerRepaint() {} }, gl);
assert.equal(gl.deletedBuffers.length, 2, 'reinitialization must delete superseded buffers');
layer.onRemove({}, gl);
assert.equal(gl.deletedBuffers.length, 4, 'all WebGL buffers must be deleted');
assert.equal(gl.deletedPrograms.length, 2, 'every WebGL program must be deleted');
assert.equal(gl.deletedVertexArrays.length, 2, 'every vertex array must be deleted');

const failedLayer = new GeosplatLayer(meta, new Float32Array(9), 9);
const failedGl = new FakeWebGL2();
failedGl.createVertexArray = () => null;
assert.throws(
  () => failedLayer.onAdd({ triggerRepaint() {} }, failedGl),
  /vertex array/
);
assert.equal(failedGl.deletedPrograms.length, 1, 'partial setup must delete its program');

console.log('Geosplat Wasm ownership and WebGL cleanup contracts passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
