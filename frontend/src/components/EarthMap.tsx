import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapInstance, MapMouseEvent, Marker } from 'maplibre-gl'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Crosshair, Minus, Plus, RotateCcw } from 'lucide-react'
import '../explore-layers.css'
import { DEFAULT_HORIZON, inLayer, layerPitch, LAYER_THEMES } from '../exploreLayers'
import { createHazardLayer, EffectCanvas, type HazardInfo, type HazardLayer } from '../layers'
import { loadData } from '../layers/data'
import { FIELD_LAYERS, FieldOrganizations, type FieldData } from '../layers/fieldOrganizations'
import { hidden } from '../layers/geo'
import {
  formatDate,
  globeOverview as overview,
  globePadding,
  INITIAL_VIEW,
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  SATELLITE_TILES,
} from '../mapConfig'
import type {
  Contribution,
  Coordinates,
  FireDetection,
  FireDetections,
  LayerId,
  Observation,
  Organization,
} from '../types'
import ContributionOrbit from './ContributionOrbit'
import type { StarOrigin } from '../cosmosEntry'
import HazardTooltip from './HazardTooltip'
import type { LayerStatus } from './LayerBanner'
import NatureTimeline from './NatureTimeline'
import EducationExplorer from './EducationExplorer'
import ViolenceExplorer from './ViolenceExplorer'
import type { ViolenceStatus } from '../violenceData'
import type { EducationStatus } from '../educationData'
import {
  LATEST_NATURE_YEAR,
  NATURE_YEARS,
  type ImageryStatus,
  type NaturePeriod,
} from '../natureImagery'

// MapLibre 6 ships an external worker. Let Vite bundle and serve it locally.
maplibregl.setWorkerUrl(mapWorkerUrl)

function openRequests(organization: Organization) {
  return organization.requests.filter(
    (request) => request.status === 'published' && request.fulfilled < request.quantity,
  )
}

// How pressing an organization's needs are; the beacon and the card's dot take its colour,
// matching the Urgent / Standard tags in the organization panel.
// urgent: an urgent request is open · standard: requests are open · none: nothing is open.
type Urgency = 'urgent' | 'standard' | 'none'
const URGENCY_ALERT: Record<Urgency, HazardInfo['alert']> = {
  urgent: 'red',
  standard: 'green',
  none: undefined,
}

function urgencyOf(organization: Organization): Urgency {
  const open = openRequests(organization)
  if (open.some((request) => request.urgency === 'urgent')) return 'urgent'
  return open.length ? 'standard' : 'none'
}

// The hover card for an organization pin, in the same shape as a disaster's.
function organizationCard(organization: Organization): HazardInfo {
  const open = openRequests(organization)
  const urgent = open.filter((request) => request.urgency === 'urgent').length
  const top = open.find((request) => request.urgency === 'urgent') ?? open[0]
  const facts = [
    {
      label: 'Open requests',
      value: urgent ? `${open.length} · ${urgent} urgent` : String(open.length),
    },
  ]
  const marked = open.find((request) => request.urgency === 'urgent')
  if (marked)
    facts.push({
      label: 'Urgency',
      value: `Set by the organization · ${formatDate(marked.confirmedAt)}`,
    })
  if (top)
    facts.push({
      label: 'Most needed',
      value: `${top.item} · ${(top.quantity - top.fulfilled).toLocaleString()} ${top.unit}`,
    })
  if (organization.volunteerSlots > 0)
    facts.push({ label: 'Volunteer places', value: String(organization.volunteerSlots) })
  const situation = organization.situation.trim()
  return {
    eyebrow: `${organization.sample ? 'SAMPLE ' : ''}ORGANIZATION · ${organization.type.toUpperCase()}`,
    alert: URGENCY_ALERT[urgencyOf(organization)],
    title: organization.name,
    subtitle: organization.location,
    facts,
    note: situation.length > 160 ? `${situation.slice(0, 157).trimEnd()}…` : situation || undefined,
    source: `Updated ${formatDate(organization.updatedAt)} · Click to zoom in`,
  }
}

interface Props {
  contributions: Contribution[]
  onContribution: (id: string, origin: StarOrigin) => void
  organizations: Organization[]
  observations: Observation[]
  selectedId: string | null
  query: string
  layer: LayerId | null // null = the plain globe
  showOrganizations: boolean
  onLayerStatus: (status: LayerStatus) => void
  /** How far the camera has come in from the starting view: still far, coming closer, or close. */
  onApproach?: (approach: Approach) => void
  onSelect: (id: string) => void
  onObservation: (id: string) => void
  detections: FireDetections
  onDetection: (detection: FireDetection) => void
  selectedCoordinates?: Coordinates
  highlightedIds: string[]
}

export type Approach = 'far' | 'nearing' | 'close'

const NO_STATUS: LayerStatus = { loading: false, error: '', summary: null }
// 3D layers lean the camera from this zoom in.

export default function EarthMap({
  contributions,
  onContribution,
  organizations,
  observations,
  selectedId,
  query,
  layer,
  showOrganizations,
  onLayerStatus,
  onApproach,
  onSelect,
  onObservation,
  onDetection,
  selectedCoordinates,
  highlightedIds,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const markers = useRef<
    {
      marker: Marker
      id: string
      at: Coordinates
      button: HTMLButtonElement
      search: string
      organization: Organization
    }[]
  >([])
  // The organization pin under the pointer (or keyboard focus), whose card is showing.
  const pinHover = useRef<string | null>(null)
  const callbacks = useRef({ onSelect, onObservation, onDetection, onLayerStatus, onApproach })
  const selection = useRef({ organizations, selectedId, selectedCoordinates })
  const searchState = useRef({ query, highlightedIds, selectedId, layer, showOrganizations })
  const updateVisibility = useRef<() => void>(() => {})
  useEffect(() => {
    searchState.current = { query, highlightedIds, selectedId, layer, showOrganizations }
  }, [query, highlightedIds, selectedId, layer, showOrganizations])
  useEffect(() => {
    callbacks.current = { onSelect, onObservation, onDetection, onLayerStatus, onApproach }
  }, [onSelect, onObservation, onDetection, onLayerStatus, onApproach])
  useEffect(() => {
    selection.current = { organizations, selectedId, selectedCoordinates }
  }, [organizations, selectedId, selectedCoordinates])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(INITIAL_VIEW.zoom)
  const [center, setCenter] = useState(INITIAL_VIEW.center)
  const [loading, setLoading] = useState(true)
  const [hover, setHoverState] = useState<{
    info: HazardInfo
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const setHover = (next: { info: HazardInfo; x: number; y: number } | null) =>
    setHoverState(
      next && container.current
        ? { ...next, width: container.current.clientWidth, height: container.current.clientHeight }
        : null,
    )
  const [orbitMap, setOrbitMap] = useState<MapInstance | null>(null)
  const [natureYear, setNatureYear] = useState<NaturePeriod>(LATEST_NATURE_YEAR)
  const [educationStatus, setEducationStatus] = useState<EducationStatus | null>(null)
  const [educationError, setEducationError] = useState('')
  const [violenceStatus, setViolenceStatus] = useState<ViolenceStatus | null>(null)
  const [violenceError, setViolenceError] = useState('')
  const [layerAttempt, setLayerAttempt] = useState(0)
  const natureYearRef = useRef<NaturePeriod>(LATEST_NATURE_YEAR)
  const [imageryStatus, setImageryStatus] = useState<ImageryStatus>({
    requested: LATEST_NATURE_YEAR,
    displayed: 2024,
    loading: true,
    error: '',
  })

  useEffect(() => {
    if (!container.current) return
    let active = true
    let map: MapInstance
    try {
      map = new maplibregl.Map({
        container: container.current,
        ...overview(container.current.clientWidth, container.current.clientHeight),
        minZoom: 0.3,
        maxZoom: SATELLITE_MAX_ZOOM,
        // Some layers tilt the camera so water, storms and bars read as 3D.
        maxPitch: 60,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        canvasContextAttributes: { antialias: true },
        style: {
          version: 8,
          projection: { type: 'globe' },
          sources: {
            satellite: {
              type: 'raster',
              tiles: [SATELLITE_TILES],
              tileSize: 256,
              maxzoom: SATELLITE_MAX_ZOOM,
              attribution: SATELLITE_ATTRIBUTION,
            },
          },
          layers: [
            {
              id: 'satellite',
              type: 'raster',
              source: 'satellite',
              paint: {
                'raster-saturation': -0.1,
                'raster-brightness-max': 1,
                'raster-fade-duration': 150,
              },
            },
          ],
          sky: {
            'sky-color': '#05070a',
            'horizon-color': '#273d4c',
            'fog-color': '#05070a',
            'sky-horizon-blend': 0.2,
            'horizon-fog-blend': 0.2,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.65, 3, 0.15, 6, 0],
          },
          light: { anchor: 'map', position: [1.5, 90, 60] },
        },
      })
      mapRef.current = map
      if (import.meta.env.DEV) Object.assign(window, { __aidatlasMap: map })
      map.touchZoomRotate.disableRotation()
      map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-left')
      map
        .getCanvas()
        .setAttribute(
          'aria-label',
          'Interactive Earth. Use arrow keys to move and plus or minus to zoom. Use search to find organizations.',
        )
      map.on('style.load', () => {
        setReady(true)
        setOrbitMap(map)
      })
      map.on('load', () => {
        setReady(true)
        setLoading(false)
      })
      map.on('idle', () => setLoading(false))
      const start = map.getZoom()
      let approach: Approach = 'far'
      map.on('zoom', () => {
        const gained = map.getZoom() - start
        const next: Approach = gained >= 0.6 ? 'close' : gained > 0.04 ? 'nearing' : 'far'
        if (next === approach) return
        approach = next
        callbacks.current.onApproach?.(next)
      })
      map.on('moveend', () => {
        setZoom(map.getZoom())
        setCenter([map.getCenter().lng, map.getCenter().lat])
      })
      map.on('webglcontextlost', () => {
        setLoading(false)
        setError('The map’s graphics context was interrupted. Retry the map to reconnect.')
      })
      map.on('error', (event) => {
        if ('sourceId' in event && String(event.sourceId).startsWith('nature-imagery-')) return
        if ('sourceId' in event || /fetch|network|tile|webgl/i.test(event.error.message)) {
          setLoading(false)
          setError(
            'Satellite imagery could not load. You can still find organizations with search.',
          )
        }
      })
      const observer = new ResizeObserver(() => map.resize())
      observer.observe(container.current)
      const timeout = window.setTimeout(() => {
        // Animated custom layers keep map.loaded() false even after imagery has arrived.
        if (!map.getSource('satellite') || !map.isSourceLoaded('satellite')) {
          setLoading(false)
          setError('The map is taking longer than expected. Check your connection and retry.')
        }
      }, 20_000)
      return () => {
        active = false
        clearTimeout(timeout)
        observer.disconnect()
        map.remove()
        mapRef.current = null
      }
    } catch {
      mapRef.current?.remove()
      mapRef.current = null
      queueMicrotask(() => {
        if (active) {
          setLoading(false)
          setError(
            'This browser could not start the 3D map. Try a browser with WebGL enabled. Organization search is still available.',
          )
        }
      })
      return () => {
        active = false
      }
    }
  }, [attempt])

  // Organizations appear as pins only when asked for (the Organizations button), when a search
  // matches them, or when one is selected. Hovering a pin shows its card; clicking flies in.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const showCard = (organization: Organization) => {
      if (hidden(map, organization.coordinates)) return
      const point = map.project(organization.coordinates)
      pinHover.current = organization.id
      setHover({ info: organizationCard(organization), x: point.x, y: point.y })
    }
    const hideCard = (id: string) => {
      if (pinHover.current !== id) return
      pinHover.current = null
      setHover(null)
    }
    markers.current.forEach(({ marker }) => marker.remove())
    markers.current = organizations.map((organization) => {
      const button = document.createElement('button')
      button.className = 'organization-marker'
      button.type = 'button'
      const urgency = urgencyOf(organization)
      button.dataset.urgency = urgency
      button.setAttribute(
        'aria-label',
        `View ${organization.name}, ${organization.location}${organization.sample ? ', sample organization' : ''}${urgency === 'urgent' ? ', urgent needs' : urgency === 'standard' ? ', open needs' : ''}`,
      )
      // A small orbital beacon; the ring and light at its center are drawn in CSS.
      const pin = document.createElement('span')
      pin.className = 'marker-pin'
      pin.setAttribute('aria-hidden', 'true')
      button.append(pin)
      button.addEventListener('mouseenter', () => showCard(organization))
      button.addEventListener('mouseleave', () => hideCard(organization.id))
      button.addEventListener('focus', () => {
        if (button.matches(':focus-visible')) showCard(organization)
      })
      button.addEventListener('blur', () => hideCard(organization.id))
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        hideCard(organization.id)
        callbacks.current.onSelect(organization.id)
      })
      // Keep the beacon's center exactly on the organization's location.
      const marker = new maplibregl.Marker({ element: button, anchor: 'center' })
        .setLngLat(organization.coordinates)
        .addTo(map)
      marker.setOpacity(1, 0)
      return {
        marker,
        id: organization.id,
        at: organization.coordinates,
        button,
        organization,
        search:
          `${organization.name} ${organization.location} ${organization.requests.map((need) => need.item).join(' ')}`.toLowerCase(),
      }
    })
    const visibility = () => {
      const {
        query: term,
        highlightedIds: matches,
        selectedId: selected,
        layer: category,
        showOrganizations: show,
      } = searchState.current
      const inCategory = new Set(
        organizations
          .filter((organization) => inLayer(organization, category))
          .map((organization) => organization.id),
      )
      for (const entry of markers.current) {
        const match =
          !!term && (entry.search.includes(term.toLowerCase()) || matches.includes(entry.id))
        const wanted = (show && inCategory.has(entry.id)) || match || entry.id === selected
        entry.button.hidden = !wanted
        // The open card rides along with its pin, and leaves when the pin does.
        if (entry.id !== pinHover.current) continue
        if (!wanted || hidden(map, entry.at)) hideCard(entry.id)
        else showCard(entry.organization)
      }
    }
    updateVisibility.current = visibility
    visibility()
    map.on('move', visibility)
    map.on('idle', visibility)
    return () => {
      map.off('move', visibility)
      map.off('idle', visibility)
      markers.current.forEach(({ marker }) => marker.remove())
      markers.current = []
      if (pinHover.current) {
        pinHover.current = null
        setHover(null)
      }
    }
  }, [ready, organizations])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || layer !== 'wildfire') return
    const now = Date.now()
    const entries = observations
      .filter(
        (observation) =>
          !observation.playback &&
          !observation.simulated &&
          Date.parse(observation.observedAt) >= now - 86_400_000 &&
          Date.parse(observation.observedAt) <= now,
      )
      .map((observation) => {
        const button = document.createElement('button')
        button.className = 'observation-marker'
        button.type = 'button'
        button.setAttribute(
          'aria-label',
          `${observation.simulated ? 'Simulated observation' : 'Satellite observation'}: ${observation.title}`,
        )
        const ring = document.createElement('span')
        const label = document.createElement('span')
        label.className = 'marker-label'
        label.textContent = `${observation.title}${observation.simulated ? ' · sample' : ''}`
        button.append(ring, label)
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          callbacks.current.onObservation(observation.id)
        })
        return new maplibregl.Marker({ element: button })
          .setLngLat(observation.coordinates)
          .setOpacity(1, 0)
          .addTo(map)
      })
    const visibility = () =>
      entries.forEach((marker) => {
        marker.getElement().hidden = map.getZoom() < 4.2
      })
    visibility()
    map.on('move', visibility)
    return () => {
      map.off('move', visibility)
      entries.forEach((marker) => marker.remove())
    }
  }, [ready, observations, layer])

  // With the Organizations button on, the UN agencies and NGOs working on the ground appear too,
  // on the layers the UN's coordination data covers.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !showOrganizations || !layer || !FIELD_LAYERS.has(layer)) return
    let cancelled = false
    let field: FieldOrganizations | null = null
    loadData<FieldData>('field-organizations')
      .then((data) => {
        if (!cancelled)
          field = new FieldOrganizations(map, data, layer, (info, point) =>
            setHover(info && point ? { info, ...point } : null),
          )
      })
      .catch(() => {})
    return () => {
      cancelled = true
      field?.destroy()
    }
  }, [ready, layer, showOrganizations])

  // The canvas the animated effects draw on, between the globe and the markers.
  const effects = useRef<EffectCanvas | null>(null)
  const hazard = useRef<HazardLayer | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    effects.current = new EffectCanvas(map)
    return () => {
      effects.current?.destroy()
      effects.current = null
    }
  }, [ready])

  // Geographic data layers are independent of changes to organization requests.
  useEffect(() => {
    const map = mapRef.current
    const canvas = effects.current
    if (!ready || !map || !canvas || !layer) {
      callbacks.current.onLayerStatus(NO_STATUS)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    let active: HazardLayer | null = null
    if (layer === 'education') {
      queueMicrotask(() => {
        if (!cancelled) {
          setEducationStatus(null)
          setEducationError('')
        }
      })
    }
    callbacks.current.onLayerStatus({ loading: true, error: '', summary: null })
    if (layer === 'domestic_violence') {
      queueMicrotask(() => {
        if (!cancelled) {
          setViolenceStatus(null)
          setViolenceError('')
        }
      })
    }
    createHazardLayer(layer, {
      signal: controller.signal,
      map,
      canvas,
      organizations: selection.current.organizations,
      detections: null,
      hover: (info, point) => setHover(info && point ? { info, ...point } : null),
      onDetection: (detection) => callbacks.current.onDetection(detection),
      onImageryStatus: (status) => {
        if (!cancelled) {
          setImageryStatus(status)
          const selected = natureYearRef.current
          if (typeof status.requested === 'number' && status.months?.length) {
            const month =
              typeof selected === 'string' && status.months.includes(selected)
                ? selected
                : status.months[status.months.length - 1]
            natureYearRef.current = month
            setNatureYear(month)
            hazard.current?.setYear?.(month)
          }
        }
      },
      onSummary: (summary) => {
        if (!cancelled) callbacks.current.onLayerStatus({ loading: false, error: '', summary })
      },
      onEducationStatus: (status) => {
        if (!cancelled) setEducationStatus(status)
      },
      onViolenceStatus: (status) => {
        if (!cancelled) setViolenceStatus(status)
      },
    })
      .then((created) => {
        if (cancelled) {
          created.destroy()
          return
        }
        active = created
        hazard.current = created
        if (layer === 'nature') {
          const selected = natureYearRef.current
          const year =
            typeof selected === 'string'
              ? selected
              : (NATURE_YEARS.find((entry) => entry >= selected) ?? LATEST_NATURE_YEAR)
          natureYearRef.current = year
          setNatureYear(year)
          created.setYear?.(year)
        }
        callbacks.current.onLayerStatus({ loading: false, error: '', summary: created.summary })
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          if (layer === 'education') setEducationError('Education data could not load.')
          if (layer === 'domestic_violence') setViolenceError('Country estimates could not load.')
          callbacks.current.onLayerStatus({
            loading: false,
            error: reason instanceof Error ? reason.message : 'Layer data could not load.',
            summary: null,
          })
        }
      })
    return () => {
      cancelled = true
      controller.abort()
      active?.destroy()
      hazard.current = null
      setHover(null)
    }
  }, [ready, layer, layerAttempt])

  const changeEducationCountry = useCallback(
    (id: string | null) => hazard.current?.selectEducationCountry?.(id),
    [],
  )
  const retryEducation = useCallback(() => setLayerAttempt((value) => value + 1), [])
  const changeViolenceCountry = useCallback(
    (id: string | null) => hazard.current?.selectViolenceCountry?.(id),
    [],
  )

  const changeNatureYear = useCallback((year: NaturePeriod) => {
    natureYearRef.current = year
    setNatureYear(year)
    hazard.current?.setYear?.(year)
  }, [])

  const retryNatureCatalog = useCallback(() => hazard.current?.retryNatureCatalog?.(), [])

  // The globe turns on its own axis like the real Earth: west to east, so continents drift left
  // to right. It holds still while the pointer rests on the Earth or a finger touches it, and
  // turns again the moment it is let go. It only turns from space, not with an organization open.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    let last = performance.now()
    let speed = 0
    let pointer: { x: number; y: number } | null = null
    let touching = false
    // Off the planet, unproject snaps to the nearest edge, so the point no longer maps back.
    const onEarth = (point: { x: number; y: number }) => {
      const back = map.project(map.unproject([point.x, point.y]))
      return Math.hypot(back.x - point.x, back.y - point.y) < 2
    }
    const move = (event: MapMouseEvent) => {
      pointer = event.point
    }
    const out = () => {
      pointer = null
    }
    const touchStart = () => {
      touching = true
    }
    const touchEnd = () => {
      touching = false
    }
    const spin = (now: number) => {
      const seconds = Math.min(now - last, 100) / 1000
      last = now
      const free =
        !touching &&
        !pinHover.current &&
        !(pointer && onEarth(pointer)) &&
        !map.isMoving() &&
        map.getZoom() < 3 &&
        searchState.current.layer !== 'nature' &&
        searchState.current.layer !== 'wildfire' &&
        searchState.current.layer !== 'education' &&
        searchState.current.layer !== 'domestic_violence' &&
        !searchState.current.selectedId
      // A quick ease keeps the start and stop smooth without a noticeable delay.
      speed += ((free ? 3 : 0) - speed) * Math.min(1, seconds * 6)
      if (free && speed > 0.01) {
        const center = map.getCenter()
        map.setCenter([center.lng - speed * seconds, center.lat])
      }
      frame = requestAnimationFrame(spin)
    }
    frame = requestAnimationFrame(spin)
    map.on('mousemove', move)
    map.on('mouseout', out)
    map.on('touchstart', touchStart)
    map.on('touchend', touchEnd)
    map.on('touchcancel', touchEnd)
    return () => {
      cancelAnimationFrame(frame)
      map.off('mousemove', move)
      map.off('mouseout', out)
      map.off('touchstart', touchStart)
      map.off('touchend', touchEnd)
      map.off('touchcancel', touchEnd)
    }
  }, [ready])

  // Tint and tilt: every layer colours the atmosphere. 3D layers lean the camera once it is
  // close enough to see water, storms and bars as volumes; from space the globe stays upright.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const theme = layer ? LAYER_THEMES[layer] : null
    map.setSky({ 'horizon-color': theme?.horizon ?? DEFAULT_HORIZON })
    const tilt = () => {
      const pitch = layerPitch(layer, map.getZoom())
      if (Math.abs(map.getPitch() - pitch) > 1)
        map.easeTo({ pitch, duration: 800, essential: false })
    }
    tilt()
    map.on('zoomend', tilt)
    return () => {
      map.off('zoomend', tilt)
    }
  }, [ready, layer])

  const reset = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const { clientWidth, clientHeight } = map.getContainer()
    map.flyTo({
      ...overview(clientWidth, clientHeight),
      pitch: 0,
      duration: 1400,
      essential: false,
    })
  }, [])

  // Choosing a layer, switching to another or turning it off brings back the starting globe.
  const shownLayer = useRef(layer)
  useEffect(() => {
    if (!ready || shownLayer.current === layer) return
    shownLayer.current = layer
    reset()
  }, [ready, layer, reset])

  // Hovering the drawn disaster itself shows its card (icons handle their own hover). Clicking one
  // the layer can show up close, like a storm, flies the camera in to it.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    let frame = 0
    let last: MapMouseEvent | null = null
    const run = () => {
      frame = 0
      if (!last || last.originalEvent.target !== map.getCanvas()) return
      const info = hazard.current?.hitTest?.(last.point) ?? null
      setHover(info ? { info, x: last.point.x, y: last.point.y } : null)
    }
    const move = (event: MapMouseEvent) => {
      last = event
      if (!frame) frame = requestAnimationFrame(run)
    }
    const leave = () => {
      last = null
      setHover(null)
    }
    const click = (event: MapMouseEvent) => {
      const target = hazard.current?.focus?.(event.point)
      if (!target) return
      setHover(null)
      map.flyTo({
        ...target,
        pitch: layerPitch(searchState.current.layer, target.zoom),
        duration: 1600,
        essential: false,
      })
    }
    map.on('mousemove', move)
    map.on('mouseout', leave)
    map.on('dragstart', leave)
    map.on('click', click)
    return () => {
      cancelAnimationFrame(frame)
      map.off('mousemove', move)
      map.off('mouseout', leave)
      map.off('dragstart', leave)
      map.off('click', click)
    }
  }, [ready])

  useEffect(() => {
    for (const { button, id, search } of markers.current) {
      button.classList.toggle('selected', id === selectedId)
      const matches = search.includes(query.toLowerCase()) || highlightedIds.includes(id)
      button.classList.toggle('search-match', !!query && matches)
      button.classList.toggle('search-muted', !!query && !matches)
      button.setAttribute('aria-pressed', String(id === selectedId))
    }
    updateVisibility.current()
  }, [selectedId, query, ready, organizations, highlightedIds, layer, showOrganizations])

  useEffect(() => {
    const map = mapRef.current
    const selected = selection.current.organizations.find((entry) => entry.id === selectedId)
    if (!ready || !map) return
    const coordinates = selectedCoordinates ?? selected?.coordinates
    if (!coordinates) {
      map.easeTo({
        padding: globePadding(map.getContainer().clientWidth),
        duration: 300,
        essential: false,
      })
      return
    }
    const mobile = window.matchMedia('(max-width: 700px)').matches
    map.flyTo({
      center: coordinates,
      zoom: 10.5,
      duration: 1100,
      padding: mobile
        ? { top: 70, bottom: window.innerHeight * 0.59, left: 0, right: 0 }
        : { top: 40, bottom: 45, left: 0, right: 410 },
      essential: false,
    })
    // Only a new selection moves the camera here; layer changes reset it above.
  }, [selectedId, selectedCoordinates, ready])

  return (
    <div className={`earth-scene ${layer === 'nature' ? 'nature-active' : ''}`}>
      <div className="space-stars" aria-hidden="true" />
      <div className="earth-map" ref={container} />
      {ready && orbitMap && (
        <ContributionOrbit
          map={orbitMap}
          contributions={contributions}
          organizations={organizations}
          layer={layer}
          onOpen={onContribution}
        />
      )}
      {hover && <HazardTooltip {...hover} />}
      {ready && layer === 'education' && (
        <EducationExplorer
          status={educationStatus}
          error={educationError}
          onCountry={changeEducationCountry}
          onRetry={retryEducation}
          withPanel={!!(selectedId || selectedCoordinates)}
        />
      )}
      {ready && layer === 'domestic_violence' && (
        <ViolenceExplorer
          status={violenceStatus}
          error={violenceError}
          organizations={organizations}
          onCountry={changeViolenceCountry}
          onSupport={onSelect}
          onRetry={retryEducation}
          withPanel={!!(selectedId || selectedCoordinates)}
        />
      )}
      {ready && layer === 'nature' && (
        <NatureTimeline
          year={natureYear}
          onYear={changeNatureYear}
          status={imageryStatus}
          withPanel={!!(selectedId || selectedCoordinates)}
          onRetryCatalog={retryNatureCatalog}
        />
      )}
      {loading && (
        <div className="map-message" role="status">
          <span className="loading-dot" /> Bringing Earth into view
        </div>
      )}
      {error && (
        <div className="map-message map-error" role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              setError('')
              setLoading(true)
              setReady(false)
              setAttempt((value) => value + 1)
            }}
          >
            <RotateCcw size={14} /> Retry map
          </button>
        </div>
      )}

      <div
        className={`map-controls ${selectedId || selectedCoordinates ? 'with-panel' : ''}`}
        aria-label="Map controls"
      >
        <button
          className="control-button"
          onClick={reset}
          aria-label="Reset view"
          title="Reset view"
        >
          <Crosshair size={18} />
        </button>
        <div className="zoom-controls">
          <button
            className="control-button"
            onClick={() => mapRef.current?.zoomIn()}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus size={18} />
          </button>
          <button
            className="control-button"
            onClick={() => mapRef.current?.zoomOut()}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus size={18} />
          </button>
        </div>
      </div>
      <div
        className={`map-coordinates ${selectedId || selectedCoordinates ? 'with-panel' : ''}`}
        aria-hidden="true"
      >
        {Math.abs(center[1]).toFixed(2)}° {center[1] >= 0 ? 'N' : 'S'} <span>/</span>{' '}
        {Math.abs(center[0]).toFixed(2)}° {center[0] >= 0 ? 'E' : 'W'}
        <span className="view-scale">
          {zoom < 4 ? 'GLOBAL VIEW' : zoom < 9 ? 'REGIONAL VIEW' : 'LOCAL VIEW'}
        </span>
      </div>
    </div>
  )
}
