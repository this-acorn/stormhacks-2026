export interface SmokeForecast {
  source: string
  layer: string
  modelRun: string
  times: string[]
  bounds: [number, number, number, number]
  resolutionKm: number
  coverage: string
  units: string
}

export interface SmokeStatus {
  forecast: SmokeForecast | null
  requested: string | null
  displayed: string | null
  displayedRun: string | null
  loading: boolean
  error: string
}

export const EMPTY_SMOKE: SmokeStatus = {
  forecast: null,
  requested: null,
  displayed: null,
  displayedRun: null,
  loading: true,
  error: '',
}

export const SMOKE_LAYER = 'RAQDPS.Sfc_PM2.5-WildfireSmokePlume'
export const SMOKE_STYLE = 'PM2.5_0to100ugm3_Dis'

// ECCC's discrete legend: 1–10, 10–20, …, 90–100, ≥100 µg/m³.
// Only recolor published pixels; transparent pixels stay transparent. These are concentration
// bands, not AQHI categories. The small tolerance accounts for PNG color-profile rounding.
const palette = [
  [33, 198, 245],
  [24, 154, 202],
  [13, 103, 151],
  [255, 253, 55],
  [255, 204, 46],
  [254, 154, 63],
  [253, 103, 105],
  [255, 59, 59],
  [255, 1, 1],
  [203, 7, 19],
  [101, 2, 5],
]

export function recolorSmoke(pixels: Uint8ClampedArray): void {
  let unknown = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue
    const band = palette.findIndex(
      ([r, g, b]) =>
        Math.abs(r - pixels[i]) <= 2 &&
        Math.abs(g - pixels[i + 1]) <= 2 &&
        Math.abs(b - pixels[i + 2]) <= 2,
    )
    if (band < 0) {
      unknown++
      continue
    }
    // Charcoal keeps even the lowest published band visible on satellite terrain.
    // Concentration controls darkness, never the footprint or the location of the plume.
    const tone = Math.round(108 - band * 7)
    pixels[i] = tone + 3
    pixels[i + 1] = tone + 1
    pixels[i + 2] = tone
    pixels[i + 3] = Math.round(pixels[i + 3] * (0.46 + band * 0.037))
  }
  // A changed provider palette should report an error, never fabricate smoke coverage.
  if (unknown) throw new Error('The smoke forecast palette has changed.')
}

export function smokeTileUrl(forecast: SmokeForecast, time: string): string {
  if (forecast.layer !== SMOKE_LAYER || !forecast.times.includes(time))
    throw new Error('Smoke forecast time unavailable.')
  const query = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: SMOKE_LAYER,
    STYLES: SMOKE_STYLE,
    CRS: 'EPSG:3857',
    WIDTH: '256',
    HEIGHT: '256',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    TIME: time,
    DIM_REFERENCE_TIME: forecast.modelRun,
  })
  return `https://geo.weather.gc.ca/geomet?${query}&BBOX={bbox-epsg-3857}`
}

export const smokeTimeLabel = (time: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(time))
