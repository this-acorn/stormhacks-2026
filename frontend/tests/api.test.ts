import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aidApi } from '../src/api'
import { safeSupportLink } from '../src/support'
import type { RequestInput } from '../src/types'
import { readCollection, isComplete, saveCollection } from '../src/constellationCollection'
import {
  DEMO_SUPPORTER_ACCOUNT,
  LEGACY_CONSTELLATION_ACCOUNT,
  createConstellationDemo,
} from '../src/constellationDemo'
import { demoData } from '../src/mockData'

const draft: RequestInput = {
  title: 'Water for local families',
  item: 'Water cases',
  quantity: 30,
  unit: 'cases',
  description: 'Staff confirmed that 30 sealed cases are needed at the community hall.',
  urgency: 'urgent',
  observationId: 'observation-okanagan-1',
  confirmed: true,
}
beforeEach(async () => {
  await aidApi.resetDemo()
})

it('includes constellation examples in the default supporter account without replacing records or requests', async () => {
  const example = await aidApi.bootstrap()
  expect(example.session.id).toBe(DEMO_SUPPORTER_ACCOUNT)
  expect(example.contributions).toHaveLength(19)
  expect(
    example.contributions.filter((entry) => entry.status === 'organization_confirmed'),
  ).toHaveLength(17)
  expect(example.contributions.filter((entry) => entry.id.startsWith('sample-'))).toEqual(
    demoData.contributions,
  )
  expect(example.contributions.every((entry) => entry.simulated)).toBe(true)
  expect(example.organizations).toEqual(demoData.organizations)
  const collection = readCollection(example.session.id)
  expect(collection.plans.map((plan) => plan.patternId)).toEqual(['orion', 'cassiopeia', 'crux'])
  expect(collection.plans.every(isComplete)).toBe(true)
  saveCollection(example.session.id, { ...collection, seen: ['orion'] })
  await aidApi.signInDemo('staff', 'coast')
  await aidApi.signInDemo('supporter')
  expect((await aidApi.bootstrap()).contributions).toEqual(example.contributions)
  expect(readCollection(example.session.id).seen).toContain('orion')
})

it('restarts constellation progress on a demo reset so a constellation can connect again', async () => {
  const { session } = await aidApi.bootstrap()
  saveCollection(session.id, { ...readCollection(session.id), seen: ['orion'] })
  sessionStorage.setItem('aidatlas-cosmos-statuses', '{"earlier":"organization_confirmed"}')
  await aidApi.resetDemo()
  const collection = readCollection(session.id)
  expect(collection.seen).toEqual([])
  expect(collection.plans.map((plan) => plan.patternId)).toEqual(['orion', 'cassiopeia', 'crux'])
  expect(sessionStorage.getItem('aidatlas-cosmos-statuses')).toBeNull()
})

it('updates saved demo fixture confirmations once without changing user pledges or discoveries', async () => {
  const examples = createConstellationDemo(demoData.organizations)
  const oldExamples = examples.contributions.map((entry) => ({
    ...entry,
    status: 'pledged' as const,
    confirmedQuantity: undefined,
    confirmedAt: undefined,
  }))
  const userPledge = { ...demoData.contributions[2], id: 'user-created-pledge', quantity: 4 }
  const contributions = [...demoData.contributions, ...oldExamples, userPledge]
  localStorage.setItem(
    'aidatlas-demo-v1',
    JSON.stringify({
      ...demoData,
      contributions,
      contributionOwners: Object.fromEntries(
        contributions.map((entry) => [entry.id, DEMO_SUPPORTER_ACCOUNT]),
      ),
      constellationExamplesIntegrated: true,
    }),
  )
  const collection = { ...examples.collection, seen: ['orion'] }
  saveCollection(DEMO_SUPPORTER_ACCOUNT, collection)
  vi.resetModules()
  const migratedApi = (await import('../src/api')).aidApi
  const migrated = await migratedApi.bootstrap()
  expect(migrated.contributions).toHaveLength(contributions.length)
  expect(
    migrated.contributions.filter((entry) => entry.status === 'organization_confirmed'),
  ).toHaveLength(17)
  expect(migrated.contributions.find((entry) => entry.id === userPledge.id)).toEqual(userPledge)
  expect(migrated.organizations).toEqual(demoData.organizations)
  expect(readCollection(DEMO_SUPPORTER_ACCOUNT)).toEqual(collection)
  vi.resetModules()
  const reloadedApi = (await import('../src/api')).aidApi
  expect((await reloadedApi.bootstrap()).contributions).toEqual(migrated.contributions)
})

it('merges a saved separate demo account once and preserves contributions and discoveries', async () => {
  const examples = createConstellationDemo(demoData.organizations)
  const extra = { ...examples.contributions[0], id: 'legacy-extra-support', quantity: 2 }
  const contributions = [...demoData.contributions, ...examples.contributions, extra]
  localStorage.setItem(
    'aidatlas-demo-v1',
    JSON.stringify({
      ...demoData,
      session: { ...demoData.session, id: LEGACY_CONSTELLATION_ACCOUNT },
      contributions,
      contributionOwners: Object.fromEntries(
        contributions.map((entry) => [
          entry.id,
          entry.id.startsWith('sample-') ? DEMO_SUPPORTER_ACCOUNT : LEGACY_CONSTELLATION_ACCOUNT,
        ]),
      ),
    }),
  )
  saveCollection(LEGACY_CONSTELLATION_ACCOUNT, { ...examples.collection, seen: ['cassiopeia'] })
  vi.resetModules()
  const migratedApi = (await import('../src/api')).aidApi
  const migrated = await migratedApi.bootstrap()
  expect(migrated.session.id).toBe(DEMO_SUPPORTER_ACCOUNT)
  expect(migrated.contributions).toEqual(contributions)
  expect(readCollection(DEMO_SUPPORTER_ACCOUNT).seen).toContain('cassiopeia')
  await migratedApi.clearDemoContributions()
  vi.resetModules()
  const reloadedApi = (await import('../src/api')).aidApi
  expect((await reloadedApi.bootstrap()).contributions).toEqual([])
})

describe('confirmed needs and private drafts', () => {
  it('keeps private suggestions out of supporter data and returns them to authorized staff', async () => {
    const supporter = await aidApi.bootstrap()
    expect(supporter.observations[0].suggestedItems).toEqual([])
    expect(supporter.observations[0]).not.toHaveProperty('question')
    await aidApi.signInDemo('staff', 'okanagan')
    const staff = await aidApi.bootstrap()
    expect(staff.observations[0].suggestedItems).toHaveLength(1)
    expect(staff.observations[0].question).toContain('Are you affected?')
  })

  it('does not publish a request when staff respond support_needed', async () => {
    await aidApi.signInDemo('staff', 'okanagan')
    const before = await aidApi.getOrganization('okanagan')
    const response = await aidApi.checkIn('observation-okanagan-1', 'support_needed')
    expect(response.respondedAt).toBeTruthy()
    expect((await aidApi.getOrganization('okanagan')).requests).toHaveLength(before.requests.length)
    await expect(
      aidApi.publishRequest('okanagan', { ...draft, confirmed: false }),
    ).rejects.toMatchObject({ status: 422 })
    const published = await aidApi.publishRequest('okanagan', draft)
    expect(published).toMatchObject({
      item: 'Water cases',
      quantity: 30,
      fulfilled: 0,
      status: 'published',
      observationId: draft.observationId,
    })
    expect(published.createdAt).toBeTruthy()
    await aidApi.signInDemo('supporter')
    const publicData = await aidApi.bootstrap()
    expect(
      publicData.organizations.find((entry) => entry.id === 'okanagan')!.requests,
    ).toHaveLength(before.requests.length + 1)
    expect(publicData.observations[0]).not.toHaveProperty('response')
  })

  it('rejects updates by a supporter or staff of another organization', async () => {
    await expect(aidApi.publishRequest('okanagan', draft)).rejects.toMatchObject({ status: 403 })
    await aidApi.signInDemo('staff', 'coast')
    await expect(aidApi.checkIn('observation-okanagan-1', 'checking')).rejects.toMatchObject({
      status: 403,
    })
    await expect(aidApi.publishRequest('okanagan', draft)).rejects.toMatchObject({ status: 403 })
    await expect(aidApi.organizationContributions('okanagan')).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('contribution lifecycle', () => {
  it('keeps a contribution in its original galaxy after staff recategorize the request', async () => {
    await aidApi.signInDemo('staff', 'okanagan')
    const request = await aidApi.publishRequest('okanagan', {
      ...draft,
      impactCategory: 'conflict',
    })
    await aidApi.signInDemo('supporter')
    const contribution = await aidApi.contribute({
      organizationId: 'okanagan',
      requestId: request.id,
      kind: 'supplies',
      quantity: 1,
    })
    expect(contribution.impactCategory).toBe('conflict')
    await aidApi.signInDemo('staff', 'okanagan')
    await aidApi.publishRequest('okanagan', { ...draft, impactCategory: 'nature' }, request.id)
    await aidApi.signInDemo('supporter')
    expect(
      (await aidApi.bootstrap()).contributions.find((entry) => entry.id === contribution.id)
        ?.impactCategory,
    ).toBe('conflict')
  })
  it('counts only organization confirmation and never counts the same receipt twice', async () => {
    const before = (await aidApi.getOrganization('okanagan')).requests[0].fulfilled
    const contribution = await aidApi.contribute({
      organizationId: 'okanagan',
      requestId: 'okanagan-request-1',
      kind: 'supplies',
      quantity: 4,
    })
    expect(contribution.status).toBe('pledged')
    expect((await aidApi.getOrganization('okanagan')).requests[0].fulfilled).toBe(before)
    await aidApi.updateContributionStatus(contribution.id, { status: 'user_reported_completed' })
    expect((await aidApi.getOrganization('okanagan')).requests[0].fulfilled).toBe(before)
    await expect(
      aidApi.updateContributionStatus(contribution.id, { status: 'organization_confirmed' }),
    ).rejects.toMatchObject({ status: 403 })
    await aidApi.signInDemo('staff', 'okanagan')
    expect((await aidApi.bootstrap()).contributions).toHaveLength(0)
    const confirmed = await aidApi.updateContributionStatus(contribution.id, {
      status: 'organization_confirmed',
      confirmedQuantity: 3,
    })
    expect(confirmed).toMatchObject({ status: 'organization_confirmed', confirmedQuantity: 3 })
    await aidApi.updateContributionStatus(contribution.id, {
      status: 'organization_confirmed',
      confirmedQuantity: 3,
    })
    expect((await aidApi.getOrganization('okanagan')).requests[0].fulfilled).toBe(before + 3)
    await aidApi.signInDemo('supporter')
    expect(
      (await aidApi.bootstrap()).contributions.find((entry) => entry.id === contribution.id)
        ?.status,
    ).toBe('organization_confirmed')
  })

  it('rejects excessive pledges and invalid quantities', async () => {
    await expect(
      aidApi.contribute({
        organizationId: 'okanagan',
        requestId: 'okanagan-request-1',
        kind: 'supplies',
        quantity: 75,
      }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      aidApi.contribute({ organizationId: 'coast', kind: 'donate', quantity: 0 }),
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      aidApi.contribute({ organizationId: 'coast', kind: 'donate', quantity: 1.5 }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('supports retry after a failure without a phantom contribution', async () => {
    const before = (await aidApi.bootstrap()).contributions.length
    aidApi.simulateNextError()
    await expect(
      aidApi.contribute({ organizationId: 'coast', kind: 'donate', quantity: 25 }),
    ).rejects.toMatchObject({ status: 503 })
    expect((await aidApi.bootstrap()).contributions).toHaveLength(before)
    await aidApi.contribute({ organizationId: 'coast', kind: 'donate', quantity: 25 })
    expect((await aidApi.bootstrap()).contributions).toHaveLength(before + 1)
  })

  it('restores contributions after the client module is reloaded', async () => {
    const contribution = await aidApi.contribute({
      organizationId: 'coast',
      kind: 'donate',
      quantity: 10,
    })
    vi.resetModules()
    const restored = await import('../src/api')
    expect(
      (await restored.aidApi.bootstrap()).contributions.some(
        (entry) => entry.id === contribution.id,
      ),
    ).toBe(true)
  })
})

it('only exposes safe external support URLs', () => {
  expect(safeSupportLink('https://example.org/help')).toBe('https://example.org/help')
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:pass@example.org',
    'not a url',
  ])
    expect(safeSupportLink(value)).toBeUndefined()
})
