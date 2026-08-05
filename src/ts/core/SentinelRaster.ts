import type maplibregl from 'maplibre-gl';
import type { SnapshotLayer } from '../types';
import {
  LAYER_SAM_FILL,
  LAYER_SENTINEL,
  SOURCE_SENTINEL
} from './MapStyle';

export class SentinelRaster {
  private currentLayerId: string | null = null;

  constructor(private readonly map: maplibregl.Map) {}

  set(layer: SnapshotLayer | undefined, terrainMode: boolean): void {
    const desiredId = layer?.id ?? null;
    if (desiredId === this.currentLayerId) return;
    this.remove();
    if (!layer || !this.addSource(layer)) return;
    this.map.addLayer({
      id: LAYER_SENTINEL,
      type: 'raster',
      source: SOURCE_SENTINEL,
      layout: { visibility: terrainMode ? 'none' : 'visible' },
      paint: {
        'raster-opacity': layer.opacity ?? 0.72,
        'raster-opacity-transition': { duration: 240 }
      }
    }, LAYER_SAM_FILL);
    this.currentLayerId = desiredId;
  }

  setTerrainMode(enabled: boolean): void {
    if (!this.map.getLayer(LAYER_SENTINEL)) return;
    this.map.setLayoutProperty(LAYER_SENTINEL, 'visibility', enabled ? 'none' : 'visible');
  }

  private addSource(layer: SnapshotLayer): boolean {
    const tiled = layer.format === 'xyz' || (layer.tiles?.length ?? 0) > 0;
    if (tiled && layer.tiles && layer.tiles.length > 0) {
      this.map.addSource(SOURCE_SENTINEL, {
        type: 'raster',
        tiles: layer.tiles,
        tileSize: 256,
        maxzoom: 19,
        attribution: layer.attribution,
        ...(layer.bounds ? { bounds: layer.bounds } : {})
      });
      return true;
    }
    if (!layer.url || !layer.bounds) return false;
    const [west, south, east, north] = layer.bounds;
    this.map.addSource(SOURCE_SENTINEL, {
      type: 'image',
      url: layer.url,
      coordinates: [[west, north], [east, north], [east, south], [west, south]]
    });
    return true;
  }

  private remove(): void {
    if (this.map.getLayer(LAYER_SENTINEL)) this.map.removeLayer(LAYER_SENTINEL);
    if (this.map.getSource(SOURCE_SENTINEL)) this.map.removeSource(SOURCE_SENTINEL);
    this.currentLayerId = null;
  }
}
