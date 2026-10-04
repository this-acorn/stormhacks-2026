import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MercatorCoordinate } from 'maplibre-gl'
import { afterEach, expect, it, vi } from 'vitest'
import {
  createPropertyExpression,
  latest,
  validateStyleMin,
  type StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec'
import ViolenceExplorer from '../src/components/ViolenceExplorer'
import { violenceLayer } from '../src/layers/violence'
import { pickViolenceBar } from '../src/layers/violencePicking'
import { demoData } from '../src/mockData'
import type { EducationGeometry } from '../src/educationData'
import type { ViolenceData } from '../src/layers/data'
import type { LayerContext } from '../src/layers/types'
import type { Frame, Painter } from '../src/layers/canvas'
import type { Organization } from '../src/types'
import {
  countryOrganizations,
  domesticRequests,
  validEstimate,
  violenceCountries,
  violenceColor,
  violenceFrequency,
  violenceHeight,
  VIOLENCE_METERS_PER_POINT,
  type CountryCatalog,
  type ViolenceStatus,
} from '../src/violenceData'

afterEach(cleanup)
const catalog: CountryCatalog = {
  countries: [
    { id: 'AAA', name: 'Example country', center: [1, 1] },
    { id: 'BBB', name: 'Missing country', center: [5, 1] },
  ],
}
const data: ViolenceData = {
  builtAt: '2026-10-04',
  year: 2023,
  source: 'WHO',
  title: 'Partner violence',
  measure: 'Physical and/or sexual intimate partner violence',
  note: 'Modelled survey estimates with uncertainty ranges. Not counts of reported cases.',
  countries: [
    {
      iso3: 'AAA',
      name: 'Example country',
      at: [1, 1],
      year: 2023,
      all: { value: 20, low: 15, high: 25 },
      young: null,
    },
  ],
}
const geometry: EducationGeometry = {
  type: 'FeatureCollection',
  features: [0, 4].map((x, index) => ({
    type: 'Feature',
    id: index ? 'BBB' : 'AAA',
    properties: { id: index ? 'BBB' : 'AAA' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x, 0],
          [x + 2, 0],
          [x + 2, 2],
          [x, 2],
          [x, 0],
        ],
      ],
    },
  })),
}
const base = demoData.organizations.find((entry) => entry.id === 'toronto-safety')!
const organization: Organization = {
  ...base,
  coordinates: [1, 1],
  location: 'Example city',
  requests: [
    { ...base.requests[0], quantity: 80, fulfilled: 31, unit: 'phones', urgency: 'urgent' },
  ],
}
const status: ViolenceStatus = {
  data,
  countries: violenceCountries(data, catalog),
  geometry,
  selectedId: 'AAA',
  coverage: 1,
}

function Harness({
  onSupport = vi.fn(),
  initialId = 'AAA',
}: {
  onSupport?: (id: string) => void
  initialId?: string | null
}) {
  const [selectedId, onCountry] = useState<string | null>(initialId)
  return (
    <ViolenceExplorer
      status={{ ...status, selectedId }}
      error=""
      organizations={[organization]}
      onCountry={onCountry}
      onSupport={onSupport}
      onRetry={vi.fn()}
      withPanel={false}
    />
  )
}

it('shows the dated population-specific estimate and opens the matching organization', () => {
  const onSupport = vi.fn()
  render(<Harness onSupport={onSupport} />)
  expect(screen.getByText('20.0%')).toBeTruthy()
  expect(screen.getByText('20.0%').style.color).toBe('rgb(208, 107, 255)')
  const legend = screen.getByRole('group', {
    name: 'Map legend: bar color represents estimated percentage',
  })
  for (const label of ['0%', '10%', '20%', '30%', '40%+'])
    expect(legend.textContent).toContain(label)
  expect(legend.querySelector('.violence-color-ramp')).toBeTruthy()
  expect(screen.getByText('About 1 in 5 women')).toBeTruthy()
  expect(screen.getByText('2023 estimate · Previous 12 months')).toBeTruthy()
  expect(screen.getByText(/Ever-partnered women aged 15\+ who/)).toBeTruthy()
  expect(screen.getByText('15.0%–25.0%')).toBeTruthy()
  expect(screen.getByText('Sample organization · demo requests')).toBeTruthy()
  expect(screen.getByText('49 phones still needed · Urgent')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `Support ${organization.name}` }))
  expect(onSupport).toHaveBeenCalledExactlyOnceWith(organization.id)
})

it('supports keyboard search, explicit missing data, empty requests and closing the country', async () => {
  const user = userEvent.setup()
  render(<Harness initialId={null} />)
  const search = screen.getByRole('searchbox', { name: 'Search a country' })
  await user.click(search)
  await user.paste('missing')
  await user.keyboard('{Enter}')
  expect(screen.getByRole('heading', { name: 'Missing country' })).toBeTruthy()
  expect(screen.getByText('No estimate available')).toBeTruthy()
  expect(screen.getByText(/Missing data does not mean violence is absent/)).toBeTruthy()
  expect(screen.queryByText('0.0%')).toBeNull()
  expect(screen.queryByRole('button', { name: /Support Safe/ })).toBeNull()
  expect(screen.getByText(/No open requests listed in AidAtlas/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Close country details' }))
  expect(document.activeElement).toBe(search)
  await user.paste('nowhere')
  expect(screen.getByText('No matching countries.')).toBeTruthy()
  await user.keyboard('{Escape}')
  expect((search as HTMLInputElement).value).toBe('')
  await user.paste('Example')
  await user.click(screen.getByRole('button', { name: 'Example country · 2023 estimate' }))
  expect(screen.getByText('20.0%')).toBeTruthy()
})

it('provides a retry when estimates fail and does not show stale statistics', () => {
  const retry = vi.fn()
  const props = {
    status: null,
    error: '',
    organizations: [],
    onCountry: vi.fn(),
    onSupport: vi.fn(),
    onRetry: retry,
    withPanel: false,
  }
  const view = render(<ViolenceExplorer {...props} />)
  expect(screen.getByRole('status').textContent).toContain('Loading')
  view.rerender(<ViolenceExplorer {...props} status={status} error="Offline" />)
  expect(screen.getByRole('alert').textContent).toContain('could not load')
  expect(screen.queryByText('20.0%')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry estimates' }))
  expect(retry).toHaveBeenCalledOnce()
})

it('preserves zero estimates, rejects invalid ranges, and never turns missing data into zero', () => {
  expect(validEstimate({ value: 0, low: 0, high: 1 })).toBe(true)
  expect(validEstimate({ value: 10, low: 11, high: 20 })).toBe(false)
  expect(validEstimate({ value: NaN, low: 0, high: 20 })).toBe(false)
  expect(violenceFrequency(0)).toBeNull()
  expect(violenceHeight(null)).toBe(0)
  expect(violenceHeight(0)).toBe(0)
  expect(violenceHeight(20)).toBe(2 * violenceHeight(10))
  expect(violenceHeight(72)).toBe(72 * VIOLENCE_METERS_PER_POINT)
  expect(violenceHeight(72)).toBeGreaterThan(violenceHeight(60))
  const rows = violenceCountries(
    { ...data, countries: [{ ...data.countries[0], all: { value: 0, low: 0, high: 1 } }] },
    catalog,
  )
  expect(rows.find((row) => row.id === 'AAA')?.estimate?.all.value).toBe(0)
  expect(rows.find((row) => row.id === 'BBB')?.estimate).toBeNull()
})

it('shows only open domestic-violence requests inside the chosen country, including mixed-category organizations', () => {
  const outside = { ...organization, id: 'outside', coordinates: [5, 1] as [number, number] }
  const mixed = { ...organization, id: 'mixed', category: 'education' as const }
  const closed = {
    ...organization,
    id: 'closed',
    requests: organization.requests.map((request) => ({ ...request, status: 'closed' as const })),
  }
  const fulfilled = {
    ...organization,
    id: 'fulfilled',
    requests: organization.requests.map((request) => ({ ...request, fulfilled: request.quantity })),
  }
  const unrelated = {
    ...organization,
    id: 'unrelated',
    requests: organization.requests.map((request) => ({
      ...request,
      impactCategory: 'education' as const,
    })),
  }
  expect(
    countryOrganizations('AAA', geometry, [
      organization,
      outside,
      mixed,
      closed,
      fulfilled,
      unrelated,
    ])
      .map((entry) => entry.id)
      .sort(),
  ).toEqual([organization.id, 'mixed'].sort())
  expect(domesticRequests(unrelated)).toEqual([])
  const withHole: EducationGeometry = structuredClone(geometry)
  if (withHole.features[0].geometry.type === 'Polygon')
    withHole.features[0].geometry.coordinates.push([
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 1.5],
      [0.5, 1.5],
      [0.5, 0.5],
    ])
  expect(countryOrganizations('AAA', withHole, [organization])).toEqual([])
})

// A deterministic elevated projection: 640 km lifts the screen position by 64 pixels.
function pickingMap() {
  const tile = {
    canonical: { getTilePoint: ({ x, y }: MercatorCoordinate) => ({ x, y }) },
    toUnwrapped: () => ({}),
  }
  return {
    getZoom: vi.fn(() => 3),
    coveringTiles: () => [tile],
    _camera: {
      transform: {
        width: 1000,
        height: 800,
        projectTileCoordinates: vi.fn(
          (x: number, y: number, _tile: unknown, elevation: number) => ({
            point: { x: x * 2 - 1, y: 1 - y * 2 + elevation / 4_000_000 },
            signedDistanceFromCamera: 5,
            isOccluded: false,
          }),
        ),
      },
    },
  }
}

it('picks the full elevated bar and nearby taps, prefers the nearest bar, and skips hidden bars', () => {
  const map = pickingMap()
  const bars = [
    {
      id: 'AAA',
      corners: [
        [0.49, 0.49],
        [0.51, 0.49],
        [0.51, 0.51],
        [0.49, 0.51],
      ].map(([x, y]) => new MercatorCoordinate(x, y)),
      height: 640_000,
    },
  ]
  const pick = (x: number, y: number, scale = 1, radius = 14) =>
    pickViolenceBar(map as unknown as LayerContext['map'], bars, { x, y }, scale, radius)
  expect(pick(500, 365)).toBe('AAA') // visible side, away from the ground footprint
  expect(pick(500, 330)).toBe('AAA') // top
  expect(pick(521, 365)).toBe('AAA') // forgiving tap target
  expect(pick(525, 365)).toBeNull() // empty space remains unselected
  expect(pick(500, 365, 0)).toBeNull() // no stale elevated target while collapsed
  expect(pick(500, 400, 0)).toBe('AAA') // footprint remains selectable
  bars.push({
    ...bars[0],
    id: 'BBB',
    corners: bars[0].corners.map(({ x, y }) => new MercatorCoordinate(x + 0.03, y)),
  })
  expect(pick(519, 365)).toBe('BBB') // closest edge wins over array order
  expect(pick(500, 365)).toBe('AAA') // direct hits win over nearby targets
  map._camera.transform.projectTileCoordinates.mockImplementation((x, y) => ({
    point: { x, y },
    signedDistanceFromCamera: 5,
    isOccluded: true,
  }))
  expect(pick(500, 365)).toBeNull() // opposite side of the Earth
  map._camera.transform.projectTileCoordinates.mockImplementation(() => ({
    point: { x: 0, y: 0 },
    signedDistanceFromCamera: -5,
    isOccluded: false,
  }))
  expect(pick(500, 400)).toBeNull() // behind the camera
})

function violenceHarness(still = false, estimates = data) {
  const sources = new Map<string, any>()
  const layers = new Map<string, any>()
  const states = new Map<string, { rise: number }>()
  const listeners = new Set<() => void>()
  const canvas = { style: { cursor: 'grab' } }
  const onStatus = vi.fn()
  let paint: Painter | null = null
  const removePainter = vi.fn(() => {
    paint = null
  })
  const effects = {
    still,
    add: vi.fn((painter: Painter) => {
      paint = painter
      return removePainter
    }),
  }
  const map = {
    ...pickingMap(),
    getCanvas: () => canvas,
    getContainer: () => ({ clientWidth: 1400, clientHeight: 850 }),
    getCenter: () => ({ lng: 1, lat: 1 }),
    isMoving: vi.fn(() => false),
    isSourceLoaded: vi.fn(() => false),
    on: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    off: vi.fn((_event: string, listener: () => void) => listeners.delete(listener)),
    triggerRepaint: vi.fn(),
    addSource: (id: string, source: unknown) => sources.set(id, source),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => {
      sources.delete(id)
      if (id === 'violence-bars') states.clear()
    },
    addLayer: (layer: any) => layers.set(layer.id, layer),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty: vi.fn((id: string, property: string, value: unknown) => {
      layers.get(id).paint[property] = value
    }),
    setFilter: vi.fn((id: string, filter: unknown) => {
      layers.get(id).filter = filter
    }),
    setFeatureState: vi.fn((target: { source: string; id: string }, state: { rise: number }) => {
      states.set(target.id, state)
    }),
    flyTo: vi.fn(),
  }
  const mount = () =>
    violenceLayer(
      {
        map,
        canvas: effects,
        onViolenceStatus: onStatus,
        hover: vi.fn(),
      } as unknown as LayerContext,
      estimates,
      geometry,
      catalog,
    )
  return {
    layer: mount(),
    mount,
    map,
    sources,
    layers,
    states,
    listeners,
    canvas,
    onStatus,
    effects,
    removePainter,
    render: () => {
      for (const listener of [...listeners]) listener()
    },
    frame: (dt = 0.05) => paint?.({ dt, time: 99999 } as Frame),
  }
}

it.each([true, false])(
  'draws compact bars without raised country polygons and preserves selection (reduced motion: %s)',
  async (still) => {
    const h = violenceHarness(still)
    const { layer, sources, layers, states, canvas, onStatus, effects, map, removePainter } = h
    const validate = () =>
      expect(
        validateStyleMin({
          version: 8,
          sources: Object.fromEntries(sources),
          layers: [...layers.values()],
        } as StyleSpecification),
      ).toEqual([])
    validate()
    const features = sources.get('violence-bars').data.features
    expect(features.map((feature: any) => feature.properties.value)).toEqual([20])
    expect(features).toHaveLength(1)
    expect(sources.get('violence-bars').promoteId).toBe('id')
    const ring = features[0].geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
    expect(ring[2][0] - ring[0][0]).toBeLessThan(2)
    expect(ring).not.toEqual(geometry.features[0].geometry.coordinates[0])
    expect(features[0].properties.height).toBe(20 * VIOLENCE_METERS_PER_POINT)
    expect(layers.size).toBe(3)
    expect(sources.size).toBe(2)
    expect(sources.get('violence-country-boundaries').data).toBe(geometry)
    const borders = [layers.get('violence-country-halo'), layers.get('violence-country-selected')]
    for (const border of borders) {
      expect(border.type).toBe('line')
      expect(border.source).toBe('violence-country-boundaries')
      expect(border.filter).toEqual(['==', ['get', 'id'], ''])
    }
    expect([...layers.values()].filter((entry) => entry.type === 'fill-extrusion')).toHaveLength(1)
    const volume = layers.get('violence-bars-3d')
    expect(volume.type).toBe('fill-extrusion')
    const color = createPropertyExpression(
      volume.paint['fill-extrusion-color'],
      'fill-extrusion-color',
      latest['paint_fill-extrusion']['fill-extrusion-color'],
    )
    expect(color.result).toBe('success')
    if (color.result === 'success') {
      for (const value of [0, 3, 10, 15, 20, 30, 40, 72]) {
        const rendered = color.value.evaluate({ zoom: 3 }, { type: 3, properties: { value } })
        const channels = [rendered.r, rendered.g, rendered.b].map((channel: number) =>
          Math.round(channel * 255),
        )
        const cardColor = violenceColor(value)
        expect(channels).toEqual(
          [1, 3, 5].map((index) => parseInt(cardColor.slice(index, index + 2), 16)),
        )
      }
    }
    const renderedHeight = (zoom: number) => {
      const result = createPropertyExpression(
        volume.paint['fill-extrusion-height'],
        'fill-extrusion-height',
        latest['paint_fill-extrusion']['fill-extrusion-height'],
      )
      expect(result.result).toBe('success')
      if (result.result === 'success')
        return result.value.evaluate(
          { zoom },
          { type: 3, properties: features[0].properties },
          states.get('AAA') ?? {},
        )
    }
    expect(renderedHeight(3)).toBe(still ? 20 * VIOLENCE_METERS_PER_POINT : 0)
    if (!still) {
      h.render()
      expect(effects.add).not.toHaveBeenCalled() // wait for source tiles
      map.isSourceLoaded.mockReturnValue(true)
      map.isMoving.mockReturnValue(true)
      h.render()
      expect(effects.add).not.toHaveBeenCalled() // wait for the entry camera move
      map.isMoving.mockReturnValue(false)
      h.render()
      expect(effects.add).toHaveBeenCalledOnce()
      h.frame(10) // a slow frame cannot skip the entrance
      expect(renderedHeight(3)).toBeGreaterThan(0)
      expect(renderedHeight(3)).toBeLessThan((20 * VIOLENCE_METERS_PER_POINT) / 2)
      expect(layer.hitTest!({ x: 500, y: 330 })).toBeNull() // unreached height is not clickable
      expect(layer.hitTest!({ x: 500, y: 395 })?.title).toBe('Example country')
      for (let frame = 0; frame < 40; frame++) h.frame()
      await Promise.resolve()
      expect(renderedHeight(3)).toBe(20 * VIOLENCE_METERS_PER_POINT)
      expect(removePainter).toHaveBeenCalledOnce()
      h.render()
      expect(effects.add).toHaveBeenCalledOnce() // map redraws do not replay the animation
    } else {
      expect(effects.add).not.toHaveBeenCalled()
      expect(map.on).not.toHaveBeenCalled()
      expect(map.setFeatureState).not.toHaveBeenCalled()
    }
    expect(renderedHeight(6.5)).toBe(10 * VIOLENCE_METERS_PER_POINT)
    expect(renderedHeight(8)).toBe(0)
    // The side of this bar is well above its ground footprint; native queries miss it on a globe.
    expect(layer.hitTest!({ x: 500, y: 365 })?.title).toBe('Example country')
    expect(canvas.style.cursor).toBe('pointer')
    expect(layer.focus!({ x: 500, y: 365 })).toMatchObject({
      center: [1, 1],
      zoom: 3,
      padding: { left: 370 },
    })
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedId: 'AAA', coverage: 1 }),
    )
    for (const border of borders) expect(border.filter).toEqual(['==', ['get', 'id'], 'AAA'])
    expect(borders[1].paint['line-color']).toBe(violenceColor(20))
    expect(
      map.setPaintProperty.mock.calls.some(([, property]) => property === 'fill-extrusion-color'),
    ).toBe(false)
    layer.selectViolenceCountry!('BBB')
    expect(map.flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [5, 1], pitch: 0, essential: false }),
    )
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'BBB' }))
    for (const border of borders) expect(border.filter).toEqual(['==', ['get', 'id'], 'BBB'])
    expect(borders[1].paint['line-color']).toBe('#c39bff')
    layer.selectViolenceCountry!('unknown')
    for (const border of borders) expect(border.filter).toEqual(['==', ['get', 'id'], 'BBB'])
    expect(layer.hitTest!({ x: 800, y: 100 })).toBeNull()
    expect(canvas.style.cursor).toBe('grab')
    expect(h.listeners.size).toBe(0)
    map.getZoom.mockReturnValue(8)
    expect(layer.hitTest!({ x: 500, y: 365 })).toBeNull()
    layer.selectViolenceCountry!(null)
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null }))
    for (const border of borders) expect(border.filter).toEqual(['==', ['get', 'id'], ''])
    validate()
    layer.destroy()
    expect(sources.size).toBe(0)
    expect(layers.size).toBe(0)
    expect(canvas.style.cursor).toBe('grab')
    if (!still) expect(removePainter).toHaveBeenCalledOnce()
    onStatus.mockClear()
    map.setFilter.mockClear()
    layer.selectViolenceCountry!('AAA')
    expect(onStatus).not.toHaveBeenCalled()
    expect(map.setFilter).not.toHaveBeenCalled()
  },
)

it('sweeps outward from the visible center and replays on re-entry without changing final data heights', async () => {
  const h = violenceHarness(false, {
    ...data,
    countries: [
      ...data.countries,
      { ...data.countries[0], iso3: 'BBB', name: 'Second country', at: [5, 1] },
    ],
  })
  h.map.isSourceLoaded.mockReturnValue(true)
  h.render()
  for (let frame = 0; frame < 5; frame++) h.frame()
  expect(h.states.get('AAA')?.rise).toBeGreaterThan(0)
  expect(h.states.has('BBB')).toBe(false) // farther bar has not started
  for (let frame = 0; frame < 12; frame++) h.frame()
  expect(h.states.get('BBB')?.rise).toBeGreaterThan(0)
  expect(h.states.get('AAA')!.rise).toBeGreaterThan(h.states.get('BBB')!.rise)
  for (let frame = 0; frame < 25; frame++) h.frame()
  await Promise.resolve()
  expect([...h.states.values()].map((state) => state.rise)).toEqual([1, 1])
  expect(h.removePainter).toHaveBeenCalledOnce()
  expect(
    h.sources.get('violence-bars').data.features.map((feature: any) => feature.properties.height),
  ).toEqual([640_000, 640_000])
  h.layer.destroy()
  const next = h.mount()
  expect(h.states.size).toBe(0)
  h.render()
  h.frame()
  expect(h.states.get('AAA')?.rise).toBeGreaterThan(0)
  expect(h.states.get('AAA')?.rise).toBeLessThan(1)
  expect(h.effects.add).toHaveBeenCalledTimes(2)
  next.destroy()
  expect(h.listeners.size).toBe(0)
  expect(h.removePainter).toHaveBeenCalledTimes(2)
  h.map.setFeatureState.mockClear()
  h.frame()
  expect(h.map.setFeatureState).not.toHaveBeenCalled()
})

it('cancels a pending entrance when the layer is left before its source loads', () => {
  const h = violenceHarness()
  const lateRender = [...h.listeners][0]
  h.layer.destroy()
  expect(h.listeners.size).toBe(0)
  h.map.isSourceLoaded.mockReturnValue(true)
  lateRender()
  expect(h.effects.add).not.toHaveBeenCalled()
  expect(h.map.setFeatureState).not.toHaveBeenCalled()
  expect(h.sources.size).toBe(0)
  expect(h.layers.size).toBe(0)
})

it('matches real bundled country boundaries to the Canadian and UK sample requests', () => {
  const boundaries: EducationGeometry = JSON.parse(
    readFileSync('public/data/education-countries.json', 'utf8'),
  )
  const countries: CountryCatalog = JSON.parse(readFileSync('public/data/education.json', 'utf8'))
  const estimates: ViolenceData = JSON.parse(
    readFileSync('public/data/partner-violence.json', 'utf8'),
  )
  expect(
    countryOrganizations('CAN', boundaries, demoData.organizations).map((entry) => entry.id),
  ).toEqual(['toronto-safety'])
  expect(
    countryOrganizations('GBR', boundaries, demoData.organizations).map((entry) => entry.id),
  ).toEqual(['london-safety'])
  const places = violenceCountries(estimates, countries)
  // The source repeats Australia for separate geometries; one country appears once in search.
  expect(places.filter((place) => place.estimate)).toHaveLength(
    new Set(estimates.countries.map((entry) => entry.iso3)).size,
  )
  expect(places.filter((place) => place.id === 'AUS')).toHaveLength(1)
  expect(places.find((place) => place.id === 'CAN')?.estimate?.year).toBe(2023)
  expect(places.find((place) => place.id === 'GBR')?.estimate?.year).toBe(2023)
  expect(
    boundaries.features.every((feature) =>
      places.some((place) => place.id === feature.properties.id),
    ),
  ).toBe(true)
})
