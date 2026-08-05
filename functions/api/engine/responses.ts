import { frameFeatures } from './calculations';
import {
  FRAME_CACHE_SECONDS,
  PERIMETER_CACHE_SECONDS,
  PERSISTENCE_HOURS,
  type DetectionResult,
  type PerimeterResult
} from './domain';

export function perimeterResponse(result: PerimeterResult): Response {
  return Response.json(result.collection, {
    headers: { 'Cache-Control': `public, max-age=${PERIMETER_CACHE_SECONDS}` }
  });
}

export function frameResponse(
  result: DetectionResult,
  frameIso: string,
  persistenceHours = PERSISTENCE_HOURS
): Response {
  if (!result.detections || !result.timeline) {
    throw new Error('FIRMS timeline is unavailable.');
  }
  const frameMs = Date.parse(frameIso);
  const range = result.timeline.range(frameMs, persistenceHours);
  const rows = result.detections.slice(
    range.beginIndex,
    range.beginIndex + range.featureCount
  );
  return Response.json(
    {
      type: 'FeatureCollection',
      properties: { observedAt: frameIso, source: 'NASA FIRMS VIIRS', persistenceHours },
      features: frameFeatures(rows, frameMs)
    },
    { headers: { 'Cache-Control': `public, max-age=${FRAME_CACHE_SECONDS}` } }
  );
}
