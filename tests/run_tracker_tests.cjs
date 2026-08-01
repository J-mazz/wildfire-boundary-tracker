const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
};

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const containsFiles = (relative) => {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) return false;
  if (!fs.statSync(target).isDirectory()) return true;
  return fs.readdirSync(target, { recursive: true, withFileTypes: true })
    .some((entry) => entry.isFile());
};
const landing = read('dist/index.html');
const mapPage = read('dist/map.html');
const bundle = read('dist/client.js');
const mainSource = read('src/ts/main.ts');
const mapSource = read('src/ts/core/MapController.ts');
const geosplatSource = read('src/ts/core/GeosplatLayer.ts');
const catalogFunction = read('functions/api/catalog.ts');
const workerMiddleware = read('functions/api/_engine.ts');
const workerBuild = read('tools/build_worker_wasm.sh');
const browserBuild = read('tools/build_wasm.sh');
const incidentsFunction = read('functions/api/incidents.ts');
const perimeterFunction = read('functions/api/perimeter.ts');
const httpMiddleware = read('functions/api/_http.ts');
const ncnnBuild = read('tools/build_ncnn_vulkan.sh');
const ncnnSource = read('src/native/ncnn_vulkan_batch.cpp');

assert.match(landing, /Current wildfires/, 'root must be the NIFC incident picker');
assert.match(landing, /fires\.js/, 'landing page script missing');
assert.doesNotMatch(landing, /client\.js|id="map"/, 'landing page must not boot the map renderer');
assert.match(mapPage, /id="map"/, 'map entrypoint missing');
assert.match(mapPage, /id="terrain-button"/, '3D terrain capability must remain available');
assert.match(mapPage, /client\.js/, 'map entrypoint must load the TypeScript frontend bundle');
assert.ok(!exists('dist/data'), 'generic tracker must not deploy curated East Evans data');
assert.ok(exists('dist/wasm/wildfire.js') && exists('dist/wasm/wildfire.wasm'), 'browser WASM/geosplat runtime missing');
assert.ok(exists('functions/wasm/firms_engine.wasm'), 'Worker compute WASM missing');

assert.match(mainSource, /api\/catalog\?fire=/, 'frontend must use the live catalog endpoint');
assert.doesNotMatch(mainSource, /data\/catalog\.json/, 'generic frontend must not fall back to a curated catalog');
assert.match(mainSource, /setTerrainMetadataUrl/, 'terrain must be capability-gated by catalog metadata');
assert.match(mapSource, /GeosplatLayer/, 'MapController lost DEM geosplat support');
assert.match(geosplatSource, /metadataUrl/, 'geosplat metadata must be catalog-selectable');
assert.match(bundle, /wildfire-geosplat/, 'geosplat renderer was not bundled');
assert.match(browserBuild, /geosplat\.cppm/, 'browser WASM build lost geosplat decoding');
assert.doesNotMatch(browserBuild, /flatbuffer|buffer_parser|renderer\.cppm|shader_manager|initialize_webgl_context|render_frame/, 'dead SceneGraph pipeline returned');
for (const removed of [
  'src/cpp/buffer_parser.cppm',
  'src/cpp/renderer.cppm',
  'src/cpp/shader_manager.cppm',
  'src/cpp/flatbuffers',
  'src/scene_graph.fbs',
  'vendor',
  'Dockerfile',
  'src/ts/core/SettingsController.ts',
  'public/data',
  'tools/dev_server.js',
  'tools/generate_catalog.js',
  'tools/import_firms.py',
  'tools/fetch_context_kml.sh',
  'src/native/osm_context_to_kml.cpp'
]) assert.ok(!containsFiles(removed), `dead browser pipeline remains: ${removed}`);

assert.match(catalogFunction, /startedAt:/, 'live catalog event metadata is incomplete');
assert.match(catalogFunction, /status: hasData \|\| hasCurrentPerimeter \? 'ready' : 'awaiting-data'/, 'snapshot readiness must include every visible live overlay');
assert.match(catalogFunction, /status: hasData \? 'ready' : 'unavailable'/, 'layer status contract drifted');
assert.match(workerMiddleware, /firmsEngineModule/, 'TypeScript middleware must invoke C++ WASM');
assert.doesNotMatch(workerMiddleware, /split\('\n'\)|parseCsv/, 'FIRMS CSV parsing leaked back into TypeScript');
assert.match(workerMiddleware, /await Promise\.all\(FIRMS_SOURCES\.flatMap/, 'FIRMS fetch lanes must run concurrently');
assert.match(httpMiddleware, /withApiErrors/, 'Pages Functions must share a sanitized error boundary');
assert.match(httpMiddleware, /UPSTREAM_TIMEOUT_MS/, 'upstream requests must have a bounded lifetime');
assert.ok(workerMiddleware.indexOf('await ingestResponse') < workerMiddleware.indexOf('defer(cache.put'), 'FIRMS payload must parse before entering cache');
assert.match(workerMiddleware, /defer\(cache\.delete\(item\.cacheKey\), 'firms_batch_cache_delete'\)/, 'invalid cached FIRMS payloads must be evicted');
assert.match(workerMiddleware, /Math\.sqrt\(sizeAcres \* 4046\.86 \/ Math\.PI\)/, 'incident acreage must grow the FIRMS query footprint');
assert.match(workerMiddleware, /WFIGS_Interagency_Perimeters_Current/, 'live engine must query the official current perimeter service');
assert.match(workerMiddleware, /poly_IRWINID = '\{\$\{normalizedId\}\}'/, 'perimeter lookup must use the indexed braced IRWIN ID');
assert.match(catalogFunction, /Current WFIGS incident perimeter/, 'live catalog must expose an operational perimeter when available');
assert.match(catalogFunction, /index === frameTimes\.length - 1/, 'a current perimeter must not masquerade as historical progression');
assert.match(perimeterFunction, /fetchCurrentPerimeter/, 'perimeter endpoint must use the validated engine helper');
assert.doesNotMatch(incidentsFunction, /IncidentSize > 0/, 'new zero-size incidents must remain discoverable');
for (const endpoint of ['_engine', 'catalog', 'firms', 'incidents', 'perimeter']) {
  assert.ok(exists(`functions/api/${endpoint}.ts`), `${endpoint} Pages Function must be TypeScript`);
  assert.ok(!exists(`functions/api/${endpoint}.js`), `${endpoint} legacy JavaScript Function remains`);
}

const workerWasm = fs.readFileSync(path.join(root, 'functions/wasm/firms_engine.wasm'));
const wasmModule = new WebAssembly.Module(workerWasm);
assert.deepEqual(WebAssembly.Module.imports(wasmModule), [], 'Worker WASM must be import-free');
const engine = new WebAssembly.Instance(wasmModule, {}).exports;
const csv = Buffer.from([
  'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,bright_ti4,bright_ti5,daynight',
  '42.5,-116.1,2026-07-24,2201,N,VIIRS,n,10.5,336.2,300.5,D',
  '42.5,-116.1,2026-07-24,2201,N,VIIRS,n,10.5,336.2,300.5,D',
  '42.6,-116.0,2026-07-24,2315,N20,VIIRS,h,20.0,340.0,301.0,N'
].join('\n'));
new Uint8Array(engine.memory.buffer, engine.firms_input(), csv.length).set(csv);
engine.firms_reset();
assert.equal(engine.firms_ingest_csv(csv.length), 3, 'C++ parser must ingest every CSV row');
assert.equal(engine.firms_finalize(-116.2, 42.4, -115.9, 42.7, 0.02, 4), 2, 'C++ engine must deduplicate rows');
assert.equal(engine.firms_record_stride(), 64, 'C++/TypeScript record ABI drifted');
const records = new DataView(engine.memory.buffer, engine.firms_records(), 128);
assert.equal(records.getFloat64(0, true), 42.5);
assert.equal(records.getFloat64(8, true), -116.1);
assert.equal(Number(records.getBigInt64(16, true)), Date.parse('2026-07-24T22:01:00Z'));
const upstreamError = Buffer.from('Exceeded transaction limit');
engine.firms_reset();
new Uint8Array(engine.memory.buffer, engine.firms_input(), upstreamError.length).set(upstreamError);
assert.equal(engine.firms_ingest_csv(upstreamError.length), -2, 'HTTP 200 FIRMS error text must fail CSV validation');
assert.equal(engine.firms_count(), 0, 'invalid FIRMS bodies must not add records');
const invalidRows = Buffer.from([
  'latitude,longitude,acq_date,acq_time,satellite',
  '91,-116.1,2026-07-24,2201,N',
  '42.5,-181,2026-07-24,2201,N',
  '42.5,-116.1,2026-02-30,2201,N',
  '42.5,-116.1,2026-07-24,4294969497,N'
].join('\n'));
engine.firms_reset();
new Uint8Array(engine.memory.buffer, engine.firms_input(), invalidRows.length).set(invalidRows);
assert.equal(engine.firms_ingest_csv(invalidRows.length), 0, 'invalid coordinates, dates, and overflowing times must be rejected');
const leapDay = Buffer.from([
  'latitude,longitude,acq_date,acq_time,satellite',
  '42.5,-116.1,2028-02-29,0001,N'
].join('\n'));
engine.firms_reset();
new Uint8Array(engine.memory.buffer, engine.firms_input(), leapDay.length).set(leapDay);
assert.equal(engine.firms_ingest_csv(leapDay.length), 1, 'valid Gregorian leap days must remain accepted');
assert.match(workerBuild, /-std=c\+\+26/, 'Worker WASM must compile as C++26');
assert.match(workerBuild, /STANDALONE_WASM=1/, 'Worker WASM must not use browser glue');
assert.match(workerBuild, /INITIAL_MEMORY=20971520/, 'Worker WASM memory budget drifted');

const catalogTestBundle = path.join(root, 'build', 'tests', 'catalog-client.cjs');
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

const engineTestBundle = path.join(root, 'build', 'tests', 'firms-engine.cjs');
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'functions/api/_engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: engineTestBundle,
  // The frame helpers under test are pure; the WASM parser is never instantiated here.
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
  detectionAt('2026-07-25T12:30:00Z'), // the frame's own 3h bucket -> live edge
  detectionAt('2026-07-25T09:10:00Z'), // earlier pass, still inside the window
  detectionAt('2026-07-18T11:00:00Z'), // 169h old -> expired
  detectionAt('2026-07-25T15:10:00Z')  // a later frame -> not yet visible
];

assert.equal(PERSISTENCE_HOURS, 168, 'FIRMS persistence window drifted from the renderer age ramps');
const windowed = toFrameFeatures(windowRows, frameIso);
assert.equal(windowed.length, 2, 'a frame must carry its own pass plus unexpired earlier passes');
assert.deepEqual(
  windowed.map((feature) => feature.properties.ageHours).sort((left, right) => left - right),
  [0, 2.83],
  'every detection must carry its own age so the renderer can fade it'
);
assert.equal(
  toFrameFeatures(windowRows, frameIso, 1).length, 1,
  'shrinking the persistence window must expire older passes'
);
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
assert.match(catalogFunction, /frameCoverage\(/, 'live catalog must mark frames from the persistence window');
assert.doesNotMatch(catalogFunction, /framesWithData/, 'exact-frame-only matching must not return');
assert.match(mapSource, /featureAge/, 'renderer must honour per-detection ages over per-layer ages');

assert.match(ncnnBuild, /-std=c\+\+26/, 'ncnn executor must compile as C++26');
assert.match(ncnnSource, /use_vulkan_compute = true/, 'ncnn executor must require Vulkan compute');
assert.match(ncnnSource, /std::jthread/, 'ncnn executor must dispatch concurrent jobs');
assert.ok(!exists('tools/process_hotspot_sam2.py'), 'sequential Python SAM-2 implementation remains');

console.log('Tracker frontend, TypeScript middleware, C++ WASM, geosplat, and ncnn contracts passed.');
