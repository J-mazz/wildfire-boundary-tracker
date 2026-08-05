import { fetchIncidents, type Incident, type IncidentFetcher } from './incidents';
import { renderIncidents } from './render';

function requiredElement<T extends Element>(
  document: Document,
  id: string,
  expected: abstract new (...args: never[]) => T
): T {
  const element = document.getElementById(id);
  if (!(element instanceof expected)) {
    throw new Error(`Landing page is missing #${id}`);
  }
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startLandingPage(
  document: Document,
  fetcher: IncidentFetcher
): Promise<void> {
  const list = requiredElement(document, 'fires-list', HTMLUListElement);
  const status = requiredElement(document, 'fires-status', HTMLElement);
  const search = requiredElement(document, 'fire-search', HTMLInputElement);
  let incidents: Incident[] = [];
  let loaded = false;

  function renderSearchResults(): void {
    if (!loaded) return;
    renderIncidents(document, list, status, incidents, search.value);
  }
  search.addEventListener('input', renderSearchResults);

  try {
    incidents = await fetchIncidents(fetcher);
    loaded = true;
    renderSearchResults();
  } catch (error) {
    status.textContent = `Could not load incidents: ${errorMessage(error)}`;
  }
}
