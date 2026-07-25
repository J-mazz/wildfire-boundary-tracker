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

export const onRequestGet: PagesFunction = async (context) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/incidents', context.request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const query = new URLSearchParams({
    where: 'IncidentSize > 0 AND IrwinID IS NOT NULL',
    outFields: FIELDS,
    orderByFields: 'FireDiscoveryDateTime DESC',
    resultRecordCount: '300',
    returnGeometry: 'true',
    f: 'json'
  });
  const upstream = await fetch(`${UPSTREAM}?${query}`, { headers: { Accept: 'application/json' } });
  if (!upstream.ok) {
    return Response.json(
      { error: `NIFC upstream returned ${upstream.status}` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body: NifcResponse = await upstream.json();
  if (!Array.isArray(body.features)) {
    return Response.json(
      { error: 'NIFC upstream returned an unexpected shape.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
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
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
