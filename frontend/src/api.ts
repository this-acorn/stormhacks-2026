import { demoData } from './mockData'
import type { FireData } from './layers/data'
import type { EducationData } from './educationData'
import type { SmokeForecast } from './smokeForecast'
import { DEMO_CATEGORIES } from './cosmosModel'
import {
  DEMO_SUPPORTER_ACCOUNT,
  LEGACY_CONSTELLATION_ACCOUNT,
  createConstellationDemo,
  mergeExampleCollection,
} from './constellationDemo'
import { clearCollections, readCollection, saveCollection } from './constellationCollection'
import type {
  AidRequest,
  BootstrapData,
  CheckInResponse,
  Contribution,
  ContributionInput,
  ContributionStatusInput,
  FireDetections,
  Observation,
  Organization,
  ReplaySummary,
  RequestDraft,
  RequestInput,
  SearchResults,
  Session,
} from './types'

// This module is the only application API boundary. MapLibre loads imagery tiles separately.
// All VITE_ variables are public. Backend secrets never belong in this application.
export const DEMO_MODE = import.meta.env.VITE_API_MODE !== 'live'
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const STORAGE_KEY = 'aidatlas-demo-v1'

export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string>
  constructor(
    message: string,
    status = 500,
    code = 'request_failed',
    fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new ApiError(
        typeof body?.detail === 'string'
          ? body.detail
          : `Unable to complete this request (${response.status}). Please try again.`,
        response.status,
        typeof body?.code === 'string' ? body.code : 'request_failed',
        body?.fields,
      )
    }
    if (response.status === 204) return undefined as T
    try {
      return (await response.json()) as T
    } catch {
      throw new ApiError(
        'The server returned an unreadable response. Please try again.',
        502,
        'invalid_response',
      )
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      error instanceof Error && error.name === 'AbortError'
        ? 'The request timed out. Please try again.'
        : 'Unable to connect. Check your connection and try again.',
      0,
      'connection_error',
    )
  } finally {
    clearTimeout(timeout)
  }
}

// Explore always uses current satellite observations, including while organization demos are on.
export const fetchLatestFires = (signal?: AbortSignal): Promise<FireData> =>
  request('/v1/hazards/wildfire', { signal, cache: 'no-store' })

export const fetchLatestEducation = async (signal?: AbortSignal): Promise<EducationData> => {
  const data = await request<EducationData>('/v1/hazards/education', { signal, cache: 'no-store' })
  if (data.schemaVersion !== 1 || !data.countries?.length || !data.years?.length || !data.release)
    throw new Error('Education data is invalid.')
  return data
}

export const fetchSmokeForecast = (signal?: AbortSignal): Promise<SmokeForecast> =>
  request('/v1/hazards/smoke', { signal, cache: 'no-store' })

interface MockState extends BootstrapData {
  contributionOwners: Record<string, string>
  constellationExamplesIntegrated?: boolean
  constellationConfirmationsUpdated?: boolean
}
function updateDemoConfirmationMix(data: MockState): MockState {
  if (!DEMO_MODE || data.constellationConfirmationsUpdated) return data
  const examples = createConstellationDemo(data.organizations)
  const confirmedIds = new Set(
    examples.contributions
      .filter((entry) => entry.status === 'organization_confirmed')
      .map((entry) => entry.id),
  )
  for (const contribution of data.contributions) {
    if (
      confirmedIds.has(contribution.id) &&
      data.contributionOwners[contribution.id] === DEMO_SUPPORTER_ACCOUNT &&
      contribution.simulated &&
      contribution.status === 'pledged' &&
      !contribution.requestId
    ) {
      contribution.status = 'organization_confirmed'
      contribution.confirmedQuantity = contribution.quantity
      contribution.confirmedAt = contribution.createdAt
    }
  }
  data.constellationConfirmationsUpdated = true
  return data
}
function integrateConstellations(data: MockState): MockState {
  if (!DEMO_MODE || data.constellationExamplesIntegrated) return updateDemoConfirmationMix(data)
  const examples = createConstellationDemo(data.organizations)
  const existing = new Set(data.contributions.map((entry) => entry.id))
  for (const contribution of examples.contributions) {
    if (!existing.has(contribution.id)) data.contributions.push(contribution)
    data.contributionOwners[contribution.id] = DEMO_SUPPORTER_ACCOUNT
  }
  for (const [id, owner] of Object.entries(data.contributionOwners))
    if (owner === LEGACY_CONSTELLATION_ACCOUNT) data.contributionOwners[id] = DEMO_SUPPORTER_ACCOUNT
  if (data.session.id === LEGACY_CONSTELLATION_ACCOUNT)
    data.session = structuredClone(demoData.session)
  saveCollection(
    DEMO_SUPPORTER_ACCOUNT,
    mergeExampleCollection(
      readCollection(DEMO_SUPPORTER_ACCOUNT),
      examples.collection,
      readCollection(LEGACY_CONSTELLATION_ACCOUNT),
    ),
  )
  data.constellationExamplesIntegrated = true
  return updateDemoConfirmationMix(data)
}
function freshDemo(): MockState {
  return integrateConstellations({
    ...structuredClone(demoData),
    contributionOwners: Object.fromEntries(
      demoData.contributions.map((entry) => [entry.id, 'demo-supporter']),
    ),
  })
}

function loadDemo(): MockState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const data = JSON.parse(saved)
      if (
        Array.isArray(data.organizations) &&
        data.organizations.length &&
        Array.isArray(data.observations) &&
        Array.isArray(data.contributions) &&
        data.session?.demo
      ) {
        // Keep existing demo records when upgrading the original two-status prototype.
        for (const organization of data.organizations) {
          organization.description ??= 'A fictional community organization in the AidAtlas demo.'
          organization.links ??= {}
          for (const need of organization.requests) {
            need.links ??= {}
            need.impactCategory ??= DEMO_CATEGORIES[organization.id]
            need.createdAt ??= need.confirmedAt
            need.updatedAt ??= need.confirmedAt
          }
        }
        for (const observation of data.observations) {
          observation.playback ??= false
          observation.detectionCount ??= 1
          observation.draftSource ??= 'template'
        }
        for (const contribution of data.contributions) {
          if (contribution.status === 'pending') contribution.status = 'pledged'
          if (contribution.status === 'confirmed') contribution.status = 'organization_confirmed'
        }
        // Add demo organizations introduced after this snapshot was saved, and their layer.
        for (const fixture of demoData.organizations) {
          const existing = data.organizations.find(
            (entry: { id: string }) => entry.id === fixture.id,
          )
          if (!existing) data.organizations.push(structuredClone(fixture))
          else {
            existing.category ??= fixture.category
            // Corrections to sample needs reach saved demos, unless the demo edited that request.
            for (const request of fixture.requests) {
              const saved = existing.requests?.find((entry: AidRequest) => entry.id === request.id)
              if (saved && saved.updatedAt === request.updatedAt) saved.urgency = request.urgency
            }
          }
        }
        data.contributionOwners ??= Object.fromEntries(
          data.contributions.map((entry: Contribution) => [entry.id, 'demo-supporter']),
        )
        return integrateConstellations(data as MockState)
      }
    }
  } catch {
    /* Storage is optional; invalid snapshots fall back to labelled fixtures. */
  }
  return freshDemo()
}

let state = loadDemo()
let failNext = false
export let demoStorageAvailable = true

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    demoStorageAvailable = true
  } catch {
    demoStorageAvailable = false
  }
}

async function mock<T>(action: () => T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 250))
  if (failNext) {
    failNext = false
    throw new ApiError(
      'Simulated connection error. Your changes were not saved. Please try again.',
      503,
      'service_unavailable',
    )
  }
  const result = action()
  persist()
  return structuredClone(result)
}

function requireStaff(organizationId: string) {
  if (state.session.role !== 'staff' || state.session.organizationId !== organizationId) {
    throw new ApiError('Only staff of this organization can update its requests.', 403, 'forbidden')
  }
}
function findOrganization(id: string) {
  const organization = state.organizations.find((entry) => entry.id === id)
  if (!organization) throw new ApiError('Organization not found.', 404, 'not_found')
  return organization
}
function publicObservation(observation: Observation): Observation {
  if (state.session.role === 'staff' && state.session.organizationId === observation.organizationId)
    return observation
  const {
    question: _question,
    response: _response,
    respondedAt: _respondedAt,
    ...publicFields
  } = observation
  return { ...publicFields, suggestedItems: [] }
}
function bootstrapDemo(): BootstrapData {
  return {
    session: state.session,
    organizations: state.organizations.map((organization) => ({
      ...organization,
      requests: organization.requests.filter(
        (need) => need.status === 'published' || state.session.organizationId === organization.id,
      ),
    })),
    observations: state.observations
      .filter(
        (entry) =>
          state.session.role !== 'staff' || entry.organizationId === state.session.organizationId,
      )
      .map(publicObservation),
    contributions: state.contributions.filter(
      (entry) => state.contributionOwners[entry.id] === state.session.id,
    ),
  }
}
function validateRequest(input: RequestInput) {
  if (!input.confirmed)
    throw new ApiError(
      'Confirm the need with your organization before publishing.',
      422,
      'validation_error',
    )
  if (!input.title.trim() || !input.item.trim() || !input.unit.trim() || !input.description.trim())
    throw new ApiError('Complete the request details before publishing.', 422, 'validation_error')
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100_000)
    throw new ApiError('Enter a whole quantity between 1 and 100,000.', 422, 'validation_error')
}

export const aidApi = {
  bootstrap: (): Promise<BootstrapData> =>
    DEMO_MODE ? mock(bootstrapDemo) : request('/v1/bootstrap'),
  getOrganization: (id: string): Promise<Organization> =>
    DEMO_MODE
      ? mock(() => findOrganization(id))
      : request(`/v1/organizations/${encodeURIComponent(id)}`),

  signInDemo: (role: Session['role'], organizationId = 'okanagan'): Promise<Session> =>
    DEMO_MODE
      ? mock(() => {
          if (role === 'staff' && !['okanagan', 'coast'].includes(organizationId))
            throw new ApiError('Choose an available staff demo account.', 422, 'validation_error')
          state.session =
            role === 'staff'
              ? {
                  id: organizationId === 'coast' ? 'demo-staff-coast' : 'demo-staff',
                  name: organizationId === 'coast' ? 'Sam Rivera' : 'Jamie Chen',
                  role,
                  organizationId,
                  demo: true,
                }
              : { id: 'demo-supporter', name: 'Alex Morgan', role, demo: true }
          return state.session
        })
      : request('/v1/auth/demo', {
          method: 'POST',
          body: JSON.stringify({ role, ...(role === 'staff' ? { organizationId } : {}) }),
        }),

  logout: (): Promise<void> =>
    DEMO_MODE
      ? mock(() => {
          state.session = structuredClone(demoData.session)
        })
      : request('/v1/auth/logout', { method: 'POST' }),

  contribute: (input: ContributionInput): Promise<Contribution> =>
    DEMO_MODE
      ? mock(() => {
          const organization = findOrganization(input.organizationId)
          if (
            !['donate', 'supplies', 'volunteer'].includes(input.kind) ||
            !Number.isSafeInteger(input.quantity) ||
            input.quantity < 1 ||
            input.quantity > 100_000
          )
            throw new ApiError('Enter a valid contribution quantity.', 422, 'validation_error')
          const need = organization.requests.find((entry) => entry.id === input.requestId)
          if (
            input.kind === 'supplies' &&
            (!need ||
              need.status !== 'published' ||
              input.quantity > need.quantity - need.fulfilled)
          ) {
            throw new ApiError(
              'This quantity is no longer needed. Refresh and choose a smaller quantity.',
              409,
              'conflict',
            )
          }
          if (input.kind === 'volunteer' && organization.volunteerSlots < 1)
            throw new ApiError(
              'There are no volunteer places available right now.',
              409,
              'conflict',
            )
          const summary =
            input.kind === 'donate'
              ? `$${input.quantity} USD contribution`
              : input.kind === 'volunteer'
                ? `${input.quantity} hours of volunteer time`
                : `${input.quantity} ${need!.unit} · ${need!.item}`
          const contribution: Contribution = {
            id: crypto.randomUUID(),
            ...input,
            organizationName: organization.name,
            impactCategory:
              need?.impactCategory ?? input.impactCategory ?? DEMO_CATEGORIES[organization.id],
            summary,
            createdAt: new Date().toISOString(),
            status: 'pledged',
            simulated: true,
          }
          state.contributions.unshift(contribution)
          state.contributionOwners[contribution.id] = state.session.id
          return contribution
        })
      : request('/v1/contributions', { method: 'POST', body: JSON.stringify(input) }),

  updateContributionStatus: (id: string, input: ContributionStatusInput): Promise<Contribution> =>
    DEMO_MODE
      ? mock(() => {
          const contribution = state.contributions.find((entry) => entry.id === id)
          if (!contribution) throw new ApiError('Contribution not found.', 404, 'not_found')
          if (input.status === 'user_reported_completed') {
            if (state.contributionOwners[id] !== state.session.id)
              throw new ApiError(
                'Only the supporter who made this pledge can report it completed.',
                403,
                'forbidden',
              )
            if (contribution.status === 'organization_confirmed')
              throw new ApiError('This contribution has already been confirmed.', 409, 'conflict')
            contribution.status = input.status
            contribution.reportedAt ??= new Date().toISOString()
          } else if (input.status === 'organization_confirmed') {
            requireStaff(contribution.organizationId)
            if (contribution.status === 'organization_confirmed') return contribution
            const quantity = input.confirmedQuantity ?? contribution.quantity
            if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > contribution.quantity)
              throw new ApiError(
                'Confirm a quantity between 1 and the pledged amount.',
                422,
                'validation_error',
              )
            const organization = findOrganization(contribution.organizationId)
            const need = organization.requests.find((entry) => entry.id === contribution.requestId)
            if (contribution.kind === 'supplies') {
              if (!need || quantity > need.quantity - need.fulfilled)
                throw new ApiError(
                  'This confirmation exceeds the remaining request quantity.',
                  409,
                  'conflict',
                )
              need.fulfilled += quantity
              need.updatedAt = new Date().toISOString()
            }
            contribution.status = input.status
            contribution.confirmedQuantity = quantity
            contribution.confirmedAt = new Date().toISOString()
            organization.updatedAt = contribution.confirmedAt
          } else throw new ApiError('Choose a valid contribution status.', 422, 'validation_error')
          return contribution
        })
      : request(`/v1/contributions/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: JSON.stringify(input),
        }),

  organizationContributions: (id: string): Promise<Contribution[]> =>
    DEMO_MODE
      ? mock(() => {
          requireStaff(id)
          return state.contributions.filter((entry) => entry.organizationId === id)
        })
      : request(`/v1/organizations/${encodeURIComponent(id)}/contributions`),

  publishRequest: (
    organizationId: string,
    input: RequestInput,
    requestId?: string,
  ): Promise<AidRequest> =>
    DEMO_MODE
      ? mock(() => {
          requireStaff(organizationId)
          validateRequest(input)
          const organization = findOrganization(organizationId)
          const existing = requestId
            ? organization.requests.find((entry) => entry.id === requestId)
            : undefined
          if (requestId && !existing) throw new ApiError('Request not found.', 404, 'not_found')
          if (existing && input.quantity < existing.fulfilled)
            throw new ApiError(
              'The total cannot be less than the quantity already fulfilled.',
              422,
              'validation_error',
            )
          if (
            input.observationId &&
            !state.observations.some(
              (entry) =>
                entry.id === input.observationId && entry.organizationId === organizationId,
            )
          )
            throw new ApiError(
              'This observation does not belong to your organization.',
              422,
              'validation_error',
            )
          const { confirmed: _confirmed, ...fields } = input
          const now = new Date().toISOString()
          const next: AidRequest = {
            ...fields,
            id: existing?.id ?? crypto.randomUUID(),
            organizationId,
            fulfilled: existing?.fulfilled ?? 0,
            status: input.status ?? existing?.status ?? 'published',
            confirmedAt: now,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            links: input.links ?? existing?.links ?? {},
          }
          if (existing)
            organization.requests = organization.requests.map((entry) =>
              entry.id === existing.id ? next : entry,
            )
          else organization.requests.unshift(next)
          organization.updatedAt = now
          return next
        })
      : request(
          `/v1/organizations/${encodeURIComponent(organizationId)}/requests${requestId ? `/${encodeURIComponent(requestId)}` : ''}`,
          { method: requestId ? 'PATCH' : 'POST', body: JSON.stringify(input) },
        ),

  checkIn: (observationId: string, response: CheckInResponse): Promise<Observation> =>
    DEMO_MODE
      ? mock(() => {
          const observation = state.observations.find((entry) => entry.id === observationId)
          if (!observation) throw new ApiError('Observation not found.', 404, 'not_found')
          requireStaff(observation.organizationId)
          if (!['not_affected', 'checking', 'support_needed'].includes(response))
            throw new ApiError('Choose a valid check-in response.', 422, 'validation_error')
          observation.response = response
          observation.respondedAt = new Date().toISOString()
          return observation
        })
      : request(`/v1/observations/${encodeURIComponent(observationId)}/check-in`, {
          method: 'POST',
          body: JSON.stringify({ response }),
        }),

  // Gemini writes request fields from staff's own words. It always uses the API server, as the
  // satellite layers do, because Gemini runs there; demo mode then publishes the result locally.
  draftRequest: (organizationId: string, text: string): Promise<RequestDraft> =>
    request(`/v1/organizations/${encodeURIComponent(organizationId)}/requests/draft`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  search: (query: string, limit = 8): Promise<SearchResults> =>
    DEMO_MODE
      ? mock(() => {
          const terms = query
            .toLowerCase()
            .split(/\W+/)
            .filter(
              (word) =>
                word.length > 2 && !['the', 'and', 'for', 'want', 'send', 'help'].includes(word),
            )
          return {
            query,
            method: 'keyword_fallback',
            results: state.organizations
              .flatMap((organization) =>
                organization.requests
                  .filter(
                    (need) =>
                      need.status === 'published' &&
                      terms.some((term) =>
                        `${need.title} ${need.item} ${need.description} ${organization.name} ${organization.location}`
                          .toLowerCase()
                          .includes(term),
                      ),
                  )
                  .map((need) => ({
                    score: 1,
                    request: need,
                    organization: {
                      id: organization.id,
                      name: organization.name,
                      location: organization.location,
                      type: organization.type,
                    },
                    explanation: need.description,
                  })),
              )
              .slice(0, limit),
          }
        })
      : request('/v1/search', { method: 'POST', body: JSON.stringify({ query, limit }) }),

  detections: (): Promise<FireDetections> =>
    DEMO_MODE
      ? mock(() => ({ type: 'FeatureCollection', features: [] }))
      : request('/v1/detections'),
  replayObservations: (): Promise<ReplaySummary> =>
    DEMO_MODE
      ? Promise.reject(
          new ApiError(
            'Historical replay is available when connected to the backend.',
            503,
            'service_unavailable',
          ),
        )
      : request('/v1/demo/replay-observations', {
          method: 'POST',
          body: JSON.stringify({ dataset: 'bc-wildfire-2023-08' }),
        }),

  // Starts over with the sample data. Constellation progress and the cosmos' memory of earlier
  // statuses restart too, so a demo can show a constellation connecting and a star brightening again.
  resetDemo: async (): Promise<void> => {
    if (!DEMO_MODE) await request('/v1/demo/reset', { method: 'POST' })
    clearCollections()
    try {
      sessionStorage.removeItem('aidatlas-cosmos-statuses')
    } catch {
      /* Optional visual history. */
    }
    if (DEMO_MODE)
      await mock(() => {
        state = freshDemo()
      })
  },
  clearDemoContributions: (): Promise<Contribution[]> => {
    if (!DEMO_MODE)
      return Promise.reject(
        new ApiError('Local demo controls are unavailable in server mode.', 403, 'forbidden'),
      )
    return mock(() => {
      state.contributions = state.contributions.filter(
        (entry) => state.contributionOwners[entry.id] !== state.session.id,
      )
      return []
    })
  },
  simulateNextError: () => {
    if (DEMO_MODE) failNext = true
  },
}
