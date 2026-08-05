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

const { fetchIncidents, validateIncidentFeed } = bundle(
  'src/ts/landing/incidents.ts',
  'landing-incidents.cjs'
);
const { acresLabel, matchingIncidents, renderIncidents } = bundle(
  'src/ts/landing/render.ts',
  'landing-render.cjs'
);

const incident = (overrides = {}) => ({
  irwinId: 'abc/123',
  uniqueId: null,
  name: 'Creek Fire',
  discoveredAt: '2026-08-01T12:30:00Z',
  sizeAcres: 1250,
  percentContained: 40,
  state: 'OR',
  lon: -122.5,
  lat: 42.1,
  ...overrides
});
const feed = (incidents) => ({
  generatedAt: '2026-08-04T12:00:00Z',
  source: 'NIFC WFIGS',
  incidents
});

assert.deepEqual(validateIncidentFeed(feed([incident()])).incidents, [incident()]);
assert.throws(
  () => validateIncidentFeed(feed([{ ...incident(), sizeAcres: 'large' }])),
  /incidents\[0\]\.sizeAcres/
);
const sparse = [];
sparse.length = 1;
assert.throws(() => validateIncidentFeed(feed(sparse)), /incidents\[0\]/);
assert.equal(acresLabel(999.5), '1000 acres');
assert.equal(acresLabel(1250), '1.3k acres');
assert.equal(acresLabel(null), '');
assert.deepEqual(matchingIncidents([incident()], ' or '), [incident()]);
assert.deepEqual(matchingIncidents([incident()], 'missing'), []);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.textContent = '';
    this.href = '';
    this.listeners = new Map();
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  dispatch(name) {
    this.listeners.get(name)?.();
  }
}

class FakeList extends FakeElement {}
class FakeInput extends FakeElement {
  constructor(tagName) {
    super(tagName);
    this.value = '';
  }
}

global.HTMLElement = FakeElement;
global.HTMLUListElement = FakeList;
global.HTMLInputElement = FakeInput;

const elements = new Map();
const document = {
  createElement: (tagName) => new FakeElement(tagName),
  getElementById: (id) => elements.get(id) ?? null
};
const list = new FakeElement('ul');
const status = new FakeElement('p');
renderIncidents(document, list, status, [incident()]);
assert.equal(status.textContent, '1 current incident');
assert.equal(list.children.length, 1);
const link = list.children[0].children[0];
assert.equal(link.href, './map.html?fire=irwin:abc%2F123');
assert.equal(link.children[0].textContent, 'Creek Fire');
assert.equal(
  link.children[1].textContent,
  'OR · 1.3k acres · 40% contained · since 2026-08-01'
);
renderIncidents(document, list, status, [incident()], 'missing');
assert.equal(status.textContent, 'No fires match.');
assert.equal(list.children.length, 0);

void (async () => {
  const loaded = await fetchIncidents(
    async () => new Response(JSON.stringify(feed([incident()])))
  );
  assert.deepEqual(loaded, [incident()]);
  await assert.rejects(
    fetchIncidents(async () => new Response('', { status: 503 })),
    /Server returned 503/
  );
  const { startLandingPage } = bundle(
    'src/ts/landing/controller.ts',
    'landing-controller.cjs'
  );
  const controllerList = new FakeList('ul');
  const controllerStatus = new FakeElement('p');
  const search = new FakeInput('input');
  elements.set('fires-list', controllerList);
  elements.set('fires-status', controllerStatus);
  elements.set('fire-search', search);
  let resolveLoading;
  const loading = startLandingPage(
    document,
    async () => new Promise((resolve) => {
      resolveLoading = resolve;
    })
  );
  search.value = 'missing';
  search.dispatch('input');
  assert.equal(controllerStatus.textContent, '');
  resolveLoading(new Response(JSON.stringify(feed([incident()]))));
  await loading;
  assert.equal(controllerStatus.textContent, 'No fires match.');
  await startLandingPage(
    document,
    async () => new Response('', { status: 502 })
  );
  assert.equal(
    controllerStatus.textContent,
    'Could not load incidents: Server returned 502'
  );
  search.dispatch('input');
  assert.equal(
    controllerStatus.textContent,
    'Could not load incidents: Server returned 502'
  );
  console.log('Typed landing incident validation and DOM rendering passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
