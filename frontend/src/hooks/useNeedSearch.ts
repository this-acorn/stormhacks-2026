import { useEffect, useState } from 'react'
import { aidApi } from '../api'
import type { SearchResults } from '../types'

// Debounce means waiting briefly for typing to pause before asking the server.
// The cancellation flag prevents a slower, older result from replacing a newer query.
export function useNeedSearch(query: string, enabled: boolean) {
  const [state, setState] = useState<{ query: string; result?: SearchResults; error?: string }>({
    query: '',
  })
  useEffect(() => {
    if (!query.trim() || !enabled) return
    let active = true
    const timeout = setTimeout(() => {
      aidApi
        .search(query.trim())
        .then((result) => {
          if (active) setState({ query, result })
        })
        .catch((error: Error) => {
          if (active) setState({ query, error: error.message })
        })
    }, 350)
    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [query, enabled])
  const current = state.query === query ? state : undefined
  return {
    result: current?.result,
    error: current?.error,
    loading: !!query.trim() && enabled && !current,
  }
}
