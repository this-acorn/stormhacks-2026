import type { Frame } from './canvas'
import { formatNumber, formatRange, type ConflictArea, type ConflictData } from './data'
import { applyFrame, localFrame, onScreen } from './geo'
import { HazardIcons } from './icons'
import type { HazardInfo, HazardLayer, LayerContext, ScreenPoint } from './types'

// War: recorded conflict events, shown with restraint. A dim glow where events cluster and a slow
// ring around the busiest areas; no explosions. Hovering gives the counts for the area.

const SOURCE = 'conflict-events'
const GLOW = 'conflict-glow'
const DOTS = 'conflict-dots'
const RAD = Math.PI / 180
const METERS_PER_DEGREE = 111_320

function describe(area: ConflictArea, data: ConflictData): HazardInfo {
  const facts = [
    { label: 'Recorded events', value: formatNumber(area.events) },
    { label: 'Reported deaths (best estimate)', value: formatNumber(area.deaths) },
  ]
  if (area.civilians) facts.push({ label: 'Civilians among them', value: formatNumber(area.civilians) })
  if (area.conflicts.length) facts.push({ label: 'Main conflicts', value: area.conflicts.join('; ') })
  return {
    eyebrow: `WAR · ${data.month.toUpperCase()} · PRELIMINARY`,
    title: area.name,
    subtitle: formatRange(area.from, area.to),
    facts,
    note: data.note,
    source: data.source,
  }
}

export function conflictLayer(context: LayerContext, data: ConflictData): HazardLayer {
  const { map, canvas } = context
  map.addSource(SOURCE, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.events.map(([lng, lat, deaths, type, area]) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: { deaths, type, area },
      })),
    },
  })
  map.addLayer({
    id: GLOW,
    type: 'heatmap',
    source: SOURCE,
    paint: {
      'heatmap-weight': ['+', 0.3, ['/', ['ln', ['+', 1, ['get', 'deaths']]], 3]],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 1.2],
      'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 1, 4, 4, 9, 7, 26, 10, 80],
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(0,0,0,0)',
        0.15,
        'rgba(80,10,10,0.35)',
        0.45,
        'rgba(160,30,24,0.6)',
        1,
        'rgba(236,92,70,0.8)',
      ],
      'heatmap-opacity': 0.8,
    },
  })
  map.addLayer({
    id: DOTS,
    type: 'circle',
    source: SOURCE,
    minzoom: 4,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 10, 4],
      'circle-color': '#ff9b8a',
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 5, 0.8],
    },
  })

  // A slow ring around each busy area, sized in kilometres so it scales with the globe.
  const busy = data.areas.filter((area) => area.events >= 20)
  const removePainter = canvas.add(({ ctx, time, width, height, ratio }: Frame) => {
    for (const [index, area] of busy.entries()) {
      const center = map.project(area.center)
      if (!onScreen(center.x, center.y, width, height, 300)) continue
      const frame = localFrame(map, area.center)
      if (!frame) continue
      const radius = 30_000 * Math.sqrt(area.events / 20)
      const phase = (time / 5 + index * 0.31) % 1
      applyFrame(ctx, frame, ratio)
      ctx.lineWidth = 1 / Math.max(frame.scale, 1e-9)
      ctx.strokeStyle = 'rgba(240,128,108,1)'
      ctx.globalAlpha = 0.28 * (1 - phase)
      ctx.beginPath()
      ctx.arc(0, 0, radius * (0.6 + phase * 0.8), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  })

  const icons = new HazardIcons(
    map,
    data.areas
      .filter((area) => area.events >= 6)
      .map((area) => ({
        at: area.center,
        kind: 'conflict' as const,
        label: `${area.name}: ${area.events} recorded conflict events`,
        weight: area.events + area.deaths / 10,
        size: Math.round(12 + Math.min(10, area.events / 8)),
        info: () => describe(area, data),
        onSelect: () => map.flyTo({ center: area.center, zoom: 6.5, duration: 1300, essential: false }),
      })),
    5.5,
    context.hover,
  )

  return {
    summary: { source: data.source, updated: data.month },
    hitTest(point: ScreenPoint) {
      const at = map.unproject([point.x, point.y])
      const frame = localFrame(map, [at.lng, at.lat])
      if (!frame) return null
      const reach = 12 / Math.max(frame.scale, 1e-9)
      let best: { area: number; distance: number } | null = null
      for (const [lng, lat, , , area] of data.events) {
        const east = (lng - at.lng) * METERS_PER_DEGREE * Math.cos(at.lat * RAD)
        const north = (lat - at.lat) * METERS_PER_DEGREE
        const distance = Math.hypot(east, north)
        if (distance < reach && (!best || distance < best.distance)) best = { area, distance }
      }
      const found = best as { area: number } | null
      return found ? describe(data.areas[found.area], data) : null
    },
    destroy() {
      removePainter()
      icons.destroy()
      for (const id of [DOTS, GLOW]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    },
  }
}
