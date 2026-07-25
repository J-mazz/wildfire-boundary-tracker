import {
  type Env,
  fetchDetections,
  fetchIncident,
  parseFireParam,
  seedFootprint,
  toFrameFeatures
} from './_engine';

const CACHE_SECONDS = 1800;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const irwinId = parseFireParam(url.searchParams.get('fire'));
  const frame = url.searchParams.get('frame');
  const days = Number(url.searchParams.get('days') ?? '10');
  if (!irwinId || !frame || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(frame)) {
    return Response.json({ error: 'Pass ?fire=irwin:<id>&frame=<iso frame start>.' }, { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://firms-frame-cache.internal/${irwinId.toLowerCase()}/${frame}/${days}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const incident = await fetchIncident(irwinId);
  if (!incident) return Response.json({ error: 'No current NIFC incident with that IrwinID.' }, { status: 404 });

  const result = await fetchDetections(
    context.env,
    seedFootprint(incident.center),
    days,
    cache,
    (promise) => context.waitUntil(promise)
  );
  if (!result.detections) {
    return Response.json({ error: result.reason }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const features = toFrameFeatures(result.detections, frame);
  if (features.length === 0) return Response.json({ error: 'No detections in this frame.' }, { status: 404 });

  const response = Response.json(
    { type: 'FeatureCollection', properties: { observedAt: frame, source: 'NASA FIRMS VIIRS' }, features },
    { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } }
  );
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
