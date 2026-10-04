import type { Coordinates } from '../types'
import { offset, type Polygon } from './geo'

/** Nominal VIIRS hot-pixel footprint, not a confirmed burned-area perimeter. */
export function fireFootprint(at: Coordinates, width = 375): Polygon {
  const half = width / 2
  const ring = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
    [-half, -half],
  ]
  return [ring.map(([east, north]) => offset(at, east, north))]
}
