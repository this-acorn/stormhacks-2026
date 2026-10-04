import * as THREE from 'three'
import { ageOf, GALAXIES, hashId } from './cosmosModel'
import type { Constellation, GalaxyId } from './cosmosModel'
import {
  contributionPosition,
  galaxyPosition,
  organizationPosition,
  seededRandom,
  selectedOrganization,
} from './cosmosSpace'
import { disposeObject, nebulaMaterial, pointMaterial } from './spaceMaterials'
import { createCosmosEarth } from './cosmosEarth'
import { createSpaceNavigation } from './spaceNavigation'
import type { NavigationDirection } from './spaceNavigation'
import {
  collectionAnchor,
  collectionSegments,
  collectionStarPosition,
  isComplete,
  patternFor,
} from './constellationCollection'
import type { CollectionPlan } from './constellationCollection'
import { entryEase, STAR_TRANSFER_DURATION } from './cosmosEntry'

export interface SpaceState {
  entryStar?: string
  groups: Constellation[]
  selectedId: string | null
  selectedCluster: string | null
  paused: boolean
  now: number
  flashing: string[]
  collection?: CollectionPlan[]
  seen?: string[]
  revealing?: string | null
}
export interface SpaceProjection {
  key: string
  x: number
  y: number
  visible: boolean
}
export interface SpaceCallbacks {
  entryReady?: (point: SpaceProjection) => void
  project: (points: SpaceProjection[]) => void
  approached: (id: GalaxyId | null) => void
  interrupted: () => void
  failed: () => void
  revealed?: (id: string) => void
  travelled?: (direction: NavigationDirection) => void
}
export interface SpaceRenderer {
  update: (state: SpaceState) => void
  focusGalaxy: (id: GalaxyId) => void
  focusOrganization: (key: string) => void
  focusStar: (id: string) => void
  focusConstellation: (id: string) => void
  reset: () => void
  zoom: (factor: number) => void
  rotate: (horizontal: number, vertical: number) => void
  dispose: () => void
}

export function createSpaceRenderer(
  host: HTMLElement,
  initial: SpaceState,
  callbacks: SpaceCallbacks,
): SpaceRenderer {
  let state = initial
  let entryReported = false
  let entryStarted: number | null = null
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#020308')
  const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 10000)
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.domElement.setAttribute('aria-hidden', 'true')
  renderer.domElement.className = 'cosmos-canvas'
  host.prepend(renderer.domElement)
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const home = new THREE.Vector3(0, 0, 0)
  let atHome = true
  camera.position.copy(home)
  let width = 1,
    height = 1,
    elapsed = 0,
    lastFrame = 0,
    disposed = false
  let usableWidth = 1,
    usableHeight = 1
  let frameTop = 0,
    frameBottom = 0,
    frameHeight = 1,
    frameWidth = 1
  let approached: GalaxyId | null = null
  let approachExitDistance = 550
  let constellationFrameLocked = false
  let framedSelection = false
  let panDepth = 600
  let selectedTraceKey: string | null = null,
    selectedTraceStart: number | null = null
  let selectedSegments: number[] = []
  let revealKey: string | null = null,
    revealStart: number | null = null
  const completedReveals = new Set<string>()
  let framing: {
    target: THREE.Vector3
    category: GalaxyId
    minimum: number
    portrait: number
    fitPattern: boolean
    extent?: { x: number; y: number }
  } | null = null
  let flight: {
    started: number
    from: THREE.Vector3
    to: THREE.Vector3
    fromRotation: THREE.Quaternion
    rotation: THREE.Quaternion
    target?: THREE.Vector3
  } | null = null
  const dataRoot = new THREE.Group()
  dataRoot.name = 'contributions'
  scene.add(dataRoot)
  const world = new THREE.Vector3(),
    projected = new THREE.Vector3()
  const centers = new Map<GalaxyId, THREE.Group>()
  const markers = new Map<GalaxyId, THREE.Object3D>()
  type Member = {
    group: Constellation
    object: THREE.Group
    links: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    stars: { id: string; object: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> }[]
    segments: number[]
  }
  let members: Member[] = []
  let drawings: {
    plan: CollectionPlan
    object: THREE.Group
    marker: THREE.Object3D
    lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    segments: number[]
  }[] = []

  function points(
    positions: number[],
    colors: number[],
    size: number,
    opacity: number,
    perspective = 0,
    scales?: number[],
  ) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('tint', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute(
      'scale',
      new THREE.Float32BufferAttribute(
        scales ?? positions.filter((_, i) => i % 3 === 0).map(() => 1),
        1,
      ),
    )
    const material = pointMaterial(size, opacity, perspective)
    material.uniforms.pixelRatio.value = renderer.getPixelRatio()
    return new THREE.Points(geometry, material)
  }

  const sky = new THREE.Group()
  sky.name = 'distant-sky'
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(7500, 32, 24), nebulaMaterial())
  nebula.renderOrder = -2
  sky.add(nebula)
  const random = seededRandom(1986)
  const positions: number[] = [],
    colors: number[] = [],
    scales: number[] = []
  const bandRotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0.55, 0.83, 0.15).normalize(),
  )
  for (let i = 0; i < 15000; i++) {
    const angle = random() * Math.PI * 2
    const latitude = i < 6500 ? Math.asin(random() * 2 - 1) : (random() - 0.5) * 0.3
    const radius = 4200 + random() * 1300
    const p = new THREE.Vector3(
      Math.cos(angle) * Math.cos(latitude) * radius,
      Math.sin(latitude) * radius,
      Math.sin(angle) * Math.cos(latitude) * radius,
    ).applyQuaternion(bandRotation)
    positions.push(...p.toArray())
    const light = 0.18 + Math.pow(random(), 3) * 0.82
    const warm = random() > 0.8
    colors.push(light * (warm ? 1 : 0.82), light * 0.88, light * (warm ? 0.72 : 1))
    scales.push(0.45 + Math.pow(random(), 4) * 1.3)
  }
  sky.add(points(positions, colors, 4.2, 0.9, 0, scales))
  scene.add(sky)
  const earth = createCosmosEarth()
  scene.add(earth.globe, earth.light, earth.ambient)
  // Earth's upper limb enters at 6/7 of the viewport height in the starting view.
  const earthAngle = Math.asin(earth.radius / home.distanceTo(earth.globe.position))
  const limbAngle = Math.atan((5 / 7) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
  const homeRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2 + earthAngle + limbAngle, 0, 0),
  )
  camera.quaternion.copy(homeRotation)

  // Actual world-space stars create parallax when travelling through the field.
  const nearbyPositions: number[] = [],
    nearbyColors: number[] = [],
    nearbyScales: number[] = []
  for (let i = 0; i < 1400; i++) {
    const p = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5)
      .normalize()
      .multiplyScalar(135 + random() * 1950)
    nearbyPositions.push(...p.toArray())
    const light = 0.2 + random() * 0.5
    nearbyColors.push(light * 0.8, light * 0.88, light)
    nearbyScales.push(0.5 + random())
  }
  const nearby = points(nearbyPositions, nearbyColors, 5.5, 0.68, 800, nearbyScales)
  nearby.name = 'nearby-stars'
  scene.add(nearby)

  function rebuild() {
    disposeObject(dataRoot)
    dataRoot.clear()
    centers.clear()
    markers.clear()
    members = []
    drawings = []
    selectedTraceKey = null
    selectedTraceStart = null
    selectedSegments = []
    const placements = new Map<string, [number, number, number]>()
    for (const plan of state.collection ?? [])
      plan.contributionIds.forEach((id, index) =>
        placements.set(id, collectionStarPosition(plan, index, state.collection!)),
      )
    for (const galaxy of GALAXIES) {
      if (
        galaxy.id === 'unclassified' &&
        !state.groups.some((group) => group.category === galaxy.id)
      )
        continue
      const center = new THREE.Group()
      center.position.fromArray(galaxyPosition(galaxy.id))
      centers.set(galaxy.id, center)
      dataRoot.add(center)
      center.lookAt(home)
      const marker = new THREE.Object3D()
      marker.position.set(0, 70, 0)
      center.add(marker)
      markers.set(galaxy.id, marker)
    }
    for (const group of state.groups) {
      const object = new THREE.Group()
      object.name = `organization:${group.key}`
      object.position.fromArray(organizationPosition(group.key))
      centers.get(group.category)!.add(object)
      const stars = group.contributions.map((entry) => {
        const color = new THREE.Color(ageOf(entry, state.now).color)
        const star = points([0, 0, 0], color.toArray(), 29, 1, 240)
        star.name = `star:${entry.id}`
        const placement = placements.get(entry.id)
        if (placement) star.position.fromArray(placement).sub(object.position)
        else star.position.fromArray(contributionPosition(entry.id))
        star.renderOrder = 2
        object.add(star)
        return { id: entry.id, object: star }
      })
      const segments = stars.flatMap((star) => [0, 0, 0, ...star.object.position.toArray()])
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3))
      const links = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color: '#c4d4eb',
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
        }),
      )
      links.visible = false
      object.add(links)
      members.push({ group, object, links, stars, segments })
    }
    for (const plan of state.collection ?? []) {
      const object = new THREE.Group()
      object.name = `collection:${plan.patternId}`
      object.position.fromArray(collectionAnchor(plan, state.collection!))
      centers.get(plan.category)?.add(object)
      const marker = new THREE.Object3D()
      marker.position.set(0, -90, 0)
      object.add(marker)
      const segments = collectionSegments(plan)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3))
      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color: '#d3dff2',
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
        }),
      )
      lines.visible = false
      object.add(lines)
      drawings.push({ plan, object, marker, lines, segments })
    }
    scene.updateMatrixWorld(true)
  }

  function markApproach(id: GalaxyId | null) {
    if (approached === id) return
    constellationFrameLocked = false
    framing = null
    approached = id
    approachExitDistance = 550
    resize()
    callbacks.approached(id)
  }
  function interrupt() {
    atHome = false
    flight = null
    framing = null
    constellationFrameLocked = false
    callbacks.interrupted()
  }
  const navigation = createSpaceNavigation(
    camera,
    renderer.domElement,
    interrupt,
    () => {
      const aboveEarth = camera.position.clone().sub(earth.globe.position)
      if (aboveEarth.length() < 1250)
        camera.position.copy(aboveEarth.setLength(1250).add(earth.globe.position))
      if (approached) {
        const center = centers.get(approached)
        if (center && camera.position.distanceTo(center.position) > approachExitDistance)
          markApproach(null)
      } else {
        const nearest = [...centers].sort(
          (a, b) =>
            camera.position.distanceToSquared(a[1].position) -
            camera.position.distanceToSquared(b[1].position),
        )[0]
        if (nearest && camera.position.distanceTo(nearest[1].position) < 290)
          markApproach(nearest[0])
      }
    },
    callbacks.travelled,
    host.parentElement?.querySelector<HTMLElement>('.cosmos-trackpad'),
    () => panDepth,
  )
  function move(to: THREE.Vector3, rotation: THREE.Quaternion, target?: THREE.Vector3) {
    if (motion.matches || state.paused) {
      flight = null
      camera.position.copy(to)
      camera.quaternion.copy(rotation)
    } else {
      flight = {
        started: performance.now(),
        from: camera.position.clone(),
        to,
        fromRotation: camera.quaternion.clone(),
        rotation,
        target: target?.clone(),
      }
    }
  }
  function faceRegion(
    target: THREE.Vector3,
    category: GalaxyId,
    minimum: number,
    portrait: number,
    animate = true,
    fitPattern = true,
    extent?: { x: number; y: number },
  ) {
    atHome = false
    if (animate) constellationFrameLocked = false
    framing = { target: target.clone(), category, minimum, portrait, fitPattern, extent }
    let distance = fitPattern
      ? Math.max(
          frameTop ? (minimum * height * 0.7) / frameHeight : minimum,
          (portrait * height) / frameWidth,
        )
      : minimum
    if (extent) {
      const centerY = width > 700 ? height / 2 : (frameTop + height - frameBottom) / 2
      const top = frameTop || Math.min(170, usableHeight * 0.3)
      const bottom = frameTop ? height - frameBottom : usableHeight - 125
      const availableHeight = Math.max(
        80,
        Math.min(frameHeight, 2 * Math.min(centerY - top, bottom - centerY)) - 40,
      )
      const availableWidth = Math.max(80, frameWidth - 100)
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      distance = Math.max(
        50,
        (extent.x * height) / (availableWidth * tangent),
        (extent.y * height) / (availableHeight * tangent),
      )
    }
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(centers.get(category)!.quaternion)
    const destination = target.clone().addScaledVector(normal, distance)
    panDepth = distance
    approachExitDistance = Math.max(
      550,
      destination.distanceTo(centers.get(category)!.position) + 260,
    )
    const rotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(destination, target, camera.up),
    )
    if (animate) move(destination, rotation, target)
    else if (flight) {
      flight.to.copy(destination)
      flight.rotation.copy(rotation)
    } else {
      flight = null
      camera.position.copy(destination)
      camera.quaternion.copy(rotation)
    }
  }

  function trace(geometry: THREE.BufferGeometry, segments: number[], fraction: number) {
    const progress = (THREE.MathUtils.clamp(fraction, 0, 1) * segments.length) / 6
    const positions = geometry.getAttribute('position')
    for (let edge = 0; edge < segments.length / 6; edge++) {
      const t = THREE.MathUtils.clamp(progress - edge, 0, 1)
      const i = edge * 6
      positions.setXYZ(edge * 2, segments[i], segments[i + 1], segments[i + 2])
      positions.setXYZ(
        edge * 2 + 1,
        segments[i] + (segments[i + 3] - segments[i]) * t,
        segments[i + 1] + (segments[i + 4] - segments[i + 1]) * t,
        segments[i + 2] + (segments[i + 5] - segments[i + 2]) * t,
      )
    }
    positions.needsUpdate = true
    geometry.setDrawRange(0, Math.ceil(progress) * 2)
  }
  const navigationHeader = host.parentElement?.querySelector<HTMLElement>(
    '.cosmos-navigation-header',
  )
  function resize() {
    const nextWidth = Math.max(host.clientWidth, 1)
    const nextHeight = Math.max(host.clientHeight, 1)
    const selected = Boolean(state.selectedId || state.selectedCluster)
    // A collection notice changes the header, not the view the user just arrived at.
    // Hold that composition once the flight lands; real viewport changes still refit it.
    if (
      constellationFrameLocked &&
      nextWidth === width &&
      nextHeight === height &&
      selected === framedSelection
    )
      return
    width = nextWidth
    height = nextHeight
    framedSelection = selected
    renderer.setSize(width, height)
    camera.aspect = width / height
    if (atHome) {
      if (flight) flight.to.copy(home)
      else camera.position.copy(home)
    }
    const side = selected && width > 700 ? 410 : 0
    const bottom = selected && width <= 700 ? window.innerHeight * 0.48 : 0
    usableWidth = Math.max(1, width - side)
    usableHeight = Math.max(1, height - bottom)
    frameTop =
      approached && navigationHeader
        ? navigationHeader.offsetTop + navigationHeader.offsetHeight + 18
        : 0
    frameBottom = bottom + (frameTop ? (width <= 700 ? (selected ? 58 : 235) : 140) : 0)
    const centerX = selected && width <= 1100 ? usableWidth / 2 : width / 2
    const centerY = width > 700 ? height / 2 : (frameTop + height - frameBottom) / 2
    frameWidth = Math.max(100, 2 * Math.min(centerX, usableWidth - centerX))
    frameHeight = Math.max(80, 2 * Math.min(centerY - frameTop, height - frameBottom - centerY))
    // Desktop selections sit at screen center. On mobile, keep the focal point
    // in the visible space above the detail sheet and below the navigation.
    camera.setViewOffset(width, height, width / 2 - centerX, height / 2 - centerY, width, height)
    camera.updateProjectionMatrix()
    if (framing)
      faceRegion(
        framing.target,
        framing.category,
        framing.minimum,
        framing.portrait,
        false,
        framing.fitPattern,
        framing.extent,
      )
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  if (navigationHeader) observer.observe(navigationHeader)
  resize()
  rebuild()
  if (state.entryStar) focusStar(state.entryStar, false)

  function project(
    key: string,
    object: THREE.Object3D,
    visible: boolean,
    result: SpaceProjection[],
  ) {
    object.getWorldPosition(world)
    projected.copy(world).project(camera)
    const x = (projected.x * 0.5 + 0.5) * width
    const y = (-projected.y * 0.5 + 0.5) * height
    const selected = Boolean(state.selectedId || state.selectedCluster)
    const top = frameTop || Math.min(selected ? 125 : 170, usableHeight * 0.3)
    const bottom = frameTop ? height - frameBottom : usableHeight - (selected ? 40 : 125)
    result.push({
      key,
      x,
      y,
      visible:
        visible &&
        projected.z > -1 &&
        projected.z < 1 &&
        x > 40 &&
        x < usableWidth - 40 &&
        y > top &&
        y < bottom,
    })
  }

  function frame(time: number) {
    if (disposed || document.hidden) {
      lastFrame = time
      return
    }
    // Draw connections in elapsed seconds, including on slower graphics devices.
    const delta = lastFrame ? Math.max(0, (time - lastFrame) / 1000) : 0
    lastFrame = time
    const moving = !state.paused && !motion.matches
    if (moving) elapsed += delta
    // Pull the full viewport into focus, keeping the chosen star at the same
    // screen point. Scaling a smaller canvas exposed its rectangular edges.
    const entryProgress =
      entryStarted === null
        ? 0
        : THREE.MathUtils.clamp((time - entryStarted) / STAR_TRANSFER_DURATION, 0, 1)
    const arrival = entryEase(entryProgress, 0.18)
    const zoom = state.entryStar && moving ? 0.62 + 0.38 * arrival : 1
    if (camera.zoom !== zoom) {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
    }
    if (flight) {
      const age = time - flight.started
      const fraction = THREE.MathUtils.clamp(flight.target ? (age - 220) / 1230 : age / 1450, 0, 1)
      const t = moving ? fraction * fraction * (3 - 2 * fraction) : 1
      camera.position.lerpVectors(flight.from, flight.to, t)
      if (flight.target) {
        // Turn toward the destination first, then keep it ahead while travelling there.
        const aim = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(camera.position, flight.target, camera.up),
        )
        const turn = moving ? THREE.MathUtils.smoothstep(age, 0, 450) : 1
        camera.quaternion.slerpQuaternions(flight.fromRotation, aim, turn)
      } else camera.quaternion.slerpQuaternions(flight.fromRotation, flight.rotation, t)
      if (t === 1) flight = null
    }
    if (!flight && framing?.extent) constellationFrameLocked = true
    const selected = selectedOrganization(state.groups, state.selectedId, state.selectedCluster)
    const traceKey = selected ? `${selected.key}/${state.selectedId ?? 'organization'}` : null
    if (selectedTraceKey !== traceKey) {
      selectedTraceKey = traceKey
      selectedTraceStart = null
      const member = members.find((entry) => entry.group.key === selected?.key)
      const origin = member?.stars.find((star) => star.id === state.selectedId)
      // Follow the user's click: the chosen star reaches its organization first,
      // then the organization connects to its remaining contribution stars.
      selectedSegments =
        member && origin
          ? [
              ...origin.object.position.toArray(),
              0,
              0,
              0,
              ...member.stars
                .filter((star) => star !== origin)
                .flatMap((star) => [0, 0, 0, ...star.object.position.toArray()]),
            ]
          : (member?.segments ?? [])
    }
    if (selected && !flight && !state.entryStar && selectedTraceStart === null)
      selectedTraceStart = elapsed
    if (revealKey !== (state.revealing ?? null)) {
      revealKey = state.revealing ?? null
      revealStart = null
    }
    if (revealKey && !flight && revealStart === null) revealStart = elapsed
    for (const member of members) {
      const active = selected?.key === member.group.key
      member.links.visible = active && !state.entryStar
      if (active)
        trace(
          member.links.geometry,
          selectedSegments,
          !moving ? 1 : selectedTraceStart === null ? 0 : (elapsed - selectedTraceStart) / 1.05,
        )
      for (let i = 0; i < member.stars.length; i++) {
        const star = member.stars[i],
          entry = member.group.contributions[i]
        const phase = (hashId(entry.id) % 628) / 100
        const pending = entry.status !== 'organization_confirmed'
        const twinkle = pending && moving ? 0.86 + 0.14 * Math.sin(elapsed * 0.6 + phase) ** 2 : 1
        star.object.material.uniforms.opacity.value = twinkle * (selected && !active ? 0.3 : 1)
        if (state.flashing.includes(entry.id) && moving)
          star.object.material.uniforms.opacity.value = 1.15
        if (state.entryStar === entry.id)
          star.object.material.uniforms.opacity.value *= moving ? entryEase(entryProgress, 0.78) : 1
      }
    }
    for (const drawing of drawings) {
      const complete = isComplete(drawing.plan)
      const seen = state.seen?.includes(drawing.plan.patternId)
      const revealing = state.revealing === drawing.plan.patternId
      const duration = Math.max(2.8, (drawing.segments.length / 6) * 0.6)
      const age = revealStart === null ? 0 : Math.max(0, elapsed - revealStart - 0.2)
      const progress = !moving ? 1 : THREE.MathUtils.clamp(age / duration, 0, 1)
      drawing.lines.visible = complete && Boolean(seen || revealing)
      if (drawing.lines.visible) {
        trace(
          drawing.lines.geometry,
          drawing.segments,
          seen ? 1 : progress * progress * (3 - 2 * progress),
        )
        // Let the finished outline settle before replacing the tracing message.
        const settled = !moving || age >= duration + 0.9
        if (revealing && !seen && settled && !completedReveals.has(drawing.plan.patternId)) {
          completedReveals.add(drawing.plan.patternId)
          callbacks.revealed?.(drawing.plan.patternId)
        }
      }
    }
    sky.position.copy(camera.position)
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)
    const projections: SpaceProjection[] = []
    for (const [id, marker] of markers)
      project(`galaxy:${id}`, marker, id !== approached, projections)
    for (const member of members) {
      const near =
        approached === member.group.category ||
        camera.position.distanceTo(centers.get(member.group.category)!.position) < 290
      const visible = selected ? selected.key === member.group.key : near
      project(
        `organization:${member.group.key}`,
        member.object,
        visible && !state.revealing,
        projections,
      )
      for (const star of member.stars) project(`star:${star.id}`, star.object, visible, projections)
    }
    for (const drawing of drawings)
      project(
        `collection:${drawing.plan.patternId}`,
        drawing.marker,
        isComplete(drawing.plan) && approached === drawing.plan.category && !selected,
        projections,
      )
    callbacks.project(projections)
    renderer.render(scene, camera)
    if (state.entryStar && !entryReported) {
      const point = projections.find(
        (point) => point.key === `star:${state.entryStar}` && point.visible,
      )
      if (point) {
        entryReported = true
        entryStarted = time
        callbacks.entryReady?.(point)
      }
    }
  }
  function focusStar(id: string, animate = true) {
    const member = members.find((entry) => entry.stars.some((star) => star.id === id))
    const star = member?.stars.find((entry) => entry.id === id)
    if (!member || !star) return
    markApproach(member.group.category)
    star.object.getWorldPosition(world)
    faceRegion(world.clone(), member.group.category, 80, 80, animate, false)
  }
  function lost(event: Event) {
    event.preventDefault()
    renderer.setAnimationLoop(null)
    callbacks.failed()
  }
  renderer.domElement.addEventListener('webglcontextlost', lost)
  renderer.setAnimationLoop(frame)

  return {
    update(next) {
      const changed = state.groups !== next.groups || state.collection !== next.collection
      const recolor = state.now !== next.now
      const reframed =
        Boolean(state.selectedId || state.selectedCluster) !==
        Boolean(next.selectedId || next.selectedCluster)
      state = next
      if (reframed) resize()
      if (changed) rebuild()
      else if (recolor) {
        for (const member of members) {
          for (let i = 0; i < member.stars.length; i++) {
            const colors = member.stars[i].object.geometry.getAttribute('tint')
            const color = new THREE.Color(ageOf(member.group.contributions[i], state.now).color)
            colors.setXYZ(0, color.r, color.g, color.b)
            colors.needsUpdate = true
          }
        }
      }
    },
    focusGalaxy(id) {
      markApproach(id)
      // Enter the region even on short/narrow screens. A constellation gets its own
      // fitted framing once selected; header height must not push a galaxy away.
      faceRegion(new THREE.Vector3(...galaxyPosition(id)), id, 220, 220, true, false)
    },
    focusOrganization(key) {
      const member = members.find((item) => item.group.key === key)
      if (!member) return
      markApproach(member.group.category)
      world.set(0, 0, 0)
      for (const star of member.stars) world.add(star.object.getWorldPosition(new THREE.Vector3()))
      world.divideScalar(Math.max(1, member.stars.length))
      faceRegion(world.clone(), member.group.category, 165, 145)
    },
    focusStar,
    focusConstellation(id) {
      const drawing = drawings.find((entry) => entry.plan.patternId === id)
      if (!drawing) return
      markApproach(drawing.plan.category)
      drawing.object.getWorldPosition(world)
      const points = patternFor(id).points
      faceRegion(world.clone(), drawing.plan.category, 0, 0, true, true, {
        x: Math.max(...points.map(([x]) => Math.abs(x))) * 65,
        y: Math.max(...points.map(([, y]) => Math.abs(y))) * 65,
      })
    },
    reset() {
      framing = null
      constellationFrameLocked = false
      panDepth = 600
      markApproach(null)
      atHome = true
      move(home.clone(), homeRotation.clone())
    },
    zoom: navigation.zoom,
    rotate: navigation.rotate,
    dispose() {
      disposed = true
      renderer.setAnimationLoop(null)
      observer.disconnect()
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      navigation.dispose()
      earth.dispose()
      disposeObject(scene)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
