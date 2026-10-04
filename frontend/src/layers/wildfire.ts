import type { Feature, Polygon as GeoPolygon } from 'geojson'
import type { Coordinates } from '../types'
import { glowSprite, type Frame } from './canvas'
import { formatNumber, formatMoment, type FireCluster, type FireData } from './data'
import { paintFire, paintOverviewFire } from './fireParticles'
import { fireFootprint } from './footprints'
import { applyFrame, distanceKm, hidden, localFrame, onScreen } from './geo'
import { HazardIcons } from './icons'
import type { HazardInfo, HazardLayer, LayerContext, ScreenPoint } from './types'

const SOURCE = 'wildfire-footprints'
const HISTORY = 'wildfire-observed-area'
const HEAT = 'wildfire-active-area'

interface HeatPoint {
  at: Coordinates
  frp: number
}
interface Fire {
  data: FireData
  cluster: FireCluster
  points: HeatPoint[]
  burning: HeatPoint[]
}

function describe(data: FireData, cluster: FireCluster): HazardInfo {
  const place = cluster.place
    ? `${cluster.place.startsWith('near') ? ' ' : ' in '}${cluster.place}`
    : ''
  const spread = distanceKm([cluster.bbox[0], cluster.bbox[1]], [cluster.bbox[2], cluster.bbox[3]])
  return {
    eyebrow: data.playback
      ? 'WILDFIRE · HISTORICAL OBSERVATIONS'
      : 'WILDFIRE · SATELLITE OBSERVATIONS',
    title: `Fire activity${place}`,
    subtitle: `Last observed ${formatMoment(cluster.last)}`,
    facts: [
      { label: 'Heat detections', value: formatNumber(cluster.count) },
      { label: 'Observed across', value: `about ${formatNumber(spread)} km` },
      { label: 'Footprint', value: 'Nominal 375 m VIIRS pixels' },
      { label: 'Smoke', value: 'ECCC forecast · North America' },
    ],
    note: `${data.note} Hot pixels do not establish a fire perimeter. Flame height is stylized. Regional smoke coverage uses the ECCC atmospheric forecast, not confirmed damage.`,
    source: data.source,
  }
}

export function wildfireLayer(context: LayerContext, datasets: FireData[]): HazardLayer {
  const { map, canvas } = context
  const fires: Fire[] = []
  const features: Feature<GeoPolygon>[] = []
  for (const data of datasets) {
    const first = fires.length
    const span = Math.max(0, (Date.parse(data.end) - Date.parse(data.start)) / 60_000)
    for (const cluster of data.clusters) {
      fires.push({
        data,
        cluster,
        points: [],
        burning: [],
      })
    }
    for (const [lng, lat, minutes, frp, index] of data.detections) {
      const fire = fires[first + index]
      if (!fire) continue
      const at: Coordinates = [lng, lat]
      const active = minutes >= span - 24 * 60
      const point = { at, frp }
      fire.points.push(point)
      if (active) fire.burning.push(point)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: fireFootprint(at) },
        properties: { active, frp },
      })
    }
  }
  for (const fire of fires) {
    // Keep a geographically distributed sample instead of stacking the brightest passes.
    const cells = new Map<string, HeatPoint>()
    for (const point of fire.burning) {
      const key = `${Math.round(point.at[0] * 500)},${Math.round(point.at[1] * 500)}`
      if ((cells.get(key)?.frp ?? -1) < point.frp) cells.set(key, point)
    }
    const points = [...cells.values()]
    const stride = Math.max(1, Math.ceil(points.length / 180))
    fire.burning = points.filter((_, i) => i % stride === 0)
  }

  map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } })
  map.addLayer({
    id: HISTORY,
    type: 'fill',
    source: SOURCE,
    filter: ['==', ['get', 'active'], false],
    paint: { 'fill-color': '#523022', 'fill-opacity': 0.42, 'fill-antialias': false },
  })
  map.addLayer({
    id: HEAT,
    type: 'fill',
    source: SOURCE,
    filter: ['==', ['get', 'active'], true],
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['get', 'frp'],
        0,
        '#b53b13',
        30,
        '#fa7024',
        180,
        '#ffcb6e',
      ],
      'fill-opacity': 0.85,
      'fill-antialias': false,
    },
  })

  const glow = glowSprite('255,151,45')
  let clock = 0
  // Recognizable fire symbols from orbit; the actual footprint takes over up close.
  const icons = new HazardIcons(
    map,
    [...fires]
      .sort((a, b) => b.cluster.frpTotal - a.cluster.frpTotal)
      .slice(0, 250)
      .map(({ data, cluster }, index) => ({
        at: cluster.center,
        kind: 'fire' as const,
        fadeStartZoom: 5.5,
        label: `Zoom to ${describe(data, cluster).title}, ${data.playback ? 'historical' : 'recorded'} observations`,
        weight: cluster.frpTotal,
        size: 30 + Math.min(12, Math.log10(Math.max(10, cluster.frpTotal)) * 2),
        paint: ({ ctx, width, height }: Frame, point: ScreenPoint, opacity: number) => {
          if (!onScreen(point.x, point.y, width, height, 80)) return
          const size =
            (30 + Math.min(12, Math.log10(Math.max(10, cluster.frpTotal)) * 2)) *
            (0.8 + Math.max(0, Math.min(map.getZoom(), 6)) * 0.07)
          paintOverviewFire(ctx, point.x, point.y, size, clock, index, opacity)
        },
        info: () => describe(data, cluster),
        onSelect: () =>
          map.fitBounds(
            [
              [cluster.bbox[0], cluster.bbox[1]],
              [cluster.bbox[2], cluster.bbox[3]],
            ],
            { padding: 130, maxZoom: 11, duration: 1300, essential: false },
          ),
      })),
    7,
    context.hover,
  )

  const removePainter = canvas.add((view: Frame) => {
    const { ctx, dt, width, height, ratio } = view
    clock += dt
    const bounds = map.getBounds()
    const westView = bounds.getWest()
    const eastView = bounds.getEast()
    const viewCenter = (westView + eastView) / 2
    let flamesDrawn = 0
    // Everything below is measured in meters, then projected. No minimum pixel sizes.
    for (const fire of fires) {
      if (view.zoom < 5) break
      const [west, south, east, north] = fire.cluster.bbox
      // Cull offscreen clusters before projecting thousands of individual world coordinates.
      if (north < bounds.getSouth() - 0.4 || south > bounds.getNorth() + 0.4) continue
      const wrap = Math.round((viewCenter - (west + east) / 2) / 360) * 360
      const margin = 0.4 / Math.max(0.05, Math.cos((fire.cluster.center[1] * Math.PI) / 180))
      if (east + wrap < westView - margin || west + wrap > eastView + margin) continue
      if (hidden(map, fire.cluster.center)) continue
      const center = localFrame(map, fire.cluster.center)
      if (!center) continue
      const reach = (distanceKm([west, south], [east, north]) * 1000 + 20_000) * center.scale
      if (!onScreen(center.x, center.y, width, height, reach)) continue
      for (const [index, point] of fire.burning.entries()) {
        if (flamesDrawn >= 400) break
        const screen = map.project(point.at)
        if (!onScreen(screen.x, screen.y, width, height, 100)) continue
        const frame = localFrame(map, point.at)
        if (!frame || frame.scale * 375 < 2) continue
        // The ground glow is clipped to its own satellite pixel, never a cluster's bbox.
        ctx.save()
        applyFrame(ctx, frame, ratio)
        ctx.beginPath()
        ctx.rect(-187.5, -187.5, 375, 375)
        ctx.clip()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.7
        ctx.drawImage(glow, -180, -180, 360, 360)
        ctx.restore()
        const meters = Math.min(550, 140 + Math.sqrt(point.frp) * 14)
        paintFire(ctx, frame, 250, meters, clock, index)
        flamesDrawn++
      }
    }
    icons.paint(view)
  })

  return {
    summary: {
      source: 'NASA FIRMS · Near real time',
      updated: datasets
        .map((data) =>
          data.detections.length
            ? `Past 24 h · Last observed ${formatMoment(data.end)}`
            : 'No detections in the past 24 h',
        )
        .join(' + '),
    },
    hitTest(point: ScreenPoint) {
      const at = map.unproject([point.x, point.y])
      for (const fire of fires) {
        if (hidden(map, fire.cluster.center)) continue
        const [west, south, east, north] = fire.cluster.bbox
        if (
          at.lng < west - 0.03 ||
          at.lng > east + 0.03 ||
          at.lat < south - 0.03 ||
          at.lat > north + 0.03
        )
          continue
        for (const observation of fire.points) {
          const p = map.project(observation.at)
          if (Math.hypot(p.x - point.x, p.y - point.y) < 9) return describe(fire.data, fire.cluster)
        }
      }
      return null
    },
    destroy() {
      removePainter()
      icons.destroy()
      for (const id of [HEAT, HISTORY]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    },
  }
}
