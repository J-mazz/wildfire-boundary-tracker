import { toFrameFeatures } from './calculations';
import {
  FRAME_CACHE_SECONDS,
  PERIMETER_CACHE_SECONDS,
  PERSISTENCE_HOURS,
  type Detection,
  type PerimeterResult
} from './domain';

export function perimeterResponse(result: PerimeterResult): Response {
  return Response.json(result.collection, {
    headers: { 'Cache-Control': `public, max-age=${PERIMETER_CACHE_SECONDS}` }
  });
}

export function frameResponse(
  rows: Detection[],
  frameIso: string,
  persistenceHours = PERSISTENCE_HOURS
): Response {
  return Response.json(
    {
      type: 'FeatureCollection',
      properties: { observedAt: frameIso, source: 'NASA FIRMS VIIRS', persistenceHours },
      features: toFrameFeatures(rows, frameIso, persistenceHours)
    },
    { headers: { 'Cache-Control': `public, max-age=${FRAME_CACHE_SECONDS}` } }
  );
}
