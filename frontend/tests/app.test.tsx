import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Contribution, Organization } from '../src/types'
import type { SpaceState, SpaceCallbacks } from '../src/spaceRenderer'
import { GALAXIES } from '../src/cosmosModel'
import type { GalaxyId } from '../src/cosmosModel'
import type { StarOrigin } from '../src/cosmosEntry'

const transferDrawing = vi.hoisted(() => ({
  ready: null as (() => void) | null,
  failed: null as (() => void) | null,
}))

// Substitute GPU drawing only; React navigation, selections and the API are real.
vi.mock('../src/spaceRenderer', () => ({
  createSpaceRenderer: (_host: HTMLElement, initial: SpaceState, callbacks: SpaceCallbacks) => {
    let current = initial
    let category: string | null = null
    if (initial.entryStar) {
      category =
        initial.groups.find((group) =>
          group.contributions.some((star) => star.id === initial.entryStar),
        )?.category ?? null
      transferDrawing.ready = () =>
        callbacks.entryReady?.({ key: `star:${initial.entryStar}`, x: 550, y: 325, visible: true })
      transferDrawing.failed = callbacks.failed
    }
    function project() {
      callbacks.project([
        ...GALAXIES.map((entry) => ({ key: `galaxy:${entry.id}`, x: 100, y: 100, visible: true })),
        ...current.groups.flatMap((group) => [
          {
            key: `organization:${group.key}`,
            x: 200,
            y: 200,
            visible: group.category === category,
          },
          ...group.contributions.map((entry) => ({
            key: `star:${entry.id}`,
            x: 250,
            y: 250,
            visible: group.category === category,
          })),
        ]),
      ])
    }
    return {
      update(state: SpaceState) {
        current = state
        project()
      },
      focusGalaxy(id: GalaxyId) {
        category = id
        callbacks.approached(id)
        project()
      },
      focusOrganization(key: string) {
        category = current.groups.find((group) => group.key === key)!.category
        callbacks.approached(category as GalaxyId)
        project()
      },
      focusStar(id: string) {
        category = current.groups.find((group) =>
          group.contributions.some((entry) => entry.id === id),
        )!.category
        callbacks.approached(category as GalaxyId)
        project()
      },
      focusConstellation(id: string) {
        category = current.collection?.find((plan) => plan.patternId === id)?.category ?? null
        callbacks.approached(category as GalaxyId | null)
        project()
      },
      reset() {
        category = null
        project()
      },
      zoom() {},
      rotate() {},
      dispose() {},
    }
  },
}))

// The actual globe requires a GPU/browser. These tests exercise the real React
// screens and API client while substituting only the external map renderer.
vi.mock('../src/components/EarthMap', () => ({
  default: ({
    organizations,
    onSelect,
    contributions,
    onContribution,
  }: {
    organizations: Organization[]
    onSelect: (id: string) => void
    contributions: Contribution[]
    onContribution: (id: string, origin: StarOrigin) => void
  }) => (
    <div aria-label="Map renderer test substitute">
      {organizations.map((organization) => (
        <button key={organization.id} onClick={() => onSelect(organization.id)}>
          Map: {organization.name}
        </button>
      ))}
      {contributions.map((entry) => (
        <button
          key={entry.id}
          onClick={() => onContribution(entry.id, { x: 180, y: 260, color: '#75b5ff' })}
        >
          Orbit star: {entry.id}
        </button>
      ))}
    </div>
  ),
}))

import App from '../src/App'
import { aidApi } from '../src/api'

beforeEach(async () => {
  transferDrawing.ready = null
  transferDrawing.failed = null
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  localStorage.clear()
  await aidApi.resetDemo()
})

it('offers a clear way back from a region and supports Escape', async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' })
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  await user.click(await screen.findByRole('button', { name: 'Explore Wildfire' }))
  expect(screen.queryByLabelText('Explore a region')).toBeNull()
  expect(screen.queryByLabelText('Find an organization')).toBeNull()
  const travel = within(screen.getByRole('group', { name: 'Trackpad navigation' }))
  expect(travel.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Farther',
    'Closer',
  ])
  expect(screen.getByRole('navigation', { name: 'Cosmos location' }).textContent).toBe(
    'Back to universe',
  )
  const galaxies = within(screen.getByRole('navigation', { name: 'Travel between galaxies' }))
  expect(screen.queryByRole('button', { name: 'Explore Wildfire' })).toBeNull()
  expect(screen.queryByText(/hover to enter/i)).toBeNull()
  await user.click(galaxies.getByRole('button', { name: 'Wildfire', exact: true }))
  expect(screen.getByText('Tracing Orion…')).toBeTruthy()
  expect(galaxies.getByRole('button', { name: 'Wildfire' }).getAttribute('aria-current')).toBe(
    'location',
  )
  await user.click(galaxies.getByRole('button', { name: 'War', exact: true }))
  expect(galaxies.getByRole('button', { name: 'War' }).getAttribute('aria-current')).toBe(
    'location',
  )
  expect(galaxies.getByRole('button', { name: 'Wildfire', exact: true })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Back to universe' }))
  expect(screen.queryByRole('navigation', { name: 'Travel between galaxies' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Explore Education' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('navigation', { name: 'Travel between galaxies' })).toBeNull()
})

it('starts the integrated account in the universe and reveals examples only after entering a category', async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' })
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  await screen.findByRole('button', { name: 'Explore Wildfire' })
  expect(screen.getByRole('navigation', { name: 'Cosmos location' }).textContent).toBe(
    'Your universe',
  )
  expect(screen.queryByText('Tracing Orion…')).toBeNull()
  expect(screen.queryByRole('button', { name: /constellation demo/i })).toBeNull()
  expect(screen.getByRole('button', { name: 'Demo account: Alex Morgan' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Explore Wildfire' }))
  await screen.findByText('Tracing Orion…')
  const galaxies = within(screen.getByRole('navigation', { name: 'Travel between galaxies' }))
  expect(galaxies.getAllByRole('button')).toHaveLength(7)
  await user.click(galaxies.getByRole('button', { name: 'Education', exact: true }))
  expect(galaxies.getByRole('button', { name: 'Education' }).getAttribute('aria-current')).toBe(
    'location',
  )
  expect(screen.getByText('Tracing Cassiopeia…')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Collection', exact: true }))
  for (const name of ['Orion', 'Cassiopeia', 'Crux'])
    expect(screen.getByRole('button', { name: `${name}, ready to reveal` })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  await screen.findByRole('button', { name: 'Explore Wildfire' })
  expect(screen.getByRole('navigation', { name: 'Cosmos location' }).textContent).toBe(
    'Your universe',
  )
  expect(screen.queryByRole('navigation', { name: 'Travel between galaxies' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Explore Wildfire' }))
  await user.click(
    screen.getByRole('button', { name: 'View Okanagan Community Relief constellation' }),
  )
  await user.click(screen.getByRole('button', { name: 'Explore', exact: true }))
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  await screen.findByRole('button', { name: 'Explore Wildfire' })
  expect(screen.getByRole('navigation', { name: 'Cosmos location' }).textContent).toBe(
    'Your universe',
  )
  expect(screen.queryByRole('heading', { name: 'Okanagan Community Relief' })).toBeNull()
})

it('opens the same contribution from its Explore star and returns to the universe through navigation', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(
    await screen.findByRole('button', { name: 'Orbit star: constellation-example-orion-3' }),
  )
  await waitFor(() => expect(transferDrawing.ready).not.toBeNull())
  expect(document.getElementById('main-content')?.dataset.starTransfer).toBe('preparing')
  expect(document.querySelector('.explore-view')?.classList.contains('view-hidden')).toBe(false)
  expect(screen.queryByRole('heading', { name: 'Okanagan Community Relief' })).toBeNull()
  act(() => transferDrawing.ready!())
  expect(document.getElementById('main-content')?.dataset.starTransfer).toBe('flying')
  fireEvent.animationEnd(document.querySelector('.star-transfer > i')!, {
    animationName: 'star-transfer-flight',
  })
  await screen.findByRole('heading', { name: 'Okanagan Community Relief' })
  expect(
    document.getElementById('star-constellation-example-orion-3')?.getAttribute('aria-pressed'),
  ).toBe('true')
  expect(screen.queryByRole('button', { name: 'Explore Other contributions' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  await screen.findByRole('button', { name: 'Explore Wildfire' })
  expect(screen.getByRole('navigation', { name: 'Cosmos location' }).textContent).toBe(
    'Your universe',
  )
  expect(screen.queryByRole('heading', { name: 'Okanagan Community Relief' })).toBeNull()
})

it('cancels an in-progress star transfer and ignores a late renderer response', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(
    await screen.findByRole('button', { name: 'Orbit star: constellation-example-orion-3' }),
  )
  await waitFor(() => expect(transferDrawing.ready).not.toBeNull())
  const lateReady = transferDrawing.ready!
  await user.click(screen.getByRole('button', { name: 'Explore', exact: true }))
  act(lateReady)
  expect(document.querySelector('.star-transfer')).toBeNull()
  expect(screen.queryByRole('region', { name: 'My Cosmos' })).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Explore', exact: true }).getAttribute('aria-current'),
  ).toBe('page')
})

it('opens the prepared star without travel animation when reduced motion is requested', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const user = userEvent.setup()
  render(<App />)
  await user.click(
    await screen.findByRole('button', { name: 'Orbit star: constellation-example-orion-3' }),
  )
  await waitFor(() => expect(transferDrawing.ready).not.toBeNull())
  act(() => transferDrawing.ready!())
  expect(document.querySelector('.star-transfer')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Okanagan Community Relief' })).toBeTruthy()
})

it('finishes the transfer with the Cosmos recovery view if graphics initialization fails', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(
    await screen.findByRole('button', { name: 'Orbit star: constellation-example-orion-3' }),
  )
  await waitFor(() => expect(transferDrawing.failed).not.toBeNull())
  act(() => transferDrawing.failed!())
  expect(document.querySelector('.star-transfer')).toBeNull()
  expect(screen.getByRole('button', { name: 'Retry 3D view' })).toBeTruthy()
})

async function openOrganization(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' }))
  await screen.findByRole('heading', { name: 'Okanagan Community Relief' })
}

async function switchAccount(user: ReturnType<typeof userEvent.setup>, account: RegExp) {
  await user.click(screen.getByRole('button', { name: /Demo account:/ }))
  await user.click(screen.getByRole('button', { name: account }))
}

it('turns a supplies pledge into a selectable star and supports reporting completion', async () => {
  const user = userEvent.setup()
  render(<App />)
  await openOrganization(user)
  expect(screen.getByRole('tab', { name: 'Supplies' }).getAttribute('aria-selected')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'Pledge supplies' }))
  const dialog = screen.getByRole('dialog')
  const quantity = within(dialog).getByLabelText('Quantity (kits)')
  await user.clear(quantity)
  await user.type(quantity, '3')
  await user.click(within(dialog).getByRole('button', { name: 'Save demo contribution' }))
  await user.click(await screen.findByRole('button', { name: /View in My Cosmos/ }))
  expect(screen.getByRole('heading', { name: 'Okanagan Community Relief' })).toBeTruthy()
  expect(screen.getByText('Pledged')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Report demo support completed' }))
  expect(await screen.findByText('Completion reported')).toBeTruthy()
  expect(
    screen.getByText(/Your star keeps twinkling until the organization confirms receipt/),
  ).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'List', exact: true }))
  expect(screen.getAllByText('3 kits · Emergency supply kits').length).toBeGreaterThan(0)
})

it('keeps satellite suggestions as drafts until staff explicitly confirm and publish', async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' })
  await switchAccount(user, /Organization staff · Okanagan/)
  await user.click(
    await screen.findByRole('button', { name: 'Open satellite check-in notification' }),
  )
  await user.click(screen.getByRole('button', { name: 'Support needed', exact: true }))
  const dialog = await screen.findByRole('dialog')
  const publish = within(dialog).getByRole('button', {
    name: 'Confirm and publish request',
  }) as HTMLButtonElement
  expect(publish.disabled).toBe(true)
  expect(within(dialog).getByText(/unpublished draft/)).toBeTruthy()
  expect((await aidApi.getOrganization('okanagan')).requests).toHaveLength(1)
  await user.type(
    within(dialog).getByLabelText('Current need'),
    'We have confirmed that families need fifty additional sealed supply kits.',
  )
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(publish)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect((await aidApi.getOrganization('okanagan')).requests).toHaveLength(2)
  expect(screen.getByRole('heading', { name: 'Okanagan Community Relief' })).toBeTruthy()
})

it('lets staff confirm receipt in the same organization panel', async () => {
  await aidApi.contribute({
    organizationId: 'okanagan',
    requestId: 'okanagan-request-1',
    kind: 'supplies',
    quantity: 3,
  })
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' })
  await switchAccount(user, /Organization staff · Okanagan/)
  const review = await screen.findByText('Review contributions')
  await user.click(review)
  const heading = await screen.findByRole('heading', { name: '3 kits · Emergency supply kits' })
  const row = heading.closest('article')!
  await user.click(within(row).getByRole('button', { name: 'Confirm demo receipt' }))
  await within(row).findByText('3 confirmed')
  await waitFor(() => expect(screen.getByText('71')).toBeTruthy())
  await switchAccount(user, /^Supporter$/)
  await screen.findByRole('button', { name: 'Demo account: Alex Morgan' })
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  await user.click(await screen.findByRole('button', { name: 'Explore Wildfire' }))
  await user.click(screen.getByRole('button', { name: /Okanagan Community Relief: 3 kits/ }))
  expect(screen.getByText('Organization confirmed')).toBeTruthy()
})

it('shows seven category layers, supports keyboard search and preserves an error for retry', async () => {
  const initialCount = (await aidApi.bootstrap()).contributions.length
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' })
  await user.click(screen.getByRole('button', { name: 'Layers' }))
  const menu = within(screen.getByRole('group', { name: 'Map layer' }))
  expect(menu.getAllByRole('button')).toHaveLength(7)
  const storm = menu.getByRole('button', { name: /Storm/ })
  expect(menu.getByRole('button', { name: /Intimate Partner Violence/ })).toBeTruthy()
  await user.click(storm)
  expect(
    screen.getByText('Recent tropical cyclones replaying along their recorded tracks'),
  ).toBeTruthy()
  // Choosing the active layer again returns to the plain globe.
  await user.click(screen.getByRole('button', { name: 'Layers' }))
  await user.click(screen.getByRole('button', { name: /Storm/, pressed: true }))
  expect(
    screen.queryByText('Recent tropical cyclones replaying along their recorded tracks'),
  ).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Layers' }))
  await user.keyboard('{Escape}')
  const search = screen.getByRole('combobox')
  await user.type(search, 'Kelowna')
  await user.keyboard('{Enter}')
  await screen.findByRole('heading', { name: 'Okanagan Community Relief' })
  aidApi.simulateNextError()
  await user.click(screen.getByRole('button', { name: 'Pledge supplies' }))
  await user.click(screen.getByRole('button', { name: 'Save demo contribution' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('dialog')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save demo contribution' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect((await aidApi.bootstrap()).contributions).toHaveLength(initialCount + 1)
})

it('provides an empty cosmos and returns focus when a dialog is dismissed', async () => {
  const user = userEvent.setup()
  await aidApi.clearDemoContributions()
  render(<App />)
  await openOrganization(user)
  const pledge = screen.getByRole('button', { name: 'Pledge supplies' })
  await user.click(pledge)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(pledge)
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  expect(await screen.findByRole('heading', { name: 'No contributions yet.' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Explore Earth' })).toBeTruthy()
})

it('opens an organization constellation, selects its support star and pauses motion', async () => {
  await aidApi.contribute({
    organizationId: 'okanagan',
    requestId: 'okanagan-request-1',
    kind: 'supplies',
    quantity: 1,
  })
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' })
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  expect(await screen.findByRole('button', { name: 'Explore War' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Return to starting view' }))
  await user.click(screen.getByRole('button', { name: 'Explore Wildfire' }))
  await user.click(
    screen.getByRole('button', { name: 'View Okanagan Community Relief constellation' }),
  )
  expect(screen.getByRole('heading', { name: 'Okanagan Community Relief' })).toBeTruthy()
  const pause = screen.getByRole('button', { name: 'Pause motion' })
  await user.click(pause)
  expect(screen.getByRole('button', { name: 'Resume motion' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  const star = screen.getByRole('button', { name: /Okanagan Community Relief: 1 kits/ })
  await user.click(star)
  expect(within(star).getByText('Today')).toBeTruthy()
})

it('approaches a category after a mouse dwell and cancels when the pointer leaves', async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Map: Okanagan Community Relief' })
  await user.click(screen.getByRole('button', { name: 'My Cosmos', exact: true }))
  const galaxy = await screen.findByRole('button', { name: 'Explore Wildfire' })
  function pointer(type: string, target = galaxy) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    fireEvent(target, event)
  }
  vi.useFakeTimers()
  try {
    pointer('pointerover')
    act(() => vi.advanceTimersByTime(799))
    expect(screen.queryByRole('navigation', { name: 'Travel between galaxies' })).toBeNull()
    pointer('pointerout')
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('navigation', { name: 'Travel between galaxies' })).toBeNull()
    pointer('pointerover')
    act(() => vi.advanceTimersByTime(801))
    expect(
      within(screen.getByRole('navigation', { name: 'Travel between galaxies' }))
        .getByRole('button', { name: 'Wildfire' })
        .getAttribute('aria-current'),
    ).toBe('location')
    pointer('pointerover', screen.getByRole('button', { name: 'Explore Education' }))
    act(() => vi.advanceTimersByTime(801))
    const links = within(screen.getByRole('navigation', { name: 'Travel between galaxies' }))
    expect(links.getByRole('button', { name: 'Education' }).getAttribute('aria-current')).toBe(
      'location',
    )
    pointer('pointerover', links.getByRole('button', { name: 'Flood' }))
    expect(links.getByRole('button', { name: 'Flood' }).className).toContain('is-approaching')
    act(() => vi.advanceTimersByTime(801))
    expect(links.getByRole('button', { name: 'Flood' }).getAttribute('aria-current')).toBe(
      'location',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Return to starting view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause motion' }))
    pointer('pointerover')
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('navigation', { name: 'Travel between galaxies' })).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})
