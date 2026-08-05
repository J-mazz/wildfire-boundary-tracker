const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'build', 'tests', 'worker-engine-modules');
buildSync({
  entryPoints: {
    calculations: path.join(root, 'functions/api/engine/calculations.ts'),
    catalog: path.join(root, 'functions/api/engine/catalog-builder.ts'),
    http: path.join(root, 'functions/api/_http.ts'),
    validation: path.join(root, 'functions/api/engine/validation.ts')
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir
});

const calculations = require(path.join(outdir, 'calculations.js'));
const { buildCatalog, createCatalogPlan } = require(path.join(outdir, 'catalog.js'));
const { fetchUpstream } = require(path.join(outdir, 'http.js'));
const validation = require(path.join(outdir, 'validation.js'));

assert.equal(validation.finiteNumber(12.5), 12.5);
assert.equal(validation.finiteNumber(Number.POSITIVE_INFINITY), null);
assert.equal(validation.nonEmptyString('fire'), 'fire');
assert.equal(validation.nonEmptyString(''), null);
assert.equal(validation.parseFireParam('irwin:01234567-89ab-cdef-0123-456789abcdef'), '01234567-89ab-cdef-0123-456789abcdef');
assert.equal(validation.parseFireParam('01234567-89ab-cdef-0123-456789abcdef'), null);
assert.deepEqual(validation.nifcFeatures({}), []);
assert.throws(() => validation.nifcFeatures({}, true), /returned invalid features/);
assert.throws(() => validation.nifcFeatures([], true), /returned an unexpected shape/);

const detectionAt = (iso) => ({
  lat: 42.5,
  lon: -116.1,
  observedAtMs: Date.parse(iso),
  satellite: 'N',
  instrument: 'VIIRS',
  confidence: 'n',
  dayNight: 'D',
  frp: 12,
  brightTi4: 336.2,
  brightTi5: 300.5
});
const frameIso = '2026-07-25T12:00:00Z';
const rows = [
  detectionAt('2026-07-25T12:30:00Z'),
  detectionAt('2026-07-25T09:10:00Z'),
  detectionAt('2026-07-18T11:00:00Z'),
  detectionAt('2026-07-25T15:10:00Z')
];
const features = calculations.toFrameFeatures(rows, frameIso);
assert.equal(features.length, 2);
assert.deepEqual(
  features.map((feature) => feature.properties.ageHours).sort((left, right) => left - right),
  [0, 2.83]
);
assert.deepEqual(
  calculations.frameCoverage(rows, ['2026-07-25T09:00:00Z', frameIso].map(Date.parse))
    .map((frame) => frame.featureCount),
  [2, 2]
);
assert.equal(calculations.validFrameParam(frameIso, 10, new Date('2026-07-25T13:45:00Z')), true);
assert.equal(calculations.validFrameParam('2026-07-25T11:00:00Z', 10, new Date('2026-07-25T13:45:00Z')), false);

const incident = {
  irwinId: '01234567-89ab-cdef-0123-456789abcdef',
  name: 'Contract Fire',
  discoveredAt: '2026-07-25T09:30:00Z',
  sizeAcres: 100,
  percentContained: 10,
  state: 'US-ID',
  center: [-116.1, 42.5]
};
const now = new Date('2026-07-25T13:45:00Z');
const plan = createCatalogPlan(incident, now);
assert.equal(plan.dayRange, 1);
assert.equal(plan.startAt.toISOString(), '2026-07-25T09:00:00.000Z');
assert.deepEqual(plan.frameTimes.map((time) => new Date(time).toISOString()), [
  '2026-07-25T09:00:00.000Z',
  '2026-07-25T12:00:00.000Z'
]);

const perimeter = {
  collection: { type: 'FeatureCollection', features: [{}] },
  featureCount: 1,
  observedAt: '2026-07-25T13:00:00.000Z'
};
const built = buildCatalog({
  irwinId: incident.irwinId,
  incident,
  result: { detections: rows.slice(0, 2), bounds: [-116.2, 42.4, -116, 42.6], reason: null },
  perimeter,
  plan,
  now
});
const snapshots = built.catalog.snapshots;
assert.equal(snapshots.length, 2);
assert.equal(snapshots[0].status, 'ready');
assert.equal(snapshots[0].layers.length, 1);
assert.equal(snapshots[1].layers.length, 2);
assert.equal(snapshots[1].layers[1].contextType, 'incident-perimeter');
assert.deepEqual(built.cacheableFrames, ['2026-07-25T09:00:00Z', '2026-07-25T12:00:00Z']);

const absent = buildCatalog({
  irwinId: incident.irwinId,
  incident,
  result: { detections: null, bounds: [-116.2, 42.4, -116, 42.6], reason: 'FIRMS_MAP_KEY is not configured' },
  perimeter: null,
  plan,
  now
});
assert.equal(absent.catalog.snapshots[0].status, 'awaiting-data');
assert.equal(absent.catalog.snapshots[0].layers[0].status, 'unavailable');
assert.equal(absent.catalog.snapshots[0].layers[0].statusReason, 'FIRMS_MAP_KEY is not configured');
assert.deepEqual(absent.cacheableFrames, []);

void (async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map();
  let nextTimer = 1;
  global.setTimeout = (callback) => {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  };
  global.clearTimeout = (id) => {
    timers.delete(id);
  };
  global.fetch = (_input, init) => Promise.resolve(new Response(new ReadableStream({
    start(stream) {
      init.signal.addEventListener('abort', () => stream.error(new Error('aborted')));
    }
  })));
  try {
    const stalled = await fetchUpstream('stalled service', 'https://example.test/stalled');
    const stalledRead = stalled.text();
    for (const callback of [...timers.values()]) callback();
    await assert.rejects(stalledRead, /stalled service: timed out after 15000ms/);
    assert.equal(timers.size, 0, 'Worker body timeout must clear its deadline');
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    delete global.fetch;
  }
  console.log('Worker validation, timeline, and catalog builder contracts passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
