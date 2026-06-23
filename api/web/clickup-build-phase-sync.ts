/**
 * Vercel Serverless Function — /api/web/clickup-build-phase-sync
 *
 * Pulls TRACKED time from the project's ClickUp Build-Phase milestone
 * (and every subtask under it) and writes it to
 *   strategy_web_projects.tracked_hours
 *   strategy_web_projects.last_synced_at
 *
 * Per the launch-planner spec + the user's call: ONLY tracked time.
 * The dev_hours_estimate stays manually entered in the queue table.
 *
 * Request:
 *   POST /api/web/clickup-build-phase-sync
 *   Authorization: Bearer <Supabase user JWT>
 *   { "project_id": "<uuid>" }
 *
 * Response:
 *   200 { ok: true, tracked_hours: 42.5, subtasks_seen: 12, last_synced_at: "..." }
 *   400 { error: "..." } — missing project_id or clickup_build_task_id
 *   401 { error: "..." } — bad auth
 *   404 { error: "..." } — project or task not found
 *   502 { error: "...", details: "..." } — ClickUp API failed
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

// ClickUp returns time in milliseconds; the launch scheduler thinks
// in hours.
const MS_PER_HOUR = 3_600_000

interface ClickUpTimeEntry {
  duration: string | number          // ms, sometimes a string
}

interface ClickUpTaskShape {
  id:           string
  name?:        string
  time_spent?:  number | string      // legacy rolled-up field; ms
  subtasks?:    Array<ClickUpTaskShape>
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clickupToken   = process.env.CLICKUP_MILESTONE_API_TOKEN

  const missing: string[] = []
  if (!supabaseUrl)    missing.push('VITE_SUPABASE_URL')
  if (!anonKey)        missing.push('VITE_SUPABASE_ANON_KEY')
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!clickupToken)   missing.push('CLICKUP_MILESTONE_API_TOKEN')
  if (missing.length > 0) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` })
  }

  // ── Auth ─────────────────────────────────────────────────────────
  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl!, anonKey!).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  // ── Body ─────────────────────────────────────────────────────────
  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  const sb = createClient(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false } })

  // ── Load project + clickup_build_task_id ─────────────────────────
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, clickup_build_task_id, dev_hours_estimate')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr) return res.status(500).json({ error: 'project_load_failed', details: projErr.message })
  if (!project) return res.status(404).json({ error: 'project_not_found' })
  const taskId = (project as { clickup_build_task_id?: string | null }).clickup_build_task_id
  if (!taskId) {
    return res.status(400).json({
      error: 'clickup_build_task_id_missing',
      details: 'Set the project\'s clickup_build_task_id (the "Redesign: Build Phase" task) before syncing.',
    })
  }

  // ── Fetch the Build-Phase task + subtasks from ClickUp ───────────
  // ClickUp v2 GET /task/{task_id}?include_subtasks=true returns the
  // task with its subtasks inlined. Subtasks each carry their own
  // time_spent (rolled-up time entries for that subtask).
  const taskRes = await fetch(
    `https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}?include_subtasks=true`,
    { headers: { Authorization: clickupToken! } },
  )
  if (!taskRes.ok) {
    const text = await taskRes.text().catch(() => '')
    return res.status(502).json({
      error: 'clickup_task_fetch_failed',
      status: taskRes.status,
      details: text.slice(0, 500),
    })
  }
  const task = (await taskRes.json()) as ClickUpTaskShape

  // ── Sum time_spent across parent + all subtasks ──────────────────
  // ClickUp's task.time_spent is the rolled-up total of every time
  // entry logged to THAT specific task (not its subtasks). To get
  // the true Build-Phase total we sum the parent + each subtask.
  // Use a Set to dedupe by task id in case the same row appears
  // twice via different paths.
  const seen = new Set<string>()
  let totalMs = 0
  let subtasksCounted = 0
  const walk = (t: ClickUpTaskShape) => {
    if (!t || !t.id || seen.has(t.id)) return
    seen.add(t.id)
    const ms = Number(t.time_spent ?? 0)
    if (Number.isFinite(ms) && ms > 0) totalMs += ms
    const subs = Array.isArray(t.subtasks) ? t.subtasks : []
    for (const sub of subs) {
      walk(sub)
      subtasksCounted++
    }
  }
  walk(task)

  // ── (Belt-and-suspenders) sum time entries via /team/{team_id}/time_entries
  //    when the parent task's time_spent is suspiciously low.
  //    ClickUp's time_spent on a task is sometimes stale or lags
  //    behind time entries logged via the timer. If totalMs is 0 but
  //    there's clearly logged time, the team-level time_entries
  //    endpoint is the authoritative fallback.
  //    Disabled by default to keep this round simple; surface as a
  //    follow-up if the user reports under-counting.
  // const teamId = ... ; would need to discover via clickup_get_workspace_hierarchy.

  const trackedHours = Math.round((totalMs / MS_PER_HOUR) * 10) / 10
  const nowIso = new Date().toISOString()

  // ── Write back ───────────────────────────────────────────────────
  // pct_complete is left null on this round per the spec — pace
  // projection falls back to tracked_hours / dev_hours_estimate.
  const { error: updErr } = await sb
    .from('strategy_web_projects')
    .update({
      tracked_hours:    trackedHours,
      last_synced_at:   nowIso,
      // dev_hours_source stays whatever the user set (manual by
      // default). The user's explicit call: only tracked syncs from
      // ClickUp; the estimate is always manual.
      updated_at:       nowIso,
    })
    .eq('id', projectId)
  if (updErr) {
    return res.status(500).json({ error: 'update_failed', details: updErr.message })
  }

  return res.status(200).json({
    ok:                 true,
    tracked_hours:      trackedHours,
    subtasks_counted:   subtasksCounted,
    last_synced_at:     nowIso,
    clickup_task_id:    taskId,
    clickup_task_name:  task.name ?? null,
  })
}
