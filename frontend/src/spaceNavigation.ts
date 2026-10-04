import * as THREE from 'three'

export type NavigationDirection = 'in' | 'out'

// Look from the current position instead of orbiting an object outside the scene.
export function createSpaceNavigation(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  interrupt: () => void,
  changed: () => void,
  travelled?: (direction: NavigationDirection) => void,
  scrollSurface?: HTMLElement | null,
  panDepth: () => number = () => 400,
) {
  const pointers = new Map<number, { x: number; y: number }>()
  const orientation = new THREE.Euler(0, 0, 0, 'YXZ')
  const direction = new THREE.Vector3()
  let pinchDistance = 0
  function pan(horizontal: number, vertical: number) {
    if (!horizontal && !vertical) return
    const scale =
      (2 * panDepth() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
      Math.max(canvas.clientHeight || canvas.height, 1)
    interrupt()
    direction.set(-horizontal * scale, vertical * scale, 0).applyQuaternion(camera.quaternion)
    camera.position.add(direction).clampLength(0, 10000)
    changed()
  }
  function rotate(horizontal: number, vertical: number) {
    interrupt()
    orientation.setFromQuaternion(camera.quaternion, 'YXZ')
    orientation.y += horizontal
    orientation.x = THREE.MathUtils.clamp(
      orientation.x + vertical,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    )
    orientation.z = 0
    camera.quaternion.setFromEuler(orientation)
    changed()
  }
  function travel(distance: number) {
    if (distance === 0) return
    interrupt()
    camera.getWorldDirection(direction)
    camera.position.addScaledVector(direction, distance)
    camera.position.clampLength(0, 10000)
    changed()
    travelled?.(distance > 0 ? 'in' : 'out')
  }
  function separation() {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    interrupt()
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const surface = event.currentTarget as HTMLElement
    surface.setPointerCapture(event.pointerId)
    pinchDistance = separation()
  }
  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 1) {
      if (event.shiftKey) pan(event.clientX - previous.x, event.clientY - previous.y)
      else rotate((event.clientX - previous.x) * 0.003, (event.clientY - previous.y) * 0.003)
    } else {
      const next = separation()
      if (pinchDistance > 0 && next > 0) travel(Math.log(next / pinchDistance) * 160)
      pinchDistance = next
    }
  }
  function up(event: PointerEvent) {
    pointers.delete(event.pointerId)
    pinchDistance = separation()
    const surface = event.currentTarget as HTMLElement
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
  }
  function wheel(event: WheelEvent) {
    event.preventDefault()
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1
    if (event.shiftKey && !event.ctrlKey) {
      pan(-event.deltaX * units, -event.deltaY * units)
      return
    }
    travel(-THREE.MathUtils.clamp(event.deltaY * units, -180, 180) * 0.24)
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('lostpointercapture', up)
  canvas.addEventListener('wheel', wheel, { passive: false })
  scrollSurface?.addEventListener('wheel', wheel, { passive: false })
  return {
    rotate,
    zoom(factor: number) {
      if (factor > 0) travel(Math.log(factor) * 160)
    },
    dispose() {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('lostpointercapture', up)
      canvas.removeEventListener('wheel', wheel)
      scrollSurface?.removeEventListener('wheel', wheel)
      for (const id of pointers.keys())
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
      pointers.clear()
    },
  }
}
