import type { MapSourceDataEvent } from 'maplibre-gl'
import { LATEST_NATURE_YEAR, natureAttribution, natureTiles } from '../natureImagery'
import { SATELLITE_MAX_ZOOM } from '../mapConfig'
import type { HazardLayer, LayerContext, LayerSummary } from './types'

/** Yearly cloudless composites. A new year replaces the shown one only after its tiles load. */
export function natureLayer({ map, onImageryStatus, onSummary }: LayerContext): HazardLayer {
  let displayed = 2024 // The normal globe's 2024 basemap shows until the first year loads.
  let requested: number = LATEST_NATURE_YEAR
  let current: string | null = null
  let pending: string | null = null
  let timeout: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let destroyed = false
  let loading = false
  let error = ''
  const years = new Map<string, number>()

  const summary = (): LayerSummary => ({
    source: 'EOxCloudless · Sentinel-2',
    updated: `${displayed} · Annual cloudless composite`,
    imagery: `Sentinel-2 · ${displayed} cloudless composite`,
    imageryNote: 'Drag the timeline to compare the landscape',
  })
  const emit = () => {
    if (destroyed) return
    onImageryStatus?.({ requested, displayed, loading, error })
    onSummary?.(summary())
  }
  const remove = (id: string | null) => {
    if (!id) return
    years.delete(id)
    if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(id)) map.removeSource(id)
  }
  const cancelPending = () => {
    clearTimeout(timeout)
    remove(pending)
    pending = null
  }
  const fail = () => {
    cancelPending()
    loading = false
    error = `${requested} imagery unavailable. Showing ${displayed}.`
    emit()
  }
  const activate = (id: string) => {
    clearTimeout(timeout)
    const previous = current
    current = id
    pending = null
    displayed = years.get(id)!
    loading = false
    error = ''
    // The new year loaded directly beneath the old one, so it takes the old one's place.
    map.setLayoutProperty('satellite', 'visibility', 'none')
    map.setPaintProperty(id, 'raster-opacity', 1)
    remove(previous)
    emit()
  }
  const loaded = (event: MapSourceDataEvent) => {
    if (pending && event.sourceId === pending && event.tile && map.isSourceLoaded(pending))
      activate(pending)
  }
  const failed = (event: { error: unknown; sourceId?: string }) => {
    if (pending && event.sourceId === pending) fail()
    else if (current && event.sourceId === current) {
      error = 'Some imagery could not load. Retry or choose another year.'
      emit()
    }
  }
  const setYear = (year: number) => {
    if (destroyed) return
    const tiles = natureTiles(year) // Throws for a year the provider has not published.
    if (year === requested && pending) return
    cancelPending()
    requested = year
    if (year === displayed && current && !error) {
      loading = false
      emit()
      return
    }
    loading = true
    error = ''
    const base = `nature-imagery-${year}`
    const id = years.has(base) ? `${base}-${++generation}` : base
    years.set(id, year)
    pending = id
    timeout = setTimeout(fail, 20_000)
    map.addSource(id, {
      type: 'raster',
      tiles: [tiles],
      tileSize: 256,
      maxzoom: SATELLITE_MAX_ZOOM,
      attribution: natureAttribution(year),
    })
    map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        // A nonzero opacity keeps the hidden year loading underneath what is shown now.
        paint: {
          'raster-opacity': 0.001,
          'raster-opacity-transition': { duration: 0 },
          'raster-fade-duration': 0,
          'raster-saturation': -0.1,
        },
      },
      current ?? 'satellite',
    )
    emit()
  }
  map.on('sourcedata', loaded)
  map.on('error', failed)
  setYear(LATEST_NATURE_YEAR)

  return {
    get summary() {
      return summary()
    },
    setYear,
    destroy() {
      destroyed = true
      cancelPending()
      remove(current)
      map.off('sourcedata', loaded)
      map.off('error', failed)
      if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', 'visible')
    },
  }
}
