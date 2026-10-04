import { glowSprite } from './canvas'
import { seeded, toScreen, type LocalFrame } from './geo'

// The original fire's layered light and rising embers, with repeatable, time-based motion.
// East/north/up coordinates keep the close-up fire attached to the surface as the camera moves.
const particles = Array.from({ length: 46 }, (_, index) => {
  const random = seeded(index * 977 + 31)
  return {
    phase: random(),
    east: (random() - 0.5) * 0.55,
    north: (random() - 0.5) * 0.4,
    radius: 0.08 + random() * 0.1,
    speed: 0.45 + random() * 0.35,
    sway: random() * Math.PI * 2,
  }
}).sort((a, b) => b.north - a.north)

export function paintFire(
  ctx: CanvasRenderingContext2D,
  frame: LocalFrame,
  width: number,
  height: number,
  time: number,
  seed: number,
  opacity = 1,
) {
  const colors = ['210,45,20', '255,140,40', '255,236,170']
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const [index, p] of particles.entries()) {
    const age = (time * p.speed + p.phase + ((seed * 0.137) % 1)) % 1
    const heat = 1 - age
    const sway = Math.sin(time * 3 + p.sway + age * 5) * 0.07 * age
    const [x, y] = toScreen(
      frame,
      (p.east * (1 - age * 0.65) + sway) * width,
      p.north * width * (1 - age * 0.4),
      age * height,
    )
    const radius = p.radius * width * (0.4 + heat) * frame.scale
    const color = heat > 0.66 ? colors[2] : heat > 0.33 ? colors[1] : colors[0]
    ctx.globalAlpha = opacity * Math.min(1, age * 12) * heat * 0.85
    ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2)

    // A few sharp sparks escape the soft flame; no opaque flame silhouette.
    if (index % 8 === 0) {
      const [sparkX, sparkY] = toScreen(
        frame,
        (p.east + sway * 2) * width,
        p.north * width,
        age * height * 1.65,
      )
      const sparkRadius = width * 0.018 * frame.scale
      ctx.globalAlpha = opacity * Math.sin(Math.PI * age) * 0.75
      ctx.drawImage(
        glowSprite(colors[2]),
        sparkX - sparkRadius,
        sparkY - sparkRadius,
        sparkRadius * 2,
        sparkRadius * 2,
      )
    }
  }
  ctx.restore()
}

/** Exaggerated overview effect for finding fires from space; never a geographic perimeter. */
export function paintOverviewFire(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
  seed: number,
  opacity: number,
) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = opacity * (0.35 + 0.08 * Math.sin(time * 7 + seed))
  const radius = size * 0.9
  ctx.drawImage(glowSprite('255,90,20'), x - radius, y - radius, radius * 2, radius * 2)
  ctx.globalAlpha = opacity * 0.55
  const core = size * 0.38
  ctx.drawImage(glowSprite('255,210,120'), x - core, y - size * 0.12 - core, core * 2, core * 2)
  ctx.restore()
  paintFire(
    ctx,
    { x, y, ex: 1, ey: 0, nx: 0, ny: -0.38, ux: 0, uy: -1, scale: 1 },
    size,
    size * 1.05,
    time,
    seed,
    opacity,
  )
}
