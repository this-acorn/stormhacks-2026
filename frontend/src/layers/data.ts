// The files written by scripts/build-hazard-data.mjs, as the layers read them.
import type { Coordinates, FireDetections } from '../types'
import type { Polygon } from './geo'

export type Alert = 'Red' | 'Orange' | 'Green'

export interface FireCluster {
  id: string
  center: Coordinates
  bbox: [number, number, number, number]
  count: number
  frpTotal: number
  frpMax: number
  first: string
  last: string
  place: string | null
}
export interface FireData {
  builtAt?: string
  title: string
  source: string
  note: string
  playback: boolean
  start: string
  end: string
  clusters: FireCluster[]
  /** [lng, lat, minutes after start, radiative power MW, cluster index] */
  detections: [number, number, number, number, number][]
}

export interface Flood {
  id: string
  name: string
  country: string
  alert: Alert
  from: string
  to: string
  current: boolean
  center: Coordinates
  areaKm2: number
  impacts: { label: string; value: string; where: string }[]
  source: string
  url?: string
  polygons: Polygon[]
}
export interface WindZone {
  level: 'green' | 'orange' | 'red'
  label: string
  polygons: Polygon[]
}
export interface StormPoint {
  time: string
  at: Coordinates
  /** TD tropical depression, TS tropical storm, HU hurricane / typhoon. */
  category: string
}
export interface Storm {
  id: string
  name: string
  title: string
  countries: string[]
  alert: Alert
  from: string
  to: string
  current: boolean
  maxWindKmh: number
  severity: string
  source: string
  url?: string
  track: StormPoint[]
  zones: WindZone[]
  latestWind: WindZone[]
  cone: Polygon[]
}
export interface Gdacs {
  builtAt: string
  source: string
  from: string
  to: string
  storms: Storm[]
  floods: Flood[]
}

export interface ConflictArea {
  name: string
  country: string
  center: Coordinates
  events: number
  deaths: number
  civilians: number
  conflicts: string[]
  from: string
  to: string
}
export interface ConflictData {
  builtAt: string
  title: string
  source: string
  citation: string
  note: string
  month: string
  areas: ConflictArea[]
  /** [lng, lat, deaths (best estimate), violence type 1–3, area index] */
  events: [number, number, number, number, number][]
}

export interface Estimate {
  value: number
  low: number
  high: number
}
export interface ViolenceCountry {
  iso3: string
  name: string
  at: Coordinates
  year: number
  all: Estimate
  young: Estimate | null
}
export interface ViolenceData {
  builtAt: string
  title: string
  measure: string
  source: string
  note: string
  year: number
  countries: ViolenceCountry[]
}

const cache = new Map<string, Promise<unknown>>()

export function loadData<T>(name: string): Promise<T> {
  let request = cache.get(name)
  if (!request) {
    request = fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Layer data unavailable (${response.status}).`)
        return response.json()
      })
      .catch((error: unknown) => {
        cache.delete(name)
        throw error
      })
    cache.set(name, request)
  }
  return request as Promise<T>
}

/** Live mode: group the server's detections into fires the same way the data script does. */
export function firesFromDetections(collection: FireDetections, title: string): FireData {
  const points = collection.features.map((feature) => ({
    lng: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    frp: feature.properties.frpMw ?? 0,
    time: Date.parse(feature.properties.acquiredAt),
  }))
  const start = Math.min(...points.map((point) => point.time))
  const end = Math.max(...points.map((point) => point.time))
  const CELL = 0.03
  const cells = new Map<string, number[]>()
  points.forEach((point, index) => {
    const key = `${Math.floor(point.lng / CELL)},${Math.floor(point.lat / CELL)}`
    cells.set(key, [...(cells.get(key) ?? []), index])
  })
  const parent = new Map([...cells.keys()].map((key) => [key, key]))
  const find = (key: string): string => {
    while (parent.get(key) !== key) key = parent.get(key)!
    return key
  }
  for (const key of cells.keys()) {
    const [i, j] = key.split(',').map(Number)
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        if (cells.has(`${i + di},${j + dj}`)) parent.set(find(`${i + di},${j + dj}`), find(key))
  }
  const groups = new Map<string, number[]>()
  for (const [key, members] of cells)
    groups.set(find(key), [...(groups.get(find(key)) ?? []), ...members])
  const clusters: FireCluster[] = []
  const detections: FireData['detections'] = []
  ;[...groups.values()]
    .sort((a, b) => b.length - a.length)
    .forEach((members, index) => {
      const group = members.map((member) => points[member])
      const lngs = group.map((point) => point.lng)
      const lats = group.map((point) => point.lat)
      clusters.push({
        id: `live-fire-${index}`,
        center: [
          lngs.reduce((a, b) => a + b, 0) / group.length,
          lats.reduce((a, b) => a + b, 0) / group.length,
        ],
        bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
        count: group.length,
        frpTotal: Math.round(group.reduce((sum, point) => sum + point.frp, 0)),
        frpMax: Math.max(...group.map((point) => point.frp)),
        first: new Date(Math.min(...group.map((point) => point.time))).toISOString(),
        last: new Date(Math.max(...group.map((point) => point.time))).toISOString(),
        place: null,
      })
      for (const point of group)
        detections.push([point.lng, point.lat, (point.time - start) / 60_000, point.frp, index])
    })
  return {
    title,
    source: collection.features[0]?.properties.source ?? 'NASA FIRMS',
    note: 'Recorded satellite heat detections. Not a confirmed fire perimeter.',
    playback: collection.features.some((feature) => feature.properties.playback),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    clusters,
    detections,
  }
}

const numberFormat = new Intl.NumberFormat('en-US')
export const formatNumber = (value: number) => numberFormat.format(Math.round(value))

const dayFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const yearFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' })
const timeFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

export function formatRange(from: string, to: string, withTime = false): string {
  const start = new Date(from)
  const end = new Date(to)
  if (withTime) return `${timeFormat.format(start)} – ${timeFormat.format(end)} UTC`
  const year = yearFormat.format(end)
  const first = dayFormat.format(start)
  const last = dayFormat.format(end)
  return first === last ? `${first}, ${year}` : `${first} – ${last}, ${year}`
}

export function formatMoment(time: string | number): string {
  return `${timeFormat.format(new Date(time))} UTC`
}
