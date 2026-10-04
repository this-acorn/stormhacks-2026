import { MercatorCoordinate, type ExpressionSpecification } from 'maplibre-gl'
import type { EducationGeometry } from '../educationData'
import { layerPitch } from '../exploreLayers'
import {
  violenceCountries,
  violenceColor,
  violenceHeight,
  violencePercent,
  VIOLENCE_COLOR_STOPS,
  type CountryCatalog,
  type ViolencePlace,
} from '../violenceData'
import type { ViolenceData } from './data'
import { distanceKm, offset } from './geo'
import type { Coordinates } from '../types'
import type { HazardInfo, HazardLayer, LayerContext, ScreenPoint } from './types'
import { pickViolenceBar, type ViolenceBar } from './violencePicking'

const SOURCE = 'violence-bars'
const RAISED = 'violence-bars-3d'
const BOUNDARIES = 'violence-country-boundaries'
const SELECTED_HALO = 'violence-country-halo'
const SELECTED_BORDER = 'violence-country-selected'
const HALF_WIDTH = 70_000
const RISE_SECONDS = 1.2
const SWEEP_SECONDS = 0.7
const COLOR: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'value'],
  ...VIOLENCE_COLOR_STOPS.flatMap(({ value, color }) => [value, color]),
] as ExpressionSpecification

export function violenceLayer(
  context: LayerContext,
  data: ViolenceData,
  geometry: EducationGeometry,
  catalog: CountryCatalog,
): HazardLayer {
  const { map, canvas } = context
  const countries = violenceCountries(data, catalog)
  const places = new Map(countries.map((country) => [country.id, country]))
  const coverage = countries.filter((country) => country.estimate).length
  if (!coverage || !geometry.features.length) throw new Error('Country estimates are unavailable.')
  let selectedId: string | null = null
  let destroyed = false
  const previousCursor = map.getCanvas().style.cursor
  const bars: ViolenceBar[] = []
  const entrance: {
    bar: ViolenceBar
    at: Coordinates
    targetHeight: number
    delay: number
    progress: number
  }[] = []
  map.addSource(BOUNDARIES, { type: 'geojson', data: geometry })
  // A dark halo keeps the selected country's border visible against land and water.
  map.addLayer({
    id: SELECTED_HALO,
    source: BOUNDARIES,
    type: 'line',
    filter: ['==', ['get', 'id'], ''],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#1c102b', 'line-width': 6, 'line-opacity': 0.85 },
  })
  map.addLayer({
    id: SELECTED_BORDER,
    source: BOUNDARIES,
    type: 'line',
    filter: ['==', ['get', 'id'], ''],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#c39bff',
      'line-width': 2.5,
      'line-opacity': 1,
      'line-color-transition': { duration: 0 },
    },
  })
  map.addSource(SOURCE, {
    type: 'geojson',
    promoteId: 'id',
    data: {
      type: 'FeatureCollection',
      features: countries.flatMap((country) => {
        if (!country.estimate) return []
        const at = country.estimate.at
        const sw = offset(at, -HALF_WIDTH, -HALF_WIDTH)
        const ne = offset(at, HALF_WIDTH, HALF_WIDTH)
        const corners: [number, number][] = [sw, [ne[0], sw[1]], ne, [sw[0], ne[1]]]
        const barHeight = violenceHeight(country.estimate.all.value)
        const bar: ViolenceBar = {
          id: country.id,
          corners: corners.map((corner) => MercatorCoordinate.fromLngLat(corner)),
          height: canvas.still ? barHeight : 0,
        }
        bars.push(bar)
        entrance.push({
          bar,
          at,
          targetHeight: barHeight,
          delay: 0,
          progress: canvas.still ? 1 : 0,
        })
        return [
          {
            type: 'Feature' as const,
            id: country.id,
            properties: {
              id: country.id,
              value: country.estimate.all.value,
              height: barHeight,
            },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[...corners, sw]],
            },
          },
        ]
      }),
    },
  })
  // Original compact country bars; ease them down when zooming in to city-level requests.
  const rise: ExpressionSpecification = [
    'coalesce',
    ['feature-state', 'rise'],
    canvas.still ? 1 : 0,
  ]
  const height: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    ['*', ['get', 'height'], rise],
    5,
    ['*', ['get', 'height'], rise],
    8,
    0,
  ]
  map.addLayer({
    id: RAISED,
    source: SOURCE,
    type: 'fill-extrusion',
    paint: {
      'fill-extrusion-color': COLOR,
      'fill-extrusion-height': height,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
      'fill-extrusion-height-transition': { duration: 0 },
    },
  })
  // Wait for the bars to be drawn and the entry camera move to finish before starting the wave.
  let removePainter: (() => void) | null = null
  const stopRising = () => {
    const remove = removePainter
    removePainter = null
    remove?.()
  }
  const startEntrance = () => {
    if (destroyed || !map.isSourceLoaded(SOURCE) || map.isMoving()) return
    map.off('render', startEntrance)
    const center = map.getCenter()
    const origin: Coordinates = [center.lng, center.lat]
    const ordered = [...entrance].sort(
      (a, b) => distanceKm(a.at, origin) - distanceKm(b.at, origin),
    )
    ordered.forEach((entry, index) => {
      entry.delay = (index / Math.max(1, ordered.length - 1)) * SWEEP_SECONDS
    })
    let elapsed = 0
    removePainter = canvas.add(({ dt }) => {
      if (destroyed) return
      // Count visible frames so a slow load or background tab cannot consume the entrance.
      elapsed += Math.min(0.05, Math.max(0, dt))
      let finished = true
      for (const entry of entrance) {
        if (entry.progress === 1) continue
        const t = Math.min(1, Math.max(0, (elapsed - entry.delay) / RISE_SECONDS))
        const progress = 1 - (1 - t) ** 3
        if (progress < 1) finished = false
        if (progress === entry.progress) continue
        entry.progress = progress
        entry.bar.height = entry.targetHeight * progress
        // Feature state animates existing geometry without rebuilding the GeoJSON tiles.
        map.setFeatureState({ source: SOURCE, id: entry.bar.id }, { rise: progress })
      }
      // Release the shared animation canvas after its current frame has finished.
      if (finished) queueMicrotask(stopRising)
    })
  }
  if (!canvas.still) {
    map.on('render', startEntrance)
    map.triggerRepaint()
  }
  const publish = () =>
    context.onViolenceStatus?.({ data, countries, geometry, selectedId, coverage })
  const describe = (country: ViolencePlace): HazardInfo => ({
    eyebrow: 'INTIMATE PARTNER VIOLENCE',
    title: country.name,
    subtitle: country.estimate
      ? `${country.estimate.year} estimate · ever-partnered women aged 15+`
      : 'No estimate available',
    facts: country.estimate
      ? [{ label: 'In the previous 12 months', value: violencePercent(country.estimate.all.value) }]
      : [],
    note: 'Select this country to see details and published support requests.',
    source: 'WHO · UN SDG 5.2.1',
  })
  const countryAt = (point: ScreenPoint, tolerance: number) => {
    if (destroyed) return undefined
    const zoomScale = Math.min(1, Math.max(0, (8 - map.getZoom()) / 3))
    const id = pickViolenceBar(map, bars, point, zoomScale, tolerance)
    return id ? places.get(id) : undefined
  }
  const select = (id: string | null) => {
    if (destroyed || (id !== null && !places.has(id))) return false
    selectedId = id
    for (const border of [SELECTED_HALO, SELECTED_BORDER])
      map.setFilter(border, ['==', ['get', 'id'], id ?? ''])
    const estimate = id ? places.get(id)?.estimate : null
    map.setPaintProperty(
      SELECTED_BORDER,
      'line-color',
      estimate ? violenceColor(estimate.all.value) : '#c39bff',
    )
    // Keep the data color on selection so it still agrees with the card's legend.
    context.hover(null)
    publish()
    return true
  }
  const destination = (country: ViolencePlace) => {
    const center = country.estimate?.at ?? country.center
    if (!center) return null
    const { clientWidth: width, clientHeight: height } = map.getContainer()
    const mobile = width <= 700
    return {
      center,
      zoom: country.zoom,
      padding: {
        top: 170,
        bottom: mobile ? Math.max(80, Math.min(height * 0.43 + 80, height - 210)) : 116,
        left: mobile ? 0 : width <= 1100 ? 330 : 370,
        right: mobile ? 0 : 28,
      },
    }
  }
  const layer: HazardLayer = {
    summary: { source: 'WHO · UN SDG 5.2.1', updated: `${data.year} estimates · survey-based` },
    selectViolenceCountry(id) {
      if (!select(id)) return
      const country = id ? places.get(id) : null
      const target = country && destination(country)
      if (target)
        map.flyTo({
          ...target,
          pitch: layerPitch('domestic_violence', target.zoom),
          duration: 1100,
          essential: false,
        })
    },
    hitTest(point) {
      const country = countryAt(point, 8)
      map.getCanvas().style.cursor = country ? 'pointer' : previousCursor
      return country ? describe(country) : null
    },
    focus(point) {
      const country = countryAt(point, 14)
      if (!country || !select(country.id)) return null
      return destination(country)
    },
    destroy() {
      destroyed = true
      if (!canvas.still) map.off('render', startEntrance)
      stopRising()
      map.getCanvas().style.cursor = previousCursor
      for (const id of [RAISED, SELECTED_BORDER, SELECTED_HALO])
        if (map.getLayer(id)) map.removeLayer(id)
      for (const id of [SOURCE, BOUNDARIES]) if (map.getSource(id)) map.removeSource(id)
    },
  }
  publish()
  return layer
}
