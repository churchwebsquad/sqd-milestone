/**
 * Realtime subscription to a single sms_srp_generation row.
 *
 * Replaces the 5-second polling pattern with Supabase postgres_changes.
 * When the row updates (transcript landing, clip render finishing,
 * deliverable saved), subscribers get the fresh row pushed instead of
 * waiting on the next poll tick.
 *
 * Falls back gracefully: if the realtime channel fails to subscribe
 * within 5 seconds (firewall, project misconfig, etc.), callers can
 * detect via the `connected` state and fall back to polling.
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { getSession } from './srpSessions'
import type { SmsSrpGeneration } from '../types/database'

export interface UseSrpSessionResult {
  session: SmsSrpGeneration | null
  loading: boolean
  error: string | null
  connected: boolean        // realtime channel is live
  refresh: () => Promise<void>  // manual re-fetch (poll fallback)
}

export function useSrpSession(sessionId: string | null | undefined): UseSrpSessionResult {
  const [session, setSession] = useState<SmsSrpGeneration | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const cancelledRef = useRef(false)

  const reload = async () => {
    if (!sessionId) return
    try {
      const fresh = await getSession(sessionId)
      if (cancelledRef.current) return
      setSession(fresh)
      setError(fresh ? null : `Session ${sessionId} not found`)
    } catch (e) {
      if (cancelledRef.current) return
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    cancelledRef.current = false
    setLoading(true); setError(null); setConnected(false)
    if (!sessionId) { setLoading(false); return }

    void reload()

    // Subscribe to UPDATE events on this row. Filter is server-side so
    // we don't see updates from other sessions.
    const channel = supabase
      .channel(`sms_srp_generation:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sms_srp_generation', filter: `session_id=eq.${sessionId}` },
        payload => {
          const fresh = payload?.new as SmsSrpGeneration | undefined
          if (cancelledRef.current || !fresh) return
          setSession(fresh)
        },
      )
      .subscribe(status => {
        if (cancelledRef.current) return
        if (status === 'SUBSCRIBED') setConnected(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnected(false)
      })

    // Safety net: if the channel doesn't connect within 5s, surface
    // disconnected so callers can fall back to polling.
    const watchdog = window.setTimeout(() => {
      if (!cancelledRef.current && !connected) setConnected(false)
    }, 5000)

    return () => {
      cancelledRef.current = true
      window.clearTimeout(watchdog)
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return { session, loading, error, connected, refresh: reload }
}
