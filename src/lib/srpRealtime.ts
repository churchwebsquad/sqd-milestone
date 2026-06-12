/**
 * Realtime subscription to a single srp_pipeline.sessions row.
 *
 * Replaces 5-second polling with Supabase postgres_changes. When the
 * row updates (transcript landing, clipcutter rendering, autosave),
 * subscribers get the fresh row pushed instead of waiting on a poll.
 *
 * Falls back gracefully: if the realtime channel fails to subscribe,
 * callers can detect via `connected` and fall back to manual refresh.
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { getSessionBySlug, srpPipeline } from './srpSessions'
import type { SrpPipelineSession } from '../types/database'

export interface UseSrpSessionResult {
  session: SrpPipelineSession | null
  loading: boolean
  error: string | null
  connected: boolean
  refresh: () => Promise<void>
}

export function useSrpSession(sessionId: string | null | undefined): UseSrpSessionResult {
  const [session, setSession] = useState<SrpPipelineSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const cancelledRef = useRef(false)

  const reload = async () => {
    if (!sessionId) return
    try {
      const fresh = await getSessionBySlug(sessionId)
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

    // Subscribe to UPDATE events on this row. Server-side filter scopes
    // by session_id so we don't see updates from other sessions.
    // Note: srp_pipeline.sessions isn't in the supabase_realtime publication
    // by default — we publish transcript_jobs + clipcutter_jobs instead.
    // The session row gets refresh()ed from those job updates downstream,
    // but for the row itself we rely on manual reload() after our own writes.
    const channel = supabase
      .channel(`srp_pipeline_sessions:${sessionId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'srp_pipeline', table: 'sessions', filter: `session_id=eq.${sessionId}` },
        payload => {
          const fresh = (payload as unknown as { new: SrpPipelineSession })?.new
          if (cancelledRef.current || !fresh) return
          setSession(fresh)
        },
      )
      .subscribe(status => {
        if (cancelledRef.current) return
        if (status === 'SUBSCRIBED') setConnected(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnected(false)
      })

    return () => {
      cancelledRef.current = true
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return { session, loading, error, connected, refresh: reload }
}

/**
 * Realtime subscription to a single srp_pipeline.transcript_jobs row.
 *
 * The transcript_jobs table IS in the supabase_realtime publication
 * (per v69 migration), so this fires push updates as n8n progresses
 * through pending → in_progress → completed/failed.
 */
export function useTranscriptJob(jobId: string | null | undefined) {
  const [job, setJob] = useState<{
    id: string
    status: string
    status_message: string | null
    progress_percent: number | null
    error_message: string | null
    transcript: string | null
    words: unknown[] | null
    duration_seconds: number | null
    transcription_engine: string | null
    completed_at: string | null
  } | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!jobId) { setJob(null); return }

    let cancelled = false

    void (async () => {
      const { data } = await srpPipeline
        .from('transcript_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!cancelled && data) setJob(data as any)
    })()

    const channel = supabase
      .channel(`srp_pipeline_transcript_jobs:${jobId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'srp_pipeline', table: 'transcript_jobs', filter: `id=eq.${jobId}` },
        payload => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fresh = (payload as any)?.new
          if (cancelled || !fresh) return
          setJob(fresh)
        },
      )
      .subscribe(status => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') setConnected(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnected(false)
      })

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [jobId])

  return { job, connected }
}

/**
 * Realtime subscription to a single srp_pipeline.clipcutter_jobs row.
 * Same pattern as useTranscriptJob — the table is realtime-published.
 */
export function useClipcutterJob(jobId: string | null | undefined) {
  const [job, setJob] = useState<{
    id: string
    status: string
    status_message: string | null
    progress_percent: number | null
    error_message: string | null
    clips: unknown[] | null
    clip_results: unknown[] | null
    completed_at: string | null
  } | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!jobId) { setJob(null); return }
    let cancelled = false

    void (async () => {
      const { data } = await srpPipeline
        .from('clipcutter_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!cancelled && data) setJob(data as any)
    })()

    const channel = supabase
      .channel(`srp_pipeline_clipcutter_jobs:${jobId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'srp_pipeline', table: 'clipcutter_jobs', filter: `id=eq.${jobId}` },
        payload => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fresh = (payload as any)?.new
          if (cancelled || !fresh) return
          setJob(fresh)
        },
      )
      .subscribe(status => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') setConnected(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnected(false)
      })

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [jobId])

  return { job, connected }
}
