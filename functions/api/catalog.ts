import {
  CADENCE_HOURS,
  type Env,
  fetchDetections,
  fetchIncident,
  frameOf,
  observedAtOf,
  parseFireParam,
  seedFootprint
} from './_engine';

const CACHE_SECONDS = 900;
const MAX_DAYS = 10;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const irwinId = parseFireParam(url.searchParams.get('fire'));
  if (!irwinId) return Response.json({ error: 'Pass ?fire=irwin:<IrwinID>.' }, { status: 400 });

  const cache = caches.default;
  const cacheKey = new Request(`https://catalog-cache.internal/${irwinId.toLowerCase()}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const incident = await fetchIncident(irwinId);
  if (!incident) return Response.json({ error: 'No current NIFC incident with that IrwinID.' }, { status: 404 });

  const now = new Date();
  const discovered = incident.discoveredAt ? new Date(incident.discoveredAt) : now;
  const ageDays = Math.ceil((now.getTime() - discovered.getTime()) / 86_400_000);
  const dayRange = Math.min(MAX_DAYS, Math.max(1, ageDays));
  const seedBounds = seedFootprint(incident.center);
  const result = await fetchDetections(
    context.env,
    seedBounds,
    dayRange,
    cache,
    (promise) => context.waitUntil(promise),
    now
  );

  const startAt = new Date(Math.max(discovered.getTime(), now.getTime() - MAX_DAYS * 86_400_000));
  startAt.setUTCHours(Math.floor(startAt.getUTCHours() / CADENCE_HOURS) * CADENCE_HOURS, 0, 0, 0);
  const framesWithData = new Set((result.detections ?? []).map((row) => frameOf(observedAtOf(row))));
  const snapshots = [];
  for (let time = startAt.getTime(); time <= now.getTime(); time += CADENCE_HOURS * 3_600_000) {
    const frameIso = new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const frameId = frameIso.replace(/:/g, '-');
    const hasData = framesWithData.has(frameIso);
    snapshots.push({
      id: `frame-${frameId}`,
      observedAt: frameIso,
      label: `${frameIso.slice(0, 16).replace('T', ' ')} UTC`,
      status: hasData ? 'ready' : 'awaiting-data',
      layers: [{
        id: `firms-${frameId}`,
        label: 'VIIRS thermal detections',
        kind: 'firms',
        format: 'geojson',
        status: hasData ? 'ready' : 'unavailable',
        ...(hasData
          ? { url: `./api/firms?fire=irwin:${irwinId}&frame=${encodeURIComponent(frameIso)}&days=${dayRange}` }
          : { statusReason: result.detections ? 'No VIIRS detections in this frame' : (result.reason ?? 'FIRMS unavailable') })
      }]
    });
  }

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
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
