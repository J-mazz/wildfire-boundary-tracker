import { MapController } from '../core/MapController';
import { TimelineController } from '../core/TimelineController';
import { CatalogClient } from '../network/CatalogClient';
import type { FireBootstrap, Snapshot, SnapshotCatalog } from '../types';
import { CatalogSelectionState } from './CatalogSelectionState';
import { PlaybackState } from './PlaybackState';

type ConnectionState = 'loading' | 'ready' | 'error';

const requiredElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
};

function parseDate(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
}

function formatObservedAt(value: string): string {
  const date = parseDate(value);
  const options: Intl.DateTimeFormatOptions = value.length === 10
    ? { dateStyle: 'medium', timeZone: 'UTC' }
    : {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        timeZone: 'UTC', timeZoneName: 'short'
      };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function describeFreshness(snapshot: Snapshot): string {
  const ageMs = Date.now() - parseDate(snapshot.observedAt).getTime();
  const ageHours = Math.max(0, Math.floor(ageMs / 3_600_000));
  return ageHours < 24 ? `${ageHours}h old` : `${Math.floor(ageHours / 24)}d old`;
}

function sumFeatures(layers: Snapshot['layers']): number {
  return layers.reduce((total, layer) => total + (layer.featureCount ?? 0), 0);
}

function layerSummary(snapshot: Snapshot): { layers: string; source: string } {
  const readyLayers = snapshot.layers.filter((layer) => layer.status === 'ready');
  const firmsLayers = readyLayers.filter((layer) => layer.kind === 'firms');
  const samLayers = readyLayers.filter((layer) => layer.kind === 'sam-mask');
  const firmsLayer = snapshot.layers.find((layer) => layer.kind === 'firms');
  const otherLayers = readyLayers.filter((layer) => layer.kind !== 'firms' && layer.kind !== 'sam-mask');
  const summaries = [
    ...otherLayers.map((layer) => layer.label),
    ...(samLayers.length > 0
      ? [`SAM-2 fire path (${sumFeatures(samLayers).toLocaleString()} polygons · ${samLayers.length} masks)`]
      : []),
    ...(firmsLayers.length > 0
      ? [`VIIRS thermal field (${sumFeatures(firmsLayers).toLocaleString()} detections${firmsLayers.length > 1 ? ` · ${firmsLayers.length} passes` : ''})`]
      : [])
  ];
  const source = firmsLayer?.status === 'unavailable' && firmsLayer.statusReason
    ? firmsLayer.statusReason
    : `${readyLayers.length} auto-loaded · FIRMS 3h · Sentinel by pass`;
  return { layers: readyLayers.length === 0 ? 'Global satellite base' : summaries.join(', '), source };
}

export class AppCoordinator {
  private readonly mapController: MapController;
  private readonly timeline: TimelineController;
  private readonly catalogClient: CatalogClient;
  private readonly selection = new CatalogSelectionState();
  private readonly playback = new PlaybackState();
  private readonly statusElement = requiredElement<HTMLSpanElement>('connection-status');
  private readonly menuButton = requiredElement<HTMLButtonElement>('menu-button');
  private readonly terrainButton = requiredElement<HTMLButtonElement>('terrain-button');
  private readonly specificationsPanel = requiredElement<HTMLElement>('specifications-panel');
  private readonly titleElement = requiredElement<HTMLElement>('spec-title');
  private readonly taglineElement = requiredElement<HTMLElement>('spec-tagline');
  private readonly observedElement = requiredElement<HTMLElement>('spec-observed');
  private readonly freshnessElement = requiredElement<HTMLElement>('spec-freshness');
  private readonly layersElement = requiredElement<HTMLElement>('spec-layers');
  private readonly pipelineElement = requiredElement<HTMLElement>('spec-pipeline');
  private readonly sourceElement = requiredElement<HTMLElement>('spec-source');
  private readonly errorElement = requiredElement<HTMLElement>('error-message');
  private playbackTimer: number | null = null;
  private terrainBusy = false;

  constructor(catalogUrl: string, bootstrap: FireBootstrap | null) {
    this.mapController = new MapController('map', bootstrap);
    this.timeline = new TimelineController({
      onSelect: (index) => this.selectHistorical(index),
      onTogglePlayback: () => this.togglePlayback(),
      onGoLive: () => this.goLive(),
      onSpeedChange: () => this.restartPlayback()
    });
    this.catalogClient = new CatalogClient(catalogUrl);
    this.configureUi(bootstrap);
  }

  start(): void {
    this.mapController.onError((message) => this.showError(message));
    this.catalogClient.start(
      (catalog, meta) => this.applyCatalog(catalog, meta),
      (error) => this.showError(`Catalog update failed: ${error.message}`)
    );
  }

  private configureUi(bootstrap: FireBootstrap | null): void {
    this.terrainButton.disabled = true;
    this.terrainButton.title = 'Terrain data is not available for this fire yet.';
    if (bootstrap) this.applyBranding(bootstrap.title, bootstrap.tagline);
    this.menuButton.addEventListener('click', () => this.setMenuOpen(Boolean(this.specificationsPanel.hidden)));
    this.terrainButton.addEventListener('click', () => this.toggleTerrain());
    document.addEventListener('keydown', (event) => this.handleKeyDown(event));
    document.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
  }

  private applyBranding(title: string, tagline: string): void {
    if (title) {
      this.titleElement.textContent = title;
      document.title = title;
    }
    if (tagline) this.taglineElement.textContent = tagline;
  }

  private setStatus(text: string, state: ConnectionState): void {
    this.statusElement.textContent = text;
    this.statusElement.dataset.state = state;
    this.menuButton.dataset.state = state;
  }

  private setMenuOpen(open: boolean): void {
    this.specificationsPanel.hidden = !open;
    this.menuButton.setAttribute('aria-expanded', String(open));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.setMenuOpen(false);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (this.specificationsPanel.hidden) return;
    const target = event.target as Node;
    if (!this.specificationsPanel.contains(target) && !this.menuButton.contains(target)) {
      this.setMenuOpen(false);
    }
  }

  private toggleTerrain(): void {
    if (this.terrainBusy) return;
    this.terrainBusy = true;
    const next = this.terrainButton.getAttribute('aria-pressed') !== 'true';
    void this.mapController.setTerrainMode(next)
      .then((applied) => this.terrainButton.setAttribute('aria-pressed', String(Boolean(applied && next))))
      .catch((error: unknown) => {
        this.showError(`Terrain view failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.terrainBusy = false;
      });
  }

  private renderSpecifications(snapshot: Snapshot): void {
    const summary = layerSummary(snapshot);
    this.observedElement.textContent = formatObservedAt(snapshot.observedAt);
    this.freshnessElement.textContent = describeFreshness(snapshot);
    this.layersElement.textContent = summary.layers;
    this.sourceElement.textContent = summary.source;
    this.pipelineElement.textContent = snapshot.status === 'ready'
      ? 'Published'
      : snapshot.status === 'processing' ? 'Processing' : 'Awaiting source data';
  }

  private async selectSnapshotByIndex(index: number): Promise<void> {
    const selection = this.selection.select(index);
    if (!selection) return;
    this.timeline.select(selection.index, selection.snapshot);
    this.renderSpecifications(selection.snapshot);
    this.clearError();
    try {
      await this.mapController.renderSnapshot(selection.snapshot);
      this.clearError();
      if (!this.selection.stale) this.setStatus('Catalog current', 'ready');
      selection.adjacent.forEach((snapshot) => this.mapController.prefetchSnapshot(snapshot));
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private selectHistorical(index: number): void {
    this.playback.selectHistorical();
    this.timeline.setLive(false);
    void this.selectSnapshotByIndex(index);
  }

  private togglePlayback(): void {
    this.playback.isPlaying ? this.stopPlayback() : this.startPlayback();
  }

  private startPlayback(): void {
    const snapshotCount = this.selection.catalog?.snapshots.length ?? 0;
    if (!this.playback.start(snapshotCount)) return;
    this.timeline.setPlaying(true);
    this.timeline.setLive(false);
    this.playbackTimer = window.setInterval(() => {
      const nextIndex = this.selection.nextPlaybackIndex();
      if (nextIndex !== null) void this.selectSnapshotByIndex(nextIndex);
    }, this.timeline.playbackIntervalMs);
  }

  private stopPlayback(): void {
    if (this.playbackTimer !== null) window.clearInterval(this.playbackTimer);
    this.playbackTimer = null;
    this.playback.stop();
    this.timeline.setPlaying(false);
  }

  private goLive(): void {
    this.playback.goLive();
    this.stopPlayback();
    this.timeline.setLive(true);
    const snapshots = this.selection.catalog?.snapshots;
    if (snapshots) void this.selectSnapshotByIndex(snapshots.length - 1);
  }

  private restartPlayback(): void {
    if (!this.playback.isPlaying) return;
    this.stopPlayback();
    this.startPlayback();
  }

  private showError(message: string): void {
    this.errorElement.textContent = message;
    this.errorElement.hidden = false;
    this.setStatus('Update degraded', 'error');
  }

  private clearError(): void {
    this.errorElement.hidden = true;
    this.errorElement.textContent = '';
  }

  private applyCatalog(nextCatalog: SnapshotCatalog, meta: { stale: boolean }): void {
    const update = this.selection.update(nextCatalog, meta.stale, this.playback.isLive);
    this.setStatus(
      meta.stale ? 'Cached catalog · update failed' : 'Catalog current',
      meta.stale ? 'error' : 'ready'
    );
    if (!meta.stale) this.clearError();
    if (!update.changed) return;
    this.configureCatalog(nextCatalog);
    if (update.targetIndex !== null) void this.selectSnapshotByIndex(update.targetIndex);
  }

  private configureCatalog(catalog: SnapshotCatalog): void {
    if (catalog.app) {
      this.applyBranding(catalog.app.title, catalog.app.tagline);
      void this.mapController.setBaseImagery(catalog.app.baseImagery);
    }
    const terrainMetadataUrl = catalog.app?.terrain?.metadataUrl ?? null;
    this.mapController.setTerrainMetadataUrl(terrainMetadataUrl);
    this.terrainButton.disabled = terrainMetadataUrl === null;
    this.terrainButton.title = terrainMetadataUrl
      ? 'Toggle 3D terrain view'
      : 'Terrain data is not available for this fire yet.';
    void this.mapController.setEvent(catalog.event);
    this.timeline.setSnapshots(catalog.snapshots);
  }
}
