# AidAtlas frontend

React + TypeScript + Vite + MapLibre. Default mode uses clearly labelled local demo data.

```powershell
npm install
npm run dev
```

Use the localhost URL printed by Vite. For Claude's backend, copy `.env.example` to `.env.local`, set `VITE_API_MODE=live`, and restart Vite. `/api` is proxied to `http://127.0.0.1:8000`; the shared contract is in `../backend/API_CONTRACT.md`. Never put backend secrets in `VITE_` values.

```powershell
npm run build
npm run lint
npm test
```

Tests cover API contracts and React interactions using jsdom. The map is substituted in screen tests; WebGL rendering, responsive layouts, and live Python integration require browser verification.

Satellite imagery: EOxCloudless / modified Copernicus Sentinel data 2024, CC BY-NC-SA 4.0; historical NASA GIBS VIIRS night lights 2012. Required credits remain visible on the map. [EOX usage conditions](https://cloudless.eox.at/documentation/license) apply; commercial deployment needs suitable imagery licensing. Contributions are pledges only: no payment, shipping or booking is processed.

## Education

Education shows the share of **primary and lower secondary school-age children** who are not enrolled in school. Upper secondary ages are excluded; there is no compulsory-education filter. It uses UNESCO UIS's published **combined** indicators `ROFST.1T2.CP` (percentage) and `OFST.1T2.CP` (number), joined by country and year, from the latest complete SDG/OPRI national release advertised on the official bulk-download page. Neither an unweighted average of the two school stages nor a blend of different years is used. Same-year official age ranges appear where available.

The map uses each country's latest valid observation; there is no global year slider or playback. Data years differ, and both the hover card and country details show the actual observation year separately from the release date and last successful update check. Rate, count and age range always come from the same record, with no borrowing of missing counts from earlier years. Gray means the country has no valid observation in the dataset, not zero. Observations more than five years old are labelled historical in country details and hover text.

“Latest” means the latest observation available for each country in the current validated UIS release. Education statistics come exclusively from UNESCO UIS's common international datasets; there are no country-specific ministry connectors. Release dates, source-check timestamps and observation years are separate. The UI uses “Data year” and identifies the UIS release; it does not infer that a country failed to report a newer year.

Clicking a country opens its details on the left: the published count, 100 illustrative lights rounded to the nearest whole percent, and a small historical trend with gaps. A country selector supports keyboard navigation and shows each country's latest reporting year. Closing the details returns focus to the selector. The globe stops rotating while Education is open. Existing Education organizations remain available through the Organizations control.

The frontend reads `GET /api/v1/hazards/education` in both demo and live organization modes, then polls the API once a minute while Education is open. New data update the map and selected country in place without moving the camera. The API starts a background updater with the server, checks the official release page daily, and retries failed checks hourly. Conditional archive downloads detect revisions within an existing release as well as newly dated releases. A complete, validated release replaces the old cache atomically. Failures retain the last good data and its real check timestamp; partial releases, release rollbacks, invalid indicators and severe coverage loss are rejected.

Automatic updates require the API server to be running, outbound HTTPS, and a writable `backend/.cache/education` directory. No browser needs to remain open. Persistent storage preserves updates across server restarts; otherwise the server starts from `backend/data/education.json` and checks again when due. No redeployment is needed for new UIS data. When the API is unavailable, the frontend uses `public/data/education.json` with an explicit offline label and retries automatically; a static-only deployment cannot refresh itself.

Refresh both bundled seeds manually with `py -3.12 scripts/build-education-data.py` from this directory (Python standard library only). It discovers the release date automatically, revalidates downloads, and uses the same parser as the server. The fixed Natural Earth geometry remains in `public/data/education-countries.json`. The builder excludes non-applicable, suppressed, low-reliability and invalid values, preserves estimate qualifiers, and records archive hashes and source URLs. A country's official age range can change over time; the statistics do not explain why a child is out of school or measure daily attendance.

On 2026-10-04, fresh downloads confirmed that the advertised release was February 2026 and its source values were unchanged: 197 countries/territories with data, 2,826 observations. Latest years were 2025 for 13 countries/territories, 2024 for 107, 2023 for 39, and 2022 or earlier for 38. Updating the source does not invent a 2025/2026 observation where UIS has not published one for this indicator.

Sources: [UNESCO UIS bulk downloads](https://databrowser.uis.unesco.org/resources/bulk), licensed under [CC BY-SA 3.0 IGO](https://creativecommons.org/licenses/by-sa/3.0/igo/); [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) v5.1.2 country boundaries, public domain. The extracted education dataset retains the UIS license and attribution; the boundary file retains the source geometries with only nonessential properties removed. Tiny territories without geometry at this scale are accessible through the country selector when UIS publishes their data.
