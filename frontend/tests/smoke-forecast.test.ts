import { expect, it } from 'vitest'
import { recolorSmoke, smokeTileUrl, SMOKE_LAYER, type SmokeForecast } from '../src/smokeForecast'

export const forecast: SmokeForecast = {
  source: 'ECCC · RAQDPS',
  layer: SMOKE_LAYER,
  modelRun: '2026-10-04T00:00:00Z',
  times: ['2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z', '2026-10-04T14:00:00Z'],
  bounds: [-176, 16, -18, 80],
  resolutionKm: 10,
  coverage: 'North America',
  units: 'µg/m³',
}

it('pins raster tiles to the actual run and hour, with geographic tile bounds', () => {
  const url = new URL(smokeTileUrl(forecast, forecast.times[1]))
  expect(url.searchParams.get('TIME')).toBe(forecast.times[1])
  expect(url.searchParams.get('DIM_REFERENCE_TIME')).toBe(forecast.modelRun)
  expect(url.searchParams.get('LAYERS')).toBe(SMOKE_LAYER)
  expect(url.searchParams.get('BBOX')).toBe('{bbox-epsg-3857}')
  expect(() => smokeTileUrl(forecast, '2026-10-08T00:00:00Z')).toThrow()
})

it('preserves the published plume mask and darkens denser concentration bands', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 0, 33, 198, 245, 255, 101, 2, 5, 255])
  recolorSmoke(pixels)
  expect([...pixels.slice(0, 4)]).toEqual([0, 0, 0, 0])
  expect(pixels[11]).toBeGreaterThan(pixels[7])
  expect(pixels[8]).toBeLessThan(pixels[4])
  expect(pixels[7]).toBeGreaterThan(0)
})

it('rejects a changed palette rather than misrepresenting the forecast', () => {
  expect(() => recolorSmoke(new Uint8ClampedArray([0, 255, 0, 255]))).toThrow('palette')
})
