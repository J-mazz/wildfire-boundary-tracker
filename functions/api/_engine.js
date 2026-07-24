// Shared engine core for the boundary tracker's Pages Functions (file is underscore-
// prefixed so Pages does not route it). NIFC seeds the footprint; FIRMS grows it.

const NIFC_QUERY =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Incident_Locations_Current/FeatureServer/0/query';

// FIRMS area API: /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{days}
const FIRMS_AREA = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const FIRMS_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'];

export const CADENCE_HOURS = 3;
const SEED_RADIUS_KM = 12;
const MAX_SPAN_DEG = 4; // hard cap so a bad id can never request a continent
const KM_PER_DEG_LAT = 111.32;

export function parseFireParam(value) {
  const match = /^irwin:([0-9a-fA-F-]{20,40})$/.exec(value ?? '');
  return match ? match[1] : null;
}

/** Quantize bounds so cache keys collapse across users viewing the same fire. */
export function quantizeBounds(bounds, step = 0.05) {
  const q = (v, up) => (up ? Math.ceil(v / step) : Math.floor(v / step)) * step;
  return [q(bounds[0], false), q(bounds[1], false), q(bounds[2], true), q(bounds[3], true)]
    .map((v) => Math.round(v * 1e4) / 1e4);
}

export async function fetchIncident(irwinId) {
  const query = new URLSearchParams({
    where: `IrwinID = '{${irwinId.replace(/[{}]/g, '').toUpperCase()}}'`,
    outFields: 'IncidentName,UniqueFireIdentifier,IrwinID,FireDiscoveryDateTime,IncidentSize,PercentContained,POOState',
    returnGeometry: 'true',
    resultRecordCount: '1',
    f: 'json'
  });
  const response = await fetch(`${NIFC_QUERY}?${query}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`NIFC upstream returned ${response.status}`);
  const body = await response.json();
  const feature = body.features?.[0];
  if (!feature?.geometry) return null;
  const { attributes: a, geometry: g } = feature;
  return {
    irwinId,
    name: a.IncidentName ?? 'Unnamed fire',
    discoveredAt: a.FireDiscoveryDateTime ? new Date(a.FireDiscoveryDateTime).toISOString() : null,
    sizeAcres: Number.isFinite(a.IncidentSize) ? a.IncidentSize : null,
    percentContained: Number.isFinite(a.PercentContained) ? a.PercentContained : null,
    state: a.POOState ?? null,
    center: [g.x, g.y]
  };
}

/** Initial footprint: NIFC origin buffered by SEED_RADIUS_KM (grown later by detections). */
export function seedFootprint([lon, lat]) {
  const dLat = SEED_RADIUS_KM / KM_PER_DEG_LAT;
  const dLon = SEED_RADIUS_KM / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

export function growFootprint(bounds, detections, padDeg = 0.02) {
  let [w, s, e, n] = bounds;
  for (const d of detections) {
    if (d.lon - padDeg < w) w = d.lon - padDeg;
    if (d.lat - padDeg < s) s = d.lat - padDeg;
    if (d.lon + padDeg > e) e = d.lon + padDeg;
    if (d.lat + padDeg > n) n = d.lat + padDeg;
  }
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  return [
    Math.max(w, cx - MAX_SPAN_DEG / 2),
    Math.max(s, cy - MAX_SPAN_DEG / 2),
    Math.min(e, cx + MAX_SPAN_DEG / 2),
    Math.min(n, cy + MAX_SPAN_DEG / 2)
  ].map((v) => Math.round(v * 1e5) / 1e5);
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const lat = Number(cols[idx.latitude]);
    const lon = Number(cols[idx.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    rows.push({
      lat,
      lon,
      acqDate: cols[idx.acq_date],
      acqTime: (cols[idx.acq_time] ?? '').padStart(4, '0'),
      satellite: cols[idx.satellite],
      instrument: cols[idx.instrument],
      confidence: cols[idx.confidence],
      frp: Number(cols[idx.frp]),
      brightTi4: Number(cols[idx.bright_ti4]),
      brightTi5: Number(cols[idx.bright_ti5]),
      dayNight: cols[idx.daynight]
    });
  }
  return rows;
}

/**
 * Fetch VIIRS detections for bounds/dayRange across constellations.
 * The area API is queried in 4-day batches (key rate-limit granularity); closed
 * historical windows cache longer than the window that includes today.
 */
export async function fetchDetections(env, bounds, dayRange, cache, waitUntil) {
  if (!env.FIRMS_MAP_KEY) return { detections: null, reason: 'FIRMS_MAP_KEY is not configured' };
  const area = quantizeBounds(bounds).join(',');
  const days = Math.min(10, Math.max(1, dayRange)); // area API serves at most 10 days back
  const BATCH_DAYS = 4;

  // Batches walk from oldest to newest: [start date, length] pairs.
  const batches = [];
  for (let remaining = days; remaining > 0; ) {
    const length = Math.min(BATCH_DAYS, remaining);
    const start = new Date(Date.now() - remaining * 86_400_000).toISOString().slice(0, 10);
    const includesToday = remaining <= BATCH_DAYS;
    batches.push({ start, length, ttl: includesToday ? 1200 : 21_600 });
    remaining -= length;
  }

  const all = [];
  for (const source of FIRMS_SOURCES) {
    for (const { start, length, ttl } of batches) {
      const url = `${FIRMS_AREA}/${env.FIRMS_MAP_KEY}/${source}/${area}/${length}/${start}`;
      const cacheKey = new Request(`https://firms-cache.internal/${source}/${area}/${length}/${start}`);
      let response = cache ? await cache.match(cacheKey) : null;
      if (!response) {
        response = await fetch(url);
        if (!response.ok) continue; // one batch failing must not sink the rest
        if (cache && waitUntil) {
          const toStore = new Response(response.clone().body, {
            headers: { 'Cache-Control': `public, max-age=${ttl}` }
          });
          waitUntil(cache.put(cacheKey, toStore));
        }
      }
      all.push(...parseCsv(await response.text()));
    }
  }
  return { detections: all, reason: null };
}

export function observedAtOf(row) {
  return `${row.acqDate}T${row.acqTime.slice(0, 2)}:${row.acqTime.slice(2)}:00Z`;
}

/** Floor an ISO timestamp to its cadence frame start. */
export function frameOf(iso, cadenceHours = CADENCE_HOURS) {
  const date = new Date(iso);
  date.setUTCHours(Math.floor(date.getUTCHours() / cadenceHours) * cadenceHours, 0, 0, 0);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Bucket detections into cadence frames; mirrors tools/import_firms.py properties. */
export function toFrameFeatures(rows, frameIso) {
  const features = [];
  const seen = new Set();
  for (const row of rows) {
    const observedAt = observedAtOf(row);
    if (frameOf(observedAt) !== frameIso) continue;
    const identity = `${row.satellite}|${observedAt}|${row.lat}|${row.lon}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const properties = { observedAt, satellite: row.satellite, instrument: row.instrument, confidence: row.confidence, dayNight: row.dayNight };
    if (Number.isFinite(row.frp)) properties.frpMw = row.frp;
    if (Number.isFinite(row.brightTi4)) properties.brightnessI4K = row.brightTi4;
    if (Number.isFinite(row.brightTi5)) properties.brightnessI5K = row.brightTi5;
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [row.lon, row.lat] } });
  }
  return features;
}
