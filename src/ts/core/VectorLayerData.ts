import { kml } from '@tmcw/togeojson';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import type { SnapshotLayer } from '../types';
import { fetchWithTimeout } from '../network/fetch';
import { EMPTY_COLLECTION } from './MapStyle';

type LayerFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function validateFeatureCollection(value: unknown, url: string): FeatureCollection {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!record || record.type !== 'FeatureCollection' || !Array.isArray(record.features)) {
    throw new Error(`Invalid GeoJSON feature collection: ${url}`);
  }
  return value as FeatureCollection;
}

export function decorateFeatures(
  collection: FeatureCollection,
  layer: SnapshotLayer
): Feature<Geometry, GeoJsonProperties>[] {
  return collection.features.flatMap((feature) => {
    if (!feature.geometry) return [];
    const featureAge = feature.properties?.ageHours;
    return [{
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        ageHours: typeof featureAge === 'number' ? featureAge : layer.ageHours ?? 0,
        contextType: layer.contextType,
        sourceObservedAt: layer.sourceObservedAt,
        sourceLayerId: layer.id
      }
    } as Feature<Geometry, GeoJsonProperties>];
  });
}

export class VectorLayerData {
  private readonly cache = new Map<string, Promise<FeatureCollection>>();

  constructor(
    private readonly fetcher: LayerFetcher = fetchWithTimeout,
    private readonly maxCacheEntries = 96
  ) {}

  async merge(layers: SnapshotLayer[]): Promise<FeatureCollection> {
    if (layers.length === 0) return EMPTY_COLLECTION;
    const collections = await Promise.all(layers.map((layer) => this.load(layer)));
    return {
      type: 'FeatureCollection',
      features: collections.flatMap((collection, index) => decorateFeatures(collection, layers[index]!))
    };
  }

  load(layer: SnapshotLayer): Promise<FeatureCollection> {
    if (!layer.url) return Promise.resolve(EMPTY_COLLECTION);
    if (layer.contextType === 'incident-perimeter') return this.fetchCollection(layer);
    const cached = this.cache.get(layer.url);
    if (cached) return cached;
    const pending = this.fetchCollection(layer).catch((error: unknown) => {
      this.cache.delete(layer.url!);
      throw error;
    });
    this.evictOldestIfFull();
    this.cache.set(layer.url, pending);
    return pending;
  }

  prefetch(layers: SnapshotLayer[]): void {
    for (const layer of layers) {
      if (layer.status !== 'ready' || !layer.url || layer.kind === 'sentinel-raster') continue;
      void this.load(layer).catch((error: unknown) => {
        console.warn('Layer prefetch failed.', { layerId: layer.id, error });
      });
    }
  }

  private async fetchCollection(layer: SnapshotLayer): Promise<FeatureCollection> {
    const response = await this.fetcher(layer.url!, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Layer request returned ${response.status}: ${layer.url}`);
    if (layer.kind === 'kml' || layer.format === 'kml') return this.convertKml(await response.text(), layer.url!);
    return validateFeatureCollection(await response.json(), layer.url!);
  }

  private convertKml(text: string, url: string): FeatureCollection {
    const documentNode = new DOMParser().parseFromString(text, 'text/xml');
    if (documentNode.querySelector('parsererror')) throw new Error(`Invalid KML document: ${url}`);
    const converted = kml(documentNode, { skipNullGeometry: true });
    return {
      type: 'FeatureCollection',
      features: converted.features.filter((feature) => feature.geometry !== null)
    } as FeatureCollection;
  }

  private evictOldestIfFull(): void {
    if (this.cache.size < this.maxCacheEntries) return;
    const oldest = this.cache.keys().next().value;
    if (typeof oldest === 'string') this.cache.delete(oldest);
  }
}
