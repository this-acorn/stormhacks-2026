import { useEffect, useState } from 'react'
import {
  isComplete,
  readCollection,
  reconcileCollection,
  saveCollection,
} from '../constellationCollection'
import type { Contribution, Organization } from '../types'
import {
  DEMO_SUPPORTER_ACCOUNT,
  createConstellationDemo,
  mergeExampleCollection,
} from '../constellationDemo'
import { DEMO_MODE } from '../api'

// MyCosmos is keyed by account ID, so state cannot leak across account switches.
export function useConstellationCollection(
  accountId: string,
  contributions: Contribution[],
  organizations: Organization[],
  enabled: boolean,
) {
  function initialSnapshot() {
    const saved = readCollection(accountId)
    return DEMO_MODE && accountId === DEMO_SUPPORTER_ACCOUNT && organizations.length
      ? mergeExampleCollection(saved, createConstellationDemo(organizations).collection)
      : saved
  }
  const [state, setState] = useState(() => ({
    contributions,
    organizations,
    enabled,
    snapshot: enabled
      ? reconcileCollection(accountId, contributions, organizations, initialSnapshot())
      : initialSnapshot(),
  }))
  const [storageAvailable, setStorageAvailable] = useState(true)
  let collection = state.snapshot
  if (
    state.contributions !== contributions ||
    state.organizations !== organizations ||
    state.enabled !== enabled
  ) {
    collection = enabled
      ? reconcileCollection(accountId, contributions, organizations, state.snapshot)
      : state.snapshot
    // Retain assignments before rendering children with the changed contribution list.
    setState({ contributions, organizations, enabled, snapshot: collection })
  }
  const serialized = JSON.stringify(collection)
  useEffect(() => {
    if (!enabled || !accountId) return
    const snapshot = JSON.parse(serialized)
    // Storage availability is determined by this external write.
    // oxlint-disable-next-line react/set-state-in-effect
    setStorageAvailable(saveCollection(accountId, snapshot))
  }, [accountId, serialized, enabled])
  function collect(id: string) {
    if (
      !collection.plans.some((plan) => plan.patternId === id && isComplete(plan)) ||
      collection.seen.includes(id)
    )
      return
    setState({
      contributions,
      organizations,
      enabled,
      snapshot: { ...collection, seen: [...collection.seen, id] },
    })
  }
  return { collection, collect, storageAvailable }
}
