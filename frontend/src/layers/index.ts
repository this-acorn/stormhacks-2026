import type { LayerId } from '../types'
import { conflictLayer } from './conflict'
import { loadData, type ConflictData, type Gdacs, type ViolenceData } from './data'
import { illustrativeLayer } from './illustrative'
import { natureLayer } from './nature'
import { stormLayer } from './storm'
import type { HazardLayer, LayerContext } from './types'
import { violenceLayer } from './violence'
import { liveWildfireLayer } from './liveWildfire'
import { liveEducationLayer } from './liveEducation'
import type { EducationGeometry } from '../educationData'
import type { CountryCatalog } from '../violenceData'

export { EffectCanvas } from './canvas'
export type { HazardInfo, HazardLayer, LayerSummary, ScreenPoint } from './types'

/** Load a layer's data and draw it on the globe. */
export async function createHazardLayer(
  layer: LayerId,
  context: LayerContext,
): Promise<HazardLayer> {
  // React may cancel an effect immediately (including Strict Mode's setup/cleanup cycle).
  await Promise.resolve()
  context.signal?.throwIfAborted()
  // A request can finish after the user switches layers. Never attach a stale layer to the map.
  const read = async <T>(name: string): Promise<T> => {
    const data = await loadData<T>(name)
    context.signal?.throwIfAborted()
    return data
  }
  switch (layer) {
    case 'education': {
      return liveEducationLayer(context)
    }
    case 'wildfire':
      return liveWildfireLayer(context)
    case 'flood': {
      const data = await read<Gdacs>('gdacs')
      // Load this renderer on selection so another layer's module cannot block Wildfire.
      const { floodLayer } = await import('./flood')
      context.signal?.throwIfAborted()
      return floodLayer(context, data)
    }
    case 'nature':
      return natureLayer(context)
    case 'storm':
      return stormLayer(context, await read<Gdacs>('gdacs'))
    case 'conflict':
      return conflictLayer(context, await read<ConflictData>('conflict'))
    case 'domestic_violence': {
      const results = await Promise.allSettled([
        read<ViolenceData>('partner-violence'),
        read<EducationGeometry>('education-countries'),
        read<CountryCatalog>('education'),
      ])
      context.signal?.throwIfAborted()
      const [data, geometry, catalog] = results
      if (data.status === 'rejected') throw data.reason
      if (geometry.status === 'rejected') throw geometry.reason
      if (catalog.status === 'rejected') throw catalog.reason
      return violenceLayer(context, data.value, geometry.value, catalog.value)
    }
    default:
      return illustrativeLayer(context, layer)
  }
}
