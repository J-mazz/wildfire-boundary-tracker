import type {
  AppConfig,
  EventConfiguration,
  Snapshot,
  SnapshotCatalog,
  SnapshotLayer,
  TimelineConfig
} from '../types';

const SNAPSHOT_STATUSES = new Set(['ready', 'processing', 'awaiting-data']);
const LAYER_STATUSES = new Set(['ready', 'processing', 'unavailable']);
const LAYER_KINDS = new Set(['sentinel-raster', 'sam-mask', 'firms', 'kml']);
const LAYER_FORMATS = new Set(['xyz', 'image', 'geojson', 'kml']);

function invalid(path: string, message: string): never {
  throw new Error(`Catalog validation failed at ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value)
    && value.length === length
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function hasEventMetadata(event: Record<string, unknown>): boolean {
  return typeof event.id === 'string'
    && typeof event.name === 'string'
    && typeof event.startedAt === 'string';
}

function validCenter(center: number[]): boolean {
  const [longitude, latitude] = center;
  return !(Math.abs(longitude!) > 180 || Math.abs(latitude!) > 90);
}

function validBounds(bounds: number[]): boolean {
  const [west, south, east, north] = bounds;
  return !(west! < -180 || east! > 180 || south! < -90 || north! > 90
    || west! >= east! || south! >= north!);
}

export function validateEvent(value: unknown, path = 'event'): EventConfiguration {
  if (!isRecord(value) || !hasEventMetadata(value)) {
    invalid(path, 'Catalog event metadata is incomplete.');
  }
  if (!finiteTuple(value.center, 2)) {
    invalid(`${path}.center`, 'Catalog event center or bounds are invalid.');
  }
  if (!finiteTuple(value.bounds, 4)) {
    invalid(`${path}.bounds`, 'Catalog event center or bounds are invalid.');
  }
  if (!validCenter(value.center) || !validBounds(value.bounds)) {
    invalid(path, 'Catalog event coordinates are outside valid geographic bounds.');
  }
  return value as unknown as EventConfiguration;
}

export function validateApp(value: unknown, path = 'app'): AppConfig {
  if (!isRecord(value)
    || typeof value.title !== 'string'
    || typeof value.tagline !== 'string'
    || !isRecord(value.baseImagery)
    || !stringArray(value.baseImagery.tiles)
    || typeof value.baseImagery.attribution !== 'string') {
    invalid(path, 'Catalog app configuration is invalid.');
  }
  return value as unknown as AppConfig;
}

export function validateTimeline(value: unknown, path = 'timeline'): TimelineConfig {
  if (!isRecord(value)
    || typeof value.startAt !== 'string'
    || typeof value.endAt !== 'string'
    || typeof value.cadenceHours !== 'number'
    || !Number.isInteger(value.cadenceHours)
    || value.cadenceHours <= 0) {
    invalid(path, 'Catalog timeline configuration is invalid.');
  }
  return value as unknown as TimelineConfig;
}

function hasLayerMetadata(layer: Record<string, unknown>): boolean {
  return typeof layer.id === 'string'
    && typeof layer.label === 'string'
    && typeof layer.status === 'string'
    && typeof layer.kind === 'string';
}

function validateLayerData(layer: Record<string, unknown>, path: string): void {
  if (layer.status === 'ready' && typeof layer.url !== 'string' && !Array.isArray(layer.tiles)) {
    invalid(path, `Ready layer ${String(layer.id)} must provide url or tiles.`);
  }
  if (layer.tiles !== undefined && !stringArray(layer.tiles)) {
    invalid(`${path}.tiles`, `Layer ${String(layer.id)} has invalid tiles.`);
  }
  if (layer.featureCount !== undefined
    && (typeof layer.featureCount !== 'number'
      || !Number.isInteger(layer.featureCount)
      || layer.featureCount < 0)) {
    invalid(`${path}.featureCount`, `Layer ${String(layer.id)} has an invalid feature count.`);
  }
}

export function validateLayer(value: unknown, path: string): SnapshotLayer {
  if (!isRecord(value) || !hasLayerMetadata(value)) {
    invalid(path, 'Snapshot contains an invalid layer.');
  }
  if (!LAYER_STATUSES.has(value.status as string)) {
    invalid(`${path}.status`, `Layer ${String(value.id)} has an invalid status.`);
  }
  if (!LAYER_KINDS.has(value.kind as string)) {
    invalid(`${path}.kind`, `Layer ${String(value.id)} has an invalid kind.`);
  }
  if (value.format !== undefined && !LAYER_FORMATS.has(String(value.format))) {
    invalid(`${path}.format`, `Layer ${String(value.id)} has an invalid format.`);
  }
  validateLayerData(value, path);
  return value as unknown as SnapshotLayer;
}

function validateSnapshot(value: unknown, path: string): Snapshot {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.observedAt !== 'string') {
    invalid(path, 'Every snapshot requires id and observedAt.');
  }
  if (!SNAPSHOT_STATUSES.has(value.status as string)) {
    invalid(`${path}.status`, `Snapshot ${value.id} has an invalid status.`);
  }
  if (!Array.isArray(value.layers)) {
    invalid(`${path}.layers`, `Snapshot ${value.id} has no layers array.`);
  }
  for (let index = 0; index < value.layers.length; index += 1) {
    validateLayer(value.layers[index], `${path}.layers[${index}]`);
  }
  return value as unknown as Snapshot;
}

export function validateSnapshots(value: unknown, path = 'snapshots'): Snapshot[] {
  if (!Array.isArray(value)) invalid(path, 'Catalog must contain an event and snapshots array.');
  let previousTime = Number.NEGATIVE_INFINITY;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    const snapshotPath = `${path}[${index}]`;
    const snapshot = validateSnapshot(candidate, snapshotPath);
    if (ids.has(snapshot.id)) invalid(`${snapshotPath}.id`, `Duplicate snapshot id: ${snapshot.id}`);
    ids.add(snapshot.id);
    const observedTime = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(observedTime) || observedTime < previousTime) {
      invalid(`${snapshotPath}.observedAt`, 'Snapshots must be valid dates sorted by observedAt.');
    }
    previousTime = observedTime;
  }
  return value as unknown as Snapshot[];
}

function validateCatalogMetadata(value: Record<string, unknown>): void {
  if (typeof value.version !== 'string' || typeof value.updatedAt !== 'string') {
    invalid('catalog', 'Catalog version and updatedAt are required.');
  }
  if (typeof value.pollIntervalSeconds !== 'number' || value.pollIntervalSeconds < 10) {
    invalid('pollIntervalSeconds', 'Catalog pollIntervalSeconds must be at least 10 seconds.');
  }
}

export function validateCatalog(value: unknown): SnapshotCatalog {
  if (!isRecord(value) || !isRecord(value.event) || !Array.isArray(value.snapshots)) {
    invalid('catalog', 'Catalog must contain an event and snapshots array.');
  }
  validateCatalogMetadata(value);
  validateEvent(value.event);
  if (value.app !== undefined) validateApp(value.app);
  if (value.timeline !== undefined) validateTimeline(value.timeline);
  validateSnapshots(value.snapshots);
  return value as unknown as SnapshotCatalog;
}
