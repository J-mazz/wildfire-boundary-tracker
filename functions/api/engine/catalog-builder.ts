import { frameOf } from './calculations';
import {
  CADENCE_HOURS,
  MAX_HISTORY_DAYS,
  type DetectionResult,
  type Incident,
  type PerimeterResult
} from './domain';

export interface CatalogPlan {
  dayRange: number;
  startAt: Date;
  frameTimes: number[];
}

export interface CatalogBuild {
  catalog: LiveCatalog;
  cacheableFrames: string[];
}

interface CatalogLayerBase {
  id: string;
  label: string;
  kind: string;
  format: 'geojson';
}

type FirmsCatalogLayer = CatalogLayerBase & (
  | {
      status: 'ready';
      url: string;
      featureCount: number;
      sourceObservedAt?: string;
    }
  | {
      status: 'unavailable';
      statusReason: string;
    }
);

interface PerimeterCatalogLayer extends CatalogLayerBase {
  status: 'ready';
  url: string;
  contextType: 'incident-perimeter';
  featureCount: number;
  sourceObservedAt?: string;
}

export interface CatalogSnapshot {
  id: string;
  observedAt: string;
  label: string;
  status: 'ready' | 'awaiting-data';
  layers: Array<FirmsCatalogLayer | PerimeterCatalogLayer>;
}

export interface LiveCatalog {
  version: '1';
  updatedAt: string;
  pollIntervalSeconds: 300;
  event: {
    id: string;
    name: string;
    startedAt: string;
    center: Incident['center'];
    bounds: DetectionResult['bounds'];
  };
  app: {
    title: string;
    tagline: string;
    initialZoom: number;
    baseImagery: {
      tiles: string[];
      attribution: string;
      maxzoom: number;
    };
  };
  timeline: {
    startAt: string;
    endAt: string;
    cadenceHours: number;
  };
  snapshots: CatalogSnapshot[];
}

interface CatalogInput {
  irwinId: string;
  incident: Incident;
  result: DetectionResult;
  perimeter: PerimeterResult | null;
  plan: CatalogPlan;
  now: Date;
}

interface FirmsLayerInput {
  irwinId: string;
  frameId: string;
  frameIso: string;
  dayRange: number;
  featureCount: number;
  newestObservedAt: string | null;
  result: DetectionResult;
}

function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function createCatalogPlan(incident: Incident, now: Date): CatalogPlan {
  const discovered = incident.discoveredAt ? new Date(incident.discoveredAt) : now;
  const ageDays = Math.ceil((now.getTime() - discovered.getTime()) / 86_400_000);
  const dayRange = Math.min(MAX_HISTORY_DAYS, Math.max(1, ageDays));
  const startAt = new Date(Math.max(discovered.getTime(), now.getTime() - MAX_HISTORY_DAYS * 86_400_000));
  startAt.setUTCHours(Math.floor(startAt.getUTCHours() / CADENCE_HOURS) * CADENCE_HOURS, 0, 0, 0);
  const frameTimes: number[] = [];
  for (let time = startAt.getTime(); time <= now.getTime(); time += CADENCE_HOURS * 3_600_000) {
    frameTimes.push(time);
  }
  return { dayRange, startAt, frameTimes };
}

function buildFirmsLayer(input: FirmsLayerInput): FirmsCatalogLayer {
  const hasData = input.featureCount > 0;
  const base: CatalogLayerBase = {
    id: `firms-${input.frameId}`,
    label: 'VIIRS thermal detections',
    kind: 'firms',
    format: 'geojson'
  };
  if (!hasData) {
    return {
      ...base,
      status: 'unavailable',
      statusReason: input.result.reason
        ?? (input.result.detections ? 'No VIIRS detections within the persistence window' : 'FIRMS unavailable')
    };
  }
  return {
    ...base,
    status: 'ready',
    url: `./api/firms?fire=irwin:${input.irwinId}&frame=${encodeURIComponent(input.frameIso)}&days=${input.dayRange}`,
    featureCount: input.featureCount,
    ...(input.newestObservedAt ? { sourceObservedAt: input.newestObservedAt } : {})
  };
}

function buildPerimeterLayer(
  irwinId: string,
  frameId: string,
  perimeter: PerimeterResult
): PerimeterCatalogLayer {
  return {
    id: `perimeter-${frameId}`,
    label: 'Current WFIGS incident perimeter',
    kind: 'kml',
    format: 'geojson',
    status: 'ready',
    url: `./api/perimeter?fire=irwin:${irwinId}`,
    contextType: 'incident-perimeter',
    featureCount: perimeter.featureCount,
    ...(perimeter.observedAt ? { sourceObservedAt: perimeter.observedAt } : {})
  };
}

function buildSnapshot(
  input: CatalogInput,
  index: number,
  featureCount: number,
  newestObservedAt: string | null
): { snapshot: CatalogSnapshot; cacheableFrame: string | null } {
  const frameIso = isoSeconds(new Date(input.plan.frameTimes[index]!));
  const frameId = frameIso.replace(/:/g, '-');
  const hasData = featureCount > 0;
  const hasCurrentPerimeter = input.perimeter !== null && index === input.plan.frameTimes.length - 1;
  const layers = [buildFirmsLayer({
    irwinId: input.irwinId,
    frameId,
    frameIso,
    dayRange: input.plan.dayRange,
    featureCount,
    newestObservedAt,
    result: input.result
  })];
  if (hasCurrentPerimeter) layers.push(buildPerimeterLayer(input.irwinId, frameId, input.perimeter!));
  return {
    snapshot: {
      id: `frame-${frameId}`,
      observedAt: frameIso,
      label: `${frameIso.slice(0, 16).replace('T', ' ')} UTC`,
      status: hasData || hasCurrentPerimeter ? 'ready' : 'awaiting-data',
      layers
    },
    cacheableFrame: hasData && input.result.detections ? frameIso : null
  };
}

export function buildCatalog(input: CatalogInput): CatalogBuild {
  const coverage = input.result.timeline?.coverage(input.plan.frameTimes)
    ?? input.plan.frameTimes.map(() => ({ featureCount: 0, newestObservedAt: null }));
  const built = coverage.map((frame, index) =>
    buildSnapshot(input, index, frame.featureCount, frame.newestObservedAt)
  );
  return {
    catalog: {
      version: '1',
      updatedAt: isoSeconds(input.now),
      pollIntervalSeconds: 300,
      event: {
        id: `irwin-${input.irwinId.toLowerCase()}`,
        name: input.incident.name,
        startedAt: input.incident.discoveredAt ?? input.plan.startAt.toISOString(),
        center: input.incident.center,
        bounds: input.result.bounds
      },
      app: {
        title: input.incident.name,
        tagline: 'Near-real-time boundary tracker',
        initialZoom: 10,
        baseImagery: {
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Earth imagery © Esri and contributors',
          maxzoom: 19
        }
      },
      timeline: {
        startAt: isoSeconds(input.plan.startAt),
        endAt: frameOf(input.now.toISOString()),
        cadenceHours: CADENCE_HOURS
      },
      snapshots: built.map(({ snapshot }) => snapshot)
    },
    cacheableFrames: built.flatMap(({ cacheableFrame }) => cacheableFrame ? [cacheableFrame] : [])
  };
}
