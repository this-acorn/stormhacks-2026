// This is the shared vocabulary between the React screens and the API client.
// Coordinates always use [longitude, latitude], as required by MapLibre / GeoJSON.
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { CurrentImpactCategory } from './impactCategories'

export type Coordinates = [number, number]
export type LayerId = CurrentImpactCategory
export type ContributionKind = 'donate' | 'supplies' | 'volunteer'
// Legacy snapshots remain readable without silently assigning a different cause.
export type ImpactCategory = CurrentImpactCategory | 'disaster' | 'community'
export type CheckInResponse = 'not_affected' | 'checking' | 'support_needed'
export type ContributionStatus = 'pledged' | 'user_reported_completed' | 'organization_confirmed'

export interface SupportLinks {
  website?: string
  donate?: string
  supplies?: string
  volunteer?: string
}

export interface AidRequest {
  impactCategory?: ImpactCategory
  id: string
  organizationId: string
  title: string
  item: string
  quantity: number
  fulfilled: number
  unit: string
  urgency: 'urgent' | 'standard'
  description: string
  status: 'published' | 'closed'
  confirmedAt: string
  observationId?: string
  links: SupportLinks
  createdAt: string
  updatedAt: string
}

export interface Organization {
  id: string
  name: string
  type: string
  location: string
  coordinates: Coordinates
  situation: string
  description: string
  links: SupportLinks
  updatedAt: string
  sample: boolean
  volunteerRole: string
  volunteerSlots: number
  requests: AidRequest[]
  category?: LayerId // which Explore layer the organization appears under
}

export interface Observation {
  id: string
  organizationId: string
  title: string
  summary: string
  coordinates: Coordinates
  source: string
  observedAt: string
  proximityKm: number
  simulated: boolean
  playback: boolean
  detectionCount: number
  draftSource: 'gemini' | 'template'
  question?: string
  response?: CheckInResponse
  respondedAt?: string
  suggestedItems: { item: string; quantity: number; unit: string }[]
}

export interface Contribution {
  // Optional until the backend returns a category snapshot with each record.
  impactCategory?: ImpactCategory
  id: string
  organizationId: string
  organizationName: string
  requestId?: string
  kind: ContributionKind
  summary: string
  quantity: number
  confirmedQuantity?: number
  createdAt: string
  status: ContributionStatus
  reportedAt?: string
  confirmedAt?: string
  simulated: boolean
}

export interface Session {
  id: string
  name: string
  role: 'supporter' | 'staff'
  organizationId?: string
  demo: boolean
}

export interface BootstrapData {
  organizations: Organization[]
  observations: Observation[]
  contributions: Contribution[]
  session: Session
}

export interface ContributionInput {
  // Used by the local demo; live category snapshots should be assigned by the server.
  impactCategory?: ImpactCategory
  organizationId: string
  requestId?: string
  kind: ContributionKind
  quantity: number
  note?: string
}

export interface RequestInput {
  impactCategory?: ImpactCategory
  title: string
  item: string
  quantity: number
  unit: string
  urgency: 'urgent' | 'standard'
  description: string
  observationId?: string
  links?: SupportLinks
  status?: 'published' | 'closed'
  confirmed: boolean
}

export type RequestDraftField = 'title' | 'item' | 'quantity' | 'unit' | 'description'

// Gemini's reading of staff's own words. Details the staff did not give are null and listed in `missing`.
export interface RequestDraft {
  title: string | null
  item: string | null
  quantity: number | null
  unit: string | null
  urgency: 'urgent' | 'standard'
  description: string | null
  otherNeeds: string[]
  missing: RequestDraftField[]
}

export interface ContributionStatusInput {
  status: 'user_reported_completed' | 'organization_confirmed'
  confirmedQuantity?: number
}

export interface SearchResults {
  query: string
  method: 'tidb_vector' | 'keyword_fallback'
  results: {
    score: number
    request: AidRequest
    organization: Pick<Organization, 'id' | 'name' | 'location' | 'type'>
    explanation: string
  }[]
}

export interface DetectionProperties {
  id: string
  source: string
  instrument: string
  satellite: string
  acquiredAt: string
  confidence: string
  frpMw: number
  brightnessK: number
  dayNight: string
  playback: boolean
}
export type FireDetection = Feature<Point, DetectionProperties>
export type FireDetections = FeatureCollection<Point, DetectionProperties>

export interface ReplaySummary {
  playback: boolean
  dataset: string
  source: string
  observedFrom: string
  observedTo: string
  title: string
  detectionsAdded: number
  detectionsTotal: number
  events: number
  checkInsCreated: number
  checkInsExisting: number
}

export interface LayerDefinition {
  id: LayerId
  name: string
  available: boolean
  description: string
}
