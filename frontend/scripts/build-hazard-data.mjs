// Builds the data files the Explore layers read, from public sources:
//   NASA FIRMS        wildfire heat detections (global, last 24 hours) + the BC August 2023 archive
//   GDACS             flood affected areas and tropical cyclone tracks / wind zones
//   UCDP              conflict events (Candidate Events Dataset, latest month)
//   UN SDG 5.2.1      intimate partner violence prevalence by country (WHO 2023 estimates)
//   Natural Earth     country label points and shapes
// Run from frontend/:  npm run data:hazards   (needs internet; writes public/data/*.json)
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const OUT = new URL('../public/data/', import.meta.url)
const BC_ARCHIVE = new URL('../../backend/data/firms/bc-wildfire-2023-08.csv', import.meta.url)
const NOW = new Date()
const DAY = 86_400_000

async function get(url, type = 'json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AidAtlas data builder (StormHacks 2026)' },
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return type === 'json' ? await response.json() : await response.text()
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  const [header, ...body] = rows
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index]])))
}

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places
const isoDate = (value) => new Date(value).toISOString().replace('.000Z', 'Z')

function distanceKm([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(a))
}

function segmentDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length)) : 0
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

// Douglas–Peucker; rings keep at least four points so they stay valid polygons.
function simplifyLine(points, tolerance) {
  if (points.length <= 4) return points.map(([x, y]) => [round(x), round(y)])
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = 0
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b])
      if (d > max) {
        max = d
        index = i
      }
    }
    if (max > tolerance) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  const out = points.filter((_, i) => keep[i]).map(([x, y]) => [round(x), round(y)])
  return out.length >= 4 ? out : points.map(([x, y]) => [round(x), round(y)])
}

function polygonsOf(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function simplifyPolygons(polygons, tolerance) {
  return polygons
    .map((rings) => rings.map((ring) => simplifyLine(ring, tolerance)))
    .filter((rings) => rings[0].length >= 4)
}

function ringContains(ring, [x, y]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function polygonsContain(polygons, point) {
  return polygons.some(
    ([outer, ...holes]) => ringContains(outer, point) && !holes.some((hole) => ringContains(hole, point)),
  )
}

function ringAreaKm2(ring) {
  // Equal-area approximation on a sphere (good enough for "about 1,200 km²").
  const rad = Math.PI / 180
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] - ring[i][0]) * rad * (2 + Math.sin(ring[j][1] * rad) + Math.sin(ring[i][1] * rad))
  }
  return Math.abs((area * 6371 * 6371) / 2)
}

function areaKm2(polygons) {
  return polygons.reduce(
    (sum, [outer, ...holes]) => sum + ringAreaKm2(outer) - holes.reduce((h, ring) => h + ringAreaKm2(ring), 0),
    0,
  )
}

function bboxOf(points) {
  const lngs = points.map((point) => point[0])
  const lats = points.map((point) => point[1])
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)].map((v) => round(v))
}

// ---------------------------------------------------------------- countries

async function loadCountries() {
  const data = await get(
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  )
  return data.features.map(({ properties: p, geometry }) => {
    const iso3 = [p.ISO_A3, p.ISO_A3_EH, p.ADM0_A3].find((code) => code && code !== '-99')
    const m49 = [p.ISO_N3, p.ISO_N3_EH, p.UN_A3].find((code) => code && code !== '-99')
    const polygons = simplifyPolygons(polygonsOf(geometry), 0.02)
    return {
      iso3,
      m49: m49 ? Number(m49) : null,
      name: p.NAME_LONG || p.ADMIN || p.NAME,
      at: [round(p.LABEL_X, 2), round(p.LABEL_Y, 2)],
      polygons,
      bbox: bboxOf(polygons.flatMap(([outer]) => outer)),
    }
  })
}

function countryAt(countries, point) {
  const hit = countries.find(
    ({ bbox, polygons }) =>
      point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3] && polygonsContain(polygons, point),
  )
  if (hit) return hit.name
  // Coastal and island fires can fall just outside simplified shapes: use the nearest coastline.
  let best = null
  let bestKm = Infinity
  for (const country of countries) {
    for (const [outer] of country.polygons) {
      for (const vertex of outer) {
        const km = distanceKm(vertex, point)
        if (km < bestKm) {
          bestKm = km
          best = country
        }
      }
    }
  }
  return bestKm < 150 ? best.name : null
}

// ---------------------------------------------------------------- fires

// Detections in the same or touching grid cells (about 3 km) form one fire.
function clusterFires(detections, minimum) {
  const CELL = 0.03
  const cells = new Map()
  detections.forEach((detection, index) => {
    const key = `${Math.floor(detection.lng / CELL)},${Math.floor(detection.lat / CELL)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(index)
  })
  const parent = new Map([...cells.keys()].map((key) => [key, key]))
  const find = (key) => {
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)))
      key = parent.get(key)
    }
    return key
  }
  for (const key of cells.keys()) {
    const [i, j] = key.split(',').map(Number)
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const other = `${i + di},${j + dj}`
        if (cells.has(other)) parent.set(find(other), find(key))
      }
  }
  const groups = new Map()
  for (const [key, members] of cells) {
    const root = find(key)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(...members)
  }
  return [...groups.values()].filter((members) => members.length >= minimum)
}

function summarizeFires(detections, groups, start, nameOf) {
  const clusters = groups.map((members) => {
    const points = members.map((index) => detections[index])
    const weight = points.reduce((sum, point) => sum + Math.max(point.frp, 1), 0)
    const center = [
      round(points.reduce((sum, point) => sum + point.lng * Math.max(point.frp, 1), 0) / weight),
      round(points.reduce((sum, point) => sum + point.lat * Math.max(point.frp, 1), 0) / weight),
    ]
    const times = points.map((point) => point.time)
    return {
      center,
      bbox: bboxOf(points.map((point) => [point.lng, point.lat])),
      count: points.length,
      frpTotal: Math.round(points.reduce((sum, point) => sum + point.frp, 0)),
      frpMax: round(Math.max(...points.map((point) => point.frp)), 1),
      first: isoDate(Math.min(...times)),
      last: isoDate(Math.max(...times)),
      members,
    }
  })
  clusters.sort((a, b) => b.frpTotal - a.frpTotal)
  const rows = []
  const out = clusters.map(({ members, ...cluster }, index) => {
    for (const member of members) {
      const point = detections[member]
      rows.push([round(point.lng, 4), round(point.lat, 4), Math.round((point.time - start) / 60_000), round(point.frp, 1), index])
    }
    return { id: `fire-${index}`, ...cluster, place: nameOf(cluster.center) }
  })
  return { clusters: out, detections: rows }
}

function readFirms(rows) {
  return rows
    // The archive writes confidence as n/h/l, the near-real-time files as nominal/high/low.
    .filter((row) => ['n', 'h', 'nominal', 'high'].includes(row.confidence))
    .map((row) => ({
      lng: Number(row.longitude),
      lat: Number(row.latitude),
      frp: Number(row.frp) || 0,
      time: Date.parse(`${row.acq_date}T${row.acq_time.padStart(4, '0').slice(0, 2)}:${row.acq_time.padStart(4, '0').slice(2)}:00Z`),
    }))
    .filter((row) => Number.isFinite(row.lng) && Number.isFinite(row.lat) && Number.isFinite(row.time))
}

async function globalFires(countries) {
  const url = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv'
  const detections = readFirms(parseCsv(await get(url, 'text')))
  const start = Math.min(...detections.map((point) => point.time))
  const end = Math.max(...detections.map((point) => point.time))
  // The largest fires by radiative power; small agricultural burns would cover whole continents.
  const groups = clusterFires(detections, 12)
    .map((members) => ({ members, power: members.reduce((sum, index) => sum + detections[index].frp, 0) }))
    .sort((a, b) => b.power - a.power)
    .slice(0, 160)
    .map(({ members }) => members)
  const summary = summarizeFires(detections, groups, start, (center) => countryAt(countries, center))
  console.log(`fires: ${detections.length} detections, ${summary.clusters.length} fires kept, ${summary.detections.length} points`)
  return {
    title: 'Active fires, last 24 hours',
    source: 'NASA FIRMS · VIIRS NOAA-20 375 m · near real time',
    citation:
      "We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).",
    note: 'Satellite heat detections, not confirmed wildfires. Some may be industrial heat sources.',
    playback: false,
    start: isoDate(start),
    end: isoDate(end),
    ...summary,
  }
}

const BC_PLACES = {
  'West Kelowna': [-119.583, 49.863],
  Kelowna: [-119.496, 49.888],
  'Lake Country': [-119.414, 50.054],
  Peachland: [-119.737, 49.773],
  Summerland: [-119.677, 49.6],
  Penticton: [-119.593, 49.491],
  Oliver: [-119.55, 49.183],
  Osoyoos: [-119.468, 49.032],
  Keremeos: [-119.829, 49.203],
  Princeton: [-120.508, 49.459],
  Vernon: [-119.272, 50.267],
  Lumby: [-118.966, 50.25],
  Armstrong: [-119.197, 50.448],
  Enderby: [-119.141, 50.551],
  'Salmon Arm': [-119.283, 50.7],
  Sicamous: [-118.976, 50.837],
  'Scotch Creek': [-119.455, 50.915],
  Sorrento: [-119.475, 50.883],
  Chase: [-119.685, 50.819],
  'Adams Lake': [-119.66, 51.05],
  Barriere: [-120.127, 51.18],
  Clearwater: [-120.04, 51.65],
  Kamloops: [-120.327, 50.674],
  'Logan Lake': [-120.813, 50.494],
  Merritt: [-120.787, 50.112],
  Ashcroft: [-121.282, 50.725],
  Lytton: [-121.583, 50.231],
  Revelstoke: [-118.196, 51.0],
  Nakusp: [-117.8, 50.24],
  'Grand Forks': [-118.445, 49.03],
  Castlegar: [-117.659, 49.325],
}

async function bcArchive() {
  const detections = readFirms(parseCsv(await readFile(BC_ARCHIVE, 'utf8')))
  const start = Math.min(...detections.map((point) => point.time))
  const end = Math.max(...detections.map((point) => point.time))
  const nearest = (center) =>
    Object.entries(BC_PLACES).reduce((best, [name, at]) =>
      distanceKm(at, center) < distanceKm(best[1], center) ? [name, at] : best,
    )[0]
  const summary = summarizeFires(detections, clusterFires(detections, 6), start, (center) => `near ${nearest(center)}, British Columbia`)
  console.log(`bc archive: ${detections.length} detections, ${summary.clusters.length} fires`)
  return {
    title: 'BC Southern Interior wildfires, 15–19 August 2023',
    source: 'NASA FIRMS · VIIRS NOAA-20 375 m · yearly archive',
    citation:
      "We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).",
    note: 'Recorded satellite heat detections, replayed. Not a confirmed fire perimeter.',
    playback: true,
    start: isoDate(start),
    end: isoDate(end),
    ...summary,
  }
}

// ---------------------------------------------------------------- GDACS floods and cyclones

const gdacsTime = (value) => isoDate(`${value}${value.endsWith('Z') ? '' : 'Z'}`)

// Reported impacts arrive as text like "21,158 [people] Evacuated in Shaanxi Province, China".
function sendaiFacts(details) {
  const sendai = details?.properties?.sendai
  if (!Array.isArray(sendai)) return []
  return sendai
    .map((entry) => /^([\d,.]+)\s*\[([^\]]*)\]\s*(.+?)\s+in\s+(.+)$/.exec((entry.description ?? '').replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .slice(0, 4)
    .map(([, value, unit, what, where]) => ({
      label: what.charAt(0).toUpperCase() + what.slice(1).toLowerCase(),
      value: `${value} ${unit}`.trim(),
      where,
    }))
}

function ringCentroid(ring) {
  const points = ring.slice(0, -1)
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]
}

function trackTime(label, fromDate) {
  // GDACS labels positions like "21/09 03:00 UTC".
  const match = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2})/.exec(label ?? '')
  if (!match) return null
  const from = new Date(fromDate)
  let year = from.getUTCFullYear()
  if (Number(match[2]) < from.getUTCMonth() + 1 - 6) year++
  return Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number(match[3]), Number(match[4]))
}

function cyclone(event, geometry, details) {
  const p = event.properties
  const features = geometry.features ?? []
  const wind = (label) => /km\/h/.test(label ?? '')
  const level = (cls) => (/Red/.test(cls) ? 'red' : /Orange/.test(cls) ? 'orange' : 'green')
  const zones = features
    .filter((f) => /^Poly_(Green|Orange|Red)$/.test(f.properties.Class) && wind(f.properties.polygonlabel))
    .map((f) => ({ level: level(f.properties.Class), label: f.properties.polygonlabel, polygons: simplifyPolygons(polygonsOf(f.geometry), 0.03) }))
  const latestWind = features
    .filter((f) => /^Poly_(Green|Orange|Red)$/.test(f.properties.Class) && !wind(f.properties.polygonlabel))
    .map((f) => ({ level: level(f.properties.Class), label: f.properties.polygonlabel, polygons: simplifyPolygons(polygonsOf(f.geometry), 0.03) }))
  // Track segments are not stored in time order, so each position takes the category of the
  // segment that starts there (the last position: the segment that ends there).
  const lines = features
    .filter((f) => /^Line_Line_\d+$/.test(f.properties.Class) && f.geometry?.type === 'LineString')
    .map((f) => ({ category: f.properties.polygonlabel, start: f.geometry.coordinates[0], end: f.geometry.coordinates.at(-1) }))
  const positions = features
    .filter((f) => /^Point_Polygon_Point_\d+$/.test(f.properties.Class))
    .map((f) => ({
      index: Number(f.properties.Class.split('_').pop()),
      time: trackTime(f.properties.polygonlabel, gdacsTime(p.fromdate)),
      at: ringCentroid(polygonsOf(f.geometry)[0][0]),
    }))
    .filter((position) => position.time)
    .sort((a, b) => a.time - b.time)
  const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const closest = (key, at) => lines.reduce((best, line) => (!best || gap(line[key], at) < gap(best[key], at) ? line : best), null)
  const track = positions.map((position, i) => ({
    time: isoDate(position.time),
    at: [round(position.at[0]), round(position.at[1])],
    category: (i < positions.length - 1 ? closest('start', position.at) : closest('end', position.at))?.category ?? 'TS',
  }))
  const cone = features.find((f) => f.properties.Class === 'Poly_Cones')
  return {
    id: `storm-${p.eventid}`,
    name: p.eventname ? p.eventname : p.name,
    title: p.name,
    countries: (Array.isArray(p.affectedcountries) ? p.affectedcountries : [p.affectedcountries])
      .filter(Boolean)
      .map((country) => country.countryname),
    alert: p.alertlevel,
    from: gdacsTime(p.fromdate),
    to: gdacsTime(p.todate),
    current: p.iscurrent === 'true',
    maxWindKmh: Math.round(p.severitydata?.severity ?? details?.properties?.severitydata?.severity ?? 0),
    severity: p.severitydata?.severitytext ?? '',
    source: `GDACS · ${p.source || 'NOAA'}`,
    url: p.url?.report,
    track,
    zones,
    latestWind,
    cone: cone ? simplifyPolygons(polygonsOf(cone.geometry), 0.03) : [],
  }
}

function flood(event, geometry, details) {
  const p = event.properties
  const features = geometry.features ?? []
  const affected =
    features.find((f) => f.properties.Class === 'Poly_Affected') ?? features.find((f) => f.properties.Class === 'Poly_Global')
  const polygons = simplifyPolygons(polygonsOf(affected?.geometry), 0.01)
  if (!polygons.length) return null
  return {
    id: `flood-${p.eventid}`,
    name: p.name,
    country: p.country,
    alert: p.alertlevel,
    from: gdacsTime(p.fromdate),
    to: gdacsTime(p.todate),
    current: p.iscurrent === 'true',
    center: [round(event.geometry.coordinates[0]), round(event.geometry.coordinates[1])],
    areaKm2: Math.round(areaKm2(polygons)),
    impacts: sendaiFacts(details),
    source: `GDACS · ${p.source || 'GloFAS'}`,
    url: p.url?.report,
    polygons,
  }
}

async function gdacs() {
  const from = new Date(NOW.getTime() - 60 * DAY).toISOString().slice(0, 10)
  const to = NOW.toISOString().slice(0, 10)
  const list = await get(
    `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL&fromDate=${from}&toDate=${to}`,
  )
  const latest = new Map()
  for (const event of list.features ?? []) {
    const key = `${event.properties.eventtype}-${event.properties.eventid}`
    const previous = latest.get(key)
    if (!previous || event.properties.episodeid > previous.properties.episodeid) latest.set(key, event)
  }
  const storms = []
  const floods = []
  for (const event of latest.values()) {
    const p = event.properties
    try {
      const [geometry, details] = await Promise.all([get(p.url.geometry), get(p.url.details).catch(() => null)])
      if (p.eventtype === 'TC') {
        const storm = cyclone(event, geometry, details)
        if (storm.track.length >= 2) storms.push(storm)
      } else {
        const area = flood(event, geometry, details)
        if (area) floods.push(area)
      }
    } catch (error) {
      console.warn(`skipped ${p.eventtype} ${p.eventid}: ${error.message}`)
    }
  }
  storms.sort((a, b) => b.to.localeCompare(a.to))
  floods.sort((a, b) => b.to.localeCompare(a.to))
  console.log(`gdacs: ${storms.length} cyclones, ${floods.length} floods`)
  return { storms, floods, from, to }
}

// ---------------------------------------------------------------- UCDP conflict events

async function conflict() {
  // Candidate datasets are released monthly: GEDEvent_v26_0_8.csv is August 2026.
  let rows = null
  let label = ''
  let version = ''
  for (let back = 1; back <= 4 && !rows; back++) {
    const month = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - back, 1))
    version = `${String(month.getUTCFullYear()).slice(2)}_0_${month.getUTCMonth() + 1}`
    try {
      rows = parseCsv(await get(`https://ucdp.uu.se/downloads/candidateged/GEDEvent_v${version}.csv`, 'text'))
      label = month.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    } catch {
      rows = null
    }
  }
  if (!rows) throw new Error('No UCDP candidate dataset found for the last four months')
  const areas = new Map()
  const events = []
  for (const row of rows) {
    const at = [Number(row.longitude), Number(row.latitude)]
    if (!Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue
    const country = row.country.replace(/\s*\(.*\)$/, '')
    const region = row.adm_1 ?? ''
    const key = `${country}|${region}`
    if (!areas.has(key)) areas.set(key, { name: region ? `${region}, ${country}` : country, country, points: [], events: 0, deaths: 0, civilians: 0, conflicts: new Map(), from: row.date_start, to: row.date_end })
    const area = areas.get(key)
    const deaths = Number(row.best) || 0
    area.points.push(at)
    area.events++
    area.deaths += deaths
    area.civilians += Number(row.deaths_civilians) || 0
    area.conflicts.set(row.conflict_name, (area.conflicts.get(row.conflict_name) ?? 0) + 1)
    if (row.date_start < area.from) area.from = row.date_start
    if (row.date_end > area.to) area.to = row.date_end
    events.push({ at, deaths, type: Number(row.type_of_violence), key })
  }
  const ordered = [...areas.entries()].sort((a, b) => b[1].events - a[1].events)
  const index = new Map(ordered.map(([key], i) => [key, i]))
  console.log(`ucdp ${label}: ${events.length} events in ${ordered.length} areas`)
  return {
    title: `Conflict events, ${label}`,
    source: `UCDP Candidate Events Dataset v${version.replaceAll('_', '.')} (preliminary)`,
    citation: 'Uppsala Conflict Data Program (UCDP), Department of Peace and Conflict Research, Uppsala University. CC BY 4.0.',
    note: 'Preliminary event data. Each event involved at least one reported death or targeted violence; numbers are best estimates.',
    month: label,
    areas: ordered.map(([, area]) => ({
      name: area.name,
      country: area.country,
      center: [
        round(area.points.reduce((sum, point) => sum + point[0], 0) / area.points.length),
        round(area.points.reduce((sum, point) => sum + point[1], 0) / area.points.length),
      ],
      events: area.events,
      deaths: area.deaths,
      civilians: area.civilians,
      conflicts: [...area.conflicts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name),
      from: area.from.slice(0, 10),
      to: area.to.slice(0, 10),
    })),
    events: events.map((event) => [round(event.at[0]), round(event.at[1]), event.deaths, event.type, index.get(event.key)]),
  }
}

// ---------------------------------------------------------------- SDG 5.2.1 partner violence

async function partnerViolence(countries) {
  const data = await get('https://unstats.un.org/sdgapi/v1/sdg/Series/Data?seriesCode=VC_VAW_MARR&pageSize=5000')
  const byCountry = new Map()
  for (const row of data.data) {
    const code = Number(row.geoAreaCode)
    if (!byCountry.has(code)) byCountry.set(code, { year: row.timePeriodStart })
    const entry = byCountry.get(code)
    const age = row.dimensions?.Age
    if (age === '15+' || age === '15-49') {
      entry[age] = { value: Number(row.value), low: Number(row.lowerBound), high: Number(row.upperBound) }
    }
  }
  const out = []
  for (const country of countries) {
    const entry = country.m49 !== null && byCountry.get(country.m49)
    if (!entry?.['15+']) continue
    out.push({
      iso3: country.iso3,
      name: country.name,
      at: country.at,
      year: entry.year,
      all: entry['15+'],
      young: entry['15-49'] ?? null,
    })
  }
  out.sort((a, b) => b.all.value - a.all.value)
  console.log(`sdg 5.2.1: ${out.length} countries`)
  return {
    title: 'Intimate partner violence in the past 12 months',
    measure:
      'Ever-partnered women and girls who experienced physical and/or sexual violence by a current or former intimate partner in the previous 12 months',
    source: 'UN SDG Indicator 5.2.1 · WHO Violence Against Women Prevalence Estimates 2023',
    note: 'Modelled survey estimates with uncertainty ranges. Not counts of reported cases.',
    year: out[0]?.year ?? 2023,
    countries: out,
  }
}

// ---------------------------------------------------------------- main

await mkdir(OUT, { recursive: true })
const countries = await loadCountries()
console.log(`natural earth: ${countries.length} countries`)

const [fires, archive, hazards, war, violence] = await Promise.all([
  globalFires(countries),
  bcArchive(),
  gdacs(),
  conflict(),
  partnerViolence(countries),
])

const builtAt = isoDate(NOW)
await writeFile(new URL('fires-latest.json', OUT), JSON.stringify({ builtAt, ...fires }))
await writeFile(new URL('fires-bc-2023-08.json', OUT), JSON.stringify({ builtAt, ...archive }))
await writeFile(new URL('gdacs.json', OUT), JSON.stringify({ builtAt, source: 'GDACS — Global Disaster Alert and Coordination System (EC JRC / UN OCHA)', ...hazards }))
await writeFile(new URL('conflict.json', OUT), JSON.stringify({ builtAt, ...war }))
await writeFile(new URL('partner-violence.json', OUT), JSON.stringify({ builtAt, ...violence }))
console.log('wrote public/data/*.json')
