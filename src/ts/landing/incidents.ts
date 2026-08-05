export interface Incident {
  irwinId: string;
  uniqueId: string | null;
  name: string;
  discoveredAt: string | null;
  sizeAcres: number | null;
  percentContained: number | null;
  state: string | null;
  lon: number;
  lat: number;
}

export interface IncidentFeed {
  generatedAt: string;
  source: string;
  incidents: Incident[];
}

function invalid(path: string): never {
  throw new Error(`Incident response is invalid at ${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(path);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requiredString(value, path);
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path);
  return value;
}

function incident(value: unknown, path: string): Incident {
  if (!isRecord(value)) invalid(path);
  return {
    irwinId: requiredString(value.irwinId, `${path}.irwinId`),
    uniqueId: nullableString(value.uniqueId, `${path}.uniqueId`),
    name: requiredString(value.name, `${path}.name`),
    discoveredAt: nullableString(value.discoveredAt, `${path}.discoveredAt`),
    sizeAcres: nullableNumber(value.sizeAcres, `${path}.sizeAcres`),
    percentContained: nullableNumber(value.percentContained, `${path}.percentContained`),
    state: nullableString(value.state, `${path}.state`),
    lon: nullableNumber(value.lon, `${path}.lon`) ?? invalid(`${path}.lon`),
    lat: nullableNumber(value.lat, `${path}.lat`) ?? invalid(`${path}.lat`)
  };
}

export function validateIncidentFeed(value: unknown): IncidentFeed {
  if (!isRecord(value)) invalid('response');
  if (!Array.isArray(value.incidents)) invalid('incidents');
  const incidents: Incident[] = [];
  for (let index = 0; index < value.incidents.length; index += 1) {
    if (!Object.hasOwn(value.incidents, index)) invalid(`incidents[${index}]`);
    incidents.push(incident(value.incidents[index], `incidents[${index}]`));
  }
  return {
    generatedAt: requiredString(value.generatedAt, 'generatedAt'),
    source: requiredString(value.source, 'source'),
    incidents
  };
}

export type IncidentFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function fetchIncidents(
  fetcher: IncidentFetcher,
  url = './api/incidents'
): Promise<Incident[]> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  return validateIncidentFeed(await response.json()).incidents;
}
