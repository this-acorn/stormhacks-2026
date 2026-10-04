import { categoryFor, GALAXIES, hashId } from './cosmosModel'
import type { GalaxyId } from './cosmosModel'
import type { Contribution, Organization } from './types'
import type { SpacePoint } from './cosmosSpace'

export interface StarPattern {
  id: string
  name: string
  description: string
  points: [number, number][]
  edges: [number, number][]
}

// Original simplified drawings, not celestial coordinates or official IAU figures.
// Reference: https://www.iau.org/IAU/IAU/Astronomy-FAQs/Constellations.aspx
// The number of points is the number of contribution stars used in this drawing.
export const STAR_PATTERNS: StarPattern[] = [
  {
    id: 'triangulum',
    name: 'Triangulum',
    description: 'The northern triangle',
    points: [
      [-0.8, -0.55],
      [0.05, 0.9],
      [0.7, -0.4],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
  },
  {
    id: 'triangulum-australe',
    name: 'Triangulum Australe',
    description: 'The southern triangle',
    points: [
      [-0.9, 0.25],
      [0.7, 0.65],
      [0.2, -0.75],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
  },
  {
    id: 'crux',
    name: 'Crux',
    description: 'The Southern Cross',
    points: [
      [0, 0.85],
      [-0.65, 0.15],
      [0.65, 0.05],
      [0.08, -0.95],
    ],
    edges: [
      [0, 3],
      [1, 2],
    ],
  },
  {
    id: 'corvus',
    name: 'Corvus',
    description: 'The crow',
    points: [
      [-0.65, 0.7],
      [0.65, 0.85],
      [0.45, -0.65],
      [-0.9, -0.35],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
  },
  {
    id: 'sagitta',
    name: 'Sagitta',
    description: 'The arrow',
    points: [
      [-0.9, 0.4],
      [-0.9, -0.35],
      [-0.2, 0],
      [0.95, 0.15],
    ],
    edges: [
      [0, 2],
      [1, 2],
      [2, 3],
    ],
  },
  {
    id: 'cassiopeia',
    name: 'Cassiopeia',
    description: 'The familiar W',
    points: [
      [-1, 0.55],
      [-0.55, -0.5],
      [0, 0.25],
      [0.48, -0.7],
      [1, 0.6],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  },
  {
    id: 'cepheus',
    name: 'Cepheus',
    description: 'The king',
    points: [
      [0, 0.95],
      [-0.8, 0.25],
      [-0.55, -0.75],
      [0.65, -0.6],
      [0.8, 0.35],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ],
  },
  {
    id: 'lyra',
    name: 'Lyra',
    description: 'The lyre',
    points: [
      [-0.55, 0.95],
      [-0.25, 0.25],
      [0.7, 0.4],
      [0.4, -0.8],
      [-0.55, -0.7],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 1],
    ],
  },
  {
    id: 'delphinus',
    name: 'Delphinus',
    description: 'The dolphin',
    points: [
      [-0.6, 0.4],
      [0.05, 0.8],
      [0.6, 0.3],
      [0, -0.05],
      [-0.75, -0.9],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [3, 4],
    ],
  },
  {
    id: 'orion',
    name: 'Orion',
    description: 'The hunter · belt and outline',
    points: [
      [-0.65, 0.9],
      [0.55, 0.8],
      [-0.28, 0.1],
      [0, 0],
      [0.28, -0.1],
      [-0.7, -0.9],
      [0.75, -0.8],
    ],
    edges: [
      [0, 1],
      [0, 2],
      [2, 3],
      [3, 4],
      [4, 1],
      [2, 5],
      [5, 6],
      [6, 4],
    ],
  },
  {
    id: 'ursa-major',
    name: 'Ursa Major',
    description: 'The Big Dipper pattern',
    points: [
      [-1, -0.6],
      [-0.65, -0.2],
      [-0.2, -0.1],
      [0.15, 0.35],
      [0.9, 0.5],
      [0.75, -0.15],
      [0.1, -0.3],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 3],
    ],
  },
  {
    id: 'corona-borealis',
    name: 'Corona Borealis',
    description: 'The northern crown',
    points: [
      [-1, 0.35],
      [-0.8, -0.15],
      [-0.45, -0.6],
      [0, -0.8],
      [0.45, -0.55],
      [0.8, -0.1],
      [1, 0.4],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
  },
]

export interface CollectionPlan {
  patternId: string
  category: GalaxyId
  contributionIds: string[]
}
export interface CollectionSnapshot {
  version: 1
  plans: CollectionPlan[]
  seen: string[]
}
export const emptyCollection = (): CollectionSnapshot => ({ version: 1, plans: [], seen: [] })
export const patternFor = (id: string) => STAR_PATTERNS.find((pattern) => pattern.id === id)!
export const isComplete = (plan: CollectionPlan) =>
  plan.contributionIds.length === patternFor(plan.patternId).points.length
const STORAGE_PREFIX = 'aidatlas-constellations-v1:'
const storageKey = (accountId: string) => `${STORAGE_PREFIX}${encodeURIComponent(accountId)}`

export function readCollection(accountId: string): CollectionSnapshot {
  if (!accountId) return emptyCollection()
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(accountId)) || 'null')
    if (raw?.version !== 1 || !Array.isArray(raw.plans) || !Array.isArray(raw.seen))
      return emptyCollection()
    return {
      version: 1,
      plans: raw.plans
        .filter(
          (plan: CollectionPlan) =>
            plan &&
            STAR_PATTERNS.some((pattern) => pattern.id === plan.patternId) &&
            GALAXIES.some((galaxy) => galaxy.id === plan.category) &&
            Array.isArray(plan.contributionIds) &&
            plan.contributionIds.every((id) => typeof id === 'string'),
        )
        .slice(0, STAR_PATTERNS.length),
      seen: raw.seen.filter((id: unknown) => typeof id === 'string'),
    }
  } catch {
    return emptyCollection()
  }
}

export function saveCollection(accountId: string, snapshot: CollectionSnapshot): boolean {
  if (!accountId) return false
  try {
    localStorage.setItem(storageKey(accountId), JSON.stringify(snapshot))
    return true
  } catch {
    return false
  }
}

// A demo reset starts every account's collection over, so constellations can connect again.
export function clearCollections() {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key)
  } catch {
    /* Storage is optional. */
  }
}

// Preserve assignments already made, including when older records arrive later.
// Only actual distinct records count. Amount, confirmation refreshes and visits do not.
export function reconcileCollection(
  accountId: string,
  contributions: Contribution[],
  organizations: Organization[],
  previous: CollectionSnapshot,
): CollectionSnapshot {
  if (!accountId || !contributions.length) return emptyCollection()
  const records = new Map(contributions.map((entry) => [entry.id, entry]))
  const categories = new Map(
    [...records.values()].map((entry) => [entry.id, categoryFor(entry, organizations)]),
  )
  const used = new Set<string>(),
    reserved = new Set<string>()
  const plans: CollectionPlan[] = []
  for (const old of previous.plans) {
    const pattern = STAR_PATTERNS.find((entry) => entry.id === old.patternId)
    if (!pattern || reserved.has(old.patternId)) continue
    const ids = [...new Set(old.contributionIds)]
      .filter((id) => records.has(id) && categories.get(id) === old.category && !used.has(id))
      .slice(0, pattern.points.length)
    if (!ids.length) continue
    ids.forEach((id) => used.add(id))
    reserved.add(old.patternId)
    plans.push({ patternId: old.patternId, category: old.category, contributionIds: ids })
  }
  const ordered = [...records.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )
  for (const record of ordered) {
    if (used.has(record.id)) continue
    const category = categories.get(record.id)!
    let plan = plans.find((entry) => entry.category === category && !isComplete(entry))
    if (!plan) {
      const remaining = STAR_PATTERNS.filter((pattern) => !reserved.has(pattern.id))
      if (!remaining.length) break
      const smallest = Math.min(...remaining.map((pattern) => pattern.points.length))
      const candidates = remaining.filter((pattern) => pattern.points.length === smallest)
      const choice = hashId(`${accountId}/${category}/${plans.length}/v1`) % candidates.length
      const pattern = candidates[choice]
      reserved.add(pattern.id)
      plan = { patternId: pattern.id, category, contributionIds: [] }
      plans.push(plan)
    }
    plan.contributionIds.push(record.id)
    used.add(record.id)
  }
  return {
    version: 1,
    plans,
    seen: [...new Set(previous.seen)].filter((id) =>
      plans.some((plan) => plan.patternId === id && isComplete(plan)),
    ),
  }
}

export function collectionAnchor(plan: CollectionPlan, plans: CollectionPlan[]): SpacePoint {
  const index = plans
    .filter((entry) => entry.category === plan.category)
    .findIndex((entry) => entry.patternId === plan.patternId)
  if (index <= 0) return [0, 0, 0]
  const angle = index * 2.39996
  const radius = 180 * Math.sqrt(index)
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7, -45 * index]
}

export function collectionStarPosition(
  plan: CollectionPlan,
  index: number,
  plans: CollectionPlan[],
): SpacePoint {
  const anchor = collectionAnchor(plan, plans)
  const [x, y] = patternFor(plan.patternId).points[index]
  return [anchor[0] + x * 65, anchor[1] + y * 65, anchor[2]]
}

export function collectionSegments(plan: CollectionPlan): number[] {
  const pattern = patternFor(plan.patternId)
  return pattern.edges.flatMap(([a, b]) => [
    pattern.points[a][0] * 65,
    pattern.points[a][1] * 65,
    0,
    pattern.points[b][0] * 65,
    pattern.points[b][1] * 65,
    0,
  ])
}
