// GET /api/incidents — proxy for NIFC WFIGS current wildfire incident locations.
// Public upstream (no key). Edge-cached 10 minutes. Returns a trimmed list for the landing page.
//
// Upstream: WFIGS_Incident_Locations_Current FeatureServer (NIFC ArcGIS, EPSG:4269 points).

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

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/incidents', request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const query = new URLSearchParams({
    where: "IncidentSize > 0 AND IrwinID IS NOT NULL",
    outFields: FIELDS,
    orderByFields: 'FireDiscoveryDateTime DESC',
    resultRecordCount: '300',
    returnGeometry: 'true',
    f: 'json'
  });

  const upstream = await fetch(`${UPSTREAM}?${query}`, {
    headers: { Accept: 'application/json' }
  });
  if (!upstream.ok) {
    return Response.json(
      { error: `NIFC upstream returned ${upstream.status}` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const body = await upstream.json();
  if (!Array.isArray(body.features)) {
    return Response.json(
      { error: 'NIFC upstream returned an unexpected shape.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const incidents = body.features
    .filter((f) => f.geometry && Number.isFinite(f.geometry.x) && Number.isFinite(f.geometry.y))
    .map(({ attributes: a, geometry: g }) => ({
      // NIFC wraps IrwinID in braces; strip them so ?fire=irwin:<id> stays clean.
      irwinId: (a.IrwinID ?? '').replace(/[{}]/g, ''),
      uniqueId: a.UniqueFireIdentifier ?? null,
      name: a.IncidentName ?? 'Unnamed fire',
      discoveredAt: a.FireDiscoveryDateTime ? new Date(a.FireDiscoveryDateTime).toISOString() : null,
      sizeAcres: Number.isFinite(a.IncidentSize) ? a.IncidentSize : null,
      percentContained: Number.isFinite(a.PercentContained) ? a.PercentContained : null,
      state: a.POOState ?? null,
      lon: g.x,
      lat: g.y
    }));

  const response = Response.json(
    { generatedAt: new Date().toISOString(), source: 'NIFC WFIGS', incidents },
    { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } }
  );
  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
