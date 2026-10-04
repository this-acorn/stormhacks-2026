import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_API_MODE', 'live')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('signs in through the server and sends the cookie credentials policy', async () => {
  const session = {
    id: 'demo-staff',
    role: 'staff',
    organizationId: 'okanagan',
    name: 'Jamie',
    demo: true,
  }
  fetchMock.mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }))
  const { aidApi } = await import('../src/api')
  expect(await aidApi.signInDemo('staff', 'okanagan')).toEqual(session)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/auth/demo',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ role: 'staff', organizationId: 'okanagan' }),
    }),
  )
})

it('uses the agreed paths for search, status, staff review, detections and replay', async () => {
  fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })))
  const { aidApi } = await import('../src/api')
  await aidApi.search('water', 5)
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/v1/search',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ query: 'water', limit: 5 }) }),
  )
  await aidApi.updateContributionStatus('pledge/1', { status: 'user_reported_completed' })
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/v1/contributions/pledge%2F1/status',
    expect.objectContaining({ method: 'PATCH', body: '{"status":"user_reported_completed"}' }),
  )
  await aidApi.organizationContributions('okanagan')
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/v1/organizations/okanagan/contributions',
    expect.anything(),
  )
  await aidApi.detections()
  expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/detections', expect.anything())
  await aidApi.replayObservations()
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/v1/demo/replay-observations',
    expect.objectContaining({ body: '{"dataset":"bc-wildfire-2023-08"}' }),
  )
})

it('preserves backend detail, code and field errors without falling back to sample data', async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        detail: 'Only staff may publish this request.',
        code: 'forbidden',
        fields: { confirmed: 'Confirm this request.' },
      }),
      { status: 403 },
    ),
  )
  const { aidApi } = await import('../src/api')
  await expect(aidApi.bootstrap()).rejects.toMatchObject({
    message: 'Only staff may publish this request.',
    status: 403,
    code: 'forbidden',
    fields: { confirmed: 'Confirm this request.' },
  })
})

it('handles a 204 logout response without attempting to parse JSON', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  const { aidApi } = await import('../src/api')
  await expect(aidApi.logout()).resolves.toBeUndefined()
})

it('fetches current fires even in demo mode and propagates cancellation to the request', async () => {
  vi.stubEnv('VITE_API_MODE', 'demo')
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
  )
  const { fetchLatestFires } = await import('../src/api')
  const controller = new AbortController()
  const pending = fetchLatestFires(controller.signal)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/hazards/wildfire',
    expect.objectContaining({ cache: 'no-store' }),
  )
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
})
