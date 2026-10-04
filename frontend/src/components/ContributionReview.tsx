import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { aidApi } from '../api'
import { CONTRIBUTION_LABELS } from '../support'
import type { Contribution } from '../types'

export default function ContributionReview({
  organizationId,
  onConfirmed,
}: {
  organizationId: string
  onConfirmed: () => Promise<void>
}) {
  const [rows, setRows] = useState<Contribution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    aidApi
      .organizationContributions(organizationId)
      .then((result) => {
        if (active) setRows(result)
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [organizationId, revision])
  if (loading)
    return (
      <p className="form-help" role="status">
        Loading contributions…
      </p>
    )
  if (error)
    return (
      <div className="form-error" role="alert">
        {error}
        <button
          className="text-button"
          onClick={() => {
            setError('')
            setLoading(true)
            setRevision((value) => value + 1)
          }}
        >
          Retry
        </button>
      </div>
    )
  return (
    <div className="contribution-review">
      <p className="form-help">
        Only confirm support your organization has received. This is the step that updates fulfilled
        quantities.
      </p>
      {!rows.length ? (
        <p className="empty-inline">No contributions to review yet.</p>
      ) : (
        rows.map((contribution) => (
          <ReviewRow
            key={contribution.id}
            contribution={contribution}
            onSave={async (updated) => {
              setRows((previous) =>
                previous.map((entry) => (entry.id === updated.id ? updated : entry)),
              )
              await onConfirmed()
            }}
          />
        ))
      )}
    </div>
  )
}

function ReviewRow({
  contribution,
  onSave,
}: {
  contribution: Contribution
  onSave: (value: Contribution) => Promise<void>
}) {
  const [quantity, setQuantity] = useState(String(contribution.quantity))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return (
    <article className="review-row">
      <h3>{contribution.summary}</h3>
      <p>
        {CONTRIBUTION_LABELS[contribution.status]}
        {contribution.simulated ? ' · simulated' : ''}
      </p>
      {contribution.status === 'organization_confirmed' ? (
        <p className="micro-label">
          <Check size={12} />
          {contribution.confirmedQuantity ?? contribution.quantity} confirmed
        </p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (pending) return
            setPending(true)
            setError('')
            try {
              await onSave(
                await aidApi.updateContributionStatus(contribution.id, {
                  status: 'organization_confirmed',
                  confirmedQuantity: Number(quantity),
                }),
              )
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : 'Unable to confirm this contribution.',
              )
            } finally {
              setPending(false)
            }
          }}
        >
          <label className="field-label">
            Quantity received
            <input
              type="number"
              inputMode="numeric"
              required
              min="1"
              max={contribution.quantity}
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <button className="secondary-button" disabled={pending}>
            {pending
              ? 'Confirming…'
              : contribution.simulated
                ? 'Confirm demo receipt'
                : 'Confirm receipt'}
            <Check size={14} />
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
