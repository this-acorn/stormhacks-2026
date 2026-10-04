import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Sparkles } from 'lucide-react'
import { aidApi, ApiError, DEMO_MODE } from '../api'
import { DEMO_CATEGORIES } from '../cosmosModel'
import type { AidRequest, Organization, RequestDraft } from '../types'

// Staff describe a need in their own words and Gemini writes the request. A complete request is
// published at once, since the staff wrote it; if a detail is missing, the form opens filled in.
// After staff answer a satellite check-in with "Support needed", the box takes focus and the
// request it publishes is linked to that check-in.
export default function RequestComposer({
  organization,
  observationId,
  onPublished,
  onIncomplete,
  onManual,
}: {
  organization: Organization
  observationId?: string
  onPublished: (request: AidRequest, otherNeeds: string[]) => void
  onIncomplete: (draft: RequestDraft) => void
  onManual: () => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'writing' | 'publishing'>('idle')
  const [failure, setFailure] = useState('')
  const [geminiDown, setGeminiDown] = useState(false)

  useEffect(() => {
    if (!observationId) return
    field.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    field.current?.focus({ preventScroll: true })
  }, [observationId])

  async function write(event: FormEvent) {
    event.preventDefault()
    if (status !== 'idle') return
    setFailure('')
    setGeminiDown(false)
    setStatus('writing')
    const draft = await aidApi.draftRequest(organization.id, text.trim()).catch((error) => {
      setFailure(
        error instanceof ApiError && error.status === 503
          ? error.message
          : 'Gemini is unavailable right now.',
      )
      setGeminiDown(true)
      return null
    })
    if (!draft) {
      setStatus('idle')
      return
    }
    const { title, item, quantity, unit, description } = draft
    if (draft.missing.length || !title || !item || !quantity || !unit || !description) {
      setStatus('idle')
      onIncomplete(draft)
      return
    }
    setStatus('publishing')
    try {
      const saved = await aidApi.publishRequest(organization.id, {
        title,
        item,
        quantity,
        unit,
        description,
        urgency: draft.urgency,
        ...(DEMO_MODE ? { impactCategory: DEMO_CATEGORIES[organization.id] ?? 'community' } : {}),
        ...(observationId ? { observationId } : {}),
        confirmed: true,
      })
      setText('')
      setStatus('idle')
      onPublished(saved, draft.otherNeeds)
    } catch (error) {
      setStatus('idle')
      setFailure(error instanceof Error ? error.message : 'Unable to publish. Please try again.')
    }
  }

  return (
    <form className="request-composer" onSubmit={write}>
      <label className="field-label">
        Describe what you need
        <textarea
          ref={field}
          required
          maxLength={1000}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. Wildfire smoke is close. We urgently need 200 N95 masks."
        />
      </label>
      <button
        type="submit"
        className="secondary-button"
        disabled={status !== 'idle' || text.trim().length < 3}
      >
        <Sparkles size={15} />
        {status === 'writing'
          ? 'Gemini is writing your request…'
          : status === 'publishing'
            ? 'Publishing…'
            : 'Write and publish with Gemini'}
      </button>
      <p className="form-help">
        Publishing confirms that your organization needs this. If a detail is missing, the form
        opens for you to finish.
      </p>
      {failure && (
        <div role="status" className="form-error">
          <p>{failure}</p>
          {geminiDown && (
            <button type="button" className="text-button" onClick={onManual}>
              Fill in the form yourself
            </button>
          )}
        </div>
      )}
    </form>
  )
}
