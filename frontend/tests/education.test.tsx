import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import EducationExplorer from '../src/components/EducationExplorer'
import {
  educationColor,
  educationTrend,
  observation,
  latestObservation,
  type EducationData,
  type EducationGeometry,
  type EducationStatus,
} from '../src/educationData'
import { educationLayer } from '../src/layers/education'
import type { LayerContext } from '../src/layers/types'

const data: EducationData = {
  schemaVersion: 1,
  source: 'UNESCO Institute for Statistics',
  sourceUrl: 'https://databrowser.uis.unesco.org/resources/bulk',
  release: 'February 2026',
  license: 'CC BY-SA 3.0 IGO',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/igo/',
  years: [2022, 2023, 2024],
  defaultYear: 2024,
  countries: [
    {
      id: 'AAA',
      name: 'Example country',
      center: [1, 2],
      zoom: 3,
      years: {
        '2022': { rate: 18.2, count: 1820, ages: [6, 14], flags: [], notes: [] },
        '2024': { rate: 0, count: 0, ages: [6, 14], flags: ['NAT_EST'], notes: [] },
      },
    },
    { id: 'BBB', name: 'No data country', center: [3, 4], years: {} },
    {
      id: 'CCC',
      name: 'Older report country',
      center: [5, 6],
      years: {
        '2022': { rate: 18.2, count: 1820, ages: [6, 14], flags: [], notes: [] },
      },
    },
  ],
}
const geometry: EducationGeometry = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'AAA',
      properties: { id: 'AAA' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 0],
          ],
        ],
      },
    },
  ],
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Harness({ initialId = 'CCC' }: { initialId?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId)
  const status: EducationStatus = { data, selectedId, coverage: 2 }
  return (
    <EducationExplorer
      status={status}
      error=""
      onCountry={setSelectedId}
      onRetry={vi.fn()}
      withPanel={false}
    />
  )
}

it('shows the latest published year for each country, 100 lights and count without timeline controls', () => {
  const { container } = render(<Harness />)
  expect(container.querySelectorAll('.education-dots i')).toHaveLength(100)
  expect(container.querySelectorAll('.education-dots .empty')).toHaveLength(18)
  expect(screen.getByText('18.2%')).not.toBeNull()
  expect(screen.getByText('1,820')).not.toBeNull()
  expect(screen.getByText('Data year: 2022')).not.toBeNull()
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.queryByRole('button', { name: /education timeline/i })).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: 'Choose a country' }), {
    target: { value: 'AAA' },
  })
  expect(screen.getByText('Data year: 2024')).not.toBeNull()
  expect(screen.getByText('0.0%')).not.toBeNull()
  expect(screen.queryByText('1,820')).toBeNull()
  expect(container.querySelectorAll('.education-dots .lit')).toHaveLength(100)
  expect(container.querySelectorAll('.education-dots .empty')).toHaveLength(0)
})

it('clears stale details for a country without records and restores keyboard focus on close', () => {
  const { container } = render(<Harness />)
  const select = screen.getByRole('combobox', { name: 'Choose a country' })
  fireEvent.change(select, { target: { value: 'BBB' } })
  expect(screen.getByText('No reported data')).not.toBeNull()
  expect(screen.queryByText('18.2%')).toBeNull()
  expect(container.querySelector('.education-dots')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close country details' }))
  expect(screen.getByText(/Click a country on Earth/)).not.toBeNull()
  expect(document.activeElement).toBe(select)
})

it('selects the latest valid record, accepts zero, and never borrows a count from an older year', () => {
  expect(latestObservation(data.countries[0], [2023, 2022, 2024])).toMatchObject({
    year: 2024,
    rate: 0,
    count: 0,
  })
  expect(latestObservation(data.countries[1], data.years)).toBeNull()
  expect(latestObservation(data.countries[2], data.years)).toMatchObject({
    year: 2022,
    count: 1820,
  })
  const country = {
    ...data.countries[0],
    years: {
      ...data.countries[0].years,
      '2024': { ...data.countries[0].years['2024'], rate: 101 },
    },
  }
  expect(latestObservation(country, data.years)?.year).toBe(2022)
  country.years['2024'] = { ...country.years['2024'], rate: 12, count: null }
  expect(latestObservation(country, data.years)).toMatchObject({
    year: 2024,
    rate: 12,
    count: null,
  })
})

it('exposes a retry when the dataset cannot load, without showing sample values', () => {
  const retry = vi.fn()
  render(
    <EducationExplorer
      status={null}
      error="Offline"
      onCountry={vi.fn()}
      onRetry={retry}
      withPanel={false}
    />,
  )
  expect(screen.getByRole('alert').textContent).toContain('Education data could not load')
  fireEvent.click(screen.getByRole('button', { name: 'Retry education data' }))
  expect(retry).toHaveBeenCalledOnce()
  expect(screen.queryByRole('slider')).toBeNull()
})

it('keeps missing years out of the trend and gives missing data a different color from zero', () => {
  expect(educationTrend(data.countries[0], data.years)).toHaveLength(2)
  expect(educationTrend(data.countries[0], data.years).every((path) => !path.includes('L'))).toBe(
    true,
  )
  expect(educationColor(null)).not.toBe(educationColor(0))
  expect(educationColor(100)).not.toBe(educationColor(0))
  expect(observation(data.countries[0], 2023)).toBeNull()
  expect(observation(data.countries[0], 2024)?.count).toBe(0)
})

it('updates the globe and selected country together, uses neutral color for missing data, and removes its layers on exit', () => {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, any>()
  const canvas = { style: { cursor: 'grab' } }
  const status = vi.fn()
  const hover = vi.fn()
  const map = {
    addSource: (id: string, source: unknown) => sources.set(id, source),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (value: { id: string }) => layers.set(value.id, value),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    getCanvas: () => canvas,
    setPaintProperty: vi.fn((id: string, property: string, value: unknown) => {
      layers.get(id).paint[property] = value
    }),
    setFilter: vi.fn((id: string, filter: unknown) => {
      layers.get(id).filter = filter
    }),
    flyTo: vi.fn(),
    queryRenderedFeatures: vi.fn(() => [{ properties: { id: 'AAA' } }]),
  }
  const context = { map, onEducationStatus: status, hover } as unknown as LayerContext
  const layer = educationLayer(context, data, geometry)
  const checkStyle = () =>
    expect(
      validateStyleMin({
        version: 8,
        sources: Object.fromEntries(sources),
        layers: [...layers.values()],
      } as StyleSpecification),
    ).toEqual([])
  checkStyle()
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ coverage: 2 }))
  expect(map.setPaintProperty.mock.calls.at(-1)![2]).toContain(educationColor(0))
  expect(map.setPaintProperty.mock.calls.at(-1)![2]).toContain(educationColor(18.2))
  const paintCalls = map.setPaintProperty.mock.calls.length
  const position = layer.focus!({ x: 10, y: 20 })
  expect(position).toEqual({ center: [1, 2], zoom: 3 })
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'AAA' }))
  expect(layer.hitTest!({ x: 10, y: 20 })?.subtitle).toContain('2024')
  map.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'CCC' } }])
  layer.focus!({ x: 10, y: 20 })
  expect(status).toHaveBeenLastCalledWith(
    expect.objectContaining({ selectedId: 'CCC', coverage: 2 }),
  )
  expect(layer.hitTest!({ x: 10, y: 20 })?.subtitle).toContain('2022')
  expect(layer.hitTest!({ x: 10, y: 20 })?.facts[1].value).toBe('1,820')
  map.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'BBB' } }])
  expect(layer.hitTest!({ x: 10, y: 20 })?.facts).toEqual([
    { label: 'Available records', value: 'No reported data' },
  ])
  expect(map.setPaintProperty.mock.calls).toHaveLength(paintCalls)
  layer.updateEducationData({
    ...data,
    years: [...data.years, 2025],
    countries: data.countries.map((country) =>
      country.id === 'CCC'
        ? {
            ...country,
            years: {
              ...country.years,
              '2025': { rate: 45, count: null, ages: null, flags: [], notes: [] },
            },
          }
        : country,
    ),
  })
  expect(status).toHaveBeenLastCalledWith(
    expect.objectContaining({ selectedId: 'CCC', coverage: 2 }),
  )
  expect(map.setPaintProperty.mock.calls.at(-1)![2]).toContain(educationColor(45))
  expect(map.flyTo).not.toHaveBeenCalled()
  checkStyle()
  expect(hover).toHaveBeenCalledWith(null)
  layer.destroy()
  expect(sources.size).toBe(0)
  expect(layers.size).toBe(0)
  expect(canvas.style.cursor).toBe('grab')
  status.mockClear()
  layer.selectEducationCountry!('AAA')
  expect(status).not.toHaveBeenCalled()
})

it('ships genuine combined primary/lower-secondary UIS series with source years, counts and explicit missing values', () => {
  const snapshot = JSON.parse(readFileSync('public/data/education.json', 'utf8'))
  expect(snapshot.indicators).toEqual({ rate: 'ROFST.1T2.CP', count: 'OFST.1T2.CP' })
  expect(snapshot.releaseId).toMatch(/^\d{6}$/)
  expect(Number.isFinite(Date.parse(snapshot.checkedAt))).toBe(true)
  expect(
    snapshot.countries.filter((country: { years: object }) => Object.keys(country.years).length)
      .length,
  ).toBeGreaterThan(100)
  expect(
    snapshot.sources.every(
      (source: { url: string; sha256: string }) =>
        source.url.includes(`/bdds/${snapshot.releaseId}/`) && /^[a-f0-9]{64}$/.test(source.sha256),
    ),
  ).toBe(true)
  for (const country of snapshot.countries)
    for (const [year, row] of Object.entries(country.years) as [string, any][]) {
      expect(snapshot.years).toContain(Number(year))
      expect(row.rate).toBeGreaterThanOrEqual(0)
      expect(row.rate).toBeLessThanOrEqual(100)
      if (row.count !== null) expect(row.count).toBeGreaterThanOrEqual(0)
    }
})
