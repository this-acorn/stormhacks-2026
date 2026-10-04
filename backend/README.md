# AidAtlas backend

FastAPI + TiDB Cloud + Gemini. It turns satellite fire detections into check-ins for nearby organizations, lets their staff publish confirmed needs, helps supporters find those needs with AI search, and records contributions for "My Cosmos".

The API is described in [API_CONTRACT.md](API_CONTRACT.md); the interactive docs are at `http://127.0.0.1:8000/docs` while the server runs.

## Setup

Requires Python 3.12 and a TiDB Cloud Starter cluster (v8.4 or later, for vector search).

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
copy .env.example .env          # then fill in the TiDB, Gemini and session values
.venv\Scripts\python -m app.init_db
```

`app.init_db` creates the `aidatlas` database and its tables, adds the demo data and stores Gemini embeddings for the demo requests. It is safe to run again; `--reset` drops every table and starts over.

## Run

```powershell
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

The frontend's Vite dev server proxies `/api` to port 8000, so the browser sees one origin and the sign-in cookie just works. Other origins must be listed in `CORS_ORIGINS`.

## Try it

From Git Bash (`-c`/`-b` keep the sign-in cookie between calls):

```bash
API=http://127.0.0.1:8000/api/v1
curl -s -c jar -b jar -X POST $API/auth/demo -H 'Content-Type: application/json' -d '{"role":"staff","organizationId":"okanagan"}'
curl -s -c jar -b jar -X POST $API/demo/replay-observations -H 'Content-Type: application/json' -d '{"through":"2023-08-17"}'
curl -s -c jar -b jar $API/observations
curl -s -X POST $API/search -H 'Content-Type: application/json' -d '{"query":"I want to send winter clothes for children"}'
```

## Demo flow

1. `POST /demo/reset` for a clean start. Visitors start as the demo supporter, Alex Morgan.
2. Sign in as staff of Okanagan Community Relief: `{"role": "staff", "organizationId": "okanagan"}`.
3. Replay through 17 August 2023. Okanagan Community Relief (Kelowna) and North Shuswap Community Hall get check-ins; Vernon Children's Fund, 28 km away, does not.
4. Staff answer `support_needed`, edit the drafted items and publish a request with `observationId` and `confirmed: true`.
5. As the supporter, search, pledge, and mark the pledge completed. Staff confirm it; only then does `fulfilled` grow, and the star turns `organization_confirmed`.
6. Replay through 18 August: new detections arrive and Lake Country Seniors' Residence gets its first check-in, while existing check-ins are updated rather than duplicated.

## Data source

- **Education:** `GET /api/v1/hazards/education` serves the latest validated UNESCO UIS combined primary/lower-secondary out-of-school series and update status. A background task starts with the API, discovers the current SDG/OPRI release from the official bulk page daily, and conditionally downloads archives to catch same-release revisions. Failed checks retry hourly while retaining the previous values and successful-check timestamp. New releases are parsed and validated before an atomic cache replacement. No API key, cron setup or redeployment is needed. Keep the API running with outbound HTTPS and a writable `backend/.cache/education` directory; mount that directory on persistent storage in production. The committed `data/education.json` provides the startup seed. The frontend polls the API every minute while this layer is open and explicitly labels its bundled offline fallback if the API is unreachable. Data years remain country-specific; updating does not imply that every country has a current-year observation. See [UIS bulk data](https://databrowser.uis.unesco.org/resources/bulk).

- **Nature monthly imagery:** `GET /api/v1/hazards/nature` reads a saved monthly archive beginning in January 2018. At globe zoom, `/api/v1/hazards/nature/overview/{YYYY-MM}/{z}/{x}/{y}.png` serves ordinary PNG files directly from `backend/data/nature-overview/v1`. Neither endpoint searches for scenes, contacts a satellite provider, or composites imagery during playback. The archive contains Sentinel-2 observations from [NASA HLS S30, published through GIBS](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/HLS_S30_Nadir_BRDF_Adjusted_Reflectance.json), not HLS L30/Landsat or MODIS. Attribution: NASA HLS / GIBS; contains modified Copernicus Sentinel-2 data.
- Each saved month uses only advertised daily observations within that UTC month. A per-channel median of the rendered RGB browse images produces a visual composite; it is **not** a scientific reflectance average or a guaranteed cloud-free product. Clouds and observation gaps remain. Pixels without observations are never filled with another month or year: land observed in other months but not this one, and polar night (the sun about 6–9° up or lower at the satellite's ~10:30 pass, calibrated on the archive's own winter edges), are shaded dark; areas this product never images (ocean, Antarctica) stay transparent in daylight. Each month keeps a `seen.png` mask of its observed pixels, so `.venv\Scripts\python -m scripts.shade_nature_overviews` re-shades the archive without downloading anything; the prepare command runs it automatically. HLS source imagery is 30 m; the saved global overview is deliberately reduced to a 1024 x 1024 Web Mercator image and a zoom 0–2 tile pyramid for fast globe playback. It must not be presented as a full-resolution 30 m global download.
- Prepare the archive once from `backend` with `.venv\Scripts\python -m scripts.prepare_nature_overviews --start 2018-01 --end 2026-09`. The command resumes completed months and publishes the catalog only after the requested range succeeds. Each month has a provenance manifest with exact dates, processing, projection and source. Ship `data/nature-overview/v1` with the API and keep it on writable persistent storage. Once an archive exists, an hourly background task prepares newly completed months and publishes them atomically. Failed updates retain the previous catalog and retry later; page requests never trigger generation. Nature reloads the catalog when reopened; an already-open timeline does not poll.
- For a fresh rebuild of the prepared 2018–2026 archive, add `--exclude-date 2022-05-15`: GIBS advertises that date but its WMS returns a reproducible unreadable-tile exception (also checked at 2048 and 4096 px). May 2022 uses its other 30 daily observations. This explicit exclusion is recorded in that month's manifest; provider failures are never silently skipped. A repaired source can be rebuilt separately later.
- At a **manual** zoom of 9 or closer, `GET /api/v1/hazards/nature/{YYYY-MM}` registers date-restricted 10 m Sentinel-2 L2A `visual` scene mosaics with Microsoft Planetary Computer. These regional detail tiles are generated externally on demand and can still be slower than the saved overview. They prioritize low-cloud scenes and exclude scenes above 20% cloud cover; that threshold applies to detail, not the saved overview. No API key or Earth Engine account is needed. Catalog and detail registrations are cached for one hour with bounded registration storage. Sources: [Planetary Computer Data API example](https://github.com/microsoft/PlanetaryComputerExamples/blob/main/quickstarts/using-the-data-api.ipynb), [Sentinel-2 L2A collection](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a).
- Nature selection, date changes, playback and catalog completion preserve the camera. One continuous monthly slider runs from January 2018 through the latest prepared completed month. Small year markers appear below it, and its cursor stays unchanged. Play changes the actual monthly globe imagery, waits for loaded tiles, and continues across December/January. Errors keep the previous image and allow retry. The displayed date, source and attribution describe the loaded map; the request legend stays visible. Annual EOX imagery is only the initial labeled loading fallback, not a substitute for monthly playback. There is no zoom requirement or zoom button.
- After a month loads, the frontend preloads up to two months in either direction, one at a time, retaining at most six decoded map frames. Saved PNGs have one-day HTTP caching. Regional detail also uses a 64 MiB / 512-tile byte cache for one hour. Ready frames switch immediately; in-flight preloads can become selected without restarting. Camera movement stops speculative requests, and inactive frames remain beneath an opaque background. The API server is required even in frontend demo mode.

- **Current Explore Wildfire:** `GET /api/v1/hazards/wildfire` reads NASA FIRMS' public NOAA-20 VIIRS 375 m global 24-hour CSV. No API key is required. The server caches the download for ten minutes, filters observations to the past 24 hours, and excludes low-confidence, invalid and duplicate records. It keeps small clusters as well as large ones. This endpoint does not use the replay database or bundled snapshots; upstream failures return 503. The frontend refreshes every ten minutes and displays the latest observation timestamp. Both demo and live organization modes use this endpoint, so the API server is required for Explore Wildfire.
- These observations are near real time, with satellite revisit and publication delays. They do not assert that every detected pixel is burning right now. The flame effect and short rising smoke at each observation are stylized.
- **Smoke forecast:** `GET /api/v1/hazards/smoke` reads the latest ECCC GeoMet catalog for `RAQDPS.Sfc_PM2.5-WildfireSmokePlume` (the operational successor to FireWork). It returns the actual published hourly times, model run and coverage bounds. GeoMet serves forecast rasters directly; a MapLibre protocol converts the official concentration palette into gray smoke without changing the plume mask. Ground-level PM2.5 bands start at 1 µg/m³. Coverage is most of North America at roughly 10 km resolution, up to 72 hours from the model run, updated twice daily. The timeline ends at the last available hour, rather than inventing 72 additional hours from the current time. Metadata refreshes every ten minutes. Invalid or outdated catalogs return 503; loading failures keep the previous displayed time and offer retry. No API key is needed. See [ECCC RAQDPS documentation](https://eccc-msc.github.io/open-data/msc-data/nwp_raqdps/readme_raqdps_en/).

- **NASA FIRMS**, VIIRS 375 m active fire detections from NOAA-20, taken from the public yearly archive for Canada (no API key needed): `https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2023/viirs-jpss1_2023_Canada.csv`.
- `data/firms/bc-wildfire-2023-08.csv` keeps the 10,163 detections inside 49.0–51.6° N, 121.5–117.5° W from 15 to 19 August 2023 (the McDougall Creek and Bush Creek East fires), unchanged; the matching `.json` records the source and filter. Rebuild it with `.venv\Scripts\python scripts\build_firms_dataset.py`.
- The replay uses 10,072 of them: presumed vegetation fires (`type 0`), skipping static and offshore heat sources.
- Everything replayed is labelled `playback: true`, and check-in summaries start with "Historical replay".
- A detection is a point where a satellite saw heat. It is not a fire perimeter, a damage area, or proof of need.
- Citation: we acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).

## Check-in rule

1. Detections in the same or touching 2 km grid cells form one fire event.
2. Low-confidence detections are stored and shown, but never trigger check-ins.
3. An event with at least 3 nominal- or high-confidence detections sends one check-in to every organization within 10 km (great-circle distance) of any of them.
4. A unique key on (fire event, organization) means a check-in is never created twice; replaying again updates distances and counts.

Check-ins are in-app records only; nothing is emailed or sent anywhere.

## AI features

- **Check-in drafts:** Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash-lite`) writes the check-in question and two to four suggested supplies as structured JSON, which is validated before saving. If Gemini is missing, slow (`GEMINI_TIMEOUT_MS`) or returns something invalid, a template draft is used and `draftSource` says `template`. Drafts are visible only to the organization's staff, and nothing becomes a public request until staff publish it with `confirmed: true`.
- **AI search:** each request's text (item, title, description and organization) is embedded with `gemini-embedding-001` at 768 dimensions and stored in a TiDB `VECTOR(768)` column. A search embeds the query and ranks published requests with `VEC_COSINE_DISTANCE`. Explanations quote the matched request's own stored fields.
- **Fallback search:** if Gemini or vector search is unavailable, plain keyword matching answers instead, and `method` says `keyword_fallback`.
- **Embedding upkeep:** requests are embedded when created or edited, and any still missing are embedded at the next search.

TiDB setup notes, from the official docs:

- Vector search needs TiDB v8.4 or later. Our cluster runs 8.5.3, and TiDB still labels vector types beta.
- There is no vector index. With a few dozen requests an exact scan is instant; a vector index (which uses TiFlash) would only matter at much larger scale.
- TiDB's full-text search, and therefore its built-in keyword + vector hybrid search, is only offered on Starter and Essential clusters in Frankfurt and Singapore. Our cluster is in Oregon (us-west-2), so the search is vector-only. A Frankfurt or Singapore cluster would allow hybrid search.

## Contributions

- Statuses go `pledged` → `user_reported_completed` (by the supporter) → `organization_confirmed` (by the receiving organization's staff).
- Opening a support link records nothing. Only `POST /contributions` records intent, and it is not proof of payment or delivery.
- Only confirmed supplies raise a request's `fulfilled` count.
- Confirmation runs in one transaction with the contribution and request rows locked (`SELECT … FOR UPDATE`). A second confirmation changes nothing, so supplies are never counted twice.

## Sign-in and permissions

- `POST /auth/demo` signs in as a seeded account: the supporter, or the staff account of one organization.
- The server stores only the user id, in an HTTP-only cookie signed with `SESSION_SECRET`.
- Every permission check happens on the server. Staff can change only their own organization's requests, check-ins and contributions, whatever the frontend shows.

## Verification

- `.venv\Scripts\python -m pytest` runs the automated tests on a throwaway in-memory SQLite database (never `.env`, never Gemini). They cover:
  - cross-organization edits being rejected
  - repeated replays not duplicating check-ins
  - repeated confirmation not double-counting
  - the Gemini failure fallback
  - honest search labels
  - the error format
- `scripts\verify_live.py` checks the same flow against the running server, with real TiDB and Gemini, including that data survives a server restart (see the script's docstring).

## Limitations

- **Demo only:** the organizations are fictional (`sample: true`), with `example.org` links. Demo sign-in has no passwords, and there are no real accounts.
- **Out of scope:** payments, shipping, organization vetting and email.
- **One satellite dataset,** replayed; a live FIRMS feed (the `FIRMS_MAP_KEY` setting) is not wired in yet.
- **Schema changes need a reset:** tables are created by `init_db`. There are no migrations, so changing the schema means `init_db --reset`.
