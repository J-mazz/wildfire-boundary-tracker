import {
  type Env,
  frameCacheRequest,
  frameResponse,
  fetchDetections,
  fetchIncident,
  parseFireParam,
  seedFootprint
} from './_engine';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const irwinId = parseFireParam(url.searchParams.get('fire'));
  const frame = url.searchParams.get('frame');
  const days = Number(url.searchParams.get('days') ?? '10');
  if (!irwinId || !frame || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(frame)
    || !Number.isInteger(days) || days < 1 || days > 10) {
    return Response.json({ error: 'Pass ?fire=irwin:<id>&frame=<iso frame start>&days=<1-10>.' }, { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = frameCacheRequest(irwinId, frame, days);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const incident = await fetchIncident(irwinId);
  if (!incident) return Response.json({ error: 'No current NIFC incident with that IrwinID.' }, { status: 404 });

  const result = await fetchDetections(
    context.env,
    seedFootprint(incident.center, incident.sizeAcres),
    days,
    cache,
    (promise) => context.waitUntil(promise)
  );
  if (!result.detections) {
    return Response.json({ error: result.reason }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const response = frameResponse(result.detections, frame);
  const body = await response.clone().json<{ features: unknown[] }>();
  if (body.features.length === 0) return Response.json({ error: 'No detections in this frame.' }, { status: 404 });

  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
