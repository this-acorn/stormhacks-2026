import type { Map as MapInstance } from 'maplibre-gl'

export interface Frame {
  ctx: CanvasRenderingContext2D
  /** Seconds since the page loaded. */
  time: number
  /** Seconds since the previous frame (0 when nothing animates). */
  dt: number
  width: number
  height: number
  ratio: number
  zoom: number
  still: boolean
}
export type Painter = (frame: Frame) => void

/**
 * A transparent canvas between the globe and the map markers. Each active layer adds a painter
 * that runs every animation frame; with reduced motion it draws one frame whenever the map moves.
 */
export class EffectCanvas {
  readonly still: boolean
  private map: MapInstance
  private element: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private painters = new Set<Painter>()
  private observer: ResizeObserver
  private frame = 0
  private last = 0
  private width = 0
  private height = 0
  private ratio = 1

  constructor(map: MapInstance) {
    this.map = map
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.element = document.createElement('canvas')
    this.element.className = 'layer-effects'
    this.element.setAttribute('aria-hidden', 'true')
    const globe = map.getCanvas()
    globe.parentElement!.insertBefore(this.element, globe.nextSibling)
    this.ctx = this.element.getContext('2d')!
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(map.getContainer())
    this.resize()
    map.on('move', this.redraw)
  }

  add(painter: Painter): () => void {
    this.painters.add(painter)
    if (!this.still && !this.frame) {
      this.last = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    }
    this.redraw()
    return () => {
      this.painters.delete(painter)
      if (!this.painters.size) {
        cancelAnimationFrame(this.frame)
        this.frame = 0
      }
      this.draw(performance.now(), 0)
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.observer.disconnect()
    this.map.off('move', this.redraw)
    this.element.remove()
  }

  private tick = (now: number) => {
    this.draw(now, Math.min((now - this.last) / 1000, 0.1))
    this.last = now
    this.frame = requestAnimationFrame(this.tick)
  }

  private redraw = () => {
    if (!this.frame) this.draw(performance.now(), 0)
  }

  private resize() {
    const container = this.map.getContainer()
    this.ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.width = container.clientWidth
    this.height = container.clientHeight
    this.element.width = Math.round(this.width * this.ratio)
    this.element.height = Math.round(this.height * this.ratio)
    this.element.style.width = `${this.width}px`
    this.element.style.height = `${this.height}px`
    this.redraw()
  }

  private draw(now: number, dt: number) {
    const { ctx, ratio } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.element.width, this.element.height)
    const frame: Frame = {
      ctx,
      time: now / 1000,
      dt,
      width: this.width,
      height: this.height,
      ratio,
      zoom: this.map.getZoom(),
      still: this.still,
    }
    for (const painter of this.painters) {
      ctx.save()
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      painter(frame)
      ctx.restore()
    }
  }
}

// Soft shapes drawn once and stamped many times: far cheaper than a gradient per particle.
const sprites = new Map<string, HTMLCanvasElement>()

function sprite(key: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  let canvas = sprites.get(key)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    paint(canvas.getContext('2d')!)
    sprites.set(key, canvas)
  }
  return canvas
}

/** A round soft glow in one colour (`rgb` as "r,g,b"), opaque in the middle. */
export function glowSprite(rgb: string): HTMLCanvasElement {
  return sprite(`glow:${rgb}`, 64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, `rgba(${rgb},1)`)
    gradient.addColorStop(0.35, `rgba(${rgb},0.55)`)
    gradient.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
  })
}

/** A billowing puff: lumpy, darker at its core. Used for smoke and storm clouds. */
export function puffSprite(rgb: string, shade: string): HTMLCanvasElement {
  return sprite(`puff:${rgb}:${shade}`, 96, 96, (ctx) => {
    const lumps: [number, number, number][] = [
      [48, 50, 30],
      [34, 44, 20],
      [62, 42, 22],
      [44, 62, 21],
      [60, 60, 19],
      [50, 34, 18],
    ]
    for (const [x, y, r] of lumps) {
      const gradient = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r)
      gradient.addColorStop(0, `rgba(${rgb},0.9)`)
      gradient.addColorStop(0.6, `rgba(${shade},0.45)`)
      gradient.addColorStop(1, `rgba(${shade},0)`)
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** A single flame tongue, white-yellow at the base fading to orange at the tip. */
export function flameSprite(): HTMLCanvasElement {
  return sprite('flame', 48, 96, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 96, 0, 0)
    gradient.addColorStop(0, 'rgba(255,248,214,1)')
    gradient.addColorStop(0.25, 'rgba(255,196,84,0.95)')
    gradient.addColorStop(0.6, 'rgba(255,104,28,0.7)')
    gradient.addColorStop(1, 'rgba(200,40,10,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(24, 0)
    ctx.bezierCurveTo(31, 24, 46, 48, 44, 70)
    ctx.bezierCurveTo(42, 90, 6, 90, 4, 70)
    ctx.bezierCurveTo(2, 48, 17, 24, 24, 0)
    ctx.fill()
  })
}
