import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, ArrowDown, Crosshair } from 'lucide-react'
import { ageOf, GALAXIES } from '../cosmosModel'
import type { Constellation, GalaxyId } from '../cosmosModel'
import { selectedOrganization } from '../cosmosSpace'
import { CONTRIBUTION_LABELS } from '../support'
import type { SpaceRenderer, SpaceState } from '../spaceRenderer'
import type { NavigationDirection } from '../spaceNavigation'
import { isComplete, patternFor } from '../constellationCollection'
import type { CollectionSnapshot } from '../constellationCollection'
import type { CosmosEntry } from '../cosmosEntry'

export default function CosmosScene({
  entry,
  collection,
  visit,
  discovery,
  onCollected,
  onCollection,
  groups,
  selectedId,
  selectedCluster,
  onSelect,
  onCluster,
  paused,
  now,
  onList,
}: {
  entry?: CosmosEntry
  collection: CollectionSnapshot
  visit: { id: string; sequence: number } | null
  discovery: string | null
  onCollected: (id: string) => void
  onCollection: () => void
  groups: Constellation[]
  selectedId: string | null
  selectedCluster: string | null
  onSelect: (id: string | null) => void
  onCluster: (cluster: Constellation | null) => void
  paused: boolean
  now: number
  onList: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const renderer = useRef<SpaceRenderer | null>(null)
  const labels = useRef(new Map<string, HTMLButtonElement>())
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focused = useRef('')
  const [category, setCategory] = useState<GalaxyId | null>(() =>
    entry
      ? (groups.find((group) => group.contributions.some((star) => star.id === entry.id))
          ?.category ?? null)
      : null,
  )
  const entryCallback = useRef(entry?.onReady)
  const [hovered, setHovered] = useState<GalaxyId | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [flashing, setFlashing] = useState<string[]>([])
  const [announcement, setAnnouncement] = useState('')
  const previousStatuses = useRef<Map<string, string> | null>(null)
  const [travelDirection, setTravelDirection] = useState<NavigationDirection | null>(null)
  const travelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealCallback = useRef(onCollected)
  const revealed = collection.plans.find(
    (plan) =>
      plan.category === category && isComplete(plan) && !collection.seen.includes(plan.patternId),
  )
  const revealing = !selectedId && !selectedCluster ? (revealed?.patternId ?? null) : null
  const inProgress = collection.plans.find(
    (plan) => plan.category === category && !isComplete(plan),
  )
  const collectedCount = collection.plans.filter(
    (plan) => plan.category === category && collection.seen.includes(plan.patternId),
  ).length
  const showDiscovery = Boolean(
    discovery &&
    category === collection.plans.find((plan) => plan.patternId === discovery)?.category &&
    !revealing &&
    !selectedId &&
    !selectedCluster,
  )
  const state: SpaceState = {
    entryStar: entry?.id,
    groups,
    selectedId,
    selectedCluster,
    paused,
    now,
    flashing,
    collection: collection.plans,
    seen: collection.seen,
    revealing,
  }
  const latest = useRef(state)
  const activeGroup = selectedOrganization(groups, selectedId, selectedCluster)
  const galaxies = GALAXIES.filter((galaxy) => galaxy.id !== 'unclassified')
  const organizationCounts = new Map(
    galaxies.map((galaxy) => [
      galaxy.id,
      groups.filter((group) => group.category === galaxy.id).length,
    ]),
  )

  function cancelHover() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHovered(null)
  }
  function openGalaxy(id: GalaxyId) {
    cancelHover()
    if (id === category) return
    onSelect(null)
    onCluster(null)
    renderer.current?.focusGalaxy(id)
    setCategory(id)
    setAnnouncement(
      `${GALAXIES.find((galaxy) => galaxy.id === id)!.name}. Select an organization or a contribution star.`,
    )
  }
  function approach(id: GalaxyId, pointerType: string) {
    if (
      pointerType !== 'mouse' ||
      category === id ||
      paused ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return
    cancelHover()
    setHovered(id)
    hoverTimer.current = setTimeout(() => {
      if (latest.current.paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
        cancelHover()
      else openGalaxy(id)
    }, 800)
  }
  function home() {
    cancelHover()
    onSelect(null)
    onCluster(null)
    setCategory(null)
    renderer.current?.reset()
    setAnnouncement('Back at your starting position. Drag to look around in 360 degrees.')
  }

  useEffect(() => {
    entryCallback.current = entry?.onReady
    revealCallback.current = onCollected
    latest.current = state
    renderer.current?.update(state)
  })

  useEffect(() => {
    let cancelled = false
    let instance: SpaceRenderer | undefined
    import('../spaceRenderer')
      .then(({ createSpaceRenderer }) => {
        if (cancelled || !viewport.current) return
        instance = createSpaceRenderer(viewport.current, latest.current, {
          project(points) {
            const occupied: { left: number; top: number; right: number; bottom: number }[] = []
            const bounds = viewport.current?.getBoundingClientRect()
            for (const control of viewport.current?.parentElement?.querySelectorAll(
              '.cosmos-camera-controls, .cosmos-trackpad',
            ) ?? []) {
              const rect = control.getBoundingClientRect()
              if (bounds)
                occupied.push({
                  left: rect.left - bounds.left,
                  top: rect.top - bounds.top,
                  right: rect.right - bounds.left,
                  bottom: rect.bottom - bounds.top,
                })
            }
            for (const point of points) {
              const element = labels.current.get(point.key)
              if (!element) continue
              element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`
              element.style.visibility = point.visible ? 'visible' : 'hidden'
              element.dataset.side =
                point.x > (viewport.current?.clientWidth ?? 1000) * 0.63 ? 'left' : 'right'
              if (point.key.startsWith('galaxy:') && point.visible) {
                occupied.push({
                  left: point.x - element.offsetWidth / 2,
                  right: point.x + element.offsetWidth / 2,
                  top: point.y - 28,
                  bottom: point.y + 28,
                })
              }
              if (point.key.startsWith('organization:') && point.visible) {
                const label = element.querySelector('span')
                const width = label?.offsetWidth ?? 185
                const height = label?.offsetHeight ?? 44
                function rectangle(side: string) {
                  const left = side === 'left' ? point.x - width - 23 : point.x + 23
                  return {
                    left,
                    top: point.y - 12,
                    right: left + width,
                    bottom: point.y - 12 + height,
                  }
                }
                function blocked(rect: ReturnType<typeof rectangle>) {
                  return (
                    rect.left < 12 ||
                    rect.right > (bounds?.width ?? 1000) - 12 ||
                    occupied.some(
                      (other) =>
                        rect.left < other.right + 12 &&
                        rect.right > other.left - 12 &&
                        rect.top < other.bottom + 10 &&
                        rect.bottom > other.top - 10,
                    )
                  )
                }
                let rect = rectangle(element.dataset.side!)
                if (blocked(rect)) {
                  const opposite = element.dataset.side === 'left' ? 'right' : 'left'
                  const alternate = rectangle(opposite)
                  if (!blocked(alternate)) {
                    element.dataset.side = opposite
                    rect = alternate
                  }
                }
                const overlaps = blocked(rect)
                element.dataset.collapsed = String(overlaps)
                if (!overlaps) occupied.push(rect)
              }
              element.tabIndex = point.visible ? 0 : -1
            }
          },
          approached(id) {
            setCategory(id)
            cancelHover()
          },
          interrupted: cancelHover,
          failed() {
            setFailed(true)
            setReady(false)
            cancelHover()
            entryCallback.current?.(null)
          },
          entryReady(point) {
            const bounds = viewport.current?.getBoundingClientRect()
            if (bounds)
              entryCallback.current?.({ x: bounds.left + point.x, y: bounds.top + point.y })
          },
          revealed(id) {
            revealCallback.current(id)
          },
          travelled(direction) {
            setTravelDirection(direction)
            if (travelTimer.current) clearTimeout(travelTimer.current)
            travelTimer.current = setTimeout(() => setTravelDirection(null), 700)
          },
        })
        renderer.current = instance
        focused.current = latest.current.entryStar ? `star:${latest.current.entryStar}` : ''
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          entryCallback.current?.(null)
        }
      })
    return () => {
      cancelled = true
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (travelTimer.current) clearTimeout(travelTimer.current)
      instance?.dispose()
      renderer.current = null
    }
  }, [revision])

  useEffect(() => {
    if (ready && revealing) renderer.current?.focusConstellation(revealing)
  }, [ready, revealing])

  useEffect(() => {
    if (!ready || !visit) return
    const plan = latest.current.collection?.find((entry) => entry.patternId === visit.id)
    if (plan) {
      renderer.current?.focusConstellation(visit.id)
      setCategory(plan.category)
    }
  }, [ready, visit])

  useEffect(() => {
    if (!ready) return
    const key = selectedId
      ? `star:${selectedId}`
      : selectedCluster
        ? `organization:${selectedCluster}`
        : ''
    if (key && focused.current !== key && activeGroup) {
      if (selectedId) renderer.current?.focusStar(selectedId)
      else renderer.current?.focusOrganization(activeGroup.key)
    }
    focused.current = key
  }, [selectedId, selectedCluster, ready, activeGroup])

  useEffect(() => {
    if (!previousStatuses.current) {
      try {
        previousStatuses.current = new Map(
          Object.entries(JSON.parse(sessionStorage.getItem('aidatlas-cosmos-statuses') || '{}')),
        )
      } catch {
        previousStatuses.current = new Map()
      }
    }
    const entries = groups.flatMap((group) => group.contributions)
    const confirmed = entries
      .filter(
        (entry) =>
          previousStatuses.current!.has(entry.id) &&
          previousStatuses.current!.get(entry.id) !== 'organization_confirmed' &&
          entry.status === 'organization_confirmed',
      )
      .map((entry) => entry.id)
    previousStatuses.current = new Map(entries.map((entry) => [entry.id, entry.status]))
    try {
      sessionStorage.setItem(
        'aidatlas-cosmos-statuses',
        JSON.stringify(Object.fromEntries(previousStatuses.current)),
      )
    } catch {
      /* Optional visual history. */
    }
    if (!confirmed.length) return
    setFlashing(confirmed)
    setAnnouncement('Your organization confirmed receipt. Your contribution star is now steady.')
    const timer = setTimeout(() => setFlashing([]), 1600)
    return () => clearTimeout(timer)
  }, [groups])

  return (
    <div
      className="cosmos-navigation"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && category && !selectedId && !selectedCluster) {
          event.preventDefault()
          event.stopPropagation()
          home()
        }
      }}
    >
      <div className="cosmos-navigation-header">
        <nav className="cosmos-breadcrumb" aria-label="Cosmos location">
          <button className={category ? 'cosmos-back-button' : ''} onClick={home}>
            {category && <ArrowLeft size={15} />}
            {category ? 'Back to universe' : 'Your universe'}
          </button>
        </nav>
        {category && (
          <nav className="cosmos-galaxy-switcher" aria-label="Travel between galaxies">
            {galaxies.map((galaxy) => (
              <button
                key={galaxy.id}
                className={hovered === galaxy.id ? 'is-approaching' : ''}
                aria-current={category === galaxy.id ? 'location' : undefined}
                aria-disabled={category === galaxy.id || undefined}
                onPointerEnter={(event) => approach(galaxy.id, event.pointerType)}
                onPointerLeave={cancelHover}
                onBlur={cancelHover}
                onClick={() => openGalaxy(galaxy.id)}
              >
                {galaxy.name}
              </button>
            ))}
          </nav>
        )}
        {category && !selectedId && !selectedCluster && (!showDiscovery || inProgress) && (
          <div className="cosmos-progress" role="status">
            <span>
              {revealing
                ? `Tracing ${patternFor(revealing).name}…`
                : inProgress
                  ? `${inProgress.contributionIds.length} / ${patternFor(inProgress.patternId).points.length} stars for your next constellation`
                  : `${collectedCount} ${collectedCount === 1 ? 'constellation' : 'constellations'} collected`}
            </span>
            <button onClick={onCollection}>View collection</button>
          </div>
        )}
        {discovery && showDiscovery && (
          <div className="constellation-discovery" role="status">
            <span>{patternFor(discovery).name}</span>
            <p>Added to your constellation collection.</p>
            <button onClick={onCollection}>View collection</button>
          </div>
        )}
      </div>
      <div
        ref={viewport}
        className="cosmos-viewport"
        tabIndex={0}
        aria-label="Interactive universe. Drag to look around. Shift and scroll or drag to pan. Scroll or pinch to travel closer or farther. Arrow keys look around, plus and minus move, Home returns to the start."
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          const key = event.key
          if (
            ['Home', '+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
          )
            event.preventDefault()
          if (key === 'Home') home()
          if (key === '+' || key === '=') renderer.current?.zoom(1.3)
          if (key === '-') renderer.current?.zoom(1 / 1.3)
          if (key === 'ArrowLeft') renderer.current?.rotate(0.15, 0)
          if (key === 'ArrowRight') renderer.current?.rotate(-0.15, 0)
          if (key === 'ArrowUp') renderer.current?.rotate(0, 0.15)
          if (key === 'ArrowDown') renderer.current?.rotate(0, -0.15)
        }}
      >
        {ready && !failed && (
          <div className="space-labels">
            {galaxies.map((galaxy) => (
              <button
                key={galaxy.id}
                ref={(node) => {
                  if (node) labels.current.set(`galaxy:${galaxy.id}`, node)
                  else labels.current.delete(`galaxy:${galaxy.id}`)
                }}
                style={{ visibility: 'hidden' }}
                hidden={category === galaxy.id}
                className={`space-galaxy ${hovered === galaxy.id ? 'is-approaching' : ''} ${category === galaxy.id ? 'is-close' : ''}`}
                aria-label={`Explore ${galaxy.name}`}
                onPointerEnter={(event) => approach(galaxy.id, event.pointerType)}
                onPointerLeave={cancelHover}
                onClick={() => openGalaxy(galaxy.id)}
              >
                <span className="space-galaxy-name">
                  {galaxy.name}
                  <small>
                    {hovered === galaxy.id
                      ? 'Approaching…'
                      : `${organizationCounts.get(galaxy.id)} ${organizationCounts.get(galaxy.id) === 1 ? 'organization' : 'organizations'}`}
                  </small>
                </span>
              </button>
            ))}
            {groups.map((group) => (
              <button
                key={group.key}
                id={`constellation-${group.key}`}
                ref={(node) => {
                  if (node) labels.current.set(`organization:${group.key}`, node)
                  else labels.current.delete(`organization:${group.key}`)
                }}
                style={{ visibility: 'hidden' }}
                className={`space-organization ${activeGroup?.key === group.key ? 'selected' : ''}`}
                aria-label={`View ${group.name} constellation`}
                aria-pressed={activeGroup?.key === group.key}
                onClick={() => {
                  cancelHover()
                  onSelect(null)
                  onCluster(group)
                  if (selectedCluster === group.key && !selectedId)
                    renderer.current?.focusOrganization(group.key)
                }}
              >
                <span>
                  {group.name}
                  <small>
                    {group.contributions.length}{' '}
                    {group.contributions.length === 1 ? 'contribution' : 'contributions'}
                  </small>
                </span>
              </button>
            ))}
            {collection.plans.filter(isComplete).map((plan) => (
              <button
                key={plan.patternId}
                ref={(node) => {
                  if (node) labels.current.set(`collection:${plan.patternId}`, node)
                  else labels.current.delete(`collection:${plan.patternId}`)
                }}
                style={{ visibility: 'hidden' }}
                className="space-constellation"
                aria-label={`Visit ${patternFor(plan.patternId).name} constellation`}
                onClick={() => renderer.current?.focusConstellation(plan.patternId)}
              >
                {patternFor(plan.patternId).name}
                <small>
                  {collection.seen.includes(plan.patternId)
                    ? 'Collected'
                    : revealing === plan.patternId
                      ? 'Tracing…'
                      : 'Ready to reveal'}
                </small>
              </button>
            ))}
            {groups.flatMap((group) =>
              group.contributions.map((entry) => (
                <button
                  key={entry.id}
                  id={`star-${entry.id}`}
                  ref={(node) => {
                    if (node) labels.current.set(`star:${entry.id}`, node)
                    else labels.current.delete(`star:${entry.id}`)
                  }}
                  style={{ visibility: 'hidden' }}
                  className={`space-star ${selectedId === entry.id ? 'selected' : ''}`}
                  aria-label={`${entry.organizationName}: ${entry.summary}, ${CONTRIBUTION_LABELS[entry.status]}, ${ageOf(entry, now).label}${entry.simulated ? ', simulated contribution' : ''}`}
                  aria-pressed={selectedId === entry.id}
                  onClick={() => {
                    cancelHover()
                    onCluster(null)
                    onSelect(entry.id)
                    if (selectedId === entry.id) renderer.current?.focusStar(entry.id)
                  }}
                >
                  <span className="space-star-label">
                    {entry.summary}
                    <small>{ageOf(entry, now).label}</small>
                  </span>
                </button>
              )),
            )}
          </div>
        )}
      </div>
      {!ready && !failed && (
        <p className="space-message" role="status">
          Entering your universe…
        </p>
      )}
      {failed && (
        <div className="space-message" role="alert">
          <p>The 3D view could not open. Your contributions are still available.</p>
          <button
            className="secondary-button"
            onClick={() => {
              setReady(false)
              setFailed(false)
              setRevision((value) => value + 1)
            }}
          >
            Retry 3D view
          </button>
          <button className="text-button" onClick={onList}>
            Open list view
          </button>
        </div>
      )}
      {category && !groups.some((group) => group.category === category) && (
        <p className="galaxy-empty">No contributions in this region yet.</p>
      )}
      <div
        className={`cosmos-trackpad ${travelDirection ? `is-${travelDirection}` : ''}`}
        role="group"
        aria-label="Trackpad navigation"
      >
        <span className="trackpad-caption">Two-finger scroll</span>
        <button
          className="trackpad-farther"
          aria-label="Move farther"
          onClick={() => renderer.current?.zoom(1 / 1.3)}
        >
          <ArrowUp size={14} aria-hidden="true" />
          <span>Farther</span>
        </button>
        <button
          className="trackpad-closer"
          aria-label="Move closer"
          onClick={() => renderer.current?.zoom(1.3)}
        >
          <ArrowDown size={14} aria-hidden="true" />
          <span>Closer</span>
        </button>
      </div>
      <div className="cosmos-camera-controls" aria-label="Cosmos controls">
        <button
          className="control-button"
          onClick={home}
          aria-label="Return to starting view"
          title="Return to starting view"
        >
          <Crosshair size={17} />
        </button>
      </div>
      <p className="cosmos-gesture-hint">
        Drag to look around · Shift + scroll to pan · Scroll to travel
      </p>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  )
}
