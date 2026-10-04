import * as maplibregl from 'maplibre-gl'
import type { Map as MapInstance, Marker } from 'maplibre-gl'
import type { Coordinates } from '../types'
import { hidden } from './geo'
import type { Frame } from './canvas'
import type { HazardInfo, ScreenPoint } from './types'

// Small symbols that mark where a disaster is when it is too far away to see its real extent.
// They fade out once the camera is close enough to see the fire, water or storm itself.

export type IconKind = 'fire' | 'flood' | 'storm' | 'conflict'

const GLYPHS: Record<IconKind, string> = {
  flood: '', // Flood is painted on the shared effects canvas, like Wildfire.
  fire: '<path class="fire-outer" d="M13 1c1 5 6 7 6 13a7 7 0 0 1-14 0c0-3 2-6 4-8-.4 3 .2 5 2 6 2-3 3-6 2-11Z" fill="#ff6828"/><path class="fire-core" d="M12 11c.5 3 4 4 4 6a4 4 0 0 1-8 0c0-2 2-4 4-6Z" fill="#ffe4a0"/>',
  storm:
    '<circle cx="12" cy="12" r="2.4"/><path d="M12 4.5a7.5 7.5 0 0 0-7.3 5.8M12 19.5a7.5 7.5 0 0 0 7.3-5.8" fill="none" stroke-width="2.2" stroke-linecap="round"/>',
  conflict:
    '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5" fill="none" stroke-width="1.3"/>',
}

export interface IconSpec {
  at: Coordinates
  kind: IconKind
  label: string
  /** Bigger means more important; important icons win when two would overlap. */
  weight: number
  size: number
  /** A navigation dot, distinct from the geographically scaled disaster effect. */
  locator?: boolean
  fadeStartZoom?: number
  /** Canvas visual, with this button retained for hover, keyboard focus and selection. */
  paint?: (frame: Frame, point: ScreenPoint, opacity: number) => void
  info: () => HazardInfo
  onSelect?: () => void
}

interface Placed {
  spec: IconSpec
  marker: Marker
  element: HTMLButtonElement
}

export class HazardIcons {
  private map: MapInstance
  private placed: Placed[]
  private maxZoom: number
  private frame = 0

  constructor(
    map: MapInstance,
    specs: IconSpec[],
    maxZoom: number,
    hover: (info: HazardInfo | null, point?: ScreenPoint) => void,
  ) {
    this.map = map
    this.maxZoom = maxZoom
    this.placed = [...specs]
      .sort((a, b) => b.weight - a.weight)
      .map((spec) => {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = `hazard-icon hazard-icon-${spec.kind}${spec.locator ? ' hazard-locator' : ''}`
        element.style.setProperty('--icon-size', `${spec.size}px`)
        element.setAttribute('aria-label', spec.label)
        element.innerHTML = spec.paint
          ? ''
          : spec.locator
            ? '<span aria-hidden="true"></span>'
            : `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[spec.kind]}</svg>`
        const show = () => {
          const point = map.project(spec.at)
          hover(spec.info(), { x: point.x, y: point.y })
        }
        element.addEventListener('mouseenter', show)
        element.addEventListener('focus', show)
        element.addEventListener('mouseleave', () => hover(null))
        element.addEventListener('blur', () => hover(null))
        element.addEventListener('click', (event) => {
          event.stopPropagation()
          hover(null)
          spec.onSelect?.()
        })
        const marker = new maplibregl.Marker({ element })
          .setLngLat(spec.at)
          .setOpacity('1', '0')
          .addTo(map)
        return { spec, marker, element }
      })
    this.layout()
    map.on('move', this.schedule)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.map.off('move', this.schedule)
    for (const { marker } of this.placed) marker.remove()
  }

  paint(frame: Frame) {
    // Also update synchronously for reduced-motion redraws, before drawing the shared canvas.
    if (this.frame) {
      cancelAnimationFrame(this.frame)
    }
    this.layout()
    for (const { spec, element } of this.placed) {
      if (element.hidden || !spec.paint) continue
      const opacity = Number(element.style.getPropertyValue('--hazard-opacity') || 1)
      spec.paint(frame, this.map.project(spec.at), opacity)
    }
  }

  private schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.layout)
  }

  // Hide icons once the real extent is visible, and keep the busiest areas readable.
  private layout = () => {
    this.frame = 0
    const zoom = this.map.getZoom()
    const taken: ScreenPoint[] = []
    for (const { spec, element } of this.placed) {
      if (spec.fadeStartZoom !== undefined) {
        const opacity = Math.max(
          0,
          Math.min(1, (this.maxZoom - zoom) / (this.maxZoom - spec.fadeStartZoom)),
        )
        element.style.setProperty('--hazard-opacity', String(opacity))
      }
      let visible = zoom < this.maxZoom && !hidden(this.map, spec.at)
      if (visible) {
        const point = this.map.project(spec.at)
        const room = spec.size * 1.15
        visible = !taken.some(
          (other) => Math.abs(other.x - point.x) < room && Math.abs(other.y - point.y) < room,
        )
        if (visible) taken.push(point)
      }
      element.hidden = !visible
    }
  }
}
