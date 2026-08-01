import {
  frameCacheRequest,
  frameResponse,
  fetchDetections,
  fetchIncident,
  parseFireParam,
  seedFootprint,
  validFrameParam
} from './_engine';
import { waitUntil, withApiErrors } from './_http';

export const onRequestGet = withApiErrors<Env>(async (context) => {
  const url = new URL(context.request.url);
  const irwinId = parseFireParam(url.searchParams.get('fire'));
  const frame = url.searchParams.get('frame');
  const days = Number(url.searchParams.get('days') ?? '10');
  if (!irwinId || !frame || !Number.isInteger(days) || days < 1 || days > 10
    || !validFrameParam(frame, days)) {
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
    (promise, operation) => waitUntil(context, operation, promise)
  );
  if (!result.detections) {
    return Response.json({ error: result.reason }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const response = frameResponse(result.detections, frame);
  const body = await response.clone().json<{ features: unknown[] }>();
  if (body.features.length === 0) {
    return Response.json({ error: 'No detections within the persistence window.' }, { status: 404 });
  }

  waitUntil(context, 'frame_cache_put', cache.put(cacheKey, response.clone()));
  return response;
});
