const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
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
const appCoordinatorSource = read('src/ts/app/AppCoordinator.ts');
const mapSource = read('src/ts/core/MapController.ts');
const vectorLayerSource = read('src/ts/core/VectorLayerData.ts');
const geosplatSource = read('src/ts/core/GeosplatLayer.ts');
const catalogFunction = read('functions/api/catalog.ts');
const catalogBuilder = read('functions/api/engine/catalog-builder.ts');
const calculations = read('functions/api/engine/calculations.ts');
const firmsOrchestration = read('functions/api/engine/firms.ts');
const nifcClient = read('functions/api/engine/nifc.ts');
const wasmAdapter = read('functions/api/engine/wasm.ts');
const workerEngineSources = [
  catalogBuilder,
  calculations,
  firmsOrchestration,
  nifcClient,
  wasmAdapter
].join('\n');
const catalogSources = [catalogFunction, workerEngineSources].join('\n');
const incidentsFunction = read('functions/api/incidents.ts');
const perimeterFunction = read('functions/api/perimeter.ts');
const httpMiddleware = read('functions/api/_http.ts');
const ncnnSource = read('src/native/ncnn_vulkan_batch.cpp');
const cppBuildDriver = read('tools/cpp_build.mjs');
const cppManifest = JSON.parse(read('tools/cpp_build_manifest.json'));
const ciWorkflow = read('.github/workflows/deploy-pages.yml');

assert.match(landing, /Current wildfires/, 'root must be the NIFC incident picker');
assert.match(landing, /fires\.js/, 'landing page script missing');
assert.doesNotMatch(landing, /client\.js|id="map"/, 'landing page must not boot the map renderer');
assert.match(mapPage, /id="map"/, 'map entrypoint missing');
assert.match(mapPage, /id="terrain-button"/, '3D terrain capability must remain available');
assert.match(mapPage, /client\.js/, 'map entrypoint must load the TypeScript frontend bundle');
assert.ok(!exists('dist/data'), 'generic tracker must not deploy curated East Evans data');
assert.ok(
  exists('dist/wasm/wildfire.js') && exists('dist/wasm/wildfire.wasm'),
  'browser WASM/geosplat runtime missing'
);
assert.ok(exists('functions/wasm/firms_engine.wasm'), 'Worker compute WASM missing');

assert.match(mainSource, /api\/catalog\?fire=/, 'frontend must use the live catalog endpoint');
assert.doesNotMatch(mainSource, /data\/catalog\.json/, 'generic frontend must not fall back to a curated catalog');
assert.match(appCoordinatorSource, /setTerrainMetadataUrl/, 'terrain must be capability-gated by catalog metadata');
assert.match(mapSource, /GeosplatLayer/, 'MapController lost DEM geosplat support');
assert.match(geosplatSource, /metadataUrl/, 'geosplat metadata must be catalog-selectable');
assert.match(bundle, /wildfire-geosplat/, 'geosplat renderer was not bundled');

assert.equal(cppManifest.standard, 'c++26', 'C++ build graph must compile as C++26');
assert.equal(cppManifest.modules.std.kind, 'standard-library', 'standard library module missing');
assert.match(cppBuildDriver, /'-fmodules'/, 'C++ targets must enable Clang modules');
assert.match(cppBuildDriver, /CXX_HOST_STDLIB/, 'host standard library selection missing');
assert.match(ciWorkflow, /CXX_HOST_STDLIB: libc\+\+/, 'CI must select the installed libc++ module');
assert.match(ciWorkflow, /libc\+\+-18-dev libc\+\+abi-18-dev/, 'CI libc++ module packages missing');
for (const [moduleName, definition] of Object.entries(cppManifest.modules)) {
  if (definition.kind === 'standard-library') continue;
  assert.ok(definition.imports.includes('std'), `${moduleName} must import std`);
  for (const sourcePath of [definition.interface, definition.implementation].filter(Boolean)) {
    const source = read(sourcePath);
    assert.match(source, /import std;/, `${sourcePath} must consume the standard library module`);
    assert.doesNotMatch(source, /#include\s*</, `${sourcePath} retained textual standard library includes`);
  }
}
const browserTarget = cppManifest.targets['browser-wasm'];
const workerTarget = cppManifest.targets['worker-wasm'];
const nativeTarget = cppManifest.targets['native-ncnn'];
assert.ok(browserTarget.modules.includes('wildfire.geosplat'), 'browser target lost geosplat decoding');
assert.ok(browserTarget.modules.includes('wildfire.memory'), 'browser target lost shared memory module');
assert.ok(workerTarget.modules.includes('wildfire.memory'), 'Worker target lost shared memory module');
assert.ok(nativeTarget.modules.includes('wildfire.memory'), 'native target lost shared memory module');
assert.ok(workerTarget.linkFlags.includes('-sSTANDALONE_WASM=1'), 'Worker WASM must not use browser glue');
assert.ok(workerTarget.linkFlags.includes('-sINITIAL_MEMORY=20971520'), 'Worker WASM memory budget drifted');
assert.ok(nativeTarget.compileFlags.includes('-O3'), 'native target must retain optimized compilation');
assert.doesNotMatch(
  JSON.stringify(browserTarget),
  /flatbuffer|buffer_parser|renderer\.cppm|shader_manager|initialize_webgl_context|render_frame/,
  'dead SceneGraph pipeline returned'
);

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

assert.match(catalogBuilder, /startedAt:/, 'live catalog event metadata is incomplete');
assert.match(catalogBuilder, /status: hasData \|\| hasCurrentPerimeter \? 'ready' : 'awaiting-data'/, 'snapshot readiness must include every visible live overlay');
assert.match(catalogBuilder, /if \(!hasData\)[\s\S]*status: 'unavailable'/, 'layer status contract drifted');
assert.match(wasmAdapter, /firmsEngineModule/, 'TypeScript middleware must invoke C++ WASM');
assert.doesNotMatch(workerEngineSources, /split\('\n'\)|parseCsv/, 'FIRMS CSV parsing leaked back into TypeScript');
assert.match(firmsOrchestration, /await Promise\.all\(FIRMS_SOURCES\.flatMap/, 'FIRMS fetch lanes must run concurrently');
assert.match(httpMiddleware, /withApiErrors/, 'Pages Functions must share a sanitized error boundary');
assert.match(httpMiddleware, /UPSTREAM_TIMEOUT_MS/, 'upstream requests must have a bounded lifetime');
assert.ok(firmsOrchestration.indexOf('await ingestResponse') < firmsOrchestration.indexOf('defer(cache.put'), 'FIRMS payload must parse before entering cache');
assert.match(firmsOrchestration, /defer\(cache\.delete\(item\.cacheKey\), 'firms_batch_cache_delete'\)/, 'invalid cached FIRMS payloads must be evicted');
assert.match(calculations, /Math\.sqrt\(sizeAcres \* 4046\.86 \/ Math\.PI\)/, 'incident acreage must grow the FIRMS query footprint');
assert.match(nifcClient, /WFIGS_Interagency_Perimeters_Current/, 'live engine must query the official current perimeter service');
assert.match(nifcClient, /poly_IRWINID = '\{\$\{normalizedId\}\}'/, 'perimeter lookup must use the indexed braced IRWIN ID');
assert.match(catalogBuilder, /Current WFIGS incident perimeter/, 'live catalog must expose an operational perimeter when available');
assert.match(catalogBuilder, /index === input\.plan\.frameTimes\.length - 1/, 'a current perimeter must not masquerade as historical progression');
assert.match(perimeterFunction, /fetchCurrentPerimeter/, 'perimeter endpoint must use the validated engine helper');
assert.doesNotMatch(incidentsFunction, /IncidentSize > 0/, 'new zero-size incidents must remain discoverable');
for (const endpoint of ['_engine', 'catalog', 'firms', 'incidents', 'perimeter']) {
  assert.ok(exists(`functions/api/${endpoint}.ts`), `${endpoint} Pages Function must be TypeScript`);
  assert.ok(!exists(`functions/api/${endpoint}.js`), `${endpoint} legacy JavaScript Function remains`);
}

assert.match(catalogBuilder, /frameCoverage\(/, 'live catalog must mark frames from the persistence window');
assert.doesNotMatch(catalogSources, /framesWithData/, 'exact-frame-only matching must not return');
assert.match(vectorLayerSource, /featureAge/, 'renderer must honour per-detection ages over per-layer ages');
assert.match(ncnnSource, /use_vulkan_compute = true/, 'ncnn executor must require Vulkan compute');
assert.match(ncnnSource, /std::jthread/, 'ncnn executor must dispatch concurrent jobs');
assert.ok(!exists('tools/process_hotspot_sam2.py'), 'sequential Python SAM-2 implementation remains');

console.log('Deployment, build graph, and source contracts passed.');
