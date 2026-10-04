import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Clock3, MapPin, Satellite, X } from 'lucide-react'
import { aidApi } from '../api'
import { formatDate } from '../mapConfig'
import type { CheckInResponse, Observation, Organization, Session } from '../types'

export default function ObservationPanel({
  observation,
  organization,
  session,
  onClose,
  onResponse,
  onSupport,
}: {
  observation: Observation
  organization: Organization
  session: Session
  onClose: () => void
  onResponse: (observation: Observation) => void
  onSupport: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [observation.id])
  const ownsOrganization = session.role === 'staff' && session.organizationId === organization.id

  async function respond(response: CheckInResponse) {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const updated = await aidApi.checkIn(observation.id, response)
      onResponse(updated)
      if (response === 'support_needed') onSupport()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to send your response.')
    } finally {
      setPending(false)
    }
  }

  return (
    <aside className="detail-panel observation-panel" aria-labelledby="observation-title">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="panel-topline">
        <span className="eyebrow">SATELLITE CHECK-IN</span>
        <button className="icon-button" onClick={onClose} aria-label="Close observation">
          <X size={19} />
        </button>
      </div>
      <div className="observation-symbol">
        <Satellite size={28} strokeWidth={1.25} />
      </div>
      {observation.simulated && <span className="sample-tag">Simulated observation</span>}
      {observation.playback && (
        <span className="sample-tag">
          Historical replay · {new Date(observation.observedAt).getUTCFullYear()}
        </span>
      )}
      <h1 id="observation-title" ref={heading} tabIndex={-1}>
        A view from above.
        <br />A check-in on the ground.
      </h1>
      <p className="checkin-question">
        {ownsOrganization && observation.question
          ? observation.question
          : `New satellite observations near ${ownsOrganization ? 'your organization' : organization.name}. Are you affected?`}
      </p>
      <div className="observation-facts">
        <p>
          <Satellite size={15} />
          <span>{observation.source}</span>
        </p>
        <p>
          <Clock3 size={15} />
          <span>{formatDate(observation.observedAt, true)}</span>
        </p>
        <p>
          <MapPin size={15} />
          <span>
            {observation.proximityKm} km from {organization.name}
          </span>
        </p>
        <p>
          <Satellite size={15} />
          <span>
            {observation.detectionCount} nearby satellite{' '}
            {observation.detectionCount === 1 ? 'detection' : 'detections'} · points of detected
            heat, not damage boundaries
          </span>
        </p>
      </div>
      <div className="observation-explanation">
        <h2>{observation.title}</h2>
        <p>{observation.summary}</p>
        <span className="micro-label">Observation information · needs not yet confirmed</span>
      </div>
      {observation.response && (
        <p className="response-status" role="status">
          <Check size={14} />
          {observation.response === 'not_affected'
            ? 'Your organization reported: not affected.'
            : observation.response === 'checking'
              ? 'Your organization is checking local conditions.'
              : 'Support needed reported. Supplies still require a confirmed request.'}
        </p>
      )}
      {observation.respondedAt && (
        <p className="timestamp">Responded {formatDate(observation.respondedAt, true)}</p>
      )}
      {ownsOrganization ? (
        <div className="checkin-actions">
          <div className="form-row">
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => respond('not_affected')}
            >
              Not affected
            </button>
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => respond('checking')}
            >
              Checking
            </button>
          </div>
          <button
            className="primary-button"
            disabled={pending}
            onClick={() => respond('support_needed')}
          >
            {pending ? 'Saving response…' : 'Support needed'}
            <ArrowUpRight size={17} />
          </button>
          <p className="demo-note">You’ll review a draft before publishing any request.</p>
        </div>
      ) : (
        <p className="form-help">
          Only this organization’s staff can confirm local impact.{' '}
          {session.demo
            ? 'Choose the organization staff demo account in your profile to try a check-in.'
            : ''}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </aside>
  )
}
