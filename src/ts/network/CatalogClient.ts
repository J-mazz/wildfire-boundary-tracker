import type { SnapshotCatalog } from '../types';
import { fetchWithTimeout } from './fetch';
import { validateCatalog } from './catalogValidation';

const CACHE_KEY_PREFIX = 'wildfire-nrtdv:last-catalog';

export { validateCatalog } from './catalogValidation';

export function catalogCacheKey(url: string): string {
  return `${CACHE_KEY_PREFIX}:${url}`;
}

export class CatalogClient {
  private etag: string | null = null;
  private timer: number | null = null;
  private pollIntervalMs = 300_000;
  private refresh: (() => Promise<void>) | null = null;
  private generation = 0;
  private readonly cacheKey: string;

  constructor(private readonly url: string) {
    this.cacheKey = catalogCacheKey(url);
  }

  start(onCatalog: (catalog: SnapshotCatalog, meta: { stale: boolean }) => void, onError: (error: Error) => void): void {
    this.stop();
    const generation = this.generation;
    let inFlight = false;
    let refreshRequested = false;
    const active = (): boolean => generation === this.generation;
    const refresh = async () => {
      if (!active()) return;
      if (inFlight) {
        refreshRequested = true;
        return;
      }
      inFlight = true;
      try {
        const catalog = await this.fetchCatalog();
        if (!active()) return;
        if (catalog) {
          onCatalog(catalog, { stale: false });
          this.pollIntervalMs = catalog.pollIntervalSeconds * 1_000;
        }
        this.schedule(this.pollIntervalMs, refresh);
      } catch (error) {
        if (!active()) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        onError(normalized);
        const cached = this.readCache();
        if (cached) onCatalog(cached, { stale: true });
        this.schedule(30_000, refresh);
      } finally {
        inFlight = false;
        if (active() && refreshRequested) {
          refreshRequested = false;
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
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    void this.refresh();
  }

  stop(): void {
    ++this.generation;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.refresh = null;
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
      localStorage.setItem(this.cacheKey, JSON.stringify(catalog));
    } catch {
      // Storage can be disabled; the network catalog remains authoritative.
    }
    return catalog;
  }

  private readCache(): SnapshotCatalog | null {
    try {
      const cached = localStorage.getItem(this.cacheKey);
      return cached ? validateCatalog(JSON.parse(cached)) : null;
    } catch {
      return null;
    }
  }
}
