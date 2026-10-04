import type { Map as MapInstance, MercatorCoordinate } from 'maplibre-gl'
import type { Coordinates } from '../types'
import { polygonsContain, segmentDistance } from './geo'
import type { ScreenPoint } from './types'

export interface ViolenceBar {
  id: string
  corners: MercatorCoordinate[]
  height: number
}

function silhouette(points: Coordinates[]): Coordinates[] {
  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])
  const half = (vertices: Coordinates[]) => {
    const edge: Coordinates[] = []
    for (const point of vertices) {
      while (edge.length >= 2) {
        const a = edge[edge.length - 2]
        const b = edge[edge.length - 1]
        if ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) > 0) break
        edge.pop()
      }
      edge.push(point)
    }
    return edge
  }
  if (sorted.length <= 2) return sorted
  return [...half(sorted).slice(0, -1), ...half(sorted.toReversed()).slice(0, -1)]
}

/** Use the renderer's elevated globe/flat projection, not a ground-level feature query. */
export function pickViolenceBar(
  map: MapInstance,
  bars: ViolenceBar[],
  point: ScreenPoint,
  heightScale: number,
  tolerance: number,
): string | null {
  const transform = map._camera.transform
  const tiles = map.coveringTiles({ tileSize: 512, minzoom: 0, maxzoom: 0 })
  let closest: { id: string; distance: number; depth: number } | null = null
  for (const tile of tiles) {
    const unwrapped = tile.toUnwrapped()
    for (const bar of bars) {
      const vertices: Coordinates[] = []
      let depth = Infinity
      for (const corner of bar.corners) {
        const at = tile.canonical.getTilePoint(corner)
        for (const elevation of [0, bar.height * heightScale]) {
          const projected = transform.projectTileCoordinates(at.x, at.y, unwrapped, elevation)
          if (projected.isOccluded || projected.signedDistanceFromCamera <= 0) continue
          const x = ((projected.point.x + 1) * transform.width) / 2
          const y = ((1 - projected.point.y) * transform.height) / 2
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          vertices.push([x, y])
          depth = Math.min(depth, projected.signedDistanceFromCamera)
        }
      }
      if (!vertices.length) continue
      const hull = silhouette(vertices)
      const distance = polygonsContain([[hull]], [point.x, point.y])
        ? 0
        : Math.min(
            ...hull.map(([x, y], index) => {
              const next = hull[(index + 1) % hull.length]
              return segmentDistance(point.x, point.y, x, y, next[0], next[1])
            }),
          )
      if (distance > tolerance) continue
      if (
        !closest ||
        distance < closest.distance ||
        (distance === closest.distance && depth < closest.depth)
      )
        closest = { id: bar.id, distance, depth }
    }
  }
  return closest?.id ?? null
}
