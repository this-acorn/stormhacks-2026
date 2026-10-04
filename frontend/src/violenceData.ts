import type { EducationGeometry } from './educationData'
import type { Estimate, ViolenceCountry, ViolenceData } from './layers/data'
import { polygonsContain, type Polygon } from './layers/geo'
import type { Coordinates, Organization } from './types'

// Reuse the geographic catalog shipped with Education; no education measures are used here.
export interface CountryCatalog {
  countries: { id: string; name: string; center: Coordinates | null; zoom?: number }[]
}

export interface ViolencePlace {
  id: string
  name: string
  center: Coordinates | null
  zoom: number
  estimate: ViolenceCountry | null
}

export interface ViolenceStatus {
  data: ViolenceData
  countries: ViolencePlace[]
  geometry: EducationGeometry
  selectedId: string | null
  coverage: number
}

export const VIOLENCE_SOURCE_URL = 'https://www.who.int/publications/i/item/9789240116962'
export const VIOLENCE_METERS_PER_POINT = 32_000
export const VIOLENCE_COLOR_STOPS = [
  { value: 3, color: '#7d6fd8' },
  { value: 10, color: '#a77bff' },
  { value: 20, color: '#d06bff' },
  { value: 30, color: '#ff5fae' },
  { value: 40, color: '#ff7d7d' },
] as const

/** Match the map's linear RGB interpolation, including its clamped endpoints. */
export function violenceColor(value: number): string {
  const first = VIOLENCE_COLOR_STOPS[0]
  if (value <= first.value) return first.color
  for (let index = 1; index < VIOLENCE_COLOR_STOPS.length; index++) {
    const lower = VIOLENCE_COLOR_STOPS[index - 1]
    const upper = VIOLENCE_COLOR_STOPS[index]
    if (value > upper.value) continue
    const t = (value - lower.value) / (upper.value - lower.value)
    return (
      '#' +
      [1, 3, 5]
        .map((channel) => {
          const start = parseInt(lower.color.slice(channel, channel + 2), 16)
          const end = parseInt(upper.color.slice(channel, channel + 2), 16)
          return Math.round(start + (end - start) * t)
            .toString(16)
            .padStart(2, '0')
        })
        .join('')
    )
  }
  return VIOLENCE_COLOR_STOPS[VIOLENCE_COLOR_STOPS.length - 1].color
}

/** Display height in metres; it encodes prevalence, not physical terrain or case counts. */
export function violenceHeight(rate: number | null): number {
  if (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 100) return 0
  return rate * VIOLENCE_METERS_PER_POINT
}

export function validEstimate(estimate: Estimate | null | undefined): estimate is Estimate {
  return (
    !!estimate &&
    [estimate.value, estimate.low, estimate.high].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    ) &&
    estimate.low <= estimate.value &&
    estimate.value <= estimate.high
  )
}

export function violenceCountries(data: ViolenceData, catalog: CountryCatalog): ViolencePlace[] {
  const places = new Map<string, ViolencePlace>(
    catalog.countries.map((country) => [
      country.id,
      {
        id: country.id,
        name: country.name,
        center: country.center,
        zoom: country.zoom ?? 3,
        estimate: null,
      },
    ]),
  )
  for (const estimate of data.countries) {
    const id = estimate.iso3
    const place = places.get(id) ?? {
      id,
      name: estimate.name,
      center: estimate.at,
      zoom: 3,
      estimate: null,
    }
    if (validEstimate(estimate.all) && Number.isInteger(estimate.year)) place.estimate = estimate
    places.set(id, place)
  }
  return [...places.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const violencePercent = (value: number) =>
  value > 0 && value < 0.1 ? '<0.1%' : `${value.toFixed(1)}%`

export function violenceFrequency(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null
  return `About 1 in ${Math.max(1, Math.round(100 / value)).toLocaleString()} women`
}

export function domesticRequests(organization: Organization) {
  return organization.requests
    .filter(
      (request) =>
        request.status === 'published' &&
        request.quantity > request.fulfilled &&
        (request.impactCategory === 'domestic_violence' ||
          (!request.impactCategory && organization.category === 'domestic_violence')),
    )
    .sort((a, b) => Number(b.urgency === 'urgent') - Number(a.urgency === 'urgent'))
}

/** Match public city-level positions to boundaries, never infer worldwide service coverage. */
export function countryOrganizations(
  id: string,
  geometry: EducationGeometry,
  organizations: Organization[],
) {
  const polygons = geometry.features
    .filter((feature) => feature.properties.id === id)
    .flatMap((feature) =>
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates as Polygon]
        : (feature.geometry.coordinates as Polygon[]),
    )
  return organizations
    .filter(
      (organization) =>
        domesticRequests(organization).length > 0 &&
        polygonsContain(polygons, organization.coordinates),
    )
    .sort(
      (a, b) =>
        Number(domesticRequests(b).some((request) => request.urgency === 'urgent')) -
          Number(domesticRequests(a).some((request) => request.urgency === 'urgent')) ||
        a.name.localeCompare(b.name),
    )
}
