import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LayerContext } from '../src/layers/types'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn(), draw: vi.fn() }))
vi.mock('../src/api', () => ({ fetchLatestEducation: mocks.fetch }))
vi.mock('../src/layers/data', () => ({ loadData: mocks.load }))
vi.mock('../src/layers/education', () => ({ educationLayer: mocks.draw }))
import { EDUCATION_POLL_MS, liveEducationLayer } from '../src/layers/liveEducation'

const first = {
  countries: [{ id: 'KOR' }],
  checkedAt: '2026-10-04T12:00:00Z',
  release: 'February 2026',
}
const geometry = { type: 'FeatureCollection', features: [] }
const context = {} as LayerContext
let active: {
  summary: object
  updateEducationData: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  active = { summary: {}, updateEducationData: vi.fn(), destroy: vi.fn() }
  mocks.draw.mockReturnValue(active)
  mocks.load.mockImplementation((name) => Promise.resolve(name === 'education' ? first : geometry))
})
afterEach(() => vi.useRealTimers())

it('loads the API, applies new releases in place and stops polling on exit', async () => {
  const next = { ...first, release: 'September 2026' }
  mocks.fetch.mockResolvedValueOnce(first).mockResolvedValueOnce(next)
  const layer = await liveEducationLayer(context)
  expect(mocks.draw).toHaveBeenCalledWith(context, first, geometry)
  await vi.advanceTimersByTimeAsync(EDUCATION_POLL_MS)
  expect(active.updateEducationData).toHaveBeenLastCalledWith(next)
  expect(mocks.draw).toHaveBeenCalledOnce()
  layer.destroy()
  expect(active.destroy).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  expect(mocks.fetch.mock.calls[1][0].aborted).toBe(true)
})

it('labels a bundled fallback as offline and recovers automatically', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(first)
  const layer = await liveEducationLayer(context)
  expect(mocks.draw.mock.calls[0][1]).toMatchObject({
    ...first,
    updates: { state: 'offline', automatic: false, checkedAt: first.checkedAt },
  })
  await vi.advanceTimersByTimeAsync(EDUCATION_POLL_MS)
  expect(active.updateEducationData).toHaveBeenLastCalledWith(first)
  layer.destroy()
})

it('retains the latest successful data and check time on refresh failure', async () => {
  mocks.fetch.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('offline'))
  const layer = await liveEducationLayer(context)
  await vi.advanceTimersByTimeAsync(EDUCATION_POLL_MS)
  expect(active.updateEducationData).toHaveBeenLastCalledWith({
    ...first,
    updates: { state: 'offline', automatic: false, checkedAt: first.checkedAt },
  })
  expect(active.destroy).not.toHaveBeenCalled()
  layer.destroy()
})

it('does not apply a response received after leaving Education', async () => {
  let resolve!: (data: object) => void
  mocks.fetch.mockResolvedValueOnce(first).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  const layer = await liveEducationLayer(context)
  await vi.advanceTimersByTimeAsync(EDUCATION_POLL_MS)
  layer.destroy()
  resolve({ ...first, release: 'September 2026' })
  await Promise.resolve()
  expect(active.updateEducationData).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
