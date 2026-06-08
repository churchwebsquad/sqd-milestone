/**
 * Shared SRP generator hook. Handles auth, fetch, timing, error.
 */
import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'

export function useSrpGenerator() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastTook, setLastTook] = useState<number | null>(null)

  const call = useCallback(async <T = any>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T | null> => {
    setBusy(true); setError(null)
    const start = Date.now()
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch(`/api/srp/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}${text ? ` · ${text.slice(0, 150)}` : ''}`)
      }
      setLastTook(Math.round((Date.now() - start) / 1000))
      return json as T
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, lastTook, call }
}
