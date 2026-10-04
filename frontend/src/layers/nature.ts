import type { MapSourceDataEvent } from 'maplibre-gl'
import { fetchMonthlyMosaic, fetchNatureCatalog, natureOverviewTiles } from '../api'
import {
  LATEST_NATURE_YEAR,
  MONTHLY_MIN_ZOOM,
  OVERVIEW_MAX_ZOOM,
  natureAttribution,
  natureLabel,
  natureTiles,
  type ImageryStatus,
  type NaturePeriod,
  type MonthlyMosaic,
} from '../natureImagery'
import { SATELLITE_MAX_ZOOM } from '../mapConfig'
import type { HazardLayer, LayerContext, LayerSummary } from './types'
import { monthlyTileUrl } from './natureTiles'

const BACKGROUND = 'nature-imagery-background'
const MAX_FRAMES = 6
const CACHE_TTL = 60 * 60 * 1000
interface Frame {
  id: string
  period: NaturePeriod
  overview: boolean
  ready: boolean
  failed?: boolean
  expires: number
  controller: AbortController
  timeout?: ReturnType<typeof setTimeout>
}
const MONTHLY_ATTRIBUTION =
  '<a href="https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a">Microsoft Planetary Computer</a> · Contains modified Copernicus Sentinel data · <a href="https://dataspace.copernicus.eu/explore-data/collections/sentinel-data/sentinel-2">Sentinel-2</a>'
const OVERVIEW_ATTRIBUTION =
  '<a href="https://www.earthdata.nasa.gov/data/projects/hls">NASA HLS S30</a> / <a href="https://www.earthdata.nasa.gov/centers/gibs">GIBS</a> · Contains modified Copernicus Sentinel-2 data'

/** Saved monthly globe mosaics and regional detail, with actual loaded date/coverage labels. */
export function natureLayer({ map, onImageryStatus, onSummary }: LayerContext): HazardLayer {
  let displayed: NaturePeriod = 2024
  let requested: NaturePeriod = displayed
  let current: string | null = null
  let pending: string | null = null
  let debounce: ReturnType<typeof setTimeout> | undefined
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined
  let catalogRequest: AbortController | null = null
  let generation = 0
  let direction = 1
  let destroyed = false
  let loading = false
  let error = ''
  let months: string[] = []
  let catalogLoading = false
  let catalogError = ''
  let overview = false
  const frames = new Map<string, Frame>()
  const mosaics = new Map<string, { value: MonthlyMosaic; expires: number }>()
  const skipped = new Set<string>()

  const summary = (): LayerSummary => {
    const saved = current ? frames.get(current)?.overview : false
    return {
      source:
        typeof displayed === 'string'
          ? saved
            ? 'Copernicus Sentinel-2 · NASA HLS S30 / GIBS'
            : 'Copernicus Sentinel-2 · Microsoft Planetary Computer'
          : 'EOxCloudless · Sentinel-2',
      updated: `${natureLabel(displayed)} · ${typeof displayed === 'string' ? (saved ? 'Saved monthly overview · 30 m source imagery' : 'Monthly mosaic · 10 m source imagery') : 'Annual cloudless composite'}`,
      imagery: `Sentinel-2 · ${natureLabel(displayed)} ${typeof displayed === 'string' ? 'monthly mosaic' : 'cloudless composite'}`,
      imageryNote:
        typeof displayed === 'string'
          ? saved
            ? 'Saved monthly composite · Clouds and observation gaps may remain'
            : 'Low-cloud scenes · Clouds may remain; blank areas have no imagery'
          : 'Drag the timeline to compare the landscape',
    }
  }
  const emit = () => {
    if (destroyed) return
    const status: ImageryStatus = {
      requested,
      displayed,
      loading,
      error,
      months,
      catalogLoading,
      catalogError,
      overview: false,
    }
    onImageryStatus?.(status)
    onSummary?.(summary())
  }
  const remove = (id: string) => {
    const frame = frames.get(id)
    frame?.controller.abort()
    clearTimeout(frame?.timeout)
    frames.delete(id)
    if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(id)) map.removeSource(id)
  }
  const cancelPending = () => {
    clearTimeout(debounce)
    debounce = undefined
    const id = pending
    pending = null
    if (id) remove(id)
  }
  const stopPrefetch = (keep?: NaturePeriod) => {
    clearTimeout(prefetchTimer)
    prefetchTimer = undefined
    for (const frame of frames.values()) {
      if (!frame.ready && frame.id !== current && frame.id !== pending && frame.period !== keep)
        remove(frame.id)
    }
  }
  const frameFor = (period: NaturePeriod) =>
    [...frames.values()].find(
      (frame) =>
        frame.period === period &&
        frame.overview === overview &&
        !frame.failed &&
        frame.expires > Date.now(),
    )
  const trim = () => {
    for (const frame of frames.values()) {
      if (frames.size < MAX_FRAMES) break
      if (frame.id !== current && frame.id !== pending) remove(frame.id)
    }
  }
  const fail = () => {
    cancelPending()
    loading = false
    error = `${natureLabel(requested)} imagery unavailable. Showing ${natureLabel(displayed)}.`
    emit()
  }
  const activate = (frame: Frame) => {
    clearTimeout(frame.timeout)
    const previous = current
    current = frame.id
    pending = null
    displayed = frame.period
    if (typeof displayed === 'string') skipped.delete(displayed)
    loading = false
    error = ''
    // Unobserved monthly areas must not expose an annual photo under a monthly date.
    map.setLayoutProperty(
      BACKGROUND,
      'visibility',
      typeof displayed === 'string' ? 'visible' : 'none',
    )
    map.setLayoutProperty('satellite', 'visibility', 'none')
    map.moveLayer(current)
    map.setPaintProperty(current, 'raster-opacity', 1)
    if (previous && previous !== current) {
      const previousFrame = frames.get(previous)
      if (
        typeof displayed === 'string' &&
        typeof previousFrame?.period === 'string' &&
        previousFrame.ready &&
        (previousFrame.period !== displayed || previousFrame.overview !== frame.overview)
      ) {
        // Retain decoded tiles behind the opaque backdrop, including no-observation areas.
        map.moveLayer(previous, BACKGROUND)
        map.setPaintProperty(previous, 'raster-opacity', 0.001)
      } else remove(previous)
    }
    frames.delete(frame.id)
    frames.set(frame.id, frame)
    emit()
    schedulePrefetch()
  }
  const loaded = (event: MapSourceDataEvent) => {
    const frame = frames.get(event.sourceId)
    if (!frame || frame.failed || !event.tile || !map.isSourceLoaded(frame.id)) return
    frame.ready = true
    clearTimeout(frame.timeout)
    if (frame.id === pending) activate(frame)
    else schedulePrefetch()
  }
  const frameFailed = (frame: Frame) => {
    if (!frames.has(frame.id)) return
    if (frame.id === pending) fail()
    else {
      if (typeof frame.period === 'string') skipped.add(frame.period)
      remove(frame.id)
      schedulePrefetch()
    }
  }
  const failed = (event: { error: unknown; sourceId?: string }) => {
    if (pending && event.sourceId === pending) fail()
    else if (current && event.sourceId === current) {
      frames.get(current)!.ready = false
      frames.get(current)!.failed = true
      stopPrefetch()
      error = 'Some imagery could not load. Retry or choose another date.'
      emit()
    } else if (event.sourceId && frames.has(event.sourceId))
      frameFailed(frames.get(event.sourceId)!)
  }
  const addImagery = (frame: Frame, tiles: string) => {
    const { id, period } = frame
    const monthly = typeof period === 'string'
    map.addSource(id, {
      type: 'raster',
      tiles: [tiles],
      tileSize: 256,
      maxzoom: frame.overview ? OVERVIEW_MAX_ZOOM : SATELLITE_MAX_ZOOM,
      ...(monthly ? { minzoom: frame.overview ? 0 : MONTHLY_MIN_ZOOM } : {}),
      attribution: monthly
        ? frame.overview
          ? OVERVIEW_ATTRIBUTION
          : MONTHLY_ATTRIBUTION
        : natureAttribution(period),
    })
    map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        // A nonzero opacity keeps the preloaded source active. The opaque background
        // covers it until activation; missing pixels cannot expose another month.
        paint: {
          'raster-opacity': 0.001,
          'raster-opacity-transition': { duration: 0 },
          'raster-fade-duration': 0,
          'raster-saturation': -0.1,
        },
      },
      BACKGROUND,
    )
  }
  const prepare = (period: NaturePeriod, foreground: boolean) => {
    trim()
    const saved = typeof period === 'string' && overview
    const base = `nature-imagery-${period}${saved ? '-overview' : ''}`
    const id = frames.has(base) ? `${base}-${++generation}` : base
    const frame: Frame = {
      id,
      period,
      overview: saved,
      ready: false,
      expires: Date.now() + CACHE_TTL,
      controller: new AbortController(),
    }
    frames.set(id, frame)
    if (foreground) pending = id
    frame.timeout = setTimeout(
      () => frameFailed(frame),
      typeof period === 'string' ? 45_000 : 20_000,
    )
    if (typeof period === 'number') {
      addImagery(frame, natureTiles(period))
      return
    }
    if (saved) {
      addImagery(frame, natureOverviewTiles(period))
      return
    }
    const cached = mosaics.get(period)
    const fresh = cached && cached.expires > Date.now()
    const result = fresh
      ? Promise.resolve(cached.value)
      : fetchMonthlyMosaic(period, frame.controller.signal)
    void result
      .then((mosaic) => {
        if (destroyed || frame.controller.signal.aborted || frames.get(id) !== frame) return
        if (mosaic.month !== period) throw new Error('Unexpected imagery month.')
        const tiles = monthlyTileUrl(mosaic.searchId)
        if (!fresh) {
          if (mosaics.size >= 120) mosaics.delete(mosaics.keys().next().value!)
          mosaics.set(period, { value: mosaic, expires: Date.now() + CACHE_TTL })
        }
        addImagery(frame, tiles)
      })
      .catch(() => {
        if (!destroyed && !frame.controller.signal.aborted) frameFailed(frame)
      })
  }
  function schedulePrefetch() {
    clearTimeout(prefetchTimer)
    if (
      destroyed ||
      loading ||
      error ||
      typeof displayed !== 'string' ||
      map.isMoving() ||
      !current ||
      !map.isSourceLoaded(current)
    )
      return
    if ([...frames.values()].some((frame) => !frame.ready)) return
    // One speculative month at a time, after the selected month has finished.
    prefetchTimer = setTimeout(() => {
      prefetchTimer = undefined
      if (
        destroyed ||
        loading ||
        error ||
        map.isMoving() ||
        !current ||
        !map.isSourceLoaded(current)
      )
        return
      const index = months.indexOf(displayed as string)
      const next = [direction, -direction, direction * 2, -direction * 2]
        .map((offset) => months[index + offset])
        .find((month) => month && !skipped.has(month) && !frameFor(month))
      if (next) prepare(next, false)
    }, 400)
  }
  const setYear = (period: NaturePeriod) => {
    if (destroyed) return
    const monthly = typeof period === 'string'
    if (monthly && !months.includes(period)) return
    if (!monthly) natureTiles(period)
    const needsOverview = monthly && map.getZoom() < MONTHLY_MIN_ZOOM
    if (period === requested && (pending || debounce) && needsOverview === overview) return
    cancelPending()
    stopPrefetch(period)
    if (monthly && typeof requested === 'string')
      direction = Math.sign(months.indexOf(period) - months.indexOf(requested)) || direction
    requested = period
    overview = needsOverview
    if (period === displayed && !error && current && frames.get(current)?.overview === overview) {
      loading = false
      emit()
      schedulePrefetch()
      return
    }
    const cached = frameFor(period)
    loading = true
    error = ''
    if (cached) {
      pending = cached.id
      clearTimeout(cached.timeout)
      cached.timeout = setTimeout(() => frameFailed(cached), 45_000)
      if (cached.ready && !map.isMoving() && map.isSourceLoaded(cached.id)) activate(cached)
      else emit()
      return
    }
    if (!monthly)
      for (const frame of frames.values()) {
        if (frame.id !== current) remove(frame.id)
      }
    emit()
    if (!monthly) {
      prepare(period, true)
      return
    }
    // A continuous drag can pass many months. Only fetch after it briefly settles.
    debounce = setTimeout(
      () => {
        debounce = undefined
        prepare(period, true)
      },
      overview ? 60 : 180,
    )
  }
  const moving = () => {
    stopPrefetch()
    skipped.clear()
    // Prepared frames are valid only for this view. Stop speculative traffic as
    // soon as the camera moves; downloaded bytes remain in the bounded tile cache.
    for (const frame of frames.values()) {
      if (frame.id !== current && frame.id !== pending) remove(frame.id)
    }
  }
  const moved = () => {
    if (typeof requested !== 'string') return
    const below = map.getZoom() < MONTHLY_MIN_ZOOM
    if (below !== overview) setYear(requested)
    else {
      const frame = pending ? frames.get(pending) : undefined
      if (frame?.ready && map.isSourceLoaded(frame.id)) activate(frame)
      else schedulePrefetch()
    }
  }
  const retryNatureCatalog = () => {
    catalogRequest?.abort()
    const controller = new AbortController()
    catalogRequest = controller
    catalogLoading = true
    catalogError = ''
    emit()
    void fetchNatureCatalog(controller.signal)
      .then((catalog) => {
        if (destroyed || controller.signal.aborted) return
        if (
          !catalog.months.length ||
          catalog.months.some((month) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        )
          throw new Error('Invalid monthly imagery catalog.')
        months = catalog.months
        catalogLoading = false
        emit()
      })
      .catch(() => {
        if (destroyed || controller.signal.aborted) return
        catalogLoading = false
        catalogError = 'Monthly imagery unavailable. Retry.'
        emit()
      })
  }
  map.addLayer(
    {
      id: BACKGROUND,
      type: 'background',
      layout: { visibility: 'none' },
      paint: { 'background-color': '#15212a' },
    },
    'satellite',
  )
  map.on('sourcedata', loaded)
  map.on('error', failed)
  map.on('movestart', moving)
  map.on('moveend', moved)
  setYear(LATEST_NATURE_YEAR)
  retryNatureCatalog()

  return {
    get summary() {
      return summary()
    },
    setYear,
    retryNatureCatalog,
    destroy() {
      destroyed = true
      cancelPending()
      stopPrefetch()
      catalogRequest?.abort()
      map.off('sourcedata', loaded)
      map.off('error', failed)
      map.off('movestart', moving)
      map.off('moveend', moved)
      for (const id of frames.keys()) remove(id)
      if (map.getLayer(BACKGROUND)) map.removeLayer(BACKGROUND)
      if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', 'visible')
    },
  }
}
