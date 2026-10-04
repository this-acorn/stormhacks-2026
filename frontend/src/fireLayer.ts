import type { ExpressionSpecification, GeoJSONSource, Map as MapInstance } from 'maplibre-gl'
import type { FireDetections } from './types'

// The Wildfire layer: a heatmap glow from far away, flickering embers up close.
// Ember colour shows age: white-hot for the newest detections, cooling to deep red after days.

const SOURCE = 'fire-detections'
const HEAT = 'fire-heat'
const GLOW = 'fire-glow'
const EMBERS = 'fire-embers'
const LAYERS = [HEAT, GLOW, EMBERS]

// Hours since the newest detection in the data set (playback data has no "now" of its own).
const AGE_COLOR: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'ageHours'],
  0, '#fff4dc',
  6, '#ffc56b',
  24, '#ff7a1a',
  48, '#e2381b',
  96, '#7d1a0e',
]

// A stable 0–1 number per detection, so each ember flickers at its own rhythm.
function phaseOf(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return (hash >>> 0) / 4294967295
}

function withAge(data: FireDetections): FireDetections {
  const times = data.features.map((feature) => Date.parse(feature.properties.acquiredAt))
  const newest = Math.max(...times)
  return {
    ...data,
    features: data.features.map((feature, index) => ({
      ...feature,
      properties: {
        ...feature.properties,
        ageHours: (newest - times[index]) / 3_600_000,
        phase: phaseOf(feature.properties.id),
      },
    })),
  }
}

// Embers brighten and dim on a sine wave; older embers flicker less, like cooling ash.
function flicker(seconds: number, base: number, swing: number): ExpressionSpecification {
  const freshness: ExpressionSpecification = ['max', 0.25, ['-', 1, ['/', ['get', 'ageHours'], 96]]]
  const wave: ExpressionSpecification = [
    'sin',
    ['+', ['*', ['get', 'phase'], 6.283], ['*', seconds, ['+', 2, ['*', 3, ['get', 'phase']]]]],
  ]
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    4.5, 0,
    6, ['+', base, ['*', swing, freshness, wave]],
  ]
}

function addLayers(map: MapInstance, data: FireDetections) {
  map.addSource(SOURCE, { type: 'geojson', data })
  map.addLayer({
    id: HEAT,
    type: 'heatmap',
    source: SOURCE,
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'frpMw'], 1], 0, 0.15, 10, 0.5, 60, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 6, 1.4, 9, 2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 5, 4, 14, 7, 24, 10, 34],
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0, 'rgba(0,0,0,0)',
        0.1, 'rgba(90,12,0,0.35)',
        0.3, 'rgba(180,30,0,0.65)',
        0.55, 'rgba(255,90,0,0.85)',
        0.8, 'rgba(255,170,60,0.95)',
        1, 'rgba(255,240,205,1)',
      ],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.95, 8, 0.7, 11, 0.2],
    },
  })
  map.addLayer({
    id: GLOW,
    type: 'circle',
    source: SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 5, 3, 9, 12, 13, 40],
      'circle-color': AGE_COLOR,
      'circle-blur': 1,
      'circle-opacity': flicker(0, 0.22, 0.1),
    },
  })
  map.addLayer({
    id: EMBERS,
    type: 'circle',
    source: SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 5, 0.8, 9, 2.5, 13, 7],
      'circle-color': AGE_COLOR,
      'circle-blur': 0.35,
      'circle-opacity': flicker(0, 0.7, 0.3),
    },
  })
}

/** Draw (or update) the fire layer. Returns a cleanup that stops the animation and click handling. */
export function showFire(
  map: MapInstance,
  detections: FireDetections,
  visible: boolean,
  onPick: (id: string) => void,
): () => void {
  const data = withAge(detections)
  const source = map.getSource(SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(data)
  else addLayers(map, data)
  for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  if (!visible) return () => {}

  const click = (event: { features?: { properties?: { id?: string } }[] }) => {
    const id = event.features?.[0]?.properties?.id
    if (id) onPick(id)
  }
  const enter = () => {
    map.getCanvas().style.cursor = 'pointer'
    map.getCanvas().title = 'Satellite heat detection — select to view details'
  }
  const leave = () => {
    map.getCanvas().style.cursor = ''
    map.getCanvas().title = ''
  }
  map.on('click', EMBERS, click)
  map.on('mouseenter', EMBERS, enter)
  map.on('mouseleave', EMBERS, leave)

  // About 15 frames a second is plenty for a flicker and keeps the map smooth.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const start = performance.now()
  const timer = still
    ? 0
    : window.setInterval(() => {
        const seconds = (performance.now() - start) / 1000
        map.setPaintProperty(EMBERS, 'circle-opacity', flicker(seconds, 0.7, 0.3))
        map.setPaintProperty(GLOW, 'circle-opacity', flicker(seconds, 0.22, 0.1))
      }, 66)

  return () => {
    window.clearInterval(timer)
    map.off('click', EMBERS, click)
    map.off('mouseenter', EMBERS, enter)
    map.off('mouseleave', EMBERS, leave)
  }
}
