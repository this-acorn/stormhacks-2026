import { fetchLatestEducation } from '../api'
import type { EducationData, EducationGeometry } from '../educationData'
import { loadData } from './data'
import { educationLayer } from './education'
import type { HazardLayer, LayerContext } from './types'

// The API serves its cached result; only the backend downloads UIS archives, once a day.
export const EDUCATION_POLL_MS = 60_000

export async function liveEducationLayer(context: LayerContext): Promise<HazardLayer> {
  const controller = new AbortController()
  const signal = context.signal
    ? AbortSignal.any([controller.signal, context.signal])
    : controller.signal
  const initial = async (): Promise<EducationData> => {
    try {
      return await fetchLatestEducation(signal)
    } catch (error) {
      signal.throwIfAborted()
      const bundled = await loadData<EducationData>('education')
      signal.throwIfAborted()
      if (!bundled.countries?.length) throw error
      return {
        ...bundled,
        updates: { state: 'offline', automatic: false, checkedAt: bundled.checkedAt ?? null },
      }
    }
  }
  const results = await Promise.allSettled([
    initial(),
    loadData<EducationGeometry>('education-countries'),
  ])
  signal.throwIfAborted()
  const [first, geometry] = results
  if (first.status === 'rejected') throw first.reason
  if (geometry.status === 'rejected') throw geometry.reason
  let data = first.value
  const active = educationLayer(context, data, geometry.value)
  let timer: ReturnType<typeof setTimeout>
  const refresh = async () => {
    try {
      const next = await fetchLatestEducation(signal)
      signal.throwIfAborted()
      data = next
      active.updateEducationData(data)
    } catch {
      if (!signal.aborted) {
        data = {
          ...data,
          updates: {
            state: 'offline',
            automatic: false,
            checkedAt: data.updates?.checkedAt ?? data.checkedAt ?? null,
          },
        }
        active.updateEducationData(data)
      }
    } finally {
      if (!signal.aborted) timer = setTimeout(refresh, EDUCATION_POLL_MS)
    }
  }
  timer = setTimeout(refresh, EDUCATION_POLL_MS)
  return {
    get summary() {
      return active.summary
    },
    hitTest: active.hitTest,
    focus: active.focus,
    selectEducationCountry: active.selectEducationCountry,
    destroy() {
      controller.abort()
      clearTimeout(timer)
      active.destroy()
    },
  }
}
