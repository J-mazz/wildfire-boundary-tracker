import type { SnapshotCatalog } from '../types';

const CACHE_KEY = 'wildfire-nrtdv:last-catalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (!Array.isArray(event.center) || event.center.length !== 2 || !Array.isArray(event.bounds) || event.bounds.length !== 4) {
    throw new Error('Catalog event center or bounds are invalid.');
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
      if (!isRecord(layer) || typeof layer.id !== 'string' || typeof layer.status !== 'string') {
        throw new Error(`Snapshot ${candidate.id} contains an invalid layer.`);
      }
      if (layer.status !== 'ready' && layer.status !== 'processing' && layer.status !== 'unavailable') {
        throw new Error(`Layer ${layer.id} has an invalid status.`);
      }
      if (layer.status === 'ready' && typeof layer.url !== 'string' && !Array.isArray(layer.tiles)) {
        throw new Error(`Ready layer ${layer.id} must provide url or tiles.`);
      }
    }
  }

  return value as unknown as SnapshotCatalog;
}

export class CatalogClient {
  private etag: string | null = null;
  private timer: number | null = null;
  private inFlight = false;
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
          this.schedule(catalog.pollIntervalSeconds * 1_000, refresh);
        } else {
          this.schedule(30_000, refresh);
        }
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        onError(normalized);
        const cached = this.readCache();
        if (cached) onCatalog(cached, { stale: true });
        this.schedule(30_000, refresh);
      } finally {
        this.inFlight = false;
      }
    };
    this.refresh = refresh;
    void refresh();
  }

  /** Force an immediate poll (skips the ETag no-op after a config write). */
  refreshNow(): void {
    this.etag = null;
    if (this.refresh) void this.refresh();
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
    const response = await fetch(this.url, { headers, cache: 'no-cache' });
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
