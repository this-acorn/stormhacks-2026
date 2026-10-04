import { afterEach, expect, it, vi } from 'vitest'
import { inflateSync } from 'node:zlib'

const handlers = vi.hoisted(() => new Map<string, any>())
vi.mock('maplibre-gl', () => ({
  addProtocol: (name: string, handler: any) => handlers.set(name, handler),
}))
import { monthlyTileUrl } from '../src/layers/natureTiles'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('turns the provider no-observation response into a real transparent tile and preserves network errors', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetcher)
  const url = monthlyTileUrl('a'.repeat(32))
    .replace('{z}', '9')
    .replace('{x}', '85')
    .replace('{y}', '184')
  const controller = new AbortController()
  const result = await handlers.get('sentinel-month')({ url }, controller)
  const png = Buffer.from(result.data)
  expect(png.readUInt32BE(16)).toBe(256)
  expect(png.readUInt32BE(20)).toBe(256)
  const size = png.readUInt32BE(33)
  const pixels = inflateSync(png.subarray(41, 41 + size))
  expect(pixels.length).toBe(256 * (1 + 256 * 4))
  expect(pixels.every((value) => value === 0)).toBe(true)
  expect(fetcher.mock.calls[0][0]).toContain('collection=sentinel-2-l2a&assets=visual')
  expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal)
  fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }))
  const missing = { url: url.replace('/85/', '/86/') }
  await expect(handlers.get('sentinel-month')(missing, controller)).rejects.toThrow('503')
  await expect(handlers.get('sentinel-month')(missing, controller)).rejects.toThrow('503')
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(() => monthlyTileUrl('https://untrusted.example')).toThrow()
})

it('reuses downloaded bytes without another request, survives buffer transfer and expires after one hour', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])))
  vi.stubGlobal('fetch', fetcher)
  const url = monthlyTileUrl('b'.repeat(32)).replace('{z}/{x}/{y}', '9/85/184')
  const load = () => handlers.get('sentinel-month')({ url }, new AbortController())
  const first = await load()
  const second = await load()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(second.data).not.toBe(first.data)
  structuredClone(first.data, { transfer: [first.data] })
  expect(first.data.byteLength).toBe(0)
  expect([...new Uint8Array((await load()).data)]).toEqual([1, 2, 3, 4])
  await vi.advanceTimersByTimeAsync(3_600_001)
  await load()
  expect(fetcher).toHaveBeenCalledTimes(2)
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(handlers.get('sentinel-month')({ url }, cancelled)).rejects.toMatchObject({
    name: 'AbortError',
  })
})

it('bounds the downloaded tile cache and keeps recently revisited tiles', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([42])))
  vi.stubGlobal('fetch', fetcher)
  const base = monthlyTileUrl('c'.repeat(32))
  const load = (x: number) =>
    handlers.get('sentinel-month')(
      { url: base.replace('{z}/{x}/{y}', `10/${x}/184`) },
      new AbortController(),
    )
  for (let x = 0; x < 512; x++) await load(x)
  await load(0)
  await load(512)
  expect(fetcher).toHaveBeenCalledTimes(513)
  await load(0)
  expect(fetcher).toHaveBeenCalledTimes(513)
  await load(1)
  expect(fetcher).toHaveBeenCalledTimes(514)
})
