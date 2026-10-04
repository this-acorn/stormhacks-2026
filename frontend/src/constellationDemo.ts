import { patternFor } from './constellationCollection'
import type { CollectionSnapshot } from './constellationCollection'
import type { Contribution, Organization } from './types'
import type { CurrentImpactCategory } from './impactCategories'

export const DEMO_SUPPORTER_ACCOUNT = 'demo-supporter'
export const LEGACY_CONSTELLATION_ACCOUNT = 'demo-constellation-explorer'

// Curated examples use the same records, renderer and discovery flow as a real
// collection, as part of the default demo supporter's existing account.
export function createConstellationDemo(organizations: Organization[], now = Date.now()) {
  const examples: {
    patternId: string
    category: CurrentImpactCategory
    organizations: string[]
  }[] = [
    { patternId: 'orion', category: 'wildfire', organizations: ['okanagan'] },
    { patternId: 'cassiopeia', category: 'education', organizations: ['nepal'] },
    { patternId: 'crux', category: 'flood', organizations: ['guatemala', 'kenya'] },
  ]
  const contributions: Contribution[] = []
  const collection: CollectionSnapshot = { version: 1, plans: [], seen: [] }
  for (const [exampleIndex, example] of examples.entries()) {
    const contributionIds = patternFor(example.patternId).points.map((_, index, points) => {
      const organization = organizations.find(
        (entry) => entry.id === example.organizations[index % example.organizations.length],
      )
      if (!organization)
        throw new Error('A sample organization is missing. Reset the demo and try again.')
      const id = `constellation-example-${example.patternId}-${index + 1}`
      const createdAt = new Date(now - (exampleIndex * 12 + index) * 86_400_000).toISOString()
      // Keep one constellation star pending; the rest form a steady demo sky.
      const confirmed = exampleIndex !== 0 || index !== points.length - 1
      contributions.push({
        id,
        organizationId: organization.id,
        organizationName: organization.name,
        impactCategory: example.category,
        kind: 'volunteer',
        summary: '1 hour of volunteer time',
        quantity: 1,
        createdAt,
        status: confirmed ? 'organization_confirmed' : 'pledged',
        ...(confirmed ? { confirmedQuantity: 1, confirmedAt: createdAt } : {}),
        simulated: true,
      })
      return id
    })
    collection.plans.push({
      patternId: example.patternId,
      category: example.category,
      contributionIds,
    })
  }
  return { contributions, collection }
}

// Existing assignments take precedence; merging never duplicates a contribution.
export function mergeExampleCollection(
  previous: CollectionSnapshot,
  examples: CollectionSnapshot,
  legacy?: CollectionSnapshot,
): CollectionSnapshot {
  const plans = [...previous.plans]
  const seen = new Set(previous.seen)
  const patterns = new Set(plans.map((plan) => plan.patternId))
  const records = new Set(plans.flatMap((plan) => plan.contributionIds))
  for (const source of [legacy, examples]) {
    for (const plan of source?.plans ?? []) {
      const existing = plans.find((entry) => entry.patternId === plan.patternId)
      if (
        existing &&
        existing.category === plan.category &&
        existing.contributionIds.length === plan.contributionIds.length &&
        existing.contributionIds.every((id) => plan.contributionIds.includes(id)) &&
        source!.seen.includes(plan.patternId)
      )
        seen.add(plan.patternId)
      if (patterns.has(plan.patternId) || plan.contributionIds.some((id) => records.has(id)))
        continue
      plans.push(plan)
      patterns.add(plan.patternId)
      plan.contributionIds.forEach((id) => records.add(id))
      if (source!.seen.includes(plan.patternId)) seen.add(plan.patternId)
    }
  }
  return { version: 1, plans, seen: [...seen] }
}
