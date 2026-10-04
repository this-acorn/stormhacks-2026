import * as maplibregl from 'maplibre-gl'
import type { Map as MapInstance, Marker } from 'maplibre-gl'
import type { Coordinates, LayerId } from '../types'
import { formatRange } from './data'
import { hidden } from './geo'
import type { HazardInfo, ScreenPoint } from './types'

// The organizations working on the ground, shown with the Organizations button: UN agencies and
// NGOs by province (UN coordination data), and in the BC wildfire area, local registered charities
// by town.

export interface FieldOrganization {
  name: string
  acronym: string
  type: string
  /** Canadian charities: registration number and website. */
  bn?: string
  url?: string
}
export interface FieldArea {
  layer: LayerId
  country: string
  region: string
  at: Coordinates
  placed: boolean
  orgs: number[]
  sectors: string[]
  from: string
  to: string
  /** Areas from another source than the file's main one. */
  source?: string
  note?: string
  period?: string
}
export interface FieldData {
  builtAt: string
  title: string
  source: string
  note: string
  organizations: FieldOrganization[]
  areas: FieldArea[]
}

export const FIELD_LAYERS = new Set<LayerId>([
  'conflict',
  'domestic_violence',
  'education',
  'flood',
  'storm',
  'wildfire',
  'nature',
])

const FOCUS: Partial<Record<LayerId, string>> = {
  conflict: 'HUMANITARIAN RESPONSE',
  domestic_violence: 'GENDER-BASED VIOLENCE',
  education: 'EDUCATION',
  flood: 'SHELTER, WATER AND RECOVERY',
  storm: 'SHELTER, WATER AND RECOVERY',
  wildfire: 'LOCAL CHARITIES',
  nature: 'CONSERVATION',
}

const GROUPS: [string, string[]][] = [
  ['UN agencies', ['United Nations']],
  ['International NGOs', ['International NGO', 'International Organization']],
  ['National NGOs', ['National NGO', 'Local NGO', 'Civil Society']],
  ['Red Cross / Red Crescent', ['Red Cross / Red Crescent']],
  ['Government', ['Government']],
]

function list(names: string[], limit = 6): string {
  return names.length > limit
    ? `${names.slice(0, limit).join(', ')} +${names.length - limit} more`
    : names.join(', ')
}

function describe(area: FieldArea, data: FieldData): HazardInfo {
  const members = area.orgs.map((index) => data.organizations[index])
  const facts = GROUPS.flatMap(([label, types]) => {
    const names = [
      ...new Set(
        members.filter((org) => types.includes(org.type)).map((org) => org.acronym || org.name),
      ),
    ].sort()
    return names.length ? [{ label, value: list(names) }] : []
  })
  // Types outside the UN groups (such as charity categories) are listed under their own names.
  const others = members.filter((org) => !GROUPS.some(([, types]) => types.includes(org.type)))
  for (const type of [...new Set(others.map((org) => org.type))]) {
    const names = [
      ...new Set(others.filter((org) => org.type === type).map((org) => org.acronym || org.name)),
    ]
    facts.push({ label: type, value: list(names.sort(), 4) })
  }
  const place = area.region ? `${area.region}, ${area.country}` : area.country
  return {
    eyebrow: `ON THE GROUND · ${FOCUS[area.layer] ?? ''}`,
    title: `${members.length} ${members.length === 1 ? 'organization' : 'organizations'} in ${place}`,
    subtitle: area.sectors.join(' · '),
    facts,
    note: area.note ?? (area.placed ? data.note : `${data.note} Shown at the country's centre.`),
    source: `${area.source ?? data.source} · ${area.period ?? formatRange(area.from, area.to)}`,
  }
}

export class FieldOrganizations {
  private map: MapInstance
  private placed: { area: FieldArea; marker: Marker; element: HTMLButtonElement; size: number }[]
  private frame = 0

  constructor(
    map: MapInstance,
    data: FieldData,
    layer: LayerId,
    hover: (info: HazardInfo | null, point?: ScreenPoint) => void,
  ) {
    this.map = map
    this.placed = data.areas
      .filter((area) => area.layer === layer)
      .sort((a, b) => b.orgs.length - a.orgs.length)
      .map((area) => {
        const size = Math.round(16 + Math.min(14, Math.sqrt(area.orgs.length) * 2))
        const element = document.createElement('button')
        element.type = 'button'
        element.className = 'field-area'
        element.style.setProperty('--field-size', `${size}px`)
        element.textContent = String(area.orgs.length)
        element.setAttribute(
          'aria-label',
          `${area.orgs.length} organizations working in ${area.region || area.country}`,
        )
        const show = () => {
          const point = map.project(area.at)
          hover(describe(area, data), { x: point.x, y: point.y })
        }
        element.addEventListener('mouseenter', show)
        element.addEventListener('focus', show)
        element.addEventListener('mouseleave', () => hover(null))
        element.addEventListener('blur', () => hover(null))
        element.addEventListener('click', (event) => {
          event.stopPropagation()
          map.flyTo({ center: area.at, zoom: Math.max(map.getZoom(), 6), duration: 1100, essential: false })
        })
        const marker = new maplibregl.Marker({ element }).setLngLat(area.at).setOpacity('1', '0').addTo(map)
        return { area, marker, element, size }
      })
    this.layout()
    map.on('move', this.schedule)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.map.off('move', this.schedule)
    for (const { marker } of this.placed) marker.remove()
  }

  private schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.layout)
  }

  // The busiest provinces win where markers would overlap; the rest appear as the camera nears.
  private layout = () => {
    this.frame = 0
    const taken: (ScreenPoint & { size: number })[] = []
    for (const { area, element, size } of this.placed) {
      let visible = !hidden(this.map, area.at)
      if (visible) {
        const point = this.map.project(area.at)
        visible = !taken.some(
          (other) => Math.hypot(other.x - point.x, other.y - point.y) < (other.size + size) / 2 + 2,
        )
        if (visible) taken.push({ ...point, size })
      }
      element.hidden = !visible
    }
  }
}
