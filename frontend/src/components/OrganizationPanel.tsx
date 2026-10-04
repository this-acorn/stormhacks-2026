import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, MapPin, Pencil, Satellite, ShieldCheck, X } from 'lucide-react'
import { aidApi, DEMO_MODE } from '../api'
import { formatDate } from '../mapConfig'
import type {
  AidRequest,
  CheckInResponse,
  Contribution,
  ContributionKind,
  Observation,
  Organization,
  RequestDraft,
  Session,
} from '../types'
import Modal from './Modal'
import ContributionReview from './ContributionReview'
import RequestComposer from './RequestComposer'
import { safeSupportLink } from '../support'

export default function OrganizationPanel({
  organization,
  observations,
  supportObservationId,
  session,
  onClose,
  onObservation,
  onCheckIn,
  onRequest,
  onRequestDraft,
  onRequestPublished,
  onContribute,
  onRefresh,
}: {
  organization: Organization
  observations: Observation[]
  supportObservationId?: string
  session: Session
  onClose: () => void
  onObservation: (id: string) => void
  onCheckIn: (observation: Observation) => void
  onRequest: (request?: AidRequest) => void
  onRequestDraft: (draft: RequestDraft) => void
  onRequestPublished: (request: AidRequest, otherNeeds: string[]) => void
  onContribute: (contribution: Contribution) => void
  onRefresh: () => Promise<void>
}) {
  const [tab, setTab] = useState<ContributionKind>('supplies')
  const [contributing, setContributing] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [answering, setAnswering] = useState(false)
  const [answerError, setAnswerError] = useState('')
  const [leaving, setLeaving] = useState<string[]>([])
  const [requestId, setRequestId] = useState(
    organization.requests.find((request) => request.status === 'published')?.id ?? '',
  )
  const heading = useRef<HTMLHeadingElement>(null)
  const ownsOrganization = session.role === 'staff' && session.organizationId === organization.id
  const requests = organization.requests.filter((request) => request.status === 'published')
  const availableRequests = requests.filter((request) => request.quantity > request.fulfilled)
  const chosenRequest =
    availableRequests.find((request) => request.id === requestId) ?? availableRequests[0]
  const supportLink = safeSupportLink(chosenRequest?.links?.[tab] || organization.links?.[tab])
  const website = safeSupportLink(organization.links?.website)
  const tabs: { id: ContributionKind; label: string }[] = [
    { id: 'donate', label: 'Donate' },
    { id: 'supplies', label: 'Supplies' },
    { id: 'volunteer', label: 'Volunteer' },
  ]

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [organization.id])

  async function answer(observation: Observation, response: CheckInResponse) {
    if (answering) return
    setAnswering(true)
    setAnswerError('')
    try {
      const updated = await aidApi.checkIn(observation.id, response)
      // The card folds away first, then the answered check-in leaves the list.
      setLeaving((ids) => [...ids, observation.id])
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      window.setTimeout(() => onCheckIn(updated), still ? 0 : 320)
    } catch (failure) {
      setAnswerError(failure instanceof Error ? failure.message : 'Unable to send your response.')
    } finally {
      setAnswering(false)
    }
  }

  return (
    <aside className="detail-panel" aria-labelledby="organization-title">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="panel-topline">
        <span className="eyebrow">ON THE GROUND</span>
        <button className="icon-button" onClick={onClose} aria-label="Close organization">
          <X size={19} />
        </button>
      </div>
      <div className="panel-heading">
        {organization.sample && <span className="sample-tag">Sample organization</span>}
        <h1 id="organization-title" ref={heading} tabIndex={-1}>
          {organization.name}
        </h1>
        <p className="organization-type">{organization.type}</p>
        <p className="location">
          <MapPin size={13} />
          {organization.location}
        </p>
        {website && (
          <a
            className="text-button organization-website"
            href={website}
            target="_blank"
            rel="noopener noreferrer"
          >
            Official website
            <ArrowUpRight size={12} />
          </a>
        )}
      </div>
      <section className="situation-section" aria-labelledby="situation-title">
        <div className="section-label">
          <h2 id="situation-title">Current situation</h2>
          <span className="confirmed-icon" title="Reported by the organization">
            <ShieldCheck size={15} />
          </span>
        </div>
        <p>{organization.situation}</p>
        <span className="timestamp">Updated {formatDate(organization.updatedAt)}</span>
      </section>
      {observations
        .filter((observation) => !ownsOrganization || !observation.response)
        .map((observation) => (
          <section
            className={`situation-section satellite-section${leaving.includes(observation.id) ? ' leaving' : ''}`}
            aria-labelledby={`satellite-${observation.id}`}
            key={observation.id}
          >
            <div className="section-label">
              <h2 id={`satellite-${observation.id}`}>Satellite nearby</h2>
              <span className="confirmed-icon" title="Satellite observation, not a confirmed need">
                <Satellite size={15} />
              </span>
            </div>
            <p>
              {ownsOrganization && observation.question
                ? observation.question
                : observation.summary}
            </p>
            <span className="timestamp">
              {observation.playback
                ? 'Historical replay · '
                : observation.simulated
                  ? 'Simulated · '
                  : ''}
              {observation.detectionCount.toLocaleString()} heat{' '}
              {observation.detectionCount === 1 ? 'detection' : 'detections'} · nearest{' '}
              {observation.proximityKm} km · {formatDate(observation.observedAt)}
            </span>
            {ownsOrganization ? (
              <div className="checkin-actions">
                <div className="form-row">
                  <button
                    className="secondary-button"
                    disabled={answering || leaving.includes(observation.id)}
                    onClick={() => answer(observation, 'not_affected')}
                  >
                    Not affected
                  </button>
                  <button
                    className="secondary-button"
                    disabled={answering || leaving.includes(observation.id)}
                    onClick={() => answer(observation, 'checking')}
                  >
                    Checking
                  </button>
                </div>
                <button
                  className="primary-button"
                  disabled={answering || leaving.includes(observation.id)}
                  onClick={() => answer(observation, 'support_needed')}
                >
                  Support needed
                  <ArrowUpRight size={17} />
                </button>
                {answerError && (
                  <div role="status" className="form-error">
                    <p>{answerError}</p>
                  </div>
                )}
              </div>
            ) : (
              <button className="secondary-button" onClick={() => onObservation(observation.id)}>
                View check-in
                <ArrowUpRight size={15} />
              </button>
            )}
          </section>
        ))}
      <section className="needs-section" aria-labelledby="needs-title">
        <div className="section-label">
          <h2 id="needs-title">What’s needed</h2>
        </div>
        {ownsOrganization && (
          <RequestComposer
            organization={organization}
            observationId={supportObservationId}
            onPublished={onRequestPublished}
            onIncomplete={onRequestDraft}
            onManual={() => onRequest()}
          />
        )}
        <p className="micro-label">
          <Check size={12} /> Organization-confirmed{organization.sample ? ' · sample needs' : ''}
        </p>
        {requests.length === 0 ? (
          <div className="empty-inline">No published requests right now.</div>
        ) : (
          requests.map((request) => {
            const remaining = Math.max(0, request.quantity - request.fulfilled)
            return (
              <article className="need-row" key={request.id}>
                <div className="need-title">
                  <h3>{request.item}</h3>
                  {remaining > 0 && (
                    <span className={request.urgency === 'urgent' ? 'urgent-tag' : 'standard-tag'}>
                      {request.urgency === 'urgent' ? 'Urgent' : 'Standard'}
                    </span>
                  )}
                </div>
                <p>
                  <strong>{remaining.toLocaleString()}</strong> {request.unit} still needed{' '}
                  <span>of {request.quantity.toLocaleString()}</span>
                </p>
                {remaining > 0 && request.urgency === 'urgent' && (
                  <p className="urgency-source">
                    Marked urgent by the organization · {formatDate(request.confirmedAt)}
                  </p>
                )}
                <div
                  className="need-progress"
                  role="progressbar"
                  aria-label={`${request.item} received`}
                  aria-valuemin={0}
                  aria-valuemax={request.quantity}
                  aria-valuenow={request.fulfilled}
                >
                  <span
                    style={{
                      width: `${Math.min(100, (request.fulfilled / request.quantity) * 100)}%`,
                    }}
                  />
                </div>
                {ownsOrganization && (
                  <button className="text-button edit-request" onClick={() => onRequest(request)}>
                    <Pencil size={12} /> Edit
                  </button>
                )}
              </article>
            )
          })
        )}
      </section>
      {/* Organization accounts post and confirm needs; contributing is for supporters. */}
      {session.role !== 'staff' && (
        <section className="support-section" aria-label="Ways to help">
          <div className="support-tabs" role="tablist" aria-label="Contribution type">
            {tabs.map(({ id, label }, index) => (
              <button
                id={`tab-${id}`}
                key={id}
                role="tab"
                aria-selected={tab === id}
                aria-controls="support-content"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(event) => {
                  let next = index
                  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
                  else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
                  else if (event.key === 'Home') next = 0
                  else if (event.key === 'End') next = tabs.length - 1
                  else return
                  event.preventDefault()
                  setTab(tabs[next].id)
                  document.getElementById(`tab-${tabs[next].id}`)?.focus()
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div id="support-content" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'supplies' && (
              <>
                {availableRequests.length > 1 && (
                  <label className="field-label">
                    Choose a request
                    <select
                      value={chosenRequest?.id}
                      onChange={(event) => setRequestId(event.target.value)}
                    >
                      {availableRequests.map((request) => (
                        <option value={request.id} key={request.id}>
                          {request.item}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="support-description">
                  {chosenRequest
                    ? 'Choose how many items you can provide.'
                    : 'All current supply requests have been fulfilled.'}
                </p>
              </>
            )}
            {tab === 'donate' && (
              <p className="support-description">
                Record the amount you intend to give. Payments are arranged with the organization.
              </p>
            )}
            {tab === 'volunteer' && (
              <p className="support-description">
                {organization.volunteerRole}. {organization.volunteerSlots} places available. The
                team will confirm the time and location.
              </p>
            )}
            <button
              className="primary-button"
              disabled={
                (tab === 'supplies' && !chosenRequest) ||
                (tab === 'volunteer' && organization.volunteerSlots < 1)
              }
              onClick={() => setContributing(true)}
            >
              {tab === 'supplies'
                ? 'Pledge supplies'
                : tab === 'donate'
                  ? 'Make a contribution'
                  : 'Offer your time'}
              <ArrowUpRight size={18} />
            </button>
            {supportLink && (
              <a
                className="official-support-link"
                href={supportLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open organization’s {tab === 'donate' ? 'donation' : tab} page
                <ArrowUpRight size={13} />
              </a>
            )}
            <p className="demo-note">
              {session.demo ? 'Demo account. ' : ''}Records intent only. No payment or delivery is
              made.
            </p>
          </div>
        </section>
      )}
      {ownsOrganization && (
        <details
          className="staff-review"
          onToggle={(event) => setReviewOpen(event.currentTarget.open)}
        >
          <summary>Review contributions</summary>
          {reviewOpen && (
            <ContributionReview organizationId={organization.id} onConfirmed={onRefresh} />
          )}
        </details>
      )}
      {organization.description && (
        <details className="organization-about">
          <summary>About this organization</summary>
          <p>{organization.description}</p>
        </details>
      )}
      {contributing && (
        <ContributionForm
          kind={tab}
          organization={organization}
          request={chosenRequest}
          onClose={() => setContributing(false)}
          onSuccess={(contribution) => {
            setContributing(false)
            onContribute(contribution)
          }}
        />
      )}
    </aside>
  )
}

function ContributionForm({
  kind,
  organization,
  request,
  onClose,
  onSuccess,
}: {
  kind: ContributionKind
  organization: Organization
  request?: AidRequest
  onClose: () => void
  onSuccess: (contribution: Contribution) => void
}) {
  const [quantity, setQuantity] = useState(
    kind === 'donate' ? '25' : kind === 'volunteer' ? '2' : '1',
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const label =
    kind === 'donate'
      ? 'Amount (USD)'
      : kind === 'volunteer'
        ? 'Hours you can offer'
        : `Quantity (${request?.unit ?? 'items'})`
  const maximum =
    kind === 'supplies' && request
      ? request.quantity - request.fulfilled
      : kind === 'volunteer'
        ? 100
        : 100_000
  return (
    <Modal
      title={
        kind === 'supplies'
          ? 'Pledge supplies'
          : kind === 'volunteer'
            ? 'Volunteer availability'
            : 'Pledge a donation'
      }
      eyebrow="CONTRIBUTION PLEDGE"
      onClose={() => {
        if (!pending) onClose()
      }}
    >
      <p className="modal-description">
        For <strong>{organization.name}</strong>
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (pending) return
          setPending(true)
          setError('')
          try {
            onSuccess(
              await aidApi.contribute({
                organizationId: organization.id,
                kind,
                quantity: Number(quantity),
                ...(DEMO_MODE ? { impactCategory: request?.impactCategory } : {}),
                ...(kind === 'supplies' ? { requestId: request?.id } : {}),
              }),
            )
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : 'Something went wrong. Please try again.',
            )
          } finally {
            setPending(false)
          }
        }}
      >
        {kind === 'supplies' && (
          <p className="form-context">
            {request?.item}
            <span>{request?.description}</span>
          </p>
        )}
        {kind === 'donate' && (
          <div className="amount-options">
            {[10, 25, 50, 100].map((amount) => (
              <button
                type="button"
                className={quantity === String(amount) ? 'active' : ''}
                aria-pressed={quantity === String(amount)}
                key={amount}
                onClick={() => setQuantity(String(amount))}
              >
                ${amount}
              </button>
            ))}
          </div>
        )}
        <label className="field-label">
          {label}
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max={maximum}
            step="1"
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            autoFocus
          />
        </label>
        <p className="form-help">
          {DEMO_MODE
            ? 'This is a demo. Your contribution will appear as a pending star in My Cosmos. No money is charged and no organization is contacted.'
            : 'This records your pledge. The organization will confirm next steps. No payment is collected here.'}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? 'Saving…' : DEMO_MODE ? 'Save demo contribution' : 'Submit pledge'}
          <ArrowUpRight size={17} />
        </button>
      </form>
    </Modal>
  )
}
