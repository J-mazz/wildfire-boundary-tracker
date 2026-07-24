// GET /api/catalog?fire=irwin:<id> — synthesizes a snapshot catalog (same contract as the
// static dist/data/catalog.json) for any current NIFC incident. Nothing is persisted:
// NIFC seeds the footprint, FIRMS detections grow it, and every layer URL points back
// at /api/firms which serves per-frame GeoJSON on demand.

import {
  CADENCE_HOURS,
  fetchDetections,
  fetchIncident,
  frameOf,
  growFootprint,
  observedAtOf,
  parseFireParam,
  seedFootprint
} from './_engine.js';

const CACHE_SECONDS = 900;
const MAX_DAYS = 10; // FIRMS area API history limit

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const irwinId = parseFireParam(url.searchParams.get('fire'));
  if (!irwinId) {
    return Response.json({ error: 'Pass ?fire=irwin:<IrwinID>.' }, { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://catalog-cache.internal/${irwinId.toLowerCase()}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const incident = await fetchIncident(irwinId);
  if (!incident) {
    return Response.json({ error: 'No current NIFC incident with that IrwinID.' }, { status: 404 });
  }

  const discovered = incident.discoveredAt ? new Date(incident.discoveredAt) : new Date();
  const now = new Date();
  const ageDays = Math.ceil((now - discovered) / 86_400_000);
  const dayRange = Math.min(MAX_DAYS, Math.max(1, ageDays));

  let bounds = seedFootprint(incident.center);
  const { detections, reason } = await fetchDetections(env, bounds, dayRange, cache, waitUntil);
  if (detections && detections.length > 0) {
    bounds = growFootprint(bounds, detections);
  }

  // Timeline: never earlier than what the FIRMS area API can actually serve.
  const startAt = new Date(Math.max(discovered.getTime(), now.getTime() - MAX_DAYS * 86_400_000));
  startAt.setUTCHours(Math.floor(startAt.getUTCHours() / CADENCE_HOURS) * CADENCE_HOURS, 0, 0, 0);

  // Frames that actually contain detections (real observations only).
  const framesWithData = new Set((detections ?? []).map((row) => frameOf(observedAtOf(row))));

  const snapshots = [];
  for (let t = startAt.getTime(); t <= now.getTime(); t += CADENCE_HOURS * 3_600_000) {
    const frameIso = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const frameId = frameIso.replace(/:/g, '-');
    const hasData = framesWithData.has(frameIso);
    snapshots.push({
      id: `frame-${frameId}`,
      observedAt: frameIso,
      label: frameIso.slice(0, 16).replace('T', ' ') + ' UTC',
      layers: [
        {
          id: `firms-${frameId}`,
          label: 'VIIRS thermal detections',
          kind: 'firms',
          format: 'geojson',
          status: hasData ? 'ready' : 'missing',
          ...(hasData
            ? { url: `./api/firms?fire=irwin:${irwinId}&frame=${encodeURIComponent(frameIso)}&days=${dayRange}` }
            : { statusReason: detections ? 'No VIIRS detections in this frame' : (reason ?? 'FIRMS unavailable') })
        }
      ]
    });
  }

  const catalog = {
    version: '1',
    updatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    pollIntervalSeconds: 300,
    event: {
      id: `irwin-${irwinId.toLowerCase()}`,
      name: incident.name,
      center: incident.center,
      bounds
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

  const response = Response.json(catalog, {
    headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` }
  });
  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
