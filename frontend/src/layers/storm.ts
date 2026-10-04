import type { ExpressionSpecification } from 'maplibre-gl'
import { glowSprite, puffSprite, type Frame } from './canvas'
import { formatMoment, formatRange, type Gdacs, type Storm, type WindZone } from './data'
import {
  applyFrame,
  localFrame,
  onScreen,
  polygonsContain,
  seeded,
  segmentDistance,
  toScreen,
  type LocalFrame,
} from './geo'
import type { Coordinates } from '../types'
import type { HazardInfo, HazardLayer, LayerContext, ScreenPoint } from './types'

// Storm: each recent tropical cyclone replays along its recorded track as a layered vortex with
// lightning; up close, debris circles inside the eyewall. The wind zones show where the damage
// reached: the swath GDACS estimated for 60, 90 and 120 km/h winds. Clicking a storm holds it
// still and brings the camera in close enough to see the lightning and debris.

const ZONES = 'storm-zones'
const ZONE_FILL = 'storm-zone-fill'
const ZONE_LINE = 'storm-zone-line'
const TRACK = 'storm-track'
const TRACK_LINE = 'storm-track-line'
const TRACK_POINTS = 'storm-track-points'
const TAU = Math.PI * 2
const LOOP = 28
const PAUSE = 3
const LEVEL_COLOR = { green: '#8ed5a4', orange: '#ffb86b', red: '#ff8585' }
const CATEGORY_NAMES: Record<string, string> = {
  TD: 'Tropical depression',
  TS: 'Tropical storm',
  HU: 'Hurricane / typhoon',
}
const INTENSITY: Record<string, number> = { TD: 0.15, TS: 0.5, HU: 1 }
// On-screen radius, in pixels, at which debris starts to show; it is fully shown 120 pixels on.
const DEBRIS_PX = 230
// How large a clicked storm is brought on screen: lightning and debris in full view.
const FOCUS_PX = DEBRIS_PX + 170
// A held storm travels on once the view leaves it: zoomed out below this radius, or panned away.
const RELEASE_PX = 150

function saffirSimpson(kmh: number): string {
  if (kmh >= 252) return 'Category 5'
  if (kmh >= 209) return 'Category 4'
  if (kmh >= 178) return 'Category 3'
  if (kmh >= 154) return 'Category 2'
  if (kmh >= 119) return 'Category 1'
  if (kmh >= 63) return 'Tropical storm strength'
  return 'Tropical depression strength'
}

interface Moment {
  at: Coordinates
  intensity: number
  category: string
  time: number
  alpha: number
}

interface Bolt {
  east: number
  north: number
  age: number
  life: number
  seed: number
}

interface Debris {
  shape: number
  radius: number
  height: number
  speed: number
  angle: number
  spin: number
  size: number
}

interface Twister {
  storm: Storm
  times: number[]
  maxRadius: number
  offset: number
  bolts: Bolt[]
  debris: Debris[]
  random: () => number
  moment: Moment | null
  frame: LocalFrame | null
  /** The replay position, in seconds, frozen while the camera looks at this storm. */
  hold: number | null
  /** Whether the camera has reached the held storm, so that leaving it lets the storm move on. */
  arrived: boolean
}

// Things a strong storm throws around, drawn as silhouettes in a box from -1 to 1.
const SHAPES: ((ctx: CanvasRenderingContext2D) => void)[] = [
  (ctx) => {
    // chair
    ctx.fillRect(-0.7, -0.05, 1.4, 0.22)
    ctx.fillRect(-0.7, -1, 0.24, 1)
    ctx.fillRect(-0.7, 0.15, 0.2, 0.85)
    ctx.fillRect(0.5, 0.15, 0.2, 0.85)
  },
  (ctx) => {
    // table
    ctx.fillRect(-1, -0.4, 2, 0.24)
    ctx.fillRect(-0.85, -0.16, 0.2, 1)
    ctx.fillRect(0.65, -0.16, 0.2, 1)
  },
  (ctx) => {
    // house
    ctx.beginPath()
    ctx.moveTo(-0.95, -0.05)
    ctx.lineTo(0, -0.95)
    ctx.lineTo(0.95, -0.05)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(-0.7, -0.05, 1.4, 0.95)
  },
  (ctx) => {
    // tree
    ctx.beginPath()
    ctx.arc(0, -0.38, 0.6, 0, TAU)
    ctx.fill()
    ctx.fillRect(-0.12, 0.1, 0.24, 0.9)
  },
  (ctx) => {
    // roof sheet
    ctx.fillRect(-1, -0.2, 2, 0.4)
  },
  (ctx) => {
    // car
    ctx.fillRect(-1, -0.12, 2, 0.48)
    ctx.fillRect(-0.55, -0.5, 1.05, 0.42)
    ctx.beginPath()
    ctx.arc(-0.55, 0.4, 0.22, 0, TAU)
    ctx.arc(0.55, 0.4, 0.22, 0, TAU)
    ctx.fill()
  },
]

function describe(storm: Storm, moment?: Moment | null, zone?: WindZone): HazardInfo {
  const facts = [
    { label: 'Peak wind', value: `${storm.maxWindKmh} km/h · ${saffirSimpson(storm.maxWindKmh)}` },
  ]
  if (moment)
    facts.push({
      label: storm.current ? 'Now' : 'Replay position',
      value: `${formatMoment(moment.time)} · ${CATEGORY_NAMES[moment.category] ?? moment.category}`,
    })
  if (zone) facts.push({ label: 'Wind zone here', value: `${zone.label} or stronger` })
  facts.push({ label: 'Recorded positions', value: `${storm.track.length}, every 6 hours` })
  return {
    eyebrow: storm.current ? 'STORM · ACTIVE' : 'STORM · RECORDED TRACK',
    title: storm.title,
    subtitle: `${storm.countries.join(', ')} · ${formatRange(storm.from, storm.to)}`,
    alert: storm.alert.toLowerCase() as HazardInfo['alert'],
    facts,
    note: 'Shaded zones are where GDACS estimated winds of 60, 90 and 120 km/h along the track.',
    source: `${storm.source} · ${storm.alert} alert`,
  }
}

function momentOf(twister: Twister, seconds: number): Moment {
  const { storm, times } = twister
  const last = storm.track.length - 1
  let progress = 1
  let alpha = 1
  if (!storm.current) {
    const cycle = twister.hold ?? (seconds + twister.offset) % (LOOP + PAUSE)
    progress = Math.min(1, cycle / LOOP)
    if (twister.hold === null)
      alpha = Math.min(1, cycle / 1.2) * Math.min(1, (LOOP + PAUSE - cycle) / 1.5)
  }
  const time = times[0] + progress * (times[last] - times[0])
  let i = 0
  while (i < last - 1 && times[i + 1] < time) i++
  const span = times[i + 1] - times[i] || 1
  const f = Math.max(0, Math.min(1, (time - times[i]) / span))
  const a = storm.track[i]
  const b = storm.track[i + 1] ?? a
  let dlng = b.at[0] - a.at[0]
  if (dlng > 180) dlng -= 360
  if (dlng < -180) dlng += 360
  return {
    at: [a.at[0] + dlng * f, a.at[1] + (b.at[1] - a.at[1]) * f],
    intensity: (INTENSITY[a.category] ?? 0.5) * (1 - f) + (INTENSITY[b.category] ?? 0.5) * f,
    category: f < 0.5 ? a.category : b.category,
    time,
    alpha,
  }
}

/** The vortex's radius in meters; it swells as the storm strengthens. */
function radiusOf(twister: Twister, moment: Moment): number {
  return twister.maxRadius * (0.45 + 0.55 * moment.intensity)
}

export function stormLayer(context: LayerContext, data: Gdacs): HazardLayer {
  const { map, canvas } = context
  const twisters: Twister[] = data.storms.map((storm, index) => {
    const random = seeded(index * 131 + 5)
    const strength = Math.max(0, Math.min(1, (storm.maxWindKmh - 119) / 170))
    return {
      storm,
      times: storm.track.map((point) => Date.parse(point.time)),
      maxRadius: 220_000 + 160_000 * strength,
      offset: index * 7.3,
      bolts: [],
      debris: Array.from({ length: 24 }, (_, k) => ({
        shape: k % SHAPES.length,
        radius: 0.1 + random() * 0.3,
        height: 0.004 + random() * 0.04,
        speed: 0.9 + random() * 1.1,
        angle: random() * TAU,
        spin: (random() - 0.5) * 9,
        size: 0.012 + random() * 0.018,
      })),
      random,
      moment: null,
      frame: null,
      hold: null,
      arrived: false,
    }
  })
  // The painter's latest time, so a click freezes the replay where it was last drawn.
  let clock = 0

  // The storm whose spinning body is under a screen point.
  const vortexAt = (point: ScreenPoint) =>
    twisters.find((twister) => {
      const { frame, moment } = twister
      if (!frame || !moment) return false
      const r = radiusOf(twister, moment) * frame.scale
      return Math.hypot(point.x - frame.x, point.y - frame.y) < Math.max(r * 0.8, 10)
    })

  map.addSource(ZONES, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.storms.flatMap((storm) =>
        storm.zones.map((zone) => ({
          type: 'Feature' as const,
          geometry: { type: 'MultiPolygon' as const, coordinates: zone.polygons },
          properties: { level: zone.level },
        })),
      ),
    },
  })
  map.addSource(TRACK, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.storms.flatMap((storm) => [
        {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: storm.track.map((point) => point.at) },
          properties: {},
        },
        ...storm.track.map((point) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: point.at },
          properties: { category: point.category },
        })),
      ]),
    },
  })
  const levelColor: ExpressionSpecification = [
    'match',
    ['get', 'level'],
    'red',
    LEVEL_COLOR.red,
    'orange',
    LEVEL_COLOR.orange,
    LEVEL_COLOR.green,
  ]
  map.addLayer({
    id: ZONE_FILL,
    type: 'fill',
    source: ZONES,
    paint: {
      'fill-color': levelColor,
      'fill-opacity': ['match', ['get', 'level'], 'red', 0.16, 'orange', 0.11, 0.07],
    },
  })
  map.addLayer({
    id: ZONE_LINE,
    type: 'line',
    source: ZONES,
    paint: { 'line-color': levelColor, 'line-opacity': 0.4, 'line-width': 0.8 },
  })
  map.addLayer({
    id: TRACK_LINE,
    type: 'line',
    source: TRACK,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': '#e9eef5',
      'line-opacity': 0.7,
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1, 6, 2, 10, 3],
      'line-dasharray': [2, 1.5],
    },
  })
  map.addLayer({
    id: TRACK_POINTS,
    type: 'circle',
    source: TRACK,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 3, 10, 4.5],
      'circle-color': ['match', ['get', 'category'], 'HU', '#ff8585', 'TS', '#e9eef5', '#9fb4c8'],
      'circle-opacity': 0.85,
    },
  })

  const cloud = puffSprite('250,252,255', '205,214,226')
  const shade = puffSprite('8,10,14', '4,5,8')
  const core = glowSprite('255,255,255')
  const flash = glowSprite('190,220,255')

  const painter = ({ ctx, dt, time, width, height, ratio }: Frame) => {
    clock = time
    for (const twister of twisters) {
      const moment = momentOf(twister, time)
      twister.moment = moment
      const center = map.project(moment.at)
      const frame = onScreen(center.x, center.y, width, height, 2000)
        ? localFrame(map, moment.at)
        : null
      twister.frame = frame
      const r = radiusOf(twister, moment)
      const px = frame ? r * frame.scale : 0
      if (twister.hold !== null) {
        // A held storm waits for the camera to arrive, then moves on from the same spot once
        // the view leaves it, or once the camera has stopped somewhere else.
        if (px >= RELEASE_PX && onScreen(center.x, center.y, width, height)) twister.arrived = true
        else if (twister.arrived || !map.isMoving()) {
          twister.offset = twister.hold - time
          twister.hold = null
          twister.arrived = false
        }
      }
      if (!frame || px < 1.5) continue
      const spin = moment.at[1] >= 0 ? 1 : -1 // counter-clockwise north of the equator
      const strength = moment.intensity
      const alpha = moment.alpha
      const low = r * 0.02
      const mid = r * 0.05
      const top = r * 0.085

      ctx.globalCompositeOperation = 'source-over'
      applyFrame(ctx, frame, ratio, 0)
      ctx.globalAlpha = 0.32 * alpha
      ctx.drawImage(shade, -r * 1.0, -r * 1.12, r * 2.1, r * 2.1)

      // Rain bands on two levels; inner clouds turn faster than outer ones.
      const arms = 4 + Math.round(strength * 2)
      for (const [layer, lift] of [
        [0, low],
        [1, mid],
      ]) {
        applyFrame(ctx, frame, ratio, lift)
        for (let a = 0; a < arms; a++) {
          for (let k = 0; k < 24; k++) {
            const f = k / 23
            const rho = (0.14 + 0.86 * f) * r * (layer ? 0.9 : 1)
            const theta = spin * time * (0.55 - 0.32 * f) + (a * TAU) / arms - spin * f * 2.7 + layer * 0.4
            const size = (0.09 + 0.2 * f) * r * (0.85 + 0.3 * Math.abs(Math.sin(a * 12.9 + k * 7.1)))
            ctx.globalAlpha = alpha * (0.5 - 0.32 * f) * (0.55 + 0.45 * strength)
            ctx.drawImage(cloud, Math.cos(theta) * rho - size, Math.sin(theta) * rho - size, size * 2, size * 2)
          }
        }
      }

      // The dense core and the eyewall.
      applyFrame(ctx, frame, ratio, mid)
      ctx.globalAlpha = alpha * (0.22 + 0.28 * strength)
      ctx.drawImage(core, -r * 0.55, -r * 0.55, r * 1.1, r * 1.1)
      for (let i = 0; i < 16; i++) {
        const theta = spin * time * 1.5 + (i * TAU) / 16
        const size = r * 0.075
        ctx.globalAlpha = alpha * 0.6 * strength
        ctx.drawImage(cloud, Math.cos(theta) * r * 0.13 - size, Math.sin(theta) * r * 0.13 - size, size * 2, size * 2)
      }

      // High, thin outflow turning the other way, as it does at the top of real cyclones.
      applyFrame(ctx, frame, ratio, top)
      for (let a = 0; a < arms; a++) {
        for (let k = 0; k < 10; k++) {
          const f = k / 9
          const rho = (0.5 + 0.65 * f) * r
          const theta = -spin * time * 0.12 + (a * TAU) / arms + f * 1.4
          const size = r * 0.26
          ctx.globalAlpha = alpha * 0.1 * strength
          ctx.drawImage(cloud, Math.cos(theta) * rho - size, Math.sin(theta) * rho - size, size * 2, size * 2)
        }
      }

      // A clear eye through the upper decks.
      ctx.globalCompositeOperation = 'destination-out'
      for (const lift of [mid, top]) {
        applyFrame(ctx, frame, ratio, lift)
        ctx.globalAlpha = 0.95 * strength
        ctx.drawImage(core, -r * 0.075, -r * 0.075, r * 0.15, r * 0.15)
      }

      // Lightning in the bands.
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.globalCompositeOperation = 'lighter'
      if (dt > 0 && px > 22 && twister.random() < dt * (0.6 + 2.6 * strength)) {
        const rho = (0.22 + twister.random() * 0.6) * r
        const theta = twister.random() * TAU
        twister.bolts.push({
          east: Math.cos(theta) * rho,
          north: Math.sin(theta) * rho,
          age: 0,
          life: 0.18 + twister.random() * 0.14,
          seed: twister.random() * 1000,
        })
      }
      for (const bolt of twister.bolts) bolt.age += dt
      twister.bolts = twister.bolts.filter((bolt) => bolt.age < bolt.life)
      for (const bolt of twister.bolts) {
        const fade = (1 - bolt.age / bolt.life) * alpha
        const [gx, gy] = toScreen(frame, bolt.east, bolt.north, 0)
        const [cx, cy] = toScreen(frame, bolt.east, bolt.north, mid * 1.15)
        const glow = Math.max(6, r * 0.2 * frame.scale)
        ctx.globalAlpha = 0.65 * fade
        ctx.drawImage(flash, cx - glow, cy - glow, glow * 2, glow * 2)
        const length = Math.hypot(gx - cx, gy - cy)
        if (length < 6) continue
        const random = seeded(Math.floor(bolt.seed))
        const nx = -(gy - cy) / length
        const ny = (gx - cx) / length
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        for (let s = 1; s < 8; s++) {
          const jitter = (random() - 0.5) * length * 0.16
          ctx.lineTo(cx + ((gx - cx) * s) / 8 + nx * jitter, cy + ((gy - cy) * s) / 8 + ny * jitter)
        }
        ctx.lineTo(gx, gy)
        ctx.strokeStyle = `rgba(150,195,255,${0.35 * fade})`
        ctx.lineWidth = 4.5
        ctx.stroke()
        ctx.strokeStyle = `rgba(240,248,255,${0.95 * fade})`
        ctx.lineWidth = 1.4
        ctx.stroke()
      }

      // Debris circling in the strongest winds, once the storm fills the view.
      if (px >= DEBRIS_PX && strength > 0.6) {
        ctx.globalCompositeOperation = 'source-over'
        const reveal = Math.min(1, (px - DEBRIS_PX) / 120) * alpha
        // A pale rim keeps dark debris visible over dark sea as well as bright cloud.
        ctx.shadowColor = 'rgba(232,238,246,0.85)'
        ctx.shadowBlur = 3 * ratio
        for (const item of twister.debris) {
          item.angle += spin * item.speed * dt
          const rho = item.radius * r
          const [x, y] = toScreen(frame, Math.cos(item.angle) * rho, Math.sin(item.angle) * rho, item.height * r)
          if (!onScreen(x, y, width, height, 40)) continue
          const size = item.size * px
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
          ctx.translate(x, y)
          ctx.rotate(time * item.spin)
          ctx.scale(size, size)
          ctx.globalAlpha = 0.92 * reveal
          ctx.fillStyle = '#1c222a'
          SHAPES[item.shape](ctx)
        }
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    ctx.globalAlpha = 1
  }
  const removePainter = canvas.add(painter)

  return {
    summary: { source: data.source.split(' — ')[0], updated: `Updated ${formatRange(data.builtAt, data.builtAt)}` },
    hitTest(point: ScreenPoint) {
      const twister = vortexAt(point)
      if (twister?.frame && twister.moment) {
        const info = describe(twister.storm, twister.moment)
        if (radiusOf(twister, twister.moment) * twister.frame.scale < FOCUS_PX * 0.75)
          info.source += ' · Click to zoom in'
        return info
      }
      for (const { storm } of twisters) {
        const screen = storm.track.map((entry) => map.project(entry.at))
        for (let i = 1; i < screen.length; i++) {
          const a = screen[i - 1]
          const b = screen[i]
          if (segmentDistance(point.x, point.y, a.x, a.y, b.x, b.y) < 6) return describe(storm)
        }
      }
      const at = map.unproject([point.x, point.y])
      for (const { storm } of twisters) {
        const zone = ['red', 'orange', 'green']
          .map((level) => storm.zones.find((entry) => entry.level === level))
          .find((entry) => entry && polygonsContain(entry.polygons, [at.lng, at.lat]))
        if (zone) return describe(storm, null, zone)
      }
      return null
    },
    focus(point: ScreenPoint) {
      const twister = vortexAt(point)
      if (!twister?.frame || !twister.moment) return null
      twister.hold ??= (clock + twister.offset) % (LOOP + PAUSE)
      twister.arrived = false
      const px = radiusOf(twister, twister.moment) * twister.frame.scale
      return { center: twister.moment.at, zoom: map.getZoom() + Math.log2(FOCUS_PX / px) }
    },
    destroy() {
      removePainter()
      for (const id of [TRACK_POINTS, TRACK_LINE, ZONE_LINE, ZONE_FILL]) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of [TRACK, ZONES]) if (map.getSource(id)) map.removeSource(id)
    },
  }
}
