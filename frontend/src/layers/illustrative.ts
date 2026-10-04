import { inLayer } from '../exploreLayers'
import type { LayerId } from '../types'
import { glowSprite, type Frame } from './canvas'
import { applyFrame, localFrame, onScreen, seeded } from './geo'
import type { HazardInfo, HazardLayer, LayerContext, ScreenPoint } from './types'

// Nature and Education do not have a data layer yet. Until they do, a gentle effect marks the
// areas the sample organizations serve, sized in kilometres so it scales with the globe.

const RADIUS = 45_000

export function illustrativeLayer(context: LayerContext, layer: LayerId): HazardLayer {
  const { map, canvas } = context
  const organizations = context.organizations.filter((organization) => inLayer(organization, layer))
  const nature = layer === 'nature'
  const glow = glowSprite(nature ? '90,210,120' : '255,200,90')
  const spark = glowSprite(nature ? '200,255,160' : '255,236,170')
  const random = seeded(3)
  const motes = Array.from({ length: 22 }, () => ({
    angle: random() * Math.PI * 2,
    distance: 0.15 + random() * 0.85,
    speed: 0.15 + random() * 0.35,
    blink: random() * Math.PI * 2,
  }))

  const removePainter = canvas.add(({ ctx, time, width, height, ratio }: Frame) => {
    for (const organization of organizations) {
      const center = map.project(organization.coordinates)
      if (!onScreen(center.x, center.y, width, height, 300)) continue
      const frame = localFrame(map, organization.coordinates)
      if (!frame) continue
      ctx.globalCompositeOperation = 'lighter'
      applyFrame(ctx, frame, ratio)
      ctx.globalAlpha = 0.3
      ctx.drawImage(glow, -RADIUS, -RADIUS, RADIUS * 2, RADIUS * 2)
      if (nature) {
        // Fireflies drifting over restored land.
        for (const mote of motes) {
          const angle = mote.angle + time * mote.speed
          const x = Math.cos(angle) * mote.distance * RADIUS
          const y = Math.sin(angle * 1.3) * mote.distance * RADIUS * 0.7
          const size = RADIUS * 0.06
          ctx.globalAlpha = 0.9 * (0.5 + 0.5 * Math.sin(time * 2.4 + mote.blink))
          ctx.drawImage(spark, x - size, y - size, size * 2, size * 2)
        }
      } else {
        // Lamplight: a soft column rising from where children are learning.
        const steps = 14
        for (let i = 0; i < steps; i++) {
          const f = i / (steps - 1)
          applyFrame(ctx, frame, ratio, f * RADIUS * 1.6)
          const size = RADIUS * (0.32 - f * 0.18)
          ctx.globalAlpha = (0.32 - f * 0.28) * (0.85 + 0.15 * Math.sin(time * 1.5))
          ctx.drawImage(spark, -size, -size, size * 2, size * 2)
        }
      }
    }
    ctx.globalAlpha = 1
  })

  return {
    summary: { source: 'Illustrative · data layer in design' },
    hitTest(point: ScreenPoint) {
      const organization = organizations.find((entry) => {
        const frame = localFrame(map, entry.coordinates)
        return frame && Math.hypot(point.x - frame.x, point.y - frame.y) < Math.max(10, RADIUS * frame.scale)
      })
      if (!organization) return null
      const need = organization.requests.find((request) => request.status === 'published')
      const info: HazardInfo = {
        eyebrow: `${nature ? 'NATURE' : 'EDUCATION'} · ILLUSTRATIVE`,
        title: organization.name,
        subtitle: organization.location,
        facts: need ? [{ label: 'Current need', value: need.item }] : [],
        note: 'An illustrative effect around a sample organization. The data layer for this category is still being designed.',
        source: organization.sample ? 'AidAtlas sample organization' : 'AidAtlas organization',
      }
      return info
    },
    destroy() {
      removePainter()
    },
  }
}
