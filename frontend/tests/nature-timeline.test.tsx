import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import NatureTimeline from '../src/components/NatureTimeline'
import type { ImageryStatus } from '../src/natureImagery'

const shown = (year: number): ImageryStatus => ({
  requested: year,
  displayed: year,
  loading: false,
  error: '',
})
afterEach(() => vi.useRealTimers())

it('uses one yearly slider from 2020 to 2025 with a button for every year', () => {
  const onYear = vi.fn()
  function Timeline() {
    const [year, setYear] = useState(2025)
    return (
      <NatureTimeline
        year={year}
        onYear={(value) => {
          onYear(value)
          setYear(value)
        }}
        withPanel={false}
        status={shown(year)}
      />
    )
  }
  render(<Timeline />)
  const slider = screen.getByRole('slider', { name: 'Satellite imagery year' })
  expect(slider.getAttribute('max')).toBe('5')
  expect((slider as HTMLInputElement).value).toBe('5')
  for (let year = 2020; year <= 2025; year++) {
    expect(screen.getByRole('button', { name: `View ${year} imagery` })).toBeTruthy()
  }
  expect(screen.queryByRole('button', { name: 'View 2019 imagery' })).toBeNull()
  fireEvent.change(slider, { target: { value: '0' } })
  expect(onYear).toHaveBeenLastCalledWith(2020)
  fireEvent.click(screen.getByRole('button', { name: 'View 2023 imagery' }))
  expect(onYear).toHaveBeenLastCalledWith(2023)
  expect(
    screen.getByRole('button', { name: 'View 2023 imagery' }).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(parseFloat(screen.getByRole('button', { name: 'View 2023 imagery' }).style.left)).toBe(60)
})

it('reports the year actually visible while a new year loads', () => {
  render(
    <NatureTimeline
      year={2022}
      onYear={vi.fn()}
      withPanel={false}
      status={{ requested: 2022, displayed: 2021, loading: true, error: '' }}
    />,
  )
  expect(screen.getByLabelText('Loading 2022 · showing 2021').textContent).toBe('2021')
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('2022, loading')
})

it('plays year by year and waits for tiles before advancing', () => {
  vi.useFakeTimers()
  const onYear = vi.fn()
  const props = { onYear, withPanel: false }
  const view = render(<NatureTimeline {...props} year={2020} status={shown(2020)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  act(() => vi.advanceTimersByTime(800))
  expect(onYear).toHaveBeenLastCalledWith(2021)
  onYear.mockClear()
  view.rerender(
    <NatureTimeline
      {...props}
      year={2021}
      status={{ requested: 2021, displayed: 2020, loading: true, error: '' }}
    />,
  )
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
  view.rerender(<NatureTimeline {...props} year={2021} status={shown(2021)} />)
  act(() => vi.advanceTimersByTime(800))
  expect(onYear).toHaveBeenLastCalledWith(2022)
  fireEvent.click(screen.getByRole('button', { name: 'Pause timeline' }))
  onYear.mockClear()
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
})

it('restarts at 2020 after the latest year and stops at the end', () => {
  vi.useFakeTimers()
  const onYear = vi.fn()
  const props = { onYear, withPanel: false }
  const view = render(<NatureTimeline {...props} year={2025} status={shown(2025)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  expect(onYear).toHaveBeenLastCalledWith(2020)
  view.rerender(<NatureTimeline {...props} year={2025} status={shown(2025)} />)
  onYear.mockClear()
  act(() => vi.advanceTimersByTime(800))
  expect(onYear).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Play timeline' })).toBeTruthy()
})

it('stops on an imagery error and lets Play retry and continue', () => {
  vi.useFakeTimers()
  const onYear = vi.fn()
  const props = { year: 2021, onYear, withPanel: false }
  const view = render(<NatureTimeline {...props} status={shown(2021)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  view.rerender(
    <NatureTimeline {...props} status={{ ...shown(2021), error: 'Imagery unavailable' }} />,
  )
  act(() => vi.advanceTimersByTime(5000))
  expect(onYear).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('Imagery unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  expect(onYear).toHaveBeenLastCalledWith(2021)
  onYear.mockClear()
  view.rerender(<NatureTimeline {...props} status={{ ...shown(2021), loading: true }} />)
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
  view.rerender(<NatureTimeline {...props} status={shown(2021)} />)
  act(() => vi.advanceTimersByTime(800))
  expect(onYear).toHaveBeenLastCalledWith(2022)
})
