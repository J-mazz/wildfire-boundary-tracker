import {
  fetchCurrentPerimeter,
  parseFireParam,
  perimeterCacheRequest,
  perimeterResponse
} from './_engine';
import { waitUntil, withApiErrors } from './_http';

export const onRequestGet = withApiErrors<Env>(async (context) => {
  const irwinId = parseFireParam(new URL(context.request.url).searchParams.get('fire'));
  if (!irwinId) return Response.json({ error: 'Pass ?fire=irwin:<IrwinID>.' }, { status: 400 });

  const cache = caches.default;
  const cacheKey = perimeterCacheRequest(irwinId);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const result = await fetchCurrentPerimeter(irwinId);
  if (!result) {
    return Response.json(
      { error: 'No current public WFIGS perimeter is available for this incident.' },
      { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } }
    );
  }
  const response = perimeterResponse(result);
  waitUntil(context, 'perimeter_cache_put', cache.put(cacheKey, response.clone()));
  return response;
});