import { upstreamJson, UpstreamError, waitUntil, withApiErrors } from './_http';

interface NifcFeature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: unknown; y?: unknown };
}

interface NifcResponse {
  features?: NifcFeature[];
}

const UPSTREAM =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const FIELDS = [
  'IncidentName',
  'UniqueFireIdentifier',
  'IrwinID',
  'FireDiscoveryDateTime',
  'IncidentSize',
  'PercentContained',
  'POOState'
].join(',');
const CACHE_SECONDS = 600;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const onRequestGet = withApiErrors(async (context) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/incidents', context.request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const query = new URLSearchParams({
    where: 'IrwinID IS NOT NULL',
    outFields: FIELDS,
    orderByFields: 'FireDiscoveryDateTime DESC',
    resultRecordCount: '300',
    returnGeometry: 'true',
    f: 'json'
  });
  const value = await upstreamJson(
    'NIFC incident service',
    `${UPSTREAM}?${query}`,
    { headers: { Accept: 'application/json' } }
  );
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UpstreamError('NIFC incident service', 'returned an unexpected shape');
  }
  const body = value as NifcResponse;
  if (!Array.isArray(body.features)) {
    throw new UpstreamError('NIFC incident service', 'returned invalid features');
  }

  const incidents = body.features.flatMap((feature) => {
    const attributes = feature.attributes;
    const longitude = finiteNumber(feature.geometry?.x);
    const latitude = finiteNumber(feature.geometry?.y);
    if (!attributes || longitude === null || latitude === null) return [];
    const discovery = finiteNumber(attributes.FireDiscoveryDateTime);
    return [{
      irwinId: (optionalString(attributes.IrwinID) ?? '').replace(/[{}]/g, ''),
      uniqueId: optionalString(attributes.UniqueFireIdentifier),
      name: optionalString(attributes.IncidentName) ?? 'Unnamed fire',
      discoveredAt: discovery === null ? null : new Date(discovery).toISOString(),
      sizeAcres: finiteNumber(attributes.IncidentSize),
      percentContained: finiteNumber(attributes.PercentContained),
      state: optionalString(attributes.POOState),
      lon: longitude,
      lat: latitude
    }];
  });

  const response = Response.json(
    { generatedAt: new Date().toISOString(), source: 'NIFC WFIGS', incidents },
    { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } }
  );
  waitUntil(context, 'incidents_cache_put', cache.put(cacheKey, response.clone()));
  return response;
});
