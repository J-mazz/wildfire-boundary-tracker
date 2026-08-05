import type { Incident } from './incidents';

export function acresLabel(sizeAcres: number | null): string {
  if (sizeAcres === null) return '';
  return sizeAcres >= 1000
    ? `${(sizeAcres / 1000).toFixed(1)}k acres`
    : `${Math.round(sizeAcres)} acres`;
}

export function matchingIncidents(incidents: Incident[], filter: string): Incident[] {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return incidents;
  const matches: Incident[] = [];
  for (const fire of incidents) {
    const nameMatches = fire.name.toLowerCase().includes(needle);
    const stateMatches = (fire.state ?? '').toLowerCase().includes(needle);
    if (nameMatches || stateMatches) matches.push(fire);
  }
  return matches;
}

function incidentItem(document: Document, fire: Incident): HTMLLIElement {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = `./map.html?fire=irwin:${encodeURIComponent(fire.irwinId)}`;
  const name = document.createElement('strong');
  name.textContent = fire.name;
  const meta = document.createElement('span');
  const candidates = [
    fire.state,
    acresLabel(fire.sizeAcres),
    fire.percentContained === null ? null : `${fire.percentContained}% contained`,
    fire.discoveredAt ? `since ${fire.discoveredAt.slice(0, 10)}` : null
  ];
  const parts: string[] = [];
  for (const candidate of candidates) {
    if (candidate) parts.push(candidate);
  }
  meta.textContent = parts.join(' · ');
  link.append(name, meta);
  item.appendChild(link);
  return item;
}

export function renderIncidents(
  document: Document,
  list: HTMLUListElement,
  status: HTMLElement,
  incidents: Incident[],
  filter = ''
): void {
  const matches = matchingIncidents(incidents, filter);
  const items: HTMLLIElement[] = [];
  for (const fire of matches.slice(0, 100)) {
    items.push(incidentItem(document, fire));
  }
  list.replaceChildren(...items);
  status.textContent = matches.length === 0
    ? 'No fires match.'
    : `${matches.length} current incident${matches.length === 1 ? '' : 's'}${matches.length > 100 ? ' (showing 100)' : ''}`;
}
