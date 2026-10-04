import { formatNumber, formatRange, type Flood, type Gdacs } from './data'
import { hidden, onScreen, polygonsContain } from './geo'
import { HazardIcons } from './icons'
import { paintFloodRipples } from './floodRipples'
import { floodFocus, sortFloods } from '../floodView'
import type { HazardInfo, HazardLayer, LayerContext, ScreenPoint } from './types'

const SOURCE = 'flood-areas'
const FLOOR = 'flood-floor'
const EDGE = 'flood-edge'

function describe(flood: Flood): HazardInfo {
  return {
    eyebrow: 'FLOOD · REPORTED EVENT',
    title: flood.name,
    subtitle: formatRange(flood.from, flood.to),
    alert: flood.alert.toLowerCase() as HazardInfo['alert'],
    facts: [
      { label: 'Affected area', value: `about ${formatNumber(flood.areaKm2)} km²` },
      ...flood.impacts.slice(0, 3).map((impact) => ({
        label: impact.label,
        value: `${impact.value.replace(/^1 people$/, '1 person')} · ${impact.where}`,
      })),
    ],
    note: 'GDACS estimates the affected area, not measured inundation or flood depth. Ripples mark reported events.',
    source: `${flood.source} · ${flood.alert} alert`,
  }
}

/** Original ripple markers over the reported areas, using the same overview system as Wildfire. */
export function floodLayer(context: LayerContext, data: Gdacs): HazardLayer {
  const { map, canvas } = context
  const floods = sortFloods(data.floods)
  map.addSource(SOURCE, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: floods.map((flood, index) => ({
        type: 'Feature',
        id: index,
        geometry: { type: 'MultiPolygon', coordinates: flood.polygons },
        properties: { id: flood.id },
      })),
    },
  })
  map.addLayer({
    id: FLOOR,
    type: 'fill',
    source: SOURCE,
    paint: {
      'fill-color': '#428fad',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.16, 8, 0.24],
      'fill-antialias': false,
    },
  })
  map.addLayer({
    id: EDGE,
    type: 'line',
    source: SOURCE,
    paint: {
      'line-color': '#8fc3ca',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 10, 1],
      'line-opacity': 0.4,
    },
  })

  let clock = 0
  const icons = new HazardIcons(
    map,
    floods.map((flood, index) => ({
      at: floodFocus(flood),
      kind: 'flood' as const,
      label: `Zoom to ${flood.name}, reported flood`,
      weight: floods.length - index,
      size: 44,
      fadeStartZoom: 5.5,
      info: () => describe(flood),
      paint: (frame, point, opacity) => {
        if (!onScreen(point.x, point.y, frame.width, frame.height, 80)) return
        const size = 26 * (0.8 + Math.max(0, Math.min(frame.zoom, 6)) * 0.07)
        paintFloodRipples(frame.ctx, point.x, point.y, size, clock + index * 1.7, opacity)
      },
      onSelect: () => {
        const points = flood.polygons.flat(2)
        if (!points.length) return
        let west = Infinity,
          south = Infinity,
          east = -Infinity,
          north = -Infinity
        for (const [lng, lat] of points) {
          west = Math.min(west, lng)
          east = Math.max(east, lng)
          south = Math.min(south, lat)
          north = Math.max(north, lat)
        }
        const padding = map.getContainer().clientWidth <= 700 ? 65 : 130
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            padding,
            maxZoom: 9,
            pitch: 0,
            duration: canvas.still ? 0 : 1300,
            essential: false,
          },
        )
      },
    })),
    7,
    context.hover,
  )
  const removePainter = canvas.add((frame) => {
    clock += frame.dt
    icons.paint(frame)
  })

  return {
    summary: {
      source: 'GDACS · estimated affected areas',
      updated: `Snapshot ${formatRange(data.builtAt, data.builtAt)}`,
    },
    hitTest(point: ScreenPoint) {
      const at = map.unproject([point.x, point.y])
      const flood = floods.find(
        (entry) => !hidden(map, entry.center) && polygonsContain(entry.polygons, [at.lng, at.lat]),
      )
      return flood ? describe(flood) : null
    },
    destroy() {
      removePainter()
      icons.destroy()
      for (const id of [EDGE, FLOOR]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    },
  }
}
