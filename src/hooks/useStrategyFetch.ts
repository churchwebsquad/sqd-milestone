import { useCallback, useEffect, useRef, useState } from 'react'
import { isSetupError } from '../lib/strategyNotion'
import type { StrategyNotionSetupError } from '../types/strategy'

/** Wraps a Strategy edge-function call with three states: loading, setup,
 *  data. Errors that aren't `setup-required` bubble up as a generic
 *  `error` string so the page can show a failure message.
 *
 *  Polish pass (Phase 3 #1): the hook also auto-refetches when the tab
 *  regains focus after being hidden — a cheap way to make Notion-side
 *  edits appear in the app without paying for webhooks or aggressive
 *  polling. The first fetch on mount is unaffected; only subsequent
 *  visibility changes trigger a re-run.
 *
 *  The exported `refetch` lets pages plumb a "Refresh" button to the same
 *  pipeline. */
export function useStrategyFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): {
  data: T | null
  loading: boolean
  refreshing: boolean
  setupError: StrategyNotionSetupError | null
  error: string | null
  refetch: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [setupError, setSetupError] = useState<StrategyNotionSetupError | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep the latest fetcher in a ref so the visibility-change effect can
  // call it without re-binding on every render.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // `cancelTokenRef` lets us cancel an in-flight refetch when a newer one
  // starts (or when deps change).
  const cancelRef = useRef({ cancelled: false })

  const run = useCallback((isRefresh: boolean) => {
    cancelRef.current.cancelled = true
    const token = { cancelled: false }
    cancelRef.current = token

    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setSetupError(null)
    setError(null)

    fetcherRef.current()
      .then(d => {
        if (token.cancelled) return
        setData(d)
      })
      .catch(err => {
        if (token.cancelled) return
        if (isSetupError(err)) setSetupError(err)
        else setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (token.cancelled) return
        if (isRefresh) setRefreshing(false)
        else setLoading(false)
      })
  }, [])

  // Initial + deps-change fetch
  useEffect(() => {
    run(false)
    return () => { cancelRef.current.cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Window-focus refetch — invisible to the user when nothing changed,
  // pulls fresh Notion state when something did. Skipped on initial mount
  // because the deps-change effect already handled that.
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run(true)
    }
    window.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    return () => {
      window.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [run])

  const refetch = useCallback(() => run(true), [run])

  return { data, loading, refreshing, setupError, error, refetch }
}
