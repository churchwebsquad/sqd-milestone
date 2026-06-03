// am-question-analyze — Supabase Edge Function
//
// Reads an account-manager message asking about website launch
// timelines, extracts the church references + any target dates,
// resolves them to strategy_web_projects, runs feasibility per
// project, and assembles an AI-written draft response that the AM
// can edit + send to leadership.
//
// Inputs (POST body):
//   message:     string         — the raw message text
//   employee_id: string | null  — calling user for audit log
//
// Output:
//   {
//     projects: DetectedProjectRef[],
//     response_md: string,
//     talking_points_used: string[],  // UUIDs
//     draft_id: string                — strategy_am_question_drafts.id
//   }
//
// Two LLM calls:
//   1) Extract references: model parses "3680 Lakeway, target Aug 16
//      HARD" out of the message into structured JSON.
//   2) Assemble response: model writes the markdown reply, given the
//      feasibility verdict for each church + the relevant talking-
//      point blocks.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EXTRACT_SYSTEM = `You extract church references + dates from an
account-manager message about church website project timelines. Return
ONLY a JSON object with this shape — no prose, no markdown:

{
  "projects": [
    {
      "member_id": <number or null — 4-digit ID if mentioned>,
      "church_name": <string or null — partial or full name>,
      "target_dates": [
        { "raw": "<as written>", "iso": "<yyyy-mm-dd or null>", "hardness": "hard"|"ideal"|"soft" }
      ]
    }
  ]
}

Rules:
- One entry per distinct church referenced (de-dupe).
- "hardness" = "hard" when phrases like "needs to be live by", "no
  later than", "must launch" appear; "ideal" for "hoping to", "would
  love"; otherwise "soft".
- Convert calendar dates (e.g. "Aug 16") to ISO using the current
  year. If past, roll forward one year.
- If no member ID is given but a church name is, still emit the
  entry with member_id null.`

const RESPOND_SYSTEM = `You are a Web team lead writing a professional,
warm response to an account manager who is asking about church website
launch timelines. Your reply will go from the team lead to the AM,
who will then talk to the church leadership.

Hard rules:
- Cite ONLY the dates + verdicts in the feasibility_results input.
  NEVER invent or estimate dates that aren't in the input.
- Address each church by name, with the project's current projection,
  what would need to change to hit the AM's target, and a 1-sentence
  "here's where we are right now" framing.
- End with a brief "why the process takes the time it takes" framing
  using the relevant talking_points blocks (pull from their bodies;
  don't quote verbatim — adapt to tone).
- Tone: calm, evidence-based, no over-promising, no apology theatre.
- Output: markdown. No emojis. Use ### Church Name as subheadings
  for each church. Keep paragraphs short.`

interface DetectedProject {
  member_id:    number | null
  church_name:  string | null
  target_dates: Array<{ raw: string; iso: string | null; hardness: 'hard'|'ideal'|'soft' }>
}

interface ResolvedProject extends DetectedProject {
  matched_project_id: string | null
  confidence:         'high' | 'medium' | 'low'
  /** Feasibility result PER target_date — keyed by ISO. */
  feasibility_by_target: Record<string, Record<string, unknown>>
  project_row?:       Record<string, unknown>
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE env missing')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY missing')

    const supabase = createClient(supabaseUrl, supabaseKey)
    const body = await req.json() as { message?: string; employee_id?: string | null }
    const message = (body.message ?? '').toString()
    const employeeId = body.employee_id ?? null
    if (!message.trim()) {
      return json({ error: 'message is required', projects: [], response_md: '' }, 400)
    }

    // ── 1) Extract church references via LLM ──────────────
    const extractRes = await anthropic(anthropicKey, EXTRACT_SYSTEM, message, 800)
    let detected: DetectedProject[] = []
    const extractedJson = tryParseJson(extractRes)
    if (extractedJson && Array.isArray((extractedJson as { projects?: unknown }).projects)) {
      detected = (extractedJson as { projects: DetectedProject[] }).projects
    }

    // Fallback regex: 4-digit member IDs (1000–9999) if extractor
    // returned nothing usable.
    if (detected.length === 0) {
      const memberMatches = [...message.matchAll(/\b(\d{4})\b/g)].map(m => Number(m[1]))
      for (const id of new Set(memberMatches)) {
        detected.push({ member_id: id, church_name: null, target_dates: [] })
      }
    }

    if (detected.length === 0) {
      return json({
        projects: [],
        response_md: "I couldn't detect any specific church references in that message — could you re-send with the member ID or church name?",
        talking_points_used: [],
        draft_id: null,
      })
    }

    // ── 2) Resolve to projects ────────────────────────────
    const resolved: ResolvedProject[] = []
    for (const d of detected) {
      // Try member_id first.
      let match: Record<string, unknown> | null = null
      if (d.member_id != null) {
        const { data } = await supabase
          .from('strategy_web_projects')
          .select('*')
          .eq('member', d.member_id)
          .eq('archived', false)
          .order('created_at', { ascending: false })
          .limit(1)
        match = data?.[0] ?? null
      }
      // Fall back to fuzzy church_name match against the projects.
      let confidence: 'high'|'medium'|'low' = 'low'
      if (!match && d.church_name) {
        const { data } = await supabase
          .from('strategy_web_projects')
          .select('*')
          .ilike('name', `%${d.church_name}%`)
          .eq('archived', false)
          .limit(1)
        match = data?.[0] ?? null
        confidence = match ? 'medium' : 'low'
      } else if (match) {
        confidence = 'high'
      }

      // Run feasibility per target_date if we have a project.
      const feasibilityByTarget: Record<string, Record<string, unknown>> = {}
      if (match) {
        const projectId = match.id as string
        const member = match.member as number
        const [allocsRes, subsRes] = await Promise.all([
          supabase.from('strategy_dev_weekly_allocations')
            .select('week_starting, hours')
            .eq('web_project_id', projectId),
          supabase.from('strategy_milestone_submissions')
            .select('milestone_id, milestone_status, submitted_at')
            .eq('member', member)
            .eq('is_active', true),
        ])
        for (const dt of d.target_dates) {
          if (!dt.iso) continue
          const fr = computeFeasibilitySimple({
            project: match,
            allocations: (allocsRes.data ?? []) as Array<{ week_starting: string; hours: number }>,
            milestones: (subsRes.data ?? []) as Array<{ milestone_id: string; milestone_status: string; submitted_at: string }>,
            targetDate: dt.iso,
            today: new Date(),
          })
          feasibilityByTarget[dt.iso] = fr
        }
      }

      resolved.push({
        ...d,
        matched_project_id: match?.id as string ?? null,
        confidence,
        feasibility_by_target: feasibilityByTarget,
        project_row: match ?? undefined,
      })
    }

    // ── 3) Load talking-points library ────────────────────
    const { data: tps } = await supabase
      .from('strategy_talking_points')
      .select('id, category, title, body, tags, applies_when, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(50)
    const talkingPoints = (tps ?? []) as Array<{
      id: string; category: string; title: string; body: string;
      tags: string[]; applies_when: Record<string, unknown>; sort_order: number
    }>

    // Filter to relevant blocks: any with empty applies_when, or
    // tagged with at least one signal we see ("group_kickoff",
    // "fall_launch", "hard_deadline", "leadership_pressure"). For
    // v1 just pass everything; the responder model picks.
    const usedIds = talkingPoints.map(t => t.id)

    // ── 4) Assemble response via LLM ──────────────────────
    const promptPayload = {
      original_message: message,
      churches: resolved.map(r => ({
        member_id: r.member_id,
        church_name: r.church_name ?? (r.project_row?.name ?? null),
        confidence: r.confidence,
        current_projection: r.project_row?.launch_date ?? null,
        current_phase: r.project_row?.current_phase ?? null,
        targets: r.target_dates.map(dt => ({
          raw: dt.raw,
          iso: dt.iso,
          hardness: dt.hardness,
          feasibility: dt.iso ? r.feasibility_by_target[dt.iso] ?? null : null,
        })),
      })),
      talking_points: talkingPoints.map(t => ({
        id: t.id,
        category: t.category,
        title: t.title,
        body: t.body,
      })),
    }

    const responderRes = await anthropic(
      anthropicKey,
      RESPOND_SYSTEM,
      `Inputs as JSON:\n\n${JSON.stringify(promptPayload, null, 2)}\n\nWrite the response now.`,
      2500,
    )
    const responseMd = responderRes.trim()

    // ── 5) Audit log ──────────────────────────────────────
    const draftRow = {
      employee_id: employeeId,
      message_in: message,
      response_md: responseMd,
      projects: resolved.map(r => ({
        member_id: r.member_id,
        church_name: r.church_name,
        matched_project_id: r.matched_project_id,
        confidence: r.confidence,
        target_dates: r.target_dates,
      })),
      talking_points_used: usedIds,
    }
    const { data: inserted } = await supabase
      .from('strategy_am_question_drafts')
      .insert(draftRow)
      .select('id')
      .single()

    return json({
      projects: resolved.map(r => ({
        member_id: r.member_id,
        church_name: r.church_name ?? (r.project_row?.name ?? null),
        matched_project_id: r.matched_project_id,
        confidence: r.confidence,
        target_dates: r.target_dates,
      })),
      response_md: responseMd,
      talking_points_used: usedIds,
      draft_id: inserted?.id ?? null,
    })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), projects: [], response_md: '' }, 500)
  }
})

// ── helpers ──────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function anthropic(key: string, system: string, user: string, maxTokens: number) {
  const r = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const data = await r.json()
  return (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
}

function tryParseJson(text: string) {
  const t = text.trim()
  try { return JSON.parse(t) } catch { /* fall through */ }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(t.slice(start, end + 1)) } catch { return null }
}

// ── Inline feasibility (duplicated TS logic, simplified) ───
// Mirrors src/lib/webProjectFeasibility.ts at the level the LLM
// needs. Keep these in sync if the client logic shifts.

function computeFeasibilitySimple(args: {
  project:      Record<string, unknown>
  allocations:  Array<{ week_starting: string; hours: number }>
  milestones:   Array<{ milestone_id: string; milestone_status: string; submitted_at: string }>
  targetDate:   string
  today:        Date
}) {
  const target = new Date(args.targetDate + 'T12:00:00')
  const launchIso = args.project.launch_date as string | null
  const launch = launchIso ? new Date(launchIso + 'T12:00:00') : null

  // Remaining hours = sum of phase_estimates × multipliers for
  // phases at-or-after current_phase. Fallback: dev_hours_estimate.
  const phases = ['intake','content','design','dev','review','launched']
  const currentIdx = phases.indexOf(args.project.current_phase as string)
  const est = (args.project.phase_estimates ?? {}) as Record<string, number>
  const mults = (args.project.ai_assist_multipliers ?? {}) as Record<string, number>
  let remaining = 0
  for (const p of phases.slice(currentIdx)) {
    if (p === 'launched') continue
    remaining += (est[p] ?? 0) * (mults[p] ?? 1)
  }
  if (remaining === 0 && args.project.dev_hours_estimate) {
    remaining = Number(args.project.dev_hours_estimate)
  }

  let available = 0
  for (const a of args.allocations) {
    const w = new Date(a.week_starting + 'T12:00:00')
    if (w < args.today) continue
    if (w > target) continue
    available += Number(a.hours)
  }

  const blocked = args.milestones.some(m =>
    m.milestone_status === 'escalated' ||
    (m.milestone_status === 'waiting_on_partner' &&
     daysBetween(new Date(m.submitted_at), args.today) > 7))

  let verdict: 'achievable'|'tight'|'unachievable'
  if (launch && launch < target) {
    verdict = 'achievable'
  } else if (blocked) {
    verdict = 'unachievable'
  } else if (remaining <= available * 1.1) {
    verdict = 'tight'
  } else {
    verdict = 'unachievable'
  }

  return {
    verdict,
    remaining_hours: Math.round(remaining * 10) / 10,
    available_hours_to_target: Math.round(available * 10) / 10,
    current_projection: launchIso,
    blocked,
  }
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
