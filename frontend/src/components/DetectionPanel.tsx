import { useEffect, useRef } from 'react'
import { ArrowUpRight, Clock3, MapPin, Satellite, X } from 'lucide-react'
import { formatDate } from '../mapConfig'
import type { FireDetection, Organization } from '../types'

function distanceKm(a: number[], b: number[]) {
  const radians = Math.PI / 180
  const latitude = (b[1] - a[1]) * radians
  const longitude = (b[0] - a[0]) * radians
  const h =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(longitude / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}

export default function DetectionPanel({
  detection,
  organizations,
  onClose,
  onSelectOrganization,
}: {
  detection: FireDetection
  organizations: Organization[]
  onClose: () => void
  onSelectOrganization: (id: string) => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [detection.properties.id])
  const details = detection.properties
  const nearby = organizations
    .map((organization) => ({
      organization,
      distance: distanceKm(detection.geometry.coordinates, organization.coordinates),
    }))
    .filter((entry) => entry.distance <= 50)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
  return (
    <aside className="detail-panel observation-panel" aria-labelledby="detection-title">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="panel-topline">
        <span className="eyebrow">SATELLITE OBSERVATION</span>
        <button className="icon-button" onClick={onClose} aria-label="Close detection">
          <X size={19} />
        </button>
      </div>
      <div className="observation-symbol">
        <Satellite size={27} strokeWidth={1.25} />
      </div>
      {details.playback && (
        <span className="sample-tag">
          Historical replay · {new Date(details.acquiredAt).getUTCFullYear()}
        </span>
      )}
      <h1 id="detection-title" ref={heading} tabIndex={-1}>
        A point of detected heat.
      </h1>
      <p className="checkin-question">
        A satellite detected heat at this location. This point is not a damage boundary or an
        organization-confirmed need.
      </p>
      <div className="observation-facts">
        <p>
          <Satellite size={15} />
          <span>
            {details.source} · {details.instrument} · {details.satellite}
          </span>
        </p>
        <p>
          <Clock3 size={15} />
          <span>{formatDate(details.acquiredAt, true)}</span>
        </p>
        <p>
          <MapPin size={15} />
          <span>
            {detection.geometry.coordinates[1].toFixed(4)}°,{' '}
            {detection.geometry.coordinates[0].toFixed(4)}°
          </span>
        </p>
      </div>
      <p className="form-help">
        Detection confidence: {details.confidence}. Satellite observation information is separate
        from requests confirmed by local organizations.
      </p>
      <section>
        <div className="section-label">
          <h2>Organizations within 50 km</h2>
        </div>
        {nearby.length ? (
          nearby.map(({ organization, distance }) => (
            <button
              className="nearby-organization"
              key={organization.id}
              onClick={() => onSelectOrganization(organization.id)}
            >
              <span>
                <strong>{organization.name}</strong>
                <small>
                  {distance.toFixed(1)} km away{organization.sample ? ' · sample organization' : ''}
                </small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))
        ) : (
          <p className="empty-inline">No listed organizations within 50 km.</p>
        )}
      </section>
    </aside>
  )
}
