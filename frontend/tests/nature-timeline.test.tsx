import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import NatureTimeline from '../src/components/NatureTimeline'

const months = Array.from(
  { length: 105 },
  (_, index) => `${2018 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
)
afterEach(() => vi.useRealTimers())

it('uses one continuous 2018–2026 monthly slider with year markers and no mode or year selector', () => {
  const onYear = vi.fn()
  function Timeline() {
    const [month, setMonth] = useState('2026-09')
    return (
      <NatureTimeline
        year={month}
        onYear={(value) => {
          onYear(value)
          setMonth(String(value))
        }}
        withPanel={false}
        status={{ requested: month, displayed: month, loading: false, error: '', months }}
      />
    )
  }
  render(<Timeline />)
  const slider = screen.getByRole('slider', { name: 'Satellite imagery month' })
  expect(slider.getAttribute('max')).toBe('104')
  expect(slider.getAttribute('step')).toBe('1')
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('group', { name: 'Imagery interval' })).toBeNull()
  for (let year = 2018; year <= 2026; year++) {
    expect(screen.getByRole('button', { name: `View Jan ${year} imagery` })).toBeTruthy()
  }
  fireEvent.change(slider, { target: { value: '11' } })
  expect(onYear).toHaveBeenLastCalledWith('2018-12')
  fireEvent.change(slider, { target: { value: '12' } })
  expect(onYear).toHaveBeenLastCalledWith('2019-01')
  fireEvent.change(slider, { target: { value: '104' } })
  expect(onYear).toHaveBeenLastCalledWith('2026-09')
  fireEvent.click(screen.getByRole('button', { name: 'View Jan 2023 imagery' }))
  expect(onYear).toHaveBeenLastCalledWith('2023-01')
  // Year ticks are positioned at their actual month, without resetting the scale each year.
  expect(
    parseFloat(screen.getByRole('button', { name: 'View Jan 2026 imagery' }).style.left),
  ).toBeCloseTo(92.3077, 3)
})

it('reports the month actually visible while a new month loads', () => {
  render(
    <NatureTimeline
      year="2026-09"
      onYear={vi.fn()}
      withPanel={false}
      status={{ requested: '2026-09', displayed: '2026-08', loading: true, error: '', months }}
    />,
  )
  expect(screen.getByLabelText('Loading Sep 2026 · showing Aug 2026').textContent).toBe('Aug 2026')
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Sep 2026, loading')
})

it('replays through December into January and waits for tiles before advancing', () => {
  vi.useFakeTimers()
  const onYear = vi.fn()
  const props = { onYear, withPanel: false }
  const view = render(
    <NatureTimeline
      {...props}
      year="2018-12"
      status={{ requested: '2018-12', displayed: '2018-12', loading: false, error: '', months }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  act(() => vi.advanceTimersByTime(2500))
  expect(onYear).toHaveBeenLastCalledWith('2019-01')
  onYear.mockClear()
  view.rerender(
    <NatureTimeline
      {...props}
      year="2019-01"
      status={{ requested: '2019-01', displayed: '2018-12', loading: true, error: '', months }}
    />,
  )
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
  view.rerender(
    <NatureTimeline
      {...props}
      year="2019-01"
      status={{ requested: '2019-01', displayed: '2019-01', loading: false, error: '', months }}
    />,
  )
  act(() => vi.advanceTimersByTime(2500))
  expect(onYear).toHaveBeenLastCalledWith('2019-02')
  fireEvent.click(screen.getByRole('button', { name: 'Pause timeline' }))
  onYear.mockClear()
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
})

it('restarts at January 2018 after the last published month without requiring a zoom', () => {
  const onYear = vi.fn()
  const props = { onYear, withPanel: false }
  const view = render(
    <NatureTimeline
      {...props}
      year="2026-09"
      status={{ requested: '2026-09', displayed: '2026-09', loading: false, error: '', months }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  expect(onYear).toHaveBeenLastCalledWith('2018-01')
  view.rerender(
    <NatureTimeline
      {...props}
      year="2018-01"
      status={{
        requested: '2018-01',
        displayed: '2018-01',
        loading: false,
        error: '',
        months,
        overview: true,
      }}
    />,
  )
  expect(screen.queryByRole('button', { name: /Zoom/ })).toBeNull()
  expect(screen.getByLabelText('Showing Jan 2018 satellite imagery.').textContent).toBe('Jan 2018')
})

it('plays and pauses actual monthly globe imagery without zoom controls', () => {
  vi.useFakeTimers()
  const onYear = vi.fn()
  function Timeline() {
    const [month, setMonth] = useState('2026-09')
    return (
      <NatureTimeline
        year={month}
        onYear={(value) => {
          onYear(value)
          setMonth(String(value))
        }}
        withPanel={false}
        status={{
          requested: month,
          displayed: month,
          overview: true,
          loading: false,
          error: '',
          months,
        }}
      />
    )
  }
  render(<Timeline />)
  const play = screen.getByRole('button', { name: 'Play timeline' }) as HTMLButtonElement
  expect(play.disabled).toBe(false)
  fireEvent.click(play)
  expect(onYear).toHaveBeenLastCalledWith('2018-01')
  expect(screen.getByRole('button', { name: 'Pause timeline' })).toBeTruthy()
  act(() => vi.advanceTimersByTime(2500))
  expect(onYear).toHaveBeenLastCalledWith('2018-02')
  expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('1')
  expect(screen.getByLabelText('Showing Feb 2018 satellite imagery.').textContent).toBe('Feb 2018')
  expect(screen.queryByRole('button', { name: /Zoom/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Pause timeline' }))
  onYear.mockClear()
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
})

it('waits for actual monthly imagery after a manual zoom while playback is running', () => {
  vi.useFakeTimers()
  const onYear = vi.fn()
  const props = { year: '2018-02', onYear, withPanel: false }
  const status = {
    requested: '2018-02',
    displayed: '2018-02',
    overview: true,
    loading: false,
    error: '',
    months,
  }
  const view = render(<NatureTimeline {...props} status={status} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  view.rerender(
    <NatureTimeline {...props} status={{ ...status, overview: false, loading: true }} />,
  )
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
  view.rerender(
    <NatureTimeline {...props} status={{ ...status, overview: false, displayed: '2018-02' }} />,
  )
  act(() => vi.advanceTimersByTime(2500))
  expect(onYear).toHaveBeenLastCalledWith('2018-03')
})

it('stops on an imagery error and lets Play retry and continue instead of remaining disabled', () => {
  vi.useFakeTimers()
  const onYear = vi.fn()
  const props = { year: '2018-02', onYear, withPanel: false }
  const status = { requested: '2018-02', displayed: '2018-02', loading: false, error: '', months }
  const view = render(<NatureTimeline {...props} status={status} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }))
  view.rerender(<NatureTimeline {...props} status={{ ...status, error: 'Imagery unavailable' }} />)
  act(() => vi.advanceTimersByTime(5000))
  expect(onYear).not.toHaveBeenCalled()
  const play = screen.getByRole('button', { name: 'Play timeline' }) as HTMLButtonElement
  expect(play.disabled).toBe(false)
  fireEvent.click(play)
  expect(onYear).toHaveBeenLastCalledWith('2018-02')
  onYear.mockClear()
  view.rerender(<NatureTimeline {...props} status={{ ...status, loading: true }} />)
  act(() => vi.advanceTimersByTime(10000))
  expect(onYear).not.toHaveBeenCalled()
  view.rerender(<NatureTimeline {...props} status={status} />)
  act(() => vi.advanceTimersByTime(2500))
  expect(onYear).toHaveBeenLastCalledWith('2018-03')
})

it('disables an unavailable archive and offers a retry without inventing monthly frames', () => {
  const onRetryCatalog = vi.fn()
  render(
    <NatureTimeline
      year={2024}
      onYear={vi.fn()}
      onRetryCatalog={onRetryCatalog}
      withPanel={false}
      status={{
        requested: 2024,
        displayed: 2024,
        loading: false,
        error: '',
        catalogError: 'Unavailable',
      }}
    />,
  )
  expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true)
  expect(
    (screen.getByRole('button', { name: 'Play timeline' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Retry monthly data' }))
  expect(onRetryCatalog).toHaveBeenCalledOnce()
})
