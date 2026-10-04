import type { ContributionStatus } from './types'

export const CONTRIBUTION_LABELS: Record<ContributionStatus, string> = {
  pledged: 'Pledged',
  user_reported_completed: 'Completion reported',
  organization_confirmed: 'Organization confirmed',
}

// External links come from the API. Never allow script/data URLs into an anchor.
export function safeSupportLink(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      return url.href
  } catch {
    /* Missing or malformed links are simply not rendered. */
  }
  return undefined
}
