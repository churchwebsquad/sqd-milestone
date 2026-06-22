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
import { AlertTriangle, ArrowRight, Check, ChevronRight, Clock, Download, ExternalLink, Eye, FileText, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMStatusPill, type WMStatusTone } from '../StatusPill'
import { getCoworkSteps, type CoworkPipelineState, type StepCatalogEntry, type StepStatus } from '../../../lib/cowork/stepCatalog'
import { expandCoworkTokens } from '../../../lib/cowork/coworkPromptContext'
import { CoworkArtifactDrawer } from './CoworkArtifactDrawer'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project:   StrategyWebProject
  onChange?: () => void
}

interface ReadinessIssue {
  kind:           string
  severity:       string
  detail:         string
  suggested_fix?: string
  /** Row references — pii_flag_fact carries fact ids + previews;
   *  cc_page2_unanswered carries field keys + display labels. The
   *  resolver UI uses these to render per-row actions. */
  rows?: Array<{ id: string; topic?: string; preview?: string }>
}

interface ReadinessReport {
  ok:       boolean
  blockers: ReadinessIssue[]
  warnings: ReadinessIssue[]
  summary: {
    pillars_total:      number
    pillars_draft:      number
    facts_total:        number
    crawl_topics_total: number
    cc_files_uploaded?: number
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

      // Audit branch — sitemap_slugs stays empty pre-audit. The
      // audit-external-copy skill walks Notion via Claude Desktop's
      // Notion MCP and writes one page_critique per Notion page;
      // page_critiques_count IS the audited total. The workspace
      // intentionally doesn't pre-fetch the Notion DB itself — that
      // server-side path proved fragile (Notion 3-req/s rate limit
      // + edge function execution-time budget) and gave the audit
      // SKILL a load_error to dead-end on.

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
        cowork_handoff_audit: roadmap.cowork_handoff_audit ?? null,
        page_outlines_count:  Object.keys(pageOutlines).length,
        page_drafts_count:    Object.keys(pageDrafts).length,
        page_critiques_count: Object.keys(pageCritiques).length,
        latest_critique_at:   latestCritiqueAt,
        sitemap_slugs:        sitemapSlugs,
        strategic_goals_at:   roadmap.strategic_goals?._meta?.generated_at ?? null,
        notion_database_id:   project.notion_database_id ?? null,
        notion_database_url:  project.notion_database_url ?? null,
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
          summary: { pillars_total: 0, pillars_draft: 0, facts_total: 0, crawl_topics_total: 0, cc_files_uploaded: 0, duplicates_found: 0, noise_topics_found: 0, pii_flags: 0, coverage_gaps: [] },
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

  // Auto-fire normalize-intake when the strategist lands on Cowork
  // for a project with 0 atoms. This is the safety net for cases
  // where the IntakeWorkspace's own auto-fire didn't run (strategist
  // skipped that tab) or the browser canceled the slow request
  // before Vercel could finish (the earlier failure mode for 3249).
  // Same fire-and-forget keepalive shape as IntakeWorkspace.
  useEffect(() => {
    if (!state) return
    if (state.atom_count > 0) return                    // already has atoms — nothing to do
    if (state.fact_count > 0) return                    // facts only is rare but still skips
    const dedupKey = `cowork-autofire-norm.${project.id}`
    if (sessionStorage.getItem(dedupKey)) return
    let cancelled = false
    void (async () => {
      sessionStorage.setItem(dedupKey, '1')
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt || cancelled) return
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }
      void fetch('/api/web/agents/orchestrate', {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'run_normalize', projectId: project.id }),
        keepalive: true,
      }).catch(() => { /* server keeps running */ })
      // strategic-goals snapshot is quick + read-only; safe to also fire.
      void fetch('/api/web/cowork/aggregate-strategic-goals', {
        method: 'POST', headers,
        body: JSON.stringify({ project_id: project.id }),
        keepalive: true,
      }).catch(() => { /* same — quick endpoint, fire and forget */ })
      setLastResult({
        step: 'auto-fire',
        ok: true,
        detail: 'No atoms found — triggered normalize-intake + strategic-goals in the background. Refresh in 1-2 minutes.',
      })
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.atom_count, state?.fact_count, project.id])

  // Auto-fire handoff-to-pages when step 7 (synthesize-critique) lands
  // its rollup. This is the cowork→pages bridge — moves outline +
  // draft + critique into web_pages/web_sections with full provenance.
  // Dedup by critique_rollup.generated_at so a single rollup write only
  // fires the handoff once; re-running step 7 generates a new timestamp
  // and re-fires the handoff (the endpoint is idempotent — preserves
  // strategist edits on page_name and refuses partner-locked overwrites
  // without force).
  useEffect(() => {
    const rollupAt = state?.critique_rollup?._meta?.generated_at
    if (!rollupAt) return
    if (!state || state.page_critiques_count === 0) return
    const dedupKey = `cowork-handoff.${project.id}.${rollupAt}`
    if (sessionStorage.getItem(dedupKey)) return
    let cancelled = false
    void (async () => {
      sessionStorage.setItem(dedupKey, '1')
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt || cancelled) return
      try {
        const r = await fetch('/api/web/cowork/handoff-to-pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
          body: JSON.stringify({ project_id: project.id }),
          keepalive: true,
        })
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (r.ok) {
          const pageCount = (body as { pages?: number }).pages ?? 0
          const audit = (body as { audit?: { total_atoms_preserved?: number; total_facts_preserved?: number; any_round_trip_loss?: boolean } }).audit
          setLastResult({
            step: 'cowork → pages handoff',
            ok: true,
            detail: `Pushed ${pageCount} page${pageCount === 1 ? '' : 's'} to Pages with full provenance · ${audit?.total_atoms_preserved ?? 0} atoms / ${audit?.total_facts_preserved ?? 0} facts preserved · ${audit?.any_round_trip_loss ? 'WITH ROUND-TRIP LOSS — check the audit/scan tab' : 'no information loss'}. Open the Pages workspace to review.`,
          })
        } else {
          const detail = (body as { detail?: string; error?: string }).detail ?? (body as { error?: string }).error ?? `status ${r.status}`
          setLastResult({
            step: 'cowork → pages handoff',
            ok: false,
            detail: `Handoff failed: ${detail}. The cowork artifacts are still in roadmap_state — fix the issue and re-run synthesize-critique to retry.`,
          })
        }
      } catch (e) {
        if (cancelled) return
        setLastResult({
          step: 'cowork → pages handoff',
          ok: false,
          detail: `Handoff network error: ${e instanceof Error ? e.message : 'unknown'}`,
        })
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.critique_rollup?._meta?.generated_at, state?.page_critiques_count, project.id])

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
      // Read response as text first so we can fall back to it when
      // the body isn't valid JSON. Vercel kills functions that hit
      // maxDuration and returns 500 with an EMPTY body — without
      // this fallback the strategist sees a bare "status 500" and
      // can't tell whether it was a timeout, an upstream model
      // refusal, or a 4xx from auth.
      const rawText = await r.text().catch(() => '')
      let body: Record<string, unknown> = {}
      try { body = rawText ? JSON.parse(rawText) : {} } catch { /* keep empty */ }
      const ok = r.ok
      const detail = ok
        ? `Ran ${step.subtitle}`
        : ((body.detail as string | undefined)
           ?? (body.error as string | undefined)
           ?? (rawText && rawText.length < 240 ? rawText : null)
           ?? (r.status >= 500
              ? `status ${r.status} — function likely timed out or crashed. Vercel returned no body. Check Vercel function logs for /api/web/agents/run-…; raise maxDuration if the model call is exceeding the ceiling on this project's input size.`
              : `status ${r.status}`))
      setLastResult({
        step:   step.title,
        ok,
        detail,
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

  /** Approve a stale step as-is: bump its output's _meta.generated_at
   *  to now + stamp approved_as_is_at for audit. Content is preserved
   *  byte-for-byte; only the timestamp moves. Useful when the
   *  strategist has reviewed the existing artifact, decided the
   *  upstream change doesn't invalidate it, and doesn't want to pay
   *  for a re-run.
   *
   *  Works for any step whose output_key is a top-level roadmap_state
   *  jsonb key (i.e. NOT the per-page cowork-session steps 8-10).
   *  Uses two roadmap_state_set calls instead of a server-side
   *  jsonb_set so we stay on the existing RPC contract — slightly more
   *  network but no new RPC required. */
  const approveAsIs = async (step: StepCatalogEntry) => {
    if (!step.output_key) return
    if (step.output_key.includes('.')) {
      setLastResult({ step: step.title, ok: false, detail: 'Approve-as-is is not supported for per-page artifacts. Re-run instead.' })
      return
    }
    const ok = confirm(`Approve "${step.title}" as-is? The existing output stays intact; only the timestamp moves so downstream steps stop seeing it as stale.`)
    if (!ok) return
    setRunningStep(step.key)
    setLastResult(null)
    try {
      // Read the current artifact, splice fresh _meta fields, write back.
      const nowIso = new Date().toISOString()
      const { data: row, error: readErr } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', project.id)
        .maybeSingle()
      if (readErr) throw new Error(readErr.message)
      const current = ((row as any)?.roadmap_state ?? {})[step.output_key]
      if (!current || typeof current !== 'object') {
        throw new Error(`${step.output_key} not present on roadmap_state — nothing to approve.`)
      }
      const revised = {
        ...current,
        _meta: {
          ...(current._meta ?? {}),
          generated_at:      nowIso,
          approved_as_is_at: nowIso,
        },
      }
      const { error: rpcErr } = await (supabase as any).rpc('roadmap_state_set', {
        p_project_id: project.id,
        p_path:       [step.output_key],
        p_value:      revised,
      })
      if (rpcErr) throw new Error(rpcErr.message)
      setLastResult({ step: step.title, ok: true, detail: `Approved as-is. Content preserved; timestamp bumped to now.` })
      await loadProjectState()
      await loadReadiness()
      onChange?.()
    } catch (e) {
      setLastResult({ step: step.title, ok: false, detail: e instanceof Error ? e.message : 'approve-as-is failed' })
    } finally {
      setRunningStep(null)
    }
  }

  // Step catalog is branch-aware: when the project has
  // notion_database_id set, steps 8-10 collapse into a single
  // audit-external-copy pass + a supplemental-page-authoring step
  // for sitemap pages without a Notion match.
  const steps = useMemo(
    () => getCoworkSteps({ auditBranch: !!project.notion_database_id }),
    [project.notion_database_id],
  )

  // Status pill + first ready step (for the "Up next" highlight).
  // aggregate_info steps count toward `done` — visually they read as
  // complete (auto-extracted + check pill + 100% progress bar) so the
  // counter has to match or it under-reports progress to the strategist.
  const overallStats = useMemo(() => {
    if (!state) return null
    let done = 0, ready = 0, stale = 0, cowork = 0, waiting = 0
    let firstReadyKey: string | null = null
    for (const step of steps) {
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
        auditBranch={!!project.notion_database_id}
        notionDatabaseUrl={project.notion_database_url ?? null}
        totalSteps={steps.length}
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
        {steps.map(step => (
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
            onApproveAsIs={() => void approveAsIs(step)}
            onViewDetails={() => setDrawerStep(step)}
          />
        ))}

        {/* Final step — Push to Pages. Lives at the end of the step
            ladder (vs the previous "popup at top" placement) so the
            pipeline reads top-to-bottom: foundations → drafts →
            critique → handoff. Gated on critique_rollup landing so
            the card only appears once the upstream steps are done. */}
        {state?.critique_rollup?._meta?.generated_at && (
          <PushToPagesCard
            projectId={project.id}
            rollupAt={state.critique_rollup._meta.generated_at}
            handoffAudit={state.cowork_handoff_audit ?? null}
            onComplete={() => { void loadProjectState() }}
          />
        )}
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

function Header({ readiness, readinessLoading, overallStats, timelineNotes, onRefresh, refreshing, auditBranch, notionDatabaseUrl, totalSteps }: {
  readiness:        ReadinessReport | null
  readinessLoading: boolean
  overallStats:     { done: number; ready: number; stale: number; cowork: number; waiting: number; firstReadyKey: string | null } | null
  timelineNotes:    string | null
  onRefresh:        () => void
  refreshing:       boolean
  auditBranch:      boolean
  notionDatabaseUrl: string | null
  totalSteps:       number
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

      {/* Audit-branch banner — visible whenever the project has
          notion_database_id set, so the strategist can SEE which
          pipeline they're in (the from-scratch flow is much longer). */}
      {auditBranch && (
        <div className="mb-4 rounded-xl border border-wm-accent/40 bg-wm-accent-tint/40 px-4 py-3 flex items-start gap-2.5">
          <FileText size={14} className="shrink-0 mt-0.5 text-wm-accent-strong" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
              Audit branch — Notion copy already drafted
            </p>
            <p className="text-[12.5px] text-wm-text leading-snug">
              This project's copy lives in Notion, so the pipeline collapses to <strong>{totalSteps} steps</strong>:
              foundations (atoms / facts / strategy / ministry), then the audit-external-copy pass against the
              Notion DB, then the rollup. No outline / draft / allocation work — Notion IS the allocation.
            </p>
            {notionDatabaseUrl && (
              <a
                href={notionDatabaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-[11px] text-wm-accent hover:underline"
              >
                Open Notion database <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      )}

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
              {s.crawl_topics_total} crawl topic{s.crawl_topics_total === 1 ? '' : 's'}
              {(s.cc_files_uploaded ?? 0) > 0 && (
                <> · {s.cc_files_uploaded} CC file{s.cc_files_uploaded === 1 ? '' : 's'} uploaded</>
              )}
              {' '}· {s.pii_flags} PII flag{s.pii_flags === 1 ? '' : 's'}
            </div>
          )}
        </div>
        {(blockers.length > 0 || warnings.length > 0) && (
          <div className="px-5 pb-4 pt-1 flex flex-col gap-2 border-t border-wm-border">
            {blockers.map((b, i) => (
              <ReadinessIssueRow key={`b-${i}`} issue={b} tone="danger" projectId={projectId} onResolved={onRefresh} />
            ))}
            {warnings.map((w, i) => (
              <ReadinessIssueRow key={`w-${i}`} issue={w} tone="warning" projectId={projectId} onResolved={onRefresh} />
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

function StepCard({ step, state, running, anyRunning, isFirstReady, projectId, onRun, onForceRerun, onApproveAsIs, onViewDetails }: {
  step:           StepCatalogEntry
  state:          CoworkPipelineState | null
  running:        boolean
  anyRunning:     boolean
  isFirstReady:   boolean
  projectId:      string
  onRun:          () => void
  onForceRerun:   () => void
  onApproveAsIs:  () => void
  onViewDetails:  () => void
}) {
  const status   = state ? step.computeStatus(state) : 'blocked_waiting'
  const lastAt   = state && step.lastRunAt ? step.lastRunAt(state) : null
  const lastMdl  = state && step.lastModel ? step.lastModel(state) : null
  const progress = state && step.progress  ? step.progress(state)  : null
  const staleR   = state && step.staleReason && status === 'stale'
    ? step.staleReason(state)
    : null

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

      {/* Stale-reason banner — names the upstream that bumped fresh
          past this step's output, with both timestamps. Without this
          the strategist sees "Needs re-run" and has no way to know
          whether something they care about actually changed. */}
      {isStale && staleR && (
        <div className="px-6 pb-4">
          <div className="rounded-md border border-wm-warning/30 bg-wm-warning-bg/40 px-3 py-2 text-[12px] text-wm-text leading-snug">
            <span className="font-semibold">Needs re-run because </span>
            <span className="font-mono">{staleR.upstream_label}</span>
            <span> changed at {new Date(staleR.upstream_at).toLocaleString()} — your last run finished at {new Date(staleR.output_at).toLocaleString()}.</span>
          </div>
        </div>
      )}

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

      {/* Cowork-session automation note — also surfaced on stale so
          the strategist sees the same expectation when re-running. */}
      {step.kind === 'cowork_session' && (isCowork || isStale || isDone) && (
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

        {/* Web-UI stale — Approve as-is option BEFORE re-run, so the
            strategist who's reviewed the existing output can clear
            the stale flag without paying for a re-run. */}
        {step.kind === 'web_ui' && isStale && (
          <button
            type="button"
            onClick={onApproveAsIs}
            disabled={anyRunning}
            className="text-[12px] font-medium px-3 py-2 rounded-lg text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50 transition-colors"
            title="The existing output stays intact; the timestamp moves to now so downstream steps stop seeing it as stale."
          >
            <span className="flex items-center gap-1.5">
              <Check size={12} />
              Approve as-is
            </span>
          </button>
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

        {/* Cowork-session ready (never run) — Download SKILL + Copy prompt
            Steps 7–10 (plan-cross-page-allocation through critique-page)
            + the audit branch (audit-external-copy, supplemental-page-
            authoring) get a Download bundle button: the session reads
            the attached bundle in-context instead of fanning out per-
            page MCP reads. Step 7 was missing from this list before;
            without the bundle the allocation step couldn't see the
            partner_added_inventory the bundle now ships. */}
        {step.kind === 'cowork_session' && isCowork && (
          <>
            {step.skill_md_path && <DownloadSkillButton skillPath={step.skill_md_path} stepNumber={step.step_number} />}
            {['plan-cross-page-allocation', 'outline-page', 'draft-page', 'critique-page', 'audit-external-copy', 'supplemental-page-authoring'].includes(step.key) && (
              <DownloadBundleButton projectId={projectId} />
            )}
            <CopyPromptButton step={step} projectId={projectId} />
          </>
        )}

        {/* Cowork-session stale — output exists but upstream changed.
            Strategist's options, in order of cost:
              View current → audit what's there
              Approve as-is → bump timestamp, content stays
              Download SKILL → side-load contract into a fresh session
              Re-run in Cowork → start a new session against the
                                 fresher upstream
            Previously this state rendered NO buttons. */}
        {step.kind === 'cowork_session' && isStale && (
          <>
            <button
              type="button"
              onClick={onViewDetails}
              className="text-[13px] font-medium px-4 py-2 rounded-lg border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Eye size={13} />
                View current
              </span>
            </button>
            <button
              type="button"
              onClick={onApproveAsIs}
              disabled={anyRunning}
              className="text-[12px] font-medium px-3 py-2 rounded-lg text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50 transition-colors"
              title="The existing output stays intact; the timestamp moves to now so downstream steps stop seeing it as stale."
            >
              <span className="flex items-center gap-1.5">
                <Check size={12} />
                Approve as-is
              </span>
            </button>
            {step.skill_md_path && <DownloadSkillButton skillPath={step.skill_md_path} stepNumber={step.step_number} />}
            {['plan-cross-page-allocation', 'outline-page', 'draft-page', 'critique-page', 'audit-external-copy', 'supplemental-page-authoring'].includes(step.key) && (
              <DownloadBundleButton projectId={projectId} />
            )}
            <CopyPromptButton step={step} projectId={projectId} label="Re-run in Cowork" />
          </>
        )}

        {/* Cowork-session done — View details + tertiary Re-run path.
            Done steps used to only offer View details, which trapped
            the strategist when the SKILL contract changes upstream
            (e.g. capture rules tightened after the step has already
            run cleanly). The strategist needs to be able to pull
            the freshest SKILL.md + bundle and start a new Claude
            Desktop session without having to manually mark the step
            stale first. The Re-run set is rendered LESS prominently
            than View details so the visual hierarchy still says
            "this is done." */}
        {step.kind === 'cowork_session' && isDone && (
          <>
            {step.skill_md_path && <DownloadSkillButton skillPath={step.skill_md_path} stepNumber={step.step_number} />}
            {['plan-cross-page-allocation', 'outline-page', 'draft-page', 'critique-page', 'audit-external-copy', 'supplemental-page-authoring'].includes(step.key) && (
              <DownloadBundleButton projectId={projectId} />
            )}
            <CopyPromptButton step={step} projectId={projectId} label="Re-run in Cowork" />
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

function DownloadSkillButton({ skillPath, stepNumber }: { skillPath: string; stepNumber?: number }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = async () => {
    setDownloading(true)
    setError(null)
    try {
      const stepQs = stepNumber != null ? `&step=${stepNumber}` : ''
      const r = await fetch(`/api/web/cowork/skill-download?path=${encodeURIComponent(skillPath)}${stepQs}`)
      if (!r.ok) {
        // Surface the real reason — most likely the SKILL file isn't
        // bundled into the serverless function (missing includeFiles)
        // or the path didn't match the validator regex.
        let detail = `status ${r.status}`
        try {
          const body = await r.json() as { error?: string; detail?: string }
          detail = body.detail ?? body.error ?? detail
        } catch { /* not JSON */ }
        throw new Error(detail)
      }
      const blob = await r.blob()
      if (blob.size === 0) throw new Error('empty response body')
      const skillName = skillPath.split('/')[1] ?? 'skill'
      // Distinctive filename — includes "cowork-pipeline" so the
      // strategist's Claude Desktop session can't mistake it for
      // unrelated app docs, and step number so the order is
      // obvious.
      const stepPrefix = stepNumber != null ? `step-${String(stepNumber).padStart(2, '0')}.` : ''
      // Force the blob's MIME type to text/markdown so the browser's
      // download path uses the filename + extension we set. Without
      // an explicit type the blob inherits the response's
      // Content-Type which can be enough on most browsers, but the
      // explicit cast removes one more spot where the download
      // silently no-ops (Safari + some Chromium-based browsers were
      // ignoring the click when the blob came back typeless).
      const typed = blob.type ? blob : new Blob([blob], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(typed)
      const a = document.createElement('a')
      a.href = url
      a.download = `cowork-pipeline.${stepPrefix}${skillName}.SKILL.md`
      a.rel = 'noopener'
      // Hide the synthetic <a> so it never paints between attach +
      // click; not all browsers handle a visible 0-size anchor well.
      a.style.position = 'fixed'
      a.style.opacity  = '0'
      a.style.pointerEvents = 'none'
      document.body.appendChild(a)
      a.click()
      // CRITICAL: don't revoke the blob URL synchronously. Some
      // browsers (notably Safari + Chromium with strict download
      // policies) haven't yet started the file transfer when
      // a.click() returns, so revoking the URL right after the
      // click silently aborts the download — exactly the
      // "button clicks, nothing downloads" symptom. Defer both the
      // node removal AND the URL.revoke to the next animation
      // frame; that's enough for every modern engine to register
      // the download intent and start transferring before we drop
      // the underlying blob.
      requestAnimationFrame(() => {
        a.remove()
        URL.revokeObjectURL(url)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handle()}
        disabled={downloading}
        className="text-[13px] font-medium px-4 py-2 rounded-lg border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50 transition-colors"
        title={error ?? undefined}
      >
        <span className="flex items-center gap-1.5">
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {downloading ? 'Downloading…' : 'Download SKILL'}
        </span>
      </button>
      {error && <p className="text-[11px] text-wm-danger max-w-[280px]">SKILL download: {error}</p>}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// DownloadBundleButton — fetches the project context bundle (one JSON
// with every read the per-page sessions need: allocations,
// atoms/facts/crawl pools, stage_1, ministry_model, strategic_goals,
// canonical_templates slot vocab, handoff notes from prior steps).
// The strategist attaches it to Claude Desktop alongside the SKILL.md
// so the cowork session reads in-context instead of running per-page
// RPC fan-outs. Covers steps 8/9/10 — one bundle, three rounds.
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// PushToPagesCard — manual trigger + status for the cowork→pages
// handoff. The auto-fire useEffect on critique_rollup.generated_at
// covers fresh completions, but projects that wrapped step 7 BEFORE
// the handoff was wired need this surface. Also handles re-pushes
// after cowork re-runs and retries on failure.
// ────────────────────────────────────────────────────────────────────

function PushToPagesCard({ projectId, rollupAt, handoffAudit, onComplete }: {
  projectId:    string
  rollupAt:     string
  handoffAudit: CoworkPipelineState['cowork_handoff_audit']
  onComplete:   () => void
}) {
  const [pushing, setPushing] = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; detail: string } | null>(null)

  const lastPushedAt = handoffAudit?.ran_at ?? null
  const stale        = lastPushedAt ? lastPushedAt < rollupAt : true   // never-pushed OR rollup newer than push
  const lostInLast   = !!handoffAudit?.any_round_trip_loss

  const push = async (force = false) => {
    setPushing(true)
    setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not signed in — refresh and try again')
      const r = await fetch('/api/web/cowork/handoff-to-pages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body:    JSON.stringify({ project_id: projectId, force }),
      })
      const body = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; detail?: string; pages?: number; audit?: { total_atoms_preserved?: number; total_facts_preserved?: number; any_round_trip_loss?: boolean }; partner_locked_slugs?: string[] }
      if (r.status === 409 && body.partner_locked_slugs) {
        const proceed = confirm(`These pages are in partner review/approval and would be overwritten:\n\n  ${body.partner_locked_slugs.join('\n  ')}\n\nProceed anyway?`)
        if (proceed) return void push(true)
        setResult({ ok: false, detail: 'Cancelled — partner-locked pages preserved.' })
        return
      }
      if (!r.ok || !body.ok) {
        setResult({ ok: false, detail: body.detail ?? body.error ?? `status ${r.status}` })
        return
      }
      const pageCount = body.pages ?? 0
      const a = body.audit ?? {}
      const summary = `Pushed ${pageCount} page${pageCount === 1 ? '' : 's'} · ${a.total_atoms_preserved ?? 0} atoms / ${a.total_facts_preserved ?? 0} facts preserved · ${a.any_round_trip_loss ? 'WITH ROUND-TRIP LOSS — check the audit/scan tab' : 'no information loss'}`
      setResult({ ok: true, detail: summary })
      onComplete()
    } catch (e) {
      setResult({ ok: false, detail: e instanceof Error ? e.message : 'unknown error' })
    } finally {
      setPushing(false)
    }
  }

  const formatRel = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60_000)
    if (mins < 1)    return 'just now'
    if (mins < 60)   return `${mins} min ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)    return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
    const days = Math.floor(hrs / 24)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 ${stale ? 'border-wm-accent/40 bg-wm-accent-tint/40' : 'border-wm-success/30 bg-wm-success-bg'}`}>
      <div className="flex items-start gap-2.5">
        <ArrowRight size={14} className="shrink-0 mt-0.5 text-wm-accent-strong" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
            Cowork → Pages handoff
          </p>
          {!lastPushedAt && (
            <p className="text-[12.5px] text-wm-text leading-snug">
              Cowork finished. The pages haven't been pushed yet — click below to bridge outlines + drafts + critiques into the Pages workspace. Full provenance preserved.
            </p>
          )}
          {lastPushedAt && stale && (
            <p className="text-[12.5px] text-wm-text leading-snug">
              Last pushed <strong>{formatRel(lastPushedAt)}</strong>, but cowork finished <strong>{formatRel(rollupAt)}</strong>. Push again to sync the latest critiques.
            </p>
          )}
          {lastPushedAt && !stale && (
            <p className="text-[12.5px] text-wm-text leading-snug">
              Pages are in sync. Last pushed <strong>{formatRel(lastPushedAt)}</strong> — {(handoffAudit?.total_atoms_preserved ?? 0)} atoms / {(handoffAudit?.total_facts_preserved ?? 0)} facts preserved {lostInLast ? <span className="text-wm-danger font-semibold">with round-trip loss (check audit tab)</span> : 'with no information loss'}.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void push(false)}
              disabled={pushing}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg ${stale ? 'bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-strong' : 'border border-wm-border bg-wm-bg-elevated text-wm-text hover:bg-wm-bg-hover'} disabled:opacity-50 transition-colors inline-flex items-center gap-1.5`}
            >
              {pushing ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
              {pushing ? 'Pushing…' : (stale ? 'Push to Pages' : 'Re-push (force)')}
            </button>
            {result && (
              <p className={`text-[11px] ${result.ok ? 'text-wm-success' : 'text-wm-danger'}`}>{result.detail}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DownloadBundleButton({ projectId }: { projectId: string }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = async () => {
    setDownloading(true)
    setError(null)
    try {
      const r = await fetch(`/api/web/cowork/page-context-bundle?project_id=${encodeURIComponent(projectId)}`)
      if (!r.ok) throw new Error(`download failed (${r.status})`)
      const blob = await r.blob()
      if (blob.size === 0) throw new Error('empty response body')
      const cd = r.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `cowork-pipeline.${projectId.slice(0, 8)}.project-bundle.json`
      const typed = blob.type ? blob : new Blob([blob], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(typed)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      a.style.position = 'fixed'
      a.style.opacity  = '0'
      a.style.pointerEvents = 'none'
      document.body.appendChild(a)
      a.click()
      // See DownloadSkillButton — revoking the blob URL
      // synchronously after a.click() races the browser's download
      // pipeline; defer to the next frame so the transfer kicks off
      // before the underlying blob is dropped.
      requestAnimationFrame(() => {
        a.remove()
        URL.revokeObjectURL(url)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handle()}
        disabled={downloading}
        className="text-[13px] font-medium px-4 py-2 rounded-lg border border-wm-border text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50 transition-colors"
        title={error ?? 'Pre-packaged project data the cowork session reads in-context. Attach to Claude Desktop alongside the SKILL.md so per-page MCP fan-out collapses to writes only.'}
      >
        <span className="flex items-center gap-1.5">
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {downloading ? 'Downloading…' : 'Download bundle'}
        </span>
      </button>
      {error && <p className="text-[11px] text-wm-danger max-w-[280px]">Bundle download: {error}</p>}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// CopyPromptButton — extracts the catalog's starter_prompt, substitutes
// {{project_id}}, copies to clipboard, shows "Copied" for 2s.
// ────────────────────────────────────────────────────────────────────

function CopyPromptButton({ step, projectId, label = 'Copy prompt for Cowork' }: {
  step:      StepCatalogEntry
  projectId: string
  /** Override the idle button label — e.g. "Re-run in Cowork" for stale steps. */
  label?:    string
}) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    if (!step.starter_prompt) return
    const text = expandCoworkTokens(step.starter_prompt, projectId)
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
        {copied ? 'Copied — paste in Cowork' : label}
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

// ────────────────────────────────────────────────────────────────────
// ReadinessIssueRow + resolvers — let the strategist fix flagged
// data inline instead of opening another workspace. Currently
// handles pii_flag_fact (per-fact: mark publishable / archive / edit)
// and cc_page2_unanswered (per-field: inline textarea, writes to
// strategy_content_collection_sessions). Other warning kinds render
// as text-only (no resolver yet).
// ────────────────────────────────────────────────────────────────────

function ReadinessIssueRow({ issue, tone, projectId, onResolved }: {
  issue:      ReadinessIssue
  tone:       'danger' | 'warning'
  projectId:  string
  onResolved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const resolvable = issue.kind === 'pii_flag_fact' || issue.kind === 'cc_page2_unanswered'
  const colorClass = tone === 'danger' ? 'text-wm-danger' : 'text-wm-warning'

  return (
    <div className={`text-[12px] ${colorClass}`}>
      <div className="flex items-start gap-1.5 mt-2">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span className="flex-1">
          <span className="font-semibold">{issue.kind}:</span> {issue.detail}
        </span>
        {resolvable && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-[11px] font-semibold text-wm-text hover:underline shrink-0"
          >
            {expanded ? 'Hide' : 'Resolve'}
          </button>
        )}
      </div>
      {expanded && issue.kind === 'pii_flag_fact' && (
        <PiiFactResolver issue={issue} projectId={projectId} onResolved={onResolved} />
      )}
      {expanded && issue.kind === 'cc_page2_unanswered' && (
        <CcPage2Resolver issue={issue} projectId={projectId} onResolved={onResolved} />
      )}
    </div>
  )
}

function PiiFactResolver({ issue, projectId, onResolved }: {
  issue:      ReadinessIssue
  projectId:  string
  onResolved: () => void
}) {
  // The readiness scanner ships `rows: [{id, topic, preview}]` for
  // each flagged fact. We let the strategist act on each individually.
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const updateFact = async (factId: string, patch: Record<string, unknown>): Promise<boolean> => {
    setSavingId(factId)
    setError(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('church_facts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', factId)
      .eq('web_project_id', projectId)
    setSavingId(null)
    if (err) { setError(err.message); return false }
    return true
  }

  const markPublishable = async (factId: string) => {
    // church_facts has no `metadata` column — the publishable flag
    // lives on the `data` jsonb under reserved key `_publishable`.
    // Fetch the current data first so the merge preserves the
    // partner's actual fact contents.
    setSavingId(factId)
    setError(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error: readErr } = await (supabase as any)
      .from('church_facts')
      .select('data')
      .eq('id', factId)
      .maybeSingle()
    if (readErr) { setError(readErr.message); setSavingId(null); return }
    const currentData = (row?.data && typeof row.data === 'object') ? row.data as Record<string, unknown> : {}
    setSavingId(null)
    const ok = await updateFact(factId, { data: { ...currentData, _publishable: true } })
    if (ok) onResolved()
  }
  const archive = async (factId: string) => {
    if (!confirm('Archive this fact? It will be excluded from the cowork pipeline.')) return
    const ok = await updateFact(factId, { status: 'archived' })
    if (ok) onResolved()
  }
  const startEdit = async (factId: string) => {
    // Pull current data to seed the edit textarea (rows[].preview is truncated).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .from('church_facts')
      .select('data')
      .eq('id', factId)
      .maybeSingle()
    if (err) { setError(err.message); return }
    const current = (data as { data?: unknown } | null)?.data ?? ''
    setEditDraft(typeof current === 'string' ? current : JSON.stringify(current, null, 2))
    setEditingId(factId)
  }
  const saveEdit = async (factId: string) => {
    // Try to parse JSON; fall back to string. The fact's `data` column
    // is JSONB so both shapes are valid downstream.
    let parsed: unknown
    try { parsed = JSON.parse(editDraft) } catch { parsed = editDraft }
    const ok = await updateFact(factId, { data: parsed })
    if (ok) { setEditingId(null); onResolved() }
  }

  return (
    <div className="mt-2 ml-5 rounded-md border border-wm-border bg-wm-bg-elevated p-3 text-wm-text">
      <p className="text-[11px] text-wm-text-muted mb-2 leading-snug">
        {issue.suggested_fix}
      </p>
      <ul className="flex flex-col gap-2">
        {(issue.rows ?? []).map(row => (
          <li key={row.id} className="rounded border border-wm-border bg-wm-bg p-2">
            <p className="text-[11px] text-wm-text-muted mb-1">
              <span className="font-mono">{row.id.slice(0, 8)}</span>
              {row.topic && <> · <span>{row.topic}</span></>}
            </p>
            {editingId === row.id ? (
              <>
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2 py-1.5 text-[12px] text-wm-text font-mono leading-snug focus:outline-none focus:border-wm-border-focus min-h-[60px]"
                  rows={4}
                />
                <div className="mt-1.5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-[11px] text-wm-text-muted hover:underline"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdit(row.id)}
                    disabled={savingId === row.id}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-wm-accent text-wm-text-on-accent disabled:opacity-50"
                  >
                    {savingId === row.id ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] text-wm-text break-words mb-2">{row.preview}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void markPublishable(row.id)}
                    disabled={savingId === row.id}
                    className="text-[11px] font-medium px-2 py-1 rounded border border-wm-border bg-wm-bg-elevated hover:bg-wm-bg-hover disabled:opacity-50"
                    title="Set data._publishable=true on the fact row. Use when this contact info is publishable (church main line, public email)."
                  >
                    Mark publishable
                  </button>
                  <button
                    type="button"
                    onClick={() => void startEdit(row.id)}
                    disabled={savingId === row.id}
                    className="text-[11px] font-medium px-2 py-1 rounded border border-wm-border bg-wm-bg-elevated hover:bg-wm-bg-hover disabled:opacity-50"
                  >
                    Edit value
                  </button>
                  <button
                    type="button"
                    onClick={() => void archive(row.id)}
                    disabled={savingId === row.id}
                    className="text-[11px] font-medium px-2 py-1 rounded border border-wm-danger/30 bg-wm-bg-elevated text-wm-danger hover:bg-wm-danger-bg disabled:opacity-50"
                    title="Set status=archived. Use when this is a personal cell that shouldn't publish."
                  >
                    Archive
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[11px] text-wm-danger">{error}</p>}
    </div>
  )
}

function CcPage2Resolver({ issue, projectId, onResolved }: {
  issue:      ReadinessIssue
  projectId:  string
  onResolved: () => void
}) {
  // Find / create the latest open session row + render a textarea per
  // unanswered Page 2 field. Free-text input is fine — the cowork
  // pipeline reads these semantically, and the strategist context is
  // "fill in what the partner didn't."
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Most-recent non-closed session for the project. If none exists
      // (partner uploaded a CC file in foundations but never visited
      // the portal), the strategist can create one inline below.
      const { data, error: err } = await supabase
        .from('strategy_content_collection_sessions')
        .select('id')
        .eq('web_project_id', projectId)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      if (err) setError(err.message)
      setSessionId((data as any)?.id ?? null)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [projectId])

  const createSession = async () => {
    setCreating(true)
    setError(null)
    // Pull the project's member — required NOT NULL on the session row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj, error: projErr } = await (supabase as any)
      .from('strategy_web_projects')
      .select('member')
      .eq('id', projectId)
      .maybeSingle()
    if (projErr || !proj) {
      setError(projErr?.message ?? 'Could not find project — refresh and retry')
      setCreating(false)
      return
    }
    // Insert the session with sensible defaults (status='open',
    // inventory_snapshot='{}', domain_invite_confirmed=false,
    // hosting_approved=false — all carry DB-level defaults so we only
    // need to set web_project_id + member). The strategist is filling
    // in Page 2 fields next, so this row owns those answers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error: insErr } = await (supabase as any)
      .from('strategy_content_collection_sessions')
      .insert({
        web_project_id: projectId,
        member:         proj.member,
      })
      .select('id')
      .single()
    if (insErr || !row) {
      setError(insErr?.message ?? 'Could not create session — try again')
      setCreating(false)
      return
    }
    setSessionId(row.id as string)
    setCreating(false)
  }

  const saveField = async (key: string) => {
    if (!sessionId) return
    setSavingKey(key)
    setError(null)
    const raw = drafts[key]?.trim() ?? ''
    // cms_managed_types is a text[] in the schema; split on commas.
    // Everything else is a string column the cowork pipeline reads
    // verbatim. Free-text input is fine for enum fields too — the
    // downstream pipeline interprets semantically.
    let value: unknown = raw
    if (key === 'cms_managed_types') {
      value = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : []
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('strategy_content_collection_sessions')
      .update({ [key]: value })
      .eq('id', sessionId)
    setSavingKey(null)
    if (err) { setError(err.message); return }
    // Wipe the local draft for this row so the UI signals "saved" by
    // collapsing back to the empty input + readiness re-fetch removes
    // it from the warning list on the next pass.
    setDrafts(prev => { const n = { ...prev }; delete n[key]; return n })
    onResolved()
  }

  if (loading) {
    return <div className="mt-2 ml-5 text-[11px] text-wm-text-muted">Loading session…</div>
  }
  if (!sessionId) {
    return (
      <div className="mt-2 ml-5 rounded-md border border-wm-border bg-wm-bg-elevated p-3 text-wm-text">
        <p className="text-[11.5px] text-wm-text-muted leading-snug mb-2">
          No Content Collection session exists for this project yet (the partner uploaded a file
          but never opened the portal). Create a session row to hold your answers — the
          cowork pipeline reads from this row exactly like it would the partner-submitted one.
        </p>
        <button
          type="button"
          onClick={() => void createSession()}
          disabled={creating}
          className="text-[11px] font-semibold px-2.5 py-1 rounded bg-wm-accent text-wm-text-on-accent disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create session + fill in answers'}
        </button>
        {error && <p className="mt-2 text-[11px] text-wm-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2 ml-5 rounded-md border border-wm-border bg-wm-bg-elevated p-3 text-wm-text">
      <p className="text-[11px] text-wm-text-muted mb-2 leading-snug">
        {issue.suggested_fix}
      </p>
      <ul className="flex flex-col gap-2.5">
        {(issue.rows ?? []).map(row => (
          <li key={row.id} className="rounded border border-wm-border bg-wm-bg p-2">
            <label className="text-[11px] font-semibold text-wm-text block mb-1">
              {row.topic ?? row.id}
              <span className="ml-1.5 font-mono font-normal text-wm-text-subtle">{row.id}</span>
            </label>
            <textarea
              value={drafts[row.id] ?? ''}
              onChange={(e) => setDrafts(prev => ({ ...prev, [row.id]: e.target.value }))}
              placeholder={fieldPlaceholder(row.id)}
              className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2 py-1.5 text-[12px] text-wm-text leading-snug focus:outline-none focus:border-wm-border-focus min-h-[44px]"
              rows={2}
            />
            <div className="mt-1.5 flex items-center justify-end">
              <button
                type="button"
                onClick={() => void saveField(row.id)}
                disabled={savingKey === row.id || !(drafts[row.id]?.trim())}
                className="text-[11px] font-semibold px-2.5 py-1 rounded bg-wm-accent text-wm-text-on-accent disabled:opacity-50"
              >
                {savingKey === row.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[11px] text-wm-danger">{error}</p>}
    </div>
  )
}

function fieldPlaceholder(key: string): string {
  // Keeps the strategist from guessing what shape each field expects.
  // The values aren't constrained (free text reaches the cowork
  // pipeline either way), but a hint cuts down on "what does the
  // pipeline expect here?" friction.
  switch (key) {
    case 'events_display_preference':
      return 'e.g. embed (Eventbrite/Planning Center embed), redirect (link to external calendar), or wordpress'
    case 'sermons_display_preference':
      return 'e.g. embed_latest (most recent sermon embed) or archive (full searchable archive)'
    case 'groups_display_preference':
      return 'e.g. embed (PCO Groups embed) or redirect (link out to existing platform)'
    case 'cms_managed_types':
      return 'Comma-separated: e.g. "staff_directory, volunteer_opportunities, events"'
    case 'ministries_list_html':
      return 'HTML or plain text listing each ministry — names + 1-line descriptions'
    case 'discipleship_pathway_html':
      return 'HTML or plain text describing the next-steps / discipleship journey'
    case 'ministries_to_grow':
      return 'Named ministries the partner wants surfaced early — comma-separated or prose'
    case 'high_maintenance_pages_context':
      return 'Context for the pages flagged as high-maintenance in discovery'
    default:
      return ''
  }
}
