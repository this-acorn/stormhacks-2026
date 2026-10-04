import { LngLat, type Map as MapInstance } from 'maplibre-gl'
import type { Coordinates } from '../types'

export type Polygon = Coordinates[][]

const RAD = Math.PI / 180
const METERS_PER_DEGREE = 111_320

export function distanceKm([lng1, lat1]: Coordinates, [lng2, lat2]: Coordinates): number {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lng2 - lng1) * RAD) / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(a))
}

/** A place moved by a number of meters east and north. */
export function offset([lng, lat]: Coordinates, east: number, north: number): Coordinates {
  return [
    lng + east / (METERS_PER_DEGREE * Math.max(Math.cos(lat * RAD), 0.05)),
    Math.max(-89.9, Math.min(89.9, lat + north / METERS_PER_DEGREE)),
  ]
}

/** True when the planet itself is between the camera and this place. */
export function hidden(map: MapInstance, [lng, lat]: Coordinates): boolean {
  return map._camera.transform.isLocationOccluded(new LngLat(lng, lat))
}

/**
 * How one meter east, north and straight up at a place appears on screen, in CSS pixels.
 * Drawing in these axes makes an effect behave like part of the planet: it grows when the
 * camera zooms in, flattens towards the horizon and leans with the camera tilt.
 */
export interface LocalFrame {
  x: number
  y: number
  ex: number
  ey: number
  nx: number
  ny: number
  ux: number
  uy: number
  /** Pixels per meter along the surface, ignoring foreshortening. */
  scale: number
}

export function localFrame(map: MapInstance, at: Coordinates): LocalFrame | null {
  if (hidden(map, at)) return null
  const step = 1000
  const p = map.project(at)
  const east = map.project(offset(at, step, 0))
  const north = map.project(offset(at, 0, step))
  const ex = (east.x - p.x) / step
  const ey = (east.y - p.y) / step
  const nx = (north.x - p.x) / step
  const ny = (north.y - p.y) / step
  // The surface patch is a squashed circle on screen. Its long axis is the true scale; how much
  // shorter the short axis is tells how far the surface leans away, and so how long "up" looks.
  const ee = ex * ex + ey * ey
  const nn = nx * nx + ny * ny
  const en = ex * nx + ey * ny
  const root = Math.sqrt((ee - nn) ** 2 + 4 * en * en)
  const long = Math.sqrt((ee + nn + root) / 2)
  const short = Math.sqrt(Math.max(0, (ee + nn - root) / 2))
  const upLength = Math.sqrt(Math.max(0, long * long - short * short))
  // On a sphere the upward direction always points away from the spot right under the camera.
  const camera = map._camera.transform.getCameraPoint()
  const dx = p.x - camera.x
  const dy = p.y - camera.y
  const away = Math.hypot(dx, dy)
  const ux = away > 0.5 ? (dx / away) * upLength : 0
  const uy = away > 0.5 ? (dy / away) * upLength : -upLength
  return { x: p.x, y: p.y, ex, ey, nx, ny, ux, uy, scale: long }
}

/** A point given in meters east, north and up from the frame's place, on screen. */
export function toScreen(frame: LocalFrame, east: number, north: number, up = 0): [number, number] {
  return [
    frame.x + frame.ex * east + frame.nx * north + frame.ux * up,
    frame.y + frame.ey * east + frame.ny * north + frame.uy * up,
  ]
}

/** Draw in meters around the frame's place (x east, y north), lifted `up` meters. */
export function applyFrame(
  ctx: CanvasRenderingContext2D,
  frame: LocalFrame,
  ratio: number,
  up = 0,
): void {
  ctx.setTransform(
    frame.ex * ratio,
    frame.ey * ratio,
    frame.nx * ratio,
    frame.ny * ratio,
    (frame.x + frame.ux * up) * ratio,
    (frame.y + frame.uy * up) * ratio,
  )
}

export function onScreen(x: number, y: number, width: number, height: number, margin = 0): boolean {
  return x >= -margin && y >= -margin && x <= width + margin && y <= height + margin
}

function ringContains(ring: Coordinates[], [x, y]: Coordinates): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function polygonsContain(polygons: Polygon[], point: Coordinates): boolean {
  return polygons.some(
    ([outer, ...holes]) =>
      ringContains(outer, point) && !holes.some((hole) => ringContains(hole, point)),
  )
}

export function bounds(points: Coordinates[]): [number, number, number, number] {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [lng, lat] of points) {
    west = Math.min(west, lng)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    north = Math.max(north, lat)
  }
  return [west, south, east, north]
}

/** A repeatable random sequence, so the same flood always ripples in the same places. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Random places inside the polygons. */
export function samplePolygons(
  polygons: Polygon[],
  count: number,
  random = seeded(7),
): Coordinates[] {
  const [west, south, east, north] = bounds(polygons.flatMap(([outer]) => outer))
  const points: Coordinates[] = []
  for (let tries = 0; points.length < count && tries < count * 60; tries++) {
    const point: Coordinates = [west + random() * (east - west), south + random() * (north - south)]
    if (polygonsContain(polygons, point)) points.push(point)
  }
  return points
}

export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
