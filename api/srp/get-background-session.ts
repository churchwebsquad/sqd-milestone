/**
 * Vercel Serverless Function — /api/srp/get-background-session
 *
 * Returns video_url, transcript, transcript_words, has_timecodes from
 * the background pipeline session for a given ClickUp task ID.
 * Runs with service role key to bypass RLS.
 *
 * POST { clickup_task_id: string }
 * → { video_url, transcript, transcript_words, has_timecodes } | { found: false }
 */
import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing env vars' })

  const clickupTaskId = typeof req.body?.clickup_task_id === 'string' ? req.body.clickup_task_id.trim() : ''
  if (!clickupTaskId) return res.status(400).json({ error: 'Missing clickup_task_id' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data, error } = await sb
    .schema('srp_pipeline')
    .from('sessions')
    .select('video_url, transcript, transcript_words, has_timecodes, pipeline_status, auto_drafts')
    .eq('clickup_task_id', clickupTaskId)
    .eq('status', 'background')
    .not('pipeline_status', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(200).json({ found: false })

  return res.status(200).json({
    found: true,
    video_url:        data.video_url ?? null,
    transcript:       data.transcript ?? null,
    transcript_words: data.transcript_words ?? null,
    has_timecodes:    data.has_timecodes ?? true,
    pipeline_status:  data.pipeline_status ?? null,
    auto_drafts:      data.auto_drafts ?? null,
  })
}
