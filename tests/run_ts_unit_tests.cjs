const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const bundle = (entry, output) => {
  const outfile = path.join(root, 'build', 'tests', output);
  buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile
  });
  return require(outfile);
};

const {
  validateApp,
  validateCatalog,
  validateEvent,
  validateLayer,
  validateSnapshots,
  validateTimeline
} = bundle('src/ts/network/catalogValidation.ts', 'catalog-validation.cjs');
const { CatalogSelectionState } = bundle(
  'src/ts/app/CatalogSelectionState.ts',
  'catalog-selection-state.cjs'
);
const { PlaybackState } = bundle('src/ts/app/PlaybackState.ts', 'playback-state.cjs');

const layer = (overrides = {}) => ({
  id: 'firms-1',
  label: 'VIIRS thermal detections',
  kind: 'firms',
  format: 'geojson',
  status: 'ready',
  url: './api/firms',
  featureCount: 2,
  ...overrides
});
const snapshot = (id, observedAt, overrides = {}) => ({
  id,
  observedAt,
  label: observedAt,
  status: 'ready',
  layers: [layer()],
  ...overrides
});
const catalog = (updatedAt, snapshots, overrides = {}) => ({
  version: '1',
  updatedAt,
  pollIntervalSeconds: 300,
  event: {
    id: 'irwin-123',
    name: 'Contract Fire',
    startedAt: '2026-07-25T09:00:00Z',
    center: [-120, 40],
    bounds: [-121, 39, -119, 41]
  },
  app: {
    title: 'Contract Fire',
    tagline: 'Live perimeter',
    baseImagery: { tiles: ['https://example.test/{z}/{x}/{y}'], attribution: 'Test' }
  },
  timeline: {
    startAt: '2026-07-25T09:00:00Z',
    endAt: '2026-07-25T12:00:00Z',
    cadenceHours: 3
  },
  snapshots,
  ...overrides
});

const frames = [
  snapshot('frame-1', '2026-07-25T09:00:00Z'),
  snapshot('frame-2', '2026-07-25T12:00:00Z')
];
const validCatalog = catalog('2026-07-25T12:00:00Z', frames);
assert.strictEqual(validateCatalog(validCatalog), validCatalog, 'validation must preserve catalog identity');
assert.strictEqual(validateEvent(validCatalog.event), validCatalog.event);
assert.strictEqual(validateApp(validCatalog.app), validCatalog.app);
assert.strictEqual(validateTimeline(validCatalog.timeline), validCatalog.timeline);
assert.strictEqual(validateSnapshots(validCatalog.snapshots), validCatalog.snapshots);
assert.strictEqual(validateLayer(validCatalog.snapshots[0].layers[0], 'snapshots[0].layers[0]'), validCatalog.snapshots[0].layers[0]);

const rejects = [
  [{ ...validCatalog, event: { ...validCatalog.event, center: [181, 40] } }, /at event:.*geographic bounds/],
  [{ ...validCatalog, app: { ...validCatalog.app, baseImagery: { tiles: [], attribution: 'Test' } } }, /at app:.*app configuration/],
  [{ ...validCatalog, timeline: { ...validCatalog.timeline, cadenceHours: 0 } }, /at timeline:.*timeline configuration/],
  [{ ...validCatalog, snapshots: [frames[0], { ...frames[1], id: 'frame-1' }] }, /at snapshots\[1\]\.id: Duplicate snapshot id/],
  [{ ...validCatalog, snapshots: [frames[1], frames[0]] }, /at snapshots\[1\]\.observedAt:.*sorted/],
  [{ ...validCatalog, snapshots: [{ ...frames[0], status: 'missing' }] }, /at snapshots\[0\]\.status:.*invalid status/],
  [{ ...validCatalog, snapshots: [{ ...frames[0], layers: [layer({ status: 'missing' })] }] }, /layers\[0\]\.status:.*invalid status/],
  [{ ...validCatalog, snapshots: [{ ...frames[0], layers: [layer({ kind: 'heatmap' })] }] }, /layers\[0\]\.kind:.*invalid kind/],
  [{ ...validCatalog, snapshots: [{ ...frames[0], layers: [layer({ format: 'csv' })] }] }, /layers\[0\]\.format:.*invalid format/],
  [{ ...validCatalog, snapshots: [{ ...frames[0], layers: [layer({ tiles: [] })] }] }, /layers\[0\]\.tiles:.*invalid tiles/],
  [{ ...validCatalog, snapshots: [{ ...frames[0], layers: [layer({ featureCount: -1 })] }] }, /featureCount:.*invalid feature count/]
];
rejects.forEach(([candidate, pattern]) => assert.throws(() => validateCatalog(candidate), pattern));
const sparseSnapshots = [];
sparseSnapshots.length = 1;
assert.throws(
  () => validateCatalog({ ...validCatalog, snapshots: sparseSnapshots }),
  /at snapshots\[0\]: Every snapshot requires/,
  'sparse snapshot arrays must remain rejected'
);
const sparseLayers = [];
sparseLayers.length = 1;
assert.throws(
  () => validateCatalog({ ...validCatalog, snapshots: [{ ...frames[0], layers: sparseLayers }] }),
  /at snapshots\[0\]\.layers\[0\]: Snapshot contains an invalid layer/,
  'sparse layer arrays must remain rejected'
);
const sparseCenter = [];
sparseCenter.length = 2;
assert.strictEqual(
  validateCatalog({ ...validCatalog, event: { ...validCatalog.event, center: sparseCenter } }).event.center,
  sparseCenter,
  'validation must retain the existing sparse coordinate tuple contract'
);

const selection = new CatalogSelectionState();
assert.deepEqual(selection.update(validCatalog, false, true), { changed: true, targetIndex: 1 });
assert.equal(selection.select(99).snapshot.id, 'frame-2', 'selection must clamp to the newest snapshot');
assert.equal(selection.nextPlaybackIndex(), 0, 'playback must wrap at the end');
const appended = catalog('2026-07-25T15:00:00Z', [...frames, snapshot('frame-3', '2026-07-25T15:00:00Z')]);
assert.deepEqual(selection.update(appended, false, false), { changed: true, targetIndex: 1 });
assert.equal(selection.select(1).adjacent.length, 2, 'both adjacent snapshots must be available for prefetch');
const unchangedCatalog = { ...appended };
assert.deepEqual(selection.update(unchangedCatalog, true, false), { changed: false, targetIndex: null });
assert.equal(selection.stale, true, 'staleness must update even for an unchanged catalog');
assert.equal(selection.catalog, unchangedCatalog, 'the latest catalog object must remain authoritative');

const playback = new PlaybackState();
assert.equal(playback.isLive, true);
assert.equal(playback.start(1), false, 'single-snapshot catalogs cannot play');
assert.equal(playback.start(2), true);
assert.equal(playback.isPlaying, true);
assert.equal(playback.isLive, false);
playback.stop();
assert.equal(playback.isPlaying, false);
playback.goLive();
assert.equal(playback.isLive, true);
playback.selectHistorical();
assert.equal(playback.isLive, false);

console.log('Catalog validators and frontend state transitions passed.');
