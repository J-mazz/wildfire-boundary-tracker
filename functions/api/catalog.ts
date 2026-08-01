import {
  CADENCE_HOURS,
  fetchCurrentPerimeter,
  fetchDetections,
  fetchIncident,
  frameCacheRequest,
  frameCoverage,
  frameOf,
  frameResponse,
  parseFireParam,
  perimeterCacheRequest,
  perimeterResponse,
  seedFootprint
} from './_engine';
import { logDegraded, waitUntil, withApiErrors } from './_http';

const CACHE_SECONDS = 300;
const MAX_DAYS = 10;

export const onRequestGet = withApiErrors<Env>(async (context) => {
  const url = new URL(context.request.url);
  const irwinId = parseFireParam(url.searchParams.get('fire'));
  if (!irwinId) return Response.json({ error: 'Pass ?fire=irwin:<IrwinID>.' }, { status: 400 });

  const cache = caches.default;
  const cacheKey = new Request(`https://catalog-v2-cache.internal/${irwinId.toLowerCase()}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const incident = await fetchIncident(irwinId);
  if (!incident) return Response.json({ error: 'No current NIFC incident with that IrwinID.' }, { status: 404 });

  const now = new Date();
  const discovered = incident.discoveredAt ? new Date(incident.discoveredAt) : now;
  const ageDays = Math.ceil((now.getTime() - discovered.getTime()) / 86_400_000);
  const dayRange = Math.min(MAX_DAYS, Math.max(1, ageDays));
  const seedBounds = seedFootprint(incident.center, incident.sizeAcres);
  const [result, perimeter] = await Promise.all([
    fetchDetections(
      context.env,
      seedBounds,
      dayRange,
      cache,
      (promise, operation) => waitUntil(context, operation, promise),
      now
    ),
    fetchCurrentPerimeter(irwinId).catch((error) => {
      logDegraded('perimeter_fetch_degraded', error, { irwinId });
      return null;
    })
  ]);
  if (perimeter) {
    waitUntil(context, 'perimeter_cache_put', cache.put(perimeterCacheRequest(irwinId), perimeterResponse(perimeter)));
  }

  const startAt = new Date(Math.max(discovered.getTime(), now.getTime() - MAX_DAYS * 86_400_000));
  startAt.setUTCHours(Math.floor(startAt.getUTCHours() / CADENCE_HOURS) * CADENCE_HOURS, 0, 0, 0);
  const frameTimes: number[] = [];
  for (let time = startAt.getTime(); time <= now.getTime(); time += CADENCE_HOURS * 3_600_000) {
    frameTimes.push(time);
  }
  const coverage = frameCoverage(result.detections ?? [], frameTimes);

  const snapshots = [];
  const frameCacheWrites: Promise<void>[] = [];
  for (let index = 0; index < frameTimes.length; ++index) {
    const frameIso = new Date(frameTimes[index]!).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const frameId = frameIso.replace(/:/g, '-');
    const { featureCount, newestObservedAt } = coverage[index]!;
    const hasData = featureCount > 0;
    const hasCurrentPerimeter = perimeter !== null && index === frameTimes.length - 1;
    if (hasData && result.detections) {
      frameCacheWrites.push(cache.put(
        frameCacheRequest(irwinId, frameIso, dayRange),
        frameResponse(result.detections, frameIso)
      ));
    }
    const layers: Array<Record<string, unknown>> = [{
      id: `firms-${frameId}`,
      label: 'VIIRS thermal detections',
      kind: 'firms',
      format: 'geojson',
      status: hasData ? 'ready' : 'unavailable',
      ...(hasData
        ? {
            url: `./api/firms?fire=irwin:${irwinId}&frame=${encodeURIComponent(frameIso)}&days=${dayRange}`,
            featureCount,
            ...(newestObservedAt ? { sourceObservedAt: newestObservedAt } : {})
          }
        : { statusReason: result.reason ?? (result.detections ? 'No VIIRS detections within the persistence window' : 'FIRMS unavailable') })
    }];
    if (hasCurrentPerimeter) {
      layers.push({
        id: `perimeter-${frameId}`,
        label: 'Current WFIGS incident perimeter',
        kind: 'kml',
        format: 'geojson',
        status: 'ready',
        url: `./api/perimeter?fire=irwin:${irwinId}`,
        contextType: 'incident-perimeter',
        featureCount: perimeter.featureCount,
        ...(perimeter.observedAt ? { sourceObservedAt: perimeter.observedAt } : {})
      });
    }
    snapshots.push({
      id: `frame-${frameId}`,
      observedAt: frameIso,
      label: `${frameIso.slice(0, 16).replace('T', ' ')} UTC`,
      status: hasData || hasCurrentPerimeter ? 'ready' : 'awaiting-data',
      layers
    });
  }
  if (frameCacheWrites.length > 0) waitUntil(context, 'catalog_frame_cache_put', Promise.all(frameCacheWrites));

  const catalog = {
    version: '1',
    updatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    pollIntervalSeconds: 300,
    event: {
      id: `irwin-${irwinId.toLowerCase()}`,
      name: incident.name,
      startedAt: incident.discoveredAt ?? startAt.toISOString(),
      center: incident.center,
      bounds: result.bounds
    },
    app: {
      title: incident.name,
      tagline: 'Near-real-time boundary tracker',
      initialZoom: 10,
      baseImagery: {
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Earth imagery © Esri and contributors',
        maxzoom: 19
      }
    },
    timeline: {
      startAt: startAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      endAt: frameOf(now.toISOString()),
      cadenceHours: CADENCE_HOURS
    },
    snapshots
  };

  const response = Response.json(catalog, { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } });
  waitUntil(context, 'catalog_cache_put', cache.put(cacheKey, response.clone()));
  return response;
});
