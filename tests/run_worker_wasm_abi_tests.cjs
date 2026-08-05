const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workerWasm = fs.readFileSync(path.join(root, 'functions/wasm/firms_engine.wasm'));
const wasmModule = new WebAssembly.Module(workerWasm);
assert.deepEqual(WebAssembly.Module.imports(wasmModule), [], 'Worker WASM must be import-free');

const exportedNames = new Set(WebAssembly.Module.exports(wasmModule).map((entry) => entry.name));
for (const name of [
  'memory',
  'firms_input',
  'firms_input_capacity',
  'firms_reset',
  'firms_ingest_csv',
  'firms_finalize',
  'firms_records',
  'firms_count',
  'firms_record_stride',
  'firms_bound'
]) assert.ok(exportedNames.has(name), `Worker WASM export missing: ${name}`);

const engine = new WebAssembly.Instance(wasmModule, {}).exports;
assert.equal(engine.firms_input_capacity(), 8 * 1024 * 1024, 'FIRMS input ABI capacity drifted');
assert.equal(engine.firms_record_stride(), 64, 'C++/TypeScript record ABI drifted');

const ingest = (contents) => {
  const csv = Buffer.from(contents);
  new Uint8Array(engine.memory.buffer, engine.firms_input(), csv.length).set(csv);
  return engine.firms_ingest_csv(csv.length);
};

engine.firms_reset();
assert.equal(ingest([
  'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,bright_ti4,bright_ti5,daynight',
  '42.5,-116.1,2026-07-24,2201,N,VIIRS,n,10.5,336.2,300.5,D',
  '42.5,-116.1,2026-07-24,2201,N,VIIRS,n,10.5,336.2,300.5,D',
  '42.6,-116.0,2026-07-24,2315,N20,VIIRS,h,20.0,340.0,301.0,N'
].join('\n')), 3, 'C++ parser must ingest every CSV row');
assert.equal(engine.firms_finalize(-116.2, 42.4, -115.9, 42.7, 0.02, 4), 2, 'C++ engine must deduplicate rows');
const records = new DataView(engine.memory.buffer, engine.firms_records(), 128);
assert.equal(records.getFloat64(0, true), 42.5);
assert.equal(records.getFloat64(8, true), -116.1);
assert.equal(Number(records.getBigInt64(16, true)), Date.parse('2026-07-24T22:01:00Z'));

engine.firms_reset();
assert.equal(ingest('Exceeded transaction limit'), -2, 'HTTP 200 FIRMS error text must fail CSV validation');
assert.equal(engine.firms_count(), 0, 'invalid FIRMS bodies must not add records');

engine.firms_reset();
assert.equal(ingest([
  'latitude,longitude,acq_date,acq_time,satellite',
  '91,-116.1,2026-07-24,2201,N',
  '42.5,-181,2026-07-24,2201,N',
  '42.5,-116.1,2026-02-30,2201,N',
  '42.5,-116.1,2026-07-24,4294969497,N'
].join('\n')), 0, 'invalid coordinates, dates, and overflowing times must be rejected');

engine.firms_reset();
assert.equal(ingest([
  'latitude,longitude,acq_date,acq_time,satellite',
  '-90,-180,2028-02-29,0001,N',
  '90,180,2028-02-29,2359,N20'
].join('\r\n')), 2, 'coordinate extrema and Gregorian leap days must remain accepted');

console.log('Worker Wasm imports, exports, record ABI, and FIRMS behavior passed.');
