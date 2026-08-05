import { upstreamJson, UpstreamError } from '../_http';
import type { Incident, PerimeterResult } from './domain';
import { finiteNumber, nifcFeatures, nonEmptyString, type NifcFeature } from './validation';

const NIFC_QUERY =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const NIFC_PERIMETER_QUERY =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';

function normalizedIrwinId(irwinId: string): string {
  return irwinId.replace(/[{}]/g, '').toUpperCase();
}

function isoTimestamp(value: unknown): string | null {
  const timestamp = finiteNumber(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function incidentCenter(feature: NifcFeature | undefined): Incident['center'] | null {
  const longitude = finiteNumber(feature?.geometry?.x);
  const latitude = finiteNumber(feature?.geometry?.y);
  if (longitude === null || latitude === null) return null;
  return [longitude, latitude];
}

function incidentName(value: unknown): string {
  return nonEmptyString(value) ?? 'Unnamed fire';
}

function incidentFromFeature(irwinId: string, feature: NifcFeature | undefined): Incident | null {
  const center = incidentCenter(feature);
  if (!feature?.attributes || !center) return null;
  const attributes = feature.attributes;
  return {
    irwinId,
    name: incidentName(attributes.IncidentName),
    discoveredAt: isoTimestamp(attributes.FireDiscoveryDateTime),
    sizeAcres: finiteNumber(attributes.IncidentSize),
    percentContained: finiteNumber(attributes.PercentContained),
    state: nonEmptyString(attributes.POOState),
    center
  };
}

export async function fetchIncident(irwinId: string): Promise<Incident | null> {
  const query = new URLSearchParams({
    where: `IrwinID = '{${normalizedIrwinId(irwinId)}}'`,
    outFields: 'IncidentName,UniqueFireIdentifier,IrwinID,FireDiscoveryDateTime,IncidentSize,PercentContained,POOState',
    returnGeometry: 'true',
    resultRecordCount: '1',
    f: 'json'
  });
  const value = await upstreamJson(
    'NIFC incident service',
    `${NIFC_QUERY}?${query}`,
    { headers: { Accept: 'application/json' } }
  );
  return incidentFromFeature(irwinId, nifcFeatures(value)[0]);
}

function perimeterTimestamp(feature: unknown): number | null {
  if (typeof feature !== 'object' || feature === null || Array.isArray(feature)) return null;
  const properties = (feature as Record<string, unknown>).properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return null;
  return finiteNumber((properties as Record<string, unknown>).poly_PolygonDateTime);
}

function newestPerimeterTimestamp(features: unknown[]): number {
  let newest = Number.NEGATIVE_INFINITY;
  for (const feature of features) {
    const timestamp = perimeterTimestamp(feature);
    if (timestamp !== null) newest = Math.max(newest, timestamp);
  }
  return newest;
}

function perimeterCollection(value: unknown): PerimeterResult['collection'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UpstreamError('NIFC perimeter service', 'returned an unexpected shape');
  }
  const collection = value as Record<string, unknown>;
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new UpstreamError('NIFC perimeter service', 'returned invalid GeoJSON');
  }
  return collection as PerimeterResult['collection'];
}

function perimeterResult(collection: PerimeterResult['collection']): PerimeterResult | null {
  if (collection.features.length === 0) return null;
  const newestTimestamp = newestPerimeterTimestamp(collection.features);
  return {
    collection,
    featureCount: collection.features.length,
    observedAt: Number.isFinite(newestTimestamp) ? new Date(newestTimestamp).toISOString() : null
  };
}

export async function fetchCurrentPerimeter(irwinId: string): Promise<PerimeterResult | null> {
  const normalizedId = normalizedIrwinId(irwinId);
  const query = new URLSearchParams({
    where: `poly_IRWINID = '{${normalizedId}}'`,
    outFields: 'poly_IncidentName,poly_GISAcres,poly_PolygonDateTime,poly_MapMethod,poly_Source',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson'
  });
  const value = await upstreamJson('NIFC perimeter service', `${NIFC_PERIMETER_QUERY}?${query}`, {
    headers: { Accept: 'application/geo+json, application/json' }
  });
  return perimeterResult(perimeterCollection(value));
}
