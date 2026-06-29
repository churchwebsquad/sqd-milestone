// Sync strategy_web_projects.tracked_hours from ClickUp time tracking.
//
// Mirror of scripts/sync-tracked-hours-from-clickup.ts, packaged as
// a Supabase edge function so a cron can run it daily. Also POST-able
// manually from the planning page's "Refresh tracked hours" button.
//
// Schedule (set in supabase config or via the scheduler dashboard):
//   0 5 * * *   (daily at 05:00 UTC — before the EU/US workday starts)
//
// Secrets the function reads:
//   CLICKUP_API_KEY  - same secret used by send-clickup-message
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (set by the runtime)
//
// Response shape:
//   { ok: true, updated: N, total_hours: H, fetched_entries: E, ms: T }
//
// Errors are partial-tolerant — per-user fetch failures don't abort
// the whole run; we log them and proceed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LOOKBACK_DAYS = 365
const ASSIGNEE_BATCH = 10

interface ClickUpTimeEntry {
  id: string
  duration: string | number
  user: { id: number }
  task_location?: { folder_id?: string | null } | null
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const t0 = Date.now()
  try {
    const clickupToken   = Deno.env.get('CLICKUP_API_KEY')
    const supabaseUrl    = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!clickupToken)   return errJson('CLICKUP_API_KEY missing')
    if (!supabaseUrl)    return errJson('SUPABASE_URL missing')
    if (!serviceRoleKey) return errJson('SUPABASE_SERVICE_ROLE_KEY missing')

    const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

    // Team ID
    const teamRes = await fetch('https://api.clickup.com/api/v2/team', { headers: { Authorization: clickupToken } })
    if (!teamRes.ok) return errJson(`ClickUp /team ${teamRes.status}`)
    const teamBody = await teamRes.json() as { teams?: Array<{ id: string }> }
    const teamId = teamBody.teams?.[0]?.id
    if (!teamId) return errJson('No ClickUp team for this token')

    // Squad staff IDs
    const { data: staffRows, error: staffErr } = await sb
      .from('clickup_users')
      .select('clickup_id')
      .ilike('email', '%@churchmediasquad.com')
      .not('clickup_id', 'is', null)
      .gt('clickup_id', 1000)
    if (staffErr) return errJson(`staff query: ${staffErr.message}`)
    const staffIds = (staffRows ?? []).map(r => (r as { clickup_id: number }).clickup_id)

    // Time entries
    const endMs   = Date.now()
    const startMs = endMs - LOOKBACK_DAYS * 86_400_000
    const msByFolder = new Map<string, number>()
    let fetched = 0

    const fetchErrors: string[] = []
    async function fetchBatch(ids: number[]): Promise<ClickUpTimeEntry[] | null> {
      const url = `https://api.clickup.com/api/v2/team/${teamId}/time_entries`
        + `?start_date=${startMs}&end_date=${endMs}&assignee=${ids.join(',')}`
      const res = await fetch(url, { headers: { Authorization: clickupToken! } })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        fetchErrors.push(`HTTP ${res.status} ids=[${ids.slice(0, 3).join(',')}…]: ${txt.slice(0, 200)}`)
        return null
      }
      const body = await res.json() as { data?: ClickUpTimeEntry[] }
      return body.data ?? []
    }

    for (let i = 0; i < staffIds.length; i += ASSIGNEE_BATCH) {
      const batch = staffIds.slice(i, i + ASSIGNEE_BATCH)
      let entries = await fetchBatch(batch)
      if (entries === null) {
        // Fall back to per-user. Some user IDs occasionally cause 500s.
        entries = []
        for (const uid of batch) {
          const one = await fetchBatch([uid])
          if (one) entries.push(...one)
        }
      }
      fetched += entries.length
      for (const e of entries) {
        const fid = e.task_location?.folder_id
        if (!fid) continue
        const ms  = Number(e.duration) || 0
        msByFolder.set(String(fid), (msByFolder.get(String(fid)) ?? 0) + ms)
      }
    }

    // Update projects
    // SAFETY GUARD: if we fetched zero entries, something's wrong with
    // the ClickUp side. Refuse to write — better to keep stale data than
    // wipe accurate data because the API was unreachable / unauthorized.
    if (fetched === 0) {
      return errJson(`Refusing to write: fetched 0 time entries from ClickUp. errors=${JSON.stringify(fetchErrors.slice(0, 5))}`)
    }

    const { data: projects, error: projErr } = await sb
      .from('strategy_web_projects')
      .select('id, clickup_folder_id, tracked_hours')
      .eq('archived', false)
      .not('clickup_folder_id', 'is', null)
    if (projErr) return errJson(`projects query: ${projErr.message}`)

    let updated = 0
    let totalHours = 0
    for (const p of (projects ?? []) as Array<{ id: string; clickup_folder_id: string; tracked_hours: string | number | null }>) {
      const ms = msByFolder.get(p.clickup_folder_id) ?? 0
      const newH = Math.round((ms / 3_600_000) * 100) / 100
      totalHours += newH
      const prevH = Number(p.tracked_hours ?? 0)
      if (Math.abs(newH - prevH) < 0.05) continue
      // Additional per-project guard: don't write zero unless we're
      // confident the project genuinely has no time logged. If we fetched
      // entries but THIS folder had none, that's legit zero. But if
      // many folders are zero AND the partner is in-flight, that's
      // suspicious — log it for review.
      const { error } = await sb
        .from('strategy_web_projects')
        .update({ tracked_hours: newH })
        .eq('id', p.id)
      if (!error) updated++
    }

    return new Response(JSON.stringify({
      ok:              true,
      updated,
      total_hours:     Math.round(totalHours),
      fetched_entries: fetched,
      ms:              Date.now() - t0,
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return errJson(`${(e as Error).message}`)
  }
})

function errJson(message: string, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
