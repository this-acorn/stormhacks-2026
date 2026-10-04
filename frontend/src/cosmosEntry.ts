export const STAR_TRANSFER_DURATION = 1350

// Zero velocity and acceleration at both ends, including delayed handovers.
export function entryEase(progress: number, start = 0, end = 1) {
  const t = Math.max(0, Math.min(1, (progress - start) / (end - start)))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export interface StarPoint {
  x: number
  y: number
}

export interface StarOrigin extends StarPoint {
  color: string
}

export interface CosmosEntry {
  id: string
  onReady: (point: StarPoint | null) => void
}
