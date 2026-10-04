import type { Map as MapInstance } from 'maplibre-gl'
import type { Coordinates } from './types'

// Animated effects drawn on a transparent canvas above the globe, one around each organization
// of the selected layer: rising flames, flood ripples, a turning storm, drifting fireflies, and so on.
// They are illustrations of the category, not data: real observations are drawn by the map layers.

export interface EffectTheme {
  effect: 'fire' | 'flood' | 'storm' | 'nature' | 'conflict' | 'education' | 'care'
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
}

const TAU = Math.PI * 2

function angularDistance(a: Coordinates, b: Coordinates): number {
  const toRad = Math.PI / 180
  const [lon1, lat1] = [a[0] * toRad, a[1] * toRad]
  const [lon2, lat2] = [b[0] * toRad, b[1] * toRad]
  const cos =
    Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return Math.acos(Math.min(1, Math.max(-1, cos))) / toRad
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = alpha
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.fill()
}

export class LayerEffects {
  private map: MapInstance
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private frame = 0
  private particles = new Map<number, Particle[]>()
  private points: Coordinates[] = []
  private theme: EffectTheme | null = null
  private observer: ResizeObserver
  private still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(map: MapInstance, parent: HTMLElement) {
    this.map = map
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'layer-effects'
    this.canvas.setAttribute('aria-hidden', 'true')
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(parent)
    this.resize()
    this.map.on('move', this.redrawWhenStill)
  }

  set(theme: EffectTheme | null, points: Coordinates[]) {
    this.theme = theme
    this.points = points
    this.particles.clear()
    cancelAnimationFrame(this.frame)
    if (theme && !this.still) this.frame = requestAnimationFrame(this.tick)
    else this.draw(0)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.map.off('move', this.redrawWhenStill)
    this.canvas.remove()
  }

  private redrawWhenStill = () => {
    if (this.still) this.draw(0)
  }

  private resize() {
    const ratio = window.devicePixelRatio || 1
    const { clientWidth, clientHeight } = this.canvas.parentElement!
    this.canvas.width = clientWidth * ratio
    this.canvas.height = clientHeight * ratio
    this.canvas.style.width = `${clientWidth}px`
    this.canvas.style.height = `${clientHeight}px`
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    this.draw(performance.now() / 1000)
  }

  private tick = (now: number) => {
    this.draw(now / 1000)
    this.frame = requestAnimationFrame(this.tick)
  }

  private draw(t: number) {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!this.theme) return
    const center = this.map.getCenter()
    const zoom = this.map.getZoom()
    const size = Math.min(150, 26 * Math.pow(1.32, zoom))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    this.points.forEach((point, index) => {
      // Skip organizations on the far side of the globe.
      if (angularDistance(point, [center.lng, center.lat]) > 82) return
      const { x, y } = this.map.project(point)
      const seed = index * 1.7
      switch (this.theme!.effect) {
        case 'fire':
          return this.fire(index, x, y, size, t)
        case 'flood':
          return this.flood(x, y, size, t + seed)
        case 'storm':
          return this.storm(x, y, size, t + seed)
        case 'nature':
          return this.nature(index, x, y, size, t)
        case 'conflict':
          return this.conflict(x, y, size, t + seed)
        case 'education':
          return this.education(x, y, size, t + seed)
        case 'care':
          return this.care(x, y, size, t + seed)
      }
    })
    ctx.restore()
  }

  private spawn(index: number, count: number, make: () => Particle): Particle[] {
    let list = this.particles.get(index)
    if (!list) this.particles.set(index, (list = []))
    while (list.length < count) list.push(make())
    return list
  }

  // Flames: embers rise, shrink and cool from white-yellow to deep red above a hot glow.
  private fire(index: number, x: number, y: number, s: number, t: number) {
    const ctx = this.ctx
    glow(ctx, x, y, s * 0.9, 'rgba(255,90,20,0.9)', 0.35 + 0.08 * Math.sin(t * 7 + index))
    glow(ctx, x, y - s * 0.12, s * 0.38, 'rgba(255,210,120,1)', 0.55)
    const embers = this.spawn(index, 46, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: Math.random(), max: 1, size: 0,
    }))
    for (const p of embers) {
      p.life += 0.012 + Math.random() * 0.006
      if (p.life >= 1) {
        p.life = 0
        p.x = (Math.random() - 0.5) * s * 0.45
        p.y = (Math.random() - 0.3) * s * 0.15
        p.vx = (Math.random() - 0.5) * 0.25
        p.size = (0.08 + Math.random() * 0.1) * s
      }
      p.x += p.vx + Math.sin(t * 3 + p.y * 0.05) * 0.25
      p.y -= s * 0.012
      const heat = 1 - p.life
      const color = heat > 0.66 ? '255,236,170' : heat > 0.33 ? '255,140,40' : '210,45,20'
      glow(ctx, x + p.x, y + p.y, p.size * (0.4 + heat), `rgba(${color},1)`, heat * 0.85)
    }
  }

  // Flood: ripples spread out over a cool pool of water.
  private flood(x: number, y: number, s: number, t: number) {
    const ctx = this.ctx
    glow(ctx, x, y, s * 0.8, 'rgba(40,140,255,0.9)', 0.3)
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.45 + i / 3) % 1
      ctx.globalAlpha = (1 - phase) * 0.8
      ctx.strokeStyle = 'rgba(140,215,255,1)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.ellipse(x, y, s * phase, s * phase * 0.55, 0, 0, TAU)
      ctx.stroke()
    }
  }

  // Storm: spiral bands turning around a calm eye.
  private storm(x: number, y: number, s: number, t: number) {
    const ctx = this.ctx
    glow(ctx, x, y, s * 0.85, 'rgba(200,215,235,0.8)', 0.18)
    ctx.lineCap = 'round'
    for (let arm = 0; arm < 4; arm++) {
      ctx.beginPath()
      for (let k = 0; k <= 40; k++) {
        const f = k / 40
        const angle = t * 1.6 + arm * (TAU / 4) + f * 4.2
        const r = s * (0.12 + f * 0.75)
        const px = x + Math.cos(angle) * r
        const py = y + Math.sin(angle) * r * 0.85
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.globalAlpha = 0.45
      ctx.strokeStyle = 'rgba(235,242,250,1)'
      ctx.lineWidth = Math.max(1, s * 0.035)
      ctx.stroke()
    }
    glow(ctx, x, y, s * 0.12, 'rgba(255,255,255,1)', 0.6)
  }

  // Nature: fireflies drifting in slow loops over a green glow.
  private nature(index: number, x: number, y: number, s: number, t: number) {
    const ctx = this.ctx
    glow(ctx, x, y, s * 0.8, 'rgba(60,200,100,0.9)', 0.22)
    const flies = this.spawn(index, 18, () => ({
      x: Math.random() * TAU, y: 0.2 + Math.random() * 0.75, vx: 0.3 + Math.random() * 0.6,
      vy: Math.random() * TAU, life: 0, max: 1, size: 0,
    }))
    for (const f of flies) {
      const angle = f.x + t * f.vx * 0.5
      const r = s * f.y
      const px = x + Math.cos(angle) * r
      const py = y + Math.sin(angle * 1.3) * r * 0.6
      const blink = 0.5 + 0.5 * Math.sin(t * 2.5 + f.vy)
      glow(ctx, px, py, s * 0.07, 'rgba(190,255,150,1)', blink * 0.9)
    }
  }

  // War: restrained. A slow dim pulse and a fine ring, never explosions.
  private conflict(x: number, y: number, s: number, t: number) {
    const ctx = this.ctx
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.2)
    glow(ctx, x, y, s * (0.55 + pulse * 0.25), 'rgba(200,60,45,0.9)', 0.25 + pulse * 0.15)
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = 'rgba(240,150,135,1)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    ctx.arc(x, y, s * 0.6, t * 0.2, t * 0.2 + TAU)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Education: a warm beam of light rising, with a soft glow at its base.
  private education(x: number, y: number, s: number, t: number) {
    const ctx = this.ctx
    const height = s * 1.6
    const beam = ctx.createLinearGradient(x, y, x, y - height)
    beam.addColorStop(0, 'rgba(255,205,90,0.75)')
    beam.addColorStop(1, 'rgba(255,205,90,0)')
    ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t * 1.5)
    ctx.fillStyle = beam
    ctx.beginPath()
    ctx.moveTo(x - s * 0.06, y)
    ctx.lineTo(x - s * 0.22, y - height)
    ctx.lineTo(x + s * 0.22, y - height)
    ctx.lineTo(x + s * 0.06, y)
    ctx.closePath()
    ctx.fill()
    glow(ctx, x, y, s * 0.45, 'rgba(255,200,90,1)', 0.45)
  }

  // Domestic violence support: a gentle double heartbeat of violet light.
  private care(x: number, y: number, s: number, t: number) {
    const ctx = this.ctx
    const beat = (t * 0.9) % 1
    const strength = Math.max(Math.exp(-((beat - 0.1) ** 2) / 0.003), 0.7 * Math.exp(-((beat - 0.28) ** 2) / 0.003))
    glow(ctx, x, y, s * (0.5 + strength * 0.25), 'rgba(175,120,255,0.95)', 0.2 + strength * 0.35)
  }
}
