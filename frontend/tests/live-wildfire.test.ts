import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LayerContext } from '../src/layers/types'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), draw: vi.fn() }))
vi.mock('../src/api', () => ({ fetchLatestFires: mocks.fetch }))
vi.mock('../src/layers/wildfire', () => ({ wildfireLayer: mocks.draw }))
vi.mock('../src/layers/smoke', () => ({
  smokeLayer: () => ({ setTime: vi.fn(), retry: vi.fn(), destroy: vi.fn() }),
}))
import { FIRE_REFRESH_MS, liveWildfireLayer } from '../src/layers/liveWildfire'

const summary = { source: 'NASA FIRMS', updated: 'Last observed Oct 4, 09:41 UTC' }
const context = { onSummary: vi.fn() } as unknown as LayerContext

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => vi.useRealTimers())

it('fetches current observations on entry and every ten minutes, then stops on exit', async () => {
  const first = { playback: false },
    next = { playback: false, builtAt: 'later' }
  mocks.fetch.mockResolvedValueOnce(first).mockResolvedValueOnce(next)
  const old = { summary, destroy: vi.fn() },
    updated = { summary, destroy: vi.fn() }
  mocks.draw.mockReturnValueOnce(old).mockReturnValueOnce(updated)
  const layer = await liveWildfireLayer(context)
  expect(mocks.draw).toHaveBeenCalledWith(context, [first])
  await vi.advanceTimersByTimeAsync(FIRE_REFRESH_MS)
  expect(old.destroy).toHaveBeenCalledOnce()
  expect(mocks.draw).toHaveBeenLastCalledWith(context, [next])
  expect(context.onSummary).toHaveBeenLastCalledWith(summary)
  layer.destroy()
  expect(updated.destroy).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  expect(mocks.fetch.mock.calls[1][0].aborted).toBe(true)
})

it('does not attach a response that arrives after a layer switch', async () => {
  let resolve!: (value: object) => void
  mocks.fetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  const controller = new AbortController()
  const pending = liveWildfireLayer({ ...context, signal: controller.signal })
  controller.abort()
  resolve({})
  await expect(pending).rejects.toThrow()
  expect(mocks.draw).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('labels refresh failure while retaining the last observation time and retries', async () => {
  mocks.fetch
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({})
  const active = { summary, destroy: vi.fn() }
  mocks.draw.mockReturnValue(active)
  const layer = await liveWildfireLayer(context)
  await vi.advanceTimersByTimeAsync(FIRE_REFRESH_MS)
  expect(active.destroy).not.toHaveBeenCalled()
  expect(context.onSummary).toHaveBeenLastCalledWith({
    ...summary,
    updated: `Refresh unavailable · ${summary.updated}`,
  })
  await vi.advanceTimersByTimeAsync(FIRE_REFRESH_MS)
  expect(context.onSummary).toHaveBeenLastCalledWith(summary)
  layer.destroy()
})

it('does not resurrect the layer when a periodic response arrives after exit', async () => {
  let resolve!: (value: object) => void
  mocks.fetch.mockResolvedValueOnce({}).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  mocks.draw.mockReturnValue({ summary, destroy: vi.fn() })
  const layer = await liveWildfireLayer(context)
  await vi.advanceTimersByTimeAsync(FIRE_REFRESH_MS)
  layer.destroy()
  resolve({})
  await Promise.resolve()
  await Promise.resolve()
  expect(mocks.draw).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps forecast controls available during a NASA outage and retries observations', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('NASA offline')).mockResolvedValueOnce({})
  mocks.draw.mockReturnValue({ summary, destroy: vi.fn() })
  const layer = await liveWildfireLayer(context)
  expect(layer.summary.source).toContain('unavailable')
  expect(layer.setForecastTime).toBeTypeOf('function')
  expect(mocks.draw).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(FIRE_REFRESH_MS)
  expect(layer.summary).toEqual(summary)
  layer.destroy()
  expect(vi.getTimerCount()).toBe(0)
})
