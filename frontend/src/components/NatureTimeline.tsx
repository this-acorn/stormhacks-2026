import { useEffect, useState } from 'react'
import { LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react'
import { NATURE_YEARS, type ImageryStatus } from '../natureImagery'

interface Props {
  year: number
  onYear: (year: number) => void
  status: ImageryStatus
  withPanel: boolean
}

const YEARS: readonly number[] = NATURE_YEARS
const LAST = YEARS.length - 1
const STEP_MS = 800 // How long playback holds each year once its imagery has loaded.

export default function NatureTimeline({ year, onYear, status, withPanel }: Props) {
  const [playRequested, setPlayRequested] = useState(false)
  const playing = playRequested && !status.error
  const index = Math.max(0, YEARS.indexOf(year))
  const select = (next: number) => {
    setPlayRequested(false)
    onYear(next)
  }
  useEffect(() => {
    if (!playing || status.loading) return
    const timer = window.setTimeout(() => {
      if (index === LAST) setPlayRequested(false)
      else onYear(YEARS[index + 1])
    }, STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, index, onYear, status.loading])
  const message =
    status.error ||
    (status.loading
      ? `Loading ${status.requested} · showing ${status.displayed}`
      : `Showing ${status.displayed} satellite imagery.`)

  return (
    <section
      className={`nature-timeline nature-imagery-timeline ${withPanel ? 'with-panel' : ''}`}
      aria-label="Satellite imagery timeline"
    >
      <button
        type="button"
        className="timeline-play"
        aria-label={playing ? 'Pause timeline' : 'Play timeline'}
        title={playing ? 'Pause' : 'Play'}
        onClick={() => {
          if (!playing) {
            if (index === LAST) onYear(YEARS[0])
            else if (status.error) onYear(year)
          }
          setPlayRequested(!playing)
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <output className="nature-timeline-date" title={message} aria-label={message}>
        {status.displayed}
        {status.loading && (
          <LoaderCircle className="timeline-loading" size={12} aria-hidden="true" />
        )}
        {status.error && (
          <button
            type="button"
            title={status.error}
            onClick={() => onYear(year)}
            aria-label="Retry imagery"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </output>
      <div className="nature-timeline-slider">
        <input
          type="range"
          min={0}
          max={LAST}
          step={1}
          value={index}
          aria-label="Satellite imagery year"
          aria-valuetext={`${year}${status.loading ? ', loading' : ''}`}
          style={{ '--timeline-progress': `${(index / LAST) * 100}%` } as React.CSSProperties}
          onChange={(event) => select(YEARS[Number(event.target.value)])}
        />
        <div className="nature-timeline-markers" aria-hidden="true">
          {YEARS.map((entry, position) => (
            <i key={entry} style={{ left: `${(position / LAST) * 100}%` }} />
          ))}
        </div>
        <div className="nature-timeline-ticks nature-continuous-years">
          {YEARS.map((entry, position) => (
            <button
              type="button"
              key={entry}
              aria-label={`View ${entry} imagery`}
              aria-pressed={entry === year}
              style={{ left: `${(position / LAST) * 100}%` }}
              onClick={() => select(entry)}
            >
              {entry}
            </button>
          ))}
        </div>
      </div>
      {status.error && (
        <p className="nature-timeline-error" role="alert">
          {status.error}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {message}
      </span>
    </section>
  )
}
