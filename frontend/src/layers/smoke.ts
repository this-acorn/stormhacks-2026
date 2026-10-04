import {
  addProtocol,
  removeProtocol,
  type ExpressionSpecification,
  type MapSourceDataEvent,
} from 'maplibre-gl'
import { fetchSmokeForecast } from '../api'
import { EMPTY_SMOKE, recolorSmoke, smokeTileUrl, type SmokeStatus } from '../smokeForecast'
import type { LayerContext } from './types'

let sequence = 0

// Keep the globe overview quiet, then reveal the full geographic plume up close.
// The source's maxzoom only limits data resolution; these tiles stay visible beyond it.
const SMOKE_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.65,
  3,
  0.78,
  5,
  0.95,
  7,
  1,
]

/** A geographically projected forecast raster. No invented plumes or randomized wind. */
export function smokeLayer({ map, signal: parentSignal, onSmokeStatus }: LayerContext) {
  const controller = new AbortController()
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal
  const protocol = `aidatlas-smoke-${++sequence}`
  let status: SmokeStatus = { ...EMPTY_SMOKE }
  let current: string | null = null
  let currentRun: string | null = null
  let pending: string | null = null
  let loadingCatalog = false
  let catalogFailed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  const ids = new Set<string>()
  const emit = (patch: Partial<SmokeStatus>) => {
    status = { ...status, ...patch }
    if (!signal.aborted) onSmokeStatus?.(status)
  }

  addProtocol(protocol, async (request, cancellation) => {
    const url = request.url.slice(`${protocol}://`.length)
    if (!url.startsWith('https://geo.weather.gc.ca/geomet?')) throw new Error('Invalid smoke tile.')
    const tileSignal = AbortSignal.any([signal, cancellation.signal])
    const response = await fetch(url, { signal: tileSignal })
    if (!response.ok) throw new Error('Smoke forecast tile unavailable.')
    const bitmap = await createImageBitmap(await response.blob())
    try {
      tileSignal.throwIfAborted()
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      recolorSmoke(pixels.data)
      ctx.putImageData(pixels, 0, 0)
      const png = await canvas.convertToBlob({ type: 'image/png' })
      tileSignal.throwIfAborted()
      return { data: await png.arrayBuffer() }
    } finally {
      bitmap.close()
    }
  })

  const remove = (id: string) => {
    if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(id)) map.removeSource(id)
    ids.delete(id)
  }
  const cancelPending = () => {
    clearTimeout(debounce)
    clearTimeout(timeout)
    const id = pending
    pending = null
    if (id) remove(id)
  }
  const fail = () => {
    cancelPending()
    emit({
      loading: false,
      error: status.displayed
        ? 'Forecast unavailable. The displayed time has not changed.'
        : 'Smoke forecast unavailable. Heat observations are still shown.',
    })
  }
  const commit = () => {
    if (!pending || !map.isSourceLoaded(pending)) return
    clearTimeout(timeout)
    const previous = current
    current = pending
    currentRun = status.forecast!.modelRun
    pending = null
    map.setPaintProperty(current, 'raster-opacity', SMOKE_OPACITY)
    if (previous) remove(previous)
    emit({ displayed: status.requested, displayedRun: currentRun, loading: false, error: '' })
  }
  const loaded = (event: MapSourceDataEvent) => {
    if (event.sourceId === pending && event.tile) commit()
  }
  const failed = (event: { error: unknown; sourceId?: string }) => {
    if (event.sourceId === pending) fail()
    else if (event.sourceId === current)
      emit({ loading: false, error: 'Some forecast tiles are unavailable.' })
  }
  const setTime = (time: string) => {
    const forecast = status.forecast
    if (!forecast || !forecast.times.includes(time) || signal.aborted) return
    cancelPending()
    if (time === status.displayed && currentRun === forecast.modelRun && !status.error) {
      emit({ requested: time, loading: false })
      return
    }
    emit({ requested: time, loading: true, error: '' })
    debounce = setTimeout(() => {
      if (signal.aborted) return
      const id = `${protocol}-${++generation}`
      pending = id
      ids.add(id)
      map.addSource(id, {
        type: 'raster',
        tiles: [`${protocol}://${smokeTileUrl(forecast, time)}`],
        tileSize: 256,
        maxzoom: 7,
        bounds: forecast.bounds,
        attribution:
          '<a href="https://eccc-msc.github.io/open-data/msc-data/nwp_raqdps/readme_raqdps_en/">ECCC MSC GeoMet · smoke forecast</a>',
      })
      map.addLayer({
        id,
        type: 'raster',
        source: id,
        paint: {
          'raster-opacity': 0.001,
          'raster-opacity-transition': { duration: 0 },
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      })
      timeout = setTimeout(fail, 25_000)
    }, 180)
  }
  const refresh = async () => {
    if (loadingCatalog || signal.aborted) return
    loadingCatalog = true
    clearTimeout(timer)
    try {
      const forecast = await fetchSmokeForecast(signal)
      signal.throwIfAborted()
      catalogFailed = false
      const selected =
        status.requested && forecast.times.includes(status.requested)
          ? status.requested
          : forecast.times[0]
      emit({ forecast })
      setTime(selected)
    } catch {
      catalogFailed = true
      if (!signal.aborted) emit({ loading: false, error: 'Smoke forecast update unavailable.' })
    } finally {
      loadingCatalog = false
      if (!signal.aborted) timer = setTimeout(refresh, 10 * 60_000)
    }
  }
  map.on('sourcedata', loaded)
  map.on('idle', commit) // Also completes when the view is outside the forecast's coverage.
  map.on('error', failed)
  emit({})
  void refresh()
  return {
    setTime,
    retry: () =>
      !catalogFailed && status.forecast && status.requested
        ? setTime(status.requested)
        : void refresh(),
    destroy() {
      controller.abort()
      clearTimeout(timer)
      cancelPending()
      map.off('sourcedata', loaded)
      map.off('idle', commit)
      map.off('error', failed)
      for (const id of ids) remove(id)
      removeProtocol(protocol)
    },
  }
}
