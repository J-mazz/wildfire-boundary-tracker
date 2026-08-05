import { upstreamJson, waitUntil, withApiErrors } from './_http';
import { finiteNumber, nifcFeatures, nonEmptyString } from './engine/validation';

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
  const incidents = nifcFeatures(value, true).flatMap((feature) => {
    const attributes = feature.attributes;
    const longitude = finiteNumber(feature.geometry?.x);
    const latitude = finiteNumber(feature.geometry?.y);
    if (!attributes || longitude === null || latitude === null) return [];
    const discovery = finiteNumber(attributes.FireDiscoveryDateTime);
    return [{
      irwinId: (nonEmptyString(attributes.IrwinID) ?? '').replace(/[{}]/g, ''),
      uniqueId: nonEmptyString(attributes.UniqueFireIdentifier),
      name: nonEmptyString(attributes.IncidentName) ?? 'Unnamed fire',
      discoveredAt: discovery === null ? null : new Date(discovery).toISOString(),
      sizeAcres: finiteNumber(attributes.IncidentSize),
      percentContained: finiteNumber(attributes.PercentContained),
      state: nonEmptyString(attributes.POOState),
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
