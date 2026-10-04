// Global mosaics checked against the actual world tiles, not just HTTP availability.
// The 2017 endpoint has large no-data areas outside Europe; omit it from global playback.
// 2016 is published under the original, unversioned layer name.
export const NATURE_YEARS = [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const
export const LATEST_NATURE_YEAR = NATURE_YEARS[NATURE_YEARS.length - 1]
export const MONTHLY_MIN_ZOOM = 9
export const OVERVIEW_MAX_ZOOM = 2
export type NaturePeriod = number | string // Annual year or monthly YYYY-MM.

export interface NatureCatalog {
  months: string[]
  latestObservation: string
  minZoom: number
  maxZoom: number
  cloudCoverMax: number
}

export interface MonthlyMosaic {
  month: string
  searchId: string
  minZoom: number
  maxZoom: number
  cloudCoverMax: number
}

export function natureLabel(period: NaturePeriod): string {
  return typeof period === 'number'
    ? String(period)
    : new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${period}-01T00:00:00Z`),
      )
}

export interface ImageryStatus {
  requested: NaturePeriod
  displayed: NaturePeriod
  loading: boolean
  error: string
  months?: string[]
  catalogLoading?: boolean
  catalogError?: string
  overview?: boolean
}

export function natureTiles(year: number): string {
  if (!NATURE_YEARS.some((entry) => entry === year))
    throw new Error('Imagery is unavailable for this year.')
  const layer = year === 2016 ? 's2cloudless' : `s2cloudless-${year}`
  return `https://tiles.maps.eox.at/wmts/1.0.0/${layer}_3857/default/g/{z}/{y}/{x}.jpg`
}

export function natureAttribution(year: number): string {
  const license = year <= 2017 ? 'by' : 'by-nc-sa'
  return `<a href="https://cloudless.eox.at/">EOxCloudless</a> by EOX IT Services GmbH · Contains modified Copernicus Sentinel data ${year} · <a href="https://creativecommons.org/licenses/${license}/4.0/">CC ${year <= 2017 ? 'BY' : 'BY-NC-SA'} 4.0</a>`
}
