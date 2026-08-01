import type { SnapshotCatalog } from '../types';
import { fetchWithTimeout } from './fetch';

const CACHE_KEY = 'wildfire-nrtdv:last-catalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

export function validateCatalog(value: unknown): SnapshotCatalog {
  if (!isRecord(value) || !isRecord(value.event) || !Array.isArray(value.snapshots)) {
    throw new Error('Catalog must contain an event and snapshots array.');
  }
  if (typeof value.version !== 'string' || typeof value.updatedAt !== 'string') {
    throw new Error('Catalog version and updatedAt are required.');
  }
  if (typeof value.pollIntervalSeconds !== 'number' || value.pollIntervalSeconds < 10) {
    throw new Error('Catalog pollIntervalSeconds must be at least 10 seconds.');
  }

  const event = value.event;
  if (typeof event.id !== 'string' || typeof event.name !== 'string' || typeof event.startedAt !== 'string') {
    throw new Error('Catalog event metadata is incomplete.');
  }
  if (!finiteTuple(event.center, 2) || !finiteTuple(event.bounds, 4)) {
    throw new Error('Catalog event center or bounds are invalid.');
  }
  const [longitude, latitude] = event.center;
  const [west, south, east, north] = event.bounds;
  if (Math.abs(longitude!) > 180 || Math.abs(latitude!) > 90
    || west! < -180 || east! > 180 || south! < -90 || north! > 90
    || west! >= east! || south! >= north!) {
    throw new Error('Catalog event coordinates are outside valid geographic bounds.');
  }

  if (value.app !== undefined) {
    if (!isRecord(value.app) || typeof value.app.title !== 'string' || typeof value.app.tagline !== 'string'
      || !isRecord(value.app.baseImagery) || !stringArray(value.app.baseImagery.tiles)
      || typeof value.app.baseImagery.attribution !== 'string') {
      throw new Error('Catalog app configuration is invalid.');
    }
  }
  if (value.timeline !== undefined) {
    if (!isRecord(value.timeline) || typeof value.timeline.startAt !== 'string'
      || typeof value.timeline.endAt !== 'string' || typeof value.timeline.cadenceHours !== 'number'
      || !Number.isInteger(value.timeline.cadenceHours) || value.timeline.cadenceHours <= 0) {
      throw new Error('Catalog timeline configuration is invalid.');
    }
  }

  let previousTime = Number.NEGATIVE_INFINITY;
  const ids = new Set<string>();
  for (const candidate of value.snapshots) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.observedAt !== 'string') {
      throw new Error('Every snapshot requires id and observedAt.');
    }
    if (candidate.status !== 'ready' && candidate.status !== 'processing' && candidate.status !== 'awaiting-data') {
      throw new Error(`Snapshot ${candidate.id} has an invalid status.`);
    }
    if (!Array.isArray(candidate.layers)) throw new Error(`Snapshot ${candidate.id} has no layers array.`);
    if (ids.has(candidate.id)) throw new Error(`Duplicate snapshot id: ${candidate.id}`);
    ids.add(candidate.id);

    const observedTime = Date.parse(candidate.observedAt);
    if (!Number.isFinite(observedTime) || observedTime < previousTime) {
      throw new Error('Snapshots must be valid dates sorted by observedAt.');
    }
    previousTime = observedTime;

    for (const layer of candidate.layers) {
      if (!isRecord(layer) || typeof layer.id !== 'string' || typeof layer.label !== 'string'
        || typeof layer.status !== 'string' || typeof layer.kind !== 'string') {
        throw new Error(`Snapshot ${candidate.id} contains an invalid layer.`);
      }
      if (layer.status !== 'ready' && layer.status !== 'processing' && layer.status !== 'unavailable') {
        throw new Error(`Layer ${layer.id} has an invalid status.`);
      }
      if (layer.status === 'ready' && typeof layer.url !== 'string' && !Array.isArray(layer.tiles)) {
        throw new Error(`Ready layer ${layer.id} must provide url or tiles.`);
      }
      if (!['sentinel-raster', 'sam-mask', 'firms', 'kml'].includes(layer.kind)) {
        throw new Error(`Layer ${layer.id} has an invalid kind.`);
      }
      if (layer.format !== undefined && !['xyz', 'image', 'geojson', 'kml'].includes(String(layer.format))) {
        throw new Error(`Layer ${layer.id} has an invalid format.`);
      }
      if (layer.tiles !== undefined && !stringArray(layer.tiles)) {
        throw new Error(`Layer ${layer.id} has invalid tiles.`);
      }
      if (layer.featureCount !== undefined
        && (typeof layer.featureCount !== 'number' || !Number.isInteger(layer.featureCount) || layer.featureCount < 0)) {
        throw new Error(`Layer ${layer.id} has an invalid feature count.`);
      }
    }
  }

  return value as unknown as SnapshotCatalog;
}

export class CatalogClient {
  private etag: string | null = null;
  private timer: number | null = null;
  private inFlight = false;
  private refreshRequested = false;
  private pollIntervalMs = 300_000;
  private refresh: (() => Promise<void>) | null = null;

  constructor(private readonly url: string) {}

  start(onCatalog: (catalog: SnapshotCatalog, meta: { stale: boolean }) => void, onError: (error: Error) => void): void {
    const refresh = async () => {
      if (this.inFlight) return;
      this.inFlight = true;
      try {
        const catalog = await this.fetchCatalog();
        if (catalog) {
          onCatalog(catalog, { stale: false });
          this.pollIntervalMs = catalog.pollIntervalSeconds * 1_000;
        }
        this.schedule(this.pollIntervalMs, refresh);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        onError(normalized);
        const cached = this.readCache();
        if (cached) onCatalog(cached, { stale: true });
        this.schedule(30_000, refresh);
      } finally {
        this.inFlight = false;
        if (this.refreshRequested) {
          this.refreshRequested = false;
          if (this.timer !== null) window.clearTimeout(this.timer);
          this.timer = null;
          void refresh();
        }
      }
    };
    this.refresh = refresh;
    void refresh();
  }

  /** Force an immediate poll (skips the ETag no-op after a config write). */
  refreshNow(): void {
    this.etag = null;
    if (!this.refresh) return;
    if (this.inFlight) {
      this.refreshRequested = true;
      return;
    }
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    void this.refresh();
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number, callback: () => Promise<void>): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void callback(), delayMs);
  }

  private async fetchCatalog(): Promise<SnapshotCatalog | null> {
    const headers: HeadersInit = { Accept: 'application/json' };
    if (this.etag) headers['If-None-Match'] = this.etag;
    const response = await fetchWithTimeout(this.url, { headers, cache: 'no-cache' });
    if (response.status === 304) return null;
    if (!response.ok) throw new Error(`Catalog request returned ${response.status}.`);

    const catalog = validateCatalog(await response.json());
    this.etag = response.headers.get('etag');
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    } catch {
      // Storage can be disabled; the network catalog remains authoritative.
    }
    return catalog;
  }

  private readCache(): SnapshotCatalog | null {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      return cached ? validateCatalog(JSON.parse(cached)) : null;
    } catch {
      return null;
    }
  }
}
