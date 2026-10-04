import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LayerContext } from '../src/layers/types'
import { SMOKE_LAYER, type SmokeForecast } from '../src/smokeForecast'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), addProtocol: vi.fn(), removeProtocol: vi.fn() }))
vi.mock('../src/api', () => ({ fetchSmokeForecast: mocks.fetch }))
vi.mock('maplibre-gl', () => ({
  addProtocol: mocks.addProtocol,
  removeProtocol: mocks.removeProtocol,
}))
import { smokeLayer } from '../src/layers/smoke'

const forecast: SmokeForecast = {
  source: 'ECCC',
  layer: SMOKE_LAYER,
  modelRun: '2026-10-04T00:00:00Z',
  times: ['2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z', '2026-10-04T14:00:00Z'],
  bounds: [-176, 16, -18, 80],
  resolutionKm: 10,
  coverage: 'North America',
  units: 'µg/m³',
}

function harness() {
  const sources = new Map<string, any>(),
    layers = new Map<string, any>()
  const events = new Map<string, Set<(data?: any) => void>>()
  const loaded = new Set<string>()
  const status = vi.fn()
  const map = {
    addSource: (id: string, spec: any) => sources.set(id, spec),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: any) => layers.set(spec.id, spec),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty: vi.fn(),
    isSourceLoaded: (id: string) => loaded.has(id),
    on: (event: string, fn: (data?: any) => void) => {
      if (!events.has(event)) events.set(event, new Set())
      events.get(event)!.add(fn)
    },
    off: (event: string, fn: (data?: any) => void) => events.get(event)?.delete(fn),
  }
  const context = { map, onSmokeStatus: status } as unknown as LayerContext
  return {
    context,
    sources,
    layers,
    loaded,
    status,
    map,
    emit: (event: string, data?: any) => events.get(event)?.forEach((fn) => fn(data)),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.fetch.mockResolvedValue(forecast)
})
afterEach(() => vi.useRealTimers())

it('waits for forecast tiles before relabeling time; failed or superseded hours retain the old map', async () => {
  const h = harness(),
    layer = smokeLayer(h.context)
  await vi.advanceTimersByTimeAsync(181)
  const first = [...h.sources.keys()][0]
  expect(h.sources.get(first).bounds).toEqual(forecast.bounds)
  expect(h.sources.get(first).tiles[0]).toContain(encodeURIComponent(forecast.modelRun))
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ displayed: null, loading: true }),
  )
  h.loaded.add(first)
  h.emit('sourcedata', { sourceId: first, sourceDataType: 'metadata' })
  expect(h.status).toHaveBeenLastCalledWith(expect.objectContaining({ displayed: null }))
  h.emit('sourcedata', { sourceId: first, tile: {} })
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ displayed: forecast.times[0], loading: false }),
  )
  layer.setTime(forecast.times[1])
  await vi.advanceTimersByTimeAsync(181)
  const second = [...h.sources.keys()].at(-1)!
  layer.setTime(forecast.times[2])
  expect(h.sources.has(second)).toBe(false)
  h.loaded.add(second)
  h.emit('sourcedata', { sourceId: second, tile: {} })
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ displayed: forecast.times[0] }),
  )
  await vi.advanceTimersByTimeAsync(181)
  const third = [...h.sources.keys()].at(-1)!
  h.emit('error', { sourceId: third, error: new Error('network') })
  expect(h.sources.has(first)).toBe(true)
  expect(h.sources.has(third)).toBe(false)
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({
      displayed: forecast.times[0],
      error: expect.stringContaining('unavailable'),
    }),
  )
  layer.retry()
  await vi.advanceTimersByTimeAsync(181)
  const retry = [...h.sources.keys()].at(-1)!
  h.loaded.add(retry)
  h.emit('idle')
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ displayed: forecast.times[2], error: '' }),
  )
  expect(h.sources.has(first)).toBe(false)
  layer.destroy()
  expect(h.sources.size).toBe(0)
  expect(mocks.removeProtocol).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('discards late metadata on exit and aborts the forecast request', async () => {
  let resolve!: (value: SmokeForecast) => void
  mocks.fetch.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const h = harness(),
    layer = smokeLayer(h.context)
  layer.destroy()
  resolve(forecast)
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.sources.size).toBe(0)
  expect(mocks.fetch.mock.calls[0][0].aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('can retry a metadata outage without a fabricated forecast or disabling heat observations', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(forecast)
  const h = harness(),
    layer = smokeLayer(h.context)
  await vi.advanceTimersByTimeAsync(1)
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ forecast: null, loading: false, error: expect.any(String) }),
  )
  layer.retry()
  await vi.advanceTimersByTimeAsync(181)
  expect(h.sources.size).toBe(1)
  layer.destroy()
})

it('keeps the visible model run until replacement tiles from the next run arrive', async () => {
  const next = { ...forecast, modelRun: '2026-10-04T12:00:00Z' }
  mocks.fetch.mockResolvedValueOnce(forecast).mockResolvedValueOnce(next)
  const h = harness(),
    layer = smokeLayer(h.context)
  await vi.advanceTimersByTimeAsync(181)
  const first = [...h.sources.keys()][0]
  h.loaded.add(first)
  h.emit('idle')
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ forecast: next, displayedRun: forecast.modelRun, loading: true }),
  )
  const replacement = [...h.sources.keys()].at(-1)!
  expect(h.sources.get(replacement).tiles[0]).toContain(encodeURIComponent(next.modelRun))
  h.loaded.add(replacement)
  h.emit('idle')
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ displayedRun: next.modelRun, loading: false }),
  )
  layer.destroy()
})
