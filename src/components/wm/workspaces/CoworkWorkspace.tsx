/**
 * Web Manager — Cowork workspace (redesigned 2026-06-13).
 *
 * Clean card-per-step layout matching the partner-project dashboard
 * pattern. Each step card is a self-contained guide:
 *
 *   - Strategist-language title (e.g. "Build the strategic foundation")
 *   - Status pill (Done / Ready / Up next / Cowork session / etc.)
 *   - Plain-language description
 *   - Progress bar where steps span multiple items (per-page work)
 *   - SINGLE action button:
 *       · web_ui kind → "Run this step" (or "View details" when done)
 *       · cowork_session kind → "Copy prompt for Cowork" + "Open SKILL"
 *   - Cowork-session steps include an automation note clarifying that
 *     Cowork autosaves; strategist refreshes to see status update
 *
 * Step metadata + status compute live in `src/lib/cowork/stepCatalog.ts`
 * (data layer). This component is presentation only.
 *
 * Output viewer: clicking "View details" opens `CoworkArtifactDrawer`
 * which renders the artifact as markdown (Tier 1 keys) or JSON
 * (Tier 2 fallback).
 *
 * Honest about automation:
 *   - Cowork sessions save to Supabase on their own (truthful — the
 *     SKILLs include MCP write calls). We surface this.
 *   - Next step does NOT auto-trigger. We don't claim it does.
 *     visibilitychange listener auto-refreshes on tab focus so
 *     strategist sees state changes from cowork sessions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, ChevronRight, Clock, Download, ExternalLink, Eye, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMStatusPill, type WMStatusTone } from '../StatusPill'
import { COWORK_STEPS, type CoworkPipelineState, type StepCatalogEntry, type StepStatus } from '../../../lib/cowork/stepCatalog'
import { CoworkArtifactDrawer } from './CoworkArtifactDrawer'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project:   StrategyWebProject
  onChange?: () => void
}

interface ReadinessReport {
  ok:       boolean
  blockers: Array<{ kind: string; severity: string; detail: string; suggested_fix?: string }>
  warnings: Array<{ kind: string; severity: string; detail: string; suggested_fix?: string }>
  summary: {
    pillars_total:      number
    pillars_draft:      number
    facts_total:        number
    crawl_topics_total: number
    duplicates_found:   number
    noise_topics_found: number
    pii_flags:          number
    coverage_gaps:      string[]
  }
}

export function CoworkWorkspace({ project, onChange }: Props) {
  const [state, setState]                     = useState<CoworkPipelineState | null>(null)
  const [readiness, setReadiness]             = useState<ReadinessReport | null>(null)
  const [loading, setLoading]                 = useState(true)
  const [readinessLoading, setReadinessLoading] = useState(true)
  const [error, setError]                     = useState<string | null>(null)
  const [runningStep, setRunningStep]         = useState<string | null>(null)
  const [drawerStep, setDrawerStep]           = useState<StepCatalogEntry | null>(null)
  const [lastResult, setLastResult]           = useState<{ step: string; ok: boolean; detail: string } | null>(null)
  // Surfaced AM-handoff timeline notes from strategic_goals (Phase 3).
  // Shown above the progress card so the strategist sees constraints
  // BEFORE they fire any pipeline step.
  const [timelineNotes, setTimelineNotes]     = useState<string | null>(null)

  // ─── Data loaders ───────────────────────────────────────────────

  const loadProjectState = async () => {
    setLoading(true)
    setError(null)
    try {
      const [projRes, atomCountsRes, factCountsRes, latestAtomRes] = await Promise.all([
        supabase.from('strategy_web_projects').select('roadmap_state').eq('id', project.id).maybeSingle(),
        supabase.from('content_atoms').select('source_kind, source_ref', { count: 'exact' }).eq('web_project_id', project.id).in('status', ['approved', 'draft']),
        supabase.from('church_facts').select('source_kind, source_ref', { count: 'exact' }).eq('web_project_id', project.id).in('status', ['approved', 'draft']),
        supabase.from('content_atoms').select('created_at').eq('web_project_id', project.id).in('status', ['approved', 'draft']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (projRes.error)       throw new Error(projRes.error.message)
      if (atomCountsRes.error) throw new Error(atomCountsRes.error.message)
      if (factCountsRes.error) throw new Error(factCountsRes.error.message)

      const roadmap     = ((projRes.data as any)?.roadmap_state ?? {}) as Record<string, any>
      const atomRows    = (atomCountsRes.data ?? []) as Array<{ source_kind: string; source_ref: string }>
      const factRows    = (factCountsRes.data ?? []) as Array<{ source_kind: string; source_ref: string }>
      const atomSources = new Set(atomRows.map(r => `${r.source_kind}:${r.source_ref}`)).size
      const factSources = new Set(factRows.map(r => `${r.source_kind}:${r.source_ref}`)).size

      const pageOutlines  = (roadmap.page_outlines  ?? {}) as Record<string, any>
      const pageDrafts    = (roadmap.page_drafts    ?? {}) as Record<string, any>
      const pageCritiques = (roadmap.page_critiques ?? {}) as Record<string, any>

      let latestCritiqueAt: string | null = null
      for (const crit of Object.values(pageCritiques)) {
        const ts = (crit as any)?._meta?.generated_at
        if (typeof ts === 'string' && (!latestCritiqueAt || ts > latestCritiqueAt)) latestCritiqueAt = ts
      }

      // Surface timeline_notes from the strategic_goals snapshot. We
      // accept either status — even draft notes deserve visibility
      // (the strategist hasn't approved them, but they need to read
      // the timeline before launching anything). Archived → suppress.
      const sgTimeline = roadmap.strategic_goals?.inspiration_and_notes?.timeline_notes
      if (sgTimeline && sgTimeline.status !== 'archived' && typeof sgTimeline.value === 'string' && sgTimeline.value.trim()) {
        setTimelineNotes(sgTimeline.value)
      } else {
        setTimelineNotes(null)
      }

      // sitemap_slugs — prefer cowork site_strategy, fall back to legacy stage_2
      let sitemapSlugs: string[] = []
      const ss = roadmap.site_strategy
      if (ss && Array.isArray(ss.pages)) {
        sitemapSlugs = ss.pages.map((p: any) => typeof p?.slug === 'string' ? p.slug : null).filter(Boolean)
      } else {
        const stage2 = roadmap.stage_2
        if (stage2 && Array.isArray(stage2.pages)) {
          sitemapSlugs = stage2.pages.map((p: any) => typeof p?.slug === 'string' ? p.slug : null).filter(Boolean)
        }
      }

      setState({
        atom_count:           atomCountsRes.count ?? atomRows.length,
        atom_sources:         atomSources,
        fact_count:           factCountsRes.count ?? factRows.length,
        fact_sources:         factSources,
        latest_atom_at:       (latestAtomRes.data as any)?.created_at ?? null,
        stage_1:              roadmap.stage_1              ?? null,
        ministry_model:       roadmap.ministry_model       ?? null,
        acf_plan:             roadmap.acf_plan             ?? null,
        site_strategy:        roadmap.site_strategy        ?? null,
        page_allocation_plan: roadmap.page_allocation_plan ?? null,
        critique_rollup:      roadmap.critique_rollup      ?? null,
        page_outlines_count:  Object.keys(pageOutlines).length,
        page_drafts_count:    Object.keys(pageDrafts).length,
        page_critiques_count: Object.keys(pageCritiques).length,
        latest_critique_at:   latestCritiqueAt,
        sitemap_slugs:        sitemapSlugs,
        strategic_goals_at:   roadmap.strategic_goals?._meta?.generated_at ?? null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load project state')
    } finally {
      setLoading(false)
    }
  }

  const loadReadiness = async () => {
    setReadinessLoading(true)
    try {
      const r = await fetch('/api/web/agents/inventory-readiness', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ project_id: project.id }),
      })
      const body = await r.json().catch(() => ({}))
      if (r.ok) {
        setReadiness(body as ReadinessReport)
      } else {
        setReadiness({
          ok:       false,
          blockers: [{ kind: 'endpoint_error', severity: 'blocker', detail: body?.detail ?? body?.error ?? 'inventory-readiness failed' }],
          warnings: [],
          summary: { pillars_total: 0, pillars_draft: 0, facts_total: 0, crawl_topics_total: 0, duplicates_found: 0, noise_topics_found: 0, pii_flags: 0, coverage_gaps: [] },
        })
      }
    } catch (e) {
      setReadiness({
        ok:       false,
        blockers: [{ kind: 'network', severity: 'blocker', detail: e instanceof Error ? e.message : 'network error' }],
        warnings: [],
        summary: { pillars_total: 0, pillars_draft: 0, facts_total: 0, crawl_topics_total: 0, duplicates_found: 0, noise_topics_found: 0, pii_flags: 0, coverage_gaps: [] },
      })
    } finally {
      setReadinessLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadProjectState(); void loadReadiness() }, [project.id])

  // Auto-refresh when strategist returns from a cowork session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void loadProjectState()
        void loadReadiness()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [project.id])

  // ─── Run a step ─────────────────────────────────────────────────

  const runStep = async (step: StepCatalogEntry, force = false) => {
    if (!step.endpoint) return
    // For done steps the strategist can still force a re-run (e.g.
    // they want to swap models, or suspect the output missed
    // something). Server-side staleness guard returns 409 without
    // force=true, so the button just opts past it.
    if (force) {
      const ok = confirm(`Re-run ${step.title}? The current output will be overwritten.`)
      if (!ok) return
    }
    setRunningStep(step.key)
    setLastResult(null)
    try {
      const r = await fetch(step.endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ project_id: project.id, force }),
      })
      const body = await r.json().catch(() => ({}))
      const ok = r.ok
      setLastResult({
        step:   step.title,
        ok,
        detail: ok ? `Ran ${step.subtitle}` : (body?.detail ?? body?.error ?? `status ${r.status}`),
      })
      if (ok) {
        await loadProjectState()
        await loadReadiness()
        onChange?.()
      }
    } catch (e) {
      setLastResult({ step: step.title, ok: false, detail: e instanceof Error ? e.message : 'network error' })
    } finally {
      setRunningStep(null)
    }
  }

  // Status pill + first ready step (for the "Up next" highlight).
  // aggregate_info steps count toward `done` — visually they read as
  // complete (auto-extracted + check pill + 100% progress bar) so the
  // counter has to match or it under-reports progress to the strategist.
  const overallStats = useMemo(() => {
    if (!state) return null
    let done = 0, ready = 0, stale = 0, cowork = 0, waiting = 0
    let firstReadyKey: string | null = null
    for (const step of COWORK_STEPS) {
      const s = step.computeStatus(state)
      if (s === 'done' || s === 'aggregate_info') done++
      if (s === 'stale')            stale++
      if (s === 'blocked_waiting')  waiting++
      if (s === 'ready') {
        ready++
        if (!firstReadyKey) firstReadyKey = step.key
      }
      if (s === 'cowork_session') {
        cowork++
        if (!firstReadyKey) firstReadyKey = step.key
      }
    }
    return { done, ready, stale, cowork, waiting, firstReadyKey }
  }, [state])

  return (
    <div className="p-6 max-w-[960px] mx-auto">
      <Header
        readiness={readiness}
        readinessLoading={readinessLoading}
        overallStats={overallStats}
        timelineNotes={timelineNotes}
        onRefresh={() => { void loadProjectState(); void loadReadiness() }}
        refreshing={loading || readinessLoading}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-wm-danger bg-wm-danger-bg px-4 py-3 text-[13px] text-wm-danger">
          {error}
        </div>
      )}

      {lastResult && (
        <div className={
          'mb-4 rounded-lg px-4 py-3 text-[13px] ' +
          (lastResult.ok
            ? 'border border-wm-success bg-wm-success-bg text-wm-success'
            : 'border border-wm-danger bg-wm-danger-bg text-wm-danger')
        }>
          <span className="font-medium">{lastResult.step}: </span>{lastResult.detail}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {COWORK_STEPS.map(step => (
          <StepCard
            key={step.key}
            step={step}
            state={state}
            running={runningStep === step.key}
            anyRunning={!!runningStep}
            isFirstReady={overallStats?.firstReadyKey === step.key}
            projectId={project.id}
            onRun={() => void runStep(step)}
            onForceRerun={() => void runStep(step, true)}
            onViewDetails={() => setDrawerStep(step)}
          />
        ))}
      </div>

      {drawerStep && drawerStep.output_key && (
        <CoworkArtifactDrawer
          outputKey={drawerStep.output_key}
          title={drawerStep.title}
          projectId={project.id}
          onClose={() => setDrawerStep(null)}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Header (readiness summary + refresh)
// ────────────────────────────────────────────────────────────────────

function Header({ readiness, readinessLoading, overallStats, timelineNotes, onRefresh, refreshing }: {
  readiness:        ReadinessReport | null
  readinessLoading: boolean
  overallStats:     { done: number; ready: number; stale: number; cowork: number; waiting: number; firstReadyKey: string | null } | null
  timelineNotes:    string | null
  onRefresh:        () => void
  refreshing:       boolean
}) {
  const blockers = readiness?.blockers ?? []
  const warnings = readiness?.warnings ?? []
  const s        = readiness?.summary

  const readinessTone: WMStatusTone =
    blockers.length > 0 ? 'danger' :
    warnings.length > 0 ? 'warning' :
    readiness         ? 'success' : 'neutral'
  const readinessLabel =
    readinessLoading        ? 'Checking…' :
    blockers.length > 0     ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}` :
    warnings.length > 0     ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` :
                              'Ready to ship'

  // Project-level steps total = 11 (steps 1-11). "Done" includes
  // aggregate-info steps that have inventory.
  const totalSteps    = 11
  const completedPct  = overallStats ? Math.round((overallStats.done / totalSteps) * 100) : 0

  return (
    <section className="mb-6">
      {/* Title + refresh */}
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Project pipeline</p>
          <h1 className="text-[22px] font-semibold text-wm-text leading-tight">Cowork</h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </span>
        </button>
      </div>

      {/* Timeline notes (AM handoff) — visibility BEFORE pipeline launch */}
      {timelineNotes && (
        <div className="mb-4 rounded-xl border border-wm-warning bg-wm-warning-bg px-4 py-3 flex items-start gap-2.5">
          <Clock size={14} className="shrink-0 mt-0.5 text-wm-warning" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-1">Timeline notes (AM handoff)</p>
            <p className="text-[12.5px] text-wm-text leading-snug whitespace-pre-wrap break-words">{timelineNotes}</p>
          </div>
        </div>
      )}

      {/* Hero progress card */}
      {overallStats && (
        <div className="rounded-xl bg-wm-bg-elevated border border-wm-border shadow-sm px-6 py-5 mb-4">
          <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Progress</p>
              <div className="flex items-baseline gap-2">
                <span className="text-[28px] font-semibold text-wm-text leading-none">{overallStats.done}</span>
                <span className="text-[14px] text-wm-text-muted">of {totalSteps} steps complete</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-wm-text-muted">
              {overallStats.ready > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-wm-info-bg text-wm-info font-medium">{overallStats.ready} ready</span>
              )}
              {overallStats.cowork > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-wm-accent-tint text-wm-accent-strong font-medium">{overallStats.cowork} cowork</span>
              )}
              {overallStats.stale > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-wm-warning-bg text-wm-warning font-medium">{overallStats.stale} stale</span>
              )}
              {overallStats.waiting > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-wm-bg text-wm-text-subtle">{overallStats.waiting} waiting</span>
              )}
            </div>
          </div>
          <div className="h-2 w-full bg-wm-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-wm-accent transition-all duration-500"
              style={{ width: `${completedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Readiness panel */}
      <div className="rounded-xl border border-wm-border bg-wm-bg-elevated shadow-sm">
        <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-wm-text">Inventory readiness</span>
            <WMStatusPill tone={readinessTone} size="sm">{readinessLabel}</WMStatusPill>
          </div>
          {s && (
            <div className="text-[11px] text-wm-text-subtle">
              {s.pillars_total} core message{s.pillars_total === 1 ? '' : 's'} ({s.pillars_draft} draft) ·{' '}
              {s.facts_total} fact{s.facts_total === 1 ? '' : 's'} ·{' '}
              {s.crawl_topics_total} crawl topic{s.crawl_topics_total === 1 ? '' : 's'} ·{' '}
              {s.pii_flags} PII flag{s.pii_flags === 1 ? '' : 's'}
            </div>
          )}
        </div>
        {(blockers.length > 0 || warnings.length > 0) && (
          <div className="px-5 pb-4 pt-1 flex flex-col gap-2 border-t border-wm-border">
            {blockers.map((b, i) => (
              <div key={`b-${i}`} className="text-[12px] text-wm-danger flex items-start gap-1.5 mt-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span><span className="font-semibold">{b.kind}:</span> {b.detail}</span>
              </div>
            ))}
            {warnings.map((w, i) => (
              <div key={`w-${i}`} className="text-[12px] text-wm-warning flex items-start gap-1.5 mt-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span><span className="font-semibold">{w.kind}:</span> {w.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────
// StepCard
// ────────────────────────────────────────────────────────────────────

function StepCard({ step, state, running, anyRunning, isFirstReady, projectId, onRun, onForceRerun, onViewDetails }: {
  step:          StepCatalogEntry
  state:         CoworkPipelineState | null
  running:       boolean
  anyRunning:    boolean
  isFirstReady:  boolean
  projectId:     string
  onRun:         () => void
  onForceRerun:  () => void
  onViewDetails: () => void
}) {
  const status   = state ? step.computeStatus(state) : 'blocked_waiting'
  const lastAt   = state && step.lastRunAt ? step.lastRunAt(state) : null
  const lastMdl  = state && step.lastModel ? step.lastModel(state) : null
  const progress = state && step.progress  ? step.progress(state)  : null

  const isDone        = status === 'done'
  const isReady       = status === 'ready'
  const isStale       = status === 'stale'
  const isCowork      = status === 'cowork_session'
  const isWaiting     = status === 'blocked_waiting'
  const isAggInfo     = status === 'aggregate_info'

  // Visual weight per state. Active steps (ready / cowork-session /
  // stale) get full-strength card with shadow. Done + aggregate-info
  // both read as "complete" — elevated background, full-strength
  // title, check-icon pill. Only blocked_waiting recedes to the dim
  // canvas treatment so the strategist can tell waiting and
  // auto-extracted apart at a glance.
  const isActive       = isReady || isCowork || isStale
  const isCompleteLike = isDone || isAggInfo
  const cardClass = isActive
    ? 'bg-wm-bg-elevated border border-wm-border shadow-sm hover:shadow-md transition-shadow'
    : (isCompleteLike
        ? 'bg-wm-bg-elevated border border-wm-border'
        : 'bg-wm-bg border border-wm-border')

  return (
    <article className={`rounded-xl ${cardClass} overflow-hidden`}>
      {/* "Next up" tag rendered ABOVE the title only for the first
          ready/cowork card. Replaces the awkward left-accent border. */}
      {isFirstReady && isActive && (
        <div className="px-6 pt-5 pb-1">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
            <ArrowRight size={11} /> Next up
          </span>
        </div>
      )}

      {/* Header row: step number + title + status pill */}
      <div className={`px-6 ${isFirstReady && isActive ? 'pt-2' : 'pt-5'} pb-3 flex items-start justify-between gap-4`}>
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-wm-text-subtle mb-1.5">
            Step {step.step_number}
          </p>
          <h2 className={
            'leading-tight ' +
            (isActive
              ? 'text-[18px] font-semibold text-wm-text'
              : 'text-[17px] font-semibold ' + (isCompleteLike ? 'text-wm-text' : 'text-wm-text-muted'))
          }>
            {step.title}
          </h2>
          <p className="text-[11px] font-mono text-wm-text-subtle mt-1">{step.subtitle}</p>
        </div>
        <div className="shrink-0">
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Description */}
      <div className="px-6 pb-4">
        <p className={
          'text-[13px] leading-relaxed ' +
          (isActive || isCompleteLike ? 'text-wm-text-muted' : 'text-wm-text-subtle')
        }>
          {step.description}
        </p>
      </div>

      {/* Progress bar (per-source / per-page steps) */}
      {progress && (
        <div className="px-6 pb-4">
          <ProgressBar
            done={progress.done}
            total={progress.total}
            label={progress.label}
            tone={isDone ? 'success' : (isActive ? 'accent' : 'neutral')}
          />
        </div>
      )}

      {/* Last-run timestamp (web_ui + cowork-session done steps) */}
      {isDone && lastAt && (
        <div className="px-6 pb-4 text-[11px] text-wm-text-subtle flex items-center gap-1.5 flex-wrap">
          <Clock size={11} />
          <span>Last run {new Date(lastAt).toLocaleString()}</span>
          {lastMdl && <span className="font-mono">· {lastMdl}</span>}
        </div>
      )}

      {/* Cowork-session automation note */}
      {(isCowork || (step.kind === 'cowork_session' && isDone)) && (
        <div className="px-6 pb-4 text-[12px] text-wm-text-muted italic flex items-start gap-2">
          <ExternalLink size={12} className="shrink-0 mt-0.5" />
          <span>
            Saves automatically when Cowork finishes — refresh the page (or wait for auto-refresh) to see the next step unlock.
          </span>
        </div>
      )}

      {/* Action footer — suppressed for aggregate_info (the check pill + progress
          bar above already convey the done state; no button to render). */}
      {!isAggInfo && (
      <div className={
        'px-6 py-4 border-t border-wm-border flex items-center justify-end gap-2 ' +
        (isActive ? 'bg-wm-bg-elevated' : 'bg-transparent')
      }>
        {/* Waiting — quiet text only */}
        {isWaiting && (
          <span className="text-[12px] text-wm-text-subtle italic">Waiting on the previous step</span>
        )}

        {/* Web-UI completed — secondary View details + tertiary
            force-rerun. Re-run is intentionally less prominent than
            View details since the step is already in its success
            state; the affordance is here for cases where the
            strategist wants to swap models, retry on a hunch, or
            test a contract change without bumping any upstream
            timestamp. Server staleness guard is bypassed via force. */}
        {step.kind === 'web_ui' && isDone && (
          <>
            <button
              type="button"
              onClick={onForceRerun}
              disabled={anyRunning}
              className="text-[12px] font-medium px-3 py-2 rounded-lg text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50 transition-colors"
              title="Re-run this step. The current output will be overwritten."
            >
              <span className="flex items-center gap-1.5">
                {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Re-run
              </span>
            </button>
            <button
              type="button"
              onClick={onViewDetails}
              className="text-[13px] font-medium px-4 py-2 rounded-lg border border-wm-border text-wm-text hover:bg-wm-bg-hover transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Eye size={13} />
                View details
              </span>
            </button>
          </>
        )}

        {/* Web-UI ready / stale — primary Run */}
        {step.kind === 'web_ui' && (isReady || isStale) && (
          <button
            type="button"
            onClick={onRun}
            disabled={anyRunning}
            className={
              'text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ' +
              (isStale
                ? 'border border-wm-warning text-wm-warning hover:bg-wm-warning-bg'
                : 'bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover shadow-sm')
            }
          >
            <span className="flex items-center gap-1.5">
              {running ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
              {isStale ? 'Re-run this step' : 'Run this step'}
            </span>
          </button>
        )}

        {/* Cowork-session ready — Download SKILL + Copy prompt */}
        {step.kind === 'cowork_session' && isCowork && (
          <>
            {step.skill_md_path && <DownloadSkillButton skillPath={step.skill_md_path} />}
            <CopyPromptButton step={step} projectId={projectId} />
          </>
        )}

        {/* Cowork-session done — View details */}
        {step.kind === 'cowork_session' && isDone && (
          <button
            type="button"
            onClick={onViewDetails}
            className="text-[13px] font-medium px-4 py-2 rounded-lg border border-wm-border text-wm-text hover:bg-wm-bg-hover transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Eye size={13} />
              View details
            </span>
          </button>
        )}
      </div>
      )}
    </article>
  )
}

// ────────────────────────────────────────────────────────────────────
// DownloadSkillButton — fetches the SKILL.md via the local Vercel
// endpoint and triggers a file download (no GitHub redirect; the
// strategist gets a local SKILL.md to drop into Claude Desktop).
// ────────────────────────────────────────────────────────────────────

function DownloadSkillButton({ skillPath }: { skillPath: string }) {
  const [downloading, setDownloading] = useState(false)
  const handle = async () => {
    setDownloading(true)
    try {
      const r = await fetch(`/api/web/cowork/skill-download?path=${encodeURIComponent(skillPath)}`)
      if (!r.ok) throw new Error(`download failed (${r.status})`)
      const blob = await r.blob()
      const skillName = skillPath.split('/')[1] ?? 'skill'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${skillName}.SKILL.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      // Quiet failure — strategist sees the button reset and can retry.
    } finally {
      setDownloading(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={downloading}
      className="text-[13px] font-medium px-4 py-2 rounded-lg border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50 transition-colors"
    >
      <span className="flex items-center gap-1.5">
        {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {downloading ? 'Downloading…' : 'Download SKILL'}
      </span>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────
// CopyPromptButton — extracts the catalog's starter_prompt, substitutes
// {{project_id}}, copies to clipboard, shows "Copied" for 2s.
// ────────────────────────────────────────────────────────────────────

function CopyPromptButton({ step, projectId }: {
  step:      StepCatalogEntry
  projectId: string
}) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    if (!step.starter_prompt) return
    const text = step.starter_prompt.replaceAll('{{project_id}}', projectId)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={!step.starter_prompt}
      className="text-[13px] font-medium px-4 py-2 rounded-lg bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50 shadow-sm transition-colors"
    >
      <span className="flex items-center gap-1.5">
        {copied ? <Check size={13} /> : <ChevronRight size={13} />}
        {copied ? 'Copied — paste in Cowork' : 'Copy prompt for Cowork'}
      </span>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────
// Status pill + progress bar
// ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === 'done')             return <WMStatusPill tone="success" size="md" icon={<Check size={12} />}>Done</WMStatusPill>
  if (status === 'ready')            return <WMStatusPill tone="info"    size="md">Ready</WMStatusPill>
  if (status === 'stale')            return <WMStatusPill tone="warning" size="md">Needs re-run</WMStatusPill>
  if (status === 'blocked_waiting')  return <WMStatusPill tone="neutral" size="md">Waiting</WMStatusPill>
  if (status === 'cowork_session')   return <WMStatusPill tone="ai"      size="md">Cowork session</WMStatusPill>
  if (status === 'aggregate_info')   return <WMStatusPill tone="success" size="md" icon={<Check size={12} />}>Auto-extracted</WMStatusPill>
  return null
}

function ProgressBar({ done, total, label, tone = 'accent' }: {
  done:  number
  total: number
  label: string
  tone?: 'accent' | 'success' | 'neutral'
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const fillClass =
    tone === 'success' ? 'bg-wm-success' :
    tone === 'neutral' ? 'bg-wm-text-subtle' :
                         'bg-wm-accent'
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11.5px] text-wm-text-muted">{label}</span>
        <span className="text-[11px] font-medium text-wm-text-subtle">{pct}%</span>
      </div>
      <div className="h-2 w-full bg-wm-bg rounded-full overflow-hidden">
        <div
          className={`h-full ${fillClass} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
