/**
 * Vercel Serverless Function — /api/web/cowork/aggregate-strategic-goals
 *
 * Reads the partner's strategic-intent inputs from the three source
 * tables and snapshots them into
 * `strategy_web_projects.roadmap_state.strategic_goals` so the cowork
 * pipeline (Phase 2) can consume them from one curated location and
 * the strategist can review/edit/approve them in the new
 * Strategic Goals workspace (parallel to Core Messages review).
 *
 * Sources:
 *   - strategy_discovery_questionnaire   (9 typed columns)
 *   - strategy_content_collection_sessions (4 typed columns)
 *   - strategy_account_progress.handoff_web_form->'form' (5 JSONB keys)
 *
 * Re-sync behavior:
 *   - Default: preserves strategist edits + status flips. A field
 *     with status='approved' or 'archived' is NOT overwritten by a
 *     fresh source value unless `force=true`.
 *   - force=true: full overwrite, all fields back to status='draft'.
 *
 *   POST { project_id, force?: boolean }
 *   → 200 { ok: true, snapshot, summary }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { setRoadmapStateAtomic } from '../agents/_lib/roadmapStateMerge.js'
import {
  STRATEGIC_GOAL_FIELDS,
  deriveNavChangeLevel,
  deriveVerbatimBand,
  emptyStrategicGoalsSnapshot,
  type StrategicGoalCategory,
  type StrategicGoalCategoryBlock,
  type StrategicGoalField,
  type StrategicGoalFieldDef,
  type StrategicGoalSource,
  type StrategicGoalsSnapshot,
} from '../../../src/lib/cowork/strategicGoals.js'

export const maxDuration = 60

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? ''

interface SourceRows {
  discovery:    Record<string, unknown> | null
  cc_session:   Record<string, unknown> | null
  handoff_form: Record<string, unknown> | null      // handoff_web_form->'form'
  meta:         {
    member:                 number | null
    discovery_submitted_at: string | null
    cc_submitted_at:        string | null
    handoff_submitted_at:   string | null
  }
}

/** Read the three source tables in parallel. Returns null payload
 *  fields when no row exists — caller decides whether absence is a
 *  blocker (it isn't; we just emit empty StrategicGoalField slots). */
async function loadSources(sb: any, projectId: string): Promise<SourceRows> {
  const projRes = await sb
    .from('strategy_web_projects')
    .select('member')
    .eq('id', projectId)
    .maybeSingle()
  if (projRes.error || !projRes.data) {
    throw new Error(`project not found: ${projRes.error?.message ?? 'no row'}`)
  }
  const member = (projRes.data as any).member as number | null

  // Build the select list dynamically from STRATEGIC_GOAL_FIELDS so
  // adding a new field is a one-edit change in strategicGoals.ts.
  const discoveryCols = STRATEGIC_GOAL_FIELDS
    .filter(f => f.source === 'discovery')
    .map(f => f.source_column)
    .concat(['submitted_at'])
    .join(', ')
  const ccCols = STRATEGIC_GOAL_FIELDS
    .filter(f => f.source === 'content_collection')
    .map(f => f.source_column)
    .concat(['submitted_at'])
    .join(', ')

  if (member == null) {
    return {
      discovery:    null,
      cc_session:   null,
      handoff_form: null,
      meta: { member: null, discovery_submitted_at: null, cc_submitted_at: null, handoff_submitted_at: null },
    }
  }

  const [discoveryRes, ccRes, sapRes] = await Promise.all([
    sb.from('strategy_discovery_questionnaire')
      .select(discoveryCols)
      .eq('member', member)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sb.from('strategy_content_collection_sessions')
      .select(ccCols)
      .eq('member', member)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sb.from('strategy_account_progress')
      .select('handoff_web_form')
      .eq('member', member)
      .maybeSingle(),
  ])

  // We tolerate missing source rows (a fresh account may not have all
  // three captured yet) but surface read errors — those signal a
  // schema drift or RLS issue, not normal absence.
  if (discoveryRes.error) throw new Error(`discovery read failed: ${discoveryRes.error.message}`)
  if (ccRes.error)        throw new Error(`content collection read failed: ${ccRes.error.message}`)
  if (sapRes.error)       throw new Error(`account progress read failed: ${sapRes.error.message}`)

  const handoff = (sapRes.data as any)?.handoff_web_form
  const handoff_form = (handoff && typeof handoff === 'object' && 'form' in handoff && typeof handoff.form === 'object')
    ? (handoff.form as Record<string, unknown>)
    : null
  const handoff_submitted_at = (handoff && typeof handoff === 'object' && typeof (handoff as any).submittedAt === 'string')
    ? ((handoff as any).submittedAt as string)
    : null

  return {
    discovery:    (discoveryRes.data as any) ?? null,
    cc_session:   (ccRes.data as any) ?? null,
    handoff_form,
    meta: {
      member,
      discovery_submitted_at: (discoveryRes.data as any)?.submitted_at ?? null,
      cc_submitted_at:        (ccRes.data as any)?.submitted_at ?? null,
      handoff_submitted_at,
    },
  }
}

/** Read one field's raw value from its source row. Returns null on
 *  missing source row OR missing key. AM-handoff fields read from
 *  the JSONB blob; the other two sources read typed columns. */
function readSourceValue(def: StrategicGoalFieldDef, sources: SourceRows): string | number | null {
  let raw: unknown = null
  if (def.source === 'discovery') {
    raw = sources.discovery?.[def.source_column]
  } else if (def.source === 'content_collection') {
    raw = sources.cc_session?.[def.source_column]
  } else if (def.source === 'am_handoff') {
    raw = sources.handoff_form?.[def.source_column]
  }
  if (raw == null) return null
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw
  // arrays / objects → serialize to a compact string the strategist
  // can read + edit in the workspace. Inspirational sites list arrives
  // as a multi-line text column in practice, but if a future field
  // ships as an array we want a graceful fallback.
  return JSON.stringify(raw)
}

/** Returns the source_ref the strategist can trace back to. */
function sourceRefFor(source: StrategicGoalSource, meta: SourceRows['meta']): string | null {
  if (source === 'discovery')         return meta.discovery_submitted_at ? `discovery@${meta.discovery_submitted_at}` : null
  if (source === 'content_collection') return meta.cc_submitted_at ? `content_collection@${meta.cc_submitted_at}` : null
  return meta.handoff_submitted_at ? `am_handoff@${meta.handoff_submitted_at}` : null
}

/** Compose a fresh StrategicGoalField record from a source value. */
function buildField(
  def: StrategicGoalFieldDef,
  value: string | number | null,
  source_ref: string | null,
  syncedAtIso: string,
): StrategicGoalField {
  const field: StrategicGoalField = {
    value,
    source_kind:       def.source,
    source_ref,
    status:            'draft',
    last_synced_at:    syncedAtIso,
    strategist_edited: false,
  }
  // Derived values — only computed when we have a value to derive from.
  if (def.key === 'current_navigation_satisfaction' && typeof value === 'number') {
    const derived = deriveNavChangeLevel(value)
    if (derived) field.derived = { nav_change_level: derived }
  }
  if (def.key === 'copy_approach' && typeof value === 'string') {
    field.derived = { intended_verbatim_band: deriveVerbatimBand(value) }
  }
  return field
}

/** Build (or rebuild) the snapshot. When `prior` is given, preserve
 *  strategist edits + approved/archived statuses unless `force=true`. */
function buildSnapshot(
  sources: SourceRows,
  prior: StrategicGoalsSnapshot | null,
  force: boolean,
  nowIso: string,
): StrategicGoalsSnapshot {
  const snap = emptyStrategicGoalsSnapshot()
  snap._meta.generated_at = nowIso
  snap._meta.version = 1
  snap._meta.sources_synced_from = []
  if (sources.meta.discovery_submitted_at) {
    snap._meta.sources_synced_from.push({ kind: 'discovery', ref: `discovery@${sources.meta.discovery_submitted_at}`, synced_at: nowIso })
  }
  if (sources.meta.cc_submitted_at) {
    snap._meta.sources_synced_from.push({ kind: 'content_collection', ref: `content_collection@${sources.meta.cc_submitted_at}`, synced_at: nowIso })
  }
  if (sources.meta.handoff_submitted_at) {
    snap._meta.sources_synced_from.push({ kind: 'am_handoff', ref: `am_handoff@${sources.meta.handoff_submitted_at}`, synced_at: nowIso })
  }

  for (const def of STRATEGIC_GOAL_FIELDS) {
    const block = snap[def.category]
    const priorField = prior?.[def.category]?.[def.key] ?? null
    const sourceValue = readSourceValue(def, sources)
    const source_ref  = sourceRefFor(def.source, sources.meta)
    const fresh       = buildField(def, sourceValue, source_ref, nowIso)

    if (!priorField || force) {
      block[def.key] = fresh
      continue
    }

    // Preserve strategist work: if the prior field was approved or
    // archived OR carried a strategist edit, keep the strategist's
    // value + status; only refresh the source-traceability metadata
    // so they can see when this surface was last synced.
    const preserveValue =
      priorField.status !== 'draft' || priorField.strategist_edited === true
    if (preserveValue) {
      block[def.key] = {
        ...priorField,
        last_synced_at: nowIso,
        // refresh derived if relevant — only when we have a value
        derived: priorField.derived ?? fresh.derived,
      }
    } else {
      // Prior was a draft + no edit; safe to overwrite with the
      // fresh source value (and re-derive). Preserves any
      // `routed_to` the strategist set on additional_clarifications.
      const merged = { ...(fresh.derived ?? {}), ...(priorField.derived ?? {}) }
      const next: StrategicGoalField = { ...fresh }
      if (Object.keys(merged).length > 0) next.derived = merged
      block[def.key] = next
    }
  }
  return snap
}

/** Per-category counts for the response summary. */
function summarize(snap: StrategicGoalsSnapshot): Record<string, { total: number; populated: number; approved: number; draft: number; archived: number }> {
  const out: Record<string, { total: number; populated: number; approved: number; draft: number; archived: number }> = {}
  const categories: StrategicGoalCategory[] = ['goals_and_vision', 'voice_and_tone', 'content_and_allocation', 'display_and_technical', 'inspiration_and_notes']
  for (const cat of categories) {
    const block: StrategicGoalCategoryBlock = snap[cat]
    const stats = { total: 0, populated: 0, approved: 0, draft: 0, archived: 0 }
    for (const f of Object.values(block)) {
      stats.total++
      if (f.value != null && (typeof f.value !== 'string' || f.value.trim().length > 0)) stats.populated++
      if (f.status === 'approved') stats.approved++
      if (f.status === 'draft')    stats.draft++
      if (f.status === 'archived') stats.archived++
    }
    out[cat] = stats
  }
  return out
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {}
  const projectId: string | undefined = body.project_id
  const force: boolean = body.force === true
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'supabase env missing', detail: 'VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required' })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

  try {
    // Load source tables + the prior snapshot in parallel.
    const [sources, projRes] = await Promise.all([
      loadSources(sb, projectId),
      sb.from('strategy_web_projects').select('roadmap_state').eq('id', projectId).maybeSingle(),
    ])
    if (projRes.error) throw new Error(`roadmap_state read failed: ${projRes.error.message}`)

    const roadmap = ((projRes.data as any)?.roadmap_state ?? {}) as Record<string, unknown>
    const prior = (roadmap.strategic_goals && typeof roadmap.strategic_goals === 'object')
      ? (roadmap.strategic_goals as StrategicGoalsSnapshot)
      : null

    const nowIso  = new Date().toISOString()
    const snapshot = buildSnapshot(sources, prior, force, nowIso)

    await setRoadmapStateAtomic(sb, projectId, ['strategic_goals'], snapshot as unknown)

    return res.status(200).json({
      ok:       true,
      snapshot,
      summary:  summarize(snapshot),
      sources_synced_from: snapshot._meta.sources_synced_from,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return res.status(500).json({ error: 'aggregator_failed', detail: msg })
  }
}
