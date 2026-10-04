// Builds public/data/field-organizations.json: the humanitarian organizations working on the ground
// (UN agencies, international and national NGOs, Red Cross / Red Crescent), by province, from
// OCHA's "Who does What Where" (3W) data as published by HDX HAPI.
// Provinces are placed with geoBoundaries (current boundaries) and Natural Earth as a fallback.
// For the BC wildfire area, which no UN response covers: local registered charities from the
// Canada Revenue Agency's List of charities, placed by town with OpenStreetMap (cached).
// Nature: IUCN member organizations worldwide (from IUCN's public members map) and Canadian
// conservation and wildlife charities from the same CRA list.
// Run from frontend/:  node scripts/build-field-organizations.mjs   (needs internet)
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const OUT = new URL('../public/data/field-organizations.json', import.meta.url)
const PRESENCE =
  'https://data.humdata.org/dataset/5b89fc55-586d-485f-8526-3c7a9a1b0d90/resource/e3a18c4c-ec1b-457e-9f60-cee283c04e0c/download/hdx_hapi_operational_presence_global.csv'
const NATURAL_EARTH =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'

// Which coordination sectors count as working on each Explore layer.
const LAYER_SECTORS = {
  domestic_violence: ['PRO-GBV'],
  education: ['EDU'],
  conflict: ['PRO', 'PRO-CPN', 'PRO-MIN', 'PRO-HLP', 'FSC', 'HEA', 'NUT', 'CCM', 'Cash', 'Multi', 'LOG', 'TEL'],
  flood: ['SHL', 'WSH', 'ERY'],
  storm: ['SHL', 'WSH', 'ERY'],
}

async function get(url, type = 'json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AidAtlas data builder (StormHacks 2026)' },
        signal: AbortSignal.timeout(180_000),
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
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key.replace(/^﻿/, ''), values[index]])))
}

const round = (value) => Math.round(value * 1000) / 1000

function normalize(name) {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(province|state|governorate|region|department|district|prefecture|county|oblast)\b/g, '')
    .replace(/[^a-z]/g, '')
}

// Area-weighted centre of the largest outer ring: a fair label point for a province.
function centreOf(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let best = null
  let bestArea = 0
  for (const [ring] of polygons) {
    let area = 0
    let x = 0
    let y = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
      area += cross
      x += (ring[j][0] + ring[i][0]) * cross
      y += (ring[j][1] + ring[i][1]) * cross
    }
    if (Math.abs(area) > bestArea && area !== 0) {
      bestArea = Math.abs(area)
      best = [x / (3 * area), y / (3 * area)]
    }
  }
  return best
}

// Where the 3W uses English and the boundaries use the official language.
const ALIASES = {
  HTI: { north: 'nord', northeast: 'nordest', northwest: 'nordouest', south: 'sud', southeast: 'sudest', west: 'ouest' },
}

function lookup(index, name) {
  const key = normalize(name)
  if (!key) return null
  if (index.has(key)) return index.get(key)
  for (const [candidate, at] of index)
    if (key.length >= 4 && candidate.length >= 4 && (candidate.includes(key) || key.includes(candidate))) return at
  return null
}

const presence = parseCsv(await get(PRESENCE, 'text')).filter((row) => row.org_name && row.sector_code)
const countries = [...new Set(presence.map((row) => row.location_code))]
console.log(`presence: ${presence.length} rows in ${countries.length} countries`)

const natural = await get(NATURAL_EARTH)
const naturalByCountry = new Map()
for (const { properties: p } of natural.features) {
  if (!naturalByCountry.has(p.adm0_a3)) naturalByCountry.set(p.adm0_a3, new Map())
  for (const name of [p.name, p.name_en, ...(p.name_alt ?? '').split('|')])
    if (name) naturalByCountry.get(p.adm0_a3).set(normalize(name), [round(p.longitude), round(p.latitude)])
}

async function shapesIndex(iso3, level) {
  const meta = await get(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/${level}/`)
  const shapes = await get(meta.simplifiedGeometryGeoJSON)
  const index = new Map()
  for (const feature of shapes.features) {
    const centre = centreOf(feature.geometry)
    if (centre) index.set(normalize(feature.properties.shapeName), [round(centre[0]), round(centre[1])])
  }
  return { meta, index }
}

// Districts listed under each province, for provinces too new to be on any map: the province is
// placed at the middle of its districts.
const districts = new Map()
for (const row of presence) {
  if (!row.admin2_name) continue
  const key = `${row.location_code}|${row.admin1_code || row.admin1_name}`
  if (!districts.has(key)) districts.set(key, new Set())
  districts.get(key).add(row.admin2_name)
}
const districtIndexes = new Map()
async function fromDistricts(iso3, province) {
  const names = districts.get(`${iso3}|${province}`)
  if (!names) return null
  if (!districtIndexes.has(iso3))
    districtIndexes.set(iso3, await shapesIndex(iso3, 'ADM2').then((r) => r.index).catch(() => new Map()))
  const found = [...names].map((name) => lookup(districtIndexes.get(iso3), name)).filter(Boolean)
  if (!found.length) return null
  return [
    round(found.reduce((sum, c) => sum + c[0], 0) / found.length),
    round(found.reduce((sum, c) => sum + c[1], 0) / found.length),
  ]
}

const boundaries = new Map()
const countryNames = new Map()
const countryCentres = new Map()
for (const iso3 of countries) {
  const index = new Map()
  try {
    const meta = await get(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`)
    countryNames.set(iso3, meta.boundaryName)
    const shapes = await get(meta.simplifiedGeometryGeoJSON)
    const centres = []
    for (const feature of shapes.features) {
      const centre = centreOf(feature.geometry)
      if (!centre) continue
      centres.push(centre)
      index.set(normalize(feature.properties.shapeName), [round(centre[0]), round(centre[1])])
    }
    countryCentres.set(iso3, [
      round(centres.reduce((sum, c) => sum + c[0], 0) / centres.length),
      round(centres.reduce((sum, c) => sum + c[1], 0) / centres.length),
    ])
  } catch (error) {
    console.warn(`geoBoundaries ${iso3}: ${error.message}`)
  }
  boundaries.set(iso3, index)
}

// One entry per organization, keeping the most common spelling of its name.
const spellings = new Map()
for (const row of presence) {
  const key = (row.org_acronym || row.org_name).trim().toLowerCase()
  if (!spellings.has(key)) spellings.set(key, { names: new Map(), acronym: row.org_acronym.trim(), type: row.org_type_description || 'Other' })
  const entry = spellings.get(key)
  entry.names.set(row.org_name.trim(), (entry.names.get(row.org_name.trim()) ?? 0) + 1)
}
// Some 3W files cut long names short; UN agencies are better known by their acronyms anyway.
const UN_NAMES = [
  ['International Organization for M', 'IOM'],
  ["United Nations Children", 'UNICEF'],
  ['World Food Program', 'WFP'],
  ['UN Refugee Agency', 'UNHCR'],
  ['United Nations High Commissioner for Refugees', 'UNHCR'],
  ['United Nations Population Fund', 'UNFPA'],
  ['World Health Organization', 'WHO'],
  ['Food and Agriculture Organization', 'FAO'],
  ['United Nations Development Program', 'UNDP'],
  ['United Nations Office for the Coordination', 'OCHA'],
  ['United Nations Office for Project Services', 'UNOPS'],
  ['United Nations Mine Action', 'UNMAS'],
  ['United Nations Human Settlements', 'UN-Habitat'],
  ['UN Women', 'UN Women'],
  ['United Nations Entity for Gender Equality', 'UN Women'],
]
// French-language 3W files use French acronyms for the same agencies.
const FRENCH_ACRONYMS = { OIM: 'IOM', 'ONU Femmes': 'UN Women', PAM: 'WFP', HCR: 'UNHCR', OMS: 'WHO' }
const organizations = []
const orgIndex = new Map()
for (const [key, entry] of spellings) {
  orgIndex.set(key, organizations.length)
  const name = [...entry.names.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const known = UN_NAMES.find(([prefix]) => name.startsWith(prefix))?.[1]
  const raw = entry.acronym && entry.acronym !== name ? entry.acronym : (known ?? '')
  const acronym = FRENCH_ACRONYMS[raw] ?? raw
  organizations.push({ name, acronym, type: entry.type })
}

const areas = new Map()
let unplaced = 0
for (const row of presence) {
  const region = row.admin1_name || ''
  for (const [layer, sectors] of Object.entries(LAYER_SECTORS)) {
    if (!sectors.includes(row.sector_code)) continue
    const key = `${layer}|${row.location_code}|${row.admin1_code || region}`
    if (!areas.has(key)) {
      const alias = ALIASES[row.location_code]?.[normalize(region)] ?? region
      let at = region
        ? (lookup(boundaries.get(row.location_code) ?? new Map(), alias) ??
          lookup(naturalByCountry.get(row.location_code) ?? new Map(), alias) ??
          (await fromDistricts(row.location_code, row.admin1_code || region)))
        : null
      const placed = !!at
      at ??= countryCentres.get(row.location_code)
      if (!at) continue
      if (!placed) unplaced++
      areas.set(key, {
        layer,
        country: countryNames.get(row.location_code) ?? row.location_code,
        region,
        at,
        placed,
        orgs: new Set(),
        sectors: new Set(),
        from: row.reference_period_start,
        to: row.reference_period_end,
      })
    }
    const area = areas.get(key)
    area.orgs.add(orgIndex.get((row.org_acronym || row.org_name).trim().toLowerCase()))
    area.sectors.add(row.sector_name)
    if (row.reference_period_start < area.from) area.from = row.reference_period_start
    if (row.reference_period_end > area.to) area.to = row.reference_period_end
  }
}

// ---------------------------------------------------------------- BC wildfire area charities

const CHARITIES = 'https://open.canada.ca/data/dataset/80c00cdb-1358-415c-bb8b-0de7f12675b8/resource'
const CHARITY_IDENT = `${CHARITIES}/694fdc72-eae4-4ee0-83eb-832ab7b230e3/download/ident_2024_updated.csv`
const CHARITY_WEB = `${CHARITIES}/e3567bb5-5d98-44d0-b0e8-9cdd3732c9e4/download/weburl_2024_updated.csv`
const GEOCODE_CACHE = new URL('./geocode-cache.json', import.meta.url)
// The fire region of the BC replay, with a margin.
const FIRE_REGION = [-121.9, 48.95, -117.2, 51.9]
// Category / sub-category codes from the CRA codes list. Shelters for women fleeing violence
// (0160-0002) are deliberately absent: their locations are never mapped.
const CHARITY_GROUPS = {
  '0120-0002': 'Disaster relief and rescue',
  '0120-0006': 'Disaster relief and rescue',
  '0120-0003': 'Volunteer fire departments',
  '0001-0004': 'Food banks and meals',
  '0001-0010': 'Food banks and meals',
  '0001-0006': 'Shelter and housing',
  '0001-0009': 'Shelter and housing',
  '0001-0012': 'Clothing and household items',
  '0001-0013': 'Clothing and household items',
  '0160-0018': 'Volunteer centres',
}
// Some violence shelters are registered as general shelters; their names or websites give them away.
const PROTECTED = /women|transition house|safe ?(house|home|haven)|violence|abuse|sexual assault/i

const titleCase = (text) =>
  text.toLowerCase().replace(/(^|[\s\-/'(])([a-z])/g, (_, start, letter) => start + letter.toUpperCase())

// Registered names are often all capitals; keep acronyms such as BC and SPCA as they are.
const readableName = (name) =>
  name === name.toUpperCase()
    ? titleCase(name).replace(/\b(Bc|Spca|Ymca|Ywca|Cmha|Sar|Okanagan-Similkameen)\b/g, (word) =>
        word === 'Okanagan-Similkameen' ? word : word.toUpperCase(),
      )
    : name

const charityRows = parseCsv(await get(CHARITY_IDENT, 'text')).filter(
  (row) => row.Province === 'BC' && CHARITY_GROUPS[`${row.Category}-${row['Sub Category']}`],
)
const websites = new Map()
for (const row of parseCsv(await get(CHARITY_WEB, 'text'))) {
  const url = (row['Contact URL'] ?? '').trim()
  if (url && !websites.has(row['BN/NE']))
    websites.set(row['BN/NE'], /^https?:/i.test(url) ? url : `https://${url.toLowerCase()}`)
}

let geocodes = {}
try {
  geocodes = JSON.parse(await readFile(GEOCODE_CACHE, 'utf8'))
} catch {
  geocodes = {}
}
const towns = [...new Set(charityRows.map((row) => row.City.trim().toUpperCase()))]
for (const town of towns) {
  if (town in geocodes) continue
  // OpenStreetMap's usage policy: at most one request a second, with an identifying user agent.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  try {
    const found = await get(
      `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(town)}&state=British%20Columbia&country=Canada&format=json&limit=1`,
    )
    geocodes[town] = found[0] ? [round(Number(found[0].lon)), round(Number(found[0].lat))] : null
  } catch {
    geocodes[town] = null
  }
}
await writeFile(GEOCODE_CACHE, JSON.stringify(geocodes, null, 1))

const inRegion = ([lng, lat]) =>
  lng >= FIRE_REGION[0] && lat >= FIRE_REGION[1] && lng <= FIRE_REGION[2] && lat <= FIRE_REGION[3]
const charityTowns = new Map()
for (const row of charityRows) {
  const town = row.City.trim().toUpperCase()
  const at = geocodes[town]
  if (!at || !inRegion(at)) continue
  if (PROTECTED.test(`${row['Legal Name']} ${row['Account Name']} ${websites.get(row.BN) ?? ''}`)) continue
  if (!charityTowns.has(town)) charityTowns.set(town, { at, orgs: [], groups: new Set() })
  const group = CHARITY_GROUPS[`${row.Category}-${row['Sub Category']}`]
  const entry = charityTowns.get(town)
  entry.orgs.push(organizations.length)
  entry.groups.add(group)
  organizations.push({
    name: readableName((row['Account Name'] || row['Legal Name']).trim()),
    acronym: '',
    type: group,
    bn: row.BN,
    url: websites.get(row.BN),
  })
}
for (const [town, entry] of charityTowns)
  areas.set(`wildfire|CAN|${town}`, {
    layer: 'wildfire',
    country: 'British Columbia',
    region: titleCase(town),
    at: entry.at,
    placed: true,
    orgs: new Set(entry.orgs),
    sectors: new Set(entry.groups),
    from: '2024-01-01',
    to: '2024-12-31',
    source: 'Canada Revenue Agency · List of charities',
    period: '2024 filings',
    note: 'Registered charities in this town working on relief, food, shelter, emergency response or volunteering. Listed by their registered category; not confirmed as responding to the fires.',
  })
const charityCount = [...charityTowns.values()].reduce((sum, town) => sum + town.orgs.length, 0)
console.log(`bc charities: ${charityTowns.size} towns in the fire region, ${charityCount} charities`)

// ---------------------------------------------------------------- Nature: conservation organizations

// IUCN publishes its members' locations on its public members map; the page embeds them.
const IUCN_DIRECTORY = 'https://iucn.org/our-union/members/members-directory'
const IUCN_TYPES = {
  'National NGO': 'National NGO',
  'International NGO': 'International NGO',
  State: 'Government',
  'Government Agency with State Member': 'Government',
  'Government Agency without State Member': 'Government',
  'Subnational Government': 'Government',
  'Indigenous peoples organisations': "Indigenous peoples' organizations",
  Affiliate: 'IUCN affiliates',
}
const unescape = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
const htmlField = (html, name) => {
  const match = new RegExp(`class="member-map-full__${name}">([\\s\\S]*?)</div>`).exec(html)
  return match ? unescape(match[1]) : ''
}
const page = await get(IUCN_DIRECTORY, 'text')
const settings = JSON.parse(
  /<script type="application\/json" data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/.exec(page)[1],
)
const pins = Object.values(settings.unep_map ?? {}).flatMap((map) => map.pinData ?? [])
// Members within about 50 km of each other share one marker.
const iucnCells = new Map()
for (const pin of pins) {
  const [lng, lat] = pin.coordinates.map(Number)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
  const key = `${Math.round(lng * 2) / 2},${Math.round(lat * 2) / 2}`
  const country = htmlField(pin.popup, 'country')
  if (!iucnCells.has(key)) iucnCells.set(key, { points: [], orgs: new Set(), countries: new Set(), types: new Set() })
  const cell = iucnCells.get(key)
  const type = IUCN_TYPES[htmlField(pin.popup, 'category')] ?? 'IUCN affiliates'
  cell.points.push([lng, lat])
  cell.countries.add(country)
  cell.types.add(type)
  cell.orgs.add(organizations.length)
  organizations.push({ name: htmlField(pin.popup, 'title'), acronym: '', type })
}
for (const [key, cell] of iucnCells)
  areas.set(`nature|IUCN|${key}`, {
    layer: 'nature',
    country: [...cell.countries].join(' / '),
    region: '',
    at: [
      round(cell.points.reduce((sum, p) => sum + p[0], 0) / cell.points.length),
      round(cell.points.reduce((sum, p) => sum + p[1], 0) / cell.points.length),
    ],
    placed: true,
    orgs: cell.orgs,
    sectors: cell.types,
    from: '',
    to: '',
    source: 'IUCN Members directory',
    period: 'current members',
    note: 'Members of IUCN, the International Union for Conservation of Nature: government agencies, NGOs and Indigenous peoples\u2019 organizations working on conservation.',
  })
console.log(`iucn: ${pins.length} members in ${iucnCells.size} places`)

// Canadian conservation and wildlife charities, nationwide, by town.
const PROVINCES = {
  BC: 'British Columbia',
  AB: 'Alberta',
  SK: 'Saskatchewan',
  MB: 'Manitoba',
  ON: 'Ontario',
  QC: 'Quebec',
  NB: 'New Brunswick',
  NS: 'Nova Scotia',
  PE: 'Prince Edward Island',
  NL: 'Newfoundland and Labrador',
  YT: 'Yukon',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
}
const NATURE_GROUPS = {
  '0170-0001': 'Conservation and habitat',
  '0170-0002': 'Pollution reduction',
  '0170-0003': 'Environmental solutions',
  '0170-0099': 'Conservation and habitat',
  '0180-0003': 'Wildlife protection',
}
const natureRows = (await get(CHARITY_IDENT, 'text').then(parseCsv)).filter(
  (row) => PROVINCES[row.Province] && NATURE_GROUPS[`${row.Category}-${row['Sub Category']}`],
)
const townKey = (row) => `${row.City.trim().toUpperCase()}|${row.Province}`
const pending = [...new Set(natureRows.map(townKey))].filter(
  (key) => !(key in geocodes) && !(key.endsWith('|BC') && key.split('|')[0] in geocodes),
)
console.log(`nature charities: ${natureRows.length}, towns to look up: ${pending.length} (about ${Math.ceil(pending.length * 1.1 / 60)} min)`)
for (const key of pending) {
  const [town, province] = key.split('|')
  await new Promise((resolve) => setTimeout(resolve, 1100))
  try {
    const found = await get(
      `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(town)}&state=${encodeURIComponent(PROVINCES[province])}&country=Canada&format=json&limit=1`,
    )
    geocodes[key] = found[0] ? [round(Number(found[0].lon)), round(Number(found[0].lat))] : null
  } catch {
    geocodes[key] = null
  }
}
await writeFile(GEOCODE_CACHE, JSON.stringify(geocodes, null, 1))
const natureTowns = new Map()
for (const row of natureRows) {
  const key = townKey(row)
  const at = geocodes[key] ?? (row.Province === 'BC' ? geocodes[row.City.trim().toUpperCase()] : null)
  if (!at) continue
  if (!natureTowns.has(key)) natureTowns.set(key, { at, row, orgs: new Set(), groups: new Set() })
  const group = NATURE_GROUPS[`${row.Category}-${row['Sub Category']}`]
  const town = natureTowns.get(key)
  town.orgs.add(organizations.length)
  town.groups.add(group)
  organizations.push({
    name: readableName((row['Account Name'] || row['Legal Name']).trim()),
    acronym: '',
    type: group,
    bn: row.BN,
    url: websites.get(row.BN),
  })
}
for (const [key, town] of natureTowns)
  areas.set(`nature|CAN|${key}`, {
    layer: 'nature',
    country: PROVINCES[town.row.Province],
    region: titleCase(town.row.City.trim()),
    at: town.at,
    placed: true,
    orgs: town.orgs,
    sectors: town.groups,
    from: '',
    to: '',
    source: 'Canada Revenue Agency · List of charities',
    period: '2024 filings',
    note: 'Registered charities in this town working on conservation, habitat, wildlife or pollution, by their registered category.',
  })
console.log(`nature charities placed: ${natureTowns.size} towns`)

const out = [...areas.values()].map((area) => ({
  ...area,
  orgs: [...area.orgs],
  sectors: [...area.sectors].filter(Boolean),
}))
console.log(`areas: ${out.length} (${unplaced} placed at the country centre), organizations: ${organizations.length}`)
for (const layer of Object.keys(LAYER_SECTORS))
  console.log(`  ${layer}: ${out.filter((area) => area.layer === layer).length} areas`)

await mkdir(new URL('.', OUT), { recursive: true })
await writeFile(
  OUT,
  JSON.stringify({
    builtAt: new Date().toISOString().replace('.000Z', 'Z'),
    title: 'Organizations working on the ground',
    source: 'OCHA Who does What Where (3W) · HDX HAPI',
    note: 'Organizations that report activities in this area to OCHA. Presence, not a confirmed request for help.',
    organizations,
    areas: out,
  }),
)
console.log('wrote public/data/field-organizations.json')
