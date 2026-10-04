import type { ExpressionSpecification } from 'maplibre-gl'
import {
  educationColor,
  educationPercent,
  EDUCATION_NO_DATA,
  latestObservation,
  type EducationCountry,
  type EducationData,
  type EducationGeometry,
} from '../educationData'
import { formatNumber } from './data'
import type { HazardInfo, HazardLayer, LayerContext, ScreenPoint } from './types'

const SOURCE = 'education-countries'
const FILL = 'education-access'
const BORDER = 'education-borders'
const SELECTED = 'education-selected'

export function educationLayer(
  context: LayerContext,
  data: EducationData,
  geometry: EducationGeometry,
): HazardLayer & { updateEducationData: (next: EducationData) => void } {
  const { map } = context
  if (!data.years.length || !data.countries.length)
    throw new Error('Education data is unavailable.')
  let selectedId: string | null = null
  let destroyed = false
  let countries = new Map(data.countries.map((country) => [country.id, country]))
  let latest = new Map(
    data.countries.map((country) => [country.id, latestObservation(country, data.years)]),
  )
  let coverage = [...latest.values()].filter(Boolean).length
  const previousCursor = map.getCanvas().style.cursor

  map.addSource(SOURCE, { type: 'geojson', data: geometry })
  map.addLayer({
    id: FILL,
    source: SOURCE,
    type: 'fill',
    paint: {
      'fill-color': EDUCATION_NO_DATA,
      'fill-opacity': 0.88,
      'fill-color-transition': { duration: 0 },
    },
  })
  map.addLayer({
    id: BORDER,
    source: SOURCE,
    type: 'line',
    paint: { 'line-color': '#d3c49c', 'line-width': 0.6, 'line-opacity': 0.35 },
  })
  map.addLayer({
    id: SELECTED,
    source: SOURCE,
    type: 'line',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'line-color': '#fff2c5', 'line-width': 2, 'line-opacity': 0.95 },
  })

  const describe = (country: EducationCountry): HazardInfo => {
    const row = latest.get(country.id)
    return {
      eyebrow: 'EDUCATION · PRIMARY + LOWER SECONDARY',
      title: country.name,
      subtitle: row
        ? `Data year: ${row.year}${row.ages ? ` · ages ${row.ages[0]}–${row.ages[1]}` : ''}`
        : 'No reported data',
      facts: row
        ? [
            { label: 'Not enrolled', value: educationPercent(row.rate) },
            ...(row.count !== null ? [{ label: 'Children', value: formatNumber(row.count) }] : []),
          ]
        : [{ label: 'Available records', value: 'No reported data' }],
      note: row
        ? new Date().getFullYear() - row.year > 5
          ? 'Historical observation · more than 5 years old. Click for details.'
          : 'Click to explore 100 children and changes over time.'
        : 'Missing data does not mean no children are out of school.',
      source: `UNESCO UIS · ${data.release} release`,
    }
  }

  const countryAt = (point: ScreenPoint) => {
    const feature = map.queryRenderedFeatures([point.x, point.y], { layers: [FILL] })[0]
    return feature ? (countries.get(String(feature.properties.id)) ?? null) : null
  }

  const publish = () => {
    if (destroyed) return
    layer.summary = {
      source: 'UNESCO UIS',
      updated: `${data.release} release · data years vary by country`,
    }
    context.onEducationStatus?.({ data, selectedId, coverage })
    context.onSummary?.(layer.summary)
  }

  const select = (id: string | null) => {
    if (destroyed || (id !== null && !countries.has(id))) return
    selectedId = id
    map.setFilter(SELECTED, ['==', ['get', 'id'], id ?? ''])
    context.hover(null)
    publish()
  }

  const draw = () => {
    const color: unknown[] = ['match', ['get', 'id']]
    for (const country of data.countries) {
      const row = latest.get(country.id)
      if (row) color.push(country.id, educationColor(row.rate))
    }
    color.push(EDUCATION_NO_DATA)
    map.setPaintProperty(
      FILL,
      'fill-color',
      color.length > 3 ? (color as ExpressionSpecification) : EDUCATION_NO_DATA,
    )
    context.hover(null)
    publish()
  }

  const layer: HazardLayer & { updateEducationData: (next: EducationData) => void } = {
    summary: { source: 'UNESCO UIS' },
    updateEducationData(next) {
      if (destroyed) return
      data = next
      countries = new Map(data.countries.map((country) => [country.id, country]))
      latest = new Map(
        data.countries.map((country) => [country.id, latestObservation(country, data.years)]),
      )
      coverage = [...latest.values()].filter(Boolean).length
      if (selectedId && !countries.has(selectedId)) {
        selectedId = null
        map.setFilter(SELECTED, ['==', ['get', 'id'], ''])
      }
      draw()
    },
    selectEducationCountry(id) {
      select(id)
      const country = id ? countries.get(id) : null
      if (country?.center && !destroyed)
        map.flyTo({
          center: country.center,
          zoom: country.zoom ?? 3,
          pitch: 0,
          duration: 1100,
          essential: false,
        })
    },
    hitTest(point) {
      const country = countryAt(point)
      map.getCanvas().style.cursor = country ? 'pointer' : previousCursor
      return country ? describe(country) : null
    },
    focus(point) {
      const country = countryAt(point)
      if (!country) return null
      select(country.id)
      return country.center ? { center: country.center, zoom: country.zoom ?? 3 } : null
    },
    destroy() {
      destroyed = true
      map.getCanvas().style.cursor = previousCursor
      for (const id of [SELECTED, BORDER, FILL]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    },
  }
  draw()
  return layer
}
