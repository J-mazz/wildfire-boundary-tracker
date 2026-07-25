import firmsEngineModule from '../wasm/firms_engine.wasm';

const NIFC_QUERY =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const FIRMS_AREA = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const FIRMS_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const;

export const CADENCE_HOURS = 3;
const SEED_RADIUS_KM = 12;
const MAX_SPAN_DEGREES = 4;
const PADDING_DEGREES = 0.02;
const KM_PER_DEGREE_LATITUDE = 111.32;
const BATCH_DAYS = 4;
const MAX_HISTORY_DAYS = 10;
const RECORD_STRIDE = 64;

export type Bounds = [west: number, south: number, east: number, north: number];

export interface Env {
  FIRMS_MAP_KEY?: string;
}

export interface Incident {
  irwinId: string;
  name: string;
  discoveredAt: string | null;
  sizeAcres: number | null;
  percentContained: number | null;
  state: string | null;
  center: [longitude: number, latitude: number];
}

export interface Detection {
  lat: number;
  lon: number;
  observedAtMs: number;
  satellite: string;
  instrument: string;
  confidence: string;
  dayNight: string;
  frp: number | null;
  brightTi4: number | null;
  brightTi5: number | null;
}

export interface DetectionResult {
  detections: Detection[] | null;
  bounds: Bounds;
  reason: string | null;
}

export interface PointFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Point'; coordinates: [number, number] };
}

interface FirmsExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  firms_input(): number;
  firms_input_capacity(): number;
  firms_reset(): void;
  firms_ingest_csv(byteLength: number): number;
  firms_finalize(west: number, south: number, east: number, north: number, padding: number, maxSpan: number): number;
  firms_records(): number;
  firms_count(): number;
  firms_record_stride(): number;
  firms_bound(index: number): number;
}

interface NifcFeature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: unknown; y?: unknown };
}

interface NifcResponse {
  features?: NifcFeature[];
}

interface Batch {
  start: string;
  length: number;
  ttl: number;
}

function createEngine(): FirmsExports {
  const exports = new WebAssembly.Instance(firmsEngineModule, {}).exports;
  if (!(exports.memory instanceof WebAssembly.Memory)
    || typeof exports.firms_input !== 'function'
    || typeof exports.firms_finalize !== 'function') {
    throw new Error('FIRMS WASM engine ABI mismatch.');
  }
  return exports as FirmsExports;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function parseFireParam(value: string | null): string | null {
  const match = /^irwin:([0-9a-fA-F-]{20,40})$/.exec(value ?? '');
  return match?.[1] ?? null;
}

export function quantizeBounds(bounds: Bounds, step = 0.05): Bounds {
  const lower = (value: number): number => Math.floor(value / step) * step;
  const upper = (value: number): number => Math.ceil(value / step) * step;
  return [lower(bounds[0]), lower(bounds[1]), upper(bounds[2]), upper(bounds[3])]
    .map((value) => Math.round(value * 1e4) / 1e4) as Bounds;
}

export async function fetchIncident(irwinId: string): Promise<Incident | null> {
  const query = new URLSearchParams({
    where: `IrwinID = '{${irwinId.replace(/[{}]/g, '').toUpperCase()}}'`,
    outFields: 'IncidentName,UniqueFireIdentifier,IrwinID,FireDiscoveryDateTime,IncidentSize,PercentContained,POOState',
    returnGeometry: 'true',
    resultRecordCount: '1',
    f: 'json'
  });
  const response = await fetch(`${NIFC_QUERY}?${query}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`NIFC upstream returned ${response.status}`);
  const body: NifcResponse = await response.json();
  const feature = body.features?.[0];
  const longitude = finiteNumber(feature?.geometry?.x);
  const latitude = finiteNumber(feature?.geometry?.y);
  if (!feature?.attributes || longitude === null || latitude === null) return null;

  const attributes = feature.attributes;
  const discoveryValue = finiteNumber(attributes.FireDiscoveryDateTime);
  return {
    irwinId,
    name: stringValue(attributes.IncidentName) ?? 'Unnamed fire',
    discoveredAt: discoveryValue === null ? null : new Date(discoveryValue).toISOString(),
    sizeAcres: finiteNumber(attributes.IncidentSize),
    percentContained: finiteNumber(attributes.PercentContained),
    state: stringValue(attributes.POOState),
    center: [longitude, latitude]
  };
}

export function seedFootprint([longitude, latitude]: [number, number]): Bounds {
  const latitudeDelta = SEED_RADIUS_KM / KM_PER_DEGREE_LATITUDE;
  const longitudeDelta = SEED_RADIUS_KM
    / (KM_PER_DEGREE_LATITUDE * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  return [
    longitude - longitudeDelta,
    latitude - latitudeDelta,
    longitude + longitudeDelta,
    latitude + latitudeDelta
  ];
}

function makeBatches(dayRange: number, now: Date): Batch[] {
  const days = Math.min(MAX_HISTORY_DAYS, Math.max(1, Math.trunc(dayRange)));
  const batches: Batch[] = [];
  for (let remaining = days; remaining > 0;) {
    const length = Math.min(BATCH_DAYS, remaining);
    const start = new Date(now.getTime() - remaining * 86_400_000).toISOString().slice(0, 10);
    batches.push({ start, length, ttl: remaining <= BATCH_DAYS ? 1200 : 21_600 });
    remaining -= length;
  }
  return batches;
}

async function ingestResponse(response: Response, engine: FirmsExports): Promise<void> {
  if (!response.body) throw new Error('FIRMS response body is empty.');
  const capacity = engine.firms_input_capacity();
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > capacity) {
    throw new Error(`FIRMS CSV exceeds WASM input capacity (${declaredLength} > ${capacity}).`);
  }

  const inputOffset = engine.firms_input();
  let offset = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > capacity) {
        await reader.cancel('FIRMS CSV exceeds WASM input capacity.');
        throw new Error('FIRMS CSV exceeds WASM input capacity.');
      }
      new Uint8Array(engine.memory.buffer, inputOffset + offset, value.byteLength).set(value);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const result = engine.firms_ingest_csv(offset);
  if (result < 0) {
    const reasons: Record<number, string> = {
      [-1]: 'invalid input size',
      [-2]: 'required CSV columns missing',
      [-3]: 'detection capacity exceeded'
    };
    throw new Error(`FIRMS WASM parse failed: ${reasons[result] ?? `code ${result}`}.`);
  }
}

function fixedString(bytes: Uint8Array, offset: number, capacity: number): string {
  let end = offset;
  const limit = offset + capacity;
  while (end < limit && bytes[end] !== 0) ++end;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

function readDetections(engine: FirmsExports): Detection[] {
  const count = engine.firms_count();
  const stride = engine.firms_record_stride();
  if (stride !== RECORD_STRIDE) throw new Error(`FIRMS WASM record stride mismatch (${stride}).`);
  const pointer = engine.firms_records();
  const view = new DataView(engine.memory.buffer, pointer, count * stride);
  const bytes = new Uint8Array(engine.memory.buffer, pointer, count * stride);
  const detections: Detection[] = [];
  for (let index = 0; index < count; ++index) {
    const offset = index * stride;
    const optionalFloat = (position: number): number | null => {
      const value = view.getFloat32(offset + position, true);
      return Number.isFinite(value) ? value : null;
    };
    detections.push({
      lat: view.getFloat64(offset, true),
      lon: view.getFloat64(offset + 8, true),
      observedAtMs: Number(view.getBigInt64(offset + 16, true)),
      frp: optionalFloat(24),
      brightTi4: optionalFloat(28),
      brightTi5: optionalFloat(32),
      satellite: fixedString(bytes, offset + 36, 8),
      instrument: fixedString(bytes, offset + 44, 8),
      confidence: fixedString(bytes, offset + 52, 8),
      dayNight: fixedString(bytes, offset + 60, 2)
    });
  }
  return detections;
}

export async function fetchDetections(
  env: Env,
  bounds: Bounds,
  dayRange: number,
  cache: Cache | null,
  defer: (promise: Promise<unknown>) => void,
  now = new Date()
): Promise<DetectionResult> {
  if (!env.FIRMS_MAP_KEY) {
    return { detections: null, bounds, reason: 'FIRMS_MAP_KEY is not configured' };
  }

  const engine = createEngine();
  engine.firms_reset();
  const area = quantizeBounds(bounds).join(',');
  let successfulBatches = 0;
  for (const source of FIRMS_SOURCES) {
    for (const batch of makeBatches(dayRange, now)) {
      const upstreamUrl = `${FIRMS_AREA}/${env.FIRMS_MAP_KEY}/${source}/${area}/${batch.length}/${batch.start}`;
      const cacheKey = new Request(`https://firms-cache.internal/${source}/${area}/${batch.length}/${batch.start}`);
      let response = cache ? await cache.match(cacheKey) : undefined;
      if (!response) {
        response = await fetch(upstreamUrl, { headers: { Accept: 'text/csv' } });
        if (!response.ok) continue;
        if (cache) {
          const cached = new Response(response.clone().body, {
            headers: { 'Content-Type': 'text/csv', 'Cache-Control': `public, max-age=${batch.ttl}` }
          });
          defer(cache.put(cacheKey, cached));
        }
      }
      await ingestResponse(response, engine);
      ++successfulBatches;
    }
  }

  if (successfulBatches === 0) {
    return { detections: null, bounds, reason: 'NASA FIRMS is temporarily unavailable' };
  }

  engine.firms_finalize(...bounds, PADDING_DEGREES, MAX_SPAN_DEGREES);
  return {
    detections: readDetections(engine),
    bounds: [0, 1, 2, 3].map((index) => engine.firms_bound(index)) as Bounds,
    reason: null
  };
}

export function observedAtOf(detection: Detection): string {
  return new Date(detection.observedAtMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function frameOf(iso: string, cadenceHours = CADENCE_HOURS): string {
  const date = new Date(iso);
  date.setUTCHours(Math.floor(date.getUTCHours() / cadenceHours) * cadenceHours, 0, 0, 0);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function toFrameFeatures(rows: Detection[], frameIso: string): PointFeature[] {
  return rows.flatMap((row): PointFeature[] => {
    const observedAt = observedAtOf(row);
    if (frameOf(observedAt) !== frameIso) return [];
    const properties: Record<string, unknown> = {
      observedAt,
      satellite: row.satellite,
      instrument: row.instrument,
      confidence: row.confidence,
      dayNight: row.dayNight
    };
    if (row.frp !== null) properties.frpMw = row.frp;
    if (row.brightTi4 !== null) properties.brightnessI4K = row.brightTi4;
    if (row.brightTi5 !== null) properties.brightnessI5K = row.brightTi5;
    return [{
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: [row.lon, row.lat] }
    }];
  });
}
