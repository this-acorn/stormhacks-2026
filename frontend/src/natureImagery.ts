// EOxCloudless yearly mosaics, checked against the provider's actual world tiles.
// 2026 is not published yet; add a year here once its tiles exist.
export const NATURE_YEARS = [2020, 2021, 2022, 2023, 2024, 2025] as const
export const LATEST_NATURE_YEAR = NATURE_YEARS[NATURE_YEARS.length - 1]

export interface ImageryStatus {
  requested: number
  displayed: number
  loading: boolean
  error: string
}

export function natureTiles(year: number): string {
  if (!NATURE_YEARS.some((entry) => entry === year))
    throw new Error('Imagery is unavailable for this year.')
  return `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg`
}

export function natureAttribution(year: number): string {
  return `<a href="https://cloudless.eox.at/">EOxCloudless</a> by EOX IT Services GmbH · Contains modified Copernicus Sentinel data ${year} · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>`
}
