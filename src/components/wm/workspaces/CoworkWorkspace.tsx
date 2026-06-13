/**
 * Web Manager — Cowork workspace.
 *
 * The strategist's surface for driving the cowork pipeline end-to-end
 * on a real account. Replaces the curl + smoke-harness flow that was
 * the only path before this — the 10 cowork worker endpoints landed
 * iter1, but had no human-facing driver until now.
 *
 * MVP scope (this commit):
 *   - Inventory-readiness summary panel — surfaces the live-church
 *     guard the user named ("dedupe/PII checks exist for exactly this").
 *   - 10-step pipeline status board mapped to the cowork-director
 *     SKILL's resume-conditions table. Each step:
 *       - Status pill: not-started / ready / done / stale / blocked
 *       - Last run timestamp + per-step _meta.model
 *       - Run button (default; calls the endpoint)
 *       - Force re-run button (with confirm; passes force=true)
 *     Status compute mirrors the server-side staleness guard logic.
 *
 * Out of scope (later commits):
 *   - "Run pipeline" orchestrator button (walks the table in dep order)
 *   - Per-page status (steps 8-10 are currently aggregate; per-slug
 *     drill-down comes after pilot evidence shows what strategists
 *     actually want to drive)
 *   - Per-source Run for extract-pillars + parse-facts (those are
 *     informational counts only here; director runs them per-source
 *     in cowork sessions for now)
 *   - Artifact viewers (Open Output buttons are placeholders)
 *   - Step 7 (plan-cross-page-allocation) runs in cowork sessions,
 *     not via a Vercel endpoint — this surface shows its state but
 *     doesn't offer a Run button
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMStatusPill, type WMStatusTone } from '../StatusPill'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project:  StrategyWebProject
  onChange?: () => void
}

// ── Step model ──────────────────────────────────────────────────────

type StepStatus =
  | 'blocked'         // upstream not done — can't even try
  | 'not_started'     // ready to run; output doesn't exist
  | 'ready_stale'     // output exists but upstream is newer — re-run with force
  | 'done'            // output exists + fresh — no action needed
  | 'cowork_session'  // runs in cowork session, not via Vercel endpoint (step 7)
  | 'aggregate'       // per-source / per-slug, no single status

/** What we need from roadmap_state + table counts to compute every step's status. */
interface ProjectState {
  atom_count:            number
  fact_count:            number
  atom_sources:          number          // count of distinct (source_kind, source_ref) on atoms
  fact_sources:          number          // same for facts
  latest_atom_at:        string | null
  latest_fact_at:        string | null
  stage_1:               { _meta?: { generated_at?: string; model?: string } } | null
  ministry_model:        { _meta?: { generated_at?: string; model?: string } } | null
  acf_plan:              { _meta?: { generated_at?: string; model?: string } } | null
  site_strategy:         { _meta?: { generated_at?: string; model?: string } } | null
  page_allocation_plan:  { _meta?: { generated_at?: string; model?: string } } | null
  critique_rollup:       { _meta?: { generated_at?: string; model?: string } } | null
  page_outlines_count:   number
  page_drafts_count:     number
  page_critiques_count:  number
  latest_critique_at:    string | null
  sitemap_slugs:         string[]
}

interface PipelineStep {
  key:               string
  step_number:       number
  label:             string
  skill_name:        string
  /** Function to compute the step's status given current ProjectState. */
  compute_status:    (s: ProjectState) => StepStatus
  /** Last-run timestamp accessor. */
  last_run_at?:      (s: ProjectState) => string | null
  last_model?:       (s: ProjectState) => string | null
  /** Endpoint path. Empty string = no endpoint (e.g. cowork session step). */
  endpoint:          string
  /** Aggregate-only steps don't have a single Run button. */
  aggregate?:        true
  /** Sub-summary line under the title for aggregate steps. */
  aggregate_summary?: (s: ProjectState) => string
}

const STEPS: PipelineStep[] = [
  {
    key:         'extract-pillars',
    step_number: 1,
    label:       'Extract strategic pillars',
    skill_name:  'extract-strategic-pillars',
    endpoint:    '/api/web/agents/run-extract-strategic-pillars',
    aggregate:   true,
    compute_status: () => 'aggregate',
    aggregate_summary: s => `${s.atom_count} atom${s.atom_count === 1 ? '' : 's'} across ${s.atom_sources} source${s.atom_sources === 1 ? '' : 's'}`,
  },
  {
    key:         'parse-facts',
    step_number: 2,
    label:       'Parse facts',
    skill_name:  'parse-facts-csv',
    endpoint:    '/api/web/agents/run-parse-facts-csv',
    aggregate:   true,
    compute_status: () => 'aggregate',
    aggregate_summary: s => `${s.fact_count} fact${s.fact_count === 1 ? '' : 's'} across ${s.fact_sources} source${s.fact_sources === 1 ? '' : 's'}`,
  },
  {
    key:         'synthesize-strategy',
    step_number: 3,
    label:       'Synthesize stage_1',
    skill_name:  'synthesize-strategy',
    endpoint:    '/api/web/agents/run-synthesize-strategy',
    compute_status: s => statusFromTimestamps(s.stage_1?._meta?.generated_at ?? null, s.latest_atom_at, s.atom_count > 0),
    last_run_at:    s => s.stage_1?._meta?.generated_at ?? null,
    last_model:     s => s.stage_1?._meta?.model ?? null,
  },
  {
    key:         'classify-ministry',
    step_number: 4,
    label:       'Classify ministry model',
    skill_name:  'classify-ministry',
    endpoint:    '/api/web/agents/run-classify-ministry',
    compute_status: s => statusFromTimestamps(s.ministry_model?._meta?.generated_at ?? null, s.stage_1?._meta?.generated_at ?? null, !!s.stage_1),
    last_run_at:    s => s.ministry_model?._meta?.generated_at ?? null,
    last_model:     s => s.ministry_model?._meta?.model ?? null,
  },
  {
    key:         'organize-acf',
    step_number: 5,
    label:       'Organize ACF matrix',
    skill_name:  'organize-acf',
    endpoint:    '/api/web/agents/run-organize-acf',
    compute_status: s => statusFromTimestamps(s.acf_plan?._meta?.generated_at ?? null, s.stage_1?._meta?.generated_at ?? null, !!s.stage_1),
    last_run_at:    s => s.acf_plan?._meta?.generated_at ?? null,
    last_model:     s => s.acf_plan?._meta?.model ?? null,
  },
  {
    key:         'plan-site-strategy',
    step_number: 6,
    label:       'Plan site strategy',
    skill_name:  'plan-site-strategy',
    endpoint:    '/api/web/agents/run-plan-site-strategy',
    compute_status: s => statusFromTimestamps(s.site_strategy?._meta?.generated_at ?? null, s.ministry_model?._meta?.generated_at ?? null, !!s.ministry_model),
    last_run_at:    s => s.site_strategy?._meta?.generated_at ?? null,
    last_model:     s => s.site_strategy?._meta?.model ?? null,
  },
  {
    key:         'plan-cross-page-allocation',
    step_number: 7,
    label:       'Plan cross-page allocation',
    skill_name:  'plan-cross-page-allocation',
    endpoint:    '',   // cowork session only
    compute_status: s => s.page_allocation_plan ? 'done' : 'cowork_session',
    last_run_at:    s => s.page_allocation_plan?._meta?.generated_at ?? null,
    last_model:     s => s.page_allocation_plan?._meta?.model ?? null,
  },
  {
    key:         'outline-page',
    step_number: 8,
    label:       'Outline each page',
    skill_name:  'outline-page',
    endpoint:    '/api/web/agents/run-outline-page',
    aggregate:   true,
    compute_status: () => 'aggregate',
    aggregate_summary: s => `${s.page_outlines_count} of ${s.sitemap_slugs.length || '?'} page${s.sitemap_slugs.length === 1 ? '' : 's'} outlined`,
  },
  {
    key:         'draft-page',
    step_number: 9,
    label:       'Draft each page',
    skill_name:  'draft-page',
    endpoint:    '/api/web/agents/run-draft-page',
    aggregate:   true,
    compute_status: () => 'aggregate',
    aggregate_summary: s => `${s.page_drafts_count} of ${s.page_outlines_count} outlined page${s.page_outlines_count === 1 ? '' : 's'} drafted`,
  },
  {
    key:         'critique-page',
    step_number: 10,
    label:       'Critique each page',
    skill_name:  'critique-page',
    endpoint:    '/api/web/agents/run-critique-page',
    aggregate:   true,
    compute_status: () => 'aggregate',
    aggregate_summary: s => `${s.page_critiques_count} of ${s.page_drafts_count} drafted page${s.page_drafts_count === 1 ? '' : 's'} critiqued`,
  },
  {
    key:         'synthesize-critique',
    step_number: 11,
    label:       'Roll up critique',
    skill_name:  'synthesize-critique',
    endpoint:    '/api/web/agents/run-synthesize-critique',
    compute_status: s => statusFromTimestamps(s.critique_rollup?._meta?.generated_at ?? null, s.latest_critique_at, s.page_critiques_count > 0),
    last_run_at:    s => s.critique_rollup?._meta?.generated_at ?? null,
    last_model:     s => s.critique_rollup?._meta?.model ?? null,
  },
]

/** Mirrors the server-side staleness guard's decision logic. Returns
 *  the per-step status from output_generated_at + the latest upstream
 *  timestamp + whether upstream content exists at all. */
function statusFromTimestamps(
  outputAt:     string | undefined | null,
  latestUpstream: string | null,
  upstreamExists: boolean,
): StepStatus {
  if (!upstreamExists) return 'blocked'
  if (!outputAt)        return 'not_started'
  if (!latestUpstream)  return 'done'   // output exists, no upstream timestamp — treat as fresh
  if (outputAt >= latestUpstream) return 'done'
  return 'ready_stale'
}

// ── Inventory readiness types ───────────────────────────────────────

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

// ── Top-level workspace ─────────────────────────────────────────────

export function CoworkWorkspace({ project, onChange }: Props) {
  const [state, setState]                     = useState<ProjectState | null>(null)
  const [readiness, setReadiness]             = useState<ReadinessReport | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(true)
  const [stateLoading, setStateLoading]       = useState(true)
  const [error, setError]                     = useState<string | null>(null)
  const [runningStep, setRunningStep]         = useState<string | null>(null)
  const [forceConfirm, setForceConfirm]       = useState<PipelineStep | null>(null)
  const [lastResult, setLastResult]           = useState<{ step: string; ok: boolean; detail: string } | null>(null)

  const loadProjectState = async () => {
    setStateLoading(true)
    setError(null)
    try {
      const [projRes, atomCountsRes, factCountsRes, latestAtomRes, latestFactRes] = await Promise.all([
        supabase.from('strategy_web_projects').select('roadmap_state').eq('id', project.id).maybeSingle(),
        supabase.from('content_atoms').select('source_kind, source_ref', { count: 'exact' }).eq('web_project_id', project.id).in('status', ['approved', 'draft']),
        supabase.from('church_facts').select('source_kind, source_ref', { count: 'exact' }).eq('web_project_id', project.id).in('status', ['approved', 'draft']),
        supabase.from('content_atoms').select('created_at').eq('web_project_id', project.id).in('status', ['approved', 'draft']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('church_facts').select('created_at').eq('web_project_id', project.id).in('status', ['approved', 'draft']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (projRes.error)         throw new Error(projRes.error.message)
      if (atomCountsRes.error)   throw new Error(atomCountsRes.error.message)
      if (factCountsRes.error)   throw new Error(factCountsRes.error.message)

      const roadmap  = ((projRes.data as any)?.roadmap_state ?? {}) as Record<string, any>
      const atomRows = (atomCountsRes.data ?? []) as Array<{ source_kind: string; source_ref: string }>
      const factRows = (factCountsRes.data ?? []) as Array<{ source_kind: string; source_ref: string }>
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

      // Sitemap slugs — prefer site_strategy if it exists (cowork shape), fall back to legacy stage_2.
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
        fact_count:           factCountsRes.count ?? factRows.length,
        atom_sources:         atomSources,
        fact_sources:         factSources,
        latest_atom_at:       (latestAtomRes.data as any)?.created_at ?? null,
        latest_fact_at:       (latestFactRes.data as any)?.created_at ?? null,
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
      setStateLoading(false)
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
        setReadiness({ ok: false, blockers: [{ kind: 'endpoint_error', severity: 'blocker', detail: body?.detail ?? body?.error ?? 'inventory-readiness failed' }], warnings: [], summary: { pillars_total: 0, pillars_draft: 0, facts_total: 0, crawl_topics_total: 0, duplicates_found: 0, noise_topics_found: 0, pii_flags: 0, coverage_gaps: [] } })
      }
    } catch (e) {
      setReadiness({ ok: false, blockers: [{ kind: 'network', severity: 'blocker', detail: e instanceof Error ? e.message : 'network error' }], warnings: [], summary: { pillars_total: 0, pillars_draft: 0, facts_total: 0, crawl_topics_total: 0, duplicates_found: 0, noise_topics_found: 0, pii_flags: 0, coverage_gaps: [] } })
    } finally {
      setReadinessLoading(false)
    }
  }

  // Initial load + reload on project change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadProjectState(); void loadReadiness() }, [project.id])

  // Run a step — calls the endpoint, refreshes state on success.
  const runStep = async (step: PipelineStep, force: boolean) => {
    if (!step.endpoint) return
    setRunningStep(step.key)
    setLastResult(null)
    try {
      const r = await fetch(step.endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ project_id: project.id, ...(force ? { force: true } : {}) }),
      })
      const body = await r.json().catch(() => ({}))
      const ok = r.ok
      setLastResult({
        step:   step.label,
        ok,
        detail: ok ? `Ran ${step.skill_name} (${body?.skill_meta?.model ?? 'model unknown'})` : (body?.detail ?? body?.error ?? `status ${r.status}`),
      })
      if (ok) {
        await loadProjectState()
        await loadReadiness()
        onChange?.()
      }
    } catch (e) {
      setLastResult({ step: step.label, ok: false, detail: e instanceof Error ? e.message : 'network error' })
    } finally {
      setRunningStep(null)
      setForceConfirm(null)
    }
  }

  const overallStatus = useMemo(() => {
    if (!state) return null
    let done = 0, blocked = 0, stale = 0, ready = 0
    for (const step of STEPS) {
      if (step.aggregate || !step.endpoint) continue
      const s = step.compute_status(state)
      if (s === 'done')        done++
      if (s === 'blocked')     blocked++
      if (s === 'ready_stale') stale++
      if (s === 'not_started') ready++
    }
    return { done, blocked, stale, ready }
  }, [state])

  return (
    <div className="p-4">
      <header className="mb-4 flex items-end justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Cowork pipeline</p>
          <h2 className="text-[15px] font-semibold text-wm-text">Strategist launch surface</h2>
          {overallStatus && (
            <p className="text-[11px] text-wm-text-muted mt-0.5">
              Project-level steps: {overallStatus.done} done · {overallStatus.stale} stale · {overallStatus.ready} not-started · {overallStatus.blocked} blocked
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { void loadProjectState(); void loadReadiness() }}
          disabled={stateLoading || readinessLoading}
          className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover disabled:opacity-50"
        >
          <span className="flex items-center gap-1">
            {(stateLoading || readinessLoading) ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh
          </span>
        </button>
      </header>

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

      <ReadinessPanel readiness={readiness} loading={readinessLoading} />

      <div className="mt-4 flex flex-col gap-2">
        {STEPS.map(step => (
          <StepCard
            key={step.key}
            step={step}
            state={state}
            running={runningStep === step.key}
            anyRunning={!!runningStep}
            onRun={() => void runStep(step, false)}
            onForceRun={() => setForceConfirm(step)}
          />
        ))}
      </div>

      {forceConfirm && (
        <ForceConfirmModal
          step={forceConfirm}
          onCancel={() => setForceConfirm(null)}
          onConfirm={() => void runStep(forceConfirm, true)}
        />
      )}
    </div>
  )
}

// ── Inventory readiness panel ───────────────────────────────────────

function ReadinessPanel({ readiness, loading }: { readiness: ReadinessReport | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-3 grid place-items-center text-wm-text-muted">
        <Loader2 size={14} className="animate-spin" />
      </div>
    )
  }
  if (!readiness) return null

  const blockers = readiness.blockers ?? []
  const warnings = readiness.warnings ?? []
  const s = readiness.summary

  const headerTone: WMStatusTone = blockers.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'success'
  const headerText = blockers.length > 0 ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}` :
                     warnings.length > 0 ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` :
                                            'No issues'

  return (
    <section className="rounded-md border border-wm-border bg-wm-bg-elevated">
      <header className="px-3 py-2 flex items-center justify-between gap-2 border-b border-wm-border">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-wm-text">Inventory readiness</span>
          <WMStatusPill tone={headerTone} size="sm">{headerText}</WMStatusPill>
        </div>
        <div className="text-[10px] text-wm-text-subtle">
          {s.pillars_total} atoms ({s.pillars_draft} draft) · {s.facts_total} facts · {s.crawl_topics_total} crawl topics · {s.pii_flags} PII flags
        </div>
      </header>
      {(blockers.length > 0 || warnings.length > 0) && (
        <div className="px-3 py-2 flex flex-col gap-1.5">
          {blockers.map((b, i) => (
            <div key={`b-${i}`} className="text-[11px] text-wm-danger flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span><span className="font-semibold">{b.kind}:</span> {b.detail}</span>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w-${i}`} className="text-[11px] text-wm-warning flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span><span className="font-semibold">{w.kind}:</span> {w.detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Step card ───────────────────────────────────────────────────────

function StepCard({ step, state, running, anyRunning, onRun, onForceRun }: {
  step:       PipelineStep
  state:      ProjectState | null
  running:    boolean
  anyRunning: boolean
  onRun:      () => void
  onForceRun: () => void
}) {
  const status      = state ? step.compute_status(state) : 'blocked'
  const lastRunAt   = state && step.last_run_at ? step.last_run_at(state) : null
  const lastModel   = state && step.last_model  ? step.last_model(state)  : null
  const aggregateSummary = state && step.aggregate_summary ? step.aggregate_summary(state) : null

  return (
    <section className="rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2.5 flex items-start gap-3">
      <div className="text-[10px] font-mono text-wm-text-subtle pt-0.5 w-6 text-right">{step.step_number}.</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-wm-text">{step.label}</span>
          <StatusBadge status={status} />
          <span className="text-[10px] text-wm-text-subtle font-mono">{step.skill_name}</span>
        </div>
        {aggregateSummary && (
          <p className="text-[11px] text-wm-text-muted mt-0.5">{aggregateSummary}</p>
        )}
        {lastRunAt && !step.aggregate && (
          <p className="text-[10px] text-wm-text-subtle mt-0.5 flex items-center gap-1">
            <Clock size={10} />
            Last run {new Date(lastRunAt).toLocaleString()}
            {lastModel && <span className="font-mono">· {lastModel}</span>}
          </p>
        )}
        {status === 'cowork_session' && (
          <p className="text-[11px] text-wm-text-muted mt-1 italic flex items-start gap-1">
            <ExternalLink size={11} className="shrink-0 mt-0.5" />
            Runs in cowork session (Claude.ai with the skill), not via Vercel gateway. Strategist invokes externally.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {step.endpoint && !step.aggregate && status === 'not_started' && (
          <button
            type="button"
            onClick={onRun}
            disabled={anyRunning}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
          >
            <span className="flex items-center gap-1">
              {running ? <Loader2 size={11} className="animate-spin" /> : <ChevronRight size={11} />}
              Run
            </span>
          </button>
        )}
        {step.endpoint && !step.aggregate && status === 'ready_stale' && (
          <button
            type="button"
            onClick={onForceRun}
            disabled={anyRunning}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-warning text-wm-warning hover:bg-wm-warning-bg disabled:opacity-50"
          >
            <span className="flex items-center gap-1">
              {running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Re-run (force)
            </span>
          </button>
        )}
        {step.endpoint && !step.aggregate && status === 'done' && (
          <button
            type="button"
            onClick={onForceRun}
            disabled={anyRunning}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover disabled:opacity-50"
          >
            Force re-run
          </button>
        )}
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === 'done')           return <WMStatusPill tone="success" size="sm" icon={<CheckCircle2 size={10} />}>Done</WMStatusPill>
  if (status === 'ready_stale')    return <WMStatusPill tone="warning" size="sm">Stale</WMStatusPill>
  if (status === 'not_started')    return <WMStatusPill tone="info"    size="sm">Ready</WMStatusPill>
  if (status === 'blocked')        return <WMStatusPill tone="neutral" size="sm">Blocked (upstream)</WMStatusPill>
  if (status === 'cowork_session') return <WMStatusPill tone="ai"      size="sm">Cowork session</WMStatusPill>
  if (status === 'aggregate')      return <WMStatusPill tone="neutral" size="sm">Per-source</WMStatusPill>
  return null
}

// ── Force-rerun confirmation modal ──────────────────────────────────

function ForceConfirmModal({ step, onCancel, onConfirm }: {
  step:      PipelineStep
  onCancel:  () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center p-4" onClick={onCancel}>
      <div className="bg-wm-bg-elevated rounded-md border border-wm-border max-w-[440px] w-full p-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-[14px] font-semibold text-wm-text mb-2">Force re-run {step.label}?</h3>
        <p className="text-[12px] text-wm-text-muted leading-snug mb-4">
          This will overwrite the existing artifact. The staleness guard normally refuses this when the output is already fresh — force=true bypasses that guard. Use intentionally (e.g. SKILL prompt changed, you want fresh output despite no upstream changes).
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md bg-wm-warning text-wm-text-on-accent hover:opacity-90"
          >
            Force re-run
          </button>
        </div>
      </div>
    </div>
  )
}
