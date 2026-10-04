import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUpRight, Check, Circle, List, RefreshCw, X } from 'lucide-react'
import { formatDate } from '../mapConfig'
import { aidApi } from '../api'
import { CONTRIBUTION_LABELS } from '../support'
import type { Contribution, Organization } from '../types'
import { ageOf, constellations, GALAXIES, STAR_AGE_COLORS } from '../cosmosModel'
import CosmosScene from './CosmosScene'
import ConstellationCollection from './ConstellationCollection'
import { useConstellationCollection } from '../hooks/useConstellationCollection'
import type { CosmosEntry } from '../cosmosEntry'

export default function MyCosmos({
  accountId,
  contributions,
  organizations,
  selectedId,
  entry,
  onSelect,
  onExplore,
  loading,
  error,
  onRetry,
  onUpdated,
  onRefresh,
}: {
  accountId: string
  contributions: Contribution[]
  organizations: Organization[]
  selectedId: string | null
  entry?: CosmosEntry
  onSelect: (id: string | null) => void
  onExplore: (organizationId?: string) => void
  loading: boolean
  error: string
  onRetry: () => void
  onUpdated: (contribution: Contribution) => void
  onRefresh: () => Promise<void>
}) {
  const [view, setView] = useState<'stars' | 'list' | 'collection'>('stars')
  const { collection, collect, storageAvailable } = useConstellationCollection(
    accountId,
    contributions,
    organizations,
    !loading && !error,
  )
  const [visit, setVisit] = useState<{ id: string; sequence: number } | null>(null)
  const [discovery, setDiscovery] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [clusterKey, setClusterKey] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(
    () => constellations(contributions, organizations),
    [contributions, organizations],
  )
  const cluster = groups.find((entry) => entry.key === clusterKey)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const detailHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!entry) detailHeading.current?.focus({ preventScroll: true })
  }, [selectedId, clusterKey, entry])
  const selected = contributions.find((contribution) => contribution.id === selectedId)

  return (
    <section
      className={`cosmos-view ${view !== 'stars' ? 'list-view' : ''} ${view === 'collection' ? 'collection-view' : ''} ${selected || cluster ? 'has-selection' : ''} ${paused ? 'motion-paused' : ''}`}
      aria-label="My Cosmos"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || (!selected && !cluster)) return
        event.stopPropagation()
        onSelect(null)
        setClusterKey(null)
        const target = selected
          ? `${view === 'stars' ? 'star' : 'contribution'}-${selected.id}`
          : `constellation-${cluster!.key}`
        document.getElementById(target)?.focus()
      }}
    >
      <div className="cosmos-background" aria-hidden="true" />
      <div className="cosmos-heading">
        <h1>My Cosmos</h1>
        <p>
          {contributions.length} {contributions.length === 1 ? 'star' : 'stars'} ·{' '}
          {new Set(contributions.map((entry) => entry.organizationId)).size} organizations
        </p>
      </div>
      <div className="view-toggle" role="group" aria-label="Cosmos view">
        <button onClick={() => setView('stars')} aria-pressed={view === 'stars'}>
          Universe
        </button>
        <button
          onClick={() => {
            onSelect(null)
            setClusterKey(null)
            setView('collection')
          }}
          aria-pressed={view === 'collection'}
        >
          Collection
        </button>
        <button onClick={() => setView('list')} aria-pressed={view === 'list'}>
          <List size={15} />
          List
        </button>
        <button
          aria-label="Refresh contribution status"
          title="Refresh contribution status"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            setRefreshError('')
            try {
              await onRefresh()
            } catch (error) {
              setRefreshError(
                error instanceof Error ? error.message : 'Unable to refresh contribution status.',
              )
            } finally {
              setRefreshing(false)
            }
          }}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {refreshError && (
        <p className="cosmos-refresh-message" role="alert">
          {refreshError}
        </p>
      )}
      {loading ? (
        <div className="cosmos-empty" role="status">
          <p>Loading your contributions…</p>
        </div>
      ) : error ? (
        <div className="cosmos-empty" role="alert">
          <h2>Your cosmos couldn’t load.</h2>
          <p>{error}</p>
          <button className="primary-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : view === 'collection' ? (
        <ConstellationCollection
          collection={collection}
          storageAvailable={storageAvailable}
          onVisit={(id) => {
            onSelect(null)
            setClusterKey(null)
            setVisit((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1 }))
            setView('stars')
          }}
        />
      ) : !contributions.length ? (
        <div className="cosmos-empty">
          <h2>No contributions yet.</h2>
          <p>Support a community to add a star to your cosmos.</p>
          <button className="primary-button" onClick={() => onExplore()}>
            Explore Earth
            <ArrowUpRight size={17} />
          </button>
        </div>
      ) : view === 'stars' ? (
        <CosmosScene
          entry={entry}
          collection={collection}
          visit={visit}
          discovery={discovery}
          onCollected={(id) => {
            collect(id)
            setDiscovery(id)
          }}
          onCollection={() => {
            onSelect(null)
            setClusterKey(null)
            setView('collection')
          }}
          groups={groups}
          selectedId={selectedId}
          selectedCluster={clusterKey}
          onSelect={(id) => {
            setStatusError('')
            onSelect(id)
          }}
          onCluster={(group) => setClusterKey(group?.key ?? null)}
          paused={paused}
          now={now}
          onList={() => setView('list')}
        />
      ) : (
        <div className="contribution-list">
          <div className="list-heading">
            <span>YOUR CONTRIBUTIONS</span>
            <span>STATUS</span>
          </div>
          {[...contributions]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((contribution) => (
              <button
                id={`contribution-${contribution.id}`}
                key={contribution.id}
                className={`contribution-row ${selectedId === contribution.id ? 'selected' : ''}`}
                aria-pressed={selectedId === contribution.id}
                onClick={() => {
                  setStatusError('')
                  onSelect(contribution.id)
                }}
              >
                <span
                  className={`list-star ${contribution.status === 'organization_confirmed' ? 'confirmed' : 'pending'}`}
                  style={{ '--star-color': ageOf(contribution, now).color } as CSSProperties}
                  aria-hidden="true"
                />
                <span className="contribution-row-main">
                  <strong>{contribution.organizationName}</strong>
                  <span>{contribution.summary}</span>
                  <small>
                    {ageOf(contribution, now).label} · {formatDate(contribution.createdAt)}
                    {contribution.simulated && ' · simulated'}
                  </small>
                </span>
                <span
                  className={`status-tag ${contribution.status === 'organization_confirmed' ? 'confirmed' : 'pending'}`}
                >
                  {CONTRIBUTION_LABELS[contribution.status]}
                </span>
              </button>
            ))}
        </div>
      )}
      <div className="cosmos-legend">
        {view === 'stars' && (
          <p className="cosmos-record-key">
            Your contribution stars are selectable. Distant stars form the background.
          </p>
        )}
        <div className="star-age-key" aria-label="Star color shows time since contribution">
          <span>
            <i style={{ background: STAR_AGE_COLORS.recent }} />
            Blue · 0–7 days
          </span>
          <span>
            <i style={{ background: STAR_AGE_COLORS.month }} />
            White · 8–30 days
          </span>
          <span>
            <i style={{ background: STAR_AGE_COLORS.older }} />
            Amber · 31+ days
          </span>
        </div>
        <span>Twinkling: awaiting confirmation · Steady: confirmed</span>
        {view === 'stars' && (
          <button
            className="text-button motion-toggle"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? 'Resume motion' : 'Pause motion'}
          </button>
        )}
      </div>
      {cluster && !selected && (
        <aside
          className="detail-panel contribution-detail constellation-detail"
          aria-labelledby="constellation-title"
        >
          <div className="sheet-handle" aria-hidden="true" />
          <div className="panel-topline">
            <span className="eyebrow">
              {cluster.category !== 'unclassified' &&
                GALAXIES.find((entry) => entry.id === cluster.category)?.name}
            </span>
            <button
              className="icon-button"
              aria-label="Close constellation"
              onClick={() => {
                setClusterKey(null)
                document.getElementById(`constellation-${cluster.key}`)?.focus()
              }}
            >
              <X size={19} />
            </button>
          </div>
          <h2 id="constellation-title" ref={detailHeading} tabIndex={-1}>
            {cluster.name}
          </h2>
          <p className="form-help">
            {cluster.contributions.length}{' '}
            {cluster.contributions.length === 1 ? 'contribution' : 'contributions'} · Each star is
            one time you supported this organization.
          </p>
          <div className="constellation-history">
            {[...cluster.contributions].reverse().map((entry) => (
              <button key={entry.id} onClick={() => onSelect(entry.id)}>
                <strong>{entry.summary}</strong>
                <span>
                  {ageOf(entry, now).label} · {CONTRIBUTION_LABELS[entry.status]}
                </span>
              </button>
            ))}
          </div>
          <button className="secondary-button" onClick={() => onExplore(cluster.organizationId)}>
            Visit organization
            <ArrowUpRight size={16} />
          </button>
        </aside>
      )}
      {selected && (
        <aside className="detail-panel contribution-detail" aria-labelledby="contribution-title">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="panel-topline">
            <span className="eyebrow">Contribution</span>
            <button
              className="icon-button"
              onClick={() => {
                onSelect(null)
                document
                  .getElementById(`${view === 'stars' ? 'star' : 'contribution'}-${selected.id}`)
                  ?.focus()
              }}
              aria-label="Close contribution"
            >
              <X size={19} />
            </button>
          </div>
          {selected.simulated && <span className="sample-tag">Simulated contribution</span>}
          <h2 id="contribution-title" tabIndex={-1} ref={detailHeading}>
            {selected.organizationName}
          </h2>
          <dl>
            <div>
              <dt>Your contribution</dt>
              <dd>{selected.summary}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>
                {formatDate(selected.createdAt)} · {ageOf(selected, now).label}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className="contribution-status">
                {selected.status === 'organization_confirmed' ? (
                  <Check size={15} />
                ) : (
                  <Circle size={13} />
                )}
                {CONTRIBUTION_LABELS[selected.status]}
              </dd>
            </div>
            {selected.confirmedQuantity !== undefined && (
              <div>
                <dt>Quantity confirmed by organization</dt>
                <dd>
                  {selected.confirmedQuantity} of {selected.quantity}
                </dd>
              </div>
            )}
          </dl>
          <p className="form-help">
            {selected.status === 'pledged'
              ? 'Your pledge has been recorded. Report completion after you have provided the support.'
              : selected.status === 'user_reported_completed'
                ? 'You reported completion. Your star keeps twinkling until the organization confirms receipt.'
                : 'The organization has confirmed receipt.'}
            {selected.simulated &&
              ' This is a simulated record. AidAtlas does not process payment, delivery, or bookings.'}
          </p>
          {selected.status === 'pledged' && (
            <button
              className="primary-button report-completion"
              disabled={updating}
              onClick={async () => {
                setUpdating(true)
                setStatusError('')
                try {
                  onUpdated(
                    await aidApi.updateContributionStatus(selected.id, {
                      status: 'user_reported_completed',
                    }),
                  )
                } catch (failure) {
                  setStatusError(
                    failure instanceof Error
                      ? failure.message
                      : 'Unable to update your contribution.',
                  )
                } finally {
                  setUpdating(false)
                }
              }}
            >
              {updating
                ? 'Saving…'
                : selected.simulated
                  ? 'Report demo support completed'
                  : 'Report support completed'}
              <Check size={16} />
            </button>
          )}
          {statusError && (
            <p className="form-error" role="alert">
              {statusError}
            </p>
          )}
          <button className="secondary-button" onClick={() => onExplore(selected.organizationId)}>
            Visit organization
            <ArrowUpRight size={16} />
          </button>
        </aside>
      )}
    </section>
  )
}
