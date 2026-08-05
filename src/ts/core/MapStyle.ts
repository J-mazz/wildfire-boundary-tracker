import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
  RasterSourceSpecification,
  StyleSpecification
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { BaseImagery, EventConfiguration } from '../types';

export const BASE_SOURCE = 'world-imagery';
export const BASE_LAYER = 'world-imagery';
export const SOURCE_SAM = 'sam-fire-body';
export const SOURCE_OPERATIONAL = 'operational-vectors';
export const SOURCE_FIRMS = 'viirs-trail';
export const SOURCE_SENTINEL = 'sentinel-acquisition';
export const LAYER_SAM_FILL = 'sam-body-fill';
export const LAYER_SAM_LINE = 'sam-body-outline';
export const LAYER_FIRMS = 'viirs-thermal-field';
export const LAYER_SENTINEL = 'sentinel-acquisition';

export const DEFAULT_BASE_IMAGERY: BaseImagery = {
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  attribution: 'Earth imagery © Esri and contributors',
  maxzoom: 19
};

export const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] };
export const CONTEXT_LINE_LAYERS = ['context-roads', 'context-county-borders', 'context-city-limits'] as const;
export const CONTEXT_LABEL_LAYERS = [
  'context-road-labels',
  'context-county-labels',
  'context-city-labels',
  'context-landscape-labels'
] as const;
export const OPERATIONAL_LAYERS = [
  ...CONTEXT_LINE_LAYERS,
  ...CONTEXT_LABEL_LAYERS,
  'operational-fill',
  'operational-line',
  'operational-points'
] as const;
export const ORDERED_OVERLAY_LAYER_IDS = [
  ...CONTEXT_LINE_LAYERS,
  LAYER_FIRMS,
  LAYER_SAM_FILL,
  LAYER_SAM_LINE,
  ...CONTEXT_LABEL_LAYERS,
  'operational-fill',
  'operational-line',
  'operational-points',
  'event-area-outline'
] as const;
export const RASTER_ASSERTION_LAYER_IDS = [
  ...CONTEXT_LINE_LAYERS,
  LAYER_FIRMS,
  LAYER_SAM_FILL,
  LAYER_SAM_LINE,
  'event-area-outline'
] as const;

export function imagerySource(imagery: BaseImagery): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: imagery.tiles,
    tileSize: imagery.tileSize ?? 256,
    minzoom: imagery.minzoom ?? 0,
    maxzoom: imagery.maxzoom ?? 19,
    attribution: imagery.attribution
  };
}

export function initialMapStyle(imagery: BaseImagery): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { [BASE_SOURCE]: imagerySource(imagery) },
    layers: [{ id: BASE_LAYER, type: 'raster', source: BASE_SOURCE }]
  };
}

export function persistentSources(): ReadonlyArray<[string, GeoJSONSourceSpecification]> {
  return [
    [SOURCE_SAM, { type: 'geojson', data: EMPTY_COLLECTION }],
    [SOURCE_OPERATIONAL, {
      type: 'geojson',
      data: EMPTY_COLLECTION,
      attribution: '© OpenStreetMap contributors'
    }],
    [SOURCE_FIRMS, { type: 'geojson', data: EMPTY_COLLECTION }]
  ];
}

function contextLabel(
  id: string,
  contextType: string,
  placement: 'line' | 'point',
  minzoom: number,
  color: string
): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source: SOURCE_OPERATIONAL,
    filter: ['==', ['get', 'contextType'], contextType],
    minzoom,
    layout: {
      visibility: 'none',
      'symbol-placement': placement,
      'text-field': ['coalesce', ['get', 'name'], ''],
      'text-font': ['Noto Sans Regular'],
      'text-size': placement === 'line' ? 10.5 : 11,
      'text-padding': 6,
      'text-allow-overlap': false
    },
    paint: {
      'text-color': color,
      'text-halo-color': 'rgba(8, 12, 18, 0.92)',
      'text-halo-width': 1.3
    }
  };
}

export function persistentLayers(): LayerSpecification[] {
  return [
    {
      id: LAYER_SAM_FILL,
      type: 'fill',
      source: SOURCE_SAM,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0], 0, '#ff4d20', 168, '#6b1717'],
        'fill-opacity': ['interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0], 0, 0.55, 168, 0.16],
        'fill-antialias': true,
        'fill-opacity-transition': { duration: 180 }
      }
    },
    {
      id: LAYER_SAM_LINE,
      type: 'line',
      source: SOURCE_SAM,
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0], 0, '#ffd166', 168, '#8f2020'],
        'line-width': ['interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0], 0, 2.2, 168, 0.8],
        'line-opacity': 0.9
      }
    },
    {
      id: 'context-roads',
      type: 'line',
      source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'roads'],
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#f4e8c8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 11, 1.4, 15, 3.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.38, 12, 0.78]
      }
    },
    {
      id: 'context-county-borders',
      type: 'line',
      source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'county-borders'],
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': '#dbeafe',
        'line-width': 1.6,
        'line-dasharray': [5, 3],
        'line-opacity': 0.7
      }
    },
    {
      id: 'context-city-limits',
      type: 'line',
      source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'city-limits'],
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': '#fde68a',
        'line-width': 1.35,
        'line-dasharray': [2, 2],
        'line-opacity': 0.78
      }
    },
    contextLabel('context-road-labels', 'roads', 'line', 11, '#fff5d6'),
    contextLabel('context-county-labels', 'county-borders', 'line', 7, '#dbeafe'),
    contextLabel('context-city-labels', 'city-limits', 'line', 9, '#fde68a'),
    {
      id: 'context-landscape-labels',
      type: 'symbol',
      source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'landscape-features'],
      minzoom: 9,
      layout: {
        visibility: 'none',
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 13],
        'text-padding': 5,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#d9f99d',
        'text-halo-color': 'rgba(5, 15, 12, 0.9)',
        'text-halo-width': 1.35
      }
    },
    {
      id: 'operational-fill',
      type: 'fill',
      source: SOURCE_OPERATIONAL,
      filter: ['any', ['!', ['has', 'contextType']], ['==', ['get', 'contextType'], 'incident-perimeter']],
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.2 }
    },
    {
      id: 'operational-line',
      type: 'line',
      source: SOURCE_OPERATIONAL,
      filter: ['any', ['!', ['has', 'contextType']], ['==', ['get', 'contextType'], 'incident-perimeter']],
      layout: { visibility: 'none' },
      paint: { 'line-color': '#fbbf24', 'line-width': 2.4, 'line-opacity': 0.95 }
    },
    {
      id: 'operational-points',
      type: 'circle',
      source: SOURCE_OPERATIONAL,
      filter: ['any', ['!', ['has', 'contextType']], ['==', ['get', 'contextType'], 'incident-perimeter']],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': '#fbbf24',
        'circle-radius': 4,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1
      }
    },
    {
      id: LAYER_FIRMS,
      type: 'heatmap',
      source: SOURCE_FIRMS,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': [
          '*',
          ['interpolate', ['linear'], ['coalesce', ['get', 'frpMw'], 0], 0, 0.08, 10, 0.3, 50, 0.72, 200, 1],
          ['interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0], 0, 1, 72, 0.55, 168, 0.12]
        ],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 11, 1.25, 15, 1.7],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 7, 11, 18, 15, 32],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(75, 13, 13, 0)',
          0.15, 'rgba(127, 29, 29, 0.28)',
          0.35, 'rgba(220, 38, 38, 0.48)',
          0.58, 'rgba(249, 115, 22, 0.64)',
          0.8, 'rgba(251, 191, 36, 0.78)',
          1, 'rgba(255, 245, 180, 0.9)'
        ],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.72, 13, 0.58, 17, 0.42]
      }
    }
  ];
}

export function eventAreaData(event: EventConfiguration): FeatureCollection {
  const [west, south, east, north] = event.bounds;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: event.name },
      geometry: {
        type: 'Polygon',
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
      }
    }]
  };
}

export const EVENT_AREA_LAYER: LayerSpecification = {
  id: 'event-area-outline',
  type: 'line',
  source: 'event-area',
  paint: {
    'line-color': '#ffd166',
    'line-width': 1,
    'line-dasharray': [2, 4],
    'line-opacity': 0.3
  }
};
