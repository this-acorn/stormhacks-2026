import { GALAXIES, hashId } from './cosmosModel'
import type { Constellation, GalaxyId } from './cosmosModel'

export type SpacePoint = [number, number, number]

// The viewer floats within the seven regions; Earth sits directly below their center.
export function galaxyPosition(id: GalaxyId): SpacePoint {
  if (id === 'unclassified') return [-391.5, -390, -188.5]
  const index = GALAXIES.findIndex((galaxy) => galaxy.id === id)
  const [x, y, z] = (
    [
      [-175, 35, -360],
      [-410, -55, -80],
      [-330, 120, 285],
      [395, 95, -55],
      [250, -70, 370],
      [155, -30, -410],
      [25, 150, 425],
    ] satisfies SpacePoint[]
  )[Math.max(0, index)]
  // Center the seven regions horizontally over Earth without flattening their depth.
  return [(x + 90 / 7) * 1.45, y * 1.25 - 300, (z - 25) * 1.45]
}

// Stable places make it possible to return to a constellation after looking away.
export function organizationPosition(key: string): SpacePoint {
  const random = seededRandom(hashId(key))
  const angle = random() * Math.PI * 2
  const radius = 35 + random() * 55
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6, (random() - 0.5) * 55]
}

export function contributionPosition(id: string): SpacePoint {
  const random = seededRandom(hashId(id))
  const angle = random() * Math.PI * 2
  const radius = 24 + random() * 30
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.75, (random() - 0.5) * 42]
}

// A sparse connected tree reads like a constellation, even with a single record.
export function organizationLinks(group: Constellation): number[] {
  const connected: SpacePoint[] = [[0, 0, 0]]
  const remaining = [...group.contributions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => contributionPosition(entry.id))
  const segments: number[] = []
  while (remaining.length) {
    let nearest = 0,
      origin = connected[0],
      distance = Infinity
    for (let i = 0; i < remaining.length; i++) {
      for (const point of connected) {
        const next = remaining[i]
        const separation = Math.hypot(...next.map((value, axis) => value - point[axis]))
        if (separation < distance) {
          distance = separation
          origin = point
          nearest = i
        }
      }
    }
    const [point] = remaining.splice(nearest, 1)
    segments.push(...origin, ...point)
    connected.push(point)
  }
  return segments
}

export function selectedOrganization(
  groups: Constellation[],
  selectedId: string | null,
  selectedCluster: string | null,
) {
  return (
    groups.find((group) => group.contributions.some((entry) => entry.id === selectedId)) ??
    groups.find((group) => group.key === selectedCluster)
  )
}

export function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}
