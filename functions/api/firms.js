// GET /api/firms?fire=irwin:<id>&frame=<iso>&days=<n> — per-frame VIIRS GeoJSON.
// Serves only real detections for the requested cadence frame; 404 when the frame is empty.

import {
  fetchDetections,
  fetchIncident,
  growFootprint,
  parseFireParam,
  seedFootprint,
  toFrameFeatures
} from './_engine.js';

const CACHE_SECONDS = 1800;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
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
  if (!incident) {
    return Response.json({ error: 'No current NIFC incident with that IrwinID.' }, { status: 404 });
  }

  let bounds = seedFootprint(incident.center);
  const { detections, reason } = await fetchDetections(env, bounds, days, cache, waitUntil);
  if (!detections) {
    return Response.json({ error: reason }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  bounds = growFootprint(bounds, detections);

  const features = toFrameFeatures(detections, frame);
  if (features.length === 0) {
    return Response.json({ error: 'No detections in this frame.' }, { status: 404 });
  }

  const response = Response.json(
    { type: 'FeatureCollection', properties: { observedAt: frame, source: 'NASA FIRMS VIIRS' }, features },
    { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } }
  );
  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
