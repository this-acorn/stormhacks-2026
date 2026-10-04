import { LAYER_THEMES, layerName } from '../exploreLayers'
import type { LayerSummary } from '../layers'
import type { LayerId } from '../types'

export interface LayerStatus {
  loading: boolean
  error: string
  summary: LayerSummary | null
}

// The large label above the globe: which layer is on, what it shows and where the data comes from.
export default function LayerBanner({ layer, status }: { layer: LayerId; status: LayerStatus }) {
  const theme = LAYER_THEMES[layer]
  const source = status.error
    ? status.error
    : status.loading
      ? 'Loading data…'
      : [status.summary?.source, status.summary?.updated].filter(Boolean).join(' · ')
  return (
    <div
      className="layer-banner"
      style={{ ['--layer-accent' as string]: theme.accent }}
      role="status"
    >
      <span className="layer-banner-eyebrow">LAYER</span>
      <strong className="layer-banner-title">{layerName(layer)}</strong>
      <span className="layer-banner-meta">{theme.shows}</span>
      {source && <span className="layer-banner-source">{source}</span>}
    </div>
  )
}
