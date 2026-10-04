import { glowSprite } from './canvas'

/** The original Flood effect: three spreading elliptical ripples over a soft blue glow. */
export function paintFloodRipples(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
  opacity: number,
) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const radius = size * 0.8
  ctx.globalAlpha = opacity * 0.27
  ctx.drawImage(glowSprite('40,140,255'), x - radius, y - radius, radius * 2, radius * 2)
  for (let i = 0; i < 3; i++) {
    const phase = (time * 0.45 + i / 3) % 1
    ctx.globalAlpha = opacity * (1 - phase) * 0.8
    ctx.strokeStyle = 'rgb(140,215,255)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(x, y, size * phase, size * phase * 0.55, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}
