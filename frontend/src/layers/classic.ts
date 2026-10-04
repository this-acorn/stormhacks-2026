import { inLayer } from '../exploreLayers'
import { showFire } from '../fireLayer'
import { LayerEffects } from '../layerEffects'
import type { HazardLayer, LayerContext } from './types'

// Wildfire and Flood in their original form: an animated effect around each of the layer's
// organizations, and in live mode the server's satellite detections for Wildfire.

const FIRE_LAYERS = ['fire-embers', 'fire-glow', 'fire-heat']

export function classicLayer(context: LayerContext, layer: 'wildfire' | 'flood'): HazardLayer {
  const { map, detections } = context
  const effects = new LayerEffects(map, map.getContainer().parentElement!)
  effects.set(
    { effect: layer === 'wildfire' ? 'fire' : 'flood' },
    context.organizations
      .filter((organization) => inLayer(organization, layer))
      .map((organization) => organization.coordinates),
  )
  const stopFire =
    layer === 'wildfire' && detections
      ? showFire(map, detections, true, (id) => {
          const detection = detections.features.find((feature) => feature.properties.id === id)
          if (detection) context.onDetection?.(detection)
        })
      : () => {}
  return {
    summary: { source: '' },
    destroy() {
      stopFire()
      effects.destroy()
      for (const id of FIRE_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource('fire-detections')) map.removeSource('fire-detections')
    },
  }
}
