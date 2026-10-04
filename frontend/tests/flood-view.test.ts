import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { floodFocus, sortFloods } from '../src/floodView'
import type { Flood, Gdacs } from '../src/layers/data'
import { polygonsContain } from '../src/layers/geo'

it('finds a close-view focus inside each real event rather than framing entire countries', () => {
  const data = JSON.parse(readFileSync('public/data/gdacs.json', 'utf8')) as Gdacs
  const original = JSON.stringify(data)
  for (const flood of data.floods)
    expect(polygonsContain(flood.polygons, floodFocus(flood))).toBe(true)
  const ordered = sortFloods(data.floods)
  expect(ordered[0].alert).toBe('Red')
  expect(JSON.stringify(data)).toBe(original)
})

it('never centres a close view in a polygon hole or between separated pieces', () => {
  const flood = {
    center: [1, 1],
    polygons: [
      [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
          [0.5, 0.5],
        ],
      ],
    ],
  } as Flood
  expect(polygonsContain(flood.polygons, floodFocus(flood))).toBe(true)
  flood.center = [20, 20]
  expect(polygonsContain(flood.polygons, floodFocus(flood))).toBe(true)
})
