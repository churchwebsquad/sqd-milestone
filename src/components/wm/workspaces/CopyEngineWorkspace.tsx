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
    voice_match: number
    persona_fit: number
    atom_coverage: number
    slot_health: number
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
  const [engine,      setEngine]      = useState<EngineState>({})
  const [critique,    setCritique]    = useState<DirectorCritique | null>(null)
  const [drafts,      setDrafts]      = useState<Record<string, PageDraft>>({})
  const [briefs,      setBriefs]      = useState<Record<string, PageBrief>>({})
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

  const callOrchestrate = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<unknown> => {
    setRunning(action); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ projectId: project.id, action, ...extra }),
      })
      const text = await res.text()
      let json: any = null
      try { json = JSON.parse(text) } catch { /* non-JSON response */ }
      if (!res.ok) {
        const detail = json?.error ?? (text ? text.slice(0, 200) : '')
        throw new Error(`${action} → HTTP ${res.status}${detail ? ` · ${detail}` : ''}`)
      }
      await refreshFromDB()
      await onChange?.()
      return json
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      setRunning(null)
    }
  }, [project.id, refreshFromDB, onChange])

  const sitemap = useMemo<SitemapShape | null>(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    const stage2 = rs?.stage_2 as SitemapShape | undefined
    return stage2 ?? null
  }, [project.roadmap_state])
  const hasStage2 = sitemap !== null
  // Upstream stages — used to decide which setup CTA to render and
  // whether the auto-cascade should kick in.
  const hasStage0 = useMemo(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    return rs?.stage_0 != null
  }, [project.roadmap_state])
  const hasStage1 = useMemo(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    return rs?.stage_1 != null
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
    cascadeStartedFor.current = project.id
    void (async () => {
      if (!hasStage1) {
        const ok = await callOrchestrate('run_synthesize')
        if (!ok) return          // surfaced error in banner; user retries
      }
      await callOrchestrate('draft_sitemap_with_audit')
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, hasStage0, hasStage1, hasStage2])

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

  // Live engine poller — runs only while engine is in flight. Polls
  // engine_state every 3s so the workspace shows current_phase +
  // pages_drafted/total + loop_count without the user refreshing.
  const [engineRunning, setEngineRunning] = useState(false)
  useEffect(() => {
    if (!engineRunning) return
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
  }, [engineRunning, project.id])

  // Chains run_drafts → critique → iterate (if directives). The orchestrator
  // already implements iterate as a self-contained loop server-side; this
  // function just sequences the three top-level actions so the strategist
  // doesn't have to click between them.
  const runEngine = useCallback(async (): Promise<void> => {
    setEngineRunning(true)
    try {
      const draftsResult = await callOrchestrate('run_drafts')
      if (!draftsResult) return
      const critiqueResult = await callOrchestrate('critique') as { engine_state?: EngineState } | null
      if (!critiqueResult) return
      const verdict = critiqueResult.engine_state?.last_verdict
      const directiveCount = critiqueResult.engine_state?.last_directive_count ?? 0
      if (verdict !== 'approved' && directiveCount > 0) {
        await callOrchestrate('iterate')
      }
    } finally {
      setEngineRunning(false)
    }
  }, [callOrchestrate])

  // ── Auto-cascade post-Gate-1 (drafts → critique → iterate) ──────────
  //
  // If the strategist approved the sitemap in a previous session (or
  // approved it just now and the cascade got interrupted), pick up
  // where they left off. Conditions: sitemap approved + no drafts yet
  // + engine isn't stuck (8min threshold) + engine isn't actively
  // running. The downstreamCascadeStartedFor ref guards against re-fire
  // when state changes mid-run.
  const downstreamCascadeStartedFor = useRef<string | null>(null)
  useEffect(() => {
    if (running) return
    if (engineRunning) return
    if (!sitemapApproved) return
    if (draftSlugs.length > 0) return
    if (isEngineStuck(engine, false)) return       // user must hit Reset first
    if (engine.status && ENGINE_IN_PROGRESS_STATUSES.has(engine.status)) return
    if (downstreamCascadeStartedFor.current === project.id) return
    downstreamCascadeStartedFor.current = project.id
    void runEngine()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, sitemapApproved, draftSlugs.length, engine.status, running, engineRunning])

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
            onRerun={() => void runEngine()}
            onCommit={() => setConfirmAction('commit')}
            rerunBusy={!!running}
          />
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
            <div className="grid grid-cols-5 gap-2 text-[11px]">
              <ScoreChip label="Voice" value={critique.scores.voice_consistency ?? 0} />
              <ScoreChip label="Persona" value={critique.scores.persona_coverage ?? 0} />
              <ScoreChip label="Atoms" value={critique.scores.atom_coverage ?? 0} />
              <ScoreChip label="Slots" value={critique.scores.slot_health ?? 0} />
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
                          v {p.voice_match} · p {p.persona_fit} · a {p.atom_coverage} · s {p.slot_health}
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
          actual copy before approving / committing / giving feedback. */}
      {draftSlugs.length > 0 && (
        <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4">
          <h3 className="text-[14px] font-semibold text-wm-text mb-3">Drafted pages ({draftSlugs.length})</h3>
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
                      <DraftPreview draft={d} brief={briefs[slug]} />
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
                          Re-draft this page
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

      {/* Export / Import — round-trip refinement through another tool */}
      {(hasStage2 || draftSlugs.length > 0) && (
        <ExportImportPanel projectId={project.id} onImported={async () => { await onChange?.() }} />
      )}

      {/* Gate 2 — Final review */}
      <GateCard
        number={2}
        title="Final review"
        subtitle="Give feedback. The Director routes it to the right stage."
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

function EngineStatusCard({ engine, engineRunning, sitemapApproved, draftSlugs, onRerun, onCommit, rerunBusy }: {
  engine: EngineState
  engineRunning: boolean
  sitemapApproved: boolean
  draftSlugs: string[]
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

  // Single phrase per state so the strategist always knows what's
  // happening without parsing a status banner + 4 buttons.
  const headline = (() => {
    if (lastError) return `Engine errored: ${lastError}`
    if (!sitemapApproved) return 'Waiting on sitemap approval'
    if (engineRunning) {
      if (phase === 'page_briefs')        return 'Briefing pages…'
      if (phase === 'page_drafts')        return `Drafting pages · ${drafted}/${total || '?'}`
      if (phase === 'director_critique')  return 'Director critiquing the drafts…'
      if (phase === 'applying_directives') return `Iterating — loop ${loopCount} · re-drafting flagged pages…`
      if (phase === 'awaiting_critique')  return 'Drafts ready. Critiquing…'
      return 'Engine running…'
    }
    if (status === 'committing')       return `Committing · ${committed}/${total}`
    if (status === 'committed')        return `Committed ${committed} pages.`
    if (status === 'ready_for_review') return verdict === 'approved'
      ? `Engine approved its own drafts. Review and commit when ready.`
      : `Drafts ready for review. Verdict: ${verdict ?? 'needs_revision'} after ${loopCount} loop${loopCount === 1 ? '' : 's'}.`
    if (draftSlugs.length > 0)         return `Drafts exist (${draftSlugs.length} pages). Re-run to refresh, or review below.`
    return 'Ready to run. Approve the sitemap to start automatically, or re-run manually anytime.'
  })()

  const tone =
    lastError ? 'danger'
    : engineRunning ? 'running'
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
          {!engineRunning && status === 'ready_for_review' && directiveCount > 0 && (
            <p className="text-[11px] text-wm-text-muted mt-0.5">
              Director flagged {directiveCount} item{directiveCount === 1 ? '' : 's'} during critique. See below.
            </p>
          )}
        </div>
        {!engineRunning && sitemapApproved && (
          <button
            onClick={onRerun}
            disabled={rerunBusy}
            className="inline-flex items-center gap-1.5 rounded-full border border-wm-border bg-wm-bg px-3 py-1.5 text-[12px] text-wm-text hover:bg-wm-accent/5 disabled:opacity-50"
          >
            <RefreshCw size={12} /> Re-run
          </button>
        )}
        {!engineRunning && draftSlugs.length > 0 && status !== 'committed' && (
          <button
            onClick={onCommit}
            disabled={rerunBusy}
            className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
          >
            <FileText size={12} /> Commit
          </button>
        )}
      </div>
      {engineRunning && total > 0 && phase === 'page_drafts' && (
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

function DraftPreview({ draft, brief }: { draft: PageDraft; brief?: PageBrief }) {
  const sections = Array.isArray(draft?.sections) ? draft.sections : []
  return (
    <div>
      <PageBriefHeader brief={brief} />
      {sections.length === 0 ? (
        <p className="text-[12px] text-wm-text-muted">No sections in this draft.</p>
      ) : (
        <div className="space-y-3">
          {renderDraftSections(sections)}
        </div>
      )}
    </div>
  )
}

function renderDraftSections(sections: any[]) {
  return sections.map((s: any, i: number) => {
        const copy = s?.copy ?? {}
        return (
          <div key={i} className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">{s?.archetype ?? '—'}</span>
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
          </div>
        )
      })
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
        <h3 className="text-[14px] font-semibold text-wm-text">Download &amp; refine</h3>
        <p className="text-[12px] text-wm-text-muted leading-snug">
          Pull the project out as markdown to edit elsewhere — paste back to
          apply. Sitemap download is light (nav + audit only); copy download
          carries the full strategic foundation (voice card, personas, SEO
          targets, snippets) so an external AI conversation has everything
          it needs to stay on-voice.
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
          className="inline-flex items-center gap-1.5 rounded-full border border-wm-border bg-wm-bg hover:bg-wm-accent/5 px-3 py-1.5 text-[12px] text-wm-text disabled:opacity-50"
        >
          {importOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {importOpen ? 'Hide importer' : 'Upload refinements'}
        </button>
        {exportResult && (
          <span className="text-[11px] text-wm-text-subtle ml-auto">
            Downloaded {exportResult.filename} ({Math.round(exportResult.bytes / 1024)} KB)
          </span>
        )}
      </div>

      {importOpen && (
        <div className="space-y-2">
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder="Paste the entire exported document here (including the metadata header at top)…"
            rows={10}
            className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[12px] font-mono focus:outline-none focus:border-wm-accent"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-wm-text-subtle">
              {importText.length.toLocaleString()} characters · The importer parses ```json blocks under each section header
            </p>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy != null || !importText.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white font-semibold disabled:opacity-50"
            >
              {busy?.kind === 'import' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Apply import
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

function ScoreChip({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const color = value >= 80 ? 'text-wm-success' : value >= 60 ? 'text-wm-warning' : 'text-wm-danger'
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg p-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-wm-text-muted">{label}</p>
      <p className={['mt-0.5', color, bold ? 'text-[15px] font-bold' : 'text-[13px] font-semibold'].join(' ')}>{value}</p>
    </div>
  )
}
