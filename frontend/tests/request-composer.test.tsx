import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrganizationPanel from '../src/components/OrganizationPanel'
import RequestComposer from '../src/components/RequestComposer'
import RequestForm from '../src/components/RequestForm'
import { aidApi } from '../src/api'
import { demoData } from '../src/mockData'
import type { RequestDraft } from '../src/types'

// Gemini runs on the API server, so only its draft endpoint is substituted; publishing uses the demo API.
const fetchMock = vi.fn()
const okanagan = demoData.organizations.find((entry) => entry.id === 'okanagan')!

function draft(fields: Partial<RequestDraft>): RequestDraft {
  return {
    title: null,
    item: null,
    quantity: null,
    unit: null,
    urgency: 'standard',
    description: null,
    otherNeeds: [],
    missing: [],
    ...fields,
  }
}
const answer = (body: RequestDraft) => new Response(JSON.stringify(body), { status: 200 })

async function compose(text: string) {
  const callbacks = { onPublished: vi.fn(), onIncomplete: vi.fn(), onManual: vi.fn() }
  const user = userEvent.setup()
  render(<RequestComposer organization={okanagan} {...callbacks} />)
  await user.type(screen.getByLabelText('Describe what you need'), text)
  await user.click(screen.getByRole('button', { name: /Write and publish with Gemini/ }))
  return { user, ...callbacks }
}

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  await aidApi.resetDemo()
  await aidApi.signInDemo('staff', 'okanagan')
})

it('publishes a complete request that Gemini writes from the staff words', async () => {
  fetchMock.mockResolvedValue(
    answer(
      draft({
        title: 'N95 masks for wildfire smoke',
        item: 'N95 masks',
        quantity: 200,
        unit: 'masks',
        urgency: 'urgent',
        description: 'Wildfire smoke is close. We urgently need 200 N95 masks.',
        otherNeeds: ['water'],
      }),
    ),
  )
  const { onPublished, onIncomplete } = await compose(
    'Smoke is close, need 200 N95 masks urgently, water too',
  )

  await waitFor(() => expect(onPublished).toHaveBeenCalled())
  expect(onPublished.mock.calls[0][0]).toMatchObject({
    title: 'N95 masks for wildfire smoke',
    item: 'N95 masks',
    quantity: 200,
    unit: 'masks',
    urgency: 'urgent',
    status: 'published',
  })
  expect(onPublished.mock.calls[0][1]).toEqual(['water'])
  expect(onIncomplete).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/organizations/okanagan/requests/draft',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'Smoke is close, need 200 N95 masks urgently, water too' }),
    }),
  )
})

it('opens the form instead of publishing when a detail is missing', async () => {
  const incomplete = draft({
    title: 'Volunteers needed',
    item: 'Volunteers',
    unit: 'people',
    description: 'We need volunteers.',
    missing: ['quantity'],
  })
  fetchMock.mockResolvedValue(answer(incomplete))
  const { onPublished, onIncomplete } = await compose('need volunteers')

  await waitFor(() => expect(onIncomplete).toHaveBeenCalledWith(incomplete))
  expect(onPublished).not.toHaveBeenCalled()
})

it('offers the form when Gemini is unavailable', async () => {
  const detail = 'AI drafting is unavailable right now. Please fill in the form instead.'
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ detail, code: 'service_unavailable' }), { status: 503 }),
  )
  const { user, onManual, onPublished } = await compose('need volunteers')

  expect((await screen.findByRole('status')).textContent).toContain(detail)
  await user.click(screen.getByRole('button', { name: 'Fill in the form yourself' }))
  expect(onManual).toHaveBeenCalled()
  expect(onPublished).not.toHaveBeenCalled()
})

it('fills the form with the Gemini draft and highlights only what is still missing', async () => {
  const onSave = vi.fn()
  const user = userEvent.setup()
  render(
    <RequestForm
      organization={okanagan}
      draft={draft({
        title: 'Volunteers needed',
        item: 'Volunteers',
        unit: 'people',
        description: 'We need volunteers.',
        otherNeeds: ['blankets'],
        missing: ['quantity'],
      })}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  )

  expect(screen.getByText(/Add the total quantity below/)).toBeTruthy()
  const quantity = screen.getByLabelText('Total quantity')
  expect(quantity.getAttribute('aria-invalid')).toBe('true')
  expect((screen.getByLabelText('Needed item') as HTMLInputElement).value).toBe('Volunteers')
  expect(screen.getByLabelText('Needed item').getAttribute('aria-invalid')).toBeNull()

  await user.type(quantity, '10')
  expect(quantity.getAttribute('aria-invalid')).toBeNull()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /Confirm and publish request/ }))
  await waitFor(() => expect(onSave).toHaveBeenCalled())
  expect(onSave.mock.calls[0][0]).toMatchObject({
    item: 'Volunteers',
    quantity: 10,
    unit: 'people',
  })
  expect(onSave.mock.calls[0][1]).toEqual(['blankets'])
})

it('shows organization staff the Gemini box instead of ways to contribute', async () => {
  const data = await aidApi.bootstrap()
  const props = {
    organization: data.organizations.find((entry) => entry.id === 'okanagan')!,
    observations: [],
    onClose: vi.fn(),
    onObservation: vi.fn(),
    onCheckIn: vi.fn(),
    onRequest: vi.fn(),
    onRequestDraft: vi.fn(),
    onRequestPublished: vi.fn(),
    onContribute: vi.fn(),
    onRefresh: vi.fn(async () => {}),
  }
  const staffView = render(<OrganizationPanel session={data.session} {...props} />)
  expect(screen.getByLabelText('Describe what you need')).toBeTruthy()
  expect(screen.queryByRole('tablist', { name: 'Contribution type' })).toBeNull()
  staffView.unmount()

  await aidApi.signInDemo('supporter')
  render(<OrganizationPanel session={(await aidApi.bootstrap()).session} {...props} />)
  expect(screen.queryByLabelText('Describe what you need')).toBeNull()
  expect(screen.getByRole('tablist', { name: 'Contribution type' })).toBeTruthy()
})

it('lets staff answer the nearby satellite check-in on the organization card', async () => {
  const data = await aidApi.bootstrap()
  const observation = data.observations.find((entry) => entry.organizationId === 'okanagan')!
  const props = {
    organization: data.organizations.find((entry) => entry.id === 'okanagan')!,
    observations: [observation],
    onClose: vi.fn(),
    onObservation: vi.fn(),
    onCheckIn: vi.fn(),
    onRequest: vi.fn(),
    onRequestDraft: vi.fn(),
    onRequestPublished: vi.fn(),
    onContribute: vi.fn(),
    onRefresh: vi.fn(async () => {}),
  }
  const staffView = render(<OrganizationPanel session={data.session} {...props} />)
  expect(screen.getByRole('heading', { name: 'Satellite nearby' })).toBeTruthy()
  expect(screen.getByText(observation.question!)).toBeTruthy()
  expect(screen.getByText(/781 heat detections · nearest 3.4 km/)).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Not affected' }))
  await waitFor(() =>
    expect(props.onCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: observation.id, response: 'not_affected' }),
    ),
  )
  // Once answered, the check-in no longer shows on the staff's card.
  staffView.rerender(
    <OrganizationPanel
      session={data.session}
      {...props}
      observations={[props.onCheckIn.mock.calls[0][0]]}
    />,
  )
  expect(screen.queryByRole('heading', { name: 'Satellite nearby' })).toBeNull()
  staffView.unmount()

  await aidApi.signInDemo('supporter')
  render(<OrganizationPanel session={(await aidApi.bootstrap()).session} {...props} />)
  expect(screen.queryByText(observation.question!)).toBeNull()
  expect(screen.getByText(observation.summary)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Not affected' })).toBeNull()
  expect(screen.getByRole('button', { name: 'View check-in' })).toBeTruthy()
})

it('focuses the request box after Support needed and links the request to the check-in', async () => {
  fetchMock.mockResolvedValue(
    answer(
      draft({
        title: 'N95 masks for wildfire smoke',
        item: 'N95 masks',
        quantity: 200,
        unit: 'masks',
        urgency: 'urgent',
        description: 'Wildfire smoke is close. We urgently need 200 N95 masks.',
      }),
    ),
  )
  const onPublished = vi.fn()
  const user = userEvent.setup()
  render(
    <RequestComposer
      organization={okanagan}
      observationId="observation-okanagan-bc-2023"
      onPublished={onPublished}
      onIncomplete={vi.fn()}
      onManual={vi.fn()}
    />,
  )
  const box = screen.getByLabelText('Describe what you need')
  expect(document.activeElement).toBe(box)
  await user.type(box, 'Wildfire smoke is close. We urgently need 200 N95 masks.')
  await user.click(screen.getByRole('button', { name: /Write and publish with Gemini/ }))
  await waitFor(() => expect(onPublished).toHaveBeenCalled())
  expect(onPublished.mock.calls[0][0].observationId).toBe('observation-okanagan-bc-2023')
})
