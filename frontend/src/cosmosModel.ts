import { IMPACT_CATEGORIES } from './impactCategories'
import type { CurrentImpactCategory } from './impactCategories'
import type { Contribution, ImpactCategory, Organization } from './types'

export type GalaxyId = CurrentImpactCategory | 'unclassified'
export const GALAXIES: { id: GalaxyId; name: string; description: string; x: number; y: number }[] =
  [
    ...IMPACT_CATEGORIES.map((category, index) => ({
      ...category,
      x: Math.cos(index) * 550,
      y: Math.sin(index) * 300,
    })),
    {
      id: 'unclassified',
      name: 'Other contributions',
      description: 'Preserved records without one of the seven current categories',
      x: 0,
      y: 750,
    },
  ]
// Explicit fixture labels, never inferred from a real organization's name or location.
export const DEMO_CATEGORIES: Record<string, ImpactCategory> = {
  okanagan: 'wildfire',
  coast: 'community',
  guatemala: 'flood',
  morocco: 'community',
  kenya: 'flood',
  nepal: 'education',
  philippines: 'disaster',
  korea: 'community',
}

export function categoryFor(contribution: Contribution, organizations: Organization[]): GalaxyId {
  if (contribution.impactCategory === 'community' || contribution.impactCategory === 'disaster')
    return 'unclassified'
  if (GALAXIES.some((entry) => entry.id === contribution.impactCategory))
    return contribution.impactCategory as GalaxyId
  const organization = organizations.find((entry) => entry.id === contribution.organizationId)
  const request = organization?.requests.find((entry) => entry.id === contribution.requestId)
  if (request?.impactCategory && GALAXIES.some((entry) => entry.id === request.impactCategory))
    return request.impactCategory as GalaxyId
  const demoCategory = contribution.simulated
    ? DEMO_CATEGORIES[contribution.organizationId]
    : undefined
  return GALAXIES.some((entry) => entry.id === demoCategory)
    ? (demoCategory as GalaxyId)
    : 'unclassified'
}

export function ageOf(contribution: Contribution, now = Date.now()) {
  const date = Date.parse(contribution.createdAt)
  if (!Number.isFinite(date)) return { days: null, label: 'Date unavailable', color: '#f3f3ef' }
  const days = Math.max(0, Math.floor((now - date) / 86_400_000))
  return {
    days,
    label: days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'} ago`,
    color:
      days <= 7
        ? STAR_AGE_COLORS.recent
        : days <= 30
          ? STAR_AGE_COLORS.month
          : STAR_AGE_COLORS.older,
  }
}

export const STAR_AGE_COLORS = { recent: '#75b5ff', month: '#fff5e7', older: '#ffac61' }

export function hashId(id: string) {
  let hash = 2166136261
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

export interface Constellation {
  key: string
  category: GalaxyId
  organizationId: string
  name: string
  contributions: Contribution[]
  x: number
  y: number
}

export function constellations(
  contributions: Contribution[],
  organizations: Organization[],
): Constellation[] {
  const groups = new Map<string, Constellation>()
  for (const contribution of contributions) {
    const category = categoryFor(contribution, organizations)
    const key = `${category}:${contribution.organizationId}`
    if (!groups.has(key)) {
      const seed = hashId(key)
      const angle = ((seed % 360) * Math.PI) / 180
      const radius = 60 + (seed % 90)
      groups.set(key, {
        key,
        category,
        organizationId: contribution.organizationId,
        name: contribution.organizationName,
        contributions: [],
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.55,
      })
    }
    groups.get(key)!.contributions.push(contribution)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    contributions: group.contributions.sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ),
  }))
}

// ID-derived positions stay stable when new contributions arrive. Amount never affects geometry.
export function starOffset(id: string) {
  const hash = hashId(id)
  const angle = ((hash % 3600) * Math.PI) / 1800
  const radius = 15 + ((hash >>> 10) % 60)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.7 }
}
