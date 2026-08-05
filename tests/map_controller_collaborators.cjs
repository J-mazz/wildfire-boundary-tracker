const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'build', 'tests');
fs.mkdirSync(outputDir, { recursive: true });

const loadModule = (name) => {
  const outfile = path.join(outputDir, `${path.basename(name)}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(root, 'src', 'ts', 'core', `${name}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile
  });
  delete require.cache[outfile];
  return require(outfile);
};

const {
  decorateFeatures,
  validateFeatureCollection,
  VectorLayerData
} = loadModule('VectorLayerData');
const {
  LAYER_SENTINEL,
  OPERATIONAL_LAYERS,
  ORDERED_OVERLAY_LAYER_IDS,
  SOURCE_OPERATIONAL,
  SOURCE_SENTINEL,
  persistentLayers
} = loadModule('MapStyle');
const { MapOverlayManager } = loadModule('MapOverlayManager');
const { SentinelRaster } = loadModule('SentinelRaster');

const layer = (id, url, overrides = {}) => ({
  id,
  label: id,
  kind: 'firms',
  format: 'geojson',
  status: 'ready',
  url,
  ...overrides
});
const collection = (properties = {}, geometry = { type: 'Point', coordinates: [-120, 40] }) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties, geometry }]
});
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

assert.throws(
  () => validateFeatureCollection({ type: 'FeatureCollection', features: null }, '/invalid'),
  /Invalid GeoJSON feature collection/
);
const decorated = decorateFeatures(collection({ ageHours: 3 }), layer('firms', '/firms', {
  ageHours: 9,
  contextType: 'thermal',
  sourceObservedAt: '2026-08-04T20:00:00Z'
}));
assert.deepEqual(decorated[0].properties, {
  ageHours: 3,
  contextType: 'thermal',
  sourceObservedAt: '2026-08-04T20:00:00Z',
  sourceLayerId: 'firms'
});
assert.equal(decorateFeatures(collection({}, null), layer('empty', '/empty')).length, 0);

const exerciseVectorCache = async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (url === '/failure') return response({}, 503);
    if (url === '/per-feature') return response(collection({ ageHours: 4 }));
    return response(collection({ url }));
  };
  const vectors = new VectorLayerData(fetcher, 2);
  const pending = vectors.load(layer('a', '/a'));
  assert.strictEqual(vectors.load(layer('a-copy', '/a')), pending, 'pending requests must be shared');
  await pending;
  await vectors.load(layer('b', '/b'));
  await vectors.load(layer('c', '/c'));
  await vectors.load(layer('a-reloaded', '/a'));
  assert.deepEqual(calls, ['/a', '/b', '/c', '/a'], 'oldest cache entry must be evicted at capacity');
  await assert.rejects(vectors.load(layer('failure', '/failure')), /returned 503/);
  await assert.rejects(vectors.load(layer('failure-again', '/failure')), /returned 503/);
  assert.equal(calls.filter((url) => url === '/failure').length, 2, 'failed requests must leave the cache');

  const merged = await vectors.merge([
    layer('observed', '/observed', { ageHours: 12 }),
    layer('per-feature', '/per-feature', { ageHours: 24 })
  ]);
  assert.deepEqual(
    merged.features.map((feature) => feature.properties.ageHours),
    [12, 4],
    'per-feature ages must take precedence over the layer age'
  );
};

class FakeMap {
  constructor(layers = []) {
    this.layers = layers;
    this.sources = new Map();
    this.visibility = new Map();
    this.beforeIds = [];
  }

  addLayer(specification, beforeId) {
    this.layers.push({ id: specification.id, type: specification.type });
    this.beforeIds.push(beforeId);
  }

  addSource(id, specification) {
    this.sources.set(id, specification);
  }

  getLayer(id) {
    return this.layers.find((entry) => entry.id === id);
  }

  getSource(id) {
    return this.sources.get(id);
  }

  getStyle() {
    return { layers: this.layers };
  }

  moveLayer(id) {
    const index = this.layers.findIndex((entry) => entry.id === id);
    this.layers.push(...this.layers.splice(index, 1));
  }

  removeLayer(id) {
    this.layers.splice(this.layers.findIndex((entry) => entry.id === id), 1);
  }

  removeSource(id) {
    this.sources.delete(id);
  }

  setLayoutProperty(id, property, value) {
    this.visibility.set(`${id}:${property}`, value);
  }
}

const styleIds = persistentLayers().map(({ id }) => id);
assert.equal(new Set(styleIds).size, styleIds.length, 'persistent layer IDs must be unique');
assert.ok(
  ORDERED_OVERLAY_LAYER_IDS.every((id) => id === 'event-area-outline' || styleIds.includes(id)),
  'overlay ordering must only reference persistent layers and the event outline'
);

const overlayMap = new FakeMap([
  ...ORDERED_OVERLAY_LAYER_IDS.map((id) => ({ id, type: 'line' })),
  { id: 'sentinel', type: 'raster' }
]);
const overlays = new MapOverlayManager(overlayMap);
overlays.setVisibility(SOURCE_OPERATIONAL, true);
assert.ok(
  OPERATIONAL_LAYERS.every((id) => overlayMap.visibility.get(`${id}:visibility`) === 'visible'),
  'operational visibility must update every context and incident layer'
);
overlays.raise();
assert.deepEqual(
  overlayMap.layers.slice(-ORDERED_OVERLAY_LAYER_IDS.length).map(({ id }) => id),
  [...ORDERED_OVERLAY_LAYER_IDS],
  'overlay raise order must remain deterministic'
);

const sentinelMap = new FakeMap([{ id: 'sam-body-fill', type: 'fill' }]);
const sentinel = new SentinelRaster(sentinelMap);
sentinel.set(layer('sentinel-a', undefined, {
  kind: 'sentinel-raster',
  format: 'xyz',
  tiles: ['/tiles/{z}/{x}/{y}.png'],
  bounds: [-121, 39, -119, 41],
  opacity: 0.6
}), false);
assert.equal(sentinelMap.sources.get(SOURCE_SENTINEL).type, 'raster');
assert.equal(sentinelMap.beforeIds.at(-1), 'sam-body-fill');
sentinel.setTerrainMode(true);
assert.equal(sentinelMap.visibility.get(`${LAYER_SENTINEL}:visibility`), 'none');
sentinel.set(layer('sentinel-b', '/image.png', {
  kind: 'sentinel-raster',
  format: 'image',
  bounds: [-121, 39, -119, 41]
}), false);
assert.equal(sentinelMap.sources.get(SOURCE_SENTINEL).type, 'image', 'replacement must remove the old source');

exerciseVectorCache()
  .then(() => console.log('MapController collaborator contracts passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
