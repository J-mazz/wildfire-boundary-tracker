import {
  catalogCacheRequest,
  frameCacheRequest,
  perimeterCacheRequest
} from './engine/cache';
import { seedFootprint } from './engine/calculations';
import { buildCatalog, createCatalogPlan } from './engine/catalog-builder';
import { CATALOG_CACHE_SECONDS } from './engine/domain';
import { fetchDetections } from './engine/firms';
import { fetchCurrentPerimeter, fetchIncident } from './engine/nifc';
import { frameResponse, perimeterResponse } from './engine/responses';
import { parseFireParam } from './engine/validation';
import { logDegraded, waitUntil, withApiErrors } from './_http';

export const onRequestGet = withApiErrors<Env>(async (context) => {
  const url = new URL(context.request.url);
  const irwinId = parseFireParam(url.searchParams.get('fire'));
  if (!irwinId) return Response.json({ error: 'Pass ?fire=irwin:<IrwinID>.' }, { status: 400 });

  const cache = caches.default;
  const cacheKey = catalogCacheRequest(irwinId);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const incident = await fetchIncident(irwinId);
  if (!incident) return Response.json({ error: 'No current NIFC incident with that IrwinID.' }, { status: 404 });

  const now = new Date();
  const plan = createCatalogPlan(incident, now);
  const seedBounds = seedFootprint(incident.center, incident.sizeAcres);
  const [result, perimeter] = await Promise.all([
    fetchDetections(
      context.env,
      seedBounds,
      plan.dayRange,
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

  const built = buildCatalog({ irwinId, incident, result, perimeter, plan, now });
  const frameCacheWrites = result.detections
    ? built.cacheableFrames.map((frameIso) => cache.put(
        frameCacheRequest(irwinId, frameIso, plan.dayRange),
        frameResponse(result, frameIso)
      ))
    : [];
  if (frameCacheWrites.length > 0) waitUntil(context, 'catalog_frame_cache_put', Promise.all(frameCacheWrites));

  const response = Response.json(built.catalog, {
    headers: { 'Cache-Control': `public, max-age=${CATALOG_CACHE_SECONDS}` }
  });
  waitUntil(context, 'catalog_cache_put', cache.put(cacheKey, response.clone()));
  return response;
});
