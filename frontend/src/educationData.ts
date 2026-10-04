import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { Coordinates } from './types'

export interface EducationObservation {
  rate: number
  count: number | null
  ages: [number, number] | null
  flags: string[]
  notes: string[]
}

export interface EducationCountry {
  id: string
  name: string
  center: Coordinates | null
  zoom?: number
  years: Record<string, EducationObservation>
}

export interface EducationData {
  schemaVersion: 1
  source: string
  sourceUrl: string
  release: string
  releaseId?: string
  builtAt?: string
  checkedAt?: string
  updates?: {
    state: 'current' | 'checking' | 'stale' | 'offline'
    automatic: boolean
    checkedAt: string | null
    nextCheckAt?: string
  }
  license: string
  licenseUrl: string
  years: number[]
  defaultYear: number
  countries: EducationCountry[]
}

export type EducationGeometry = FeatureCollection<Polygon | MultiPolygon, { id: string }>

export interface EducationStatus {
  data: EducationData
  selectedId: string | null
  coverage: number
}

export function observation(country: EducationCountry, year: number): EducationObservation | null {
  const row = country.years[String(year)]
  return row && Number.isFinite(row.rate) && row.rate >= 0 && row.rate <= 100 ? row : null
}

/** Latest valid published record for this country, preserving that record's year and count. */
export function latestObservation(
  country: EducationCountry,
  years: readonly number[],
): (EducationObservation & { year: number }) | null {
  for (const year of [...years].sort((a, b) => b - a)) {
    const row = observation(country, year)
    if (row) return { ...row, year }
  }
  return null
}

export const EDUCATION_COLORS = ['#ffe9a3', '#efc263', '#d69731', '#ae641d', '#7a3914']
export const EDUCATION_STOPS = [0, 10, 25, 50, 100]
export const EDUCATION_NO_DATA = '#424952'

export function educationColor(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 100) return EDUCATION_NO_DATA
  const index = EDUCATION_STOPS.findIndex((stop) => rate <= stop)
  if (index === 0) return EDUCATION_COLORS[0]
  const fraction =
    (rate - EDUCATION_STOPS[index - 1]) / (EDUCATION_STOPS[index] - EDUCATION_STOPS[index - 1])
  const rgb = (hex: string) =>
    [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const from = rgb(EDUCATION_COLORS[index - 1])
  const to = rgb(EDUCATION_COLORS[index])
  return `rgb(${from.map((value, channel) => Math.round(value + (to[channel] - value) * fraction)).join(', ')})`
}

export function educationPercent(rate: number): string {
  if (rate > 0 && rate < 0.1) return '<0.1%'
  if (rate < 100 && rate > 99.9) return '>99.9%'
  return `${rate.toFixed(1)}%`
}

/** A literal 10 x 10 proportional diagram; individual dots are rounded. */
export function emptyEducationDots(rate: number): number {
  return Math.round(Math.min(100, Math.max(0, rate)))
}

/** Keep gaps in the time series, including missing years between observations. */
export function educationTrend(country: EducationCountry, years: number[]): string[] {
  const paths: string[] = []
  let path = ''
  years.forEach((year, index) => {
    const row = observation(country, year)
    if (!row) {
      if (path) paths.push(path)
      path = ''
      return
    }
    const x = 4 + (index / Math.max(1, years.length - 1)) * 252
    const y = 54 - row.rate * 0.5
    path += `${path ? ' L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
  })
  if (path) paths.push(path)
  return paths
}
