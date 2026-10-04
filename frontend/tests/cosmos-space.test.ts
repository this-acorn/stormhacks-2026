import { expect, it } from 'vitest'
import { constellations, GALAXIES } from '../src/cosmosModel'
import {
  contributionPosition,
  galaxyPosition,
  organizationLinks,
  organizationPosition,
  selectedOrganization,
} from '../src/cosmosSpace'
import { demoData } from '../src/mockData'

it('links even one selected star to its organization without an organization-label click', () => {
  const record = demoData.contributions[2]
  const groups = constellations([record], demoData.organizations)
  const group = selectedOrganization(groups, record.id, null)!
  expect(group.organizationId).toBe(record.organizationId)
  expect(organizationLinks(group)).toEqual([0, 0, 0, ...contributionPosition(record.id)])
  expect(selectedOrganization(groups, null, null)).toBeUndefined()
})

it('keeps organization and contribution positions stable when amounts and records change', () => {
  const record = demoData.contributions[0]
  const profile = organizationPosition(`unclassified:${record.organizationId}`)
  const point = contributionPosition(record.id)
  const group = constellations(
    [
      { ...record, quantity: 99999 },
      { ...record, id: 'new' },
    ],
    [],
  )[0]
  expect(organizationPosition(group.key)).toEqual(profile)
  expect(contributionPosition(record.id)).toEqual(point)
  expect(contributionPosition('new')).not.toEqual(point)
  expect(organizationPosition('different-organization')).not.toEqual(profile)
})

it('centers the surrounding seven regions over Earth while keeping the viewer inside their depth', () => {
  const regions = GALAXIES.filter((entry) => entry.id !== 'unclassified').map((entry) =>
    galaxyPosition(entry.id),
  )
  expect(regions).toHaveLength(7)
  expect(regions.reduce((sum, point) => sum + point[0], 0)).toBeCloseTo(0)
  expect(regions.reduce((sum, point) => sum + point[2], 0)).toBeCloseTo(0)
  expect(regions.every(([x, , z]) => Math.hypot(x, z) > 550 && Math.hypot(x, z) < 850)).toBe(true)
  expect(regions.some(([x]) => x < -550)).toBe(true)
  expect(regions.some(([x]) => x > 550)).toBe(true)
  expect(regions.some(([, , z]) => z < -600)).toBe(true)
  expect(regions.some(([, , z]) => z > 550)).toBe(true)
  expect(regions.every(([, y]) => y < -100 && y > -400)).toBe(true)
})

it('connects every contribution with a sparse tree independent of input order', () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    ...demoData.contributions[2],
    id: `record-${index}`,
  }))
  const group = constellations(records, demoData.organizations)[0]
  const links = organizationLinks(group)
  expect(links).toHaveLength(records.length * 6)
  expect(organizationLinks({ ...group, contributions: [...records].reverse() })).toEqual(links)
  const reached = new Set(['0,0,0'])
  for (let i = 0; i < links.length; i += 6) {
    expect(reached.has(links.slice(i, i + 3).join(','))).toBe(true)
    reached.add(links.slice(i + 3, i + 6).join(','))
  }
  for (const record of records)
    expect(reached.has(contributionPosition(record.id).join(','))).toBe(true)
})
