import type maplibregl from 'maplibre-gl';
import {
  LAYER_FIRMS,
  LAYER_SAM_FILL,
  LAYER_SAM_LINE,
  OPERATIONAL_LAYERS,
  ORDERED_OVERLAY_LAYER_IDS,
  RASTER_ASSERTION_LAYER_IDS,
  SOURCE_FIRMS,
  SOURCE_OPERATIONAL,
  SOURCE_SAM
} from './MapStyle';

function layersForSource(sourceId: string): readonly string[] {
  if (sourceId === SOURCE_SAM) return [LAYER_SAM_FILL, LAYER_SAM_LINE];
  if (sourceId === SOURCE_OPERATIONAL) return OPERATIONAL_LAYERS;
  if (sourceId === SOURCE_FIRMS) return [LAYER_FIRMS];
  throw new Error(`Unknown overlay source: ${sourceId}`);
}

export class MapOverlayManager {
  constructor(private readonly map: maplibregl.Map) {}

  setVisibility(sourceId: string, visible: boolean): void {
    const visibility = visible ? 'visible' : 'none';
    for (const id of layersForSource(sourceId)) {
      this.map.setLayoutProperty(id, 'visibility', visibility);
    }
  }

  raise(): void {
    for (const id of ORDERED_OVERLAY_LAYER_IDS) {
      if (this.map.getLayer(id)) this.map.moveLayer(id);
    }
    this.assertAboveRasters();
  }

  private assertAboveRasters(): void {
    const styleLayers = this.map.getStyle().layers;
    const highestRasterIndex = styleLayers.reduce(
      (highest, layer, index) => layer.type === 'raster' ? Math.max(highest, index) : highest,
      -1
    );
    const hiddenOverlay = RASTER_ASSERTION_LAYER_IDS.find((id) => {
      const index = styleLayers.findIndex((layer) => layer.id === id);
      return index >= 0 && index <= highestRasterIndex;
    });
    if (hiddenOverlay) throw new Error(`Overlay ${hiddenOverlay} is below a raster layer.`);
  }
}
