import { beforeEach, expect, it, vi } from 'vitest'
import type { LayerContext } from '../src/layers/types'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  flood: vi.fn(),
  nature: vi.fn(),
  wildfire: vi.fn(),
  storm: vi.fn(),
  education: vi.fn(),
}))
vi.mock('../src/api', async (original) => ({
  ...(await original<object>()),
  fetchLatestEducation: mocks.education,
}))
vi.mock('../src/layers/data', async (original) => ({
  ...(await original<object>()),
  loadData: mocks.load,
}))
vi.mock('../src/layers/flood', () => ({ floodLayer: mocks.flood }))
vi.mock('../src/layers/nature', () => ({ natureLayer: mocks.nature }))
vi.mock('../src/layers/liveWildfire', () => ({ liveWildfireLayer: mocks.wildfire }))
vi.mock('../src/layers/storm', () => ({ stormLayer: mocks.storm }))
import { createHazardLayer } from '../src/layers'

beforeEach(() => vi.clearAllMocks())

it('does not attach an immediately cancelled Nature layer during effect cleanup', async () => {
  const controller = new AbortController()
  const promise = createHazardLayer('nature', { signal: controller.signal } as LayerContext)
  controller.abort()
  await expect(promise).rejects.toThrow()
  expect(mocks.nature).not.toHaveBeenCalled()
})

it('does not attach flood geometry when its data arrives after a layer switch', async () => {
  let resolve!: (data: object) => void
  mocks.load.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  const controller = new AbortController()
  const promise = createHazardLayer('flood', { signal: controller.signal } as LayerContext)
  await Promise.resolve()
  expect(mocks.load).toHaveBeenCalledWith('gdacs')
  controller.abort()
  resolve({ floods: [] })
  await expect(promise).rejects.toThrow()
  expect(mocks.flood).not.toHaveBeenCalled()
})

it('routes wildfire to current observations without loading the historical replay or snapshot', async () => {
  const context = {
    detections: { features: [{ properties: { playback: true } }] },
  } as unknown as LayerContext
  await createHazardLayer('wildfire', context)
  expect(mocks.wildfire).toHaveBeenCalledWith(context)
  expect(mocks.load).not.toHaveBeenCalled()
  const storms = { storms: [] }
  mocks.load.mockResolvedValueOnce(storms)
  await createHazardLayer('storm', context)
  expect(mocks.storm).toHaveBeenCalledWith(context, storms)
})

it('does not attach education geometry if a pending download finishes after switching layers', async () => {
  let resolve!: (data: object) => void
  mocks.education.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  mocks.load.mockResolvedValueOnce({ type: 'FeatureCollection', features: [] })
  const controller = new AbortController()
  const promise = createHazardLayer('education', { signal: controller.signal } as LayerContext)
  await Promise.resolve()
  expect(mocks.education).toHaveBeenCalledOnce()
  expect(mocks.load).toHaveBeenCalledWith('education-countries')
  controller.abort()
  resolve({ countries: [] })
  await expect(promise).rejects.toThrow()
})
