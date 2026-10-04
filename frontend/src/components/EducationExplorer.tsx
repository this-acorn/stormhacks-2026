import { useRef, useState } from 'react'
import { ArrowUpRight, RotateCcw, X } from 'lucide-react'
import {
  educationPercent,
  educationTrend,
  emptyEducationDots,
  observation,
  latestObservation,
  type EducationStatus,
} from '../educationData'
import { formatNumber } from '../layers/data'
import '../education.css'

interface Props {
  status: EducationStatus | null
  error: string
  onCountry: (id: string | null) => void
  onRetry: () => void
  withPanel: boolean
}

export default function EducationExplorer({ status, error, onCountry, onRetry, withPanel }: Props) {
  const countrySelect = useRef<HTMLSelectElement>(null)
  const [currentYear] = useState(() => new Date().getFullYear())

  if (!status || error)
    return (
      <section
        className={`education-card education-loading ${withPanel ? 'with-panel' : ''}`}
        aria-label="Education explorer"
      >
        <span className="education-eyebrow">ACCESS TO LEARNING</span>
        <p role={error ? 'alert' : 'status'}>
          {error ? 'Education data could not load.' : 'Loading education data…'}
        </p>
        {error && (
          <button type="button" className="education-retry" onClick={onRetry}>
            <RotateCcw size={13} /> Retry education data
          </button>
        )}
      </section>
    )

  const { data, selectedId, coverage } = status
  const checkedAt = data.updates?.checkedAt ?? data.checkedAt
  const checkedDate = checkedAt ? new Date(checkedAt) : null
  const country = data.countries.find((entry) => entry.id === selectedId)
  const row = country ? latestObservation(country, data.years) : null
  const empty = row ? emptyEducationDots(row.rate) : 0
  const index = row ? data.years.indexOf(row.year) : 0
  const trendX = 4 + (index / Math.max(1, data.years.length - 1)) * 252
  const selectCountry = (id: string | null) => {
    onCountry(id)
    if (id === null) countrySelect.current?.focus()
  }

  return (
    <>
      <section
        className={`education-card ${country ? 'has-country' : ''} ${withPanel ? 'with-panel' : ''}`}
        aria-label="Education explorer"
      >
        <div className="education-card-heading">
          <span className="education-eyebrow">ACCESS TO LEARNING</span>
          {country && (
            <button
              type="button"
              onClick={() => selectCountry(null)}
              aria-label="Close country details"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <label className="sr-only" htmlFor="education-country">
          Choose a country
        </label>
        <select
          ref={countrySelect}
          id="education-country"
          value={selectedId ?? ''}
          onChange={(event) => selectCountry(event.target.value || null)}
        >
          <option value="">Choose a country</option>
          {data.countries.map((entry) => {
            const latest = latestObservation(entry, data.years)
            return (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {latest ? ` · ${latest.year}` : ' · no data'}
              </option>
            )
          })}
        </select>
        {!country && (
          <p className="education-intro">
            Click a country on Earth to see education access through 100 small lights.
          </p>
        )}
        {country && (
          <>
            <p className="education-cohort">
              Primary + lower secondary{row?.ages ? ` · ages ${row.ages[0]}–${row.ages[1]}` : ''}
            </p>
            <div className="education-reading" aria-live="polite" aria-atomic="true">
              {row ? (
                <>
                  <div className="education-rate">
                    <strong>{educationPercent(row.rate)}</strong>
                    <span>
                      not enrolled
                      <br />
                      in school
                    </span>
                  </div>
                  <p className="education-reference-year">Data year: {row.year}</p>
                  {currentYear - row.year > 5 && (
                    <p className="education-update-note">Historical data · more than 5 years old</p>
                  )}
                  <p className="education-count">
                    {row.count !== null ? (
                      <>
                        <strong>{formatNumber(row.count)}</strong> children and adolescents
                      </>
                    ) : (
                      'Child count not reported for this year'
                    )}
                  </p>
                </>
              ) : (
                <div className="education-missing">
                  <strong>No reported data</strong>
                  <p>
                    No value is published for {country.name} in this dataset. Missing data is not
                    zero.
                  </p>
                </div>
              )}
            </div>
            {row && (
              <>
                <div
                  className="education-dots"
                  role="img"
                  aria-label={`${educationPercent(row.rate)} of primary and lower secondary age children not enrolled in school. ${empty} of 100 illustrative lights are empty, rounded to the nearest whole percent.`}
                >
                  {Array.from({ length: 100 }, (_, i) => (
                    <i key={i} className={i >= 100 - empty ? 'empty' : 'lit'} aria-hidden="true" />
                  ))}
                </div>
                <div className="education-dot-key">
                  <span>
                    <i className="lit" /> Enrolled
                  </span>
                  <span>
                    <i className="empty" /> Not enrolled
                  </span>
                </div>
                <p className="education-dot-caption">
                  100 lights represent 100 children. Rounded; not individual locations.
                </p>
              </>
            )}
            {row && (
              <div className="education-trend">
                <div>
                  <span>Not enrolled over time</span>
                  <span>0–100%</span>
                </div>
                <svg
                  viewBox="0 0 260 60"
                  role="img"
                  aria-label={`${country.name}, out-of-school percentage from ${data.years[0]} to ${data.years.at(-1)}. Gaps indicate missing data. Latest observation: ${row.year}, ${educationPercent(row.rate)}.`}
                >
                  <path d="M4,54 H256 M4,29 H256 M4,4 H256" className="education-trend-grid" />
                  {educationTrend(country, data.years).map((path, i) => (
                    <path key={i} d={path} className="education-trend-line" />
                  ))}
                  {data.years.map((value, i) => {
                    const valueRow = observation(country, value)
                    return valueRow ? (
                      <circle
                        key={value}
                        cx={4 + (i / Math.max(1, data.years.length - 1)) * 252}
                        cy={54 - valueRow.rate * 0.5}
                        r={1.5}
                        className="education-trend-point"
                      >
                        <title>
                          {value}: {educationPercent(valueRow.rate)}
                        </title>
                      </circle>
                    ) : null
                  })}
                  <path d={`M${trendX},1 V57`} className="education-trend-cursor" />
                  {row && (
                    <circle
                      cx={trendX}
                      cy={54 - row.rate * 0.5}
                      r={3.5}
                      className="education-trend-current"
                    />
                  )}
                </svg>
                <div>
                  <span>{data.years[0]}</span>
                  <span>Gaps = no data</span>
                  <span>{data.years.at(-1)}</span>
                </div>
              </div>
            )}
            <details className="education-method">
              <summary>About these data</summary>
              <p>
                National primary and lower secondary school-age children, both sexes. High-school
                ages are excluded. Official age ranges differ by country and may change over time.
              </p>
              <p>
                UNESCO’s combined rate and count, from administrative data. Not enrolled does not
                describe daily attendance or why a child is out of school. Missing years are left
                empty. The map uses the latest observation available for each country in this UNESCO
                UIS release. Data years vary by country; the release date is not the observation
                year.
              </p>
              {row?.flags.length ? (
                <p>
                  {row.flags
                    .map((flag) =>
                      flag === 'UIS_EST'
                        ? 'UIS estimate'
                        : flag === 'NAT_EST'
                          ? 'National estimate'
                          : flag,
                    )
                    .join(' · ')}
                </p>
              ) : null}
              {row?.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              <a href={data.licenseUrl} target="_blank" rel="noreferrer">
                {data.license}
              </a>
            </details>
          </>
        )}
        <a className="education-source" href={data.sourceUrl} target="_blank" rel="noreferrer">
          UNESCO UIS · {data.release} release <ArrowUpRight size={11} />
        </a>
        <div className="education-update-note" role="status">
          {data.updates?.state === 'checking'
            ? 'Checking UNESCO for updates…'
            : data.updates?.state === 'current'
              ? 'Automatic daily update checks'
              : data.updates?.state === 'stale'
                ? 'Update check delayed · showing saved data'
                : 'Offline snapshot · automatic updates unavailable'}
          {checkedDate && Number.isFinite(checkedDate.getTime()) && (
            <span>Last checked: {checkedDate.toLocaleString()}</span>
          )}
          {(data.updates?.state === 'offline' || data.updates?.state === 'stale') && (
            <button type="button" className="education-retry" onClick={onRetry}>
              <RotateCcw size={12} /> Reconnect
            </button>
          )}
        </div>
      </section>
      <section
        className={`education-legend ${withPanel ? 'with-panel' : ''}`}
        aria-label="Education map legend"
      >
        <div className="education-scale">
          <span>Not enrolled in school</span>
          <div className="education-color-key">
            <i />
            <div>
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
          <span className="education-no-data-key">
            <i /> No data
          </span>
          <span className="education-coverage">
            Latest available in this UIS release · data years vary
            <br />
            {coverage} countries / territories
          </span>
        </div>
      </section>
    </>
  )
}
