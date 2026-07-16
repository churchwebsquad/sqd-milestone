/**
 * Vercel Serverless Function — /api/srp/fetch-sermon-submissions
 *
 * Powers the "Recent Submissions" popup on AccountSelection + the
 * "Pair by ClickUp Task ID" search. Read-only against the public
 * strategy_sermon_data + sf-srp-uploads tables (no writes — per
 * CLAUDE.md these are existing tables we only READ from).
 *
 * Two modes branched on body.clickup_task_id:
 *
 *   1. Default (no clickup_task_id): returns this week's submissions
 *      (Friday-Thursday UTC window) where srp_info_selection is set,
 *      ordered by created_at desc, capped at 200.
 *
 *   2. Search (clickup_task_id provided): returns exactly the one
 *      matching submission, regardless of date.
 *
 * Both modes join sf-srp-uploads by task_id = clickup_task_id and
 * include video_url / external_link if a matching upload exists, plus
 * an is_this_week boolean (computed against the same Friday-Thursday
 * window) so the UI can badge cross-week submissions.
 *
 *   POST { clickup_task_id?: string }
 *   → 200 { submissions, weekStart, searched? }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 15

interface SermonRow {
  account:             number | null
  created_at:          string
  series_title:        string | null
  series_description:  string | null
  sermon_title:        string | null
  sermon_description:  string | null
  srp_info_selection:  string | null
  clickup_task_id:     string | null
}

interface UploadRow {
  task_id:       string | null
  supabase_url:  string | null
  external_link: string | null
}

interface PipelineRow {
  clickup_task_id: string | null
  pipeline_status: string | null
  pipeline_error:  string | null
  session_id:      string | null
}

const SERMON_COLUMNS =
  'account, created_at, series_title, series_description, sermon_title, sermon_description, srp_info_selection, clickup_task_id'

/**
 * Most recent Friday at 00:00 UTC. Day-of-week numbering: Sun=0 ... Sat=6.
 *   Friday (day=5): daysSinceFriday = 0 → today's 00:00
 *   Saturday (day=6): daysSinceFriday = 1 → yesterday's 00:00
 *   Sunday (day=0): daysSinceFriday = 2 → two days ago
 *   ... Thursday (day=4): daysSinceFriday = 6 → six days ago
 */
function computeWeekStart(now: Date): Date {
  const day = now.getUTCDay()
  const daysSinceFriday = (day + 2) % 7
  const weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() - daysSinceFriday)
  weekStart.setUTCHours(0, 0, 0, 0)
  return weekStart
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const searchTaskIdRaw = typeof req.body?.clickup_task_id === 'string' ? req.body.clickup_task_id.trim() : ''
  const searchTaskId    = searchTaskIdRaw.length > 0 ? searchTaskIdRaw : null
  const memberFilter    = typeof req.body?.member === 'number' ? req.body.member : null

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const weekStart = computeWeekStart(new Date())
  // Show 2 weeks of submissions — go back one extra week from the current week start
  const twoWeeksStart = new Date(weekStart)
  twoWeeksStart.setUTCDate(twoWeeksStart.getUTCDate() - 7)
  const weekStartIso = twoWeeksStart.toISOString()

  // ── Search-by-task-id mode ─────────────────────────────────────────
  if (searchTaskId) {
    const { data: searchData, error: searchError } = await sb
      .from('strategy_sermon_data')
      .select(SERMON_COLUMNS)
      .eq('clickup_task_id', searchTaskId)
      .limit(1)
    if (searchError) return res.status(500).json({ error: `Search failed: ${searchError.message}` })

    const rows = (searchData ?? []) as SermonRow[]
    if (rows.length === 0) {
      return res.status(200).json({ submissions: [], searched: true, weekStart: weekStartIso })
    }

    const { data: uploads } = await sb
      .from('sf-srp-uploads')
      .select('task_id, supabase_url, external_link')
      .eq('task_id', searchTaskId)
      .limit(1)
    const upload = (uploads as UploadRow[] | null)?.[0]
    const row = rows[0]
    const submission = {
      ...row,
      video_url:     upload?.supabase_url ?? null,
      external_link: upload?.external_link ?? null,
      is_this_week:  new Date(row.created_at) >= weekStart,
    }
    return res.status(200).json({ submissions: [submission], searched: true, weekStart: weekStartIso })
  }

  // ── Weekly-fetch mode ──────────────────────────────────────────────
  let weeklyQuery = sb
    .from('strategy_sermon_data')
    .select(SERMON_COLUMNS)
    .order('created_at', { ascending: false })
    .not('srp_info_selection', 'is', null)
    .limit(memberFilter ? 6 : 200)
  if (memberFilter) weeklyQuery = weeklyQuery.eq('account', memberFilter)
  else weeklyQuery = weeklyQuery.gte('created_at', weekStartIso)
  const { data: submissionData, error: subError } = await weeklyQuery
  if (subError) return res.status(500).json({ error: `Weekly fetch failed: ${subError.message}` })

  const rows = (submissionData ?? []) as SermonRow[]
  const taskIds = rows.map(r => r.clickup_task_id).filter((id): id is string => Boolean(id))

  const uploadsMap = new Map<string, UploadRow>()
  const pipelineMap = new Map<string, PipelineRow>()

  if (taskIds.length > 0) {
    const [uploadsResult, pipelineResult] = await Promise.all([
      sb.from('sf-srp-uploads').select('task_id, supabase_url, external_link').in('task_id', taskIds),
      sb.schema('srp_pipeline').from('sessions')
        .select('clickup_task_id, pipeline_status, pipeline_error, session_id')
        .in('clickup_task_id', taskIds)
        .neq('status', 'archived')
        .order('updated_at', { ascending: false }),
    ])

    if (uploadsResult.error) {
      console.warn(`[fetch-sermon-submissions] sf-srp-uploads lookup failed: ${uploadsResult.error.message}`)
    } else {
      for (const u of (uploadsResult.data as UploadRow[] | null) ?? []) {
        if (u.task_id) uploadsMap.set(u.task_id, u)
      }
    }

    if (!pipelineResult.error) {
      for (const p of (pipelineResult.data as PipelineRow[] | null) ?? []) {
        if (p.clickup_task_id && !pipelineMap.has(p.clickup_task_id)) {
          pipelineMap.set(p.clickup_task_id, p)
        }
      }
    }
  }

  const submissions = rows.map(row => {
    const upload   = row.clickup_task_id ? uploadsMap.get(row.clickup_task_id) : null
    const pipeline = row.clickup_task_id ? pipelineMap.get(row.clickup_task_id) : null
    return {
      ...row,
      video_url:       upload?.supabase_url ?? null,
      external_link:   upload?.external_link ?? null,
      is_this_week:    new Date(row.created_at) >= weekStart,
      pipeline_status: pipeline?.pipeline_status ?? null,
      pipeline_error:  pipeline?.pipeline_error ?? null,
      pipeline_session_id: pipeline?.session_id ?? null,
    }
  })

  return res.status(200).json({ submissions, weekStart: weekStartIso })
}
