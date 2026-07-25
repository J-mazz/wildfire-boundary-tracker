const list = document.getElementById('fires-list');
const status = document.getElementById('fires-status');
const search = document.getElementById('fire-search');

let incidents = [];

function acresLabel(sizeAcres) {
  if (!Number.isFinite(sizeAcres)) return '';
  return sizeAcres >= 1000 ? `${(sizeAcres / 1000).toFixed(1)}k acres` : `${Math.round(sizeAcres)} acres`;
}

function render(filter = '') {
  const needle = filter.trim().toLowerCase();
  const matches = needle
    ? incidents.filter((f) => f.name.toLowerCase().includes(needle) || (f.state ?? '').toLowerCase().includes(needle))
    : incidents;
  list.replaceChildren(
    ...matches.slice(0, 100).map((fire) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `./map.html?fire=irwin:${encodeURIComponent(fire.irwinId)}`;
      const name = document.createElement('strong');
      name.textContent = fire.name;
      const meta = document.createElement('span');
      const parts = [
        fire.state,
        acresLabel(fire.sizeAcres),
        Number.isFinite(fire.percentContained) ? `${fire.percentContained}% contained` : null,
        fire.discoveredAt ? `since ${fire.discoveredAt.slice(0, 10)}` : null
      ].filter(Boolean);
      meta.textContent = parts.join(' · ');
      link.append(name, meta);
      item.appendChild(link);
      return item;
    })
  );
  status.textContent = matches.length === 0
    ? 'No fires match.'
    : `${matches.length} current incident${matches.length === 1 ? '' : 's'}${matches.length > 100 ? ' (showing 100)' : ''}`;
}

async function load() {
  try {
    const response = await fetch('./api/incidents', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const body = await response.json();
    incidents = body.incidents ?? [];
    render();
  } catch (error) {
    status.textContent = `Could not load incidents: ${error instanceof Error ? error.message : String(error)}`;
  }
}

search.addEventListener('input', () => render(search.value));
void load();
