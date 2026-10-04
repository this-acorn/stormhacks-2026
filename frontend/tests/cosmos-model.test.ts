import { expect, it } from 'vitest'
import { ageOf, categoryFor, constellations, starOffset } from '../src/cosmosModel'
import { organizationRegions } from '../src/mapRegions'
import { demoData } from '../src/mockData'

it('uses contribution category snapshots before changing request categories', () => {
  const contribution = { ...demoData.contributions[0], impactCategory: 'conflict' as const }
  expect(categoryFor(contribution, demoData.organizations)).toBe('conflict')
  expect(categoryFor({ ...contribution, impactCategory: undefined, simulated: false }, [])).toBe(
    'unclassified',
  )
})

it('keeps the same organization in separate galaxies when the supported causes differ', () => {
  const base = demoData.contributions[0]
  const entries = [
    { ...base, id: 'one', impactCategory: 'nature' as const },
    { ...base, id: 'two', impactCategory: 'conflict' as const },
    { ...base, id: 'three', impactCategory: 'nature' as const },
  ]
  const groups = constellations(entries, [])
  expect(groups).toHaveLength(2)
  expect(groups.find((group) => group.category === 'nature')?.contributions).toHaveLength(2)
  expect(groups.every((group) => group.organizationId === base.organizationId)).toBe(true)
})

it('keeps star positions independent of amount and of later contributions', () => {
  const record = demoData.contributions[0]
  const before = starOffset(record.id)
  constellations(
    [
      { ...record, quantity: 10000 },
      { ...record, id: 'new' },
    ],
    [],
  )
  expect(starOffset(record.id)).toEqual(before)
  expect(starOffset('new')).not.toEqual(before)
})

it('uses elapsed days for color while keeping invalid and future dates readable', () => {
  const now = Date.parse('2026-10-03T12:00:00Z')
  const atAge = (days: number) =>
    ageOf(
      { ...demoData.contributions[0], createdAt: new Date(now - days * 86400000).toISOString() },
      now,
    )
  expect(atAge(0).label).toBe('Today')
  expect(atAge(7).color).toBe('#75b5ff')
  expect(atAge(8).color).toBe('#fff5e7')
  expect(atAge(31).color).toBe('#ffac61')
  expect(atAge(-1).days).toBe(0)
  expect(ageOf({ ...demoData.contributions[0], createdAt: 'bad' }, now).days).toBeNull()
})

it('groups nearby organizations by their published region and handles the date line', () => {
  const fixtures = demoData.organizations.filter((entry) =>
    ['okanagan', 'coast', 'kenya'].includes(entry.id),
  )
  const bc = organizationRegions(fixtures).find((entry) => entry.name === 'British Columbia')!
  expect(bc.members).toHaveLength(2)
  expect(bc.center[0]).toBeGreaterThan(-124)
  expect(bc.center[0]).toBeLessThan(-119)
  const base = demoData.organizations[0]
  const [region] = organizationRegions([
    { ...base, location: 'East, Region', coordinates: [179, 0] },
    { ...base, id: 'other', location: 'West, Region', coordinates: [-179, 0] },
  ])
  expect(Math.abs(region.center[0])).toBeCloseTo(180)
})
