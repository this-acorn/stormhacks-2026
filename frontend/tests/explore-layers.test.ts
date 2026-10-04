import { afterEach, expect, it, vi } from 'vitest'
import type { LayerContext } from '../src/layers/types'
import type { Painter } from '../src/layers/canvas'
import { formatMoment, type FireData, type Gdacs } from '../src/layers/data'
import { fireFootprint } from '../src/layers/footprints'
import { distanceKm, polygonsContain } from '../src/layers/geo'
import { wildfireLayer } from '../src/layers/wildfire'
import { floodLayer } from '../src/layers/flood'
import { stormLayer } from '../src/layers/storm'
import { natureLayer } from '../src/layers/nature'
import { natureTiles } from '../src/natureImagery'

vi.mock('../src/layers/icons', () => ({
  HazardIcons: class {
    paint() {}
    destroy() {}
  },
}))
vi.mock('../src/layers/canvas', () => ({
  flameSprite: () => 'flame',
  glowSprite: (color: string) => (color === '255,151,45' ? 'glow' : 'flame'),
  puffSprite: () => 'smoke',
}))

function harness() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, any>()
  const listeners = new Map<string, Set<(event: any) => void>>()
  const loadedSources = new Set<string>()
  const status = vi.fn()
  const painters: Painter[] = []
  const images = new Set<string>()
  let terrain: unknown = null
  let zoom = 0
  const map = {
    getTerrain: () => terrain,
    setTerrain: vi.fn((value) => {
      terrain = value
    }),
    getMaxZoom: () => 14,
    getPadding: () => ({ top: 150, bottom: 70, left: 0, right: 0 }),
    getBearing: () => 0,
    setPadding: vi.fn(),
    setBearing: vi.fn(),
    setMaxZoom: vi.fn(),
    getZoom: () => zoom,
    getContainer: () => ({ clientWidth: 1400 }),
    dragRotate: { isEnabled: () => false, enable: vi.fn(), disable: vi.fn() },
    touchZoomRotate: { enableRotation: vi.fn(), disableRotation: vi.fn() },
    flyTo: vi.fn(),
    easeTo: vi.fn(),
    stop: vi.fn(),
    addImage: (id: string) => images.add(id),
    hasImage: (id: string) => images.has(id),
    removeImage: (id: string) => images.delete(id),
    getBounds: () => ({
      getWest: () => -1,
      getEast: () => 1,
      getSouth: () => -1,
      getNorth: () => 1,
    }),
    addSource: vi.fn((id, source) => sources.set(id, source)),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer: vi.fn((layer) => layers.set(layer.id, layer)),
    moveLayer: vi.fn(),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    isSourceLoaded: (id: string) => loadedSources.has(id),
    isMoving: () => false,
    on: (event: string, fn: (event: any) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    off: (event: string, fn: (event: any) => void) => listeners.get(event)?.delete(fn),
    project: ([lng, lat]: number[]) => ({
      x: 400 + lng * 111_320 * 0.01 * 2 ** zoom,
      y: 300 - lat * 111_320 * 0.006 * 2 ** zoom,
    }),
    _camera: {
      transform: { isLocationOccluded: () => false, getCameraPoint: () => ({ x: 400, y: 1000 }) },
    },
  }
  layers.set('satellite', { id: 'satellite' })
  const context = {
    map,
    canvas: {
      still: true,
      add: (painter: Painter) => {
        painters.push(painter)
        return vi.fn()
      },
    },
    organizations: [{ coordinates: [80, 30], category: 'wildfire' }],
    detections: null,
    hover: vi.fn(),
    onImageryStatus: status,
  } as unknown as LayerContext
  const emit = (event: string, data: any) => listeners.get(event)?.forEach((fn) => fn(data))
  return {
    map,
    sources,
    layers,
    context,
    status,
    emit,
    loadedSources,
    painters,
    setZoom: (value: number) => {
      zoom = value
    },
  }
}

const fireData: FireData = {
  title: 'Observed fire',
  source: 'NASA FIRMS',
  note: 'Heat detections',
  playback: false,
  start: '2026-10-03T00:00:00Z',
  end: '2026-10-04T00:00:00Z',
  clusters: [
    {
      id: 'one',
      center: [0, 0],
      bbox: [0, 0, 0.01, 0.01],
      count: 2,
      frpTotal: 50,
      frpMax: 30,
      first: '2026-10-03T00:00:00Z',
      last: '2026-10-04T00:00:00Z',
      place: 'test',
    },
  ],
  detections: [
    [0, 0, 1440, 30, 0],
    [0.01, 0.01, 1440, 20, 0],
  ],
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each([0, 49, 70])(
  'keeps the nominal detection footprint at 375 meters at latitude %s',
  (lat) => {
    const [ring] = fireFootprint([10, lat])
    expect(distanceKm(ring[0], ring[1]) * 1000).toBeCloseTo(375, -1)
    expect(distanceKm(ring[1], ring[2]) * 1000).toBeCloseTo(375, -1)
    expect(ring[0]).toEqual(ring[ring.length - 1])
  },
)

it('draws fire only at observed pixels and doubles flame dimensions when geographic scale doubles', () => {
  const h = harness()
  const layer = wildfireLayer(h.context, [fireData])
  const source = h.sources.get('wildfire-footprints') as any
  expect(source.data.features).toHaveLength(2)
  expect(
    source.data.features.every(
      (feature: any) => !polygonsContain([feature.geometry.coordinates], [80, 30]),
    ),
  ).toBe(true)
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
  }
  const render = () => {
    ctx.drawImage.mockClear()
    h.painters[0]({
      ctx,
      dt: 0,
      time: 0,
      width: 1000,
      height: 800,
      ratio: 1,
      zoom: 6,
      still: true,
    } as unknown as Parameters<Painter>[0])
    expect(ctx.drawImage.mock.calls.some(([image]) => image === 'smoke')).toBe(false)
    return ctx.drawImage.mock.calls.find(([image]) => image === 'flame')!.slice(3)
  }
  const far = render()
  h.setZoom(1)
  const close = render()
  expect(far).toHaveLength(2)
  expect(close[0] / far[0]).toBeCloseTo(2)
  expect(close[1] / far[1]).toBeCloseTo(2)
  layer.destroy()
  expect(h.sources.size).toBe(0)
})

it('preserves reported flood boundaries and holes without adding 3D water or moving the camera', () => {
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo() {}
      lineTo() {}
      closePath() {}
    },
  )
  const h = harness()
  const polygons = [
    [
      [
        [0, 0],
        [0.02, 0],
        [0.02, 0.02],
        [0, 0.02],
        [0, 0],
      ],
      [
        [0.005, 0.005],
        [0.01, 0.005],
        [0.01, 0.01],
        [0.005, 0.01],
        [0.005, 0.005],
      ],
    ],
  ]
  const data = {
    builtAt: '2026-10-04T00:00:00Z',
    source: 'GDACS',
    floods: [
      {
        id: 'one',
        name: 'Flood',
        center: [0.01, 0.01],
        areaKm2: 10,
        polygons,
        impacts: [],
        alert: 'Orange',
        from: '2026-10-01',
        to: '2026-10-04',
      },
    ],
  } as unknown as Gdacs
  const layer = floodLayer(h.context, data)
  const source = h.sources.get('flood-areas') as any
  expect(source.data.features[0].geometry.coordinates).toEqual(polygons)
  expect(polygonsContain(source.data.features[0].geometry.coordinates, [0.007, 0.007])).toBe(false)
  expect(h.map.getTerrain()).toBeNull()
  expect(h.sources.size).toBe(1)
  expect([...h.layers.keys()]).toEqual(['satellite', 'flood-floor', 'flood-edge'])
  expect(h.map.flyTo).not.toHaveBeenCalled()
  expect(h.map.easeTo).not.toHaveBeenCalled()
  expect(h.map.setMaxZoom).not.toHaveBeenCalled()
  expect(h.painters).toHaveLength(1)
  layer.destroy()
  expect(h.sources.size).toBe(0)
  expect(h.map.getTerrain()).toBeNull()
  expect(h.layers.size).toBe(1)
})

it('holds a clicked storm still up close, then resumes its replay from the same spot', () => {
  const h = harness()
  const start = Date.parse('2026-10-01T00:00:00Z')
  const data = {
    builtAt: '2026-10-04T00:00:00Z',
    source: 'GDACS',
    storms: [
      {
        title: 'Tropical Cyclone TEST',
        countries: ['Testland'],
        alert: 'Red',
        source: 'GDACS',
        current: false,
        from: '2026-10-01',
        to: '2026-10-02',
        maxWindKmh: 260,
        track: [
          { at: [-5, 0], time: '2026-10-01T00:00:00Z', category: 'HU' },
          { at: [5, 0], time: '2026-10-02T00:00:00Z', category: 'HU' },
        ],
        zones: [],
      },
    ],
  } as unknown as Gdacs
  const layer = stormLayer(h.context, data)
  const ctx = new Proxy({} as Record<string, any>, {
    get: (target, key: string) => (target[key] ??= vi.fn()),
  })
  const paint = (time: number) =>
    h.painters[0]({
      ctx,
      dt: 0,
      time,
      width: 1000,
      height: 800,
      ratio: 1,
    } as unknown as Parameters<Painter>[0])
  const middle = { x: 400, y: 300 }
  const replay = () =>
    layer.hitTest!(middle)!.facts.find((fact) => fact.label === 'Replay position')!.value
  const at = (fraction: number) =>
    `${formatMoment(start + fraction * 86_400_000)} · Hurricane / typhoon`

  // Seen from far away, 14 seconds into the 28-second replay: halfway along the track.
  h.setZoom(-10)
  paint(14)
  const held = replay()
  expect(held).toBe(at(0.5))
  expect(layer.hitTest!(middle)!.source).toContain('Click to zoom in')
  const target = layer.focus!(middle)!
  expect(target.center[0]).toBeCloseTo(0)

  // Once the camera arrives the storm is still there, large enough to show its debris.
  h.setZoom(target.zoom)
  paint(20)
  expect(replay()).toBe(held)
  expect(ctx.fillRect).toHaveBeenCalled()
  expect(layer.hitTest!(middle)!.source).not.toContain('Click to zoom in')

  // Zooming back out lets it travel on from where it was held, one second later.
  h.setZoom(-10)
  paint(21)
  paint(22)
  expect(replay()).toBe(at(15 / 28))
  layer.destroy()
})

it('waits for real imagery tiles, ignores stale years and restores the normal globe on exit', () => {
  const h = harness()
  const layer = natureLayer(h.context)
  h.loadedSources.add('nature-imagery-2025')
  h.emit('sourcedata', { sourceId: 'nature-imagery-2025', sourceDataType: 'metadata' })
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ displayed: 2024, loading: true }),
  )
  layer.setYear!(2020)
  expect(h.sources.has('nature-imagery-2025')).toBe(false)
  h.emit('sourcedata', { sourceId: 'nature-imagery-2025', tile: {} })
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ requested: 2020, displayed: 2024, loading: true }),
  )
  h.loadedSources.add('nature-imagery-2020')
  h.emit('sourcedata', { sourceId: 'nature-imagery-2020', tile: {} })
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({
      requested: 2020,
      displayed: 2020,
      loading: false,
      error: '',
    }),
  )
  expect(h.map.setLayoutProperty).toHaveBeenLastCalledWith('satellite', 'visibility', 'none')
  layer.setYear!(2021)
  h.emit('error', { sourceId: 'nature-imagery-2021', error: new Error('Network') })
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({
      displayed: 2020,
      loading: false,
      error: expect.stringContaining('2021'),
    }),
  )
  expect(h.sources.has('nature-imagery-2020')).toBe(true)
  layer.setYear!(2021)
  expect(h.sources.has('nature-imagery-2021')).toBe(true)
  expect(h.map.addLayer).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'nature-imagery-2021' }),
    'nature-imagery-2020',
  )
  h.loadedSources.add('nature-imagery-2021')
  h.emit('sourcedata', { sourceId: 'nature-imagery-2021', tile: {} })
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({ displayed: 2021, loading: false, error: '' }),
  )
  expect(h.sources.has('nature-imagery-2020')).toBe(false)
  expect(h.map.moveLayer).not.toHaveBeenCalled()
  layer.destroy()
  expect(h.sources.size).toBe(0)
  expect(h.map.setLayoutProperty).toHaveBeenLastCalledWith('satellite', 'visibility', 'visible')
})

it('times out unavailable imagery without relabeling the old mosaic as the requested year', () => {
  vi.useFakeTimers()
  const h = harness()
  const layer = natureLayer(h.context)
  vi.advanceTimersByTime(20_001)
  expect(h.status).toHaveBeenLastCalledWith(
    expect.objectContaining({
      requested: 2025,
      displayed: 2024,
      loading: false,
      error: expect.any(String),
    }),
  )
  expect(h.sources.size).toBe(0)
  layer.destroy()
  expect(vi.getTimerCount()).toBe(0)
})

it('offers only the published yearly mosaics from 2020', () => {
  expect(natureTiles(2020)).toContain('/s2cloudless-2020_3857/')
  expect(natureTiles(2025)).toContain('/s2cloudless-2025_3857/')
  expect(() => natureTiles(2019)).toThrow('unavailable')
  expect(() => natureTiles(2026)).toThrow('unavailable')
})
