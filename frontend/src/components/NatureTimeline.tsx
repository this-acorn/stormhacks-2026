import { useEffect, useState } from 'react'
import { LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react'
import { natureLabel, type ImageryStatus, type NaturePeriod } from '../natureImagery'

interface Props {
  year: NaturePeriod
  onYear: (period: NaturePeriod) => void
  status: ImageryStatus
  withPanel: boolean
  onRetryCatalog?: () => void
}

const EMPTY_MONTHS: string[] = []

export default function NatureTimeline({ year, onYear, status, withPanel, onRetryCatalog }: Props) {
  const [playRequested, setPlayRequested] = useState(false)
  const playing = playRequested && !status.error
  const months = status.months ?? EMPTY_MONTHS
  const selected = typeof year === 'string' ? year : months[months.length - 1]
  const index = Math.max(0, months.indexOf(selected))
  const last = Math.max(1, months.length - 1)
  const select = (month: string) => {
    setPlayRequested(false)
    onYear(month)
  }
  useEffect(() => {
    if (!playing || !months.length || status.loading) return
    const timer = window.setTimeout(() => {
      if (index === months.length - 1) setPlayRequested(false)
      else onYear(months[index + 1])
    }, 2500)
    return () => clearTimeout(timer)
  }, [playing, index, months, onYear, status.loading])
  const message =
    status.catalogError ||
    status.error ||
    (status.catalogLoading
      ? 'Loading monthly satellite imagery archive.'
      : status.loading
        ? `Loading ${natureLabel(status.requested)} · showing ${natureLabel(status.displayed)}`
        : `Showing ${natureLabel(status.displayed)} satellite imagery.`)

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
        disabled={!months.length}
        onClick={() => {
          if (!playing) {
            if (index === months.length - 1) onYear(months[0])
            else if (status.error) onYear(selected)
          }
          setPlayRequested(!playing)
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <output className="nature-timeline-date" title={message} aria-label={message}>
        {months.length ? natureLabel(status.displayed) : '—'}
        {(status.loading || status.catalogLoading) && (
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
          max={Math.max(0, months.length - 1)}
          step={1}
          value={index}
          disabled={!months.length}
          aria-label="Satellite imagery month"
          aria-valuetext={
            selected
              ? `${natureLabel(selected)}${status.loading ? ', loading' : ''}`
              : 'Loading monthly archive'
          }
          style={{ '--timeline-progress': `${(index / last) * 100}%` } as React.CSSProperties}
          onChange={(event) => select(months[Number(event.target.value)])}
        />
        <div className="nature-month-markers" aria-hidden="true">
          {months.map((month, position) => (
            <i
              key={month}
              className={month.endsWith('-01') ? 'is-year' : ''}
              style={{ left: `${(position / last) * 100}%` }}
            />
          ))}
        </div>
        <div className="nature-timeline-ticks nature-continuous-years">
          {months.map(
            (month, position) =>
              (position === 0 || month.endsWith('-01')) && (
                <button
                  type="button"
                  key={month}
                  aria-label={`View ${natureLabel(month)} imagery`}
                  aria-pressed={selected?.slice(0, 4) === month.slice(0, 4)}
                  style={{ left: `${(position / last) * 100}%` }}
                  onClick={() => select(month)}
                >
                  {month.slice(0, 4)}
                </button>
              ),
          )}
        </div>
      </div>
      {status.catalogError && (
        <div className="nature-timeline-options">
          {status.catalogError && (
            <button type="button" className="nature-catalog-retry" onClick={onRetryCatalog}>
              <RotateCcw size={11} /> Retry monthly data
            </button>
          )}
        </div>
      )}
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
