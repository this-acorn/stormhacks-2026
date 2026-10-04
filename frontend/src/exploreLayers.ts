import { IMPACT_CATEGORIES } from './impactCategories'
import type { LayerId, Organization } from './types'

export interface LayerTheme {
  accent: string
  horizon: string
  /** Camera tilt in degrees, so 3D water, storms and bars read as volumes. */
  pitch: number
  /** One line under the layer's name: what the globe is showing. */
  shows: string
}

export const LAYER_THEMES: Record<LayerId, LayerTheme> = {
  wildfire: {
    accent: '#ff8a3d',
    horizon: '#5a2410',
    pitch: 38,
    shows: 'Latest heat detections · Smoke forecast for North America',
  },
  flood: {
    accent: '#5cc8ff',
    horizon: '#123a5a',
    pitch: 0,
    shows: 'Reported flood events and estimated affected areas',
  },
  storm: {
    accent: '#d6dde6',
    horizon: '#3a4452',
    pitch: 40,
    shows: 'Recent tropical cyclones replaying along their recorded tracks',
  },
  nature: {
    accent: '#7be08f',
    horizon: '#173f22',
    pitch: 0,
    shows: 'Watch the land change through monthly satellite imagery',
  },
  conflict: {
    accent: '#e06a5a',
    horizon: '#3b1714',
    pitch: 0,
    shows: 'Recorded conflict events in the latest month',
  },
  education: {
    accent: '#f5c55b',
    horizon: '#4a3910',
    pitch: 0,
    shows: 'Children not enrolled in school · Primary + lower secondary ages',
  },
  domestic_violence: {
    accent: '#c39bff',
    horizon: '#2e1d4a',
    pitch: 45,
    shows: 'Country bars · Estimated intimate partner violence prevalence',
  },
}
export const DEFAULT_HORIZON = '#273d4c'

export function layerPitch(layer: LayerId | null, zoom: number): number {
  const theme = layer ? LAYER_THEMES[layer] : null
  return theme && zoom >= 4.5 ? theme.pitch : 0
}

export function layerName(layer: LayerId): string {
  return IMPACT_CATEGORIES.find((entry) => entry.id === layer)?.name ?? layer
}

const LAYER_IDS = new Set<string>(IMPACT_CATEGORIES.map((entry) => entry.id))

export function categoryOf(organization: Organization): LayerId | undefined {
  if (organization.category) return organization.category
  const fromRequest = organization.requests.find(
    (request) => request.status === 'published' && LAYER_IDS.has(request.impactCategory ?? ''),
  )?.impactCategory
  return fromRequest as LayerId | undefined
}

/** With no layer selected every organization belongs. */
export function inLayer(organization: Organization, layer: LayerId | null): boolean {
  return layer === null || categoryOf(organization) === layer
}
