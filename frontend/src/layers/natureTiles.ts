import { addProtocol } from 'maplibre-gl'

const API = 'https://planetarycomputer.microsoft.com/api/data/v1'
// A transparent PNG means no observation. The layer supplies a neutral background underneath.
const EMPTY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAABPO1TCQAAAABJRU5ErkJggg=='
let registered = false
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MAX_CACHE_TILES = 512
const CACHE_TTL = 60 * 60 * 1000
const cache = new Map<string, { data: ArrayBuffer; expires: number }>()
let cacheBytes = 0

function forget(path: string) {
  const entry = cache.get(path)
  if (entry) cacheBytes -= entry.data.byteLength
  cache.delete(path)
}

function remember(path: string, data: ArrayBuffer) {
  forget(path)
  if (data.byteLength > MAX_CACHE_BYTES) return
  // Keep our own bytes: MapLibre can transfer/detach the returned buffer.
  cache.set(path, { data: data.slice(0), expires: Date.now() + CACHE_TTL })
  cacheBytes += data.byteLength
  while (cacheBytes > MAX_CACHE_BYTES || cache.size > MAX_CACHE_TILES)
    forget(cache.keys().next().value!)
}

export function monthlyTileUrl(searchId: string): string {
  if (!/^[a-f0-9]{32}$/.test(searchId)) throw new Error('Invalid satellite mosaic.')
  if (!registered) {
    addProtocol('sentinel-month', async ({ url }, controller) => {
      const path = url.replace('sentinel-month://', '')
      if (!/^[a-f0-9]{32}\/\d+\/\d+\/\d+\.png$/.test(path))
        throw new Error('Invalid satellite tile.')
      controller.signal.throwIfAborted()
      const cached = cache.get(path)
      if (cached && cached.expires > Date.now()) {
        cache.delete(path)
        cache.set(path, cached)
        return { data: cached.data.slice(0) }
      }
      forget(path)
      const [id, ...tile] = path.split('/')
      const response = await fetch(
        `${API}/mosaic/${id}/tiles/WebMercatorQuad/${tile.join('/')}?collection=sentinel-2-l2a&assets=visual&pixel_selection=first&scan_limit=200&items_limit=40&exitwhenfull=true`,
        { signal: controller.signal },
      )
      if (!response.ok) throw new Error(`Satellite tiles unavailable (${response.status}).`)
      // Open ocean and areas without a low-cloud scene are explicitly blank.
      const data =
        response.status === 204
          ? Uint8Array.from(atob(EMPTY_PNG), (c) => c.charCodeAt(0)).buffer
          : await response.arrayBuffer()
      controller.signal.throwIfAborted()
      remember(path, data)
      return { data }
    })
    registered = true
  }
  return `sentinel-month://${searchId}/{z}/{x}/{y}.png`
}
