import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface ProcessedClip {
  id:                 string
  session_id:         string
  clip_id:            string
  clipcutter_job_id?: string | null
  status:             'processing' | 'ready' | 'error'
  video_url?:         string | null
  transcript?:        string | null
  duration_ms?:       number | null
  error_message?:     string | null
  created_at?:        string | null
  updated_at?:        string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const srpPipeline = () => (supabase as any).schema('srp_pipeline')

export function useProcessedClips(sessionId: string | null | undefined) {
  const [clips, setClips] = useState<Record<string, ProcessedClip>>({})

  useEffect(() => {
    if (!sessionId) return
    srpPipeline()
      .from('processed_clips')
      .select('*')
      .eq('session_id', sessionId)
      .then(({ data }: { data: ProcessedClip[] | null }) => {
        if (!data) return
        setClips(Object.fromEntries(data.map((r: ProcessedClip) => [r.clip_id, r])))
      })
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (supabase as any)
      .channel(`processed-clips-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'srp_pipeline',
          table: 'processed_clips',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: { new: ProcessedClip }) => {
          const row = payload.new
          if (!row?.clip_id) return
          setClips(prev => ({ ...prev, [row.clip_id]: row }))
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [sessionId])

  const upsertClip = useCallback(async (clipId: string, data: Partial<ProcessedClip>) => {
    if (!sessionId) return
    const row = {
      session_id: sessionId,
      clip_id:    clipId,
      ...data,
      updated_at: new Date().toISOString(),
    }
    await srpPipeline()
      .from('processed_clips')
      .upsert(row, { onConflict: 'session_id,clip_id' })
    setClips(prev => ({
      ...prev,
      [clipId]: { ...(prev[clipId] ?? {}), ...row } as ProcessedClip,
    }))
  }, [sessionId])

  const deleteClip = useCallback(async (clipId: string) => {
    if (!sessionId) return
    await srpPipeline()
      .from('processed_clips')
      .delete()
      .eq('session_id', sessionId)
      .eq('clip_id', clipId)
    setClips(prev => {
      const next = { ...prev }
      delete next[clipId]
      return next
    })
  }, [sessionId])

  return { clips, upsertClip, deleteClip }
}
