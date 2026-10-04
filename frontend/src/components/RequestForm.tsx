import { useState } from 'react'
import { ArrowUpRight, FilePenLine, Sparkles } from 'lucide-react'
import { aidApi, DEMO_MODE } from '../api'
import type {
  AidRequest,
  ImpactCategory,
  Observation,
  Organization,
  RequestDraft,
  RequestDraftField,
} from '../types'
import { DEMO_CATEGORIES, GALAXIES } from '../cosmosModel'
import { safeSupportLink } from '../support'
import Modal from './Modal'

const FIELD_NAMES: Record<RequestDraftField, string> = {
  title: 'request title',
  item: 'needed item',
  quantity: 'total quantity',
  unit: 'unit',
  description: 'current need',
}

export default function RequestForm({
  organization,
  observation,
  existing,
  draft,
  onClose,
  onSave,
}: {
  organization: Organization
  observation?: Observation
  existing?: AidRequest
  // What Gemini wrote from the staff's words when a detail was missing.
  draft?: RequestDraft
  onClose: () => void
  onSave: (request: AidRequest, otherNeeds?: string[]) => void
}) {
  const suggestions = observation?.suggestedItems ?? []
  const suggestion = suggestions[0]
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [title, setTitle] = useState(
    existing?.title ?? draft?.title ?? (suggestion ? `${suggestion.item} for local families` : ''),
  )
  const [item, setItem] = useState(existing?.item ?? draft?.item ?? suggestion?.item ?? '')
  const [quantity, setQuantity] = useState(
    String(existing?.quantity ?? draft?.quantity ?? suggestion?.quantity ?? ''),
  )
  const [unit, setUnit] = useState(existing?.unit ?? draft?.unit ?? suggestion?.unit ?? 'items')
  const [description, setDescription] = useState(existing?.description ?? draft?.description ?? '')
  const [urgency, setUrgency] = useState<'urgent' | 'standard'>(
    existing?.urgency ?? draft?.urgency ?? 'standard',
  )
  const [impactCategory, setImpactCategory] = useState<ImpactCategory>(
    existing?.impactCategory ?? DEMO_CATEGORIES[organization.id] ?? 'community',
  )
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [links, setLinks] = useState(existing?.links ?? {})
  // Details Gemini could not fill stay highlighted until the staff fill them in.
  const values: Record<RequestDraftField, string> = { title, item, quantity, unit, description }
  const missing = (draft?.missing ?? []).filter((field) => !values[field].trim())
  const fieldProps = (field: RequestDraftField) => ({
    autoFocus: field === (missing[0] ?? 'title'),
    ...(missing.includes(field) ? { 'aria-invalid': true as const, className: 'is-missing' } : {}),
  })

  return (
    <Modal
      title={existing ? 'Edit request' : 'Create a request'}
      eyebrow="ORGANIZATION WORKSPACE"
      onClose={() => {
        if (!pending) onClose()
      }}
    >
      <p className="modal-description">
        {organization.name}
        {organization.sample && ' · demo staff account'}
      </p>
      {draft && (
        <div className="draft-notice">
          <Sparkles size={18} />
          <div>
            <strong>Written by Gemini from your description · unpublished</strong>
            <p>
              {missing.length
                ? `Add the ${new Intl.ListFormat('en').format(missing.map((field) => FIELD_NAMES[field]))} below, then confirm and publish.`
                : 'Check the details, then confirm and publish.'}
            </p>
          </div>
        </div>
      )}
      {observation && (
        <div className="draft-notice">
          <FilePenLine size={18} />
          <div>
            <strong>
              {observation.draftSource === 'gemini'
                ? 'AI-suggested supplies'
                : 'Suggested supplies'}{' '}
              · unpublished draft
            </strong>
            <p>
              Review these suggestions and confirm what your community actually needs. An
              observation does not confirm impact.
            </p>
          </div>
        </div>
      )}
      {suggestions.length > 1 && (
        <label className="field-label">
          Suggested item to review
          <select
            value={suggestionIndex}
            onChange={(event) => {
              const index = Number(event.target.value)
              const selected = suggestions[index]
              setSuggestionIndex(index)
              setTitle(`${selected.item} for local families`)
              setItem(selected.item)
              setQuantity(String(selected.quantity))
              setUnit(selected.unit)
              setConfirmed(false)
            }}
          >
            {suggestions.map((entry, index) => (
              <option key={`${entry.item}-${index}`} value={index}>
                {entry.item} · {entry.quantity} {entry.unit}
              </option>
            ))}
          </select>
          <span className="form-help">Review and publish one item per request.</span>
        </label>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (pending) return
          setError('')
          if (Object.values(links).some((url) => url && !safeSupportLink(url))) {
            setError('Support links must be valid http or https website addresses.')
            return
          }
          setPending(true)
          try {
            const saved = await aidApi.publishRequest(
              organization.id,
              {
                title: title.trim(),
                item: item.trim(),
                quantity: Number(quantity),
                unit: unit.trim(),
                description: description.trim(),
                urgency,
                ...(DEMO_MODE ? { impactCategory } : {}),
                confirmed,
                links: Object.fromEntries(Object.entries(links).filter(([, url]) => url)),
                observationId: observation?.id ?? existing?.observationId,
              },
              existing?.id,
            )
            onSave(saved, draft?.otherNeeds)
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : 'Unable to save. Please try again.',
            )
          } finally {
            setPending(false)
          }
        }}
      >
        <label className="field-label">
          Request title
          <input
            required
            maxLength={100}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Essentials for displaced families"
            {...fieldProps('title')}
          />
        </label>
        <label className="field-label">
          Needed item
          <input
            required
            maxLength={80}
            value={item}
            onChange={(event) => setItem(event.target.value)}
            placeholder="Emergency supply kits"
            {...fieldProps('item')}
          />
        </label>
        <div className="form-row">
          <label className="field-label">
            Total quantity
            <input
              required
              type="number"
              inputMode="numeric"
              min={Math.max(1, existing?.fulfilled ?? 0)}
              max="100000"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              {...fieldProps('quantity')}
            />
          </label>
          <label className="field-label">
            Unit
            <input
              required
              maxLength={24}
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="kits"
              {...fieldProps('unit')}
            />
          </label>
        </div>
        <label className="field-label">
          Current need
          <textarea
            required
            maxLength={700}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is needed, who it will support, and any collection details."
            {...fieldProps('description')}
          />
        </label>
        <label className="field-label">
          Urgency
          <select
            value={urgency}
            onChange={(event) => setUrgency(event.target.value as 'urgent' | 'standard')}
          >
            <option value="standard">Standard</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        {DEMO_MODE && (
          <label className="field-label">
            Support area
            <select
              value={impactCategory}
              onChange={(event) => setImpactCategory(event.target.value as ImpactCategory)}
            >
              {(impactCategory === 'community' || impactCategory === 'disaster') && (
                <option value={impactCategory}>Other contributions · preserved category</option>
              )}
              {GALAXIES.filter((entry) => entry.id !== 'unclassified').map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <span className="form-help">Contributions to this request appear in this galaxy.</span>
          </label>
        )}
        <details className="optional-fields">
          <summary>
            Official support links <span>Optional</span>
          </summary>
          <p className="form-help">Leave blank to use your organization’s links.</p>
          {(['website', 'donate', 'supplies', 'volunteer'] as const).map((kind) => (
            <label key={kind} className="field-label">
              {kind === 'website' ? 'Website' : `${kind[0].toUpperCase()}${kind.slice(1)} link`}
              <input
                type="url"
                placeholder="https://"
                value={links[kind] ?? ''}
                onChange={(event) =>
                  setLinks((current) => ({ ...current, [kind]: event.target.value }))
                }
              />
            </label>
          ))}
        </details>
        <label className="confirmation-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I confirm that our organization needs these supplies and that the quantities are
            correct.
          </span>
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={pending || !confirmed}>
          {pending
            ? 'Publishing…'
            : existing
              ? 'Confirm and save changes'
              : 'Confirm and publish request'}
          <ArrowUpRight size={17} />
        </button>
        <p className="demo-note">
          {organization.sample
            ? 'Publishes to the local demo only.'
            : 'This request will be visible to supporters.'}
        </p>
      </form>
    </Modal>
  )
}
