# AidAtlas

**From global signals to organization-confirmed needs.**

AidAtlas is an interactive platform for exploring global challenges, discovering organizations working on the ground, responding to organization-confirmed requests, and revisiting personal contributions through a universe called **My Cosmos**.

Satellite and public-interest data can show where something may be happening. They cannot, by themselves, tell us whether a nearby organization has been affected, what it needs, or whether it can receive the help people want to send. AidAtlas uses those signals to provide context and start a check-in; people on the ground remain responsible for confirming and publishing their actual needs.

## The experience

### Explore seven global issue layers

| Layer | What AidAtlas shows | Primary source |
| --- | --- | --- |
| **Wildfire** | Near-real-time satellite heat detections and a North American wildfire-smoke forecast | NASA FIRMS NOAA-20 VIIRS; ECCC GeoMet |
| **Flood** | Reported flood events and estimated affected areas | GDACS |
| **Storm** | Recent tropical-cyclone tracks and estimated 60, 90, and 120 km/h wind zones | GDACS |
| **Nature** | Yearly cloudless satellite composites from 2016–2025 | EOxCloudless; modified Copernicus Sentinel-2 data |
| **War** | Preliminary conflict events for the latest available month | Uppsala Conflict Data Program Candidate Events Dataset |
| **Education** | The share and published number of primary- and lower-secondary-school-age children not enrolled in school | UNESCO Institute for Statistics |
| **Intimate Partner Violence** | Country-level, survey-based prevalence estimates | WHO; UN SDG indicator 5.2.1 |

Every layer keeps its source, date, and important limitations visible. A satellite detection is not a fire perimeter or proof of damage; a GDACS affected area is not measured inundation; country-level estimates do not identify individuals.

### Discover organizations on the ground

The Organizations view adds operational context to the globe:

- Humanitarian organizations that report activities through **OCHA Who Does What Where (3W)** data published by **HDX HAPI**
- Relevant Canadian registered charities from the **Canada Revenue Agency List of Charities**
- Conservation organizations from **IUCN** public member information and Canadian environmental charities

These markers represent reported presence or a registered field of work. They do **not** mean that every listed organization uses AidAtlas, was affected by an event, or is currently asking for help.

Participating AidAtlas organizations are a separate concept. Their authorized staff can answer check-ins, publish requests, and confirm what was received.

### Turn an observation into a confirmed request

The wildfire demonstration uses historical NASA FIRMS observations from the August 2023 British Columbia wildfires:

1. Detections in the same or adjacent 2 km grid cells are grouped into an event.
2. Low-confidence detections can be displayed but never trigger a check-in.
3. An event needs at least three nominal- or high-confidence detections to qualify.
4. Participating organizations within 10 km of a qualifying detection receive one in-app check-in per event.
5. Staff respond **Not affected**, **Still checking**, or **Support needed**.
6. Gemini can prepare a private structured draft, but staff must review and explicitly publish it.

The **10 km distance is a demo contact-search radius**, not a danger zone, fire perimeter, or evacuation boundary. Check-ins are in-app records; the current demo does not send email or SMS alerts.

### Help with a concrete need

Supporters can search published requests in natural language and see:

- The requested item, quantity, urgency, and receiving instructions
- The amount the organization has confirmed receiving
- The quantity still outstanding
- Official donation, supply, and volunteer links

AidAtlas records intent but does not process payments, shipping, or volunteer bookings. Contributions follow an explicit state transition:

```text
pledged → user reported completed → organization confirmed
```

Only the receiving organization's confirmation increases a request's fulfilled quantity. Transactional row locking and idempotent confirmation prevent the same contribution from being counted twice.

### Build a personal Cosmos

My Cosmos turns contribution history into a navigable Three.js universe:

- Each of the seven impact areas becomes a **galaxy**.
- Contributions to the same organization form a **constellation**.
- Each individual contribution becomes a **star**.
- Stars preserve whether support is pending or organization-confirmed and change visually with age.

My Cosmos is a personal record of participation and receipt status. Star size or position is not a financial or social-impact score.

## End-to-end flow

```text
Public-interest observation
        ↓
Nearby-organization check-in
        ↓
Staff-reviewed, organization-confirmed request
        ↓
Supporter search and pledge
        ↓
Organization-confirmed receipt
        ↓
Contribution star in My Cosmos
```

## Built with

### Frontend

- React 19, TypeScript, and Vite
- MapLibre GL JS for the interactive globe and geospatial layers
- Three.js for My Cosmos
- Vitest and Testing Library

### Backend

- Python 3.12 and FastAPI
- SQLAlchemy
- TiDB Cloud for relational storage and vector search
- Gemini structured generation for private request drafts
- `gemini-embedding-001` embeddings at 768 dimensions
- Pytest

If Gemini or vector search is unavailable, template drafting and keyword search fallbacks keep the core workflow usable and disclose the fallback method.

## Run locally

### Prerequisites

- Node.js with npm
- Python 3.12
- A TiDB Cloud Starter cluster running TiDB 8.4 or later for vector search
- A Gemini API key for AI drafting and semantic search

### 1. Start the backend

From PowerShell:

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Fill in `backend/.env`:

```dotenv
TIDB_HOST=your-cluster-host.tidbcloud.com
TIDB_PORT=4000
TIDB_USER=your-prefix.root
TIDB_PASSWORD=your-password
TIDB_DB_NAME=aidatlas
GEMINI_API_KEY=your-gemini-key
CORS_ORIGINS=http://localhost:5173
SESSION_SECRET=replace-with-a-long-random-string
```

Initialize the database and run the API:

```powershell
.venv\Scripts\python -m app.init_db
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### 2. Start the frontend

In a second PowerShell window:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
```

Set live API mode in `frontend/.env.local`:

```dotenv
VITE_API_MODE=live
VITE_API_BASE_URL=/api
```

Then start Vite:

```powershell
npm run dev
```

Open the local URL printed by Vite. During development, Vite proxies `/api` to `http://127.0.0.1:8000`.

### Frontend-only demo mode

The frontend defaults to clearly labeled local sample data when `VITE_API_MODE` is not `live`:

```powershell
cd frontend
npm install
npm run dev
```

The full database-backed check-in, vector-search, and receipt-confirmation flow requires the backend.

## Demo walkthrough

1. Reset the demo and sign in as staff of **Okanagan Community Relief**.
2. Replay wildfire observations through August 17, 2023.
3. Open the generated check-in and respond **Support needed**.
4. Review Gemini's draft, edit the request, and publish it.
5. Return as the demo supporter, search for the request, and record a pledge.
6. Mark the pledge completed as the supporter.
7. Return as staff and confirm the quantity actually received.
8. Open My Cosmos and inspect the organization-confirmed contribution star.

Replaying the same observations updates existing event/organization records instead of duplicating check-ins.

## Test and verify

Frontend:

```powershell
cd frontend
npm test
npm run lint
npm run format:check
npm run build
```

Backend:

```powershell
cd backend
.venv\Scripts\python -m pytest
```

The backend tests use an isolated in-memory SQLite database rather than the configured TiDB database or Gemini credentials. See [`backend/README.md`](backend/README.md) for live verification and detailed API behavior.

## Project structure

```text
stormhacks-2026/
├── frontend/                 React, MapLibre, and Three.js client
│   ├── src/                  UI, layers, API boundary, and My Cosmos
│   ├── public/data/          Bundled and generated public datasets
│   └── tests/                Frontend interaction and data tests
├── backend/                  FastAPI application
│   ├── app/                  API, models, check-ins, AI, and data services
│   ├── data/                 Historical FIRMS demo dataset and prepared assets
│   ├── scripts/              Data preparation and live verification
│   └── tests/                API and data-service tests
└── AIDATLAS_PROJECT_HISTORY.md
```

## Data and attribution

AidAtlas displays attribution in the interface. Major sources include:

- [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) — NOAA-20 VIIRS 375 m active-fire detections
- [ECCC GeoMet](https://eccc-msc.github.io/open-data/msc-data/nwp_raqdps/readme_raqdps_en/) — wildfire-smoke forecast
- [GDACS](https://www.gdacs.org/) — reported floods and tropical cyclones
- [EOxCloudless](https://cloudless.eox.at/) — yearly Sentinel-2 cloudless composites; usage conditions apply
- [Uppsala Conflict Data Program](https://ucdp.uu.se/) — preliminary candidate conflict events
- [UNESCO UIS](https://databrowser.uis.unesco.org/resources/bulk) — combined primary/lower-secondary out-of-school indicators
- [World Health Organization](https://www.who.int/data/gho/data/indicators/indicator-details/GHO/intimate-partner-violence-prevalence-among-ever-partnered-women) and UN SDG 5.2.1 — intimate partner violence estimates
- [HDX HAPI](https://hapi.humdata.org/) and OCHA 3W — humanitarian organization activity
- [Canada Revenue Agency List of Charities](https://www.canada.ca/en/revenue-agency/services/charities-giving/charities-listings.html) — registered Canadian charities
- [IUCN](https://www.iucn.org/our-union/members) — conservation member organizations

Review each provider's license and usage terms before redistribution or commercial deployment. EOxCloudless imagery is licensed separately and the required attribution must remain visible.

## Important limitations

- AidAtlas is a hackathon prototype, not an emergency warning or dispatch system.
- Public organization markers indicate reported presence or category, not AidAtlas participation or a current request.
- Seeded demo organizations and accounts are fictional and clearly marked as samples.
- Satellite detections and modeled areas do not prove local impact or need.
- The 10 km check-in rule is a demo contact policy, not a validated hazard radius.
- Organization confirmation shows that the organization recorded receipt; it does not independently vet the organization or audit the final use of funds.
- Payments, shipping, booking, organization vetting, and outbound notifications are outside the current scope.

## More documentation

- [`frontend/frontend.md`](frontend/frontend.md) — frontend behavior, data semantics, and attribution
- [`backend/README.md`](backend/README.md) — backend setup, data services, check-in rules, and verification
- [`backend/API_CONTRACT.md`](backend/API_CONTRACT.md) — API contract and response types
