import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const appStyles = readFileSync('src/index.css', 'utf8').replace(/@import[^;]+;/g, '')
const mapStyles = readFileSync('node_modules/maplibre-gl/dist/maplibre-gl.css', 'utf8')

// Reproduces the real CSS conflict without mocking the library stylesheet.
// This verifies the sizing rules; WebGL drawing still needs a real browser.
it.each([
  ['library first', [mapStyles, appStyles]],
  ['library loaded after the app', [appStyles, mapStyles]],
] as const)('keeps the globe container full size: %s', (_, styles) => {
  const elements = styles.map((css) => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    return style
  })
  const scene = document.createElement('div')
  scene.className = 'earth-scene'
  const map = document.createElement('div')
  map.className = 'earth-map maplibregl-map'
  scene.append(map)
  document.body.append(scene)
  try {
    const computed = getComputedStyle(map)
    expect(computed.position).toBe('absolute')
    expect(computed.width).toBe('100%')
    expect(computed.height).toBe('100%')
  } finally {
    scene.remove()
    elements.forEach((element) => element.remove())
  }
})
