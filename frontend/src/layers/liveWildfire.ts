import { fetchLatestFires } from '../api'
import { wildfireLayer } from './wildfire'
import { smokeLayer } from './smoke'
import type { HazardLayer, LayerContext } from './types'

export const FIRE_REFRESH_MS = 10 * 60_000

/** Replaces observations in place without resetting the camera or mixing in demo replays. */
export async function liveWildfireLayer(context: LayerContext): Promise<HazardLayer> {
  const controller = new AbortController()
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal
  const smoke = smokeLayer({ ...context, signal })
  let active: HazardLayer
  try {
    const first = await fetchLatestFires(signal)
    signal.throwIfAborted()
    active = wildfireLayer(context, [first])
  } catch (error) {
    if (signal.aborted) {
      smoke.destroy()
      throw error
    }
    // One provider being offline must not hide the other provider's current forecast.
    active = {
      summary: { source: 'NASA FIRMS unavailable', updated: 'Smoke forecast provided by ECCC' },
      destroy() {},
    }
  }
  let timer: ReturnType<typeof setTimeout>

  const refresh = async () => {
    try {
      const latest = await fetchLatestFires(signal)
      signal.throwIfAborted()
      active.destroy()
      active = wildfireLayer(context, [latest])
      context.onSummary?.(active.summary)
    } catch {
      if (!signal.aborted) {
        context.onSummary?.({
          ...active.summary,
          updated: `Refresh unavailable · ${active.summary.updated}`,
        })
      }
    } finally {
      if (!signal.aborted) timer = setTimeout(refresh, FIRE_REFRESH_MS)
    }
  }
  timer = setTimeout(refresh, FIRE_REFRESH_MS)
  return {
    get summary() {
      return active.summary
    },
    hitTest: (point) => active.hitTest?.(point) ?? null,
    setForecastTime: smoke.setTime,
    retryForecast: smoke.retry,
    destroy() {
      controller.abort()
      clearTimeout(timer)
      smoke.destroy()
      active.destroy()
    },
  }
}
