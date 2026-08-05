import maplibregl, { GeoJSONSource } from 'maplibre-gl';
import { GeosplatLayer } from './GeosplatLayer';
import type { BaseImagery, Bounds, EventConfiguration, FireBootstrap, Snapshot } from '../types';
import { MapOverlayManager } from './MapOverlayManager';
import { SentinelRaster } from './SentinelRaster';
import { VectorLayerData } from './VectorLayerData';
import {
  BASE_LAYER,
  BASE_SOURCE,
  CONTEXT_LINE_LAYERS,
  DEFAULT_BASE_IMAGERY,
  EVENT_AREA_LAYER,
  SOURCE_FIRMS,
  SOURCE_OPERATIONAL,
  SOURCE_SAM,
  eventAreaData,
  imagerySource,
  initialMapStyle,
  persistentLayers,
  persistentSources
} from './MapStyle';
import 'maplibre-gl/dist/maplibre-gl.css';

const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

export class MapController {
  private readonly map: maplibregl.Map;
  private readonly ready: Promise<void>;
  private readonly vectors = new VectorLayerData();
  private readonly overlays: MapOverlayManager;
  private readonly sentinel: SentinelRaster;
  private renderRevision = 0;
  private lastEventKey: string | null = null;
  private geosplat: GeosplatLayer | null = null;
  private geosplatLoading: Promise<GeosplatLayer | null> | null = null;
  private terrainMetadataUrl: string | null = null;
  private terrainMode = false;
  private currentImageryKey: string;
  private errorHandler: (message: string) => void = () => undefined;

  constructor(container: string, bootstrap?: FireBootstrap | null) {
    const imagery = bootstrap?.baseImagery ?? DEFAULT_BASE_IMAGERY;
    this.currentImageryKey = imagery.tiles.join('|');
    this.map = new maplibregl.Map({
      container,
      center: bootstrap?.center ?? [0, 20],
      zoom: bootstrap?.initialZoom ?? 2,
      minZoom: 2,
      maxZoom: 19,
      attributionControl: false,
      style: initialMapStyle(imagery)
    });
    this.overlays = new MapOverlayManager(this.map);
    this.sentinel = new SentinelRaster(this.map);
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.on('error', (event) => this.errorHandler(event.error?.message ?? 'Map rendering error.'));
    this.ready = new Promise((resolve) => this.map.once('load', () => {
      this.installPersistentLayers();
      resolve();
    }));
  }

  onError(handler: (message: string) => void): void {
    this.errorHandler = handler;
  }

  async setBaseImagery(imagery: BaseImagery): Promise<void> {
    await this.ready;
    const key = imagery.tiles.join('|');
    if (key === this.currentImageryKey) return;
    this.currentImageryKey = key;
    if (this.map.getLayer(BASE_LAYER)) this.map.removeLayer(BASE_LAYER);
    if (this.map.getSource(BASE_SOURCE)) this.map.removeSource(BASE_SOURCE);
    this.map.addSource(BASE_SOURCE, imagerySource(imagery));
    const bottomLayerId = this.map.getStyle().layers[0]?.id;
    this.map.addLayer({ id: BASE_LAYER, type: 'raster', source: BASE_SOURCE }, bottomLayerId);
    this.overlays.raise();
  }

  captureView(): { center: [number, number]; bounds: Bounds; zoom: number } {
    const center = this.map.getCenter();
    const bounds = this.map.getBounds();
    return {
      center: [round5(center.lng), round5(center.lat)],
      bounds: [round5(bounds.getWest()), round5(bounds.getSouth()), round5(bounds.getEast()), round5(bounds.getNorth())],
      zoom: Math.round(this.map.getZoom() * 100) / 100
    };
  }

  async setEvent(event: EventConfiguration): Promise<void> {
    await this.ready;
    const eventKey = `${event.id}|${event.bounds.join(',')}`;
    if (eventKey === this.lastEventKey) return;
    this.lastEventKey = eventKey;
    this.map.fitBounds(event.bounds, { padding: 64, duration: 650, maxZoom: 11 });
    const data = eventAreaData(event);
    const source = this.map.getSource('event-area') as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      this.map.addSource('event-area', { type: 'geojson', data });
      this.map.addLayer(EVENT_AREA_LAYER);
    }
    this.overlays.raise();
  }

  async renderSnapshot(snapshot: Snapshot): Promise<void> {
    await this.ready;
    const revision = ++this.renderRevision;
    const readyLayers = snapshot.layers.filter((layer) => layer.status === 'ready');
    const sentinel = readyLayers.find((layer) => layer.kind === 'sentinel-raster');
    const samLayers = readyLayers.filter((layer) => layer.kind === 'sam-mask');
    const firmsLayers = readyLayers.filter((layer) => layer.kind === 'firms');
    const operationalLayers = readyLayers.filter((layer) => layer.kind === 'kml');
    const [samData, operationalData, firmsData] = await Promise.all([
      this.vectors.merge(samLayers),
      this.vectors.merge(operationalLayers),
      this.vectors.merge(firmsLayers)
    ]);
    if (revision !== this.renderRevision) return;
    this.sentinel.set(sentinel, this.terrainMode);
    (this.map.getSource(SOURCE_SAM) as GeoJSONSource).setData(samData);
    (this.map.getSource(SOURCE_OPERATIONAL) as GeoJSONSource).setData(operationalData);
    (this.map.getSource(SOURCE_FIRMS) as GeoJSONSource).setData(firmsData);
    this.overlays.setVisibility(SOURCE_SAM, samLayers.length > 0);
    this.overlays.setVisibility(SOURCE_OPERATIONAL, operationalLayers.length > 0);
    this.overlays.setVisibility(SOURCE_FIRMS, firmsLayers.length > 0);
    this.overlays.raise();
  }

  prefetchSnapshot(snapshot: Snapshot): void {
    this.vectors.prefetch(snapshot.layers);
  }

  async setTerrainMode(enabled: boolean): Promise<boolean> {
    await this.ready;
    if (enabled && !this.terrainMetadataUrl) {
      this.errorHandler('Terrain view is not available for this fire yet.');
      return false;
    }
    if (enabled && !this.geosplat && !await this.installGeosplat()) return false;
    this.terrainMode = enabled;
    this.geosplat?.setEnabled(enabled);
    this.sentinel.setTerrainMode(enabled);
    this.map.easeTo({ pitch: enabled ? 60 : 0, duration: 900 });
    return true;
  }

  setTerrainMetadataUrl(metadataUrl: string | null): void {
    if (metadataUrl === this.terrainMetadataUrl) return;
    if (this.geosplat && this.map.getLayer(this.geosplat.id)) this.map.removeLayer(this.geosplat.id);
    this.geosplat = null;
    this.terrainMetadataUrl = metadataUrl;
    this.geosplatLoading = null;
    if (!metadataUrl) {
      this.terrainMode = false;
      this.map.easeTo({ pitch: 0, duration: 0 });
    }
  }

  private installPersistentLayers(): void {
    for (const [id, source] of persistentSources()) this.map.addSource(id, source);
    for (const layer of persistentLayers()) this.map.addLayer(layer);
  }

  private async installGeosplat(): Promise<boolean> {
    const metadataUrl = this.terrainMetadataUrl!;
    this.geosplatLoading ??= GeosplatLayer.load(metadataUrl, this.errorHandler);
    const loaded = await this.geosplatLoading;
    if (metadataUrl !== this.terrainMetadataUrl) {
      loaded?.dispose();
      return false;
    }
    this.geosplat = loaded;
    if (!this.geosplat) return false;
    const beforeId = CONTEXT_LINE_LAYERS.find((id) => this.map.getLayer(id));
    try {
      this.map.addLayer(this.geosplat, beforeId);
    } catch (error) {
      if (this.map.getLayer(this.geosplat.id)) this.map.removeLayer(this.geosplat.id);
      this.geosplat.dispose();
      this.geosplat = null;
      this.geosplatLoading = null;
      throw error;
    }
    return true;
  }
}
