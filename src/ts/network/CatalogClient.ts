import type { SnapshotCatalog } from '../types';
import { fetchWithTimeout } from './fetch';
import { validateCatalog } from './catalogValidation';

const CACHE_KEY = 'wildfire-nrtdv:last-catalog';

export { validateCatalog } from './catalogValidation';

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
