import type { LayerDefinition } from './types'
import { IMPACT_CATEGORIES } from './impactCategories'

export const INITIAL_VIEW = {
  center: [-120, 45] as [number, number],
  zoom: 1.8,
  bearing: 0,
  pitch: 0,
}

// Room above the globe for the layer's name, and below it for the legend.
export function globePadding(width: number) {
  return width <= 700
    ? { top: 130, bottom: 70, left: 0, right: 0 }
    : { top: 150, bottom: 70, left: 0, right: 0 }
}

export function globeDiameter(width: number, height: number) {
  const { top, bottom } = globePadding(width)
  return Math.min(width * 0.82, (height - top - bottom) * 0.96)
}

export function globeOverview(width: number, height: number) {
  const diameter = globeDiameter(width, height)
  const distance = height * 1.5
  const radius =
    (diameter ** 2 / distance + Math.sqrt(diameter ** 4 / distance ** 2 + 4 * diameter ** 2)) / 4
  const worldSize = radius * 2 * Math.PI * Math.cos((INITIAL_VIEW.center[1] * Math.PI) / 180)
  return {
    ...INITIAL_VIEW,
    zoom: Math.max(0.3, Math.log2(worldSize / 512)),
    padding: globePadding(width),
  }
}
export const SATELLITE_TILES =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'
export const SATELLITE_MAX_ZOOM = 14
export const NIGHT_TILES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'
export const SATELLITE_ATTRIBUTION =
  '<a href="https://cloudless.eox.at/">EOxCloudless</a> by <a href="https://eox.at/">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2024) · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>'
export const NIGHT_ATTRIBUTION =
  '<a href="https://www.earthdata.nasa.gov/centers/gibs">NASA GIBS</a> · Suomi NPP / VIIRS · 2012'

export const LAYERS: LayerDefinition[] = IMPACT_CATEGORIES.map((category) => ({
  ...category,
  available: true,
  description:
    category.id === 'wildfire'
      ? 'Satellite observations · organization requests'
      : 'Organization requests · observation overlay not connected',
}))

export function formatDate(date: string, includeTime = false): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
    ...(includeTime
      ? ({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'UTC' } as const)
      : {}),
  }).format(new Date(date))
}
