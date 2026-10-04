import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Map as MapInstance } from 'maplibre-gl'
import { ageOf, categoryFor, hashId } from '../cosmosModel'
import { globeDiameter, globeOverview } from '../mapConfig'
import type { Contribution, LayerId, Organization } from '../types'
import type { StarOrigin } from '../cosmosEntry'
import '../contribution-orbit.css'

export default function ContributionOrbit({
  map,
  contributions,
  organizations,
  layer,
  onOpen,
}: {
  map: MapInstance
  contributions: Contribution[]
  organizations: Organization[]
  layer: LayerId | null
  onOpen: (id: string, origin: StarOrigin) => void
}) {
  const [frame, setFrame] = useState({ width: 1, height: 1, x: 0, y: 0, zoom: 0 })
  const [hovered, setHovered] = useState<string | null>(null)
  useEffect(() => {
    function update() {
      const canvas = map.getCanvas()
      const center = map.project(map.getCenter())
      setFrame({
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        x: center.x,
        y: center.y,
        zoom: map.getZoom(),
      })
    }
    update()
    map.on('move', update)
    map.on('resize', update)
    return () => {
      map.off('move', update)
      map.off('resize', update)
    }
  }, [map])
  const stars = contributions.filter(
    (entry) => !layer || categoryFor(entry, organizations) === layer,
  )
  const scale = 2 ** (frame.zoom - globeOverview(frame.width, frame.height).zoom)
  const radius = (globeDiameter(frame.width, frame.height) / 2) * scale
  const visible = frame.width > 1 && scale < 1.7
  const placements = stars.map((entry) => {
    const seed = hashId(entry.id)
    const angle = ((seed % 10000) / 10000) * Math.PI * 2
    const altitude = 26 + ((seed >>> 12) % 50)
    const rx = Math.min(radius + altitude, frame.width / 2 - 24)
    const ry = Math.min(radius + altitude, frame.height / 2 - 90)
    return { entry, x: frame.x + Math.cos(angle) * rx, y: frame.y + Math.sin(angle) * ry }
  })
  const active = placements.find(({ entry }) => entry.id === hovered)
  const organization = organizations.find((entry) => entry.id === active?.entry.organizationId)
  const destination = organization ? map.project(organization.coordinates) : null
  return (
    <div
      className="contribution-orbit"
      aria-label="Your contribution stars around Earth"
      hidden={!visible}
    >
      {active && destination && (
        <svg className="contribution-orbit-link" aria-hidden="true">
          <path
            key={active.entry.id}
            pathLength="1"
            d={`M ${active.x} ${active.y} Q ${(active.x + destination.x) / 2} ${Math.min(active.y, destination.y) - 35} ${destination.x} ${destination.y}`}
          />
        </svg>
      )}
      {placements.map(({ entry, x, y }) => (
        <button
          key={entry.id}
          data-contribution-id={entry.id}
          data-side={x < 120 ? 'right' : x > frame.width - 120 ? 'left' : 'center'}
          className={`orbit-contribution-star ${entry.status === 'organization_confirmed' ? 'is-confirmed' : 'is-pending'}`}
          style={
            {
              left: x,
              top: y,
              '--star-color': ageOf(entry).color,
              '--star-delay': `${hashId(entry.id) % 2000}ms`,
              '--star-glow-duration': `${4800 + (hashId(entry.id) % 2400)}ms`,
              '--star-glow-delay': `-${hashId(entry.id) % 7200}ms`,
            } as CSSProperties
          }
          aria-label={`Open ${entry.organizationName}: ${entry.summary} in My Cosmos`}
          onPointerEnter={() => {
            setHovered(entry.id)
            void import('../spaceRenderer').catch(() => {})
          }}
          onPointerLeave={() => setHovered(null)}
          onFocus={() => {
            setHovered(entry.id)
            void import('../spaceRenderer').catch(() => {})
          }}
          onBlur={() => setHovered(null)}
          onClick={(event) => {
            setHovered(entry.id)
            const bounds = event.currentTarget.getBoundingClientRect()
            onOpen(entry.id, {
              x: bounds.left + bounds.width / 2,
              y: bounds.top + bounds.height / 2,
              color: ageOf(entry).color,
            })
          }}
        >
          <i aria-hidden="true" />
          <span className="orbit-star-label">
            {entry.organizationName}
            <small>View in My Cosmos ↗</small>
          </span>
        </button>
      ))}
    </div>
  )
}
