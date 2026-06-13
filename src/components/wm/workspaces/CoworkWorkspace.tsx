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
import { AlertTriangle, ArrowRight, Check, ChevronRight, Clock, ExternalLink, Eye, Loader2, RefreshCw } from 'lucide-react'
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

  const runStep = async (step: StepCatalogEntry) => {
    if (!step.endpoint) return
    setRunningStep(step.key)
    setLastResult(null)
    try {
      const r = await fetch(step.endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ project_id: project.id }),
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

  // Status pill + first ready step (for the "Up next" highlight)
  const overallStats = useMemo(() => {
    if (!state) return null
    let done = 0, ready = 0, stale = 0, cowork = 0, waiting = 0
    let firstReadyKey: string | null = null
    for (const step of COWORK_STEPS) {
      const s = step.computeStatus(state)
      if (s === 'done')             done++
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
    <div className="p-4 max-w-[920px] mx-auto">
      <Header
        readiness={readiness}
        readinessLoading={readinessLoading}
        overallStats={overallStats}
        onRefresh={() => { void loadProjectState(); void loadReadiness() }}
        refreshing={loading || readinessLoading}
      />

      {error && (
        <div className="mb-3 rounded-md border border-wm-danger bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}

      {lastResult && (
        <div className={
          'mb-3 rounded-md px-3 py-2 text-[12px] ' +
          (lastResult.ok
            ? 'border border-wm-success bg-wm-success-bg text-wm-success'
            : 'border border-wm-danger bg-wm-danger-bg text-wm-danger')
        }>
          <span className="font-medium">{lastResult.step}: </span>{lastResult.detail}
        </div>
      )}

      <div className="flex flex-col gap-3">
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

function Header({ readiness, readinessLoading, overallStats, onRefresh, refreshing }: {
  readiness:        ReadinessReport | null
  readinessLoading: boolean
  overallStats:     { done: number; ready: number; stale: number; cowork: number; waiting: number; firstReadyKey: string | null } | null
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

  return (
    <section className="mb-5">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Project pipeline</p>
          <h1 className="text-[18px] font-semibold text-wm-text">Cowork</h1>
          {overallStats && (
            <p className="text-[11.5px] text-wm-text-muted mt-0.5">
              {overallStats.done} done · {overallStats.ready} ready ·{' '}
              {overallStats.cowork} cowork session{overallStats.cowork === 1 ? '' : 's'} ·{' '}
              {overallStats.stale} stale · {overallStats.waiting} waiting
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover disabled:opacity-50"
        >
          <span className="flex items-center gap-1.5">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh
          </span>
        </button>
      </div>

      {/* Readiness panel */}
      <div className="rounded-lg border border-wm-border bg-wm-bg-elevated">
        <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-wm-border">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-wm-text">Inventory readiness</span>
            <WMStatusPill tone={readinessTone} size="sm">{readinessLabel}</WMStatusPill>
          </div>
          {s && (
            <div className="text-[10px] text-wm-text-subtle">
              {s.pillars_total} core message{s.pillars_total === 1 ? '' : 's'} ({s.pillars_draft} draft) ·{' '}
              {s.facts_total} fact{s.facts_total === 1 ? '' : 's'} ·{' '}
              {s.crawl_topics_total} crawl topic{s.crawl_topics_total === 1 ? '' : 's'} ·{' '}
              {s.pii_flags} PII flag{s.pii_flags === 1 ? '' : 's'}
            </div>
          )}
        </div>
        {(blockers.length > 0 || warnings.length > 0) && (
          <div className="px-4 py-2 flex flex-col gap-1.5">
            {blockers.map((b, i) => (
              <div key={`b-${i}`} className="text-[11.5px] text-wm-danger flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span><span className="font-semibold">{b.kind}:</span> {b.detail}</span>
              </div>
            ))}
            {warnings.map((w, i) => (
              <div key={`w-${i}`} className="text-[11.5px] text-wm-warning flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
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

function StepCard({ step, state, running, anyRunning, isFirstReady, projectId, onRun, onViewDetails }: {
  step:          StepCatalogEntry
  state:         CoworkPipelineState | null
  running:       boolean
  anyRunning:    boolean
  isFirstReady:  boolean
  projectId:     string
  onRun:         () => void
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

  // First ready/cowork card gets a subtle "next up" accent on the border
  const accentClass = isFirstReady && (isReady || isCowork) ? 'border-wm-accent border-l-4' : 'border-wm-border'

  return (
    <article className={`rounded-lg ${accentClass} border bg-wm-bg-elevated overflow-hidden`}>
      {/* Header: step number + title + status pill */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-wm-text-subtle">Step {step.step_number}</span>
            <h2 className="text-[14.5px] font-semibold text-wm-text">{step.title}</h2>
          </div>
          <p className="text-[10px] font-mono text-wm-text-subtle mt-0.5">{step.subtitle}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Description */}
      <div className="px-4 pb-2">
        <p className="text-[12px] text-wm-text-muted leading-relaxed">{step.description}</p>
      </div>

      {/* Progress bar (only for steps with progress) */}
      {progress && (
        <div className="px-4 pb-2">
          <ProgressBar done={progress.done} total={progress.total} label={progress.label} />
        </div>
      )}

      {/* Last-run timestamp (only for completed web_ui or cowork-session steps) */}
      {isDone && lastAt && (
        <div className="px-4 pb-2 text-[10.5px] text-wm-text-subtle flex items-center gap-1.5 flex-wrap">
          <Clock size={10} />
          <span>Last run {new Date(lastAt).toLocaleString()}</span>
          {lastMdl && <span className="font-mono">· {lastMdl}</span>}
        </div>
      )}

      {/* Cowork-session automation note */}
      {(isCowork || (step.kind === 'cowork_session' && isDone)) && (
        <div className="px-4 pb-2 text-[11px] text-wm-text-muted italic flex items-start gap-1.5">
          <ExternalLink size={11} className="shrink-0 mt-0.5" />
          <span>
            Saves automatically when Cowork finishes — refresh the page (or wait for auto-refresh) to see the next step unlock.
          </span>
        </div>
      )}

      {/* Action area */}
      <div className="px-4 pb-3 pt-1 flex items-center justify-end gap-2">
        {/* Aggregate-info steps: no action button, just a quiet inventory caption */}
        {isAggInfo && (
          <span className="text-[10.5px] text-wm-text-subtle italic">No action here — extracted automatically during intake.</span>
        )}

        {/* Web-UI steps: View details if done, Run if ready/stale, nothing if waiting */}
        {step.kind === 'web_ui' && isDone && (
          <button
            type="button"
            onClick={onViewDetails}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-wm-border text-wm-text hover:bg-wm-bg-hover"
          >
            <span className="flex items-center gap-1.5">
              <Eye size={12} />
              View details
            </span>
          </button>
        )}
        {step.kind === 'web_ui' && (isReady || isStale) && (
          <button
            type="button"
            onClick={onRun}
            disabled={anyRunning}
            className={
              'text-[12px] font-medium px-3 py-1.5 rounded-md disabled:opacity-50 ' +
              (isStale
                ? 'border border-wm-warning text-wm-warning hover:bg-wm-warning-bg'
                : 'bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover')
            }
          >
            <span className="flex items-center gap-1.5">
              {running ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
              {isStale ? 'Re-run this step' : 'Run this step'}
            </span>
          </button>
        )}
        {step.kind === 'web_ui' && isWaiting && (
          <span className="text-[10.5px] text-wm-text-subtle italic">Waiting on the previous step</span>
        )}

        {/* Cowork-session steps: Copy prompt + Open SKILL when ready/cowork, View details when done */}
        {step.kind === 'cowork_session' && isCowork && (
          <>
            {step.skill_md_path && (
              <a
                href={`https://github.com/churchwebsquad/milestone-comms-app/blob/main/${step.skill_md_path}`}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover"
              >
                <span className="flex items-center gap-1.5">
                  <ExternalLink size={12} />
                  Open SKILL
                </span>
              </a>
            )}
            <CopyPromptButton
              step={step}
              projectId={projectId}
            />
          </>
        )}
        {step.kind === 'cowork_session' && isDone && (
          <button
            type="button"
            onClick={onViewDetails}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-wm-border text-wm-text hover:bg-wm-bg-hover"
          >
            <span className="flex items-center gap-1.5">
              <Eye size={12} />
              View details
            </span>
          </button>
        )}
        {step.kind === 'cowork_session' && isWaiting && (
          <span className="text-[10.5px] text-wm-text-subtle italic">Waiting on the previous step</span>
        )}
      </div>
    </article>
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
      className="text-[12px] font-medium px-3 py-1.5 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
    >
      <span className="flex items-center gap-1.5">
        {copied ? <Check size={12} /> : <ChevronRight size={12} />}
        {copied ? 'Copied — paste in Cowork' : 'Copy prompt for Cowork'}
      </span>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────
// Status pill + progress bar
// ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === 'done')             return <WMStatusPill tone="success" size="sm" icon={<Check size={10} />}>Done</WMStatusPill>
  if (status === 'ready')            return <WMStatusPill tone="info"    size="sm">Ready</WMStatusPill>
  if (status === 'stale')            return <WMStatusPill tone="warning" size="sm">Needs re-run</WMStatusPill>
  if (status === 'blocked_waiting')  return <WMStatusPill tone="neutral" size="sm">Waiting</WMStatusPill>
  if (status === 'cowork_session')   return <WMStatusPill tone="ai"      size="sm">Cowork session</WMStatusPill>
  if (status === 'aggregate_info')   return <WMStatusPill tone="neutral" size="sm">Auto-extracted</WMStatusPill>
  return null
}

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div>
      <div className="h-1.5 w-full bg-wm-bg rounded-full overflow-hidden">
        <div
          className="h-full bg-wm-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10.5px] text-wm-text-subtle mt-1">{label}</p>
    </div>
  )
}
