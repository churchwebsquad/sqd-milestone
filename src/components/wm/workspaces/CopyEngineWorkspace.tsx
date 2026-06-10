/**
 * Copy Engine Workspace — the 2-gate replacement for the 8-stage stepper.
 *
 * Surfaces the redesigned self-sufficient copywriting engine. Strategist
 * sees only two gates:
 *
 *   Gate 1: Sitemap approval (current pipeline stages 1-2; reuses
 *           existing Synthesize + Sitemap actions in PlanningWorkspace
 *           upstream — this workspace shows the approved sitemap)
 *   Gate 2: Final review of bound copy (after Director loop converges)
 *
 * Between the gates: the orchestrator runs autonomously.
 *   run_drafts → critique → iterate → ready_for_review → commit
 *
 * Final-gate feedback goes to the Director's ROUTE mode, which classifies
 * it into a specific dispatch the engine executes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Play, Loader2, CheckCircle2, AlertCircle, RefreshCw, Send, FileText, GitBranch,
  ChevronRight, ChevronDown, Eye, Edit3, Wand2,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { StrategyWebProject } from '../../../types/database'
import { SitemapPreview as RichSitemapPreview } from '../pipeline/previews/SitemapPreview'
import { SitemapCoveragePreview } from '../pipeline/previews/SitemapCoveragePreview'

interface SitemapShape {
  pages?: Array<{ name: string; slug: string }>
  _meta?: { status?: string }
  [k: string]: unknown
}

interface PageBrief {
  page_slug?: string
  page_job?: string
  persona_focus?: { primary?: string; secondary?: string | null; rationale?: string }
  atoms_assigned?: Array<{ atom_id: string; treatment?: string; rationale?: string }>
  reference_atoms?: Array<{ atom_id: string; reason?: string }>
  voice_exemplars_to_imitate?: string[]
  voice_anti_exemplars_to_avoid?: string[]
  section_targets?: { section_count?: number; archetypes?: string[] }
  aeo_geo_targets?: { search_phrases?: string[]; answer_intents?: string[]; geo_anchors?: string[] }
}

interface EngineState {
  status?: string
  current_phase?: string
  pages_total?: number
  pages_drafted?: number
  pages_committed?: number
  last_verdict?: string
  last_directive_count?: number
  loop_count?: number
  max_loops_hit?: boolean
  last_action_at?: string
  last_error?: string
}

interface DirectorCritique {
  per_page?: Array<{
    page_slug: string
    // New 5-axis schema
    dignity?: number
    voice_character?: number
    persona_fit: number
    atom_coverage: number
    claim_plausibility?: number
    // Legacy 4-axis fields kept for back-compat with critiques written
    // before the Director prompt overhaul. Read the new field first
    // and fall back to the legacy one when rendering.
    voice_match?: number
    slot_health?: number
    standout_lines?: string[]
    problem_lines?: string[]
    summary?: string
  }>
  directives?: Array<{
    page_slug: string
    stage_to_rerun: string
    note: string
    severity: 'blocker' | 'warning' | 'nit'
  }>
  cross_page_findings?: Array<{ kind: string; description: string; pages?: string[] }>
  scores?: {
    // New 5-axis cross-page scores
    dignity?: number
    voice_character?: number
    persona_fit?: number
    claim_plausibility?: number
    // Legacy 4-axis (kept for back-compat)
    voice_consistency?: number
    persona_coverage?: number
    atom_coverage?: number
    slot_health?: number
    overall?: number
  }
  overall_verdict?: 'approved' | 'needs_revision' | 'needs_strategy_rework'
}

interface PageDraft {
  sections?: Array<{
    archetype: string
    copy?: Record<string, unknown>
    voice_notes?: string
  }>
  validation?: { ok?: boolean; flags?: unknown[]; unused_atoms?: string[] }
  _meta?: { redo_count?: number; generated_at?: string }
}

interface Dispatch {
  stage_to_rerun: string
  page_slug?: string | null
  section_ix?: number | null
  slot_key?: string | null
  note: string
}

interface RoutePayload {
  dispatch?: Dispatch
  rationale?: string
  alternative_dispatches?: Array<{ stage_to_rerun: string; why_rejected: string }>
}

interface Props {
  project: StrategyWebProject
  onChange?: () => void | Promise<void>
}

export function CopyEngineWorkspace({ project, onChange }: Props) {
  // Initialize from the prop's roadmap_state instead of empty objects.
  // The auto-cascades and Gate-2 visibility checks read these on
  // mount — if they start empty (the previous behavior), the cascade
  // mis-reads "no drafts" before refreshFromDB has a chance to land
  // and re-fires run_drafts (a $$$ tokens waste) and the Commit button
  // stays hidden. Seeding from props means the very first render
  // already reflects whatever's in the DB.
  const initialRoadmap = (project.roadmap_state ?? {}) as Record<string, any>
  const [engine,      setEngine]      = useState<EngineState>(() =>
    (initialRoadmap.engine_state ?? {}) as EngineState)
  const [critique,    setCritique]    = useState<DirectorCritique | null>(() =>
    (initialRoadmap.director_critique ?? null) as DirectorCritique | null)
  const [drafts,      setDrafts]      = useState<Record<string, PageDraft>>(() =>
    (initialRoadmap.page_drafts ?? {}) as Record<string, PageDraft>)
  const [briefs,      setBriefs]      = useState<Record<string, PageBrief>>(() =>
    (initialRoadmap.page_briefs ?? {}) as Record<string, PageBrief>)
  const [running,     setRunning]     = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [feedback,    setFeedback]    = useState('')
  const [routePreview, setRoutePreview] = useState<RoutePayload | null>(null)
  const [routing,     setRouting]     = useState(false)
  const [sitemapOpen, setSitemapOpen] = useState(false)
  const [revisingSitemap, setRevisingSitemap] = useState(false)
  const [sitemapFeedback, setSitemapFeedback] = useState('')
  const [sitemapConvo, setSitemapConvo] = useState<Array<{
    kind: 'user' | 'system' | 'pending' | 'error'
    text: string
    at: number
  }>>([])
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  useEffect(() => {
    if (!pendingStartedAt) { setElapsedSec(0); return }
    const tick = () => setElapsedSec(Math.floor((Date.now() - pendingStartedAt) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [pendingStartedAt])
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'iterate' | 'commit' | null>(null)
  const [coverageOpen, setCoverageOpen] = useState(false)
  const [autoCoverageStartedFor, setAutoCoverageStartedFor] = useState<string | null>(null)
  const [renamePanelOpen, setRenamePanelOpen] = useState(false)
  // Slug currently being saved — disables the row while the request is in flight.
  const [renameSavingSlug, setRenameSavingSlug] = useState<string | null>(null)

  const refreshFromDB = useCallback(async () => {
    const { data } = await supabase
      .from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', project.id)
      .maybeSingle()
    const state = ((data?.roadmap_state ?? {}) as Record<string, unknown>) || {}
    setEngine(((state.engine_state as EngineState) ?? {}))
    setCritique(((state.director_critique as DirectorCritique) ?? null))
    setDrafts(((state.page_drafts as Record<string, PageDraft>) ?? {}))
    setBriefs(((state.page_briefs as Record<string, PageBrief>) ?? {}))
  }, [project.id])

  useEffect(() => { void refreshFromDB() }, [refreshFromDB])

  // Tracks the AbortController for the currently-in-flight orchestrate
  // request. Stop-button click calls .abort() so the user gets
  // immediate UI feedback while the server-side cancel_run flag
  // propagates. cancel_run itself is fired with NO controller stored
  // here so it can't accidentally cancel itself.
  const activeAbortRef = useRef<AbortController | null>(null)
  const callOrchestrate = useCallback(async (
    action: string,
    extra: Record<string, unknown> = {},
    opts: { cancellable?: boolean } = {},
  ): Promise<unknown> => {
    // cancel_run + reset_engine_state need to bypass the active
    // controller so they can run WHILE another long action is in
    // flight. Default cancellable=true otherwise.
    const cancellable = opts.cancellable !== false
    const controller = new AbortController()
    if (cancellable) activeAbortRef.current = controller
    setRunning(action); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ projectId: project.id, action, ...extra }),
        signal: controller.signal,
      })
      const text = await res.text()
      let json: any = null
      try { json = JSON.parse(text) } catch { /* non-JSON response */ }
      if (!res.ok) {
        // json?.error can be a STRING (most server paths) OR an OBJECT
        // (some upstream errors propagate a structured payload through
        // multiple layers of err.message stringification, ending up as
        // an object in the final JSON). Stringify defensively so the
        // user sees the real message instead of "[object Object]".
        const errVal = json?.error
        let detail: string
        if (typeof errVal === 'string') detail = errVal
        else if (errVal != null) { try { detail = JSON.stringify(errVal) } catch { detail = String(errVal) } }
        else                     detail = text ? text.slice(0, 200) : ''
        throw new Error(`${action} → HTTP ${res.status}${detail ? ` · ${detail}` : ''}`)
      }
      await refreshFromDB()
      await onChange?.()
      return json
    } catch (e) {
      // AbortError surfaces from a Stop click — render as a quiet
      // "cancelled" rather than the loud red error banner, since the
      // user themselves asked for it.
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Cancelled.')
        return null
      }
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null
      setRunning(null)
    }
  }, [project.id, refreshFromDB, onChange])

  // Stop = abort the in-flight client fetch + tell the server to
  // bail at the next sub-step boundary. Sequence matters: fire
  // cancel_run FIRST (so the server flag is set before any
  // bail-if-cancelled check), then abort the client fetch.
  const handleStop = useCallback(async () => {
    // Fire cancel_run separately so its own fetch isn't bound to
    // the active controller. Don't await — we want the abort to
    // happen immediately.
    void callOrchestrate('cancel_run', {}, { cancellable: false })
    activeAbortRef.current?.abort()
  }, [callOrchestrate])

  const sitemap = useMemo<SitemapShape | null>(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const stage2 = rs?.stage_2 as SitemapShape | undefined
    return stage2 ?? null
  }, [project.roadmap_state])
  const hasStage2 = sitemap !== null
  // Pre-bind suggestions, keyed by page slug. Stored by the
  // suggest_bind_for_page orchestrate action; surfaced in DraftPreview
  // so the strategist reviews the bound preview at Gate 2, not just
  // the archetype-shaped draft.
  const bindSuggestions = useMemo<Record<string, {
    sections: Array<{
      section_ix: number; archetype: string
      chosen_template_id: string | null; chosen_layer_name: string | null
      candidate_count: number; rationale: string
    }>
    generated_at?: string
    user_overrides?: Record<string, string>
  }>>(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const raw = rs?.page_bind_suggestions
    return (raw && typeof raw === 'object' ? raw : {}) as never
  }, [project.roadmap_state])
  // Upstream stages — used to decide which setup CTA to render and
  // whether the auto-cascade should kick in.
  const hasStage0 = useMemo(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const s0 = rs?.stage_0 as Record<string, unknown> | undefined
    if (!s0) return false
    // Stage 0 only carries _meta — the actual atoms+facts land in
    // their own tables. Treat as "done" when there's a populated meta
    // with atom_count > 0 (the agent stamps this on every successful
    // run).
    const meta = s0._meta as { atom_count?: number } | undefined
    return typeof meta?.atom_count === 'number' && meta.atom_count > 0
  }, [project.roadmap_state])
  // Stage 0 / Stage 1 health — surfaces silent truncation, source-
  // coverage gaps, and significant drops vs prior runs so the user
  // doesn't proceed on a broken extraction. The flags below land
  // straight into a Setup Health banner above the gates.
  const stage0Meta = useMemo<{
    atom_count?: number; fact_count?: number
    truncation_suspected?: boolean
    significant_drop_vs_prior?: boolean
    atoms_delta_vs_prior?: number
    atoms_by_source?: Record<string, number>
    sources_loaded?: Record<string, boolean | number>
  } | null>(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const s0 = rs?.stage_0 as Record<string, unknown> | undefined
    return (s0?._meta as never) ?? null
  }, [project.roadmap_state])
  const stage1Meta = useMemo<{
    truncation_suspected?: boolean
    looks_empty?: boolean
    substantive_keys_count?: number
  } | null>(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const s1 = rs?.stage_1 as Record<string, unknown> | undefined
    return (s1?._meta as never) ?? null
  }, [project.roadmap_state])

  const hasStage1 = useMemo(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const s1 = rs?.stage_1 as Record<string, unknown> | undefined
    if (!s1) return false
    // _meta alone is NOT proof of completion — when extract-strategy's
    // tool_use response truncates mid-write, the _meta block lands but
    // every payload key (audience, voice_exemplars, personas, x_factor,
    // etc.) is missing. Treat as "done" only when at least one
    // substantive payload key is present. Otherwise the synthesize
    // button stays visible so the strategist can re-trigger.
    const SUBSTANTIVE_KEYS = [
      'audience', 'voice_exemplars', 'voice_anti_exemplars',
      'voice_characteristics', 'personas', 'x_factor', 'project_goals',
      'topic_coverage_plan', 'total_page_count',
    ]
    return SUBSTANTIVE_KEYS.some(k => {
      const v = s1[k]
      if (v == null) return false
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'object') return Object.keys(v as object).length > 0
      if (typeof v === 'string') return v.trim().length > 0
      return true
    })
  }, [project.roadmap_state])
  const draftSlugs = Object.keys(drafts).filter(k => k !== '_meta')
  const status = engine.status ?? 'idle'
  const sitemapApproved = sitemap?._meta?.status === 'approved'

  // ── Stage 2.5 coverage audit ───────────────────────────────────────
  //
  // Pulled from roadmap_state.stage_2_5. Auto-run when:
  //   1. A sitemap exists but no audit has been generated yet
  //   2. The sitemap was re-drafted after the last audit (stale)
  // The strategist sees the result inline at Gate 1 BEFORE deciding
  // to Approve — so they can act on coverage gaps without having
  // approval be the unlock for the audit (which is the chicken-and-
  // egg the legacy pipeline had).
  interface CoverageShape {
    recommended_action?: 'proceed_to_stage_3' | 'redo_stage_2_with_gaps'
    summary?:            { overall_coverage_score?: number }
    gaps?:               unknown[]
    identity_gaps?:      unknown[]
    _meta?:              { generated_at?: string }
    [k: string]: unknown
  }
  const coverage = useMemo<{ data: CoverageShape | null; generatedAt: string | null }>(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const stage25 = rs?.stage_2_5 as CoverageShape | undefined
    if (!stage25) return { data: null, generatedAt: null }
    return { data: stage25, generatedAt: stage25._meta?.generated_at ?? null }
  }, [project.roadmap_state])

  const sitemapGeneratedAt = (sitemap as { _meta?: { generated_at?: string } } | null)?._meta?.generated_at ?? null
  const coverageIsStale = !!sitemapGeneratedAt
    && !!coverage.generatedAt
    && new Date(coverage.generatedAt).getTime() < new Date(sitemapGeneratedAt).getTime()
  const coverageMissing = hasStage2 && coverage.data === null
  const coverageRunning = running === 'run_coverage_audit'
  const autoFixRunning  = running === 'draft_sitemap_with_audit'
  const pushToNavRunning = running === 'apply_audit_to_nav'
  const recommendedAction = coverage.data?.recommended_action ?? null
  const coverageGapCount =
    (coverage.data?.gaps?.length ?? 0) +
    (coverage.data?.identity_gaps?.length ?? 0)
  const auditLoopMeta = (sitemap as { _meta?: { audit_loop?: {
    status: 'proceeded' | 'needs_human' | 'audit_failed'
    iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }>
    residual_gap_count: number
    message: string
  } } } | null)?._meta?.audit_loop ?? null

  // Auto-trigger when sitemap exists + audit is missing or stale.
  // Track per-sitemap-timestamp so a single render doesn't fire it
  // twice (key = sitemap generated_at timestamp).
  useEffect(() => {
    if (!hasStage2) return
    if (coverageRunning) return
    if (running) return  // don't pile on while another action is in flight
    if (!coverageMissing && !coverageIsStale) return
    const key = sitemapGeneratedAt ?? 'unknown'
    if (autoCoverageStartedFor === key) return
    setAutoCoverageStartedFor(key)
    void callOrchestrate('run_coverage_audit')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStage2, coverageMissing, coverageIsStale, sitemapGeneratedAt])

  // ── Auto-cascade pre-Gate-1 (synthesize → sitemap with audit-loop) ──
  //
  // When a project lands in Copy Engine with intake complete but stage_1
  // and/or stage_2 missing, walk the engine forward without making the
  // strategist click between stages. Stops at Gate 1 (sitemap approval).
  // The user can still hit Re-run / Revise on either stage after.
  //
  // Per-project ref guard so a state change mid-cascade (synthesize
  // landing stage_1) doesn't re-trigger the synthesize call. The guard
  // resets only on project change, so re-opening the workspace later
  // (after the cascade already produced stage_2) is a no-op since the
  // top-level conditions won't match anyway.
  const cascadeStartedFor = useRef<string | null>(null)
  useEffect(() => {
    if (running) return
    if (cascadeStartedFor.current === project.id) return
    if (!hasStage0) return       // intake/normalization must be done
    if (hasStage2) return        // already past Gate 1's setup
    // Respect user's explicit Stop. The cancelled state lives in
    // engine_state until the user authorizes the next run by clicking
    // a button (or runs a stage manually). Without this guard the
    // cascade would immediately re-fire and undo their Stop.
    if (engine.status === 'cancelled') return
    cascadeStartedFor.current = project.id
    void (async () => {
      // Pre-Gate-1 cascade — new shape:
      // synthesize → acf-organizer → ministry-model → strategist → sitemap.
      // Each step writes to a different roadmap_state key so this is
      // idempotent — repeated invocations skip work that's already
      // landed (we read the latest state at each check).
      if (!hasStage1) {
        const ok = await callOrchestrate('run_synthesize')
        if (!ok) return
      }
      // Read current state to know what else has already landed.
      // (project.roadmap_state from the prop is stale within the
      // async closure — refreshFromDB has updated local state, but
      // we want to re-check after each step.)
      const isDone = (key: string) => {
        const rs = (project.roadmap_state ?? {}) as Record<string, unknown>
        return rs?.[key] != null
      }
      if (!isDone('acf_plan'))       await callOrchestrate('run_acf_organizer')
      if (!isDone('ministry_model')) await callOrchestrate('run_ministry_model')
      if (!isDone('site_strategy'))  await callOrchestrate('run_strategist')
      await callOrchestrate('draft_sitemap_with_audit')
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, hasStage0, hasStage1, hasStage2, engine.status])

  // ── Auto-heal upstream cascade ──────────────────────────────────────
  //
  // The pre-Gate-1 cascade above only fires when stage_2 is MISSING.
  // But a project can land in this workspace with stage_2 ALREADY
  // drafted on top of broken/empty upstream stages — e.g., the 3886
  // case where extract-strategy truncated to {_meta:{...}} and
  // downstream stages built on the void. The Setup Health banner
  // shows the user the failure, but the user shouldn't have to
  // CLICK to fix it. This effect detects broken upstream stages and
  // auto-re-cascades silently.
  //
  // Detection conditions (any one triggers a heal pass):
  //   - stage_1 fails the hasStage1 truthiness check (no substantive keys)
  //   - stage_1._meta.looks_empty === true (recent truncation flag)
  //   - acf_plan is missing entirely
  //   - ministry_model is missing entirely
  //   - site_strategy is missing entirely
  //
  // The heal walks the dependency chain and only re-runs what's
  // actually broken. Sitemap is NEVER auto-re-drafted by the heal —
  // a strategist who already approved a sitemap shouldn't see it
  // change underfoot. They can manually redraft from Gate 1's Revise
  // panel if they want a new sitemap built on the healed upstream.
  const upstreamHealStartedFor = useRef<string | null>(null)
  // Hoisted ahead of the auto-heal effect so the heal can null it out
  // when it clears a stale 'error' status — that lets the downstream
  // cascade fire a fresh attempt on the healed upstream without
  // requiring a page reload.
  const downstreamCascadeStartedFor = useRef<string | null>(null)
  useEffect(() => {
    if (running) return
    if (engineRunning) return
    if (upstreamHealStartedFor.current === project.id) return
    // Note: NO `!hasStage0 return` gate. Imported projects (user
    // uploaded a sitemap doc) skip stage_0 entirely — their
    // roadmap_state arrives with just stage_2 + stage_2_5. The
    // synthesize agent reads intake from DB tables (discovery,
    // brand guide, intake_documents) directly, not from stage_0,
    // so it can run fine on imported projects. Gating on stage_0
    // would leave imported projects permanently broken.
    if (engine.status === 'cancelled') return
    if (engine.status && ENGINE_IN_PROGRESS_STATUSES.has(engine.status)) return

    const rs = (project.roadmap_state ?? {}) as Record<string, unknown>
    const stage1Broken =
      !hasStage1 ||
      (stage1Meta?.looks_empty === true)
    const missingAcfPlan       = rs.acf_plan == null
    const missingMinistryModel = rs.ministry_model == null
    const missingSiteStrategy  = rs.site_strategy == null

    // Also detect projects where upstream is HEALED but engine_state
    // still carries a stale upstream-missing error from a prior
    // cascade attempt (e.g., engine.status='ready_for_review' but
    // last_error='page-outlines failed: upstream missing' and only
    // 8 of 21 pages got drafted because the other 13 errored out
    // before upstream was written). In that case there's nothing to
    // re-synthesize/re-classify, but the cleanup at the end of this
    // effect MUST still run so the downstream cascade can recover.
    const errMsg = String(engine.last_error ?? '').toLowerCase()
    const hasStaleUpstreamError =
      errMsg.includes('upstream stages missing') ||
      errMsg.includes('page-outlines failed') ||
      errMsg.includes('cannot draft a page outline')

    // Nothing to heal AND no stale error to clear — let the normal
    // cascade / Gate-1 flow proceed.
    if (!stage1Broken && !missingAcfPlan && !missingMinistryModel && !missingSiteStrategy && !hasStaleUpstreamError) return

    // The pre-Gate-1 cascade handles this case too. Don't double-fire.
    if (!hasStage2) return

    upstreamHealStartedFor.current = project.id
    void (async () => {
      // Heal in dependency order, skipping anything that's already healthy.
      if (stage1Broken) {
        const ok = await callOrchestrate('run_synthesize')
        if (!ok) return
      }
      if (missingAcfPlan)       await callOrchestrate('run_acf_organizer')
      if (missingMinistryModel) await callOrchestrate('run_ministry_model')
      if (missingSiteStrategy)  await callOrchestrate('run_strategist')
      // NB: deliberately skip sitemap re-draft. Strategist consent
      // required for that (they may have already approved). If the
      // healed strategist output wants a new sitemap, the user can
      // hit Revise on Gate 1 — that runs apply(stage='sitemap')
      // which now uses the fresh upstream context.

      // If a prior cascade attempt left the engine carrying a stale
      // upstream-missing error, clear engine_state so the downstream
      // cascade — newly gated on `upstreamReady` — can re-fire
      // automatically. We trigger this for ANY engine status that
      // carries the residual error, not just 'error':
      //
      //   - status='error'              → page-outlines 400 was the
      //                                     last thing that happened
      //   - status='ready_for_review'   → engine declared "done" on
      //                                     partial output (8 of 21
      //                                     drafted) but last_error
      //                                     still names the missing
      //                                     upstream that caused the
      //                                     other 13 to fail
      //   - status terminal (any other) → same: a stale error from
      //                                     a prior attempt that's no
      //                                     longer relevant
      //
      // The reset wipes engine_state.{status, last_error, current_phase,
      // loop_count, pages_*}. It does NOT touch page_outlines /
      // page_drafts / page_bind_suggestions — those are written under
      // separate roadmap_state keys, so resume on the next cascade
      // picks up only the genuinely missing slugs.
      const errMsg = String(engine.last_error ?? '').toLowerCase()
      const isUpstreamError =
        errMsg.includes('upstream stages missing') ||
        errMsg.includes('page-outlines failed') ||
        errMsg.includes('cannot draft a page outline')
      if (isUpstreamError) {
        await callOrchestrate('reset_engine_state')
        // Allow the downstream cascade to fire a fresh attempt now
        // that upstream is healed and engine_state is clear.
        downstreamCascadeStartedFor.current = null
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, hasStage1, hasStage2, stage1Meta?.looks_empty, engine.status, engine.last_error, running])

  const submitRoute = useCallback(async () => {
    if (!feedback.trim()) return
    setRouting(true); setRoutePreview(null)
    const result = await callOrchestrate('route', { user_feedback: feedback.trim() }) as { route?: RoutePayload } | null
    setRouting(false)
    if (result?.route) setRoutePreview(result.route)
  }, [feedback, callOrchestrate])

  const applyRoute = useCallback(async () => {
    if (!routePreview?.dispatch) return
    await callOrchestrate('apply', { dispatch: routePreview.dispatch })
    setRoutePreview(null)
    setFeedback('')
  }, [routePreview, callOrchestrate])

  // Live engine poller. Polls every 3s when EITHER:
  //   - our own runEngine cascade is in flight (engineRunning=true), OR
  //   - the DB engine_state says an in-progress status — meaning a
  //     cascade is running ON THE SERVER even if THIS tab didn't
  //     initiate it (e.g., user opened the tab mid-run; the orchestrate
  //     functions on Vercel are still writing pages).
  //
  // Without the second condition the user opens the tab during an
  // active run and the page sits frozen — local state shows whatever
  // landed at mount, no refresh, no "5 of 21" progress, no clue that
  // pages 6-21 are still landing every few seconds.
  const [engineRunning, setEngineRunning] = useState(false)

  // Phase-level progress telemetry for the long-running runEngine
  // cascade. Outlines + drafts + bind-suggestions each take 30-90s
  // per page over Anthropic Opus, so a 21-page sitemap is a 10-30
  // minute window. Without progress signal the user stares at
  // "Running run_page_outline_for_page…" with no clue whether it's
  // healthy or hung. This state drives the status banner: phase
  // label, X-of-Y count, current slug, elapsed time, and a rolling
  // ETA derived from average per-step duration so far.
  //
  // Reset on every runEngine entry; cleared in finally{}.
  type EnginePhaseLabel = 'outlines' | 'drafts' | 'critique' | 'iterate' | 'bind_suggestions' | 'upstream_heal' | null
  interface EnginePhaseProgress {
    label:           EnginePhaseLabel
    pretty:          string                  // human-readable phase name
    completed:       number
    total:           number
    currentSlug:     string | null
    startedAt:       number                  // ms epoch when this phase began
    perStepMs:       number[]                // duration of each completed step (for avg + ETA)
  }
  const [enginePhase, setEnginePhase] = useState<EnginePhaseProgress | null>(null)
  const dbEngineInProgress = engine.status != null && ENGINE_IN_PROGRESS_STATUSES.has(engine.status)
  const shouldPoll = engineRunning || dbEngineInProgress
  useEffect(() => {
    if (!shouldPoll) return
    let cancelled = false
    const poll = async () => {
      const { data } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', project.id)
        .maybeSingle()
      if (cancelled) return
      const state = ((data?.roadmap_state ?? {}) as Record<string, unknown>) || {}
      setEngine(((state.engine_state as EngineState) ?? {}))
      setCritique(((state.director_critique as DirectorCritique) ?? null))
      setDrafts(((state.page_drafts as Record<string, PageDraft>) ?? {}))
      setBriefs(((state.page_briefs as Record<string, PageBrief>) ?? {}))
    }
    const id = window.setInterval(poll, 3000)
    void poll()
    return () => { cancelled = true; window.clearInterval(id) }
  }, [shouldPoll, project.id])

  // Chains run_drafts → critique → iterate (if directives). The orchestrator
  // already implements iterate as a self-contained loop server-side; this
  // function just sequences the three top-level actions so the strategist
  // doesn't have to click between them.
  const runEngine = useCallback(async (): Promise<void> => {
    setEngineRunning(true)
    try {
      // Refactor-wave cascade (post-Gate-1). Replaces the old
      // run_briefs → draft_one_page → critique → iterate → bind chain
      // with: outlines per page → drafts per page (auto-iterate-
      // until-resolved) → critique → iterate (Director kept) → bind
      // suggestions. The page-outlines step is what was missing —
      // it's the bridge between atom inventory and copy that the
      // old page-briefs path lost.
      //
      // Idempotent resume: each phase reads CURRENT roadmap_state
      // and skips slugs whose output already landed. So Re-run after
      // a partial completion picks up at exactly the missing pages,
      // not from zero. Server-side draft_page_until_resolved is
      // expensive (1-3 Anthropic calls per page); we will not pay
      // that for slugs that already have a passing draft.
      const sitemapPages = ((sitemap as { pages?: Array<{ slug: string }> } | null)?.pages ?? [])
      const slugs = sitemapPages.map(p => p.slug).filter(Boolean) as string[]
      if (slugs.length === 0) return

      // Read latest state inside the closure — local `drafts` /
      // `roadmap_state.page_outlines` may be stale relative to a
      // sibling cascade or a prior run within this session.
      const readState = async (): Promise<Record<string, unknown>> => {
        const { data } = await supabase
          .from('strategy_web_projects')
          .select('roadmap_state')
          .eq('id', project.id)
          .maybeSingle()
        return ((data?.roadmap_state ?? {}) as Record<string, unknown>) || {}
      }
      let initialState = await readState()

      // PHASE 0 — UPSTREAM HEAL. Page-outlines + page-draft + director
      // all reject with 400 if site_strategy / ministry_model / stage_1
      // is missing. The auto-heal effect on the workspace handles this
      // when the user lands on the project, but the Approve & Run
      // button calls runEngine() DIRECTLY without going through the
      // heal effect — so an imported project whose upstream chain was
      // never run (e.g., user uploaded a sitemap doc that only had
      // stage_2) blows up on the first page-outlines call.
      //
      // Inline the heal here so runEngine is self-contained: if the
      // upstream chain isn't complete, run it before any page work.
      // Each agent is idempotent (returns 200 with cached state if its
      // slot already exists), and the atomic JSONB writes in v68 mean
      // these calls can no longer race each other into oblivion.
      const needsSynthesize  = initialState.stage_1        == null
      const needsAcfPlan     = initialState.acf_plan       == null
      const needsMinistry    = initialState.ministry_model == null
      const needsStrategist  = initialState.site_strategy  == null
      const upstreamSteps =
        Number(needsSynthesize) + Number(needsAcfPlan) +
        Number(needsMinistry)   + Number(needsStrategist)
      if (upstreamSteps > 0) {
        setEnginePhase({
          label: 'upstream_heal',
          pretty: 'Healing strategy foundation',
          completed: 0,
          total: upstreamSteps,
          currentSlug: null,
          startedAt: Date.now(),
          perStepMs: [],
        })
        const stepDurations: number[] = []
        const runStep = async (
          name: string,
          action: 'run_synthesize' | 'run_acf_organizer' | 'run_ministry_model' | 'run_strategist',
        ): Promise<boolean> => {
          setEnginePhase(p => p && ({ ...p, currentSlug: name }))
          const stepStart = Date.now()
          const ok = await callOrchestrate(action)
          stepDurations.push(Date.now() - stepStart)
          setEnginePhase(p => p && ({
            ...p,
            completed: p.completed + 1,
            currentSlug: null,
            perStepMs: [...stepDurations],
          }))
          return !!ok
        }
        if (needsSynthesize)  { if (!(await runStep('synthesize',    'run_synthesize')))      return }
        if (needsAcfPlan)     {       await runStep('acf_plan',      'run_acf_organizer')         }
        if (needsMinistry)    {       await runStep('ministry_model','run_ministry_model')        }
        if (needsStrategist)  {       await runStep('site_strategy', 'run_strategist')            }
        // Re-read so the outline / draft / critique phases see what
        // the heal just wrote.
        initialState = await readState()
      }

      const existingOutlines = (initialState.page_outlines ?? {}) as Record<string, unknown>
      const existingDrafts   = (initialState.page_drafts   ?? {}) as Record<string, unknown>

      // SERIALIZED on purpose, even though the v68 atomic JSONB merge
      // means parallel writes no longer corrupt sibling keys. The
      // serialization remains a cost guard: each page-outlines /
      // page-draft call is 30-90s of LLM time, and running them in
      // chunks would only save wall-clock if Vercel could parallelize
      // the function instances — which it does, but with no benefit
      // to the strategist since the engine still has to wait for ALL
      // pages before critique runs. Stays serial.
      //
      // Phase 1: page-outlines per slug. Skip slugs that already
      // have an outline landed (resume semantic).
      const slugsNeedingOutlines = slugs.filter(s => existingOutlines[s] == null)
      if (slugsNeedingOutlines.length > 0) {
        setEnginePhase({
          label: 'outlines',
          pretty: 'Outlining pages',
          completed: 0,
          total: slugsNeedingOutlines.length,
          currentSlug: slugsNeedingOutlines[0],
          startedAt: Date.now(),
          perStepMs: [],
        })
        const stepDurations: number[] = []
        for (let i = 0; i < slugsNeedingOutlines.length; i++) {
          const slug = slugsNeedingOutlines[i]
          // Snapshot start BEFORE the network call so the duration
          // reflects actual server time, not React batching latency.
          const stepStart = Date.now()
          setEnginePhase(p => p && ({ ...p, currentSlug: slug }))
          await callOrchestrate('run_page_outline_for_page', { pageSlug: slug })
          stepDurations.push(Date.now() - stepStart)
          setEnginePhase(p => p && ({
            ...p,
            completed: i + 1,
            currentSlug: slugsNeedingOutlines[i + 1] ?? null,
            perStepMs: [...stepDurations],
          }))
        }
      }

      // Phase 2: draft each page WITH auto-iterate-until-resolved.
      // The server-side helper retries up to 3 times per page on
      // truncation / atom-resolution failure / validation flags.
      // Half-done pages never reach Gate 2 — they're either resolved
      // OR marked blocked_missing_input with the specific gap named.
      // Resume semantic: skip slugs that already have a draft
      // landed (regardless of flags — that's a separate Iterate
      // concern, not a "page never got written" concern).
      const slugsNeedingDrafts = slugs.filter(s => existingDrafts[s] == null)
      if (slugsNeedingDrafts.length > 0) {
        setEnginePhase({
          label: 'drafts',
          pretty: 'Drafting pages',
          completed: 0,
          total: slugsNeedingDrafts.length,
          currentSlug: slugsNeedingDrafts[0],
          startedAt: Date.now(),
          perStepMs: [],
        })
        const stepDurations: number[] = []
        for (let i = 0; i < slugsNeedingDrafts.length; i++) {
          const slug = slugsNeedingDrafts[i]
          const stepStart = Date.now()
          setEnginePhase(p => p && ({ ...p, currentSlug: slug }))
          await callOrchestrate('draft_page_until_resolved', { pageSlug: slug })
          stepDurations.push(Date.now() - stepStart)
          setEnginePhase(p => p && ({
            ...p,
            completed: i + 1,
            currentSlug: slugsNeedingDrafts[i + 1] ?? null,
            perStepMs: [...stepDurations],
          }))
        }
      }

      // Phase 3: Director critique + iterate (kept per user direction).
      // Director still emits per-page scores + directives for the
      // feedback panel + routing at Gate 2. Iterate runs slot-edits
      // on any non-empty directives (em-dash cleanup pass, etc.).
      // Critique always re-runs on resume — adding pages changes the
      // cross-page picture, so the prior critique is stale.
      setEnginePhase({
        label: 'critique',
        pretty: 'Director critiquing drafts',
        completed: 0,
        total: 1,
        currentSlug: null,
        startedAt: Date.now(),
        perStepMs: [],
      })
      const critiqueResult = await callOrchestrate('critique') as { engine_state?: EngineState } | null
      if (!critiqueResult) return
      const directiveCount = critiqueResult.engine_state?.last_directive_count ?? 0
      if (directiveCount > 0) {
        setEnginePhase({
          label: 'iterate',
          pretty: `Iterating on ${directiveCount} director directive${directiveCount === 1 ? '' : 's'}`,
          completed: 0,
          total: 1,
          currentSlug: null,
          startedAt: Date.now(),
          perStepMs: [],
        })
        await callOrchestrate('iterate')
      }

      // Phase 4: pre-bind suggestion per page (BEFORE Gate 2). Per-
      // section template pick + swap UI lives at Gate 2. Suggestions
      // store on roadmap_state.page_bind_suggestions[slug] — web_sections
      // rows don't land until Commit.
      //
      // ONLY iterate over slugs that ACTUALLY HAVE A DRAFT. The prior
      // version iterated over every sitemap slug, which 404'd on pages
      // whose draft never landed (the "No draft found for page 'privacy'"
      // error). When upstream phases drop pages, suggest_bind_for_page
      // can't do anything for them — let those land at Gate 2 as
      // visibly-incomplete instead of throwing 404s the user has to
      // decode.
      const postDraftState = await readState()
      const postDraftDrafts = (postDraftState.page_drafts ?? {}) as Record<string, unknown>
      const existingSuggestions = (postDraftState.page_bind_suggestions ?? {}) as Record<string, unknown>
      const slugsWithDrafts = slugs.filter(s => postDraftDrafts[s] != null && s !== '_meta')
      const slugsNeedingBindSuggestions = slugsWithDrafts.filter(s => existingSuggestions[s] == null)
      if (slugsNeedingBindSuggestions.length > 0) {
        setEnginePhase({
          label: 'bind_suggestions',
          pretty: 'Suggesting Brixies templates',
          completed: 0,
          total: slugsNeedingBindSuggestions.length,
          currentSlug: slugsNeedingBindSuggestions[0],
          startedAt: Date.now(),
          perStepMs: [],
        })
        const stepDurations: number[] = []
        for (let i = 0; i < slugsNeedingBindSuggestions.length; i++) {
          const slug = slugsNeedingBindSuggestions[i]
          const stepStart = Date.now()
          setEnginePhase(p => p && ({ ...p, currentSlug: slug }))
          await callOrchestrate('suggest_bind_for_page', { pageSlug: slug })
          stepDurations.push(Date.now() - stepStart)
          setEnginePhase(p => p && ({
            ...p,
            completed: i + 1,
            currentSlug: slugsNeedingBindSuggestions[i + 1] ?? null,
            perStepMs: [...stepDurations],
          }))
        }
      }
    } finally {
      setEngineRunning(false)
      setEnginePhase(null)
    }
  }, [callOrchestrate, sitemap, project.id])

  // ── Auto-cascade post-Gate-1 (drafts → critique → iterate) ──────────
  //
  // Resume semantic: if the strategist approved the sitemap and the
  // cascade either never ran or ran partially (e.g., 8 of 21 pages
  // drafted before a Vercel timeout / page reload / context drop),
  // pick up where they left off. The runEngine implementation is now
  // idempotent — it reads current roadmap_state and skips outlines /
  // drafts / bind-suggestions that already landed.
  //
  // Fires when:
  //   - sitemap approved
  //   - drafts are MISSING for at least one sitemap slug (covers both
  //     zero-drafts AND partial-drafts cases)
  //   - engine isn't actively running (server-side or this tab)
  //   - engine isn't stuck (8min threshold — user must Reset first)
  //   - engine status isn't terminal (ready_for_review / committed —
  //     those are user-action states, not "fire automatically" states)
  //
  // The downstreamCascadeStartedFor ref prevents re-fire loops when
  // state updates mid-run.
  const sitemapSlugCount = useMemo(() => {
    const pages = (sitemap as { pages?: Array<{ slug: string }> } | null)?.pages ?? []
    return pages.filter(p => Boolean(p?.slug)).length
  }, [sitemap])
  const draftsIncomplete = sitemapSlugCount > 0 && draftSlugs.length < sitemapSlugCount
  // page-outlines (the first phase of runEngine) HARD-REQUIRES
  // site_strategy + ministry_model + stage_2 in roadmap_state. If
  // those aren't there, the agent returns 400 "Required upstream
  // stages missing" and the engine errors. The upstream auto-heal
  // effect writes those keys, but it runs IN PARALLEL with this
  // downstream cascade — so without this gate the downstream fires
  // first, page-outlines 400s, and the engine sits in an error
  // state until the user clicks something. Gate downstream behind
  // a fully-healed upstream so the auto-heal pass can land its
  // writes first. (downstreamCascadeStartedFor ref is hoisted above
  // the auto-heal effect so the heal can null it out after clearing
  // a stale error state.)
  const upstreamReady = useMemo(() => {
    const rs = (project.roadmap_state ?? {}) as Record<string, unknown>
    return rs.site_strategy != null && rs.ministry_model != null
  }, [project.roadmap_state])
  useEffect(() => {
    if (running) return
    if (engineRunning) return
    if (!sitemapApproved) return
    if (!upstreamReady) return                     // wait for auto-heal to finish writing site_strategy + ministry_model
    if (!draftsIncomplete) return                  // all sitemap pages have drafts — done
    if (isEngineStuck(engine, false)) return       // user must hit Reset first
    if (engine.status && ENGINE_IN_PROGRESS_STATUSES.has(engine.status)) return
    if (engine.status && ENGINE_TERMINAL_STATUSES.has(engine.status)) return
    if (downstreamCascadeStartedFor.current === project.id) return
    downstreamCascadeStartedFor.current = project.id
    void runEngine()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, sitemapApproved, upstreamReady, draftsIncomplete, engine.status, running, engineRunning])

  const openDraft = useCallback((slug: string) => {
    if (!slug || slug === '*') return
    if (!Object.prototype.hasOwnProperty.call(drafts, slug)) return
    setExpandedDraft(slug)
    requestAnimationFrame(() => {
      const el = document.getElementById(`copy-engine-draft-${slug}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [drafts])

  const submitSitemapRevision = useCallback(async () => {
    const note = sitemapFeedback.trim()
    if (!note) return
    const startedAt = Date.now()
    const oldPageCount = (sitemap?.pages?.length ?? 0)
    const oldSitemapSnapshot = sitemap
    const oldGeneratedAt = (sitemap as { _meta?: { generated_at?: string } } | null)?._meta?.generated_at ?? null
    setPendingStartedAt(startedAt)
    setSitemapConvo(c => [
      ...c,
      { kind: 'user', text: note, at: startedAt },
      { kind: 'pending', text: 'Re-drafting sitemap…', at: startedAt + 1 },
    ])
    setSitemapFeedback('')

    // Poll the DB every 5s so the strategist sees the new sitemap land
    // in the preview above as soon as draft-sitemap writes it, even if
    // the orchestrate fetch hasn't yet returned. The fetch still
    // completes normally — polling is just early-paint, not a
    // replacement for the response.
    const pollId = window.setInterval(async () => {
      const { data } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', project.id)
        .maybeSingle()
      const s = (data?.roadmap_state as Record<string, any> | null)?.stage_2 as
        { _meta?: { generated_at?: string } } | undefined
      if (s?._meta?.generated_at && s._meta.generated_at !== oldGeneratedAt) {
        await onChange?.()  // surface the new sitemap into project.roadmap_state
      }
    }, 5000)

    const result = await callOrchestrate('apply', {
      dispatch: { stage_to_rerun: 'sitemap', note },
    })

    window.clearInterval(pollId)
    setPendingStartedAt(null)
    setSitemapConvo(c => {
      const trimmed = c.filter(t => t.kind !== 'pending')
      if (!result) {
        return [...trimmed, { kind: 'error', text: 'Re-draft failed. See banner above and try again.', at: Date.now() }]
      }
      return trimmed
    })
    if (result) {
      const { data } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', project.id)
        .maybeSingle()
      const newSitemap = (data?.roadmap_state as Record<string, any> | null)?.stage_2 as SitemapShape | undefined
      const newPageCount = newSitemap?.pages?.length ?? 0
      const delta = newPageCount - oldPageCount
      const tookSec = Math.round((Date.now() - startedAt) / 1000)
      const diff = diffSitemaps(oldSitemapSnapshot, newSitemap)
      const diffLines = formatSitemapDiff(diff)
      const countSummary =
        delta === 0 ? `${newPageCount} pages (no change in count)`
        : delta > 0 ? `${newPageCount} pages (+${delta})`
        : `${newPageCount} pages (${delta})`

      // Surface audit-loop telemetry stamped by the orchestrator. The
      // loop ran draft-sitemap → coverage → (up to 2x) fix-and-redraft.
      // Strategist sees how the loop terminated so they know whether to
      // approve, revise further, or accept residual gaps.
      const auditLoop = (newSitemap as { _meta?: { audit_loop?: {
        status: 'proceeded' | 'needs_human' | 'audit_failed'
        iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }>
        residual_gap_count: number
        message: string
      } } } | undefined)?._meta?.audit_loop
      const loopLine = auditLoop
        ? (auditLoop.status === 'proceeded'
            ? `✓ Audit loop: ${auditLoop.message}`
            : auditLoop.status === 'needs_human'
              ? `⚠ Audit loop: ${auditLoop.message}`
              : `· Audit loop: ${auditLoop.message}`)
        : null

      let body: string
      if (diffLines.length > 0) {
        const bullets = diffLines.map(l => `• ${l}`).join('\n')
        body = `Done in ${tookSec}s. ${countSummary}.\n\nChanges:\n${bullets}\n\nReview the preview above. Send another revision, or click Approve when ready.`
      } else if (diff.rawJsonChanged) {
        body = `Done in ${tookSec}s. ${countSummary}.\n\nThe sitemap changed but the structural diff didn't catch a category (likely a rationale, strategic_purpose, or nav_presentation tweak). Compare the preview above against the prior state to confirm. If your specific ask isn't visible, re-send with more concrete instructions (e.g. quote the exact label to change and the new label to use).`
      } else {
        body = `Done in ${tookSec}s. ${countSummary}.\n\nNo changes detected — the model returned the same sitemap byte-for-byte. The Director may have decided your feedback was already met, or the re-draft missed the ask. Try being more specific about what to change, naming exact labels or slugs.`
      }
      if (loopLine) body = `${loopLine}\n\n${body}`
      setSitemapConvo(c => [...c, { kind: 'system', text: body, at: Date.now() }])
    }
  }, [sitemapFeedback, callOrchestrate, sitemap, project.id, onChange])

  return (
    <div className="px-4 md:px-6 py-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-wm-text">Copy Engine</h2>
          <p className="text-[13px] text-wm-text-muted mt-1">
            Self-sufficient. Two human gates: sitemap, then final review.
          </p>
        </div>
        <button
          onClick={() => void refreshFromDB()}
          className="text-[11px] text-wm-text-muted hover:text-wm-text inline-flex items-center gap-1"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </header>

      <StatusBanner
        engine={engine}
        stuck={isEngineStuck(engine, engineRunning || !!running)}
        onReset={() => void callOrchestrate('reset_engine_state')}
        resetBusy={running === 'reset_engine_state'}
      />

      {/* Setup Health banner — surfaces Stage 0 / Stage 1 issues
          BEFORE the user wastes a draft cycle on broken upstream
          data. Shows when the agent flagged truncation, when the
          atom count fell off vs the prior run, when Stage 1's
          payload looks empty, or when a source contributed zero
          atoms. Each row carries a one-click re-run for the
          affected stage. */}
      <SetupHealthBanner
        stage0Meta={stage0Meta}
        stage1Meta={stage1Meta}
        hasStage1={hasStage1}
        onReNormalize={() => void callOrchestrate('run_normalize')}
        onReSynthesize={() => void callOrchestrate('run_synthesize')}
        running={running}
      />

      {/* In-flight banner — visible whenever any orchestrate action or
          the runEngine cascade is mid-flight. Gives the user an
          always-on Stop affordance, plus visibility into what the
          engine is doing without hunting for the spinner on a
          specific button. */}
      <InFlightBanner
        running={running}
        engineRunning={engineRunning}
        engine={engine}
        onStop={() => void handleStop()}
        stopping={running === 'cancel_run'}
      />

      {error && (
        <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 text-[13px] text-wm-danger">
          {error}
        </div>
      )}

      {/* Gate 1 — Sitemap approval. Card is expandable so the strategist
          can review what they're approving before clicking. */}
      <div className="rounded-lg border border-wm-border bg-wm-bg-elevated">
        <div className="p-3 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Gate 1</span>
          {sitemapApproved
            ? <CheckCircle2 size={16} className="text-wm-success" />
            : <AlertCircle size={16} className={hasStage2 ? 'text-wm-warning' : 'text-wm-text-subtle'} />}
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-wm-text">Sitemap approval</p>
            <p className="text-[11px] text-wm-text-muted">
              {sitemapApproved
                ? `Approved. ${sitemap?.pages?.length ?? 0} pages.`
                : hasStage2
                  ? `A sitemap exists (${sitemap?.pages?.length ?? 0} pages). Review below and approve to unlock the engine.`
                  : !hasStage1
                    ? 'Strategy synthesis is missing. Start by synthesizing the intake into a strategic foundation.'
                    : 'Strategy is ready. Draft a sitemap to open Gate 1.'}
            </p>
          </div>
          {!hasStage2 && !hasStage1 && (
            <button
              onClick={() => void callOrchestrate('run_synthesize')}
              disabled={!!running || !hasStage0}
              title={!hasStage0
                ? 'Stage 0 (intake normalization) must finish first — check the Intake & Crawl tab.'
                : 'Synthesize the brief, AM handoff, discovery, brand handoff, and content collection into a strategic foundation. ~2–3 min.'}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
            >
              {running === 'run_synthesize' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Synthesize strategy
            </button>
          )}
          {!hasStage2 && hasStage1 && (
            <button
              onClick={() => void callOrchestrate('draft_sitemap_with_audit')}
              disabled={!!running}
              title="Draft a sitemap from the strategy, then auto-run a coverage audit. If the audit flags gaps, the sitemap self-corrects (capped at 2 fix-loops). ~3–5 min."
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
            >
              {running === 'draft_sitemap_with_audit' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Draft sitemap (with auto-audit)
            </button>
          )}
          {hasStage2 && (
            <button
              onClick={() => setSitemapOpen(s => !s)}
              className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1"
            >
              {sitemapOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {sitemapOpen ? 'Hide' : 'View'}
            </button>
          )}
          {hasStage2 && (
            <button
              onClick={() => setRenamePanelOpen(o => !o)}
              disabled={!!running}
              className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
              title="Quick rename — edit page names and nav labels in place. No LLM call."
            >
              <Edit3 size={12} /> {renamePanelOpen ? 'Done renaming' : 'Rename pages'}
            </button>
          )}
          {hasStage2 && (
            <button
              onClick={() => { setRevisingSitemap(true); setSitemapOpen(true) }}
              disabled={!!running}
              className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
            >
              <Edit3 size={12} /> Revise
            </button>
          )}
          {hasStage2 && !sitemapApproved && (
            <button
              onClick={async () => {
                const ok = await callOrchestrate('approve_sitemap')
                if (ok) {
                  setRevisingSitemap(false)
                  await runEngine()
                }
              }}
              disabled={!!running}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] text-white disabled:opacity-50',
                recommendedAction === 'redo_stage_2_with_gaps'
                  ? 'bg-wm-warning hover:bg-wm-warning/90'
                  : 'bg-wm-accent',
              ].join(' ')}
              title={recommendedAction === 'redo_stage_2_with_gaps'
                ? `Coverage audit flagged ${coverageGapCount} gap${coverageGapCount === 1 ? '' : 's'}. Approving anyway is allowed — but review the coverage panel below first.`
                : undefined}
            >
              {running === 'approve_sitemap' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Approve & run
              {recommendedAction === 'redo_stage_2_with_gaps' && coverageGapCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/30 text-[10px] font-bold">
                  {coverageGapCount}
                </span>
              )}
            </button>
          )}
          {hasStage2 && sitemapApproved && (
            <button
              onClick={() => void callOrchestrate('unlock_sitemap')}
              disabled={!!running}
              className="text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1"
            >
              Unlock
            </button>
          )}
        </div>
        {revisingSitemap && hasStage2 && (
          <div className="border-t border-wm-border px-3 py-3 bg-wm-accent/5 space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Revise sitemap</p>
              <button
                onClick={() => { setRevisingSitemap(false); setSitemapFeedback(''); setSitemapConvo([]) }}
                disabled={running === 'apply'}
                className="text-[11px] text-wm-text-muted hover:text-wm-text"
              >
                Done
              </button>
            </div>

            {sitemapConvo.length === 0 ? (
              <p className="text-[11px] text-wm-text-muted leading-snug">
                Tell the Director what to change. Be specific — only items you call out get touched. You can chat back and forth until the sitemap is right, then click Approve above.
              </p>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {sitemapConvo.map((t, i) => {
                  if (t.kind === 'user') {
                    return (
                      <div key={i} className="rounded-md bg-wm-bg-elevated border border-wm-border p-2.5">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">You</p>
                        <p className="text-[12px] text-wm-text leading-snug whitespace-pre-wrap">{t.text}</p>
                      </div>
                    )
                  }
                  if (t.kind === 'pending') {
                    return (
                      <div key={i} className="rounded-md bg-wm-accent/10 border border-wm-accent/30 p-2.5">
                        <div className="flex items-center gap-2">
                          <Loader2 size={12} className="animate-spin text-wm-accent-strong shrink-0" />
                          <p className="text-[12px] text-wm-text leading-snug flex-1">{pendingStatusFor(elapsedSec)}</p>
                          <span className="text-[10px] font-mono text-wm-text-subtle shrink-0">{elapsedSec}s</span>
                        </div>
                        {elapsedSec >= 120 && (
                          <p className="text-[11px] text-wm-warning mt-1.5">
                            Taking longer than usual. The agent may still be running on the server — check the sitemap preview above; if it updates, the re-draft succeeded.
                          </p>
                        )}
                        {elapsedSec >= 240 && (
                          <p className="text-[11px] text-wm-danger mt-1">
                            Likely failed. Vercel functions cap at 5 min. Refresh the page; if the preview hasn't changed, retry.
                          </p>
                        )}
                      </div>
                    )
                  }
                  if (t.kind === 'error') {
                    return (
                      <div key={i} className="rounded-md bg-wm-danger-bg border border-wm-danger/30 p-2.5">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-danger mb-1">Director</p>
                        <p className="text-[12px] text-wm-danger leading-snug">{t.text}</p>
                      </div>
                    )
                  }
                  return (
                    <div key={i} className="rounded-md bg-wm-success-bg border border-wm-success/30 p-2.5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-success mb-1">Director</p>
                      <p className="text-[12px] text-wm-text leading-snug whitespace-pre-wrap">{t.text}</p>
                    </div>
                  )
                })}
              </div>
            )}

            <textarea
              value={sitemapFeedback}
              onChange={e => setSitemapFeedback(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sitemapFeedback.trim() && running !== 'apply') {
                  e.preventDefault()
                  void submitSitemapRevision()
                }
              }}
              placeholder={sitemapConvo.length > 0 ? 'Anything else to change? Or click Approve above when satisfied.' : 'What should change?'}
              rows={3}
              autoFocus
              disabled={running === 'apply'}
              className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] text-wm-text focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-wm-text-subtle">⌘+Enter to send</p>
              <div className="flex gap-2">
                <button
                  onClick={() => void submitSitemapRevision()}
                  disabled={!sitemapFeedback.trim() || running === 'apply'}
                  className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
                >
                  {running === 'apply' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {sitemapConvo.some(t => t.kind === 'system' || t.kind === 'user') ? 'Send' : 'Re-draft sitemap'}
                </button>
              </div>
            </div>
            {sitemapApproved && sitemapConvo.length === 0 && (
              <p className="text-[11px] text-wm-warning">
                Sitemap is currently approved. Re-drafting will create new draft revisions; you'll need to approve again after review.
              </p>
            )}
          </div>
        )}
        {sitemapOpen && sitemap && (
          <div className="border-t border-wm-border px-3 py-3">
            <RichSitemapPreview output={sitemap as unknown as Record<string, unknown>} />
          </div>
        )}

        {/* Quick rename panel — deterministic JSON edits, no LLM. Each
            row commits via rename_sitemap_page on blur or Enter. Slug
            edits are allowed but invalidate sitemap approval since
            downstream stages key off slugs. */}
        {renamePanelOpen && hasStage2 && (
          <div className="border-t border-wm-border px-3 py-3 bg-wm-accent/5">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Quick rename</p>
              <p className="text-[10px] text-wm-text-subtle">
                Editing the <strong>slug</strong> reverts the sitemap to draft status. Name + nav label edits keep approval.
              </p>
            </div>
            <ul className="space-y-1.5">
              {(sitemap.pages ?? []).map(page => (
                <PageRenameRow
                  // Identity-based key — when any rendered field changes
                  // (rename lands, slug changes), the row remounts with
                  // the fresh prop values. Keeps the form in sync without
                  // a setState-in-useEffect.
                  key={`${page.slug}:${page.name}:${((page as { nav_label?: string }).nav_label) ?? ''}`}
                  page={page as { name: string; slug: string; nav_label?: string }}
                  saving={renameSavingSlug === page.slug}
                  disabled={!!running || renameSavingSlug !== null}
                  onSave={async (next) => {
                    const p = page as { name?: string; slug?: string; nav_label?: string }
                    setRenameSavingSlug(page.slug)
                    try {
                      await callOrchestrate('rename_sitemap_page', {
                        slug: page.slug,
                        newName:     next.name     !== (p.name ?? '')      ? next.name     : undefined,
                        newNavLabel: next.navLabel !== (p.nav_label ?? '') ? next.navLabel : undefined,
                        newSlug:     next.slug     !== page.slug           ? next.slug     : undefined,
                      })
                    } finally {
                      setRenameSavingSlug(null)
                    }
                  }}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Stage 2.5 coverage — surfaced INSIDE Gate 1 so the strategist
            sees gaps before deciding to approve. Always rendered when a
            sitemap exists; auto-runs on mount + after every revise. */}
        {hasStage2 && (
          <div className="border-t border-wm-border px-3 py-3">
            <CoverageGate
              data={coverage.data}
              running={coverageRunning}
              stale={coverageIsStale}
              recommendedAction={recommendedAction}
              gapCount={coverageGapCount}
              isOpen={coverageOpen}
              onToggle={() => setCoverageOpen(o => !o)}
              onRerun={() => void callOrchestrate('run_coverage_audit')}
              onAutoFix={() => void callOrchestrate('draft_sitemap_with_audit')}
              autoFixRunning={autoFixRunning}
              onPushToNav={() => void callOrchestrate('apply_audit_to_nav')}
              pushToNavRunning={pushToNavRunning}
              auditLoop={auditLoopMeta}
              sitemapPageCount={sitemap?.pages?.length ?? null}
              disabled={!!running}
            />
          </div>
        )}
      </div>

      {/* Engine progress — single card. Reflects what the engine is doing
          right now (or last did). The strategist's only manual entry is
          Re-run (after a sitemap change) and Commit (the destination
          action). Everything between Approve and Final review is the
          engine's job. */}
      {/* Engine status card only renders once there's a sitemap to act
          on. Before then the Gate 1 card already carries the only
          actionable next step (Synthesize → Draft sitemap), and an
          extra "Waiting on sitemap approval" line just reads as the
          app blaming the user for not approving something they
          haven't even seen yet. */}
      <section>
        {hasStage2 && (
          <EngineStatusCard
            engine={engine}
            engineRunning={engineRunning || !!running}
            sitemapApproved={sitemapApproved}
            draftSlugs={draftSlugs}
            sitemapSlugCount={sitemapSlugCount}
            onRerun={() => void runEngine()}
            onCommit={() => setConfirmAction('commit')}
            rerunBusy={!!running}
          />
        )}

        {/* Live phase progress — appears under the status card while
            runEngine is in flight. Shows current phase, X-of-Y count,
            current slug, elapsed time, and ETA derived from average
            per-step duration. Without this, the user sees the generic
            "Running run_page_outline_for_page…" with no clue whether
            the cascade is healthy or hung. */}
        {enginePhase && (
          <div className="mt-3">
            <PhaseProgressCard progress={enginePhase} />
          </div>
        )}

        {confirmAction === 'commit' && (
          <div className="mt-3">
            <ConfirmPanel
              title="Commit to pages — preview"
              busy={running === 'commit'}
              onCancel={() => setConfirmAction(null)}
              onConfirm={async () => { setConfirmAction(null); await callOrchestrate('commit') }}
              confirmLabel="Commit"
            >
              <p className="text-[12px] text-wm-text leading-snug">
                Will write {draftSlugs.length} page{draftSlugs.length === 1 ? '' : 's'} to <span className="font-mono">web_pages</span> + <span className="font-mono">web_sections</span>:
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {draftSlugs.map(slug => (
                  <span key={slug} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-wm-accent/10 text-wm-accent-strong">{slug}</span>
                ))}
              </div>
              <p className="text-[11px] text-wm-text-muted mt-2">
                Existing freehand sections on those pages will be replaced. Manually template-bound sections are preserved.
              </p>
            </ConfirmPanel>
          </div>
        )}
      </section>

      {/* Critique summary */}
      {critique && (
        <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-wm-text">Director critique</h3>
            <span className={[
              'text-[11px] uppercase tracking-wider font-bold px-2 py-0.5 rounded',
              critique.overall_verdict === 'approved' ? 'bg-wm-success-bg text-wm-success'
              : critique.overall_verdict === 'needs_strategy_rework' ? 'bg-wm-danger-bg text-wm-danger'
              : 'bg-wm-warning-bg text-wm-warning',
            ].join(' ')}>
              {critique.overall_verdict ?? 'unknown'}
            </span>
          </div>

          {critique.scores && (
            // New 5-axis schema (dignity first because it's the non-
            // negotiable floor — anything ≤40 there is a blocker no
            // matter what the rest scores). Old critiques written
            // before the prompt overhaul fall back to legacy field
            // names via the ?? chain below.
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px]">
              <ScoreChip
                label="Dignity"
                value={critique.scores.dignity ?? 0}
                tone={(critique.scores.dignity ?? 100) < 70 ? 'danger' : 'default'}
              />
              <ScoreChip label="Voice"   value={critique.scores.voice_character ?? critique.scores.voice_consistency ?? 0} />
              <ScoreChip label="Persona" value={critique.scores.persona_fit ?? critique.scores.persona_coverage ?? 0} />
              <ScoreChip label="Atoms"   value={critique.scores.atom_coverage ?? 0} />
              <ScoreChip label="Claims"  value={critique.scores.claim_plausibility ?? 0} />
              <ScoreChip label="Overall" value={critique.scores.overall ?? 0} bold />
            </div>
          )}

          {Array.isArray(critique.directives) && critique.directives.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">Directives ({critique.directives.length})</p>
              {critique.directives.map((d, i) => {
                const hasDraft = d.page_slug && d.page_slug !== '*' && Object.prototype.hasOwnProperty.call(drafts, d.page_slug)
                return (
                  <div key={i} className="rounded-md border border-wm-border bg-wm-bg p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wider font-bold text-wm-accent-strong">
                        {d.stage_to_rerun}
                        {d.page_slug !== '*' && (
                          <>
                            {' · '}
                            {hasDraft ? (
                              <button
                                onClick={() => openDraft(d.page_slug)}
                                className="underline decoration-dotted underline-offset-2 hover:text-wm-accent"
                              >
                                {d.page_slug}
                              </button>
                            ) : (
                              <span>{d.page_slug}</span>
                            )}
                          </>
                        )}
                      </span>
                      <span className={[
                        'text-[10px] uppercase tracking-wider font-bold',
                        d.severity === 'blocker' ? 'text-wm-danger'
                        : d.severity === 'warning' ? 'text-wm-warning' : 'text-wm-text-subtle',
                      ].join(' ')}>{d.severity}</span>
                    </div>
                    <p className="text-[12px] text-wm-text mt-1 leading-snug">{d.note}</p>
                  </div>
                )
              })}
            </div>
          )}

          {Array.isArray(critique.per_page) && critique.per_page.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-[11px] text-wm-text-muted hover:text-wm-text">Per-page breakdown ({critique.per_page.length})</summary>
              <div className="mt-2 space-y-2">
                {critique.per_page.map((p, i) => {
                  const hasDraft = Object.prototype.hasOwnProperty.call(drafts, p.page_slug)
                  return (
                    <div key={i} className="rounded-md border border-wm-border bg-wm-bg p-2.5">
                      <div className="flex items-baseline gap-2 mb-1">
                        {hasDraft ? (
                          <button
                            onClick={() => openDraft(p.page_slug)}
                            className="font-semibold text-wm-text underline decoration-dotted underline-offset-2 hover:text-wm-accent"
                          >
                            {p.page_slug}
                          </button>
                        ) : (
                          <span className="font-semibold text-wm-text">{p.page_slug}</span>
                        )}
                        <span className="text-[10px] text-wm-text-muted">
                          {/* 5-axis (new) when available, falls back to legacy 4-axis for pre-overhaul critiques. */}
                          d {p.dignity ?? '—'} · v {p.voice_character ?? p.voice_match ?? '—'} · p {p.persona_fit} · a {p.atom_coverage} · c {p.claim_plausibility ?? '—'}
                        </span>
                      </div>
                      {p.summary && <p className="text-[12px] text-wm-text-muted leading-snug">{p.summary}</p>}
                      {p.problem_lines?.length ? (
                        <ul className="mt-1 space-y-0.5">
                          {p.problem_lines.map((line, j) => (
                            <li key={j} className="text-[11px] text-wm-danger">· {line}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </details>
          )}

          {Array.isArray(critique.cross_page_findings) && critique.cross_page_findings.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">Cross-page findings</p>
              {critique.cross_page_findings.map((f, i) => (
                <div key={i} className="text-[12px] text-wm-text">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-wm-accent-strong mr-2">{f.kind}</span>
                  {f.description}
                  {f.pages?.length ? (
                    <span className="text-[11px] text-wm-text-muted ml-2">
                      ({f.pages.map((slug, j) => {
                        const hasDraft = Object.prototype.hasOwnProperty.call(drafts, slug)
                        return (
                          <span key={j}>
                            {j > 0 && ', '}
                            {hasDraft ? (
                              <button
                                onClick={() => openDraft(slug)}
                                className="underline decoration-dotted underline-offset-2 hover:text-wm-accent"
                              >
                                {slug}
                              </button>
                            ) : slug}
                          </span>
                        )
                      })})
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Drafts — expandable per page so the strategist can see the
          actual copy before approving / committing / giving feedback.
          Show the section even when 0 drafts exist IF the engine is
          mid-cascade, so the strategist sees "writing pages…" rather
          than nothing. */}
      {(draftSlugs.length > 0 || dbEngineInProgress) && (
        <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-[14px] font-semibold text-wm-text">
              Drafted pages ({draftSlugs.length}
              {(engine.pages_total ?? 0) > 0 && draftSlugs.length !== (engine.pages_total ?? 0)
                ? ` of ${engine.pages_total}`
                : ''})
            </h3>
            {dbEngineInProgress && (
              <div className="flex items-center gap-2 text-[11px] text-wm-accent-strong">
                <Loader2 size={11} className="animate-spin" />
                <span>
                  {engine.current_phase === 'page_briefs' && 'Writing page briefs…'}
                  {engine.current_phase === 'page_drafts' && `Drafting pages · ${engine.pages_drafted ?? 0}/${engine.pages_total ?? '?'} written so far`}
                  {engine.current_phase === 'director_critique' && 'Director critiquing the drafts…'}
                  {engine.current_phase === 'applying_directives' && `Iterating · loop ${engine.loop_count ?? 0}`}
                  {!['page_briefs','page_drafts','director_critique','applying_directives'].includes(engine.current_phase ?? '') && 'Engine still running…'}
                </span>
                <span className="text-wm-text-subtle">(this view auto-refreshes)</span>
              </div>
            )}
          </div>
          {dbEngineInProgress && draftSlugs.length < (engine.pages_total ?? 0) && (
            <div className="mb-3 rounded-md border border-wm-accent/30 bg-wm-accent/5 px-3 py-2 text-[11px] text-wm-text leading-snug">
              The engine has written {engine.pages_drafted ?? draftSlugs.length} of {engine.pages_total} pages so far.
              {' '}{draftSlugs.length} are visible below; the rest are landing every few seconds as Vercel finishes each chunk.
              {' '}Nothing is broken — refresh isn't needed.
            </div>
          )}
          <div className="space-y-2">
            {draftSlugs.map(slug => {
              const d = drafts[slug]
              const sectionCount = Array.isArray(d?.sections) ? d.sections.length : 0
              const flags = Array.isArray(d?.validation?.flags) ? d.validation.flags.length : 0
              const redoCount = d?._meta?.redo_count ?? 0
              const isOpen = expandedDraft === slug
              return (
                <div key={slug} id={`copy-engine-draft-${slug}`} className="rounded-md border border-wm-border bg-wm-bg scroll-mt-4">
                  <button
                    onClick={() => setExpandedDraft(isOpen ? null : slug)}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-wm-accent/5"
                  >
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="text-[12px] font-semibold text-wm-text">{slug}</span>
                    <span className="text-[10px] text-wm-text-muted ml-auto">
                      {sectionCount} sections
                      {flags > 0 && <span className="text-wm-warning"> · {flags} flags</span>}
                      {redoCount > 0 && <span> · v{redoCount + 1}</span>}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-wm-border px-3 py-3">
                      <DraftPreview
                        draft={d}
                        brief={briefs[slug]}
                        critique={critique?.per_page?.find(p => p.page_slug === slug) ?? null}
                        bindSuggestion={bindSuggestions[slug] ?? null}
                        onEditSlot={(sectionIx, slotKey, instruction) =>
                          void callOrchestrate('apply', {
                            dispatch: { stage_to_rerun: 'single_slot', page_slug: slug, section_ix: sectionIx, slot_key: slotKey, note: instruction },
                          })
                        }
                        onRedraftSection={(sectionIx, instruction) => {
                          const focused = `Section ${sectionIx + 1} needs a rewrite. ${instruction}. Keep all OTHER sections on this page byte-for-byte the same — only re-draft section ${sectionIx + 1}.`
                          void callOrchestrate('apply', { dispatch: { stage_to_rerun: 'page_draft', page_slug: slug, note: focused } })
                        }}
                        onRestructure={({ mode, sectionIxs, targetArchetype, instruction }) =>
                          void callOrchestrate('restructure_sections', {
                            pageSlug: slug, mode, sectionIxs, targetArchetype, instruction,
                          })
                        }
                        onSwapTemplate={(sectionIx, templateId) =>
                          void callOrchestrate('override_bind_template', { pageSlug: slug, sectionIx, templateId })
                        }
                        onReorgForTemplate={(sectionIx, templateId, instruction) =>
                          void callOrchestrate('reorg_section_for_template', { pageSlug: slug, sectionIx, templateId, instruction })
                        }
                        busy={!!running}
                      />
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => {
                            const note = window.prompt(`Re-draft "${slug}" with this feedback:`, '')
                            if (note == null) return
                            void callOrchestrate('apply', { dispatch: { stage_to_rerun: 'page_draft', page_slug: slug, note } })
                          }}
                          disabled={!!running}
                          className="text-[11px] text-wm-accent-strong hover:underline disabled:opacity-50"
                        >
                          Re-draft this whole page
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Export / Import — always rendered. Even with no sitemap yet,
          a partner may arrive with one they drafted in another tool
          and want to upload directly into Copy Engine. Downloads
          gracefully no-op when there's nothing to export. */}
      <ExportImportPanel projectId={project.id} onImported={async () => { await onChange?.() }} />

      {/* Gate 2 — Final review */}
      <GateCard
        number={2}
        title="Final review — copy drafts (pre-bind)"
        subtitle={(() => {
          if (status === 'committed') return 'Committed. The copy is now live in web_pages + web_sections.'
          if (status === 'ready_for_review') return 'Review the page drafts above (archetype + slot copy). Approve to commit — commit binds each section to a Brixies template, writes web_pages + web_sections, and renders the final bound pages in the Pages tab.'
          // Honest "upstream" reasons. Without this, the strategist
          // sees "still being written" while the engine is plainly
          // idle — and has no way to know if they need to do anything.
          if (engine.status && ENGINE_IN_PROGRESS_STATUSES.has(engine.status)) {
            return 'Upstream — drafts are still being written or critiqued.'
          }
          if (draftsIncomplete) {
            const missing = sitemapSlugCount - draftSlugs.length
            return `Upstream — ${draftSlugs.length} of ${sitemapSlugCount} pages drafted. Resuming the remaining ${missing} now.`
          }
          if (draftSlugs.length > 0) {
            return 'Upstream — drafts ready, awaiting Director critique.'
          }
          return 'Upstream — drafting hasn’t started yet.'
        })()}
        status={status === 'committed' ? 'passed' : status === 'ready_for_review' ? 'awaiting' : 'upstream'}
      />

      {(status === 'ready_for_review' || status === 'committed' || draftSlugs.length > 0) && (
        <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4 space-y-3">
          <h3 className="text-[14px] font-semibold text-wm-text">Strategist feedback</h3>
          <p className="text-[12px] text-wm-text-muted leading-snug">
            Tell the Director what's off. It classifies into a single dispatch and shows you the plan before executing.
            Examples: "the homepage hero is generic", "we're not really hitting Maria", "the giving page heading should be punchier".
          </p>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="What's the issue?"
            rows={3}
            className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] text-wm-text focus:outline-none focus:border-wm-accent"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => void submitRoute()}
              disabled={routing || !feedback.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-text px-4 py-1.5 text-[12px] text-wm-bg disabled:opacity-50"
            >
              {routing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Route
            </button>
          </div>

          {routePreview?.dispatch && (
            <div className="rounded-md border border-wm-accent/30 bg-wm-accent/5 p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Director's plan</p>
              <p className="text-[12px] text-wm-text">
                Run <span className="font-semibold">{routePreview.dispatch.stage_to_rerun}</span>
                {routePreview.dispatch.page_slug ? <> on <span className="font-mono">{routePreview.dispatch.page_slug}</span></> : null}
                {routePreview.dispatch.slot_key ? <> · slot <span className="font-mono">{routePreview.dispatch.slot_key}</span></> : null}
              </p>
              <p className="text-[12px] text-wm-text-muted italic">"{routePreview.dispatch.note}"</p>
              {routePreview.rationale && (
                <p className="text-[11px] text-wm-text-muted">— {routePreview.rationale}</p>
              )}
              {Array.isArray(routePreview.alternative_dispatches) && routePreview.alternative_dispatches.length > 0 && (
                <details className="text-[11px] text-wm-text-muted">
                  <summary className="cursor-pointer">Alternatives considered ({routePreview.alternative_dispatches.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {routePreview.alternative_dispatches.map((a, i) => (
                      <li key={i}>· {a.stage_to_rerun}: {a.why_rejected}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setRoutePreview(null)} className="text-[12px] text-wm-text-muted px-3 py-1 hover:text-wm-text">Cancel</button>
                <button onClick={() => void applyRoute()} disabled={!!running}
                  className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50">
                  {running === 'apply' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Execute
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────

/** Statuses the engine reports DURING a run. If the engine is in one
 *  of these AND last_action_at is older than the stuck threshold, the
 *  underlying agent call most likely crashed or timed out — the engine
 *  will never reach a terminal state on its own. */
const ENGINE_IN_PROGRESS_STATUSES = new Set([
  'briefing', 'drafting', 'critiquing', 'iterating', 'committing',
])
/** Terminal statuses — the engine has reached a stopping point that
 *  requires the strategist's explicit input to advance. Auto-cascades
 *  MUST skip these or they'll waste tokens re-firing work that already
 *  completed. */
const ENGINE_TERMINAL_STATUSES = new Set([
  'ready_for_review', 'committed', 'cancelled', 'error',
  'drafts_ready', 'needs_iteration',
])
/** A real run finishes well within this window. Beyond it, treat the
 *  engine as stuck regardless of the displayed status. 8 minutes
 *  comfortably covers a full run_drafts + critique cycle on a
 *  20-page sitemap; anything past that is dead in the water. */
const ENGINE_STUCK_THRESHOLD_MS = 8 * 60 * 1000

function isEngineStuck(engine: EngineState, activelyRunning: boolean): boolean {
  if (activelyRunning) return false
  const status = engine.status
  if (!status || !ENGINE_IN_PROGRESS_STATUSES.has(status)) return false
  const lastActionAt = engine.last_action_at
  if (!lastActionAt) return true
  const ageMs = Date.now() - new Date(lastActionAt).getTime()
  return ageMs > ENGINE_STUCK_THRESHOLD_MS
}

function StatusBanner({ engine, stuck, onReset, resetBusy }: {
  engine: EngineState
  stuck: boolean
  onReset: () => void
  resetBusy: boolean
}) {
  const status = engine.status ?? 'idle'
  const phase = engine.current_phase ?? '—'
  const showProgress = (engine.pages_total ?? 0) > 0 && (engine.pages_drafted ?? engine.pages_committed) != null
  const drafted = engine.pages_drafted ?? engine.pages_committed ?? 0
  const total = engine.pages_total ?? 0

  const tone =
    stuck ? 'danger'
    : status === 'committed' || status === 'ready_for_review' ? 'success'
    : status === 'error' ? 'danger'
    : status === 'idle' ? 'muted' : 'info'

  const toneClass = {
    success: 'border-wm-success/30 bg-wm-success-bg text-wm-success',
    danger:  'border-wm-danger/30 bg-wm-danger-bg text-wm-danger',
    info:    'border-wm-accent/30 bg-wm-accent/5 text-wm-accent-strong',
    muted:   'border-wm-border bg-wm-bg-elevated text-wm-text-muted',
  }[tone]

  if (stuck) {
    return (
      <div className={['rounded-md border px-3 py-2', toneClass].join(' ')}>
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] uppercase tracking-widest font-bold">stuck</span>
          <span className="text-[11px]">status was {status} / phase {phase}</span>
          {engine.last_action_at && (
            <span className="text-[11px]">since {new Date(engine.last_action_at).toLocaleString()}</span>
          )}
          <button
            type="button"
            onClick={onReset}
            disabled={resetBusy}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-wm-danger/40 bg-white px-3 py-0.5 text-[11px] font-semibold text-wm-danger hover:bg-wm-danger/5 disabled:opacity-50"
          >
            {resetBusy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Reset engine state
          </button>
        </div>
        <p className="text-[11px] mt-1.5 text-wm-text-muted leading-snug">
          The engine has been in an in-progress status for over 8 minutes — the underlying agent call most likely crashed. Reset clears <code>engine_state</code> so you can re-run from a clean slate. Your sitemap, briefs, and drafts are untouched.
        </p>
      </div>
    )
  }

  return (
    <div className={['rounded-md border px-3 py-2 flex items-baseline gap-3', toneClass].join(' ')}>
      <span className="text-[11px] uppercase tracking-widest font-bold">{status}</span>
      <span className="text-[11px]">phase: {phase}</span>
      {showProgress && (
        <span className="text-[11px]">{drafted}/{total} pages</span>
      )}
      {typeof engine.loop_count === 'number' && engine.loop_count > 0 && (
        <span className="text-[11px]">loops: {engine.loop_count}</span>
      )}
      {engine.last_error && (
        <span className="text-[11px] text-wm-danger ml-auto">{engine.last_error}</span>
      )}
    </div>
  )
}

function GateCard({ number, title, subtitle, status, action }: {
  number: 1 | 2; title: string; subtitle: string
  status: 'upstream' | 'awaiting' | 'passed'
  action?: React.ReactNode
}) {
  const icon =
    status === 'passed' ? <CheckCircle2 size={16} className="text-wm-success" />
    : status === 'awaiting' ? <AlertCircle size={16} className="text-wm-warning" />
    : <AlertCircle size={16} className="text-wm-text-subtle" />
  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated p-3 flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Gate {number}</span>
      {icon}
      <div className="flex-1">
        <p className="text-[13px] font-semibold text-wm-text">{title}</p>
        <p className="text-[11px] text-wm-text-muted">{subtitle}</p>
      </div>
      {action ?? <span className="text-[10px] uppercase tracking-wider font-bold text-wm-text-subtle">{status}</span>}
    </div>
  )
}

/** Live progress for the runEngine cascade. Shows phase name, X of Y
 *  count, current slug, elapsed time, and ETA derived from the
 *  rolling per-step average. Re-renders every 1s while a phase is
 *  active so the elapsed clock advances even between step bumps
 *  (page-outlines takes 30-90s per page — without a ticking clock the
 *  banner LOOKS frozen). */
function PhaseProgressCard({ progress }: {
  progress: {
    label:        string | null
    pretty:       string
    completed:    number
    total:        number
    currentSlug:  string | null
    startedAt:    number
    perStepMs:    number[]
  }
}) {
  // 1Hz tick so the elapsed clock advances. `now` lives in state
  // (NOT a Date.now() call in render) so the component stays pure
  // per react-hooks/purity. We only set inside the interval callback,
  // not synchronously inside the effect body, to avoid the
  // react-hooks/set-state-in-effect rule firing.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [progress.startedAt])

  const elapsedMs = Math.max(0, now - progress.startedAt)
  const pct = progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0
  // Average per completed step. For phases that haven't completed any
  // step yet, fall back to "elapsed so far" as a rough proxy for the
  // first step (better than showing no ETA at all).
  const avgMs = progress.perStepMs.length > 0
    ? progress.perStepMs.reduce((a, b) => a + b, 0) / progress.perStepMs.length
    : elapsedMs
  const remainingSteps = Math.max(0, progress.total - progress.completed)
  const etaMs = remainingSteps * avgMs

  return (
    <div className="rounded-lg border border-wm-accent/30 bg-wm-accent/5 px-4 py-3">
      <div className="flex items-center gap-3 mb-2">
        <Loader2 size={14} className="text-wm-accent-strong animate-spin shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-wm-text">
            {progress.pretty}
            {progress.total > 1 && (
              <span className="font-normal text-wm-text-muted"> · {progress.completed} of {progress.total}</span>
            )}
          </p>
          {progress.currentSlug && (
            <p className="text-[11px] text-wm-text-muted truncate">
              Working on <span className="font-mono text-wm-text">{progress.currentSlug}</span>…
            </p>
          )}
        </div>
        <div className="text-right text-[10px] font-mono text-wm-text-subtle shrink-0 leading-tight">
          <p>Elapsed {formatDuration(elapsedMs)}</p>
          {remainingSteps > 0 && progress.perStepMs.length > 0 && (
            <p>ETA ~{formatDuration(etaMs)}</p>
          )}
        </div>
      </div>
      {/* Progress bar — only shown for multi-step phases. Single-step
          phases (critique / iterate) just spin without filling. */}
      {progress.total > 1 && (
        <div className="w-full bg-wm-border/40 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-wm-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  )
}

/** Human-readable duration: 45s / 2m 14s / 12m / 1h 3m. */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const remS = s % 60
  if (m < 60) return remS > 0 && m < 10 ? `${m}m ${remS}s` : `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`
}

function EngineStatusCard({ engine, engineRunning, sitemapApproved, draftSlugs, sitemapSlugCount, onRerun, onCommit, rerunBusy }: {
  engine: EngineState
  engineRunning: boolean
  sitemapApproved: boolean
  draftSlugs: string[]
  sitemapSlugCount: number
  onRerun: () => void
  onCommit: () => void
  rerunBusy: boolean
}) {
  const status = engine.status ?? 'idle'
  const phase = engine.current_phase ?? ''
  const total = engine.pages_total ?? 0
  const drafted = engine.pages_drafted ?? 0
  const committed = engine.pages_committed ?? 0
  const loopCount = engine.loop_count ?? 0
  const verdict = engine.last_verdict
  const directiveCount = engine.last_directive_count ?? 0
  const lastError = engine.last_error
  // Sitemap-aware partial-completion check. The engine writes
  // pages_total only while actively running, so we can't rely on
  // engine.pages_total when status is idle — derive from sitemap.
  const draftsIncomplete = sitemapSlugCount > 0 && draftSlugs.length < sitemapSlugCount
  const missingCount = Math.max(0, sitemapSlugCount - draftSlugs.length)

  // Detect ANY in-progress engine state — local cascade in flight OR
  // a server-side cascade we're observing via polling. Either way the
  // headline should reflect what the engine is doing right now, not
  // the stale verdict from a prior completed run.
  const isAnyInProgress = engineRunning || ENGINE_IN_PROGRESS_STATUSES.has(status)

  // Single phrase per state so the strategist always knows what's
  // happening without parsing a status banner + 4 buttons.
  const headline = (() => {
    if (lastError) return `Engine errored: ${lastError}`
    if (!sitemapApproved) return 'Waiting on sitemap approval'
    if (isAnyInProgress) {
      // Pick the most specific message we can from phase or status.
      // Falls through to "Engine running…" for unfamiliar states.
      if (phase === 'page_briefs' || status === 'briefing')
        return 'Briefing pages…'
      if (phase === 'page_drafts' || status === 'drafting')
        return `Drafting pages · ${drafted}/${total || '?'}`
      if (phase === 'director_critique' || status === 'critiquing')
        return 'Director critiquing the drafts…'
      if (phase === 'applying_directives' || status === 'iterating')
        return `Iterating — loop ${loopCount} · re-drafting flagged pages…`
      if (phase === 'awaiting_critique')
        return 'Drafts ready. Critiquing…'
      if (status === 'committing')
        return `Committing · ${committed}/${total}`
      return 'Engine running…'
    }
    if (status === 'committed')        return `Committed ${committed} pages.`
    if (status === 'ready_for_review') return verdict === 'approved'
      ? `Engine approved its own drafts. Review and commit when ready.`
      : `Drafts ready for review. Verdict: ${verdict ?? 'needs_revision'} after ${loopCount} loop${loopCount === 1 ? '' : 's'}.`
    // Partial completion: be honest about how many pages are missing
    // so the strategist sees the gap instead of a generic "drafts
    // exist" line. The auto-cascade is also wired to resume here, so
    // this state is usually transient — but it persists across reload
    // / Vercel timeout / context drop, and the user deserves to know.
    if (draftsIncomplete) {
      return `${draftSlugs.length} of ${sitemapSlugCount} pages drafted. ${missingCount} remaining — click Continue to resume.`
    }
    if (draftSlugs.length > 0)         return `Drafts exist (${draftSlugs.length} pages). Re-run to refresh, or review below.`
    return 'Ready to run. Approve the sitemap to start automatically, or re-run manually anytime.'
  })()

  const tone =
    lastError ? 'danger'
    : isAnyInProgress ? 'running'
    : status === 'committed' ? 'success'
    : status === 'ready_for_review' ? 'ready'
    : 'idle'

  const toneClass = {
    danger:  'border-wm-danger/30 bg-wm-danger-bg',
    running: 'border-wm-accent/30 bg-wm-accent/5',
    success: 'border-wm-success/30 bg-wm-success-bg',
    ready:   'border-wm-accent/30 bg-wm-accent/5',
    idle:    'border-wm-border bg-wm-bg-elevated',
  }[tone]

  return (
    <div className={['rounded-lg border p-4', toneClass].join(' ')}>
      <div className="flex items-center gap-3">
        {engineRunning ? <Loader2 size={16} className="animate-spin text-wm-accent-strong" />
          : lastError ? <AlertCircle size={16} className="text-wm-danger" />
          : status === 'committed' ? <CheckCircle2 size={16} className="text-wm-success" />
          : status === 'ready_for_review' ? <CheckCircle2 size={16} className="text-wm-accent-strong" />
          : <Play size={16} className="text-wm-text-muted" />}
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-wm-text">{headline}</p>
          {engineRunning && phase && (
            <p className="text-[11px] text-wm-text-muted mt-0.5">
              Phase: <span className="font-mono">{phase}</span>
              {loopCount > 0 && <span> · loop {loopCount}/3</span>}
            </p>
          )}
          {!isAnyInProgress && status === 'ready_for_review' && directiveCount > 0 && (
            <p className="text-[11px] text-wm-text-muted mt-0.5">
              Director flagged {directiveCount} item{directiveCount === 1 ? '' : 's'} during critique. See below.
            </p>
          )}
        </div>
        {/* Hide Re-run + Commit while the engine is in-progress on the
            server, regardless of whether THIS tab started the run. Both
            actions would conflict with the in-flight cascade and the
            "Engine approved" verdict is stale until critique re-runs. */}
        {!isAnyInProgress && sitemapApproved && (
          <button
            onClick={onRerun}
            disabled={rerunBusy}
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] disabled:opacity-50',
              draftsIncomplete
                ? 'bg-wm-accent text-white hover:bg-wm-accent-strong'
                : 'border border-wm-border bg-wm-bg text-wm-text hover:bg-wm-accent/5',
            ].join(' ')}
            title={draftsIncomplete
              ? `Resume drafting from where the engine left off. Pages already drafted will be skipped — only the missing ${missingCount} will run.`
              : 'Re-run the engine. Re-runs are idempotent — pages with existing drafts are skipped.'}
          >
            {draftsIncomplete ? <Play size={12} /> : <RefreshCw size={12} />}
            {draftsIncomplete ? `Continue (${missingCount} left)` : 'Re-run'}
          </button>
        )}
        {!isAnyInProgress && status === 'ready_for_review' && draftSlugs.length > 0 && (
          <button
            onClick={onCommit}
            disabled={rerunBusy}
            className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
          >
            <FileText size={12} /> Commit
          </button>
        )}
      </div>
      {isAnyInProgress && total > 0 && (phase === 'page_drafts' || status === 'drafting') && (
        <div className="mt-3 w-full bg-wm-border/40 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-wm-accent h-full transition-all"
            style={{ width: `${Math.min(100, (drafted / total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

function ActionCard({ icon, title, description, busy, disabled, onClick }: {
  icon: React.ReactNode; title: string; description: string
  busy?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!!disabled}
      className="text-left rounded-lg border border-wm-border bg-wm-bg-elevated hover:border-wm-accent/40 hover:bg-wm-accent/5 p-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        {busy ? <Loader2 size={14} className="animate-spin text-wm-accent" /> : icon}
        <span className="text-[13px] font-semibold text-wm-text">{title}</span>
      </div>
      <p className="text-[11px] text-wm-text-muted leading-snug">{description}</p>
    </button>
  )
}

interface SitemapDiff {
  addedPages:        Array<{ name: string; slug: string }>
  removedPages:      Array<{ name: string; slug: string }>
  renamedPages:      Array<{ slug: string; from: string; to: string }>
  navLabelChanges:   Array<{ slug: string; from: string; to: string }>
  phaseChanges:      Array<{ slug: string; from: string; to: string }>
  groupLabelChanges: Array<{ from: string; to: string }>
  addedGroups:       string[]
  removedGroups:     string[]
  headerPageRenames: Array<{ slug?: string; from: string; to: string }>
  footerSectionChanges: Array<{ kind: 'renamed' | 'added' | 'removed'; from?: string; to?: string; label?: string }>
  newVocab:          Array<{ we_chose?: string; instead_of?: string; why?: string }>
  rawJsonChanged:    boolean
}

function diffSitemaps(oldS: any, newS: any): SitemapDiff {
  const oldPages = (oldS?.pages ?? []) as any[]
  const newPages = (newS?.pages ?? []) as any[]
  const oldBySlug = new Map(oldPages.map((p: any) => [p.slug, p]))
  const newBySlug = new Map(newPages.map((p: any) => [p.slug, p]))

  const addedPages: SitemapDiff['addedPages']           = []
  const removedPages: SitemapDiff['removedPages']       = []
  const renamedPages: SitemapDiff['renamedPages']       = []
  const navLabelChanges: SitemapDiff['navLabelChanges'] = []
  const phaseChanges: SitemapDiff['phaseChanges']       = []

  for (const np of newPages) {
    const op = oldBySlug.get(np.slug)
    if (!op) { addedPages.push({ name: np.name ?? np.slug, slug: np.slug }); continue }
    if ((op.name ?? '') !== (np.name ?? '')) {
      renamedPages.push({ slug: np.slug, from: String(op.name ?? op.slug), to: String(np.name ?? np.slug) })
    }
    const oldNav = op.nav_label ?? op.name ?? op.slug
    const newNav = np.nav_label ?? np.name ?? np.slug
    if (oldNav !== newNav && (op.nav_label || np.nav_label)) {
      navLabelChanges.push({ slug: np.slug, from: String(oldNav), to: String(newNav) })
    }
    if (String(op.phase ?? '') !== String(np.phase ?? '')) {
      phaseChanges.push({ slug: np.slug, from: String(op.phase ?? ''), to: String(np.phase ?? '') })
    }
  }
  for (const op of oldPages) {
    if (!newBySlug.has(op.slug)) removedPages.push({ name: op.name ?? op.slug, slug: op.slug })
  }

  // Header nav diff. Pair groups by best-overlap on child slugs, then
  // fall back to positional matching when overlap is zero (children
  // may have been re-slugged or relabeled in the same revision).
  const oldHdr = (oldS?.header_nav ?? []) as any[]
  const newHdr = (newS?.header_nav ?? []) as any[]
  const oldGroups = oldHdr.filter((n: any) => n?.kind === 'group')
  const newGroups = newHdr.filter((n: any) => n?.kind === 'group')

  const groupLabelChanges: SitemapDiff['groupLabelChanges'] = []
  const addedGroups: string[] = []
  const removedGroups: string[] = []
  const matchedNew = new Set<number>()
  const matchedOld = new Set<number>()
  oldGroups.forEach((og: any, ogIx: number) => {
    const oldChildSlugs = new Set<string>(((og.children ?? []) as any[]).map(c => c?.slug).filter((s): s is string => !!s))
    let bestIx = -1, bestOverlap = 0
    newGroups.forEach((ng: any, ix: number) => {
      if (matchedNew.has(ix)) return
      const newChildSlugs = new Set<string>(((ng.children ?? []) as any[]).map((c: any) => c?.slug).filter((s: any): s is string => !!s))
      const overlap = [...oldChildSlugs].filter(s => newChildSlugs.has(s)).length
      if (overlap > bestOverlap) { bestOverlap = overlap; bestIx = ix }
    })
    if (bestOverlap === 0 && newGroups[ogIx] && !matchedNew.has(ogIx)) bestIx = ogIx
    if (bestIx >= 0) {
      matchedNew.add(bestIx); matchedOld.add(ogIx)
      const ng = newGroups[bestIx]
      if ((og.label ?? '') !== (ng.label ?? '')) {
        groupLabelChanges.push({ from: String(og.label ?? '—'), to: String(ng.label ?? '—') })
      }
    }
  })
  oldGroups.forEach((og: any, ix: number) => { if (!matchedOld.has(ix)) removedGroups.push(String(og.label ?? '—')) })
  newGroups.forEach((ng: any, ix: number) => { if (!matchedNew.has(ix)) addedGroups.push(String(ng.label ?? '—')) })

  // Header top-level page entries: detect label changes for items
  // where kind === 'page'. Match by slug when present.
  const oldHdrPages = oldHdr.filter((n: any) => n?.kind !== 'group' && n?.slug)
  const newHdrPages = newHdr.filter((n: any) => n?.kind !== 'group' && n?.slug)
  const newHdrPageBySlug = new Map<string, any>(newHdrPages.map((n: any) => [String(n.slug), n]))
  const headerPageRenames: SitemapDiff['headerPageRenames'] = []
  for (const op of oldHdrPages) {
    const np = newHdrPageBySlug.get(String(op.slug))
    if (np && (op.label ?? '') !== (np.label ?? '')) {
      headerPageRenames.push({ slug: String(op.slug), from: String(op.label ?? '—'), to: String(np.label ?? '—') })
    }
  }

  // Footer sections — match by section_label literally first, fall
  // back to positional. Detect added / removed / renamed.
  const oldFooter = (oldS?.footer_nav ?? []) as any[]
  const newFooter = (newS?.footer_nav ?? []) as any[]
  const footerSectionChanges: SitemapDiff['footerSectionChanges'] = []
  const newFooterMatched = new Set<number>()
  const oldFooterMatched = new Set<number>()
  // First pass: exact-label match
  oldFooter.forEach((os: any, ix: number) => {
    const matchIx = newFooter.findIndex((ns: any, jx: number) =>
      !newFooterMatched.has(jx) && (os.section_label ?? '') === (ns.section_label ?? ''))
    if (matchIx >= 0) { oldFooterMatched.add(ix); newFooterMatched.add(matchIx) }
  })
  // Second pass: positional match for unmatched (likely renamed)
  oldFooter.forEach((os: any, ix: number) => {
    if (oldFooterMatched.has(ix)) return
    if (newFooter[ix] && !newFooterMatched.has(ix)) {
      oldFooterMatched.add(ix); newFooterMatched.add(ix)
      footerSectionChanges.push({
        kind: 'renamed',
        from: String(os.section_label ?? '—'),
        to:   String(newFooter[ix].section_label ?? '—'),
      })
    }
  })
  oldFooter.forEach((os: any, ix: number) => {
    if (!oldFooterMatched.has(ix)) footerSectionChanges.push({ kind: 'removed', label: String(os.section_label ?? '—') })
  })
  newFooter.forEach((ns: any, ix: number) => {
    if (!newFooterMatched.has(ix)) footerSectionChanges.push({ kind: 'added', label: String(ns.section_label ?? '—') })
  })

  const oldVocab = Array.isArray(oldS?.vocabulary_decisions) ? oldS.vocabulary_decisions : []
  const newVocab = Array.isArray(newS?.vocabulary_decisions) ? newS.vocabulary_decisions : []
  const oldVocabKeys = new Set(oldVocab.map((v: any) => `${v?.we_chose ?? ''}|${v?.instead_of ?? ''}`))
  const newVocabItems = newVocab.filter((v: any) => !oldVocabKeys.has(`${v?.we_chose ?? ''}|${v?.instead_of ?? ''}`))

  // Bottom-line truth flag: if a structural blob changed at all, flag it
  // so an empty per-category diff doesn't lie. Skip _meta which always
  // changes on a re-run.
  const strip = (s: any) => {
    if (!s) return null
    const { _meta, ...rest } = s as Record<string, any>
    void _meta
    return rest
  }
  const rawJsonChanged = JSON.stringify(strip(oldS)) !== JSON.stringify(strip(newS))

  return {
    addedPages, removedPages, renamedPages, navLabelChanges, phaseChanges,
    groupLabelChanges, addedGroups, removedGroups,
    headerPageRenames, footerSectionChanges,
    newVocab: newVocabItems, rawJsonChanged,
  }
}

function formatSitemapDiff(d: SitemapDiff): string[] {
  const lines: string[] = []
  for (const c of d.groupLabelChanges)   lines.push(`Renamed nav group "${c.from}" → "${c.to}"`)
  if (d.addedGroups.length > 0)          lines.push(`Added nav group: ${d.addedGroups.join(', ')}`)
  if (d.removedGroups.length > 0)        lines.push(`Removed nav group: ${d.removedGroups.join(', ')}`)
  for (const c of d.headerPageRenames)   lines.push(`Header nav rename: "${c.from}" → "${c.to}" (/${c.slug})`)
  for (const c of d.renamedPages)        lines.push(`Renamed page "${c.from}" → "${c.to}" (/${c.slug})`)
  for (const c of d.navLabelChanges)     lines.push(`Nav label for /${c.slug}: "${c.from}" → "${c.to}"`)
  if (d.addedPages.length > 0)           lines.push(`Added page${d.addedPages.length > 1 ? 's' : ''}: ${d.addedPages.map(p => `${p.name} (/${p.slug})`).join(', ')}`)
  if (d.removedPages.length > 0)         lines.push(`Removed page${d.removedPages.length > 1 ? 's' : ''}: ${d.removedPages.map(p => `${p.name} (/${p.slug})`).join(', ')}`)
  for (const c of d.phaseChanges)        lines.push(`Phase for /${c.slug}: ${c.from} → ${c.to}`)
  for (const c of d.footerSectionChanges) {
    if (c.kind === 'renamed') lines.push(`Footer section: "${c.from}" → "${c.to}"`)
    if (c.kind === 'added')   lines.push(`Footer section added: "${c.label}"`)
    if (c.kind === 'removed') lines.push(`Footer section removed: "${c.label}"`)
  }
  for (const v of d.newVocab) {
    const instead = v.instead_of ? ` instead of "${v.instead_of}"` : ''
    const why = v.why ? ` — ${v.why}` : ''
    lines.push(`New vocab: "${v.we_chose}"${instead}${why}`)
  }
  return lines
}

function pendingStatusFor(elapsed: number): string {
  if (elapsed < 5)   return 'Sending feedback to the Director…'
  if (elapsed < 20)  return 'Director is reading your current sitemap and feedback…'
  if (elapsed < 45)  return 'Drafting revisions…'
  if (elapsed < 75)  return 'Still drafting. Full sitemap re-writes usually take 30–90s.'
  if (elapsed < 120) return 'Wrapping up. Saving to the database…'
  return 'Still working.'
}

function PageBriefHeader({ brief }: { brief: PageBrief | undefined }) {
  if (!brief) return null
  const persona = brief.persona_focus
  const exemplars = brief.voice_exemplars_to_imitate ?? []
  const antis = brief.voice_anti_exemplars_to_avoid ?? []
  const aeo = brief.aeo_geo_targets
  const archetypes = brief.section_targets?.archetypes ?? []
  const atomCount = brief.atoms_assigned?.length ?? 0
  const refCount = brief.reference_atoms?.length ?? 0
  return (
    <div className="rounded-md border border-wm-accent/20 bg-wm-accent/5 p-3 mb-3 space-y-2">
      {brief.page_job && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Page job</p>
          <p className="text-[13px] text-wm-text leading-snug">{brief.page_job}</p>
        </div>
      )}
      {persona?.primary && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Persona focus</p>
          <p className="text-[12px] text-wm-text">
            <span className="font-semibold">{persona.primary}</span>
            {persona.secondary && <span className="text-wm-text-muted"> · secondary: {persona.secondary}</span>}
          </p>
          {persona.rationale && <p className="text-[11px] text-wm-text-muted mt-0.5 leading-snug">{persona.rationale}</p>}
        </div>
      )}
      {exemplars.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-success">Voice anchors (imitate)</p>
          <ul className="mt-0.5 space-y-0.5">
            {exemplars.map((e, i) => (
              <li key={i} className="text-[11px] text-wm-text italic">"{e}"</li>
            ))}
          </ul>
        </div>
      )}
      {antis.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-danger">Avoid</p>
          <ul className="mt-0.5 space-y-0.5">
            {antis.map((a, i) => (
              <li key={i} className="text-[11px] text-wm-text-muted">· {a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {archetypes.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Section spine</p>
            <p className="text-wm-text-muted">{archetypes.join(' → ')}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Content</p>
          <p className="text-wm-text-muted">{atomCount} primary atoms{refCount > 0 && ` · ${refCount} referenced`}</p>
        </div>
      </div>
      {aeo && ((aeo.search_phrases?.length ?? 0) + (aeo.answer_intents?.length ?? 0) + (aeo.geo_anchors?.length ?? 0) > 0) && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">SEO / AEO / GEO targets</summary>
          <div className="mt-1 space-y-1">
            {aeo.search_phrases && aeo.search_phrases.length > 0 && (
              <p><span className="text-wm-text-subtle">Search: </span><span className="text-wm-text-muted">{aeo.search_phrases.join(' · ')}</span></p>
            )}
            {aeo.answer_intents && aeo.answer_intents.length > 0 && (
              <p><span className="text-wm-text-subtle">Answer: </span><span className="text-wm-text-muted">{aeo.answer_intents.join(' · ')}</span></p>
            )}
            {aeo.geo_anchors && aeo.geo_anchors.length > 0 && (
              <p><span className="text-wm-text-subtle">Geo: </span><span className="text-wm-text-muted">{aeo.geo_anchors.join(' · ')}</span></p>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

/** Section archetypes the page-draft agent emits — kept in sync with
 *  TOOL.input_schema.properties.sections.items.properties.archetype
 *  in api/web/agents/page-draft.ts. Used to populate the "Change
 *  archetype" and "Consolidate into..." dropdowns. */
const ARCHETYPES = [
  'hero', 'tagline_band', 'two_up', 'three_up', 'cards_grid',
  'featured_card', 'image_text_split', 'accordion', 'cta_band',
  'testimonial_block', 'stat_block', 'steps_row', 'contact_band',
  'footer_cta', 'intro_paragraph', 'rich_body',
] as const

function DraftPreview({
  draft, brief, critique, bindSuggestion, onEditSlot, onRedraftSection, onRestructure,
  onSwapTemplate, onReorgForTemplate, busy,
}: {
  draft: PageDraft
  brief?: PageBrief
  /** Director's per-page critique row for this slug. Surfaces inline
   *  with the draft so the strategist sees scores + problem lines
   *  alongside the copy they're reviewing. */
  critique?: {
    // New 5-axis
    dignity?: number; voice_character?: number; claim_plausibility?: number
    // Common
    persona_fit?: number; atom_coverage?: number
    // Legacy 4-axis (back-compat)
    voice_match?: number; slot_health?: number
    summary?: string
    standout_lines?: string[]
    problem_lines?: string[]
  } | null
  /** Pre-bind suggestion for this page. Each entry names the Brixies
   *  template the engine picked for one section — surfaced inline so
   *  the strategist reviews the BOUND preview at Gate 2, not just the
   *  archetype-shaped draft. Swap UI for choosing a different
   *  template per section ships in Wave B. */
  bindSuggestion?: {
    sections: Array<{
      section_ix: number; archetype: string
      chosen_template_id: string | null; chosen_layer_name: string | null
      candidate_count: number; rationale: string
    }>
    generated_at?: string
    user_overrides?: Record<string, string>
  } | null
  /** Per-slot edit. Fires the slot-edit agent via the orchestrate
   *  single_slot dispatch — rewrites ONE slot, preserves everything
   *  else byte-for-byte. */
  onEditSlot?: (sectionIx: number, slotKey: string, instruction: string) => void
  /** Re-draft just one section by pinning the page-draft prompt to a
   *  section index + instruction. Other sections aren't touched. */
  onRedraftSection?: (sectionIx: number, instruction: string) => void
  /** Restructure operation — swap a single section's archetype OR
   *  consolidate multiple sections into one new archetype. Dispatches
   *  to orchestrate's `restructure_sections` action which wraps a
   *  page-draft re-run with a carefully pinned feedback note. */
  onRestructure?: (params: {
    mode: 'swap' | 'consolidate'
    sectionIxs: number[]
    targetArchetype: string
    instruction: string
  }) => void
  /** Strategist picked a different Brixies template for one section
   *  at Gate 2. Persists override on roadmap_state.page_bind_
   *  suggestions; commit honors it. */
  onSwapTemplate?: (sectionIx: number, templateId: string) => void
  /** Strategist asked the AI to redistribute the section's copy into
   *  the new template's slot shape (useful when the new template has
   *  cards[] but the source was hero-shaped, etc.). */
  onReorgForTemplate?: (sectionIx: number, templateId: string, instruction: string) => void
  busy?: boolean
}) {
  // Selection state for multi-section operations. Set of zero-indexed
  // section ixs. Persists across the draft's expanded lifetime; resets
  // when the user clicks "Clear selection".
  const [selectedIxs, setSelectedIxs] = useState<Set<number>>(() => new Set())
  const [restructureArchetype, setRestructureArchetype] = useState<string>(ARCHETYPES[0])
  const [restructureNote, setRestructureNote] = useState('')
  const sections = Array.isArray(draft?.sections) ? draft.sections : []
  return (
    <div>
      <PageBriefHeader brief={brief} />
      {critique && (
        <div className="rounded-md border border-wm-border bg-wm-bg p-3 mb-3 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Director critique</p>
            <span className="text-[10px] text-wm-text-muted">
              {/* 5-axis when present; falls back to legacy 4-axis. Dignity rendered in danger color if <70. */}
              <span className={(critique.dignity != null && critique.dignity < 70) ? 'text-wm-danger font-semibold' : ''}>dignity {critique.dignity ?? '—'}</span>
              {' · '}voice {critique.voice_character ?? critique.voice_match ?? '—'}
              {' · '}persona {critique.persona_fit ?? '—'}
              {' · '}atoms {critique.atom_coverage ?? '—'}
              {' · '}claims {critique.claim_plausibility ?? '—'}
            </span>
          </div>
          {critique.summary && <p className="text-[12px] text-wm-text leading-snug">{critique.summary}</p>}
          {critique.standout_lines && critique.standout_lines.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-success">Working</p>
              <ul className="space-y-0.5">
                {critique.standout_lines.map((line, i) => (
                  <li key={i} className="text-[11px] text-wm-text italic">"{line}"</li>
                ))}
              </ul>
            </div>
          )}
          {critique.problem_lines && critique.problem_lines.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-danger">Flagged</p>
              <ul className="space-y-0.5">
                {critique.problem_lines.map((line, i) => (
                  <li key={i} className="text-[11px] text-wm-danger">· {line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {/* Restructure toolbar — appears when 1+ sections are selected.
          Single section → swap archetype. Multiple → consolidate
          into one section of the picked archetype. */}
      {onRestructure && selectedIxs.size > 0 && (
        <div className="rounded-md border border-wm-accent/40 bg-wm-accent/5 p-3 mb-3 flex items-center gap-2 flex-wrap">
          <p className="text-[11px] font-bold text-wm-accent-strong">
            {selectedIxs.size === 1
              ? `Section ${[...selectedIxs][0] + 1} selected · Swap archetype:`
              : `${selectedIxs.size} sections selected · Consolidate into:`}
          </p>
          <select
            value={restructureArchetype}
            onChange={e => setRestructureArchetype(e.target.value)}
            disabled={busy}
            className="rounded border border-wm-border bg-white px-2 py-1 text-[11px] font-mono disabled:opacity-50"
          >
            {ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input
            type="text"
            value={restructureNote}
            onChange={e => setRestructureNote(e.target.value)}
            placeholder='Optional note: "use the discovery Q14 phrase as the anchor"'
            disabled={busy}
            className="flex-1 min-w-[200px] rounded border border-wm-border bg-white px-2 py-1 text-[11px] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => {
              const ixs = [...selectedIxs].sort((a, b) => a - b)
              onRestructure({
                mode: selectedIxs.size === 1 ? 'swap' : 'consolidate',
                sectionIxs: ixs,
                targetArchetype: restructureArchetype,
                instruction: restructureNote.trim(),
              })
              setSelectedIxs(new Set())
              setRestructureNote('')
            }}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full bg-wm-accent px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
            {selectedIxs.size === 1 ? 'Swap' : 'Consolidate'}
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIxs(new Set()); setRestructureNote('') }}
            disabled={busy}
            className="text-[10px] text-wm-text-muted hover:text-wm-text"
          >
            Clear
          </button>
        </div>
      )}
      {(() => {
        const validation = (draft as { validation?: { flags?: unknown[]; unused_atoms?: string[] } } | undefined)?.validation
        const flags = Array.isArray(validation?.flags) ? validation.flags : []
        const unusedAtoms = Array.isArray(validation?.unused_atoms) ? validation.unused_atoms : []
        if (flags.length === 0 && unusedAtoms.length === 0) return null
        return (
          <DraftFlagsPanel
            flags={flags}
            unusedAtoms={unusedAtoms}
            onEditSlot={onEditSlot}
            onRedraftSection={onRedraftSection}
            busy={busy ?? false}
          />
        )
      })()}
      {sections.length === 0 ? (
        <p className="text-[12px] text-wm-text-muted">No sections in this draft.</p>
      ) : (
        <div className="space-y-3">
          {bindSuggestion && (
            <div className="rounded-md border border-wm-accent/30 bg-wm-accent/5 p-2.5 text-[11px] text-wm-text leading-snug">
              <span className="font-semibold">✓ Brixies preview ready.</span>{' '}
              The engine matched each section below to a Brixies template variant.
              Review the picks inline (the template name appears next to each section's archetype) — when you click <strong>Commit</strong>, these picks become real <code>web_sections</code> rows. To swap a template, use the Pages tab after commit (per-section template swap on this screen ships in the next wave).
              {bindSuggestion.sections.some(s => !s.chosen_template_id) && (
                <span className="block mt-1 text-wm-warning">
                  ⚠ {bindSuggestion.sections.filter(s => !s.chosen_template_id).length} section(s) had no compatible template in our library — they'll commit as freehand markdown.
                </span>
              )}
            </div>
          )}
          {renderDraftSections(sections, {
            onEditSlot, onRedraftSection, busy,
            selectedIxs: onRestructure ? selectedIxs : null,
            toggleSelected: onRestructure ? (ix: number) => {
              setSelectedIxs(prev => {
                const next = new Set(prev)
                if (next.has(ix)) next.delete(ix); else next.add(ix)
                return next
              })
            } : undefined,
            bindBySectionIx: bindSuggestion
              ? Object.fromEntries(bindSuggestion.sections.map(s => {
                  // user_overrides win over the engine's pick — surface
                  // the user's pick when present so the inline label
                  // reflects what'll actually commit.
                  const override = bindSuggestion.user_overrides?.[String(s.section_ix)]
                  return [s.section_ix, {
                    chosen_template_id: override ?? s.chosen_template_id,
                    chosen_layer_name:  s.chosen_layer_name,
                    candidate_count:    s.candidate_count,
                  }]
                }))
              : undefined,
            onSwapTemplate, onReorgForTemplate,
          })}
        </div>
      )}
    </div>
  )
}

function renderDraftSections(
  // Section shape is intentionally loose — the page-draft agent emits
  // an open `copy` object whose keys depend on archetype, so a strict
  // type would fight us. Cast at the leaf access sites.
  sections: Array<Record<string, unknown>>,
  actions?: {
    onEditSlot?: (sectionIx: number, slotKey: string, instruction: string) => void
    onRedraftSection?: (sectionIx: number, instruction: string) => void
    busy?: boolean
    /** When non-null, sections are selectable. The set tracks which
     *  zero-indexed section ixs are currently checked. */
    selectedIxs?: Set<number> | null
    toggleSelected?: (sectionIx: number) => void
    /** Pre-bind suggestion per section_ix — surfaces the chosen
     *  Brixies template alongside the archetype label. */
    bindBySectionIx?: Record<number, {
      chosen_template_id: string | null
      chosen_layer_name: string | null
      candidate_count: number
    }>
    /** Strategist clicked a different template for this section.
     *  Persists the override; commit will use it. */
    onSwapTemplate?: (sectionIx: number, templateId: string) => void
    /** Strategist asked the AI to redistribute copy into the new
     *  template's slot shape. Optional follow-up to swap. */
    onReorgForTemplate?: (sectionIx: number, templateId: string, instruction: string) => void
  },
) {
  return sections.map((s, i: number) => {
    const bindForThis = actions?.bindBySectionIx?.[i]
        // Section copy is open-shaped (slots vary per archetype). The
        // leaf accesses below already guard with `&&`/`Array.isArray`
        // and wrap text in String(), so an `any` cast here is the
        // pragmatic choice rather than typing every slot.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const copy = (s?.copy ?? {}) as any
        const isSelected = !!actions?.selectedIxs?.has(i)
        return (
          <div
            key={i}
            className={[
              'rounded-md border bg-wm-bg-elevated p-3',
              isSelected ? 'border-wm-accent' : 'border-wm-border',
            ].join(' ')}
          >
            <div className="flex items-baseline gap-2 mb-2">
              {actions?.toggleSelected && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => actions.toggleSelected?.(i)}
                  disabled={actions.busy}
                  title="Select for restructure (swap archetype or consolidate)"
                  className="shrink-0"
                />
              )}
              <span className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">{(s?.archetype as string | undefined) ?? '—'}</span>
              {bindForThis && (
                <SectionBindPicker
                  archetype={String((s?.archetype as string | undefined) ?? '')}
                  sectionIx={i}
                  currentTemplateId={bindForThis.chosen_template_id}
                  currentLayerName={bindForThis.chosen_layer_name}
                  onSwap={actions?.onSwapTemplate}
                  onReorg={actions?.onReorgForTemplate}
                  busy={actions?.busy ?? false}
                />
              )}
              <span className="text-[10px] text-wm-text-subtle">#{i + 1}</span>
              {Array.isArray(s?.atoms_used) && s.atoms_used.length > 0 && (
                <span className="text-[10px] text-wm-text-muted ml-auto">{s.atoms_used.length} atoms</span>
              )}
            </div>
            {copy.eyebrow && <p className="text-[10px] uppercase tracking-widest text-wm-accent-strong mb-1">{String(copy.eyebrow)}</p>}
            {copy.heading && <p className="text-[15px] font-semibold text-wm-text">{String(copy.heading)}</p>}
            {copy.tagline && <p className="text-[13px] italic text-wm-text-muted mt-0.5">{String(copy.tagline)}</p>}
            {copy.description && <p className="text-[13px] text-wm-text mt-1 leading-snug">{String(copy.description)}</p>}
            {copy.body && <p className="text-[12px] text-wm-text-muted mt-1 leading-snug whitespace-pre-wrap">{String(copy.body)}</p>}
            {Array.isArray(copy.cards) && copy.cards.length > 0 && (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                {copy.cards.map((c: any, j: number) => (
                  <div key={j} className="rounded border border-wm-border p-2">
                    {c.heading && <p className="text-[12px] font-semibold text-wm-text">{String(c.heading)}</p>}
                    {c.description && <p className="text-[11px] text-wm-text-muted mt-0.5">{String(c.description)}</p>}
                    {c.cta_label && <p className="text-[11px] text-wm-accent-strong mt-0.5">{String(c.cta_label)} →</p>}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(copy.items) && copy.items.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {copy.items.map((it: any, j: number) => (
                  <div key={j} className="border-l-2 border-wm-accent/30 pl-2">
                    {it.heading && <p className="text-[12px] font-semibold text-wm-text">{String(it.heading)}</p>}
                    {it.body && <p className="text-[11px] text-wm-text-muted mt-0.5">{String(it.body)}</p>}
                  </div>
                ))}
              </div>
            )}
            {copy.cta?.label && (
              <p className="mt-2 text-[12px]">
                <span className="inline-block px-2 py-0.5 rounded-full bg-wm-accent text-white text-[11px]">{String(copy.cta.label)} →</span>
              </p>
            )}
            {s?.voice_notes && (
              <p className="mt-2 text-[10px] italic text-wm-text-subtle border-t border-wm-border pt-2">
                <Eye size={10} className="inline mr-1" />{String(s.voice_notes)}
              </p>
            )}
            {actions && (actions.onEditSlot || actions.onRedraftSection) && (
              <SectionEditActions
                copy={copy}
                sectionIx={i}
                onEditSlot={actions.onEditSlot}
                onRedraftSection={actions.onRedraftSection}
                busy={actions.busy ?? false}
              />
            )}
          </div>
        )
      })
}

/** Per-section edit affordances rendered beneath each draft section.
 *  Two operations: "Edit one slot" (calls slot-edit via orchestrate
 *  single_slot dispatch) and "Rewrite this section" (calls page-draft
 *  pinned to this section's index). Both expand inline so the editor
 *  doesn't shift the entire workspace. */
function SectionEditActions({
  copy, sectionIx, onEditSlot, onRedraftSection, busy,
}: {
  copy: Record<string, any>
  sectionIx: number
  onEditSlot?: (sectionIx: number, slotKey: string, instruction: string) => void
  onRedraftSection?: (sectionIx: number, instruction: string) => void
  busy: boolean
}) {
  const [mode, setMode] = useState<'idle' | 'slot' | 'section'>('idle')
  const [instruction, setInstruction] = useState('')
  // Build the slot key options from the copy keys actually present.
  // Nested arrays surface as "cards[0].heading" / "items[2].body".
  const slotOptions = useMemo<string[]>(() => {
    const out: string[] = []
    for (const [k, v] of Object.entries(copy ?? {})) {
      if (Array.isArray(v)) {
        v.forEach((item, j) => {
          if (item && typeof item === 'object') {
            for (const innerKey of Object.keys(item as Record<string, unknown>)) {
              out.push(`${k}[${j}].${innerKey}`)
            }
          }
        })
      } else if (v != null && (typeof v === 'string' || typeof v === 'object')) {
        out.push(k)
      }
    }
    return out
  }, [copy])
  const [slotKey, setSlotKey] = useState<string>(() => slotOptions[0] ?? '')

  if (mode === 'idle') {
    return (
      <div className="mt-2 pt-2 border-t border-wm-border flex items-center gap-2">
        {onEditSlot && (
          <button
            type="button"
            onClick={() => setMode('slot')}
            disabled={busy}
            className="text-[10px] text-wm-accent-strong hover:underline disabled:opacity-50"
          >
            Edit one slot
          </button>
        )}
        {onRedraftSection && (
          <button
            type="button"
            onClick={() => setMode('section')}
            disabled={busy}
            className="text-[10px] text-wm-accent-strong hover:underline disabled:opacity-50"
          >
            Rewrite this section
          </button>
        )}
      </div>
    )
  }

  const submit = () => {
    if (!instruction.trim()) return
    if (mode === 'slot' && slotKey && onEditSlot) {
      onEditSlot(sectionIx, slotKey, instruction.trim())
    } else if (mode === 'section' && onRedraftSection) {
      onRedraftSection(sectionIx, instruction.trim())
    }
    setMode('idle'); setInstruction('')
  }

  return (
    <div className="mt-2 pt-2 border-t border-wm-border space-y-2">
      <div className="flex items-baseline gap-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
          {mode === 'slot' ? 'Edit one slot' : 'Rewrite this section'}
        </p>
        <button
          type="button"
          onClick={() => { setMode('idle'); setInstruction('') }}
          disabled={busy}
          className="text-[10px] text-wm-text-muted hover:text-wm-text ml-auto"
        >
          Cancel
        </button>
      </div>
      {mode === 'slot' && (
        <select
          value={slotKey}
          onChange={e => setSlotKey(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-wm-border bg-white px-2 py-1 text-[11px] font-mono"
        >
          {slotOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      )}
      <textarea
        value={instruction}
        onChange={e => setInstruction(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
        placeholder={mode === 'slot'
          ? 'What\'s wrong with this slot? e.g. "Heading reads like an ad slogan; anchor on the discovery Q14 phrase"'
          : 'What\'s wrong with this section? e.g. "Wrong atom emphasis — lead with the visit experience, not the service times"'}
        rows={3}
        disabled={busy}
        className="w-full rounded border border-wm-border bg-white px-2 py-1.5 text-[12px] focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !instruction.trim()}
          className="inline-flex items-center gap-1 rounded-full bg-wm-accent px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          {mode === 'slot' ? 'Edit slot' : 'Rewrite section'}
        </button>
      </div>
    </div>
  )
}

function ConfirmPanel({ title, children, onCancel, onConfirm, confirmLabel, busy }: {
  title: string; children: React.ReactNode
  onCancel: () => void; onConfirm: () => void | Promise<void>
  confirmLabel: string; busy?: boolean
}) {
  return (
    <div className="rounded-md border border-wm-accent/30 bg-wm-accent/5 p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">{title}</p>
      {children}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="text-[12px] text-wm-text-muted px-3 py-1 hover:text-wm-text">Cancel</button>
        <button
          onClick={() => void onConfirm()}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {confirmLabel}
        </button>
      </div>
    </div>
  )
}

function ExportImportPanel({ projectId, onImported }: {
  projectId: string
  onImported: () => Promise<void>
}) {
  type Scope = 'sitemap' | 'copy' | 'full'
  const [busy, setBusy] = useState<{ kind: 'export'; scope: Scope } | { kind: 'import' } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [exportResult, setExportResult] = useState<{ filename: string; bytes: number; scope: Scope } | null>(null)
  const [importMsg, setImportMsg] = useState<{
    kind: 'ok' | 'err'
    text: string
    detail?: { warnings?: string[]; next_steps?: string[]; details?: string[] }
  } | null>(null)

  const handleExport = useCallback(async (scope: Scope) => {
    setBusy({ kind: 'export', scope }); setExportResult(null)
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ projectId, action: 'export_state', scope }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Export failed')
      const doc = json?.export?.document
      const filename = json?.export?.filename ?? `${scope}-export.md`
      if (typeof doc !== 'string') throw new Error('Export returned no document')
      const blob = new Blob([doc], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setExportResult({ filename, bytes: doc.length, scope })
    } catch (e) {
      setExportResult(null)
      setImportMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Export failed' })
    } finally { setBusy(null) }
  }, [projectId])

  const handleImport = useCallback(async () => {
    if (!importText.trim()) return
    setBusy({ kind: 'import' }); setImportMsg(null)
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ projectId, action: 'import_state', document: importText }),
      })
      const json = await res.json()
      if (!res.ok) {
        setImportMsg({
          kind: 'err',
          text: json?.error ?? `HTTP ${res.status}`,
          detail: { details: Array.isArray(json?.details) ? json.details : json?.hint ? [json.hint] : undefined },
        })
        return
      }
      const result = json?.import ?? {}
      const changes = result.changes ?? {}
      const summary: string[] = []
      if (changes.sitemap) summary.push('sitemap')
      if (Array.isArray(changes.briefs) && changes.briefs.length > 0) summary.push(`${changes.briefs.length} brief${changes.briefs.length === 1 ? '' : 's'}`)
      if (Array.isArray(changes.drafts) && changes.drafts.length > 0) summary.push(`${changes.drafts.length} draft${changes.drafts.length === 1 ? '' : 's'}`)
      setImportMsg({
        kind: 'ok',
        text: summary.length > 0 ? `Imported: ${summary.join(', ')}.` : 'Imported, but no sections changed.',
        detail: { warnings: result.warnings, next_steps: result.next_steps },
      })
      setImportText('')
      setImportOpen(false)
      await onImported()
    } catch (e) {
      setImportMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Import failed' })
    } finally { setBusy(null) }
  }, [importText, projectId, onImported])

  const isExportingScope = (scope: Scope): boolean =>
    busy?.kind === 'export' && busy.scope === scope
  const isBusy = busy != null

  return (
    <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4 space-y-3">
      <header>
        <h3 className="text-[14px] font-semibold text-wm-text">Upload or download a sitemap / copy</h3>
        <p className="text-[12px] text-wm-text-muted leading-snug">
          Works two ways. <strong>Upload</strong> if you've drafted a sitemap or
          copy outside this tool (in another AI conversation, in a doc, in a
          spreadsheet you've structured) and want to bring it in to drive
          downstream stages. <strong>Download</strong> if you want to pull the
          current project out as markdown, edit it elsewhere, and paste it
          back. Sitemap download is light (nav + audit only); copy download
          carries the full strategic foundation (voice card, personas, SEO
          targets, snippets) so an external AI conversation stays on-voice.
        </p>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => void handleExport('sitemap')}
          disabled={isBusy}
          title="Download the sitemap + coverage audit only. Lightweight, focused on nav refinement."
          className="inline-flex items-center gap-1.5 rounded-full border border-wm-accent/40 bg-white hover:bg-wm-accent/5 px-3 py-1.5 text-[12px] font-semibold text-wm-accent-strong disabled:opacity-50"
        >
          {isExportingScope('sitemap') ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
          Download sitemap
        </button>
        <button
          type="button"
          onClick={() => void handleExport('copy')}
          disabled={isBusy}
          title="Download the page briefs + drafts + voice card + personas + SEO targets + snippets + audit. Everything an external copywriting conversation needs."
          className="inline-flex items-center gap-1.5 rounded-full border border-wm-accent/40 bg-white hover:bg-wm-accent/5 px-3 py-1.5 text-[12px] font-semibold text-wm-accent-strong disabled:opacity-50"
        >
          {isExportingScope('copy') ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          Download copy
        </button>
        <button
          type="button"
          onClick={() => void handleExport('full')}
          disabled={isBusy}
          title="Download everything — sitemap + audit + briefs + drafts + voice + snippets. Largest payload."
          className="inline-flex items-center gap-1.5 rounded-full border border-wm-border bg-wm-bg hover:bg-wm-accent/5 px-3 py-1.5 text-[12px] text-wm-text disabled:opacity-50"
        >
          {isExportingScope('full') ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          Download everything
        </button>
        <button
          type="button"
          onClick={() => { setImportOpen(o => !o); setImportMsg(null) }}
          disabled={isBusy}
          title="Paste a sitemap or copy document to bring it INTO the engine. Works for first-time uploads (no existing data yet) or for applying edits to existing data — the importer overwrites whatever sections you include."
          className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent hover:bg-wm-accent/90 px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          {importOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {importOpen ? 'Hide upload' : 'Upload sitemap / copy'}
        </button>
        {exportResult && (
          <span className="text-[11px] text-wm-text-subtle ml-auto">
            Downloaded {exportResult.filename} ({Math.round(exportResult.bytes / 1024)} KB)
          </span>
        )}
      </div>

      {importOpen && (
        <div className="space-y-2">
          <div className="rounded-md border border-wm-border bg-wm-bg p-3 text-[11px] text-wm-text-muted leading-snug space-y-1.5">
            <p>
              <strong className="text-wm-text">Paste a document below.</strong>{' '}
              The importer reads the <code className="text-[10px]">## Sitemap</code>,{' '}
              <code className="text-[10px]">## Page Briefs</code>, and{' '}
              <code className="text-[10px]">## Page Drafts</code> headers and applies whatever{' '}
              <code className="text-[10px]">```json</code> block is under each one. Missing sections are skipped — you can upload JUST a sitemap if that's all you have.
            </p>
            <p>
              Don't have an export to start from? Download an empty template
              with the right metadata header + section placeholders, fill in
              your sitemap (and optionally briefs/drafts), and paste back.
            </p>
            <button
              type="button"
              onClick={() => {
                const template = buildEmptyImportTemplate(projectId)
                const blob = new Blob([template], { type: 'text/markdown;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = 'copy-engine-empty-template.md'; a.click()
                URL.revokeObjectURL(url)
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-wm-border bg-wm-bg-elevated hover:bg-wm-accent/5 px-3 py-1 text-[11px] text-wm-text"
            >
              <FileText size={11} /> Download empty template
            </button>
          </div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder="Paste a Copy Engine document here — either one you downloaded from this app, or one you've drafted matching the format (use the empty template above as a starting point)…"
            rows={10}
            className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[12px] font-mono focus:outline-none focus:border-wm-accent"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-wm-text-subtle">
              {importText.length.toLocaleString()} characters
            </p>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy != null || !importText.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white font-semibold disabled:opacity-50"
            >
              {busy?.kind === 'import' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Apply upload
            </button>
          </div>
        </div>
      )}

      {importMsg && (
        <div className={[
          'rounded-md border px-3 py-2 text-[12px] space-y-1',
          importMsg.kind === 'ok' ? 'border-wm-success/30 bg-wm-success-bg text-wm-success'
            : 'border-wm-danger/30 bg-wm-danger-bg text-wm-danger',
        ].join(' ')}>
          <p>{importMsg.text}</p>
          {Array.isArray(importMsg.detail?.warnings) && importMsg.detail.warnings.length > 0 && (
            <ul className="text-[11px] text-wm-text-muted">
              {importMsg.detail.warnings.map((w, i) => <li key={i}>· {w}</li>)}
            </ul>
          )}
          {Array.isArray(importMsg.detail?.next_steps) && importMsg.detail.next_steps.length > 0 && (
            <div className="pt-1 text-[11px] text-wm-text-muted">
              <p className="font-semibold">Next steps:</p>
              <ul>
                {importMsg.detail.next_steps.map((s, i) => <li key={i}>· {s}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(importMsg.detail?.details) && importMsg.detail.details.length > 0 && (
            <ul className="text-[11px]">
              {importMsg.detail.details.map((d, i) => <li key={i}>· {d}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function CoverageGate({
  data, running, stale, recommendedAction, gapCount,
  isOpen, onToggle, onRerun, onAutoFix, autoFixRunning,
  onPushToNav, pushToNavRunning, auditLoop, sitemapPageCount, disabled,
}: {
  data: {
    recommended_action?: 'proceed_to_stage_3' | 'redo_stage_2_with_gaps'
    summary?:            { overall_coverage_score?: number }
    [k: string]: unknown
  } | null
  running: boolean
  stale: boolean
  recommendedAction: 'proceed_to_stage_3' | 'redo_stage_2_with_gaps' | null
  gapCount: number
  isOpen: boolean
  onToggle: () => void
  onRerun: () => void
  onAutoFix: () => void
  autoFixRunning: boolean
  onPushToNav: () => void
  pushToNavRunning: boolean
  auditLoop: {
    status: 'proceeded' | 'needs_human' | 'audit_failed'
    iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }>
    residual_gap_count: number
    message: string
  } | null
  sitemapPageCount: number | null
  disabled: boolean
}) {
  // No audit yet, or running for the first time
  if (running && !data) {
    return (
      <div className="rounded-md bg-wm-accent/5 border border-wm-accent/30 p-3 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-wm-accent-strong" />
        <p className="text-[12px] text-wm-text">Running coverage audit on the current sitemap…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-md bg-wm-bg border border-wm-border p-3 flex items-center gap-3">
        <AlertCircle size={14} className="text-wm-text-subtle" />
        <p className="text-[12px] text-wm-text-muted flex-1">
          Coverage audit not run yet. Click below to check whether every Stage 0 topic has a home in this sitemap.
        </p>
        <button
          type="button"
          onClick={onRerun}
          disabled={disabled}
          className="text-[11px] text-wm-accent-strong hover:underline disabled:opacity-50"
        >
          Run audit
        </button>
      </div>
    )
  }

  const isProceed = recommendedAction === 'proceed_to_stage_3'
  const tone = isProceed ? 'success' : 'warning'
  const toneClass = tone === 'success'
    ? 'border-wm-success/30 bg-wm-success-bg'
    : 'border-wm-warning/30 bg-wm-warning-bg'
  const iconClass = tone === 'success' ? 'text-wm-success' : 'text-wm-warning'

  const score = data?.summary?.overall_coverage_score
  const pct = typeof score === 'number' ? Math.round(score * 100) : null

  return (
    <div className={['rounded-md border p-3', toneClass].join(' ')}>
      <div className="flex items-start gap-3">
        {isProceed
          ? <CheckCircle2 size={16} className={['mt-0.5 shrink-0', iconClass].join(' ')} />
          : <AlertCircle  size={16} className={['mt-0.5 shrink-0', iconClass].join(' ')} />}
        <div className="flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-[12px] font-semibold text-wm-text">
              Coverage audit:{' '}
              {isProceed ? 'clear to approve' : `${gapCount} ${gapCount === 1 ? 'gap' : 'gaps'} flagged — review before approving`}
            </p>
            {pct != null && (
              <span className="text-[10px] uppercase tracking-wider font-bold text-wm-text-subtle">
                {pct}% covered
              </span>
            )}
            {stale && (
              <span className="text-[10px] uppercase tracking-wider font-bold text-wm-warning ml-1">
                stale
              </span>
            )}
          </div>
          <p className="text-[11px] text-wm-text-muted mt-0.5 leading-snug">
            {isProceed
              ? 'Every Stage 0 topic has a home in this sitemap (dedicated page, anchored section, or intentional omission).'
              : 'Some topics may be invisible (no nav reference, sparse anchor sections, etc.). Open the details to see exactly which.'}
          </p>
          {auditLoop && (
            <p className={[
              'text-[11px] mt-1 leading-snug',
              auditLoop.status === 'proceeded' ? 'text-wm-success'
                : auditLoop.status === 'needs_human' ? 'text-wm-warning' : 'text-wm-text-muted',
            ].join(' ')}>
              {auditLoop.status === 'proceeded' ? '✓ ' : auditLoop.status === 'needs_human' ? '⚠ ' : '· '}
              {auditLoop.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1"
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isOpen ? 'Hide details' : 'View details'}
        </button>
        {!isProceed && (
          <button
            type="button"
            onClick={onPushToNav}
            disabled={disabled || pushToNavRunning || autoFixRunning || running}
            className="inline-flex items-center gap-1 rounded-full border border-wm-accent/40 bg-white px-3 py-1 text-[11px] font-semibold text-wm-accent-strong hover:bg-wm-accent/5 disabled:opacity-50"
            title="Push audit findings into the sitemap as additive edits only (new pages, new nav entries, new footer items). Does NOT redraft or rename existing pages."
          >
            {pushToNavRunning ? <Loader2 size={11} className="animate-spin" /> : <GitBranch size={11} />}
            Push to nav
          </button>
        )}
        {!isProceed && (
          <button
            type="button"
            onClick={onAutoFix}
            disabled={disabled || autoFixRunning || pushToNavRunning || running}
            className="inline-flex items-center gap-1 rounded-full bg-wm-warning px-3 py-1 text-[11px] font-semibold text-white hover:bg-wm-warning/90 disabled:opacity-50"
            title={`Auto-redraft the sitemap using the audit's findings as feedback. Caps at 2 loops; pauses if gaps remain after that. Heavier than "Push to nav" — can rename/restructure pages.`}
          >
            {autoFixRunning ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            Auto-fix gaps
          </button>
        )}
        <button
          type="button"
          onClick={onRerun}
          disabled={disabled || running}
          className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
        >
          {running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Re-run audit
        </button>
      </div>
      {isOpen && (
        <div className="mt-3 pt-3 border-t border-wm-border">
          <SitemapCoveragePreview
            output={data as Record<string, unknown>}
            sitemapPageCount={sitemapPageCount ?? undefined}
          />
        </div>
      )}
    </div>
  )
}

/** Surfaces extraction problems BEFORE Gate 1. Three buckets:
 *   - Stage 0 (normalize-intake) issues: truncation suspected, big drop
 *     vs prior run, missing source coverage, file-load failures.
 *   - Stage 1 (synthesize) issues: empty payload (the 3886 case), few
 *     substantive keys, truncation suspected.
 *   - Source-coverage gaps: a source landed in the prompt but
 *     contributed zero atoms (red flag for silent drops). */
function SetupHealthBanner({
  stage0Meta, stage1Meta, hasStage1, onReNormalize, onReSynthesize, running,
}: {
  stage0Meta: {
    atom_count?: number; fact_count?: number
    truncation_suspected?: boolean
    significant_drop_vs_prior?: boolean
    atoms_delta_vs_prior?: number
    atoms_by_source?: Record<string, number>
    sources_loaded?: Record<string, boolean | number>
  } | null
  stage1Meta: { truncation_suspected?: boolean; looks_empty?: boolean; substantive_keys_count?: number } | null
  hasStage1: boolean
  onReNormalize: () => void
  onReSynthesize: () => void
  running: string | null
}) {
  type Row = { severity: 'critical' | 'warning' | 'info'; title: string; detail: string; cta?: { label: string; on: () => void; busy: boolean } }
  const rows: Row[] = []

  // Stage 0 truncation
  if (stage0Meta?.truncation_suspected) {
    rows.push({
      severity: 'critical',
      title: 'Stage 0 (intake normalization) may have truncated.',
      detail: `Output used 90%+ of the token budget — atoms or facts at the end of the response may be missing. ${
        typeof stage0Meta.atoms_delta_vs_prior === 'number' && stage0Meta.atoms_delta_vs_prior < 0
          ? `Atom count dropped by ${Math.abs(stage0Meta.atoms_delta_vs_prior)} vs prior run.` : ''
      }`,
      cta: { label: 'Re-extract intake', on: onReNormalize, busy: running === 'run_normalize' },
    })
  }
  // Stage 0 significant-drop without truncation flag (model variance / removed sources)
  if (stage0Meta?.significant_drop_vs_prior && !stage0Meta?.truncation_suspected) {
    rows.push({
      severity: 'warning',
      title: 'Stage 0 produced significantly fewer atoms than the prior run.',
      detail: `Atom count fell by ${Math.abs(stage0Meta.atoms_delta_vs_prior ?? 0)} (≥20%). The prior run's atoms are snapshotted on stage_0._prior_runs and can be compared. Re-run if this wasn't intentional.`,
      cta: { label: 'Re-extract intake', on: onReNormalize, busy: running === 'run_normalize' },
    })
  }
  // Stage 0 source-coverage gap — a source LOADED but contributed 0 atoms.
  if (stage0Meta?.atoms_by_source && stage0Meta?.sources_loaded) {
    const noAtomSources: string[] = []
    const sources = stage0Meta.sources_loaded as Record<string, boolean | number>
    // Maps loader key → source_kind value the normalize agent stamps on atoms.
    const map: Array<{ loader: keyof typeof sources; source_kind: string; label: string }> = [
      { loader: 'strategy_brief',             source_kind: 'strategy_brief',           label: 'Strategy brief' },
      { loader: 'discovery',                  source_kind: 'discovery_questionnaire',  label: 'Discovery questionnaire' },
      { loader: 'am_handoff',                 source_kind: 'am_handoff',               label: 'AM handoff' },
      { loader: 'brand_guide',                source_kind: 'brand_handoff',            label: 'Brand guide' },
      { loader: 'brand_handoff',              source_kind: 'brand_handoff',            label: 'Brand handoff' },
      { loader: 'content_collection_session', source_kind: 'content_collection',       label: 'Content Collection session' },
      { loader: 'crawl_topics',               source_kind: 'site_crawl',               label: 'Site crawl' },
    ]
    for (const m of map) {
      const wasLoaded = sources[m.loader] === true || (typeof sources[m.loader] === 'number' && (sources[m.loader] as number) > 0)
      const atomCount = (stage0Meta.atoms_by_source as Record<string, number>)[m.source_kind] ?? 0
      if (wasLoaded && atomCount === 0) noAtomSources.push(m.label)
    }
    if (noAtomSources.length > 0) {
      rows.push({
        severity: 'warning',
        title: `Source(s) loaded but contributed 0 atoms: ${noAtomSources.join(', ')}.`,
        detail: 'These sources reached the normalizer but no atoms came from them. Either the source is genuinely empty (rare for primary intake) OR the normalizer dropped them. Re-run to confirm; if it persists, inspect the source content.',
        cta: { label: 'Re-extract intake', on: onReNormalize, busy: running === 'run_normalize' },
      })
    }
  }

  // Stage 1 empty / truncated
  if (hasStage1 === false && stage1Meta) {
    rows.push({
      severity: 'critical',
      title: 'Stage 1 (synthesize) produced no substantive output.',
      detail: stage1Meta.truncation_suspected
        ? 'The synthesize call hit the output token cap and the tool_use payload truncated mid-write. The token cap has been raised; re-running should produce a complete extraction.'
        : 'The synthesize call returned an empty payload. Re-run to retry.',
      cta: { label: 'Re-run Synthesize', on: onReSynthesize, busy: running === 'run_synthesize' },
    })
  } else if (stage1Meta?.truncation_suspected) {
    rows.push({
      severity: 'warning',
      title: 'Stage 1 (synthesize) may have truncated.',
      detail: 'Output used 90%+ of the token budget. The Stage 1 payload landed, but later keys may be incomplete. Re-run to verify.',
      cta: { label: 'Re-run Synthesize', on: onReSynthesize, busy: running === 'run_synthesize' },
    })
  }

  if (rows.length === 0) return null

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className={[
          'rounded-md border px-3 py-2 flex items-start gap-3',
          r.severity === 'critical' ? 'border-wm-danger/40 bg-wm-danger-bg' :
          r.severity === 'warning'  ? 'border-wm-warning/40 bg-wm-warning-bg' :
                                       'border-wm-border bg-wm-bg-elevated',
        ].join(' ')}>
          <AlertCircle size={14} className={[
            'shrink-0 mt-0.5',
            r.severity === 'critical' ? 'text-wm-danger' :
            r.severity === 'warning'  ? 'text-wm-warning' :
                                         'text-wm-text-muted',
          ].join(' ')} />
          <div className="flex-1 min-w-0">
            <p className={[
              'text-[12px] font-semibold',
              r.severity === 'critical' ? 'text-wm-danger' :
              r.severity === 'warning'  ? 'text-wm-warning' :
                                           'text-wm-text',
            ].join(' ')}>{r.title}</p>
            <p className="text-[11px] text-wm-text leading-snug mt-0.5">{r.detail}</p>
          </div>
          {r.cta && (
            <button
              type="button"
              onClick={r.cta.on}
              disabled={r.cta.busy || running != null}
              className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white border border-wm-border hover:bg-wm-accent/5 px-3 py-1 text-[11px] font-semibold text-wm-text disabled:opacity-50"
            >
              {r.cta.busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {r.cta.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Sticky in-flight indicator with a single Stop button. Renders only
 *  when something's actually running so it doesn't take up vertical
 *  space at idle. The Stop button fires cancel_run server-side AND
 *  aborts the client fetch — the user gets immediate UI feedback even
 *  while the cooperative cancellation propagates to the next sub-step
 *  boundary on the server. */
function InFlightBanner({
  running, engineRunning, engine, onStop, stopping,
}: {
  running: string | null
  engineRunning: boolean
  engine: EngineState
  onStop: () => void
  stopping: boolean
}) {
  if (!running && !engineRunning) return null
  // Skip Stop-button render while the cancel is in flight itself —
  // showing a "Stop" button next to a spinning "cancel_run" reads weird.
  const isActuallyRunning = running !== null && running !== 'cancel_run' && running !== 'reset_engine_state'
  const isCascade = engineRunning

  const label = (() => {
    if (running === 'cancel_run') return 'Cancelling…'
    if (running === 'run_synthesize') return 'Synthesizing strategy from intake…'
    if (running === 'draft_sitemap_with_audit') return 'Drafting sitemap + running coverage audit loop…'
    if (running === 'apply_audit_to_nav') return 'Pushing audit findings into nav…'
    if (running === 'run_coverage_audit') return 'Running coverage audit…'
    if (running === 'apply') return 'Re-drafting sitemap with your revisions…'
    if (running === 'approve_sitemap') return 'Approving sitemap…'
    if (running === 'run_drafts') return 'Writing page briefs and drafts…'
    if (running === 'critique') return 'Director critiquing the drafts…'
    if (running === 'iterate') return 'Applying critique directives…'
    if (running === 'commit') return 'Committing pages…'
    if (running === 'rename_sitemap_page') return 'Saving rename…'
    if (running === 'import_state') return 'Applying imported document…'
    if (running === 'export_state') return 'Building export document…'
    if (running) return `Running ${running}…`
    if (engineRunning) {
      const phase = engine.current_phase
      if (phase === 'page_briefs')         return 'Briefing pages…'
      if (phase === 'page_drafts')         return `Drafting pages · ${engine.pages_drafted ?? 0}/${engine.pages_total ?? '?'}`
      if (phase === 'director_critique')   return 'Director critiquing the drafts…'
      if (phase === 'applying_directives') return `Iterating · loop ${engine.loop_count ?? 0}`
      return 'Engine running…'
    }
    return 'Working…'
  })()

  return (
    <div className="rounded-md border border-wm-accent/40 bg-wm-accent/5 px-3 py-2 flex items-center gap-3">
      <Loader2 size={14} className="animate-spin text-wm-accent-strong shrink-0" />
      <p className="text-[12px] text-wm-text leading-snug flex-1">{label}</p>
      {(isActuallyRunning || isCascade) && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          className="inline-flex items-center gap-1 rounded-full border border-wm-danger/40 bg-white px-3 py-1 text-[11px] font-semibold text-wm-danger hover:bg-wm-danger/5 disabled:opacity-50"
          title="Stop the current step at its next safe boundary. Anything already written stays in the DB; the engine just doesn't proceed."
        >
          {stopping ? <Loader2 size={11} className="animate-spin" /> : <span className="block w-2.5 h-2.5 bg-wm-danger rounded-sm" />}
          Stop &amp; revise
        </button>
      )}
    </div>
  )
}

/** One row in the quick-rename panel. Edits stay local until the user
 *  blurs the field or presses Enter; then `onSave` fires with the
 *  triple. The parent decides which fields actually changed before
 *  calling the orchestrate action — empty diffs are no-ops. Slug
 *  edits warn inline since they invalidate sitemap approval. */
function PageRenameRow({
  page, saving, disabled, onSave,
}: {
  page: { name: string; slug: string; nav_label?: string }
  saving: boolean
  disabled: boolean
  onSave: (next: { name: string; navLabel: string; slug: string }) => Promise<void> | void
}) {
  // Local form state, seeded from props on mount. The parent re-keys
  // each row with the page's identity key so a remote rename (or slug
  // change) forces a clean remount with the new values — no in-place
  // sync needed.
  const [name, setName] = useState(page.name ?? '')
  const [navLabel, setNavLabel] = useState(page.nav_label ?? '')
  const [slug, setSlug] = useState(page.slug ?? '')

  const dirty = name !== (page.name ?? '') || navLabel !== (page.nav_label ?? '') || slug !== (page.slug ?? '')
  const slugChanged = slug !== (page.slug ?? '')

  const commit = async () => {
    if (!dirty || saving || disabled) return
    await onSave({ name, navLabel, slug })
  }

  return (
    <li className="rounded-md bg-white border border-wm-border p-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_1fr_180px] gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">Name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commit() } }}
              disabled={saving || disabled}
              className="rounded border border-wm-border bg-white px-2 py-1 text-[12px] text-wm-text focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">Nav label</span>
            <input
              type="text"
              value={navLabel}
              placeholder={name}
              onChange={e => setNavLabel(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commit() } }}
              disabled={saving || disabled}
              className="rounded border border-wm-border bg-white px-2 py-1 text-[12px] text-wm-text focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">Slug</span>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value.replace(/[^a-z0-9-]/gi, '-').toLowerCase())}
              onBlur={() => void commit()}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commit() } }}
              disabled={saving || disabled}
              className={[
                'rounded border bg-white px-2 py-1 text-[12px] font-mono focus:outline-none disabled:opacity-50',
                slugChanged ? 'border-wm-warning text-wm-warning focus:border-wm-warning' : 'border-wm-border text-wm-text focus:border-wm-accent',
              ].join(' ')}
            />
          </label>
        </div>
        <div className="shrink-0 w-[60px] text-right">
          {saving
            ? <Loader2 size={12} className="inline-block animate-spin text-wm-accent-strong" />
            : dirty
              ? <span className="text-[10px] text-wm-text-subtle">unsaved</span>
              : null}
        </div>
      </div>
      {slugChanged && (
        <p className="text-[10px] text-wm-warning mt-1.5">
          ⚠ Slug changes revert sitemap approval — downstream stages key off slugs.
        </p>
      )}
    </li>
  )
}

/** Inline per-section template picker rendered next to each section's
 *  archetype label at Gate 2. Click the current template name to
 *  expand a dropdown of compatible variants from the same Brixies
 *  family. Selecting a new variant fires onSwap (persists override)
 *  and offers an optional "Reorganize content" follow-up that calls
 *  the AI reorg agent — useful when the new template's slot shape is
 *  materially different from the section's current copy (e.g. swapping
 *  hero → cards_grid needs the description split into card bodies). */
function SectionBindPicker({
  archetype, sectionIx, currentTemplateId, currentLayerName,
  onSwap, onReorg, busy,
}: {
  archetype: string
  sectionIx: number
  currentTemplateId: string | null
  currentLayerName: string | null
  onSwap?: (sectionIx: number, templateId: string) => void
  onReorg?: (sectionIx: number, templateId: string, instruction: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState<Array<{ id: string; layer_name: string; family: string }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reorging, setReorging] = useState<string | null>(null)        // templateId being reorged
  const [reorgFor, setReorgFor] = useState<{ id: string; layer_name: string } | null>(null)
  const [reorgInstruction, setReorgInstruction] = useState('')

  const loadOptions = async () => {
    if (options) return
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ projectId: 'none', action: 'list_compatible_templates', archetype }),
        // ^ projectId not used by list_compatible_templates but required
        //   by the orchestrate handler's signature; harmless any-string.
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setOptions(Array.isArray(json.templates) ? json.templates : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load templates')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      {currentLayerName ? (
        <button
          type="button"
          onClick={() => { setOpen(o => !o); if (!options) void loadOptions() }}
          disabled={busy}
          className="text-[10px] text-wm-accent-strong font-medium underline decoration-dotted underline-offset-2 hover:text-wm-accent disabled:opacity-50"
          title="Click to swap to a different Brixies template for this section."
        >
          → {currentLayerName}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { setOpen(o => !o); if (!options) void loadOptions() }}
          disabled={busy}
          className="text-[10px] text-wm-warning font-medium underline decoration-dotted underline-offset-2 hover:text-wm-text disabled:opacity-50"
          title="No template auto-picked — this section will commit as freehand markdown unless you pick one."
        >
          → freehand (pick template)
        </button>
      )}
      {open && (
        <span className="ml-1 inline-flex items-center gap-1">
          {loading && <Loader2 size={10} className="animate-spin text-wm-text-subtle" />}
          {error && <span className="text-[10px] text-wm-danger">{error}</span>}
          {!loading && !error && options && (
            <select
              value={currentTemplateId ?? ''}
              disabled={busy}
              onChange={e => {
                const newId = e.target.value
                if (!newId || newId === currentTemplateId) { setOpen(false); return }
                const picked = options.find(o => o.id === newId)
                onSwap?.(sectionIx, newId)
                // After persisting the swap, prompt the user for an
                // optional AI reorg — surface as a follow-up panel
                // rather than auto-running so they can decide.
                if (picked) setReorgFor({ id: picked.id, layer_name: picked.layer_name })
                setOpen(false)
              }}
              className="rounded border border-wm-border bg-white px-1.5 py-0.5 text-[10px] font-mono disabled:opacity-50"
            >
              <option value="">— Pick template —</option>
              {options.map(o => (
                <option key={o.id} value={o.id}>{o.layer_name} ({o.family})</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-[10px] text-wm-text-subtle hover:text-wm-text"
          >
            ×
          </button>
        </span>
      )}
      {reorgFor && onReorg && (
        <span className="ml-2 inline-flex items-center gap-1 rounded border border-wm-accent/40 bg-wm-accent/5 px-1.5 py-0.5">
          <span className="text-[10px] text-wm-accent-strong">
            Swapped → <code className="font-mono">{reorgFor.layer_name}</code>.
          </span>
          <input
            type="text"
            value={reorgInstruction}
            onChange={e => setReorgInstruction(e.target.value)}
            disabled={busy || reorging === reorgFor.id}
            placeholder="Optional: how to redistribute…"
            className="rounded border border-wm-border bg-white px-1.5 py-0.5 text-[10px] disabled:opacity-50 w-[180px]"
          />
          <button
            type="button"
            onClick={async () => {
              setReorging(reorgFor.id)
              try { onReorg(sectionIx, reorgFor.id, reorgInstruction.trim()) }
              finally { setReorging(null); setReorgFor(null); setReorgInstruction('') }
            }}
            disabled={busy || reorging === reorgFor.id}
            className="rounded-full bg-wm-accent px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
          >
            {reorging === reorgFor.id ? <Loader2 size={10} className="animate-spin inline" /> : '✨ Reorg copy'}
          </button>
          <button
            type="button"
            onClick={() => { setReorgFor(null); setReorgInstruction('') }}
            disabled={busy || reorging === reorgFor.id}
            className="text-[10px] text-wm-text-subtle hover:text-wm-text"
          >
            Skip
          </button>
        </span>
      )}
    </span>
  )
}

/** Validation flags panel — splits the draft's flags into "the engine
 *  already auto-fixed this for you" vs "you need to decide what to do."
 *  Snippet substitutions land as plain strings (the post-draft snippet
 *  enforcer logs each "{literal} → {{token}}" replacement); the
 *  page-draft validator emits structured {section_ix, kind, field,
 *  value} objects for things the model can't auto-fix (em-dashes,
 *  heading length, parallel-clause tics). Both render distinctly so
 *  the strategist sees what's already handled and what still needs a
 *  call. */
interface StructuredFlag {
  section_ix: number
  kind: string
  field: string
  value: string
}

function DraftFlagsPanel({
  flags, unusedAtoms, onEditSlot, onRedraftSection, busy,
}: {
  flags: unknown[]
  unusedAtoms: string[]
  onEditSlot?: (sectionIx: number, slotKey: string, instruction: string) => void
  onRedraftSection?: (sectionIx: number, instruction: string) => void
  busy: boolean
}) {
  // Separate auto-fixed messages (strings) from issues that still
  // need a decision (objects with section_ix + kind).
  const autoFixedNotes: string[] = []
  const structured: StructuredFlag[] = []
  for (const f of flags) {
    if (typeof f === 'string') autoFixedNotes.push(f)
    else if (f && typeof f === 'object' && 'kind' in f && 'section_ix' in f) {
      structured.push(f as StructuredFlag)
    }
  }

  const kindLabel = (kind: string): string => {
    switch (kind) {
      case 'em_dash_overload':         return 'Em-dashes (LLM tic)'
      case 'heading_too_long':         return 'Heading over 8 words'
      case 'heading_has_question_mark': return 'Question-mark heading'
      case 'parallel_clause_heading':  return 'Parallel-clause heading'
      default:                          return kind.replace(/_/g, ' ')
    }
  }
  const kindFixInstruction = (kind: string, field: string): string => {
    switch (kind) {
      case 'em_dash_overload':
        return `Replace every em-dash (—) and en-dash (–) in this ${field} with a period or comma. If a sentence feels like it needs an em-dash, split into two sentences instead.`
      case 'heading_too_long':
        return `Tighten this heading to 8 words or fewer. Pick the strongest noun phrase; drop modifiers.`
      case 'heading_has_question_mark':
        return `Convert this question heading into a declarative noun phrase.`
      case 'parallel_clause_heading':
        return `Rewrite this heading without the "X, not Y" / "X, but Y" parallel-clause shape. Reach for a single declarative.`
      default:
        return `Address the ${kind.replace(/_/g, ' ')} flag in this ${field}.`
    }
  }

  return (
    <div className="rounded-md border border-wm-warning/40 bg-wm-warning-bg p-3 mb-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning">
        Draft flags
        {autoFixedNotes.length > 0 && structured.length > 0 && (
          <> · {structured.length} need{structured.length === 1 ? 's' : ''} a call · {autoFixedNotes.length} auto-fixed</>
        )}
        {autoFixedNotes.length === 0 && structured.length > 0 && (
          <> · {structured.length} need{structured.length === 1 ? 's' : ''} a call</>
        )}
        {autoFixedNotes.length > 0 && structured.length === 0 && (
          <> · {autoFixedNotes.length} auto-fixed</>
        )}
      </p>

      {/* Actionable: model emitted, engine couldn't auto-fix. Each
          card surfaces the kind + the offending text + a primary
          "fix this slot" action that fires slot-edit with the
          right default instruction. */}
      {structured.length > 0 && (
        <ul className="space-y-2">
          {structured.map((f, i) => (
            <FlagCard
              key={`${f.section_ix}-${f.kind}-${f.field}-${i}`}
              flag={f}
              label={kindLabel(f.kind)}
              defaultInstruction={kindFixInstruction(f.kind, f.field)}
              onEditSlot={onEditSlot}
              onRedraftSection={onRedraftSection}
              busy={busy}
            />
          ))}
        </ul>
      )}

      {/* Auto-fixed notes (snippet substitutions). No action needed —
          just informational. Collapsed by default since the engine
          already handled them and the strategist doesn't need to
          decide anything. */}
      {autoFixedNotes.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-[11px] text-wm-text-muted hover:text-wm-text">
            ✓ Auto-fixed by the engine ({autoFixedNotes.length}) — no action needed
          </summary>
          <ul className="mt-1.5 space-y-1 ml-3">
            {autoFixedNotes.map((note, i) => (
              <li key={i} className="text-[11px] text-wm-text-muted leading-snug">· {note}</li>
            ))}
          </ul>
        </details>
      )}

      {unusedAtoms.length > 0 && (
        <p className="text-[11px] text-wm-text leading-snug">
          <span className="font-semibold">Unused atoms ({unusedAtoms.length}):</span>{' '}
          <span className="font-mono text-wm-text-muted">{unusedAtoms.join(', ')}</span>
          <span className="text-wm-text-subtle"> — the brief assigned these but no section used them.</span>
        </p>
      )}
    </div>
  )
}

function FlagCard({
  flag, label, defaultInstruction, onEditSlot, onRedraftSection, busy,
}: {
  flag: StructuredFlag
  label: string
  defaultInstruction: string
  onEditSlot?: (sectionIx: number, slotKey: string, instruction: string) => void
  onRedraftSection?: (sectionIx: number, instruction: string) => void
  busy: boolean
}) {
  const preview = (flag.value ?? '').toString().trim()
  const truncated = preview.length > 160 ? preview.slice(0, 157) + '…' : preview
  const [editing, setEditing] = useState(false)
  const [instruction, setInstruction] = useState(defaultInstruction)
  return (
    <li className="rounded border border-wm-warning/30 bg-white p-2.5">
      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
        <span className="text-[11px] font-bold text-wm-warning">{label}</span>
        <span className="text-[10px] text-wm-text-subtle">
          Section #{flag.section_ix + 1} · slot <code className="font-mono">{flag.field}</code>
        </span>
      </div>
      {truncated && (
        <p className="text-[11px] text-wm-text-muted italic leading-snug bg-wm-bg p-1.5 rounded mb-2 whitespace-pre-wrap">"{truncated}"</p>
      )}
      {!editing ? (
        <div className="flex gap-2 flex-wrap">
          {onEditSlot && (
            <button
              type="button"
              onClick={() => onEditSlot(flag.section_ix, flag.field, defaultInstruction)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full bg-wm-accent px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              title="Send this slot through slot-edit with the recommended fix instruction."
            >
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
              Fix this slot
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            className="text-[11px] text-wm-accent-strong hover:underline disabled:opacity-50"
          >
            Customize the fix…
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            disabled={busy}
            rows={2}
            className="w-full rounded border border-wm-border bg-white px-2 py-1 text-[11px] focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setEditing(false); setInstruction(defaultInstruction) }}
              disabled={busy}
              className="text-[10px] text-wm-text-muted hover:text-wm-text"
            >
              Cancel
            </button>
            {onRedraftSection && (
              <button
                type="button"
                onClick={() => { onRedraftSection(flag.section_ix, instruction); setEditing(false) }}
                disabled={busy || !instruction.trim()}
                className="inline-flex items-center gap-1 rounded-full border border-wm-accent/40 bg-white hover:bg-wm-accent/5 px-2.5 py-1 text-[10px] font-semibold text-wm-accent-strong disabled:opacity-50"
              >
                Rewrite whole section
              </button>
            )}
            {onEditSlot && (
              <button
                type="button"
                onClick={() => { onEditSlot(flag.section_ix, flag.field, instruction); setEditing(false) }}
                disabled={busy || !instruction.trim()}
                className="inline-flex items-center gap-1 rounded-full bg-wm-accent px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                Edit this slot
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/** Empty starter document the upload drawer offers when the partner
 *  doesn't have an existing export to base their upload on. Matches
 *  the format export-state.ts emits, so the importer accepts it
 *  byte-for-byte. The example pages[] entry illustrates the required
 *  shape (name / slug / phase / page_type / strategic_purpose /
 *  rationale / density) — the partner replaces it with their own. */
function buildEmptyImportTemplate(projectId: string): string {
  const sampleSitemap = {
    pages: [
      {
        name: '(replace with page name, e.g. "Home")',
        slug: '(replace with kebab-case slug, e.g. "home")',
        nav_label: '(optional — defaults to name)',
        phase: '1',
        page_type: 'content',
        strategic_purpose: '(one sentence: what this page does for the visitor)',
        rationale: '(one sentence: why this page exists)',
        density: 'medium',
      },
    ],
    header_nav: [
      { label: '(replace, e.g. "About")', kind: 'page', slug: '(matching slug from pages above)' },
    ],
    footer_nav: [
      { section_label: 'Connect', items: [{ label: 'Contact', slug: 'contact' }] },
    ],
  }
  const sampleBriefs = {
    'home': {
      page_job: '(what this page accomplishes for the primary persona)',
      persona_focus: { primary: '(persona name)', secondary: null, rationale: '' },
      atoms_assigned: [],
      reference_atoms: [],
      voice_exemplars_to_imitate: [],
      voice_anti_exemplars_to_avoid: [],
      section_targets: { section_count: 5, archetypes: ['hero', 'two_up', 'cta_band', 'testimonial_block', 'footer_cta'] },
      aeo_geo_targets: { search_phrases: [], answer_intents: [], geo_anchors: [] },
    },
  }
  const sampleDrafts = {
    'home': {
      sections: [
        {
          archetype: 'hero',
          copy: {
            eyebrow: null,
            heading: '(replace with section heading)',
            tagline: null,
            description: '(replace with description)',
            cta: { label: 'Plan a visit', intent: 'Open the visit page' },
          },
          atoms_used: [],
          voice_notes: 'Which voice_exemplar this section imitates.',
        },
      ],
    },
  }
  return [
    '# Copy Engine Import Template (empty)',
    '',
    `- **Project ID**: \`${projectId}\``,
    `- **Format**: srp-engine-export-v1`,
    '',
    '---',
    '',
    '## Instructions',
    '',
    'This is a blank starter document. Fill in the JSON blocks below with',
    'your actual sitemap / briefs / drafts. Sections you don\'t fill (or',
    'remove entirely) are SKIPPED on import — uploading just the Sitemap',
    'block is valid. Required field schemas are illustrated by the example',
    'entries below; replace the placeholders with your data.',
    '',
    'When you paste this document back into Copy Engine → Upload, the',
    'importer applies only the sections you populated.',
    '',
    '---',
    '',
    '## Sitemap',
    '',
    'Required fields per page: name, slug, phase ("1"/"2"/"nav-only"/"global"),',
    'page_type ("content"/"chrome"/"functional"), strategic_purpose, rationale,',
    'density ("high"/"medium"/"low"). Header_nav entries are kind="page" (need',
    'a slug) or kind="group" (need children[] + intent_type + grouping_rationale).',
    '',
    '```json',
    JSON.stringify(sampleSitemap, null, 2),
    '```',
    '',
    '---',
    '',
    '## Page Briefs',
    '',
    'One brief per page slug. Optional — skip this section if you only have a',
    'sitemap to upload. If included, slugs must match the sitemap above.',
    '',
    '```json',
    JSON.stringify(sampleBriefs, null, 2),
    '```',
    '',
    '---',
    '',
    '## Page Drafts',
    '',
    'One draft per page slug. Optional. Each section needs `archetype` (one of:',
    'hero / tagline_band / two_up / three_up / cards_grid / featured_card /',
    'image_text_split / accordion / cta_band / testimonial_block / stat_block /',
    'steps_row / contact_band / footer_cta / intro_paragraph / rich_body) and a',
    '`copy` object whose keys depend on the archetype.',
    '',
    '```json',
    JSON.stringify(sampleDrafts, null, 2),
    '```',
    '',
    '---',
    '',
    '_End of template. Replace placeholders, delete sections you don\'t need, paste the entire document back into Copy Engine → Upload to apply._',
    '',
  ].join('\n')
}

function ScoreChip({ label, value, bold, tone }: { label: string; value: number; bold?: boolean; tone?: 'default' | 'danger' }) {
  // `tone='danger'` forces the danger color regardless of the score
  // band — used for Dignity, where any score below the 70 floor is
  // a blocker even if the number itself isn't in the typical "red"
  // band yet. Without that override, Dignity=65 would render the
  // same warning yellow as a Voice score in the same range, which
  // hides the severity floor from the strategist.
  const baseColor = value >= 80 ? 'text-wm-success' : value >= 60 ? 'text-wm-warning' : 'text-wm-danger'
  const color = tone === 'danger' ? 'text-wm-danger' : baseColor
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg p-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-wm-text-muted">{label}</p>
      <p className={['mt-0.5', color, bold ? 'text-[15px] font-bold' : 'text-[13px] font-semibold'].join(' ')}>{value}</p>
    </div>
  )
}
