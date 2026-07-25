export type SnapshotStatus = 'ready' | 'processing' | 'awaiting-data';
export type LayerStatus = 'ready' | 'processing' | 'unavailable';
export type LayerKind = 'sentinel-raster' | 'sam-mask' | 'firms' | 'kml';
export type LayerFormat = 'xyz' | 'image' | 'geojson' | 'kml';
export type Bounds = [west: number, south: number, east: number, north: number];

export interface EventConfiguration {
  id: string;
  name: string;
  startedAt: string;
  center: [longitude: number, latitude: number];
  bounds: Bounds;
}

export interface BaseImagery {
  tiles: string[];
  attribution: string;
  maxzoom?: number;
  minzoom?: number;
  tileSize?: number;
}

export interface TerrainConfig {
  metadataUrl: string;
}

export interface AppConfig {
  title: string;
  tagline: string;
  initialZoom?: number;
  baseImagery: BaseImagery;
  terrain?: TerrainConfig;
  simplifyToleranceMeters?: number;
}

/** Build-time JSON island (`#fire-bootstrap`) so first paint focuses the right fire. */
export interface FireBootstrap {
  title: string;
  tagline: string;
  center: [longitude: number, latitude: number];
  initialZoom: number;
  bounds: Bounds;
  baseImagery: BaseImagery | null;
}

export interface SnapshotLayer {
  id: string;
  label: string;
  kind: LayerKind;
  format?: LayerFormat;
  status: LayerStatus;
  contextType?: string;
  statusReason?: string;
  sourceObservedAt?: string;
  ageHours?: number;
  featureCount?: number;
  cloudCoverPercent?: number;
  composite?: string;
  model?: string;
  promptCount?: number;
  sourceLagHours?: number;
  url?: string;
  tiles?: string[];
  bounds?: Bounds;
  opacity?: number;
  attribution?: string;
}

export interface SnapshotSpecifications {
  sourceIds?: string[];
  cloudCoverPercent?: number;
  samModel?: string;
  notes?: string;
}

export interface Snapshot {
  id: string;
  observedAt: string;
  publishedAt?: string;
  label: string;
  status: SnapshotStatus;
  layers: SnapshotLayer[];
  specifications?: SnapshotSpecifications;
}

export interface TimelineConfig {
  startAt: string;
  endAt: string;
  cadenceHours: number;
}

export interface SnapshotCatalog {
  version: string;
  updatedAt: string;
  pollIntervalSeconds: number;
  event: EventConfiguration;
  app?: AppConfig;
  timeline?: TimelineConfig;
  snapshots: Snapshot[];
}
