# AidAtlas API contract (proposed v1)

Proposal from the backend team, built on the frontend's `src/types.ts` and `src/api.ts`.
Changes from the frontend's current types are marked **NEW** or **CHANGED**.

## Education data

`GET /api/v1/hazards/education` is public and responds with `Cache-Control: no-store`. It returns the latest validated UIS education dataset (`schemaVersion`, `release`, `releaseId`, `years`, `countries`, source URLs/hashes and attribution), plus `updates`: `state` (`current`, `checking`, or `stale`), `automatic: true`, `checkedAt` (last successful source check or null), and `nextCheckAt`. Observation years are independent of release/check timestamps. The API checks upstream daily in the background and retries failures hourly; existing observations remain available during refresh or failure. If no validated data is available yet, it returns 503. The frontend adds the `offline` state only for a lost API connection and never claims its bundled fallback is automatically updating.

## Nature imagery

- `GET /api/v1/hazards/nature`: saved archive metadata with `months` (ordered `YYYY-MM` values), `latestObservation`, `minZoom: 0`, `maxZoom: 14`, `overviewMaxZoom: 2`, `detailMinZoom: 9`, `overviewSource`, and `cloudCoverMax: 20` (regional detail only). No upstream requests; returns 503 if the saved archive has not been prepared. `Cache-Control: no-store`.
- `GET /api/v1/hazards/nature/overview/{month}/{z}/{x}/{y}.png`: precomputed Sentinel-2 HLS S30 monthly browse imagery, `image/png`, 256 px tiles, zoom 0–2, `Cache-Control: public, max-age=86400`. Returns 400 for invalid coordinates/months and 404 for unsaved imagery. Reading tiles never triggers image processing. The reduced-resolution global preview contains clouds/gaps; transparent pixels mean no observed imagery.
- `GET /api/v1/hazards/nature/{month}`: on-demand regional Sentinel-2 L2A detail registration, with `month`, `searchId`, `minZoom: 9`, `maxZoom: 14`, `cloudCoverMax: 20`. Returns 400 for malformed months and 503 for unavailable upstream imagery. Detail requests use the public Planetary Computer API; the saved globe archive does not depend on it.

## Conventions

- **Base URL:** `/api/v1`. In development, Vite proxies `/api` to FastAPI at `http://127.0.0.1:8000`.
- **Field names** are camelCase.
- **IDs** are strings and never change. Seeded demo records use readable IDs (`okanagan`); new records get prefixed random IDs (`req_3f9a1c2b7d4e`).
- **Timestamps** are ISO 8601 in UTC with a `Z` suffix: `2026-10-03T18:05:12Z`.
- **Coordinates** are `[longitude, latitude]` (GeoJSON order).
- **Sign-in** uses a signed, HTTP-only session cookie set by `POST /auth/demo`. Requests must send cookies (`credentials: 'same-origin'`, as `api.ts` already does).
- **Fire detections are points where a satellite saw heat.** They are not damage areas or confirmed impact.
- **Errors** always look like this, and `detail` is a sentence that can be shown to the user:

```json
{ "detail": "Only staff of this organization can update its requests.", "code": "forbidden" }
```

Invalid input (422) also lists the fields at fault:

```json
{
  "detail": "Enter a whole quantity between 1 and 100,000.",
  "code": "validation_error",
  "fields": { "quantity": "Enter a whole quantity between 1 and 100,000." }
}
```

| Status | Meaning | `code` |
|---|---|---|
| 401 | Not signed in | `not_authenticated` |
| 403 | Signed in, but not allowed | `forbidden` |
| 404 | Record does not exist | `not_found` |
| 409 | Conflicts with current data, e.g. quantity no longer needed | `conflict` |
| 422 | Invalid input | `validation_error` |
| 503 | TiDB or Gemini unavailable | `service_unavailable` |

## Types

```ts
type Coordinates = [number, number]            // [longitude, latitude]
type ContributionKind = 'donate' | 'supplies' | 'volunteer'
type CheckInResponse = 'not_affected' | 'checking' | 'support_needed'
type ContributionStatus = 'pledged' | 'user_reported_completed' | 'organization_confirmed'  // CHANGED (was 'pending' | 'confirmed')

interface SupportLinks {                // NEW: official external links, any may be absent
  website?: string
  donate?: string
  supplies?: string
  volunteer?: string
}

interface Organization {
  id: string
  name: string
  type: string                          // "Community centre", "Elderly-care facility", ...
  location: string                      // "Kelowna, British Columbia"
  coordinates: Coordinates
  situation: string
  description: string                   // NEW: who they are and whom they serve
  links: SupportLinks                   // NEW
  updatedAt: string
  sample: boolean                       // true = fictional demo organization
  volunteerRole: string
  volunteerSlots: number
  requests: AidRequest[]                // published ones; this org's staff also see closed ones
}

interface AidRequest {
  id: string
  organizationId: string
  title: string
  item: string
  quantity: number                      // requested
  fulfilled: number                     // confirmed received: only organization_confirmed contributions count
  unit: string
  urgency: 'urgent' | 'standard'
  description: string
  status: 'published' | 'closed'
  confirmedAt: string                   // when staff approved publishing
  observationId?: string                // set when published from a check-in
  links: SupportLinks                   // NEW: empty means "use the organization's links"
  createdAt: string                     // NEW
  updatedAt: string                     // NEW
}

// A satellite check-in: one fire event, sent to one nearby organization.
interface Observation {
  id: string
  organizationId: string
  title: string                         // "Satellite fire detections nearby"
  summary: string                       // why this organization was asked, from the data
  coordinates: Coordinates              // the detection nearest the organization
  source: string                        // "NASA FIRMS · VIIRS NOAA-20 (375 m)"
  observedAt: string                    // time of that nearest detection
  proximityKm: number
  simulated: boolean                    // false: these are real detections
  playback: boolean                     // NEW: true when replaying a past, downloaded dataset
  detectionCount: number                // NEW: detections from this event within the radius
  draftSource: 'gemini' | 'template'    // NEW: who wrote the question and suggestions
  question?: string                     // NEW, staff only: editable check-in question
  response?: CheckInResponse            // staff only
  respondedAt?: string                  // NEW, staff only
  suggestedItems: { item: string; quantity: number; unit: string }[]  // staff only; [] for supporters
}

interface Contribution {
  id: string
  organizationId: string
  organizationName: string
  requestId?: string
  kind: ContributionKind
  summary: string                       // "12 pantry food boxes"
  quantity: number                      // pledged
  confirmedQuantity?: number            // NEW: set when the organization confirms
  createdAt: string
  status: ContributionStatus            // CHANGED
  reportedAt?: string                   // NEW: supporter marked it completed
  confirmedAt?: string                  // NEW: organization confirmed receipt
  simulated: boolean                    // always true: no money or goods move through AidAtlas
}

interface Session {
  id: string
  name: string
  role: 'supporter' | 'staff'
  organizationId?: string               // staff only
  demo: boolean
}

interface BootstrapData {
  organizations: Organization[]
  observations: Observation[]           // check-ins: staff get their own org's in full, supporters get the public view
  contributions: Contribution[]         // the signed-in user's own (My Cosmos)
  session: Session
}
```

AI drafts stay private: supporters receive check-ins without `question`, `response` and `respondedAt`, and with empty `suggestedItems`, until staff publish a request.

## Endpoints

### Session

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/demo` | anyone | `{ "role": "supporter" }` or `{ "role": "staff", "organizationId": "okanagan" }` | `Session`, sets cookie |
| POST | `/auth/logout` | anyone | none | 204 |
| GET | `/me` | signed in | none | `Session` |
| GET | `/bootstrap` | anyone | none | `BootstrapData` |

Demo accounts: supporter Alex Morgan (`demo-supporter`) and one staff account per organization: Jamie Chen for `okanagan` (`demo-staff`), Sam Rivera for `coast` (`demo-staff-coast`), and `demo-staff-<organizationId>` for the others. `{ "role": "staff" }` without `organizationId` signs in as Jamie Chen. If no one is signed in, `/bootstrap` signs the visitor in as the demo supporter. The server decides the role; the frontend never sends one with other requests.

### Organizations and requests

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| GET | `/organizations` | anyone | none | `Organization[]` |
| GET | `/organizations/{id}` | anyone | none | `Organization` |
| GET | `/requests?organizationId=&status=` | anyone | none | `AidRequest[]` |
| POST | `/organizations/{id}/requests` | staff of `{id}` | `RequestInput` | 201 `AidRequest` |
| POST | `/organizations/{id}/requests/draft` | staff of `{id}` | `{ "text": "..." }` | `RequestDraft` |
| PATCH | `/organizations/{id}/requests/{requestId}` | staff of `{id}` | any subset of `RequestInput` | `AidRequest` |

```ts
interface RequestInput {
  title: string
  item: string
  quantity: number                      // 1 to 100,000, and not below `fulfilled`
  unit: string
  urgency: 'urgent' | 'standard'
  description: string
  observationId?: string                // must be a check-in for this organization
  links?: SupportLinks                  // NEW
  status?: 'published' | 'closed'       // NEW, PATCH only: close or reopen
  confirmed: boolean                    // must be true: staff approve publishing
}
```

Example: `POST /api/v1/organizations/okanagan/requests`

```json
{
  "title": "Drinking water for evacuated families",
  "item": "Bottled water (24-pack)",
  "quantity": 60,
  "unit": "cases",
  "urgency": "urgent",
  "description": "Families staying at our hall need drinking water while the fire is active nearby.",
  "observationId": "chk_5d1e9a0c3b2f",
  "links": { "donate": "https://example.org/donate" },
  "confirmed": true
}
```

Returns 201 with the saved `AidRequest` (`fulfilled: 0`, `status: "published"`). Staff of another organization get 403.

PATCH accepts any subset of the fields. Changing content needs `confirmed: true`; closing or reopening with `{ "status": "closed" }` alone does not.

`/requests/draft` (NEW) asks Gemini to turn the staff's own words (3 to 1,000 characters, any language) into request fields in English. It saves nothing; the frontend publishes the result through `POST /organizations/{id}/requests`. Details the staff did not give are `null` and listed in `missing`, never guessed. Returns 503 if Gemini is unavailable, so the form is filled in by hand.

```ts
interface RequestDraft {
  title: string | null
  item: string | null
  quantity: number | null               // only a number the staff gave
  unit: string | null
  urgency: 'urgent' | 'standard'        // urgent only if the staff said so
  description: string | null
  otherNeeds: string[]                  // further needs mentioned, one request each
  missing: ('title' | 'item' | 'quantity' | 'unit' | 'description')[]
}
```

Example: `{ "text": "Flood here, need volunteers, at least 10" }` returns `{ "item": "Volunteers", "quantity": 10, "unit": "people", "urgency": "standard", "missing": [], ... }`.

### Satellite data and check-ins

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| GET | `/detections?dataset=&from=&to=&minConfidence=` | anyone | none | GeoJSON `FeatureCollection` of fire detections |
| GET | `/hazards/wildfire` | anyone | none | Current FIRMS `FireData`: `builtAt`, `windowStart`, `windowEnd`, observed `start`/`end`, `playback: false`, `clusters` and compact `detections` arrays `[lng, lat, minutes after start, FRP MW, cluster index]`; 503 when the upstream feed is unavailable |
| GET | `/hazards/smoke` | anyone | none | ECCC `source`, `layer`, pinned `modelRun`, available hourly `times`, `[west, south, east, north]` coverage `bounds`, `resolutionKm`, `coverage`, `units`; 503 for unavailable or expired forecasts |
| GET | `/observations` | signed in | none | `Observation[]` (same rules as bootstrap) |
| POST | `/demo/replay-observations` | signed in | optional `{ "through": "2023-08-17" }` | replay summary |
| POST | `/demo/reset` | signed in | none | `{ "reset": true, "rowsAdded": n }` |
| POST | `/observations/{id}/check-in` | staff of that org | `{ "response": "support_needed" }` | `Observation` |

`/detections` is empty until a dataset is replayed. `from` and `to` are UTC days (`2023-08-17`); `minConfidence` is `low` (default, everything), `nominal` or `high`. `/demo/reset` deletes replayed data, new requests and contributions, and restores the original demo data.

A detection feature:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-119.5882, 49.9143] },
  "properties": {
    "id": "det_8c2b41e07f3a",
    "source": "NASA FIRMS",
    "instrument": "VIIRS",
    "satellite": "NOAA-20",
    "acquiredAt": "2023-08-17T21:06:00Z",
    "confidence": "high",
    "frpMw": 18.4,
    "brightnessK": 345.2,
    "dayNight": "D",
    "playback": true,
    "dataset": "bc-wildfire-2023-08",
    "eventId": "evt_41c0a9d2e8b7"
  }
}
```

Replay summary. `POST /demo/replay-observations` with `{ "through": "2023-08-17" }` replays 15 to 17 August; a later day adds the next detections:

```json
{
  "playback": true,
  "dataset": "bc-wildfire-2023-08",
  "title": "BC Southern Interior wildfires, 15-19 August 2023",
  "source": "NASA FIRMS · VIIRS 375 m active fire detections, NOAA-20 (JPSS-1), yearly country archive",
  "observedFrom": "2023-08-15T08:31:00Z",
  "observedTo": "2023-08-17T21:03:00Z",
  "detectionsAdded": 4125,
  "detectionsTotal": 4125,
  "events": 16,
  "checkInsCreated": 2,
  "checkInsUpdated": 0,
  "checkInsExisting": 0
}
```

Spatial rule:

1. Detections in the same or touching 2 km grid cells form one fire event.
2. Low-confidence detections are stored and shown, but never trigger check-ins.
3. An event with at least 3 nominal- or high-confidence detections sends one check-in to every organization within 10 km (great-circle distance) of any of them.
4. A fire event and an organization never get two check-ins: the database refuses duplicates. Replaying again updates distances and counts and reports `checkInsExisting` instead.

Answering a check-in never publishes anything. Staff publish a request through `POST /organizations/{id}/requests` with `observationId` and `confirmed: true`.

### Search

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `/search` | anyone | `{ "query": "I want to send winter clothes for children", "limit": 5 }` | search results |

```json
{
  "query": "I want to send winter clothes for children",
  "method": "tidb_vector",
  "results": [
    {
      "score": 0.81,
      "request": { "id": "valley-request-1", "item": "Children's winter jackets" },
      "organization": { "id": "nepal", "name": "Valley Together", "location": "Kathmandu, Nepal", "type": "Children's charity" },
      "explanation": "This request asks for children's winter jackets (sizes 4 to 12)."
    }
  ]
}
```

`request` is a full `AidRequest` (shortened above). `method` says how results were found: `tidb_vector` for TiDB AI search, or `keyword_fallback` if the AI search is unavailable, so the UI can label it. Explanations only quote the request's own fields.

### Contributions

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `/contributions` | signed in | `ContributionInput` | 201 `Contribution` (`pledged`) |
| GET | `/me/contributions` | signed in | none | `Contribution[]` (My Cosmos) |
| GET | `/organizations/{id}/contributions` | staff of `{id}` | none | `Contribution[]` to review |
| PATCH | `/contributions/{id}/status` | see rules | `{ "status": "organization_confirmed", "confirmedQuantity": 10 }` | `Contribution` |

```ts
interface ContributionInput {
  organizationId: string
  requestId?: string                    // required when kind is 'supplies'
  kind: ContributionKind
  quantity: number                      // supplies: units, donate: USD, volunteer: hours
  note?: string                         // NEW, optional
}
```

Status rules:

- `pledged` → `user_reported_completed`: only the supporter who made it.
- `pledged` or `user_reported_completed` → `organization_confirmed`: only staff of the receiving organization. Adds `confirmedQuantity` (default: `quantity`) to the request's `fulfilled`, exactly once.
- Confirming an already confirmed contribution returns it unchanged and counts nothing twice.
- A supplies pledge larger than what is still needed (`quantity − fulfilled`) gets 409.
- Opening a support link records nothing. Only `POST /contributions` records intent, and it is not proof of payment or delivery.

### Health

`GET /health` returns:

```json
{ "status": "ok", "database": "connected", "gemini": "configured", "vectorSearch": "tidb", "time": "2026-10-03T18:05:12Z" }
```

## Out of scope for v1

Payments, shipping, email or SMS, organization verification, and real user accounts.
