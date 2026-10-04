import { ShapeUtils, Vector2 } from 'three'
import type { Coordinates } from './types'
import type { Flood } from './layers/data'
import { distanceKm, polygonsContain } from './layers/geo'

export function sortFloods(floods: Flood[]): Flood[] {
  const priority = { Red: 3, Orange: 2, Green: 1 }
  return [...floods].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      priority[b.alert] - priority[a.alert] ||
      Date.parse(b.to) - Date.parse(a.to) ||
      a.id.localeCompare(b.id),
  )
}

/** Reported centres can fall outside a multipart area or in a hole. Keep the close view inside it. */
export function floodFocus(flood: Flood): Coordinates {
  if (polygonsContain(flood.polygons, flood.center)) return flood.center
  let focus = flood.center
  let nearest = Infinity
  for (const polygon of flood.polygons) {
    const rings = polygon.map((ring) => {
      const points = ring.map(([x, y]) => new Vector2(x, y))
      if (points.length > 1 && points[0].equals(points.at(-1)!)) points.pop()
      return points
    })
    if (!rings[0] || rings[0].length < 3) continue
    const triangles = ShapeUtils.triangulateShape(rings[0], rings.slice(1))
    const points = rings.flat()
    for (const triangle of triangles) {
      const at: Coordinates = [
        triangle.reduce((sum, index) => sum + points[index].x, 0) / 3,
        triangle.reduce((sum, index) => sum + points[index].y, 0) / 3,
      ]
      const distance = distanceKm(at, flood.center)
      if (distance < nearest && polygonsContain(flood.polygons, at)) {
        nearest = distance
        focus = at
      }
    }
  }
  return focus
}
