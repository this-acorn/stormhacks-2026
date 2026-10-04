import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as ThreeTypes from 'three'

const drawing = vi.hoisted(() => ({
  frame: null as ((time: number) => void) | null,
  resize: null as (() => void) | null,
  scene: null as ThreeTypes.Scene | null,
  camera: null as ThreeTypes.PerspectiveCamera | null,
  disposed: false,
}))

// Keep real Three.js geometry, materials, camera, projection and navigation.
// Only GPU submission is substituted: these are not screenshot/shader tests.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      ratio = 1
      setPixelRatio(value: number) {
        this.ratio = value
      }
      getPixelRatio() {
        return this.ratio
      }
      setSize(width: number, height: number) {
        this.domElement.width = width
        this.domElement.height = height
      }
      setAnimationLoop(callback: typeof drawing.frame) {
        drawing.frame = callback
      }
      render(scene: ThreeTypes.Scene, camera: ThreeTypes.PerspectiveCamera) {
        drawing.scene = scene
        drawing.camera = camera
      }
      dispose() {
        drawing.disposed = true
      }
    },
  }
})

import { createSpaceRenderer } from '../src/spaceRenderer'
import type { SpaceState } from '../src/spaceRenderer'
import { constellations } from '../src/cosmosModel'
import { demoData } from '../src/mockData'
import { emptyCollection, reconcileCollection } from '../src/constellationCollection'
import { galaxyPosition } from '../src/cosmosSpace'

beforeEach(() => {
  drawing.disposed = false
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        drawing.resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

function setup(headerHeight?: number, entering = false) {
  const header = document.createElement('div')
  if (headerHeight !== undefined) {
    header.className = 'cosmos-navigation-header'
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: headerHeight })
    document.body.append(header)
  }
  const host = document.createElement('div')
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 1100 },
    clientHeight: { configurable: true, value: 650 },
  })
  document.body.append(host)
  const state: SpaceState = {
    groups: constellations([demoData.contributions[2]], demoData.organizations),
    selectedId: entering ? demoData.contributions[2].id : null,
    entryStar: entering ? demoData.contributions[2].id : undefined,
    selectedCluster: null,
    now: Date.now(),
    paused: false,
    flashing: [],
  }
  const callbacks = {
    project: vi.fn(),
    approached: vi.fn(),
    interrupted: vi.fn(),
    failed: vi.fn(),
    revealed: vi.fn(),
    travelled: vi.fn(),
    entryReady: vi.fn(),
  }
  const view = createSpaceRenderer(host, state, callbacks)
  return {
    host,
    state,
    callbacks,
    view,
    cleanup: () => {
      view.dispose()
      host.remove()
      header.remove()
    },
  }
}

it('prepares an Explore entry directly at its star and hands over without a second camera flight', () => {
  const { view, state, callbacks, cleanup } = setup(undefined, true)
  try {
    let time = performance.now()
    drawing.frame!(time)
    const camera = drawing.camera!
    const position = camera.position.clone()
    const star = drawing.scene!.getObjectByName(`star:${state.entryStar}`) as ThreeTypes.Points<
      ThreeTypes.BufferGeometry,
      ThreeTypes.ShaderMaterial
    >
    expect(camera.position.distanceTo(star.getWorldPosition(position.clone()))).toBeCloseTo(80)
    expect(callbacks.entryReady).toHaveBeenCalledOnce()
    expect(callbacks.entryReady.mock.lastCall![0].key).toBe(`star:${state.entryStar}`)
    expect(callbacks.entryReady.mock.lastCall![0].visible).toBe(true)
    expect(star.material.uniforms.opacity.value).toBe(0)
    const links = star.parent!.children.find((child) => child.type === 'LineSegments')!
    expect(links.visible).toBe(false)
    expect(camera.zoom).toBeCloseTo(0.62)
    const origin = callbacks.entryReady.mock.lastCall![0]
    drawing.frame!((time += 700))
    expect(camera.zoom).toBeGreaterThan(0.62)
    expect(camera.zoom).toBeLessThan(1)
    const during = callbacks.project.mock.lastCall![0].find((point) => point.key === origin.key)!
    expect(during.x).toBeCloseTo(origin.x)
    expect(during.y).toBeCloseTo(origin.y)
    drawing.frame!((time += 500))
    expect(star.material.uniforms.opacity.value).toBeGreaterThan(0)
    const handoverOpacity = star.material.uniforms.opacity.value
    drawing.frame!((time += 400))
    expect(camera.zoom).toBe(1)
    expect(star.material.uniforms.opacity.value).toBeGreaterThan(handoverOpacity)
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001)
    expect(callbacks.entryReady).toHaveBeenCalledOnce()
    view.update({ ...state, entryStar: undefined })
    drawing.frame!((time += 17))
    expect(camera.zoom).toBe(1)
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001)
    expect(star.material.uniforms.opacity.value).toBeGreaterThan(0)
    expect(links.visible).toBe(true)
  } finally {
    cleanup()
  }
})

it('travels into the universe, looks around in place, and interrupts flights on manual input', () => {
  const { view, callbacks, cleanup } = setup()
  try {
    drawing.frame!(performance.now())
    const initial = drawing.camera!.position.clone()
    view.focusGalaxy('wildfire')
    drawing.frame!(performance.now() + 1600)
    expect(drawing.camera!.position.distanceTo(initial)).toBeGreaterThan(100)
    expect(callbacks.approached).toHaveBeenCalledWith('wildfire')
    const close = drawing.camera!.position.clone()
    const rotation = drawing.camera!.quaternion.clone()
    view.rotate(0.25, 0.1)
    expect(drawing.camera!.position.equals(close)).toBe(true)
    expect(drawing.camera!.quaternion.angleTo(rotation)).toBeGreaterThan(0.1)
    view.focusGalaxy('nature')
    view.zoom(1.4)
    const interrupted = drawing.camera!.position.clone()
    drawing.frame!(performance.now() + 2800)
    expect(drawing.camera!.position.distanceTo(interrupted)).toBeLessThan(0.001)
    expect(callbacks.interrupted).toHaveBeenCalled()
  } finally {
    cleanup()
  }
  expect(drawing.frame).toBeNull()
  expect(drawing.disposed).toBe(true)
})

it('hides organization names until approach and supports pinch travel', () => {
  const { view, host, callbacks, cleanup } = setup()
  try {
    drawing.frame!(performance.now())
    expect(
      callbacks.project.mock
        .lastCall![0].filter((point: { key: string; visible: boolean }) =>
          point.key.startsWith('organization:'),
        )
        .every((point: { visible: boolean }) => !point.visible),
    ).toBe(true)
    host
      .querySelector('canvas')!
      .dispatchEvent(new WheelEvent('wheel', { deltaY: -80, ctrlKey: true, cancelable: true }))
    expect(callbacks.travelled).toHaveBeenLastCalledWith('in')
    view.zoom(0.8)
    expect(callbacks.travelled).toHaveBeenLastCalledWith('out')
  } finally {
    cleanup()
  }
})

it('uses vertical scrolling to move closer and farther without rotating the view', () => {
  const { host, callbacks, cleanup } = setup()
  try {
    drawing.frame!(performance.now())
    const start = drawing.camera!.position.clone()
    const orientation = drawing.camera!.quaternion.clone()
    const canvas = host.querySelector('canvas')!
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 12, deltaY: -80, cancelable: true }))
    expect(drawing.camera!.position.z).toBeLessThan(start.z - 15)
    expect(callbacks.travelled).toHaveBeenLastCalledWith('in')
    expect(drawing.camera!.quaternion.angleTo(orientation)).toBeLessThan(0.001)
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, cancelable: true }))
    expect(callbacks.travelled).toHaveBeenLastCalledWith('out')
    expect(drawing.camera!.position.distanceTo(start)).toBeLessThan(0.001)
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, cancelable: true }))
    expect(drawing.camera!.quaternion.angleTo(orientation)).toBeLessThan(0.001)
    expect(drawing.camera!.position.distanceTo(start)).toBeLessThan(0.001)
  } finally {
    cleanup()
  }
})

it('flies substantially closer to another galaxy and keeps other galaxies selectable in the viewing direction', () => {
  const { view, callbacks, cleanup } = setup()
  const clock = vi.spyOn(performance, 'now')
  try {
    let time = performance.now()
    clock.mockReturnValue(time)
    view.focusGalaxy('wildfire')
    drawing.frame!((time += 1600))
    const start = drawing.camera!.position.clone()
    const destination = start.clone().fromArray(galaxyPosition('education'))
    const originalDistance = start.distanceTo(destination)
    clock.mockReturnValue(time)
    view.focusGalaxy('education')
    drawing.frame!((time += 700))
    expect(drawing.camera!.position.distanceTo(start)).toBeGreaterThan(50)
    drawing.frame!((time += 900))
    expect(drawing.camera!.position.distanceTo(destination)).toBeLessThan(originalDistance * 0.6)
    drawing.camera!.lookAt(...galaxyPosition('wildfire'))
    drawing.frame!((time += 17))
    expect(
      callbacks.project.mock.lastCall![0].find(
        (point: { key: string }) => point.key === 'galaxy:wildfire',
      ).visible,
    ).toBe(true)
  } finally {
    clock.mockRestore()
    cleanup()
  }
})

it('turns from Flood toward Storm then automatically travels close even with a tall mobile header', () => {
  const { view, host, callbacks, cleanup } = setup(300)
  const clock = vi.spyOn(performance, 'now')
  try {
    Object.defineProperty(host, 'clientWidth', { value: 390 })
    drawing.resize!()
    let time = performance.now()
    clock.mockReturnValue(time)
    view.focusGalaxy('flood')
    drawing.frame!((time += 1600))
    const start = drawing.camera!.position.clone()
    const orientation = drawing.camera!.quaternion.clone()
    const target = start.clone().fromArray(galaxyPosition('storm'))
    const initialDistance = start.distanceTo(target)
    clock.mockReturnValue(time)
    view.focusGalaxy('storm')
    expect(drawing.camera!.position.distanceTo(start)).toBeLessThan(0.001)
    drawing.frame!((time += 180))
    expect(drawing.camera!.quaternion.angleTo(orientation)).toBeGreaterThan(0.05)
    expect(drawing.camera!.position.distanceTo(start)).toBeLessThan(0.001)
    drawing.frame!((time += 350))
    expect(drawing.camera!.position.distanceTo(start)).toBeGreaterThan(30)
    const forward = drawing.camera!.getWorldDirection(start.clone())
    const destinationDirection = target.clone().sub(drawing.camera!.position).normalize()
    expect(forward.dot(destinationDirection)).toBeGreaterThan(0.99)
    drawing.frame!((time += 1070))
    expect(drawing.camera!.position.distanceTo(target)).toBeLessThan(240)
    expect(drawing.camera!.position.distanceTo(target)).toBeLessThan(initialDistance * 0.5)
    expect(callbacks.approached).toHaveBeenLastCalledWith('storm')
  } finally {
    clock.mockRestore()
    cleanup()
  }
})

it('pans with Shift and a trackpad while retaining the viewing direction and pinch zoom', () => {
  const { host, callbacks, cleanup } = setup()
  try {
    drawing.frame!(performance.now())
    const start = drawing.camera!.position.clone()
    const orientation = drawing.camera!.quaternion.clone()
    const canvas = host.querySelector('canvas')!
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: 70,
        deltaY: -45,
        shiftKey: true,
        cancelable: true,
      }),
    )
    expect(drawing.camera!.position.x).toBeGreaterThan(start.x)
    expect(drawing.camera!.position.y).toBeGreaterThan(start.y)
    const shift = drawing.camera!.position.clone().sub(start)
    const forward = drawing.camera!.getWorldDirection(start.clone())
    expect(shift.dot(forward)).toBeCloseTo(0)
    expect(drawing.camera!.quaternion.angleTo(orientation)).toBeLessThan(0.001)
    expect(callbacks.travelled).not.toHaveBeenCalled()
    expect(callbacks.interrupted).toHaveBeenCalled()
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -50,
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    )
    expect(drawing.camera!.position.z).toBeLessThan(start.z)
    expect(callbacks.travelled).toHaveBeenLastCalledWith('in')
  } finally {
    cleanup()
  }
})

it('finishes Corvus with a pause and keeps its framing when the completion notice changes height', () => {
  const { host, view, state, callbacks, cleanup } = setup(260)
  const clock = vi.spyOn(performance, 'now')
  try {
    Object.defineProperty(host, 'clientWidth', { value: 390 })
    drawing.resize!()
    const records = Array.from({ length: 4 }, (_, index) => ({
      ...demoData.contributions[2],
      id: `corvus-${index}`,
    }))
    const groups = constellations(records, demoData.organizations)
    const revealState: SpaceState = {
      ...state,
      groups,
      seen: [],
      revealing: 'corvus',
      collection: [
        {
          patternId: 'corvus',
          category: groups[0].category,
          contributionIds: records.map((entry) => entry.id),
        },
      ],
    }
    view.update(revealState)
    let time = performance.now()
    clock.mockReturnValue(time)
    view.focusConstellation('corvus')
    drawing.frame!((time += 1600))
    const before = drawing.camera!.position.clone()
    const orientation = drawing.camera!.quaternion.clone()
    const projection = drawing.camera!.projectionMatrix.clone()
    drawing.frame!((time += 3100))
    const object = drawing.scene!.getObjectByName('collection:corvus')!
    const lines = object.children.find(
      (child) => child.type === 'LineSegments',
    ) as ThreeTypes.LineSegments
    expect(lines.geometry.drawRange.count).toBe(8)
    expect(callbacks.revealed).not.toHaveBeenCalled()
    drawing.frame!((time += 1000))
    expect(callbacks.revealed).toHaveBeenCalledExactlyOnceWith('corvus')
    view.update({ ...revealState, revealing: null, seen: ['corvus'] })
    Object.defineProperty(document.querySelector('.cosmos-navigation-header'), 'offsetHeight', {
      value: 200,
    })
    drawing.resize!()
    drawing.frame!((time += 17))
    expect(drawing.camera!.position.distanceTo(before)).toBeLessThan(0.001)
    expect(drawing.camera!.quaternion.angleTo(orientation)).toBeLessThan(0.001)
    expect(drawing.camera!.projectionMatrix.equals(projection)).toBe(true)
    // A close-up on a narrow screen can be over 550 units from the region's center.
    // Looking around must not relabel this as a different location.
    expect(
      before.distanceTo(before.clone().fromArray(galaxyPosition(groups[0].category))),
    ).toBeGreaterThan(550)
    view.rotate(0.01, 0)
    expect(callbacks.approached).not.toHaveBeenCalledWith(null)
  } finally {
    clock.mockRestore()
    cleanup()
  }
})

it('centers the selected star and the organization star cluster in the desktop viewport', () => {
  const { view, host, state, cleanup } = setup()
  const clock = vi.spyOn(performance, 'now')
  try {
    Object.defineProperty(host, 'clientWidth', { value: 1440 })
    drawing.resize!()
    const records = [
      { ...demoData.contributions[2], id: 'center-a' },
      { ...demoData.contributions[2], id: 'center-b' },
    ]
    const groups = constellations(records, demoData.organizations)
    view.update({ ...state, groups, selectedId: 'center-b' })
    let time = performance.now()
    clock.mockReturnValue(time)
    view.focusStar('center-b')
    drawing.frame!((time += 1600))
    const star = drawing.scene!.getObjectByName('star:center-b')!
    expect(
      drawing.camera!.position.distanceTo(star.getWorldPosition(star.position.clone())),
    ).toBeLessThan(100)
    const projected = star.getWorldPosition(star.position.clone()).project(drawing.camera!)
    expect(projected.x).toBeCloseTo(0, 5)
    expect(projected.y).toBeCloseTo(0, 5)
    clock.mockReturnValue(time)
    view.update({ ...state, groups, selectedCluster: groups[0].key })
    view.focusOrganization(groups[0].key)
    drawing.frame!((time += 1600))
    const a = drawing.scene!.getObjectByName('star:center-a')!
    const center = a
      .getWorldPosition(a.position.clone())
      .add(star.getWorldPosition(star.position.clone()))
      .multiplyScalar(0.5)
      .project(drawing.camera!)
    expect(center.x).toBeCloseTo(0, 5)
    expect(center.y).toBeCloseTo(0, 5)
  } finally {
    clock.mockRestore()
    cleanup()
  }
})

it('traces constellation lines before completing a discovery and does not duplicate contribution stars', () => {
  const { view, state, host, callbacks, cleanup } = setup()
  try {
    const records = Array.from({ length: 3 }, (_, index) => ({
      ...demoData.contributions[2],
      id: `reveal-${index}`,
    }))
    const collection = reconcileCollection(
      'reveal-account',
      records,
      demoData.organizations,
      emptyCollection(),
    )
    const plan = collection.plans[0]
    const revealState = {
      ...state,
      groups: constellations(records, demoData.organizations),
      collection: collection.plans,
      seen: [],
      revealing: plan.patternId,
    }
    view.update(revealState)
    view.focusConstellation(plan.patternId)
    let time = performance.now()
    for (let i = 0; i < 90; i++) drawing.frame!((time += 17))
    const object = drawing.scene!.getObjectByName(`collection:${plan.patternId}`)!
    const line = object.children.find(
      (child) => child.type === 'LineSegments',
    ) as ThreeTypes.LineSegments
    expect(callbacks.revealed).not.toHaveBeenCalled()
    const projected = callbacks.project.mock.lastCall![0]
    expect(
      projected.filter(
        (point: { key: string; visible: boolean }) =>
          point.key.startsWith('organization:') && point.visible,
      ),
    ).toEqual([])
    const visibleStars = projected.filter(
      (point: { key: string; visible: boolean }) => point.key.startsWith('star:') && point.visible,
    )
    expect(visibleStars).toHaveLength(3)
    const ys = visibleStars.map((point: { y: number }) => point.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(200)
    for (let i = 0; i < 75; i++) drawing.frame!((time += 17))
    expect(line.geometry.drawRange.count).toBeGreaterThan(0)
    expect(callbacks.revealed).not.toHaveBeenCalled()
    // Slow rendering must not turn a short reveal into a minute-long wait.
    for (let i = 0; i < 7; i++) drawing.frame!((time += 500))
    expect(callbacks.revealed).toHaveBeenCalledExactlyOnceWith(plan.patternId)
    view.update({ ...revealState, seen: [plan.patternId], revealing: null })
    drawing.frame!((time += 17))
    expect(
      callbacks.project.mock.lastCall![0].some(
        (point: { key: string; visible: boolean }) =>
          point.key.startsWith('organization:') && point.visible,
      ),
    ).toBe(true)
    const stars: ThreeTypes.Object3D[] = []
    drawing.scene!.traverse((object) => {
      if (object.name.startsWith('star:')) stars.push(object)
    })
    expect(stars).toHaveLength(3)
    expect(line.geometry.drawRange.count).toBe(line.geometry.getAttribute('position').count)
    Object.defineProperties(host, {
      clientWidth: { value: 390 },
      clientHeight: { value: 780 },
    })
    drawing.resize!()
    drawing.frame!((time += 17))
    const portraitStars = callbacks.project.mock.lastCall![0].filter((point: { key: string }) =>
      point.key.startsWith('star:'),
    )
    expect(portraitStars).toHaveLength(3)
    expect(portraitStars.every((point: { visible: boolean }) => point.visible)).toBe(true)
  } finally {
    cleanup()
  }
})

it('draws organization connections progressively after camera arrival', () => {
  const { view, state, cleanup } = setup()
  try {
    view.update({ ...state, selectedCluster: state.groups[0].key })
    view.focusOrganization(state.groups[0].key)
    let time = performance.now()
    for (let i = 0; i < 90; i++) drawing.frame!((time += 17))
    const group = drawing.scene!.getObjectByName(`organization:${state.groups[0].key}`)!
    const line = group.children.find(
      (child) => child.type === 'LineSegments',
    ) as ThreeTypes.LineSegments
    for (let i = 0; i < 25; i++) drawing.frame!((time += 17))
    const midway = Array.from(line.geometry.getAttribute('position').array)
    for (let i = 0; i < 60; i++) drawing.frame!((time += 17))
    expect(Array.from(line.geometry.getAttribute('position').array)).not.toEqual(midway)
  } finally {
    cleanup()
  }
})

it('starts at the clicked star and restarts when another star in the same organization is selected', () => {
  const { view, state, cleanup } = setup()
  const clock = vi.spyOn(performance, 'now')
  try {
    const records = [
      { ...demoData.contributions[2], id: 'first-star' },
      { ...demoData.contributions[2], id: 'second-star' },
    ]
    const groups = constellations(records, demoData.organizations)
    const collection = reconcileCollection(
      'click-origin',
      records,
      demoData.organizations,
      emptyCollection(),
    )
    let time = performance.now()
    for (const record of records) {
      clock.mockReturnValue(time)
      view.update({ ...state, groups, collection: collection.plans, selectedId: record.id })
      view.focusOrganization(groups[0].key)
      for (let i = 0; i < 90; i++) drawing.frame!((time += 17))
      const star = drawing.scene!.getObjectByName(`star:${record.id}`)!
      const line = star.parent!.children.find(
        (object) => object.type === 'LineSegments',
      ) as ThreeTypes.LineSegments
      const vertices = line.geometry.getAttribute('position')
      expect(vertices.getX(0)).toBeCloseTo(star.position.x, 4)
      expect(vertices.getY(0)).toBeCloseTo(star.position.y, 4)
      expect(vertices.getZ(0)).toBeCloseTo(star.position.z, 4)
      const tipDistance = Math.hypot(vertices.getX(1), vertices.getY(1), vertices.getZ(1))
      expect(tipDistance).toBeGreaterThan(0)
      expect(tipDistance).toBeLessThan(star.position.length())
      for (let i = 0; i < 90; i++) drawing.frame!((time += 17))
      expect([vertices.getX(1), vertices.getY(1), vertices.getZ(1)]).toEqual([0, 0, 0])
    }
  } finally {
    clock.mockRestore()
    cleanup()
  }
})

it('draws a persistent constellation connection for a single selected contribution', () => {
  const { view, state, callbacks, cleanup } = setup()
  try {
    view.update({ ...state, selectedId: state.groups[0].contributions[0].id })
    view.focusOrganization(state.groups[0].key)
    drawing.frame!(performance.now() + 1600)
    const lines: ThreeTypes.LineSegments[] = []
    drawing.scene!.traverse((object) => {
      if (object.type === 'LineSegments') lines.push(object as ThreeTypes.LineSegments)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].visible).toBe(true)
    expect(lines[0].geometry.getAttribute('position').count).toBe(2)
    const position = lines[0].parent!.position.clone()
    drawing.frame!(performance.now() + 6000)
    expect(lines[0].visible).toBe(true)
    expect(lines[0].parent!.position.equals(position)).toBe(true)
    const projected = callbacks.project.mock.lastCall![0]
    expect(projected.find((point: { key: string }) => point.key.startsWith('star:')).visible).toBe(
      true,
    )
    view.update(state)
    drawing.frame!(performance.now() + 6500)
    expect(lines[0].visible).toBe(false)
  } finally {
    cleanup()
  }
})

it('pauses twinkling and reports WebGL context loss without deleting records', () => {
  const { view, state, host, callbacks, cleanup } = setup()
  try {
    drawing.frame!(performance.now())
    const lines: ThreeTypes.LineSegments[] = []
    drawing.scene!.traverse((object) => {
      if (object.type === 'LineSegments') lines.push(object as ThreeTypes.LineSegments)
    })
    view.update({ ...state, paused: true })
    const position = lines[0].parent!.position.clone()
    drawing.frame!(performance.now() + 300)
    expect(lines[0].parent!.position.equals(position)).toBe(true)
    const star = lines[0].parent!.children.find(
      (object) => object.type === 'Points',
    ) as ThreeTypes.Points<ThreeTypes.BufferGeometry, ThreeTypes.ShaderMaterial>
    expect(star.material.uniforms.opacity.value).toBe(1)
    host.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(callbacks.failed).toHaveBeenCalledOnce()
    expect(drawing.frame).toBeNull()
    expect(state.groups[0].contributions).toHaveLength(1)
  } finally {
    cleanup()
  }
})

it('keeps foreground stars fixed in space while the distant sky follows travel', () => {
  const { view, cleanup } = setup()
  try {
    drawing.frame!(performance.now())
    const start = drawing.camera!.position.clone()
    const near = drawing.scene!.getObjectByName('nearby-stars')!
    const earth = drawing.scene!.getObjectByName('earth-below')!
    const earthPosition = earth.position.clone()
    expect(earth.position.x).toBe(start.x)
    expect(earth.position.z).toBe(start.z)
    expect(earth.position.y).toBeLessThan(start.y)
    const surface = earth.children[0] as ThreeTypes.Mesh<ThreeTypes.SphereGeometry>
    const radius = surface.geometry.parameters.radius
    const distance = start.distanceTo(earth.position)
    const limb = start
      .clone()
      .set(
        0,
        -distance + (radius * radius) / distance,
        -radius * Math.sqrt(1 - (radius / distance) ** 2),
      )
      .project(drawing.camera!)
    expect((1 - limb.y) / 2).toBeCloseTo(6 / 7, 3)
    const fixed = near.position.clone()
    view.zoom(1.4)
    drawing.frame!(performance.now() + 100)
    expect(drawing.camera!.position.distanceTo(start)).toBeGreaterThan(20)
    expect(near.position.equals(fixed)).toBe(true)
    expect(earth.position.equals(earthPosition)).toBe(true)
    expect(
      drawing.scene!.getObjectByName('distant-sky')!.position.equals(drawing.camera!.position),
    ).toBe(true)
    view.reset()
    drawing.frame!(performance.now() + 1700)
    expect(drawing.camera!.position.distanceTo(start)).toBeLessThan(0.001)
  } finally {
    cleanup()
  }
})

it('uses instant camera transitions when reduced motion is enabled', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const { view, cleanup } = setup()
  try {
    drawing.frame!(performance.now())
    const start = drawing.camera!.position.clone()
    view.focusGalaxy('conflict')
    expect(drawing.camera!.position.distanceTo(start)).toBeGreaterThan(100)
    const destination = drawing.camera!.position.clone()
    drawing.frame!(performance.now() + 500)
    expect(drawing.camera!.position.equals(destination)).toBe(true)
  } finally {
    cleanup()
  }
})
