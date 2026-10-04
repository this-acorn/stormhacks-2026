import { useMemo, useRef, useState } from 'react'
import { ArrowUpRight, RotateCcw, Search, X } from 'lucide-react'
import type { Organization } from '../types'
import {
  countryOrganizations,
  domesticRequests,
  violenceColor,
  violenceFrequency,
  violencePercent,
  VIOLENCE_COLOR_STOPS,
  VIOLENCE_SOURCE_URL,
  type ViolenceStatus,
} from '../violenceData'
import '../violence.css'

interface Props {
  status: ViolenceStatus | null
  error: string
  organizations: Organization[]
  onCountry: (id: string | null) => void
  onSupport: (id: string) => void
  onRetry: () => void
  withPanel: boolean
}

export default function ViolenceExplorer({
  status,
  error,
  organizations,
  onCountry,
  onSupport,
  onRetry,
  withPanel,
}: Props) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const countries = status?.countries
  const geometry = status?.geometry
  const country = countries?.find((entry) => entry.id === status?.selectedId)
  const estimate = country?.estimate
  const supportByCountry = useMemo(() => {
    if (!countries || !geometry) return new Map<string, Organization[]>()
    return new Map(
      countries.map((entry) => [entry.id, countryOrganizations(entry.id, geometry, organizations)]),
    )
  }, [countries, geometry, organizations])
  const support = country ? (supportByCountry.get(country.id) ?? []) : []
  const suggestions = country
    ? []
    : (countries?.filter((entry) => supportByCountry.get(entry.id)?.length) ?? [])
  const matches =
    status?.countries.filter((entry) =>
      `${entry.name} ${entry.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ) ?? []
  const choose = (id: string | null) => {
    onCountry(id)
    setQuery('')
    search.current?.focus({ preventScroll: true })
  }

  return (
    <section
      className={`violence-card ${withPanel ? 'with-panel' : ''}`}
      aria-label="Intimate Partner Violence explorer"
    >
      <div className="violence-heading">
        <span className="violence-eyebrow">COUNTRY INSIGHTS</span>
        {country && (
          <button type="button" onClick={() => choose(null)} aria-label="Close country details">
            <X size={17} />
          </button>
        )}
      </div>
      {!status || error ? (
        <div className="violence-state">
          <p role={error ? 'alert' : 'status'}>
            {error ? 'Country estimates could not load.' : 'Loading country estimates…'}
          </p>
          {error && (
            <button type="button" onClick={onRetry}>
              <RotateCcw size={14} /> Retry estimates
            </button>
          )}
        </div>
      ) : (
        <>
          <form
            className="violence-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              if (query.trim() && matches.length === 1) choose(matches[0].id)
            }}
          >
            <Search size={15} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              aria-label="Search a country"
              placeholder="Search a country…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.stopPropagation()
                  setQuery('')
                }
              }}
            />
          </form>
          {query.trim() && (
            <div className="violence-results" aria-label="Country search results">
              <p role="status">
                {matches.length
                  ? `${matches.length} ${matches.length === 1 ? 'country' : 'countries'} found`
                  : 'No matching countries.'}
              </p>
              <ul>
                {matches.slice(0, 6).map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => choose(entry.id)}
                      aria-label={`${entry.name} · ${entry.estimate ? `${entry.estimate.year} estimate` : 'No estimate'}`}
                    >
                      <span>{entry.name}</span>
                      <small>
                        {entry.estimate ? `${entry.estimate.year} estimate` : 'No estimate'}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              {matches.length > 6 && <p>Keep typing to narrow the results.</p>}
            </div>
          )}
          {country ? (
            <>
              <div className="violence-reading" aria-live="polite" aria-atomic="true">
                <h2>{country.name}</h2>
                {estimate ? (
                  <>
                    <span className="violence-year">
                      {estimate.year} estimate · Previous 12 months
                    </span>
                    <strong
                      className="violence-rate"
                      style={{ color: violenceColor(estimate.all.value) }}
                    >
                      {violencePercent(estimate.all.value)}
                    </strong>
                    <p className="violence-frequency">
                      {violenceFrequency(estimate.all.value) ??
                        'Estimated share in the surveyed population'}
                    </p>
                    <p className="violence-cohort">
                      Ever-partnered women aged 15+ who experienced physical and/or sexual intimate
                      partner violence.
                    </p>
                    <div className="violence-uncertainty">
                      <span>Uncertainty range</span>
                      <strong>
                        {violencePercent(estimate.all.low)}–{violencePercent(estimate.all.high)}
                      </strong>
                    </div>
                  </>
                ) : (
                  <div className="violence-missing">
                    <strong>No estimate available</strong>
                    <p>
                      Missing data does not mean violence is absent. Published support requests can
                      still appear below.
                    </p>
                  </div>
                )}
              </div>
              <section
                className="violence-support"
                aria-label={`Support organizations in ${country.name}`}
              >
                <div className="violence-support-heading">
                  <h3>Ways to support</h3>
                  <span>
                    {support.length} {support.length === 1 ? 'organization' : 'organizations'}
                  </span>
                </div>
                <p className="violence-support-intro">
                  Published requests from organizations listed in {country.name}.
                </p>
                {support.length ? (
                  support.map((organization) => {
                    const requests = domesticRequests(organization)
                    return (
                      <article className="violence-organization" key={organization.id}>
                        {organization.sample && (
                          <span className="violence-sample">
                            Sample organization · demo requests
                          </span>
                        )}
                        <h4>{organization.name}</h4>
                        <span className="violence-location">
                          {organization.location} · City-level location
                        </span>
                        <ul>
                          {requests.map((request) => (
                            <li key={request.id}>
                              <span>{request.item}</span>
                              <small>
                                {(request.quantity - request.fulfilled).toLocaleString()}{' '}
                                {request.unit} still needed
                                {request.urgency === 'urgent' ? ' · Urgent' : ''}
                              </small>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="violence-support-button"
                          onClick={() => onSupport(organization.id)}
                          aria-label={`Support ${organization.name}`}
                        >
                          Support this organization <ArrowUpRight size={14} />
                        </button>
                      </article>
                    )
                  })
                ) : (
                  <p className="violence-empty">
                    No open requests listed in AidAtlas for this country yet. This is not a
                    directory of all available services.
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="violence-intro">
              <h2>
                Understand the need.
                <br />
                Find a way to help.
              </h2>
              <p>
                Select a bar on the globe or search above to explore estimates and organizations
                with open requests.
              </p>
              {suggestions.length > 0 && (
                <div className="violence-suggestions">
                  <span>Countries with requests</span>
                  {suggestions.map((entry) => (
                    <button type="button" key={entry.id} onClick={() => choose(entry.id)}>
                      {entry.name}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div
            className="violence-legend"
            role="group"
            aria-label="Map legend: bar color represents estimated percentage"
          >
            <span>Bar color = estimated share · Previous 12 months</span>
            <div
              className="violence-color-ramp"
              aria-hidden="true"
              style={{
                background: `linear-gradient(to right, ${VIOLENCE_COLOR_STOPS.map(({ value, color }) => `${color} ${(value / 40) * 100}%`).join(', ')})`,
              }}
            />
            <div className="violence-color-ticks">
              {[0, 10, 20, 30, 40].map((value) => (
                <span key={value}>
                  {value}%{value === 40 ? '+' : ''}
                </span>
              ))}
            </div>
            <span className="violence-legend-note">
              One bar per country. Taller bars indicate a higher share.
            </span>
            <p>
              No estimate: no bar <span>{status.coverage} countries with estimates</span>
            </p>
          </div>
          <details className="violence-method">
            <summary>About these estimates</summary>
            <p>{status.data.note} The previous 12 months refer to the estimate year, not today.</p>
            <p>
              This measure covers physical and/or sexual intimate partner violence among
              ever-partnered women aged 15+. It does not describe every form of domestic violence or
              every affected population.
            </p>
            <p>
              Organizations are grouped by their listed location; this does not establish their
              service area. Confidential shelter addresses are not shown.
            </p>
          </details>
          <a
            className="violence-source"
            href={VIOLENCE_SOURCE_URL}
            target="_blank"
            rel="noreferrer"
          >
            WHO estimates · UN SDG 5.2.1 <ArrowUpRight size={12} />
          </a>
        </>
      )}
    </section>
  )
}
