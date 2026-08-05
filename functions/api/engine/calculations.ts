import {
  CADENCE_HOURS,
  PERSISTENCE_HOURS,
  type Bounds,
  type Detection,
  type FrameCoverage,
  type PointFeature
} from './domain';

const SEED_RADIUS_KM = 12;
const KM_PER_DEGREE_LATITUDE = 111.32;

export function quantizeBounds(bounds: Bounds, step = 0.05): Bounds {
  const lower = (value: number): number => Math.floor(value / step) * step;
  const upper = (value: number): number => Math.ceil(value / step) * step;
  return [lower(bounds[0]), lower(bounds[1]), upper(bounds[2]), upper(bounds[3])]
    .map((value) => Math.round(value * 1e4) / 1e4) as Bounds;
}

export function seedFootprint(
  [longitude, latitude]: [number, number],
  sizeAcres: number | null = null
): Bounds {
  const areaRadiusKm = sizeAcres !== null && sizeAcres > 0
    ? Math.sqrt(sizeAcres * 4046.86 / Math.PI) / 1000
    : 0;
  const radiusKm = Math.max(SEED_RADIUS_KM, areaRadiusKm);
  const latitudeDelta = radiusKm / KM_PER_DEGREE_LATITUDE;
  const longitudeDelta = radiusKm
    / (KM_PER_DEGREE_LATITUDE * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  return [
    longitude - longitudeDelta,
    latitude - latitudeDelta,
    longitude + longitudeDelta,
    latitude + latitudeDelta
  ];
}

export function observedAtOf(detection: Detection): string {
  return new Date(detection.observedAtMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function frameOf(iso: string, cadenceHours = CADENCE_HOURS): string {
  const date = new Date(iso);
  date.setUTCHours(Math.floor(date.getUTCHours() / cadenceHours) * cadenceHours, 0, 0, 0);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function validFrameParam(frame: string, days: number, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(frame)) return false;
  const frameMs = Date.parse(frame);
  if (!Number.isFinite(frameMs) || new Date(frameMs).getUTCHours() % CADENCE_HOURS !== 0) return false;
  const latestFrameMs = Date.parse(frameOf(now.toISOString()));
  const earliestFrameMs = latestFrameMs - days * 86_400_000;
  return frameMs >= earliestFrameMs && frameMs <= latestFrameMs;
}

export function frameStartMs(observedAtMs: number, cadenceHours = CADENCE_HOURS): number {
  const date = new Date(observedAtMs);
  date.setUTCHours(Math.floor(date.getUTCHours() / cadenceHours) * cadenceHours, 0, 0, 0);
  return date.getTime();
}

function frameFeatureProperties(row: Detection, ageMs: number): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    observedAt: observedAtOf(row),
    ageHours: Math.round(Math.max(0, ageMs) / 36_000) / 100,
    satellite: row.satellite,
    instrument: row.instrument,
    confidence: row.confidence,
    dayNight: row.dayNight
  };
  if (row.frp !== null) properties.frpMw = row.frp;
  if (row.brightTi4 !== null) properties.brightnessI4K = row.brightTi4;
  if (row.brightTi5 !== null) properties.brightnessI5K = row.brightTi5;
  return properties;
}

function toFrameFeature(row: Detection, frameMs: number, windowMs: number): PointFeature | null {
  if (frameStartMs(row.observedAtMs) > frameMs) return null;
  const ageMs = frameMs - row.observedAtMs;
  if (ageMs > windowMs) return null;
  return {
    type: 'Feature',
    properties: frameFeatureProperties(row, ageMs),
    geometry: { type: 'Point', coordinates: [row.lon, row.lat] }
  };
}

export function toFrameFeatures(
  rows: Detection[],
  frameIso: string,
  persistenceHours = PERSISTENCE_HOURS
): PointFeature[] {
  const frameMs = Date.parse(frameIso);
  const windowMs = persistenceHours * 3_600_000;
  return rows.flatMap((row): PointFeature[] => {
    const feature = toFrameFeature(row, frameMs, windowMs);
    return feature ? [feature] : [];
  });
}

export function frameCoverage(
  rows: Detection[],
  frameTimes: number[],
  persistenceHours = PERSISTENCE_HOURS
): FrameCoverage[] {
  const windowMs = persistenceHours * 3_600_000;
  const sorted = [...rows].sort((left, right) => left.observedAtMs - right.observedAtMs);
  const coverage: FrameCoverage[] = [];
  let head = 0;
  let tail = 0;
  for (const frameMs of frameTimes) {
    while (head < sorted.length && frameStartMs(sorted[head]!.observedAtMs) <= frameMs) ++head;
    while (tail < head && frameMs - sorted[tail]!.observedAtMs > windowMs) ++tail;
    coverage.push({
      featureCount: head - tail,
      newestObservedAt: head > tail ? observedAtOf(sorted[head - 1]!) : null
    });
  }
  return coverage;
}
