const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  loader: { '.wasm': 'empty' }
});
const { PERSISTENCE_HOURS, frameCoverage, toFrameFeatures, validFrameParam } = require(engineTestBundle);

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
const windowed = toFrameFeatures(windowRows, frameIso);
assert.equal(windowed.length, 2, 'a frame must carry its own pass plus unexpired earlier passes');
assert.deepEqual(
  windowed.map((feature) => feature.properties.ageHours).sort((left, right) => left - right),
  [0, 2.83],
  'every detection must carry its own age so the renderer can fade it'
);
assert.equal(toFrameFeatures(windowRows, frameIso, 1).length, 1, 'shrinking the persistence window must expire older passes');
const frameNow = new Date('2026-07-25T13:45:00Z');
assert.equal(validFrameParam('2026-07-25T12:00:00Z', 10, frameNow), true, 'current cadence frame must be valid');
assert.equal(validFrameParam('2026-07-25T11:00:00Z', 10, frameNow), false, 'off-cadence frame must be rejected');
assert.equal(validFrameParam('2026-07-25T15:00:00Z', 10, frameNow), false, 'future frame must be rejected');
assert.equal(validFrameParam('2026-07-14T12:00:00Z', 10, frameNow), false, 'frame outside requested history must be rejected');
assert.deepEqual(
  frameCoverage(windowRows, ['2026-07-25T09:00:00Z', frameIso, '2026-07-25T15:00:00Z'].map(Date.parse))
    .map((frame) => frame.featureCount),
  [2, 2, 3],
  'window occupancy must track passes entering and expiring across the timeline'
);
assert.equal(
  frameCoverage(windowRows, [Date.parse(frameIso)])[0].newestObservedAt,
  '2026-07-25T12:30:00Z',
  'a frame must report its newest contributing pass'
);

console.log('TypeScript catalog and FIRMS frame behavior passed.');
