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

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Play, Loader2, CheckCircle2, AlertCircle, RefreshCw, Send, FileText, GitBranch,
  ChevronRight, ChevronDown, Eye, Edit3,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { StrategyWebProject } from '../../../types/database'
import { SitemapPreview as RichSitemapPreview } from '../pipeline/previews/SitemapPreview'

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
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'iterate' | 'commit' | null>(null)

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
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
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
  const draftSlugs = Object.keys(drafts).filter(k => k !== '_meta')
  const status = engine.status ?? 'idle'
  const sitemapApproved = sitemap?._meta?.status === 'approved'

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
    setRunning('revise_sitemap'); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/draft-sitemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ projectId: project.id, redoContext: note }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setSitemapFeedback('')
      setRevisingSitemap(false)
      await refreshFromDB()
      await onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setRunning(null)
    }
  }, [sitemapFeedback, project.id, refreshFromDB, onChange])

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

      <StatusBanner engine={engine} />

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
                  : 'No sitemap yet. Draft one in the Planning tab first.'}
            </p>
          </div>
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
              onClick={() => { setRevisingSitemap(true); setSitemapOpen(true) }}
              disabled={!!running}
              className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
            >
              <Edit3 size={12} /> Revise
            </button>
          )}
          {hasStage2 && !sitemapApproved && (
            <button
              onClick={() => void callOrchestrate('approve_sitemap')}
              disabled={!!running}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
            >
              {running === 'approve_sitemap' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Approve
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
          <div className="border-t border-wm-border px-3 py-3 bg-wm-accent/5 space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Revise sitemap</p>
            <p className="text-[11px] text-wm-text-muted leading-snug">
              Name what to change. Be specific — only items you call out get touched.
              Example: "Move Volunteer out of footer into header under Connect. Rename Beliefs to What We Believe."
            </p>
            <textarea
              value={sitemapFeedback}
              onChange={e => setSitemapFeedback(e.target.value)}
              placeholder="What should change?"
              rows={3}
              autoFocus
              className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] text-wm-text focus:outline-none focus:border-wm-accent"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setRevisingSitemap(false); setSitemapFeedback('') }}
                disabled={running === 'revise_sitemap'}
                className="text-[12px] text-wm-text-muted px-3 py-1 hover:text-wm-text"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitSitemapRevision()}
                disabled={!sitemapFeedback.trim() || running === 'revise_sitemap'}
                className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
              >
                {running === 'revise_sitemap' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Re-draft sitemap
              </button>
            </div>
            {sitemapApproved && (
              <p className="text-[11px] text-wm-warning">
                Note: sitemap is currently approved. Re-drafting will create new draft revisions; you'll need to approve again after review.
              </p>
            )}
          </div>
        )}
        {sitemapOpen && sitemap && (
          <div className="border-t border-wm-border px-3 py-3">
            <RichSitemapPreview output={sitemap as unknown as Record<string, unknown>} />
          </div>
        )}
      </div>

      {/* Engine actions — visible at all times so the strategist can see
          what's coming. Disabled with clear reasoning when prerequisites
          aren't met. */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ActionCard
              icon={<Play size={14} />}
              title="Run drafts"
              description={sitemapApproved
                ? "Page briefs + per-page drafts (parallel). Run after sitemap is approved or after major upstream changes."
                : "Locked. Approve the sitemap above first."}
              busy={running === 'run_drafts'}
              disabled={!!running || !sitemapApproved}
              onClick={() => void callOrchestrate('run_drafts')}
            />
            <ActionCard
              icon={<GitBranch size={14} />}
              title="Director critique"
              description="Score each page vs. the spec. Emit directives for pages that need re-drafting."
              busy={running === 'critique'}
              disabled={!!running || draftSlugs.length === 0}
              onClick={() => void callOrchestrate('critique')}
            />
            <ActionCard
              icon={<RefreshCw size={14} />}
              title="Iterate (up to 3 loops)"
              description="Apply directives, re-draft flagged pages, re-critique. Stops when no directives or verdict approves."
              busy={running === 'iterate'}
              disabled={!!running || !critique?.directives?.length}
              onClick={() => setConfirmAction('iterate')}
            />
            <ActionCard
              icon={<FileText size={14} />}
              title="Commit to pages"
              description={draftSlugs.length === 0
                ? "Locked. No drafts to commit yet — run drafts first."
                : "Bind every page_draft to web_pages + web_sections. Strategist can upgrade to specific Brixies templates in the page editor."}
              busy={running === 'commit'}
              disabled={!!running || draftSlugs.length === 0}
              onClick={() => setConfirmAction('commit')}
            />
          </div>

          {confirmAction === 'iterate' && (
            <ConfirmPanel
              title="Iterate — preview"
              busy={running === 'iterate'}
              onCancel={() => setConfirmAction(null)}
              onConfirm={async () => { setConfirmAction(null); await callOrchestrate('iterate') }}
              confirmLabel="Run iteration"
            >
              <p className="text-[12px] text-wm-text leading-snug">
                The orchestrator will:
              </p>
              <ul className="text-[12px] text-wm-text-muted space-y-1 list-disc list-inside">
                {(critique?.directives ?? []).slice(0, 8).map((d, i) => (
                  <li key={i}>
                    <span className="font-semibold text-wm-text">{d.stage_to_rerun}</span>
                    {d.page_slug && d.page_slug !== '*' && <> on <span className="font-mono">{d.page_slug}</span></>}
                    {' — '}{d.note.slice(0, 100)}{d.note.length > 100 ? '…' : ''}
                  </li>
                ))}
                {(critique?.directives?.length ?? 0) > 8 && (
                  <li>… and {(critique?.directives?.length ?? 0) - 8} more</li>
                )}
              </ul>
              <p className="text-[11px] text-wm-text-muted mt-1">
                Then re-critique. Up to 3 loops total.
              </p>
            </ConfirmPanel>
          )}

          {confirmAction === 'commit' && (
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

function StatusBanner({ engine }: { engine: EngineState }) {
  const status = engine.status ?? 'idle'
  const phase = engine.current_phase ?? '—'
  const showProgress = (engine.pages_total ?? 0) > 0 && (engine.pages_drafted ?? engine.pages_committed) != null
  const drafted = engine.pages_drafted ?? engine.pages_committed ?? 0
  const total = engine.pages_total ?? 0

  const tone =
    status === 'committed' || status === 'ready_for_review' ? 'success'
    : status === 'error' ? 'danger'
    : status === 'idle' ? 'muted' : 'info'

  const toneClass = {
    success: 'border-wm-success/30 bg-wm-success-bg text-wm-success',
    danger:  'border-wm-danger/30 bg-wm-danger-bg text-wm-danger',
    info:    'border-wm-accent/30 bg-wm-accent/5 text-wm-accent-strong',
    muted:   'border-wm-border bg-wm-bg-elevated text-wm-text-muted',
  }[tone]

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

function ScoreChip({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const color = value >= 80 ? 'text-wm-success' : value >= 60 ? 'text-wm-warning' : 'text-wm-danger'
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg p-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-wm-text-muted">{label}</p>
      <p className={['mt-0.5', color, bold ? 'text-[15px] font-bold' : 'text-[13px] font-semibold'].join(' ')}>{value}</p>
    </div>
  )
}
