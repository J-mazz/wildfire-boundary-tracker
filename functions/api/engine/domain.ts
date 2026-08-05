export const CADENCE_HOURS = 3;
export const MAX_HISTORY_DAYS = 10;
export const FRAME_CACHE_SECONDS = 1800;
export const PERIMETER_CACHE_SECONDS = 300;
export const CATALOG_CACHE_SECONDS = 300;
export const PERSISTENCE_HOURS = 168;

export type Bounds = [west: number, south: number, east: number, north: number];

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
  timeline: FirmsTimeline | null;
  bounds: Bounds;
  reason: string | null;
}

export interface PointFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface PerimeterResult {
  collection: Record<string, unknown> & { type: 'FeatureCollection'; features: unknown[] };
  featureCount: number;
  observedAt: string | null;
}

export interface FrameCoverage {
  featureCount: number;
  newestObservedAt: string | null;
}

export interface FrameRange extends FrameCoverage {
  beginIndex: number;
}

export interface FirmsTimeline {
  coverage(frameTimes: readonly number[], persistenceHours?: number): FrameCoverage[];
  range(frameTime: number, persistenceHours?: number): FrameRange;
}

export type Defer = (promise: Promise<unknown>, operation: string) => void;
