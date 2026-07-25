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
run('npm', ['run', 'build']);

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
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

assert.match(catalogFunction, /startedAt:/, 'live catalog event metadata is incomplete');
assert.match(catalogFunction, /status: hasData \? 'ready' : 'awaiting-data'/, 'snapshot status contract drifted');
assert.match(catalogFunction, /status: hasData \? 'ready' : 'unavailable'/, 'layer status contract drifted');
assert.match(workerMiddleware, /firmsEngineModule/, 'TypeScript middleware must invoke C++ WASM');
assert.doesNotMatch(workerMiddleware, /split\('\n'\)|parseCsv/, 'FIRMS CSV parsing leaked back into TypeScript');
for (const endpoint of ['_engine', 'catalog', 'firms', 'incidents']) {
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
assert.match(workerBuild, /-std=c\+\+26/, 'Worker WASM must compile as C++26');
assert.match(workerBuild, /STANDALONE_WASM=1/, 'Worker WASM must not use browser glue');

assert.match(ncnnBuild, /-std=c\+\+26/, 'ncnn executor must compile as C++26');
assert.match(ncnnSource, /use_vulkan_compute = true/, 'ncnn executor must require Vulkan compute');
assert.match(ncnnSource, /std::jthread/, 'ncnn executor must dispatch concurrent jobs');
assert.ok(!exists('tools/process_hotspot_sam2.py'), 'sequential Python SAM-2 implementation remains');

console.log('Tracker frontend, TypeScript middleware, C++ WASM, geosplat, and ncnn contracts passed.');
