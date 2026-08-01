import { CatalogClient } from './network/CatalogClient';
import { MapController } from './core/MapController';
import { TimelineController } from './core/TimelineController';
import type { FireBootstrap, Snapshot, SnapshotCatalog } from './types';
import '../styles.css';

/** The generic map always uses a live IRWIN catalog; the landing page owns fire selection. */
function catalogUrl(): string {
  const fire = new URLSearchParams(window.location.search).get('fire');
  if (fire && /^irwin:[0-9a-fA-F-]{20,40}$/.test(fire)) {
    return `./api/catalog?fire=${encodeURIComponent(fire)}`;
  }
  window.location.replace('./');
  return './api/catalog?fire=invalid';
}
const CATALOG_URL = catalogUrl();

const requiredElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
};

function readBootstrap(): FireBootstrap | null {
  const node = document.getElementById('fire-bootstrap');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as FireBootstrap;
  } catch {
    return null;
  }
}

const bootstrap = readBootstrap();
const mapController = new MapController('map', bootstrap);
const statusElement = requiredElement<HTMLSpanElement>('connection-status');
const menuButton = requiredElement<HTMLButtonElement>('menu-button');
const terrainButton = requiredElement<HTMLButtonElement>('terrain-button');
terrainButton.disabled = true;
terrainButton.title = 'Terrain data is not available for this fire yet.';
const specificationsPanel = requiredElement<HTMLElement>('specifications-panel');
const titleElement = requiredElement<HTMLElement>('spec-title');
const taglineElement = requiredElement<HTMLElement>('spec-tagline');
const observedElement = requiredElement<HTMLElement>('spec-observed');
const freshnessElement = requiredElement<HTMLElement>('spec-freshness');
const layersElement = requiredElement<HTMLElement>('spec-layers');
const pipelineElement = requiredElement<HTMLElement>('spec-pipeline');
const sourceElement = requiredElement<HTMLElement>('spec-source');
const errorElement = requiredElement<HTMLElement>('error-message');

function applyBranding(title: string, tagline: string): void {
  if (title) {
    titleElement.textContent = title;
    document.title = title;
  }
  if (tagline) taglineElement.textContent = tagline;
}

if (bootstrap) applyBranding(bootstrap.title, bootstrap.tagline);

let catalog: SnapshotCatalog | null = null;
let selectedSnapshotId: string | null = null;
let liveMode = true;
let catalogStale = false;
let playbackTimer: number | null = null;

function setStatus(text: string, state: 'loading' | 'ready' | 'error'): void {
  statusElement.textContent = text;
  statusElement.dataset.state = state;
  menuButton.dataset.state = state;
}

function setMenuOpen(open: boolean): void {
  specificationsPanel.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
}

menuButton.addEventListener('click', () => setMenuOpen(Boolean(specificationsPanel.hidden)));

let terrainBusy = false;
terrainButton.addEventListener('click', () => {
  if (terrainBusy) return;
  terrainBusy = true;
  const next = terrainButton.getAttribute('aria-pressed') !== 'true';
  void mapController.setTerrainMode(next)
    .then((applied) => {
      terrainButton.setAttribute('aria-pressed', String(applied && next));
    })
    .catch((error: unknown) => {
      showError(`Terrain view failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      terrainBusy = false;
    });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenuOpen(false);
});
document.addEventListener('pointerdown', (event) => {
  if (specificationsPanel.hidden) return;
  const target = event.target as Node;
  if (!specificationsPanel.contains(target) && !menuButton.contains(target)) setMenuOpen(false);
});

const timeline = new TimelineController({
  onSelect(index) {
    liveMode = false;
    timeline.setLive(false);
    void selectSnapshotByIndex(index);
  },
  onTogglePlayback() {
    playbackTimer === null ? startPlayback() : stopPlayback();
  },
  onGoLive() {
    liveMode = true;
    stopPlayback();
    timeline.setLive(true);
    if (catalog) void selectSnapshotByIndex(catalog.snapshots.length - 1);
  },
  onSpeedChange() {
    if (playbackTimer !== null) {
      stopPlayback();
      startPlayback();
    }
  }
});

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
  if (ageHours < 24) return `${ageHours}h old`;
  return `${Math.floor(ageHours / 24)}d old`;
}

function renderSpecifications(snapshot: Snapshot): void {
  observedElement.textContent = formatObservedAt(snapshot.observedAt);
  freshnessElement.textContent = describeFreshness(snapshot);
  const readyLayers = snapshot.layers.filter((layer) => layer.status === 'ready');
  const firmsLayers = snapshot.layers.filter((layer) => layer.kind === 'firms' && layer.status === 'ready');
  const samLayers = snapshot.layers.filter((layer) => layer.kind === 'sam-mask' && layer.status === 'ready');
  const firmsLayer = snapshot.layers.find((layer) => layer.kind === 'firms');
  const otherLayers = readyLayers.filter((layer) => layer.kind !== 'firms' && layer.kind !== 'sam-mask');
  const summaries = [
    ...otherLayers.map((layer) => layer.label),
    ...(samLayers.length > 0 ? [`SAM-2 fire path (${sumFeatures(samLayers).toLocaleString()} polygons · ${samLayers.length} masks)`] : []),
    ...(firmsLayers.length > 0
      ? [`VIIRS thermal field (${sumFeatures(firmsLayers).toLocaleString()} detections${firmsLayers.length > 1 ? ` · ${firmsLayers.length} passes` : ''})`]
      : [])
  ];
  layersElement.textContent = readyLayers.length === 0
    ? 'Global satellite base'
    : summaries.join(', ');
  sourceElement.textContent = firmsLayer?.status === 'unavailable' && firmsLayer.statusReason
    ? firmsLayer.statusReason
    : `${readyLayers.length} auto-loaded · FIRMS 3h · Sentinel by pass`;
  pipelineElement.textContent = snapshot.status === 'ready'
    ? 'Published'
    : snapshot.status === 'processing' ? 'Processing' : 'Awaiting source data';
}

function sumFeatures(layers: Snapshot['layers']): number {
  return layers.reduce((total, layer) => total + (layer.featureCount ?? 0), 0);
}

async function selectSnapshotByIndex(index: number): Promise<void> {
  if (!catalog || catalog.snapshots.length === 0) return;
  const boundedIndex = Math.max(0, Math.min(index, catalog.snapshots.length - 1));
  const snapshot = catalog.snapshots[boundedIndex];
  if (!snapshot) return;

  selectedSnapshotId = snapshot.id;
  timeline.select(boundedIndex, snapshot);
  renderSpecifications(snapshot);
  errorElement.hidden = true;

  try {
    await mapController.renderSnapshot(snapshot);
    errorElement.hidden = true;
    errorElement.textContent = '';
    if (!catalogStale) setStatus('Catalog current', 'ready');
    for (const adjacentIndex of [boundedIndex - 1, boundedIndex + 1]) {
      const adjacent = catalog.snapshots[adjacentIndex];
      if (adjacent) mapController.prefetchSnapshot(adjacent);
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function startPlayback(): void {
  if (!catalog || catalog.snapshots.length < 2) return;
  timeline.setPlaying(true);
  liveMode = false;
  timeline.setLive(false);
  playbackTimer = window.setInterval(() => {
    if (!catalog) return;
    const currentIndex = catalog.snapshots.findIndex((snapshot) => snapshot.id === selectedSnapshotId);
    const nextIndex = currentIndex >= catalog.snapshots.length - 1 ? 0 : currentIndex + 1;
    void selectSnapshotByIndex(nextIndex);
  }, timeline.playbackIntervalMs);
}

function stopPlayback(): void {
  if (playbackTimer !== null) window.clearInterval(playbackTimer);
  playbackTimer = null;
  timeline.setPlaying(false);
}

function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.hidden = false;
  setStatus('Update degraded', 'error');
}

function applyCatalog(nextCatalog: SnapshotCatalog, meta: { stale: boolean }): void {
  const previousSelection = selectedSnapshotId;
  const unchanged = catalog !== null
    && catalog.updatedAt === nextCatalog.updatedAt
    && catalog.snapshots.length === nextCatalog.snapshots.length;
  catalog = nextCatalog;
  catalogStale = meta.stale;
  setStatus(meta.stale ? 'Cached catalog · update failed' : 'Catalog current', meta.stale ? 'error' : 'ready');
  if (!meta.stale) {
    errorElement.hidden = true;
    errorElement.textContent = '';
  }
  if (unchanged) return;

  if (nextCatalog.app) {
    applyBranding(nextCatalog.app.title, nextCatalog.app.tagline);
    void mapController.setBaseImagery(nextCatalog.app.baseImagery);
  }
  const terrainMetadataUrl = nextCatalog.app?.terrain?.metadataUrl ?? null;
  mapController.setTerrainMetadataUrl(terrainMetadataUrl);
  terrainButton.disabled = terrainMetadataUrl === null;
  terrainButton.title = terrainMetadataUrl ? 'Toggle 3D terrain view' : 'Terrain data is not available for this fire yet.';
  void mapController.setEvent(nextCatalog.event);
  timeline.setSnapshots(nextCatalog.snapshots);

  const preservedIndex = previousSelection
    ? nextCatalog.snapshots.findIndex((snapshot) => snapshot.id === previousSelection)
    : -1;
  const targetIndex = liveMode || preservedIndex < 0
    ? nextCatalog.snapshots.length - 1
    : preservedIndex;
  void selectSnapshotByIndex(targetIndex);
}

mapController.onError(showError);

const catalogClient = new CatalogClient(CATALOG_URL);
catalogClient.start(applyCatalog, (error) => showError(`Catalog update failed: ${error.message}`));
