import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowDown,
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  Layers3,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react'
import { aidApi, DEMO_MODE, demoStorageAvailable } from './api'
import MyCosmos from './components/MyCosmos'
import StarTransfer from './components/StarTransfer'
import type { StarTransferState } from './components/StarTransfer'
import { STAR_TRANSFER_DURATION } from './cosmosEntry'
import ObservationPanel from './components/ObservationPanel'
import OrganizationPanel from './components/OrganizationPanel'
import RequestForm from './components/RequestForm'
import DetectionPanel from './components/DetectionPanel'
import LayerBanner, { type LayerStatus } from './components/LayerBanner'
import { inLayer, LAYER_THEMES } from './exploreLayers'
import Modal from './components/Modal'
import { useNeedSearch } from './hooks/useNeedSearch'
import { formatDate, LAYERS } from './mapConfig'
import type {
  AidRequest,
  BootstrapData,
  Contribution,
  Coordinates,
  FireDetection,
  FireDetections,
  LayerId,
  Observation,
  Session,
} from './types'

type RequestEditor = { organizationId: string; observation?: Observation; existing?: AidRequest }
type Notice = { message: string; contributionId?: string; tone?: 'error' | 'info' }
const EarthMap = lazy(() => import('./components/EarthMap'))
type Approach = 'far' | 'nearing' | 'close'
const NO_DETECTIONS: FireDetections = { type: 'FeatureCollection', features: [] }

export default function App() {
  const [data, setData] = useState<BootstrapData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [page, changePage] = useState<'explore' | 'cosmos'>('explore')
  const [starTransfer, setStarTransfer] = useState<StarTransferState | null>(null)
  const transferId = useRef<string | null>(null)
  const setPage = useCallback((next: 'explore' | 'cosmos') => {
    transferId.current = null
    setStarTransfer(null)
    changePage(next)
  }, [])
  const finishStarTransfer = useCallback(() => {
    transferId.current = null
    setStarTransfer(null)
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [observationId, setObservationId] = useState<string | null>(null)
  const [selectedStar, setSelectedStar] = useState<string | null>(null)
  const [selectedDetection, setSelectedDetection] = useState<FireDetection | null>(null)
  const [detections, setDetections] = useState<FireDetections>(NO_DETECTIONS)
  const [detectionError, setDetectionError] = useState('')
  const [detectionRevision, setDetectionRevision] = useState(0)
  const [observationsOpen, setObservationsOpen] = useState(false)
  const [observationLimit, setObservationLimit] = useState(40)
  // null = the plain globe. A layer draws its disasters or data; organizations stay hidden
  // until the Organizations button is on, and then only the layer's own organizations show.
  const [layer, setLayer] = useState<LayerId | null>(null)
  const [showOrganizations, setShowOrganizations] = useState(false)
  const [approach, setApproach] = useState<Approach>('far')
  const [layerStatus, setLayerStatus] = useState<LayerStatus>({
    loading: false,
    error: '',
    summary: null,
  })
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchIndex, setSearchIndex] = useState(0)
  const [layersOpen, setLayersOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [cosmosVisit, setCosmosVisit] = useState(0)
  const [editor, setEditor] = useState<RequestEditor | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const needSearch = useNeedSearch(query, searchOpen && !!data)

  useEffect(() => {
    if (!starTransfer) return
    const id = starTransfer.id
    function cancel(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setPage('explore')
      requestAnimationFrame(() => {
        const source = [
          ...document.querySelectorAll<HTMLButtonElement>('[data-contribution-id]'),
        ].find((button) => button.dataset.contributionId === id)
        source?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [starTransfer, setPage])

  useEffect(() => {
    let active = true
    aidApi
      .bootstrap()
      .then((result) => {
        if (active) setData(result)
      })
      .catch((error: Error) => {
        if (active) setLoadError(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reload])

  useEffect(() => {
    if (DEMO_MODE || !data?.session.id) return
    let active = true
    aidApi
      .detections()
      .then((result) => {
        if (active) {
          setDetections(result)
          setDetectionError('')
        }
      })
      .catch((error: Error) => {
        if (active) setDetectionError(error.message)
      })
    return () => {
      active = false
    }
  }, [data?.session.id, detectionRevision])

  useEffect(() => {
    if (page !== 'cosmos' || !data?.session.id) return
    let active = true
    let pending = false
    const sessionId = data.session.id
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const next = await aidApi.bootstrap()
        if (active && next.session.id === sessionId)
          setData((previous) => (previous?.session.id === sessionId ? next : previous))
      } catch {
        /* Keep visible records on a background refresh failure; Retry remains available. */
      } finally {
        pending = false
      }
    }
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [page, data?.session.id])

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setSearchOpen(false)
        setLayersOpen(false)
      }
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false)
    }
    function keyboard(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape') {
        if (profileOpen) {
          setProfileOpen(false)
          document.getElementById('profile-trigger')?.focus()
        } else if (layersOpen) {
          setLayersOpen(false)
          document.getElementById('layers-trigger')?.focus()
        } else if (searchOpen) {
          setSearchOpen(false)
          document.getElementById('organizations-trigger')?.focus({ preventScroll: true })
        } else {
          setSelectedId(null)
          setObservationId(null)
          setSelectedDetection(null)
          setSelectedStar(null)
          setSearchOpen(false)
          if (page === 'explore')
            document.getElementById('organizations-trigger')?.focus({ preventScroll: true })
          else document.getElementById('cosmos-nav')?.focus()
        }
      }
      if (
        event.key === '/' &&
        page === 'explore' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)
      ) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [page, profileOpen, layersOpen, searchOpen])

  const selectOrganization = useCallback((id: string) => {
    setSelectedId(id)
    setObservationId(null)
    setSelectedDetection(null)
    setSearchOpen(false)
    setLayersOpen(false)
  }, [])
  const selectObservation = useCallback((id: string) => {
    setObservationId(id)
    setSelectedId(null)
    setSelectedDetection(null)
    setSearchOpen(false)
    setLayersOpen(false)
  }, [])
  const selectDetection = useCallback((detection: FireDetection) => {
    setSelectedDetection(detection)
    setSelectedId(null)
    setObservationId(null)
    setSearchOpen(false)
    setLayersOpen(false)
  }, [])

  const organizations = data?.organizations ?? []
  const selectedOrganization = organizations.find((organization) => organization.id === selectedId)
  const selectedObservation = data?.observations.find(
    (observation) => observation.id === observationId,
  )
  const observedOrganization = organizations.find(
    (organization) => organization.id === selectedObservation?.organizationId,
  )
  const editorOrganization = organizations.find(
    (organization) => organization.id === editor?.organizationId,
  )
  const staffObservation =
    data?.observations.find(
      (observation) =>
        observation.organizationId === data.session.organizationId && !observation.response,
    ) ??
    data?.observations.find(
      (observation) => observation.organizationId === data.session.organizationId,
    )
  const localMatches = organizations.filter((organization) =>
    `${organization.name} ${organization.location} ${organization.requests.map((request) => request.item).join(' ')}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const searchMatches = needSearch.result?.results ?? []
  const filtered = [
    ...new Map(
      [...localMatches, ...searchMatches.map((entry) => entry.organization)].map((entry) => [
        entry.id,
        entry,
      ]),
    ).values(),
  ]
  const hasPanel = !!selectedOrganization || !!selectedObservation || !!selectedDetection
  function retryLoad() {
    setLoading(true)
    setLoadError('')
    setReload((count) => count + 1)
  }

  function closePanel() {
    setSelectedId(null)
    setObservationId(null)
    setSelectedDetection(null)
    setSearchOpen(false)
    // Focusing the search input here would reopen its suggestions.
    document.getElementById('organizations-trigger')?.focus({ preventScroll: true })
  }
  async function refreshData() {
    setData(await aidApi.bootstrap())
  }
  async function selectSearchResult(id: string) {
    try {
      if (!organizations.some((organization) => organization.id === id)) {
        const organization = await aidApi.getOrganization(id)
        setData((previous) =>
          previous
            ? { ...previous, organizations: [...previous.organizations, organization] }
            : previous,
        )
      }
      selectOrganization(id)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to load this organization.',
      })
    }
  }
  function contribute(contribution: Contribution) {
    setData((previous) =>
      previous
        ? { ...previous, contributions: [contribution, ...previous.contributions] }
        : previous,
    )
    setNotice({
      message: `${contribution.simulated ? 'Demo contribution' : 'Contribution'} saved. A new star is waiting for you.${!demoStorageAvailable && DEMO_MODE ? ' Browser storage is unavailable; this record lasts for this session only.' : ''}`,
      contributionId: contribution.id,
    })
  }

  async function resetDemo() {
    setProfileBusy(true)
    try {
      await aidApi.resetDemo()
      // A fresh page load drops every view's earlier state, including the cosmos scene.
      window.location.reload()
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to reset the demo.',
      })
      setProfileBusy(false)
    }
  }

  async function switchRole(role: Session['role'], organizationId = 'okanagan') {
    setProfileBusy(true)
    try {
      const session = await aidApi.signInDemo(role, organizationId)
      // Reload the server-filtered data when identity changes: private drafts must not leak.
      setData(null)
      setLoading(true)
      setLoadError('')
      setSelectedStar(null)
      setObservationId(null)
      setSelectedDetection(null)
      setSelectedId(null)
      setData(await aidApi.bootstrap())
      setProfileOpen(false)
      setPage('explore')
      setEditor(null)
      if (session.organizationId) selectOrganization(session.organizationId)
      setNotice({
        message:
          role === 'staff'
            ? 'Demo staff account active. Open the satellite notification to try a check-in.'
            : 'Demo supporter account active.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to switch accounts.'
      setLoadError(message)
      setNotice({ tone: 'error', message })
    } finally {
      setProfileBusy(false)
      setLoading(false)
    }
  }

  async function replayObservations() {
    setProfileBusy(true)
    try {
      const replay = await aidApi.replayObservations()
      await refreshData()
      setDetectionRevision((value) => value + 1)
      setProfileOpen(false)
      setPage('explore')
      setLayer('wildfire')
      setNotice({
        message: `Historical replay (${formatDate(replay.observedFrom)}): ${replay.detectionsTotal} detections, ${replay.checkInsCreated} new check-ins. No requests were published.`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to replay observations.',
      })
    } finally {
      setProfileBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="topbar">
        <button
          className="wordmark"
          aria-label="AidAtlas — explore Earth"
          onClick={() => setPage('explore')}
        >
          <svg
            className="brand-symbol"
            width="30"
            height="30"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
          >
            <path d="M7 24 16 6 25 24M10.2 18h11.6" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3 24c6.5 1.5 18-4.5 26-15" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>AidAtlas</span>
          {(DEMO_MODE || data?.session.demo) && <span className="demo-badge">DEMO</span>}
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={page === 'explore' ? 'active' : ''}
            aria-current={page === 'explore' ? 'page' : undefined}
            onClick={() => {
              setPage('explore')
              setProfileOpen(false)
            }}
          >
            Explore
          </button>
          <button
            id="cosmos-nav"
            className={page === 'cosmos' ? 'active' : ''}
            aria-current={page === 'cosmos' ? 'page' : undefined}
            onClick={() => {
              setSelectedStar(null)
              setCosmosVisit((visit) => visit + 1)
              setPage('cosmos')
              setProfileOpen(false)
              setSearchOpen(false)
              setLayersOpen(false)
            }}
          >
            My Cosmos
          </button>
        </nav>
        <div className="header-actions">
          {data?.session.role === 'staff' && staffObservation && (
            <button
              className="icon-button notification-button"
              aria-label="Open satellite check-in notification"
              onClick={() => {
                setPage('explore')
                selectObservation(staffObservation.id)
              }}
            >
              <Bell size={19} />
              {!staffObservation.response && <span className="notification-dot" />}
            </button>
          )}
          <div className="profile-container" ref={profileRef}>
            <button
              id="profile-trigger"
              className="profile-button"
              aria-label={`${data?.session.demo ? 'Demo account' : 'Account'}: ${data?.session.name ?? 'Profile'}`}
              aria-expanded={profileOpen}
              aria-controls="profile-menu"
              onClick={() => setProfileOpen(!profileOpen)}
            >
              <span className="avatar">
                {data?.session.name
                  .split(' ')
                  .map((name) => name[0])
                  .join('') ?? 'A'}
              </span>
              <ChevronDown size={12} />
            </button>
            {profileOpen && (
              <div className="profile-menu floating-surface" id="profile-menu">
                <span className="eyebrow">
                  {DEMO_MODE || data?.session.demo ? 'DEMO ACCOUNT' : 'YOUR ACCOUNT'}
                </span>
                <strong>{data?.session.name ?? 'Loading…'}</strong>
                <p>
                  {data?.session.role === 'staff' ? 'Organization staff' : 'Community supporter'}
                </p>
                {(DEMO_MODE || data?.session.demo) && (
                  <>
                    <div className="menu-divider" />
                    <span className="menu-label">Try a perspective</span>
                    <button disabled={profileBusy} onClick={() => switchRole('supporter')}>
                      <span>Supporter</span>
                      {data?.session.role === 'supporter' && <Check size={14} />}
                    </button>
                    <button disabled={profileBusy} onClick={() => switchRole('staff', 'okanagan')}>
                      <span>Organization staff · Okanagan</span>
                      {data?.session.organizationId === 'okanagan' && <Check size={14} />}
                    </button>
                  </>
                )}
                {!DEMO_MODE && data?.session.demo && (
                  <>
                    <div className="menu-divider" />
                    <span className="menu-label">HISTORICAL OBSERVATIONS</span>
                    <button disabled={profileBusy} onClick={replayObservations}>
                      {profileBusy ? 'Replaying…' : 'Replay BC wildfires · August 2023'}
                    </button>
                    <p className="profile-note">
                      Recorded satellite data. Replaying creates private check-ins, never public
                      requests.
                    </p>
                  </>
                )}
                {(DEMO_MODE || data?.session.demo) && (
                  <>
                    <div className="menu-divider" />
                    <button disabled={profileBusy} onClick={resetDemo}>
                      <span>Reset demo</span>
                    </button>
                    <p className="profile-note">
                      Restores the sample data and your constellations, so they can connect again.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <main
        id="main-content"
        className="main-content"
        tabIndex={-1}
        data-star-transfer={
          starTransfer ? (starTransfer.destination ? 'flying' : 'preparing') : undefined
        }
        style={
          starTransfer
            ? ({
                '--transfer-duration': `${STAR_TRANSFER_DURATION}ms`,
                '--transfer-origin-x': `${starTransfer.origin.x - starTransfer.sceneOffset.x}px`,
                '--transfer-origin-y': `${starTransfer.origin.y - starTransfer.sceneOffset.y}px`,
                '--transfer-target-x': `${(starTransfer.destination?.x ?? starTransfer.origin.x) - starTransfer.sceneOffset.x}px`,
                '--transfer-target-y': `${(starTransfer.destination?.y ?? starTransfer.origin.y) - starTransfer.sceneOffset.y}px`,
                '--transfer-dx': `${(starTransfer.destination?.x ?? starTransfer.origin.x) - starTransfer.origin.x}px`,
                '--transfer-dy': `${(starTransfer.destination?.y ?? starTransfer.origin.y) - starTransfer.origin.y}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div
          className={`explore-view ${page !== 'explore' && !starTransfer ? 'view-hidden' : ''}`}
          aria-hidden={page !== 'explore' || !!starTransfer}
          inert={page !== 'explore' || !!starTransfer}
        >
          <Suspense
            fallback={
              <div className="map-message" role="status">
                Preparing Earth…
              </div>
            }
          >
            <EarthMap
              contributions={data?.contributions ?? []}
              onContribution={(id, origin) => {
                setSelectedStar(id)
                setCosmosVisit((visit) => visit + 1)
                if (origin) {
                  transferId.current = id
                  const bounds = document.getElementById('main-content')?.getBoundingClientRect()
                  setStarTransfer({
                    id,
                    origin,
                    destination: null,
                    sceneOffset: { x: bounds?.left ?? 0, y: bounds?.top ?? 0 },
                  })
                } else setPage('cosmos')
                setSearchOpen(false)
                setLayersOpen(false)
                setProfileOpen(false)
              }}
              organizations={organizations}
              observations={data?.observations ?? []}
              selectedId={selectedId ?? selectedObservation?.organizationId ?? null}
              selectedCoordinates={
                selectedDetection?.geometry.coordinates as Coordinates | undefined
              }
              detections={detections}
              onDetection={selectDetection}
              highlightedIds={query ? filtered.map((entry) => entry.id) : []}
              query={query.trim()}
              layer={layer}
              showOrganizations={showOrganizations}
              onLayerStatus={setLayerStatus}
              onApproach={setApproach}
              onSelect={selectOrganization}
              onObservation={selectObservation}
            />
          </Suspense>
          <div className={`explore-toolbar ${hasPanel ? 'with-panel' : ''}`} ref={toolbarRef}>
            <div className="search-wrapper">
              <div className="search-field">
                <Search size={16} />
                <input
                  ref={searchRef}
                  type="search"
                  aria-label="Search organizations or places"
                  placeholder="Search organizations or places"
                  value={query}
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={searchOpen}
                  aria-controls="search-results"
                  aria-activedescendant={
                    searchOpen && filtered.length
                      ? `search-result-${Math.min(searchIndex, filtered.length - 1)}`
                      : undefined
                  }
                  onFocus={() => {
                    setSearchOpen(true)
                    setLayersOpen(false)
                  }}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setSearchIndex(0)
                    setSearchOpen(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setSearchOpen(true)
                      setSearchIndex((index) =>
                        Math.max(0, Math.min(index + 1, filtered.length - 1)),
                      )
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setSearchIndex((index) => Math.max(index - 1, 0))
                    }
                    if (event.key === 'Enter' && searchOpen && filtered.length) {
                      event.preventDefault()
                      void selectSearchResult(
                        filtered[Math.max(0, Math.min(searchIndex, filtered.length - 1))].id,
                      )
                    }
                  }}
                />
                {query ? (
                  <button
                    className="search-clear"
                    onClick={() => {
                      setQuery('')
                      setSearchIndex(0)
                      searchRef.current?.focus()
                    }}
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <kbd>/</kbd>
                )}
              </div>
              {searchOpen && (
                <div className="search-results floating-surface">
                  <span className="menu-label">
                    {DEMO_MODE ? 'SAMPLE ORGANIZATIONS' : 'ORGANIZATIONS'}
                  </span>
                  {needSearch.loading && (
                    <p className="search-status" role="status">
                      Searching community needs…
                    </p>
                  )}
                  {needSearch.error && (
                    <p className="search-status" role="status">
                      Need search is unavailable. Showing name and place matches.
                    </p>
                  )}
                  {needSearch.result && (
                    <p className="search-status">
                      {needSearch.result.method === 'tidb_vector'
                        ? 'Matches suggested from published requests'
                        : 'Keyword matches from published requests'}
                    </p>
                  )}
                  {loading ? (
                    <p className="search-empty" role="status">
                      Finding organizations…
                    </p>
                  ) : loadError ? (
                    <p className="search-empty">
                      Organizations could not be loaded. Use Retry below.
                    </p>
                  ) : null}
                  <div
                    id="search-results"
                    role="listbox"
                    aria-label="Organizations"
                    aria-busy={loading || needSearch.loading}
                  >
                    {!loading &&
                      !loadError &&
                      filtered.map((organization, index) => (
                        <button
                          role="option"
                          aria-selected={index === searchIndex}
                          id={`search-result-${index}`}
                          key={organization.id}
                          className={index === searchIndex ? 'highlighted' : ''}
                          onClick={() => void selectSearchResult(organization.id)}
                        >
                          <span className="result-dot" />
                          <span>
                            <strong>{organization.name}</strong>
                            <small>{organization.location}</small>
                            {searchMatches.find(
                              (entry) => entry.organization.id === organization.id,
                            ) && (
                              <small>
                                {
                                  searchMatches.find(
                                    (entry) => entry.organization.id === organization.id,
                                  )?.request.item
                                }
                              </small>
                            )}
                          </span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                  </div>
                  {!loading && !loadError && !filtered.length && !needSearch.loading && (
                    <div className="search-empty" role="status">
                      No organizations found for “{query}”.
                      <button
                        className="text-button"
                        onClick={() => {
                          setQuery('')
                          setSearchIndex(0)
                        }}
                      >
                        Show all organizations
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="layers-wrapper">
              <button
                id="layers-trigger"
                className={`layers-button ${layersOpen ? 'active' : ''}`}
                aria-expanded={layersOpen}
                aria-controls="layers-menu"
                onClick={() => {
                  setLayersOpen(!layersOpen)
                  setSearchOpen(false)
                }}
              >
                <Layers3 size={16} />
                <span>Layers</span>
              </button>
              {layersOpen && (
                <div className="layers-menu floating-surface" id="layers-menu">
                  <span className="menu-label">VIEW THE WORLD THROUGH</span>
                  <fieldset>
                    <legend className="sr-only">Map layer</legend>
                    {LAYERS.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`layer-option ${!entry.available ? 'unavailable' : ''}`}
                        aria-pressed={layer === entry.id}
                        disabled={!entry.available}
                        onClick={() => {
                          // Choosing the active layer again turns it off: back to the plain globe.
                          setLayer(layer === entry.id ? null : entry.id)
                          setLayersOpen(false)
                          document.getElementById('layers-trigger')?.focus()
                        }}
                      >
                        <span>
                          <strong>{entry.name}</strong>
                          <small>{LAYER_THEMES[entry.id].shows}</small>
                        </span>
                        {!entry.available && <span className="unavailable-tag">Unavailable</span>}
                      </button>
                    ))}
                  </fieldset>
                  <p>
                    Choose a layer again to turn it off. Organizations appear with the Organizations
                    button.
                  </p>
                </div>
              )}
            </div>
            <button
              id="organizations-trigger"
              className={`layers-button ${showOrganizations ? 'active' : ''}`}
              aria-label="Organizations"
              aria-pressed={showOrganizations}
              onClick={() => {
                setShowOrganizations(!showOrganizations)
                setLayersOpen(false)
                setSearchOpen(false)
              }}
            >
              <Building2 size={16} />
              <span>Organizations</span>
              {showOrganizations && (
                <span className="toggle-count">
                  {organizations.filter((entry) => inLayer(entry, layer)).length}
                </span>
              )}
            </button>
          </div>
          {(loading || loadError) && (
            <div className="data-state" role={loadError ? 'alert' : 'status'}>
              {loading ? (
                <>
                  <LoaderCircle size={16} className="spinner" />
                  Loading community information…
                </>
              ) : (
                <>
                  <span>{loadError}</span>
                  <button className="text-button" onClick={retryLoad}>
                    Retry
                  </button>
                </>
              )}
            </div>
          )}
          {layer && <LayerBanner layer={layer} status={layerStatus} />}
          {!hasPanel && !layer && (
            // Brightens while the camera comes closer, leaves once it is close, returns from afar.
            <div
              className={`explore-hint ${approach === 'close' ? 'is-gone' : approach === 'nearing' ? 'is-nearing' : ''}`}
              aria-hidden={approach === 'close'}
            >
              <p>Explore the globe to find where you can help.</p>
              <span className="explore-hint-closer">
                <ArrowDown size={13} />
              </span>
            </div>
          )}
          <div
            className={`map-legend ${hasPanel ? 'panel-open' : ''} ${layer === 'nature' ? 'nature-legend' : ''}`}
          >
            {/* Pin colours show with the Organizations button on; observations always show. */}
            <div className="legend-items" hidden={!showOrganizations && layer !== 'wildfire'}>
              {showOrganizations && (
                <>
                  {/* Organization pins take the colour of their most pressing open request. */}
                  <span>
                    <i className="organization-legend-dot urgent" aria-hidden="true" />
                    Urgent need
                  </span>
                  <span>
                    <i className="organization-legend-dot standard" aria-hidden="true" />
                    Open need
                  </span>
                  <span>
                    <i className="organization-legend-dot" aria-hidden="true" />
                    No open needs
                  </span>
                </>
              )}
              {layer === 'wildfire' && (
                <span>
                  <i className="observation-legend-dot" />
                  Observation
                </span>
              )}
            </div>
            <p>
              {layer === 'nature'
                ? (layerStatus.summary?.imagery ?? 'Sentinel-2 · 2024 cloudless composite')
                : 'Sentinel-2 · 2024 cloudless composite'}
            </p>
            <p className="legend-source">
              {layer === 'nature'
                ? (layerStatus.summary?.imageryNote ?? 'Drag the timeline to compare the landscape')
                : layer === 'domestic_violence'
                  ? 'Select a country to explore estimates and support requests'
                  : layer
                    ? 'Hover a disaster or a country for its details'
                    : 'Choose a layer to see disasters and data'}
            </p>
          </div>
          {layer === 'wildfire' && (
            <button
              className={`browse-observations ${hasPanel ? 'panel-open' : ''}`}
              onClick={() => {
                setObservationsOpen(true)
                setObservationLimit(40)
              }}
            >
              Browse observations
              <ArrowUpRight size={11} />
            </button>
          )}
          {detectionError && (
            <div className="detection-error" role="status">
              Satellite detections unavailable.
              <button
                className="text-button"
                onClick={() => setDetectionRevision((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {selectedOrganization && data && (
            <OrganizationPanel
              key={selectedOrganization.id}
              organization={selectedOrganization}
              session={data.session}
              onClose={closePanel}
              onRequest={(existing) =>
                setEditor({ organizationId: selectedOrganization.id, existing })
              }
              onContribute={contribute}
              onRefresh={refreshData}
            />
          )}
          {selectedObservation && observedOrganization && data && (
            <ObservationPanel
              key={selectedObservation.id}
              observation={selectedObservation}
              organization={observedOrganization}
              session={data.session}
              onClose={closePanel}
              onResponse={(observation) =>
                setData((previous) =>
                  previous
                    ? {
                        ...previous,
                        observations: previous.observations.map((entry) =>
                          entry.id === observation.id ? observation : entry,
                        ),
                      }
                    : previous,
                )
              }
              onSupport={() =>
                setEditor({
                  organizationId: observedOrganization.id,
                  observation: selectedObservation,
                })
              }
            />
          )}
          {selectedDetection && (
            <DetectionPanel
              detection={selectedDetection}
              organizations={organizations}
              onClose={closePanel}
              onSelectOrganization={selectOrganization}
            />
          )}
        </div>
        {(page === 'cosmos' || starTransfer) && (
          <div className="cosmos-screen" aria-hidden={!!starTransfer} inert={!!starTransfer}>
            <MyCosmos
              key={`${data?.session.id ?? 'loading'}:${cosmosVisit}`}
              accountId={data?.session.id ?? ''}
              organizations={organizations}
              contributions={data?.contributions ?? []}
              selectedId={selectedStar}
              entry={
                starTransfer
                  ? {
                      id: starTransfer.id,
                      onReady: (point) => {
                        if (transferId.current !== starTransfer.id) return
                        changePage('cosmos')
                        if (!point || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
                          finishStarTransfer()
                        else
                          setStarTransfer((current) =>
                            current ? { ...current, destination: point } : null,
                          )
                      },
                    }
                  : undefined
              }
              onSelect={setSelectedStar}
              loading={loading}
              error={loadError}
              onRetry={retryLoad}
              onRefresh={refreshData}
              onUpdated={(contribution) =>
                setData((previous) =>
                  previous
                    ? {
                        ...previous,
                        contributions: previous.contributions.map((entry) =>
                          entry.id === contribution.id ? contribution : entry,
                        ),
                      }
                    : previous,
                )
              }
              onExplore={(id) => {
                setPage('explore')
                if (id) selectOrganization(id)
              }}
            />
          </div>
        )}
      </main>
      {starTransfer && <StarTransfer transfer={starTransfer} onComplete={finishStarTransfer} />}
      {notice && (
        <div className="toast" role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span className="toast-check">
            {notice.tone === 'error' ? <CircleAlert size={16} /> : <Check size={16} />}
          </span>
          <div>
            <p>{notice.message}</p>
            {notice.contributionId && (
              <button
                className="text-button"
                onClick={() => {
                  setPage('cosmos')
                  setSelectedStar(notice.contributionId ?? null)
                  setNotice(null)
                }}
              >
                View in My Cosmos <ArrowUpRight size={13} />
              </button>
            )}
          </div>
          <button
            className="icon-button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {observationsOpen && (
        <Modal
          title="Satellite observations"
          eyebrow="OBSERVATIONS ARE NOT CONFIRMED NEEDS"
          onClose={() => setObservationsOpen(false)}
        >
          <div className="observation-list">
            {data?.observations.map((observation) => (
              <button
                key={observation.id}
                onClick={() => {
                  setObservationsOpen(false)
                  selectObservation(observation.id)
                }}
              >
                <strong>{observation.title}</strong>
                <span>
                  {
                    organizations.find(
                      (organization) => organization.id === observation.organizationId,
                    )?.name
                  }
                </span>
                <small>
                  {formatDate(observation.observedAt)} ·{' '}
                  {observation.simulated
                    ? 'Simulated'
                    : observation.playback
                      ? 'Historical replay'
                      : observation.source}
                </small>
              </button>
            ))}
            {detections.features.slice(0, observationLimit).map((detection) => (
              <button
                key={detection.properties.id}
                onClick={() => {
                  setObservationsOpen(false)
                  selectDetection(detection)
                }}
              >
                <strong>Satellite heat detection</strong>
                <span>
                  {detection.properties.source} · {detection.properties.satellite}
                </span>
                <small>
                  {formatDate(detection.properties.acquiredAt, true)}
                  {detection.properties.playback ? ' · Historical replay' : ''}
                </small>
              </button>
            ))}
            {!data?.observations.length && !detections.features.length && (
              <p className="empty-inline">No observations are available for this view.</p>
            )}
            {detections.features.length > observationLimit && (
              <button
                className="secondary-button"
                onClick={() => setObservationLimit((value) => value + 40)}
              >
                Show more observations
              </button>
            )}
          </div>
        </Modal>
      )}
      {editor && editorOrganization && (
        <RequestForm
          organization={editorOrganization}
          observation={editor.observation}
          existing={editor.existing}
          onClose={() => setEditor(null)}
          onSave={(request) => {
            setData((previous) =>
              previous
                ? {
                    ...previous,
                    organizations: previous.organizations.map((organization) =>
                      organization.id === request.organizationId
                        ? {
                            ...organization,
                            updatedAt: request.confirmedAt,
                            requests: organization.requests.some((entry) => entry.id === request.id)
                              ? organization.requests.map((entry) =>
                                  entry.id === request.id ? request : entry,
                                )
                              : [request, ...organization.requests],
                          }
                        : organization,
                    ),
                  }
                : previous,
            )
            setEditor(null)
            selectOrganization(request.organizationId)
            setNotice({
              message: `${editorOrganization.sample ? 'Demo request' : 'Request'} published. Supporters can now see the confirmed need.`,
            })
          }}
        />
      )}
    </div>
  )
}
