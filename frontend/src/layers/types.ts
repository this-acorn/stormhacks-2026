import type { Map as MapInstance } from 'maplibre-gl'
import type { Coordinates, FireDetection, FireDetections, Organization } from '../types'
import type { EffectCanvas } from './canvas'
import type { ImageryStatus } from '../natureImagery'
import type { SmokeStatus } from '../smokeForecast'
import type { EducationStatus } from '../educationData'
import type { ViolenceStatus } from '../violenceData'

/** What the hover card shows for a disaster, a country or an area. */
export interface HazardInfo {
  eyebrow: string
  title: string
  subtitle?: string
  /** GDACS-style alert colour, when the source gives one. */
  alert?: 'red' | 'orange' | 'green'
  facts: { label: string; value: string }[]
  note?: string
  source: string
}

export interface ScreenPoint {
  x: number
  y: number
}

export interface LayerContext {
  signal?: AbortSignal
  onImageryStatus?: (status: ImageryStatus) => void
  onSummary?: (summary: LayerSummary) => void
  onSmokeStatus?: (status: SmokeStatus) => void
  onEducationStatus?: (status: EducationStatus) => void
  onViolenceStatus?: (status: ViolenceStatus) => void
  map: MapInstance
  canvas: EffectCanvas
  organizations: Organization[]
  /** Live mode: the server's satellite detections (the BC replay). */
  detections: FireDetections | null
  hover: (info: HazardInfo | null, point?: ScreenPoint) => void
  onDetection?: (detection: FireDetection) => void
}

export interface LayerSummary {
  source: string
  updated?: string
  imagery?: string
  imageryNote?: string
}

export interface HazardLayer {
  summary: LayerSummary
  selectEducationCountry?: (id: string | null) => void
  selectViolenceCountry?: (id: string | null) => void
  setYear?: (year: number) => void
  setForecastTime?: (time: string) => void
  retryForecast?: () => void
  /** The disaster drawn under a screen point, for the hover card. */
  hitTest?: (point: ScreenPoint) => HazardInfo | null
  /** Where to take the camera when the drawn disaster under a screen point is clicked. */
  focus?: (point: ScreenPoint) => {
    center: Coordinates
    zoom: number
    padding?: { top: number; bottom: number; left: number; right: number }
  } | null
  destroy: () => void
}
