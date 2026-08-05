const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'build/tests'), { recursive: true });

const catalogTestBundle = path.join(root, 'build/tests/catalog-client.cjs');
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'src/ts/network/CatalogClient.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: catalogTestBundle
});
const { validateCatalog } = require(catalogTestBundle);
const liveCatalogFixture = {
  version: '1',
  updatedAt: '2026-07-25T12:00:00Z',
  pollIntervalSeconds: 300,
  event: {
    id: 'irwin-123',
    name: 'Contract Fire',
    startedAt: '2026-07-25T09:00:00Z',
    center: [-120, 40],
    bounds: [-121, 39, -119, 41]
  },
  snapshots: [{
    id: 'frame-2026-07-25T12-00-00Z',
    observedAt: '2026-07-25T12:00:00Z',
    label: '2026-07-25 12:00 UTC',
    status: 'awaiting-data',
    layers: [{
      id: 'firms-2026-07-25T12-00-00Z',
      label: 'VIIRS thermal detections',
      kind: 'firms',
      format: 'geojson',
      status: 'unavailable',
      statusReason: 'No VIIRS detections in this frame'
    }]
  }]
};
assert.deepEqual(validateCatalog(liveCatalogFixture), liveCatalogFixture, 'live engine catalog must pass the client validator');
assert.throws(
  () => validateCatalog({ ...liveCatalogFixture, snapshots: [{ ...liveCatalogFixture.snapshots[0], status: 'missing' }] }),
  /invalid status/,
  'out-of-contract snapshot statuses must be rejected'
);
assert.throws(
  () => validateCatalog({
    ...liveCatalogFixture,
    event: { ...liveCatalogFixture.event, center: [500, 40] }
  }),
  /geographic bounds/,
  'out-of-range catalog coordinates must be rejected before map rendering'
);

const engineTestBundle = path.join(root, 'build/tests/firms-engine.cjs');
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'functions/api/_engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: engineTestBundle,
  external: ['*.wasm']
});
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  return request.endsWith('.wasm') ? {} : originalLoad.call(this, request, parent, isMain);
};
const {
  PERSISTENCE_HOURS,
  createTimeline,
  frameFeatures,
  validFrameParam
} = require(engineTestBundle);
Module._load = originalLoad;

const detectionAt = (iso) => ({
  lat: 42.5, lon: -116.1, observedAtMs: Date.parse(iso),
  satellite: 'N', instrument: 'VIIRS', confidence: 'n',
  dayNight: 'D', frp: 12, brightTi4: 336.2, brightTi5: 300.5
});
const frameIso = '2026-07-25T12:00:00Z';
const windowRows = [
  detectionAt('2026-07-25T12:30:00Z'),
  detectionAt('2026-07-25T09:10:00Z'),
  detectionAt('2026-07-18T11:00:00Z'),
  detectionAt('2026-07-25T15:10:00Z')
];

assert.equal(PERSISTENCE_HOURS, 168, 'FIRMS persistence window drifted from the renderer age ramps');
const windowed = frameFeatures(windowRows.slice(0, 2), Date.parse(frameIso));
assert.equal(windowed.length, 2, 'a frame must carry its own pass plus unexpired earlier passes');
assert.deepEqual(
  windowed.map((feature) => feature.properties.ageHours).sort((left, right) => left - right),
  [0, 2.83],
  'every detection must carry its own age so the renderer can fade it'
);
const frameNow = new Date('2026-07-25T13:45:00Z');
assert.equal(validFrameParam('2026-07-25T12:00:00Z', 10, frameNow), true, 'current cadence frame must be valid');
assert.equal(validFrameParam('2026-07-25T11:00:00Z', 10, frameNow), false, 'off-cadence frame must be rejected');
assert.equal(validFrameParam('2026-07-25T15:00:00Z', 10, frameNow), false, 'future frame must be rejected');
assert.equal(validFrameParam('2026-07-14T12:00:00Z', 10, frameNow), false, 'frame outside requested history must be rejected');
const memory = new WebAssembly.Memory({ initial: 1 });
const view = new DataView(memory.buffer);
let resultCount = 0;
const mockEngine = {
  memory,
  firms_count: () => 4,
  firms_query_frames: () => 0,
  firms_query_frame_capacity: () => 128,
  firms_query_frame_stride: () => 8,
  firms_query_results: () => 4096,
  firms_query_result_count: () => resultCount,
  firms_query_result_stride: () => 16,
  firms_query_coverage: (count) => {
    resultCount = count;
    [2, 2, 3].slice(0, count).forEach((featureCount, index) => {
      const offset = 4096 + index * 16;
      view.setBigInt64(offset, BigInt(Date.parse('2026-07-25T12:30:00Z')), true);
      view.setUint32(offset + 8, 0, true);
      view.setUint32(offset + 12, featureCount, true);
    });
    return count;
  },
  firms_query_range: () => {
    resultCount = 1;
    view.setBigInt64(4096, BigInt(Date.parse('2026-07-25T12:30:00Z')), true);
    view.setUint32(4104, 1, true);
    view.setUint32(4108, 2, true);
    return 1;
  }
};
const timeline = createTimeline(mockEngine);
assert.deepEqual(
  timeline.coverage(['2026-07-25T09:00:00Z', frameIso, '2026-07-25T15:00:00Z'].map(Date.parse))
    .map((frame) => frame.featureCount),
  [2, 2, 3],
  'adapter must preserve C++ coverage counts'
);
assert.equal(timeline.range(Date.parse(frameIso)).newestObservedAt, '2026-07-25T12:30:00Z');
assert.throws(
  () => createTimeline({ ...mockEngine, firms_query_results: () => memory.buffer.byteLength - 8 })
    .range(Date.parse(frameIso)),
  /query results memory region is invalid/,
  'adapter must reject overflowing pointer/count/stride results'
);

console.log('TypeScript catalog and FIRMS frame behavior passed.');
