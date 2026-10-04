import { beforeEach, expect, it } from 'vitest'
import {
  emptyCollection,
  isComplete,
  patternFor,
  readCollection,
  reconcileCollection,
  saveCollection,
  STAR_PATTERNS,
} from '../src/constellationCollection'
import { demoData } from '../src/mockData'
import { IMPACT_CATEGORIES } from '../src/impactCategories'
import { GALAXIES, categoryFor } from '../src/cosmosModel'
import { LAYERS } from '../src/mapConfig'
import type { Contribution } from '../src/types'

beforeEach(() => localStorage.clear())
function records(count: number): Contribution[] {
  return Array.from({ length: count }, (_, i) => ({
    ...demoData.contributions[2],
    id: `support-${i}`,
    impactCategory: 'wildfire',
    organizationId: i % 2 ? 'kenya' : 'okanagan',
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  }))
}

it('shares exactly seven primary categories and preserves legacy records without guessing', () => {
  expect(LAYERS.map((layer) => layer.name)).toEqual([
    'Wildfire',
    'Flood',
    'Storm',
    'Nature',
    'War',
    'Education',
    'Intimate Partner Violence',
  ])
  expect(
    GALAXIES.filter((galaxy) => galaxy.id !== 'unclassified').map((galaxy) => galaxy.id),
  ).toEqual(IMPACT_CATEGORIES.map((category) => category.id))
  expect(
    categoryFor({ ...records(1)[0], impactCategory: 'community' }, demoData.organizations),
  ).toBe('unclassified')
})

it('pools contributions across organizations in a category and counts records, not quantities', () => {
  const first = reconcileCollection('alex', records(2), [], emptyCollection())
  expect(first.plans).toHaveLength(1)
  expect(isComplete(first.plans[0])).toBe(false)
  const next = reconcileCollection(
    'alex',
    records(3).map((entry) => ({ ...entry, quantity: 100000 })),
    [],
    first,
  )
  expect(next.plans[0].patternId).toBe(first.plans[0].patternId)
  expect(isComplete(next.plans[0])).toBe(true)
  expect(next.seen).toEqual([])
  expect(next.plans[0].contributionIds).toHaveLength(3)
})

it('never duplicates a record or pattern and preserves allocations on refresh and backdated imports', () => {
  const first = reconcileCollection('alex', records(20), [], emptyCollection())
  const next = reconcileCollection(
    'alex',
    [
      ...records(20).reverse(),
      records(1)[0],
      { ...records(1)[0], id: 'late-import', createdAt: '2020-01-01T00:00:00Z' },
    ],
    [],
    first,
  )
  for (const plan of first.plans.filter(isComplete))
    expect(next.plans.find((entry) => entry.patternId === plan.patternId)).toEqual(plan)
  const ids = next.plans.flatMap((plan) => plan.contributionIds)
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(next.plans.map((plan) => plan.patternId)).size).toBe(next.plans.length)
  for (const plan of next.plans)
    expect(plan.contributionIds.length).toBeLessThanOrEqual(
      patternFor(plan.patternId).points.length,
    )
})

it('keeps discovery and assignment storage separate for each account', () => {
  const first = reconcileCollection('alex', records(3), [], emptyCollection())
  first.seen.push(first.plans[0].patternId)
  expect(saveCollection('alex', first)).toBe(true)
  expect(readCollection('alex')).toEqual(first)
  expect(readCollection('sam')).toEqual(emptyCollection())
  const assignments = new Set(
    Array.from(
      { length: 20 },
      (_, index) =>
        reconcileCollection(`account-${index}`, records(3), [], emptyCollection()).plans[0]
          .patternId,
    ),
  )
  expect(assignments.size).toBeGreaterThan(1)
})

it('keeps categories separate, handles deleted records and tolerates unavailable or damaged storage', () => {
  const mixed = records(6).map((entry, i) => ({
    ...entry,
    impactCategory: i % 2 ? ('flood' as const) : ('wildfire' as const),
  }))
  const first = reconcileCollection('alex', mixed, [], emptyCollection())
  expect(first.plans).toHaveLength(2)
  expect(first.plans.every(isComplete)).toBe(true)
  const empty = reconcileCollection('alex', [], [], {
    ...first,
    seen: first.plans.map((plan) => plan.patternId),
  })
  expect(empty).toEqual(emptyCollection())
  localStorage.setItem('aidatlas-constellations-v1:alex', '{broken')
  expect(readCollection('alex')).toEqual(emptyCollection())
})

it('defines valid drawable patterns and keeps every allocated star meaningful', () => {
  for (const pattern of STAR_PATTERNS) {
    const used = new Set(pattern.edges.flat())
    expect(used.size).toBe(pattern.points.length)
    expect([...used].every((index) => index >= 0 && index < pattern.points.length)).toBe(true)
  }
})
