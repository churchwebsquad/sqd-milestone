/**
 * Vercel Serverless Function — /api/web/agents/orchestrate
 *
 * The Director-driven orchestrator. Single endpoint, multiple actions:
 *
 *   action=run_drafts   — page_briefs (if missing) + page_drafts (parallel)
 *   action=critique     — director critique on current drafts
 *   action=iterate      — apply directives from latest critique:
 *                         re-run flagged page_drafts, then re-critique.
 *                         Loops up to maxLoops times or until directives
 *                         empty or verdict=approved.
 *   action=route        — director route on user feedback; returns dispatch
 *   action=apply        — execute a dispatch (re-run the named stage)
 *   action=commit       — page-bind every page_draft to web_pages + web_sections
 *   action=status       — return engine_state without mutating
 *
 * Engine state lives in roadmap_state.engine_state. Each action updates
 * status + phase + last_action_at + counters. The UI polls /status or
 * triggers actions directly.
 *
 * Calls child agents over HTTP using the same VERCEL_URL the request
 * arrived on. Auth: passes the strategist's JWT through to children.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const MAX_LOOPS = 3
const PAGE_DRAFT_CONCURRENCY = 4
/** Audit → fix → audit cap. After this many fix attempts, the loop
 *  halts even if gaps remain — the strategist resolves the residual
 *  via manual Revise feedback or by approving with known gaps. */
const SITEMAP_AUDIT_MAX_LOOPS = 2

type Action = 'run_drafts' | 'critique' | 'iterate' | 'route' | 'apply' | 'commit' | 'status' | 'approve_sitemap' | 'unlock_sitemap' | 'revise_sitemap' | 'run_coverage_audit' | 'export_state' | 'import_state' | 'draft_sitemap_with_audit' | 'reset_engine_state' | 'run_synthesize' | 'apply_audit_to_nav' | 'rename_sitemap_page'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const action: Action = (req.body?.action as Action) ?? 'status'
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const baseUrl = resolveBaseUrl(req)

  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, roadmap_state').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  const engineState = (roadmapState.engine_state ?? {}) as Record<string, any>

  try {
    if (action === 'status') {
      return res.status(200).json({ ok: true, engine_state: engineState })
    }

    if (action === 'run_synthesize') {
      // Stage 1 — strategy synthesis from intake. Either a fresh draft
      // (no redoContext) or a redo driven by strategist feedback.
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const result = await callAgent(baseUrl, jwt, 'extract-strategy',
        note ? { projectId, redoContext: note } : { projectId })
      return res.status(200).json({ ok: true, stage_1: result })
    }

    if (action === 'apply_audit_to_nav') {
      // Targeted additive sitemap surgery — apply the current audit's
      // findings as add_page / add_header_entry / add_footer_entry
      // edits. Does NOT redraft existing pages, labels, or structure.
      const result = await callAgent(baseUrl, jwt, 'apply-audit-to-nav', { projectId })
      // Re-run coverage so the strategist sees the updated audit immediately.
      try { await callAgent(baseUrl, jwt, 'sitemap-coverage', { projectId }) }
      catch (e: any) { console.error('[apply_audit_to_nav] post-edit coverage failed (non-fatal):', e?.message) }
      return res.status(200).json({ ok: true, audit_apply: result })
    }

    if (action === 'rename_sitemap_page') {
      // Deterministic rename — no LLM call. Updates page.name +
      // optional nav_label + optional slug across pages[] and the
      // nav trees. Skipped: footer_nav (uses labels not bound to
      // page slugs, edit-via-Revise instead).
      const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : ''
      const newName = typeof req.body?.newName === 'string' ? req.body.newName.trim() : null
      const newNavLabel = typeof req.body?.newNavLabel === 'string' ? req.body.newNavLabel.trim() : null
      const newSlug = typeof req.body?.newSlug === 'string' ? req.body.newSlug.trim() : null
      if (!slug) return res.status(400).json({ error: 'slug required' })
      if (newName == null && newNavLabel == null && newSlug == null) {
        return res.status(400).json({ error: 'At least one of newName, newNavLabel, newSlug required' })
      }
      const stage2 = roadmapState.stage_2 as Record<string, any> | undefined
      if (!stage2) return res.status(400).json({ error: 'No sitemap (stage_2) to edit.' })
      const result = renameSitemapPage(stage2, { slug, newName, newNavLabel, newSlug })
      if (!result.found) return res.status(404).json({ error: `Page with slug "${slug}" not found.` })

      const nowIso = new Date().toISOString()
      const prevMeta = (stage2._meta ?? {}) as Record<string, any>
      result.sitemap._meta = {
        ...prevMeta,
        // Inline label edits keep the sitemap APPROVED if it was approved —
        // these are cosmetic / non-structural. Slug changes invalidate
        // approval because downstream stages key off slugs.
        status: newSlug ? 'draft' : (prevMeta.status ?? 'draft'),
        last_inline_edit_at: nowIso,
        last_inline_edit_by: userData.user.email ?? userData.user.id,
      }
      await sb.from('strategy_web_projects').update({
        roadmap_state: { ...roadmapState, stage_2: result.sitemap },
      }).eq('id', projectId)
      return res.status(200).json({ ok: true, page: result.updatedPage, nav_updates: result.navUpdates })
    }

    if (action === 'reset_engine_state') {
      // Recovery action — clears engine_state so the strategist can
      // restart a stuck workflow without losing their sitemap, briefs,
      // or drafts. Used by the workspace when the engine has been in
      // an in-progress status (briefing/drafting/etc.) past the point
      // a real run would have finished, indicating the agent call
      // crashed mid-flight.
      await sb.from('strategy_web_projects').update({
        roadmap_state: { ...roadmapState, engine_state: {} },
      }).eq('id', projectId)
      return res.status(200).json({ ok: true, engine_state: {} })
    }

    if (action === 'revise_sitemap') {
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      if (!note) return res.status(400).json({ error: 'note (feedback) required for revise_sitemap' })
      const result = await draftSitemapWithAuditLoop({ sb, baseUrl, jwt, projectId, initialContext: note })
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'draft_sitemap_with_audit') {
      // Explicit invocation of the audit-loop sub-step. Same as the
      // path the apply(stage='sitemap') + revise_sitemap actions take
      // under the hood; exposed as a top-level action for clients that
      // want to trigger the loop without going through dispatch / route.
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const result = await draftSitemapWithAuditLoop({ sb, baseUrl, jwt, projectId, initialContext: note || undefined })
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'export_state') {
      // scope: 'full' (everything) | 'sitemap' (sitemap+audit only) |
      // 'copy' (drafts+briefs+audit+voice+snippets, no sitemap).
      const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'full'
      const result = await callAgent(baseUrl, jwt, 'export-state', { projectId, scope })
      return res.status(200).json({ ok: true, export: result })
    }

    if (action === 'import_state') {
      const document = typeof req.body?.document === 'string' ? req.body.document : ''
      if (!document) return res.status(400).json({ error: 'document required for import_state' })
      const result = await callAgent(baseUrl, jwt, 'import-state', { projectId, document })
      return res.status(200).json({ ok: true, import: result })
    }

    if (action === 'run_coverage_audit') {
      // Stage 2.5 — checks every Stage 0 topic against the Stage 2
      // sitemap. Strategist sees results at Gate 1 BEFORE approving
      // the sitemap. Auto-triggered by the client after sitemap revise
      // + on workspace mount when no audit exists yet.
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const result = await callAgent(baseUrl, jwt, 'sitemap-coverage',
        note ? { projectId, redoContext: note } : { projectId })
      return res.status(200).json({ ok: true, coverage: result })
    }

    if (action === 'approve_sitemap' || action === 'unlock_sitemap') {
      const stage2 = (roadmapState.stage_2 ?? {}) as Record<string, any>
      if (!stage2 || Object.keys(stage2).length === 0) {
        return res.status(400).json({ error: 'No stage_2 (sitemap) to approve' })
      }
      const stage2Meta = (stage2._meta ?? {}) as Record<string, any>
      const next = action === 'approve_sitemap'
        ? { ...stage2Meta, status: 'approved', approved_at: new Date().toISOString(), approved_by: userData.user.id }
        : { ...stage2Meta, status: 'draft', unlocked_at: new Date().toISOString() }
      await sb.from('strategy_web_projects').update({
        roadmap_state: { ...roadmapState, stage_2: { ...stage2, _meta: next } },
      }).eq('id', projectId)
      return res.status(200).json({ ok: true, sitemap_status: next.status })
    }

    if (action === 'run_drafts') {
      const updated = await runDrafts({ sb, projectId, jwt, baseUrl, roadmapState, engineState })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    if (action === 'critique') {
      const updated = await runCritique({ sb, projectId, jwt, baseUrl, roadmapState, engineState })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    if (action === 'iterate') {
      const maxLoops = typeof req.body?.maxLoops === 'number' ? req.body.maxLoops : MAX_LOOPS
      const updated = await runIterate({ sb, projectId, jwt, baseUrl, maxLoops })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    if (action === 'route') {
      const feedback = typeof req.body?.user_feedback === 'string' ? req.body.user_feedback.trim() : ''
      if (!feedback) return res.status(400).json({ error: 'user_feedback required for route' })
      const route = await callAgent(baseUrl, jwt, 'director', { projectId, mode: 'route', user_feedback: feedback })
      return res.status(200).json({ ok: true, route })
    }

    if (action === 'apply') {
      const dispatch = req.body?.dispatch
      if (!dispatch || typeof dispatch !== 'object') {
        return res.status(400).json({ error: 'dispatch object required for apply' })
      }
      const result = await applyDispatch({ sb, baseUrl, jwt, projectId, dispatch })
      return res.status(200).json({ ok: true, result })
    }

    if (action === 'commit') {
      const updated = await runCommit({ sb, projectId, jwt, baseUrl, roadmapState })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error('[orchestrate] error:', err?.message)
    await writeEngineState(sb, projectId, { ...engineState, status: 'error', last_error: err?.message ?? 'unknown', last_action_at: new Date().toISOString() })
    return res.status(500).json({ error: err?.message ?? 'orchestrate failed' })
  }
}

// ── Actions ───────────────────────────────────────────────────────────

async function runDrafts(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string
  roadmapState: Record<string, any>; engineState: Record<string, any>
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl, roadmapState } = ctx
  const stage1 = roadmapState.stage_1
  const stage2 = roadmapState.stage_2
  if (!stage1 || !stage2) throw new Error('Synthesize + Sitemap must be complete before run_drafts')

  await writeEngineState(sb, projectId, { ...ctx.engineState, status: 'briefing', current_phase: 'page_briefs', last_action_at: new Date().toISOString() })

  // Run page_briefs unconditionally on each run_drafts — briefs are
  // cheap to regenerate and ensure draft inputs are fresh.
  await callAgent(baseUrl, jwt, 'page-briefs', { projectId })

  const { data: refreshed } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const refreshedState = (refreshed?.roadmap_state ?? {}) as Record<string, any>
  const briefs = refreshedState.page_briefs ?? {}
  const slugs = Object.keys(briefs).filter(k => k !== '_meta')

  await writeEngineState(sb, projectId, {
    ...ctx.engineState,
    status: 'drafting',
    current_phase: 'page_drafts',
    pages_total: slugs.length,
    pages_drafted: 0,
    last_action_at: new Date().toISOString(),
  })

  // Drafts in parallel, capped at PAGE_DRAFT_CONCURRENCY.
  let drafted = 0
  for (let i = 0; i < slugs.length; i += PAGE_DRAFT_CONCURRENCY) {
    const chunk = slugs.slice(i, i + PAGE_DRAFT_CONCURRENCY)
    await Promise.all(chunk.map(async slug => {
      await callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: slug })
      drafted += 1
    }))
    await writeEngineState(sb, projectId, {
      ...ctx.engineState,
      status: 'drafting',
      current_phase: 'page_drafts',
      pages_total: slugs.length,
      pages_drafted: drafted,
      last_action_at: new Date().toISOString(),
    })
  }

  const finalState = {
    ...ctx.engineState,
    status: 'drafts_ready',
    current_phase: 'awaiting_critique',
    pages_total: slugs.length,
    pages_drafted: drafted,
    last_action_at: new Date().toISOString(),
  }
  await writeEngineState(sb, projectId, finalState)
  return finalState
}

async function runCritique(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string
  roadmapState: Record<string, any>; engineState: Record<string, any>
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl } = ctx
  await writeEngineState(sb, projectId, { ...ctx.engineState, status: 'critiquing', current_phase: 'director_critique', last_action_at: new Date().toISOString() })

  const critique = await callAgent(baseUrl, jwt, 'director', { projectId, mode: 'critique' })
  const verdict = critique?.critique?.overall_verdict ?? 'unknown'
  const directiveCount = Array.isArray(critique?.critique?.directives) ? critique.critique.directives.length : 0

  const next = {
    ...ctx.engineState,
    status: verdict === 'approved' ? 'ready_for_review' : 'needs_iteration',
    current_phase: verdict === 'approved' ? 'awaiting_final_review' : 'iterate',
    last_verdict: verdict,
    last_directive_count: directiveCount,
    last_action_at: new Date().toISOString(),
  }
  await writeEngineState(sb, projectId, next)
  return next
}

async function runIterate(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string; maxLoops: number
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl, maxLoops } = ctx

  for (let loop = 0; loop < maxLoops; loop++) {
    const { data: current } = await sb.from('strategy_web_projects')
      .select('roadmap_state').eq('id', projectId).maybeSingle()
    const state = (current?.roadmap_state ?? {}) as Record<string, any>
    const eng = (state.engine_state ?? {}) as Record<string, any>
    const critique = state.director_critique
    const directives = Array.isArray(critique?.directives) ? critique.directives : []

    if (!directives.length) {
      const done = { ...eng, status: 'ready_for_review', current_phase: 'awaiting_final_review', last_action_at: new Date().toISOString() }
      await writeEngineState(sb, projectId, done)
      return done
    }

    await writeEngineState(sb, projectId, {
      ...eng,
      status: 'iterating',
      current_phase: 'applying_directives',
      loop_count: (eng.loop_count ?? 0) + 1,
      last_action_at: new Date().toISOString(),
    })

    // Route each directive to the cheapest agent that can resolve it.
    // fix_kind is the director's explicit signal; stage_to_rerun is
    // the legacy fallback for older critiques that pre-date fix_kind.
    //
    //   slot_edit       → slot-edit agent (one slot)
    //   page_redraft    → page-draft   (whole page)
    //   brief_update    → page-briefs  (re-allocate atoms/persona)
    //   sitemap_redraft → draft-sitemap with audit loop
    //   synthesize_rework → extract-strategy
    //
    // Slot edits parallelize freely (narrow context, fast). Page
    // redrafts cap at PAGE_DRAFT_CONCURRENCY to avoid hammering the
    // gateway.
    const inferFixKind = (d: any): string => {
      if (typeof d?.fix_kind === 'string' && d.fix_kind) return d.fix_kind
      // Legacy directives without fix_kind — map from stage_to_rerun.
      const s = String(d?.stage_to_rerun ?? '')
      if (s === 'single_slot') return 'slot_edit'
      if (s === 'page_draft')  return 'page_redraft'
      if (s === 'page_briefs') return 'brief_update'
      if (s === 'sitemap')     return 'sitemap_redraft'
      if (s === 'synthesize')  return 'synthesize_rework'
      return 'page_redraft'
    }

    const slotEditDirectives = directives.filter((d: any) =>
      inferFixKind(d) === 'slot_edit' && d?.page_slug && d.page_slug !== '*' && d?.slot_locator)
    const pageRedraftDirectives = directives.filter((d: any) =>
      inferFixKind(d) === 'page_redraft' && d?.page_slug && d.page_slug !== '*')
    const otherDirectives = directives.filter((d: any) => {
      const k = inferFixKind(d)
      return k !== 'slot_edit' && k !== 'page_redraft'
    })

    // Slot edits in parallel (no cap — they're narrow + fast).
    if (slotEditDirectives.length > 0) {
      await Promise.all(slotEditDirectives.map((d: any) =>
        callAgent(baseUrl, jwt, 'slot-edit', {
          projectId,
          pageSlug:    d.page_slug,
          sectionIx:   d.slot_locator?.section_ix,
          slotKey:     d.slot_locator?.slot_key,
          instruction: d.note ?? '',
        }).catch((e: any) => {
          // Swallow individual slot-edit failures so one bad locator
          // doesn't kill the whole iterate loop.
          console.error('[iterate.slot-edit] failed for', d.page_slug, d.slot_locator, e?.message)
        })
      ))
    }

    // Page redrafts capped.
    for (let i = 0; i < pageRedraftDirectives.length; i += PAGE_DRAFT_CONCURRENCY) {
      const chunk = pageRedraftDirectives.slice(i, i + PAGE_DRAFT_CONCURRENCY)
      await Promise.all(chunk.map((d: any) =>
        callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: d.page_slug, feedback: d.note ?? '' })
      ))
    }

    // Everything else (brief_update / sitemap_redraft / synthesize_rework) via dispatch.
    for (const d of otherDirectives) {
      // Translate fix_kind back to stage_to_rerun for the legacy dispatcher.
      const kind = inferFixKind(d)
      const stage =
        kind === 'brief_update'       ? 'page_briefs' :
        kind === 'sitemap_redraft'    ? 'sitemap'     :
        kind === 'synthesize_rework'  ? 'synthesize'  :
        String(d.stage_to_rerun ?? '')
      await applyDispatch({ sb, baseUrl, jwt, projectId,
        dispatch: { stage_to_rerun: stage, page_slug: d.page_slug, note: d.note },
      })
    }

    // Re-critique
    await callAgent(baseUrl, jwt, 'director', { projectId, mode: 'critique' })
  }

  const { data: final } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const eng = ((final?.roadmap_state ?? {}).engine_state ?? {}) as Record<string, any>
  const out = { ...eng, status: 'ready_for_review', current_phase: 'awaiting_final_review', max_loops_hit: true, last_action_at: new Date().toISOString() }
  await writeEngineState(sb, projectId, out)
  return out
}

async function applyDispatch(ctx: {
  sb: any; baseUrl: string; jwt: string; projectId: string; dispatch: any
}): Promise<unknown> {
  const { baseUrl, jwt, projectId, dispatch } = ctx
  const stage = String(dispatch?.stage_to_rerun ?? '')
  const note = String(dispatch?.note ?? '')

  if (stage === 'synthesize') {
    return callAgent(baseUrl, jwt, 'extract-strategy', { projectId, redoContext: note })
  }
  if (stage === 'sitemap') {
    // Treat audit as a non-skippable sub-step of stage 2. The loop
    // drafts the sitemap, audits, and (up to SITEMAP_AUDIT_MAX_LOOPS
    // times) feeds the audit's gap findings back as redoContext so
    // the sitemap can self-correct. If the loop terminates without
    // the audit recommending proceed, _meta.audit_loop_status is set
    // to 'needs_human' so the workspace can warn the strategist.
    return draftSitemapWithAuditLoop({ sb: ctx.sb, baseUrl, jwt, projectId, initialContext: note || undefined })
  }
  if (stage === 'page_briefs') {
    return callAgent(baseUrl, jwt, 'page-briefs', { projectId, redoContext: note })
  }
  if (stage === 'page_draft') {
    const slug = dispatch?.page_slug
    if (!slug) throw new Error('page_draft dispatch requires page_slug')
    return callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: slug, feedback: note })
  }
  if (stage === 'single_slot') {
    const slug      = dispatch?.page_slug
    const sectionIx = typeof dispatch?.section_ix === 'number' ? dispatch.section_ix : null
    const slotKey   = typeof dispatch?.slot_key   === 'string' ? dispatch.slot_key   : null
    if (!slug) throw new Error('single_slot dispatch requires page_slug')
    if (sectionIx !== null && slotKey) {
      // Real single-slot rewrite via the slot-edit agent.
      return callAgent(baseUrl, jwt, 'slot-edit', {
        projectId, pageSlug: slug, sectionIx, slotKey, instruction: note,
      })
    }
    // Locator missing — fall back to a narrow page_draft re-run so
    // the request still lands SOMEWHERE rather than erroring.
    const focused = `Targeted rewrite. Section index ${dispatch?.section_ix ?? '?'}, slot ${dispatch?.slot_key ?? '?'}. ${note}`
    return callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: slug, feedback: focused })
  }
  if (stage === 'none') {
    return { ok: true, skipped: true }
  }
  throw new Error(`Unknown stage_to_rerun: ${stage}`)
}

/** Stage 2 sub-step: draft sitemap → audit → if gaps, redraft with
 *  the audit's findings as redoContext → re-audit. Loop terminates on:
 *    - audit recommends `proceed_to_stage_3` (success path)
 *    - loop count reaches SITEMAP_AUDIT_MAX_LOOPS (needs_human path)
 *    - the coverage agent itself errors (audit_failed — surfaced but
 *      not fatal; the sitemap still landed and the strategist can
 *      review manually)
 *
 *  Persists loop telemetry to stage_2._meta.audit_loop so the workspace
 *  can show the strategist what just happened (how many iterations,
 *  whether the audit terminated cleanly, residual gap count). */
async function draftSitemapWithAuditLoop(ctx: {
  sb: any; baseUrl: string; jwt: string; projectId: string; initialContext?: string
}): Promise<{
  sitemap: any
  audit: any
  audit_loop: {
    status: 'proceeded' | 'needs_human' | 'audit_failed'
    iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }>
    residual_gap_count: number
    message: string
  }
}> {
  const { sb, baseUrl, jwt, projectId, initialContext } = ctx
  let loopContext = initialContext ?? ''
  let lastSitemap: any = null
  let lastAuditResponse: any = null
  let lastAuditOutput: any = null
  const iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }> = []

  for (let loop = 0; loop <= SITEMAP_AUDIT_MAX_LOOPS; loop++) {
    lastSitemap = await callAgent(baseUrl, jwt, 'draft-sitemap',
      loopContext ? { projectId, redoContext: loopContext } : { projectId })

    try {
      lastAuditResponse = await callAgent(baseUrl, jwt, 'sitemap-coverage', { projectId })
      lastAuditOutput = lastAuditResponse?.output ?? lastAuditResponse
    } catch (e: any) {
      console.error('[draftSitemapWithAuditLoop] coverage failed:', e?.message)
      const auditLoop = {
        status: 'audit_failed' as const,
        iterations,
        residual_gap_count: 0,
        message: `Sitemap drafted but audit could not run (${e?.message ?? 'unknown error'}). Review manually before approving.`,
      }
      await persistAuditLoopMeta(sb, projectId, auditLoop)
      return { sitemap: lastSitemap, audit: null, audit_loop: auditLoop }
    }

    const recommended = String(lastAuditOutput?.recommended_action ?? '')
    const gapsCount = Array.isArray(lastAuditOutput?.gaps) ? lastAuditOutput.gaps.length : 0
    const identityGapsCount = Array.isArray(lastAuditOutput?.identity_gaps) ? lastAuditOutput.identity_gaps.length : 0
    const totalGaps = gapsCount + identityGapsCount
    iterations.push({ loop, gaps_count: totalGaps, recommended_action: recommended })

    if (recommended === 'proceed_to_stage_3') {
      const auditLoop = {
        status: 'proceeded' as const,
        iterations,
        residual_gap_count: totalGaps,
        message: loop === 0
          ? 'Initial sitemap cleared the coverage audit on the first pass.'
          : `Sitemap cleared the coverage audit after ${loop} fix-loop${loop === 1 ? '' : 's'}.`,
      }
      await persistAuditLoopMeta(sb, projectId, auditLoop)
      return { sitemap: lastSitemap, audit: lastAuditResponse, audit_loop: auditLoop }
    }

    if (loop >= SITEMAP_AUDIT_MAX_LOOPS) {
      const auditLoop = {
        status: 'needs_human' as const,
        iterations,
        residual_gap_count: totalGaps,
        message: `Audit still flagging ${totalGaps} gap${totalGaps === 1 ? '' : 's'} after ${SITEMAP_AUDIT_MAX_LOOPS} auto-fix attempt${SITEMAP_AUDIT_MAX_LOOPS === 1 ? '' : 's'}. Review the audit findings and either revise the sitemap manually or approve with the residual gaps acknowledged.`,
      }
      await persistAuditLoopMeta(sb, projectId, auditLoop)
      return { sitemap: lastSitemap, audit: lastAuditResponse, audit_loop: auditLoop }
    }

    loopContext = composeAuditContext(lastAuditOutput, loopContext, loop + 1)
  }

  // Unreachable — every branch above returns. Defensive fallback.
  const fallback = {
    status: 'needs_human' as const,
    iterations,
    residual_gap_count: 0,
    message: 'Audit loop exited unexpectedly. Review state manually.',
  }
  await persistAuditLoopMeta(sb, projectId, fallback)
  return { sitemap: lastSitemap, audit: lastAuditResponse, audit_loop: fallback }
}

/** Format coverage-audit findings as a structured natural-language
 *  note the draft-sitemap agent consumes as `redoContext`. Keeps
 *  prior strategist feedback in scope so an explicit ask doesn't
 *  get washed out by auto-fix items. */
function composeAuditContext(audit: any, prevContext: string, nextLoop: number): string {
  const lines: string[] = []
  lines.push(`# Audit fix-loop ${nextLoop} of ${SITEMAP_AUDIT_MAX_LOOPS}`)
  lines.push('')
  lines.push('The previous sitemap draft was evaluated by the coverage audit. Address the following findings in this redraft — fix the gaps, keep what already worked.')
  lines.push('')

  const gaps = Array.isArray(audit?.gaps) ? audit.gaps : []
  if (gaps.length > 0) {
    lines.push('## Topic gaps')
    for (const g of gaps.slice(0, 12)) {
      lines.push(`- **${g.topic_label ?? g.topic_key}** (${g.importance ?? 'medium'}): ${g.why_a_gap}`)
      if (g.suggested_fix) lines.push(`  Suggested fix: ${g.suggested_fix}`)
    }
    lines.push('')
  }

  const identityGaps = Array.isArray(audit?.identity_gaps) ? audit.identity_gaps : []
  if (identityGaps.length > 0) {
    lines.push('## Identity gaps (x-factor / project goals / persona needs)')
    for (const g of identityGaps.slice(0, 8)) {
      lines.push(`- **${g.label}** (${g.kind}): ${g.why_a_gap}`)
      if (g.suggested_fix) lines.push(`  Suggested fix: ${g.suggested_fix}`)
    }
    lines.push('')
  }

  const headerGaps = (Array.isArray(audit?.header_completeness_audit) ? audit.header_completeness_audit : [])
    .filter((h: any) => h && !h.has_visible_entry && h.severity !== 'low')
  if (headerGaps.length > 0) {
    lines.push('## Missing header nav categories')
    for (const h of headerGaps.slice(0, 6)) {
      lines.push(`- **${h.category}** (${h.severity}): ${h.rationale}`)
      if (h.suggested_fix) lines.push(`  Suggested fix: ${h.suggested_fix}`)
    }
    lines.push('')
  }

  const groupingIssues = (Array.isArray(audit?.grouping_audit) ? audit.grouping_audit : [])
    .filter((g: any) => g && g.issue !== 'clean' && g.severity !== 'low')
  if (groupingIssues.length > 0) {
    lines.push('## Nav grouping issues')
    for (const g of groupingIssues.slice(0, 6)) {
      lines.push(`- **${g.nav_path}** → ${g.parent_label} (${g.issue}, ${g.severity}): ${g.rationale}`)
      if (g.suggested_fix) lines.push(`  Suggested fix: ${g.suggested_fix}`)
    }
    lines.push('')
  }

  const voiceIssues = (Array.isArray(audit?.voice_audit) ? audit.voice_audit : [])
    .filter((v: any) => v && v.severity !== 'low')
  if (voiceIssues.length > 0) {
    lines.push('## Voice / label fixes')
    for (const v of voiceIssues.slice(0, 10)) {
      lines.push(`- "${v.current_label}" → "${v.suggested_label}" (${v.issue}, ${v.severity})`)
    }
    lines.push('')
  }

  if (prevContext) {
    lines.push('---')
    lines.push('## Strategist note from this revision (preserve)')
    lines.push(prevContext)
  }

  return lines.join('\n')
}

/** Stamp the audit-loop telemetry onto stage_2._meta.audit_loop so the
 *  UI can render the loop's outcome without recomputing it from scratch. */
async function persistAuditLoopMeta(sb: any, projectId: string, auditLoop: {
  status: string; iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }>
  residual_gap_count: number; message: string
}): Promise<void> {
  const { data: current } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const state = (current?.roadmap_state ?? {}) as Record<string, any>
  const stage2 = (state.stage_2 ?? {}) as Record<string, any>
  const stage2Meta = (stage2._meta ?? {}) as Record<string, any>
  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...state,
      stage_2: {
        ...stage2,
        _meta: {
          ...stage2Meta,
          audit_loop: { ...auditLoop, completed_at: new Date().toISOString() },
        },
      },
    },
  }).eq('id', projectId)
}

async function runCommit(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string
  roadmapState: Record<string, any>
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl, roadmapState } = ctx
  const drafts = roadmapState.page_drafts ?? {}
  const slugs = Object.keys(drafts).filter(k => k !== '_meta')

  const engineState = (roadmapState.engine_state ?? {}) as Record<string, any>
  await writeEngineState(sb, projectId, { ...engineState, status: 'committing', current_phase: 'page_bind', pages_committed: 0, pages_total: slugs.length, last_action_at: new Date().toISOString() })

  let committed = 0
  for (let i = 0; i < slugs.length; i += PAGE_DRAFT_CONCURRENCY) {
    const chunk = slugs.slice(i, i + PAGE_DRAFT_CONCURRENCY)
    await Promise.all(chunk.map(async slug => {
      await callAgent(baseUrl, jwt, 'page-bind', { projectId, pageSlug: slug })
      committed += 1
    }))
    await writeEngineState(sb, projectId, { ...engineState, status: 'committing', current_phase: 'page_bind', pages_committed: committed, pages_total: slugs.length, last_action_at: new Date().toISOString() })
  }

  const done = { ...engineState, status: 'committed', current_phase: 'done', pages_committed: committed, pages_total: slugs.length, last_action_at: new Date().toISOString() }
  await writeEngineState(sb, projectId, done)
  return done
}

// ── Helpers ───────────────────────────────────────────────────────────

async function callAgent(baseUrl: string, jwt: string, agentName: string, body: Record<string, unknown>): Promise<any> {
  const url = `${baseUrl}/api/web/agents/${agentName}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!r.ok) {
    throw new Error(`agent ${agentName} failed (${r.status}): ${json?.error ?? text}`)
  }
  return json
}

async function writeEngineState(sb: any, projectId: string, engineState: Record<string, any>): Promise<void> {
  const { data: current } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const state = (current?.roadmap_state ?? {}) as Record<string, any>
  await sb.from('strategy_web_projects').update({
    roadmap_state: { ...state, engine_state: engineState },
  }).eq('id', projectId)
}

/** Deterministic page rename — updates the matching page in
 *  stage_2.pages and any header_nav entry pointing at the same slug.
 *  Returns whether the page was found, the new sitemap, and a list
 *  of nav updates that landed (for telemetry). Pure function — no
 *  I/O, no LLM. */
function renameSitemapPage(
  stage2: Record<string, any>,
  edit: { slug: string; newName: string | null; newNavLabel: string | null; newSlug: string | null },
): { found: boolean; sitemap: Record<string, any>; updatedPage: Record<string, any> | null; navUpdates: string[] } {
  const next = JSON.parse(JSON.stringify(stage2)) as Record<string, any>
  const pages = Array.isArray(next.pages) ? next.pages : []
  const target = pages.find((p: any) => String(p?.slug ?? '') === edit.slug)
  if (!target) return { found: false, sitemap: next, updatedPage: null, navUpdates: [] }

  const navUpdates: string[] = []
  const oldSlug = String(target.slug)

  if (edit.newName != null && edit.newName.length > 0) target.name = edit.newName
  if (edit.newNavLabel != null) target.nav_label = edit.newNavLabel || undefined
  if (edit.newSlug != null && edit.newSlug.length > 0 && edit.newSlug !== oldSlug) {
    target.slug = edit.newSlug
    // Cascade slug change into parent_slug references.
    for (const p of pages) {
      if (p?.parent_slug === oldSlug) { p.parent_slug = edit.newSlug; navUpdates.push(`pages.${p.slug}.parent_slug → ${edit.newSlug}`) }
    }
  }

  // Header nav — update entries that point at the renamed slug.
  const walkNav = (entries: any[], path: string): void => {
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue
      if (e.kind === 'page' && String(e.slug ?? '') === oldSlug) {
        if (edit.newNavLabel != null && edit.newNavLabel.length > 0) {
          e.label = edit.newNavLabel
          navUpdates.push(`${path} label → ${edit.newNavLabel}`)
        } else if (edit.newName != null && edit.newName.length > 0) {
          e.label = edit.newName
          navUpdates.push(`${path} label → ${edit.newName}`)
        }
        if (edit.newSlug != null && edit.newSlug.length > 0 && edit.newSlug !== oldSlug) {
          e.slug = edit.newSlug
          navUpdates.push(`${path} slug → ${edit.newSlug}`)
        }
      }
      if (Array.isArray(e.children)) walkNav(e.children, `${path} > ${e.label ?? '?'}`)
    }
  }
  if (Array.isArray(next.header_nav)) walkNav(next.header_nav, 'header_nav')
  // Footer items also carry slugs — same treatment.
  if (Array.isArray(next.footer_nav)) {
    for (const section of next.footer_nav) {
      if (!Array.isArray(section?.items)) continue
      for (const item of section.items) {
        if (!item || typeof item !== 'object') continue
        if (String(item.slug ?? '') !== oldSlug) continue
        if (edit.newNavLabel != null && edit.newNavLabel.length > 0) {
          item.label = edit.newNavLabel
          navUpdates.push(`footer ${section.section_label} label → ${edit.newNavLabel}`)
        } else if (edit.newName != null && edit.newName.length > 0) {
          item.label = edit.newName
          navUpdates.push(`footer ${section.section_label} label → ${edit.newName}`)
        }
        if (edit.newSlug != null && edit.newSlug.length > 0 && edit.newSlug !== oldSlug) {
          item.slug = edit.newSlug
          navUpdates.push(`footer ${section.section_label} slug → ${edit.newSlug}`)
        }
      }
    }
  }

  return { found: true, sitemap: next, updatedPage: target, navUpdates }
}

function resolveBaseUrl(req: any): string {
  // Prefer the request's own origin so internal calls land on the same
  // deployment. Falls back to VERCEL_URL / localhost.
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  if (host) return `${proto}://${host}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
