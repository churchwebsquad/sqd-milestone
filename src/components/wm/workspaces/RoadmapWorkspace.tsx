/**
 * Web Manager — Roadmap workspace.
 *
 * Two purposes in one tab:
 *   1. The Web Roadmap deliverable (partner-addressed) — opening
 *      paragraph + strategy properties + milestone overview + internal
 *      flags (collapsed).
 *   2. The AI strategy pipeline — five stages with approval gates,
 *      'Begin content strategy' CTA once intake hard stops are met.
 *
 * Toggle: Staff view (everything) vs Partner preview (deliverable only,
 * minus internal flags + pipeline). The deliverable is the artifact
 * Notion publishes for the partner; this surface is the strategist's
 * editor.
 *
 * Phase A: the editor fields are wired and persist, but AI agents
 * don't fire yet — every Stage card sits in 'locked' or 'pending'
 * until Phase C lands the agents. The 'Begin content strategy' button
 * sets roadmap_stage to 'extracting_strategy' as a placeholder so the
 * UI gating flow can be tested end-to-end.
 */

import { useEffect, useState } from 'react'
import {
  Compass, Eye, Edit3, ChevronDown, ChevronRight,
  Lock, Loader2, CheckCircle2, AlertCircle, Sparkles, RotateCw, ArrowRight,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { fetchIntakeStatus } from '../../../lib/webIntake'
import { extractStrategy, draftSitemap } from '../../../lib/webAgents'
import type { ExtractStrategyError, DraftSitemapError } from '../../../lib/webAgents'
import { commitSitemapToPages } from '../../../lib/webSitemap'
import { WMSegmentedToggle } from '../SegmentedToggle'
import { WMButton } from '../Button'
import { WMCard } from '../Card'
import { WMStatusPill } from '../StatusPill'
import type { StrategyWebProject, WMRoadmapStage } from '../../../types/database'

interface Props {
  project: StrategyWebProject
  onChange: () => Promise<void>
}

type ViewMode = 'staff' | 'partner'

interface StageDef {
  num: number
  key: WMRoadmapStage   // the stage where this is the "active" state
  doneKey: WMRoadmapStage // the stage where this stage has completed
  title: string
  description: string
}

const STAGES: StageDef[] = [
  {
    num: 1, key: 'extracting_strategy', doneKey: 'strategy_done',
    title: 'Strategy Extraction',
    description: 'AI reads intake (discovery questionnaire, brand handoff, strategy brief) and extracts: audience, voice characteristics, personas, X-factor, project goals.',
  },
  {
    num: 2, key: 'drafting_sitemap', doneKey: 'sitemap_done',
    title: 'Sitemap',
    description: 'AI proposes the page list with rationale — what pages this church needs, organized by phase (1 / 2 / nav-only).',
  },
  {
    num: 3, key: 'drafting_journey', doneKey: 'journey_done',
    title: 'User Journey',
    description: 'AI maps the primary visitor paths through the site. How does Jordan find Sunday service times? Where does a partner-seeker land first?',
  },
  {
    num: 4, key: 'drafting_roadmap', doneKey: 'roadmap_done',
    title: 'Per-Page Roadmap',
    description: 'AI plans the section structure of each page — what sections appear, what message they carry, what CTAs they hold.',
  },
  {
    num: 5, key: 'drafting_pages', doneKey: 'all_done',
    title: 'Page Drafts',
    description: 'AI writes the actual copy for every page, filling Brixies section schemas. Strategist reviews each page, requests redos with context, approves.',
  },
]

export function RoadmapWorkspace({ project, onChange }: Props) {
  const [view, setView] = useState<ViewMode>('staff')
  const [intakeReady, setIntakeReady] = useState<boolean | null>(null)
  const [draft, setDraft] = useState({
    opening_paragraph: project.roadmap_opening_paragraph ?? '',
    milestone_overview: project.roadmap_milestone_overview ?? '',
    properties: (project.roadmap_properties ?? {}) as Record<string, string>,
    internal_flags: (project.roadmap_internal_flags ?? {}) as Record<string, string>,
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flagsOpen, setFlagsOpen] = useState(false)
  const [beginning, setBeginning] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [agentError, setAgentError] = useState<ExtractStrategyError | DraftSitemapError | null>(null)

  // Verify intake hard stops are met (so Stage 1 can fire)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const status = await fetchIntakeStatus(project.id, project.member)
      if (!cancelled) setIntakeReady(status.ready_for_content)
    })()
    return () => { cancelled = true }
  }, [project.id, project.member])

  const save = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({
        roadmap_opening_paragraph: draft.opening_paragraph.trim() || null,
        roadmap_milestone_overview: draft.milestone_overview.trim() || null,
        roadmap_properties: draft.properties,
        roadmap_internal_flags: draft.internal_flags,
      })
      .eq('id', project.id)
    setSaving(false)
    if (!error) { setDirty(false); await onChange() }
  }

  const handleBegin = async (mock = false) => {
    setBeginning(true)
    setAgentError(null)
    try {
      const { result, error } = await extractStrategy(project.id, undefined, mock)
      if (error) {
        setAgentError(error)
        await onChange()
        return
      }
      if (result) await onChange()
    } catch (e) {
      setAgentError({
        error: `Couldn't reach the extraction endpoint. ${e instanceof Error ? e.message : String(e)}.`,
      })
    } finally {
      setBeginning(false)
    }
  }

  /** Approve Stage N and immediately kick off Stage N+1. */
  const handleAdvance = async (fromStage: WMRoadmapStage, mock = false) => {
    setAdvancing(true)
    setAgentError(null)
    try {
      if (fromStage === 'strategy_done') {
        const { result, error } = await draftSitemap(project.id, undefined, mock)
        if (error) {
          setAgentError(error)
          await onChange()
          return
        }
        if (result) await onChange()
      } else if (fromStage === 'sitemap_done') {
        // Stage 2 approval = commit the proposed pages to web_pages.
        // Stage 3 (User Journey) will fire from here once built.
        const { result, error } = await commitSitemapToPages(project.id)
        if (error) {
          setAgentError({ error: error.error })
          return
        }
        void result
        await onChange()
      }
      // Stage 3+ wires here later (drafting_journey, drafting_roadmap, drafting_pages)
    } catch (e) {
      setAgentError({
        error: `Couldn't advance the pipeline. ${e instanceof Error ? e.message : String(e)}.`,
      })
    } finally {
      setAdvancing(false)
    }
  }

  const stage = project.roadmap_stage
  const roadmapState = (project.roadmap_state as { stage_1?: Record<string, unknown>; stage_2?: Record<string, unknown> } | null) ?? {}
  const stage1 = roadmapState.stage_1
  const stage2 = roadmapState.stage_2
  const hasExtraction = !!stage1 && Object.keys(stage1).some(k => k !== '_meta')
  const hasSitemap = !!stage2 && Object.keys(stage2).some(k => k !== '_meta')

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* View toggle */}
        <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
              <Compass size={13} />
              <p className="text-[11px] font-bold uppercase tracking-widest">Roadmap</p>
            </div>
            <h1 className="text-2xl font-semibold text-wm-text">Web roadmap & strategy pipeline</h1>
            <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
              The partner-addressed roadmap deliverable + the AI orchestration that drives sitemap,
              journey, and page drafts. Approve at each gate before AI continues.
            </p>
          </div>
          <WMSegmentedToggle
            options={[
              { key: 'staff',   label: 'Staff view',     icon: <Edit3 size={11} /> },
              { key: 'partner', label: 'Partner preview', icon: <Eye   size={11} /> },
            ]}
            active={view}
            onChange={setView}
          />
        </div>

        {/* ── ROADMAP DELIVERABLE ─────────────────────────────────── */}
        <WMCard padding="loose" className="mb-6">
          <SectionHeader title="Web roadmap" subtitle="The partner-addressed deliverable" />

          <div className="space-y-5">
            {/* Opening paragraph */}
            <div>
              <Label>Opening paragraph</Label>
              {view === 'staff' ? (
                <textarea
                  value={draft.opening_paragraph}
                  onChange={e => { setDraft(d => ({ ...d, opening_paragraph: e.target.value })); setDirty(true) }}
                  placeholder="3–5 sentences, partner-addressed, 'You / Your' language. AI drafts this at Stage 1."
                  className="w-full min-h-[120px] rounded-md bg-wm-bg border border-wm-border px-3 py-2 text-sm text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
                />
              ) : (
                <ReadOnlyBlock value={draft.opening_paragraph || '— Will be drafted by AI at Stage 1.'} />
              )}
            </div>

            {/* Strategy properties */}
            <div>
              <Label>Strategy properties</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {STRATEGY_PROPERTY_FIELDS.map(f => (
                  <PropertyField
                    key={f.key}
                    field={f}
                    value={draft.properties[f.key] ?? ''}
                    readOnly={view === 'partner'}
                    onChange={(v) => { setDraft(d => ({ ...d, properties: { ...d.properties, [f.key]: v } })); setDirty(true) }}
                  />
                ))}
              </div>
            </div>

            {/* Rich extraction sections — folded inline once Stage 1 has run.
                Read-only displays of the AI's structured output. */}
            {hasExtraction && stage1 && (
              <ExtractionSections data={stage1} viewMode={view} />
            )}

            {/* Sitemap proposal pointer — lives in its own tab now */}
            {hasSitemap && (
              <Stage2Pointer
                projectId={project.id}
                phaseCount={(stage2 as any)?.phase_summary?.total ?? undefined}
              />
            )}

            {/* Milestone overview */}
            <div>
              <Label>Milestone overview</Label>
              {view === 'staff' ? (
                <textarea
                  value={draft.milestone_overview}
                  onChange={e => { setDraft(d => ({ ...d, milestone_overview: e.target.value })); setDirty(true) }}
                  placeholder="Project milestones, timeline expectations, what the partner can expect at each phase."
                  className="w-full min-h-[100px] rounded-md bg-wm-bg border border-wm-border px-3 py-2 text-sm text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
                />
              ) : (
                <ReadOnlyBlock value={draft.milestone_overview || "— Will be populated from the project's milestone template."} />
              )}
            </div>

            {/* Internal flags (staff only) */}
            {view === 'staff' && (
              <div>
                <button
                  type="button"
                  onClick={() => setFlagsOpen(o => !o)}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-wm-text-muted hover:text-wm-text transition-colors"
                >
                  {flagsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Internal Web Squad flags
                  <WMStatusPill tone="neutral" size="sm">staff only</WMStatusPill>
                </button>
                {flagsOpen && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {INTERNAL_FLAG_FIELDS.map(f => (
                      <PropertyField
                        key={f.key}
                        field={f}
                        value={draft.internal_flags[f.key] ?? ''}
                        onChange={(v) => { setDraft(d => ({ ...d, internal_flags: { ...d.internal_flags, [f.key]: v } })); setDirty(true) }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save bar */}
          {view === 'staff' && dirty && (
            <div className="mt-5 pt-4 border-t border-wm-border flex items-center justify-end gap-2">
              <span className="text-[12px] text-wm-text-subtle italic">Unsaved changes</span>
              <WMButton variant="primary" size="sm" loading={saving} onClick={save}>Save roadmap</WMButton>
            </div>
          )}
        </WMCard>

        {/* ── AI PIPELINE (staff-only) ───────────────────────────── */}
        {view === 'staff' && (
          <WMCard padding="loose">
            <SectionHeader title="AI content strategy pipeline" subtitle="Five stages — each pauses for your approval before continuing" />

            {/* Agent error from pre-flight or Claude */}
            {agentError && <AgentErrorBanner error={agentError} onDismiss={() => setAgentError(null)} />}

            {/* Begin CTA — only when intake ready + stage = ready/pre_intake */}
            {(stage === 'pre_intake' || stage === 'ready') && (
              <div className={[
                'mb-5 rounded-md border p-4 flex items-center justify-between gap-3 flex-wrap',
                intakeReady ? 'bg-wm-ai-bg border-wm-ai-border' : 'bg-wm-warning-bg border-wm-warning/20',
              ].join(' ')}>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-wm-text">
                    {intakeReady ? 'Ready to begin' : 'Intake incomplete'}
                  </p>
                  <p className="text-[12px] text-wm-text-muted mt-0.5">
                    {intakeReady
                      ? "All three intake hard stops are met. Press begin and Claude opus 4.7 will read every available intake source — DB rows, Strategy Brief, Content Collection, AM Handoff notes — and synthesize a strategic foundation that anchors Stages 2–5. Run time is typically 30–90s; cost ~$0.50–$1.50 per project depending on intake size."
                      : 'Discovery questionnaire, strategy brief, and brand handoff must be received before AI can run.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <WMButton
                    variant="primary"
                    onClick={() => handleBegin(false)}
                    disabled={!intakeReady || beginning}
                    loading={beginning}
                    iconLeft={<Sparkles size={13} />}
                  >
                    {beginning ? 'Extracting strategy…' : 'Begin content strategy'}
                  </WMButton>
                  <WMButton
                    variant="ghost"
                    size="sm"
                    onClick={() => handleBegin(true)}
                    disabled={beginning}
                    title="Skip Anthropic and seed Stage 1 with canned data. Lets you test Stages 2-5 without burning API credits."
                  >
                    Mock run
                  </WMButton>
                </div>
              </div>
            )}

            {/* Stage cards — no inline output. Stage N's structured output is
                folded into the Web Roadmap card above (Stage 1 today; Stage
                2's sitemap section landing next). */}
            <div className="space-y-3">
              {STAGES.map(s => (
                <StageCard
                  key={s.num}
                  stage={s}
                  currentStage={stage}
                  advancing={advancing}
                  onApprove={() => handleAdvance(s.doneKey)}
                  onApproveMock={() => handleAdvance(s.doneKey, true)}
                />
              ))}
            </div>
          </WMCard>
        )}
      </div>
    </div>
  )
}

// ── Stage card ────────────────────────────────────────────────────────

type StageState = 'locked' | 'pending' | 'running' | 'awaiting' | 'done'

const STAGE_ORDER: WMRoadmapStage[] = [
  'pre_intake', 'ready',
  'extracting_strategy', 'strategy_done',
  'drafting_sitemap',    'sitemap_done',
  'drafting_journey',    'journey_done',
  'drafting_roadmap',    'roadmap_done',
  'drafting_pages',      'all_done',
]

function stageState(stage: StageDef, current: WMRoadmapStage): StageState {
  const currentIdx  = STAGE_ORDER.indexOf(current)
  const runningIdx  = STAGE_ORDER.indexOf(stage.key)
  const doneIdx     = STAGE_ORDER.indexOf(stage.doneKey)
  if (currentIdx < runningIdx) return 'locked'
  if (currentIdx === runningIdx) return 'running'
  if (currentIdx === doneIdx)    return 'awaiting'
  if (currentIdx > doneIdx)      return 'done'
  return 'locked'
}

function StageCard({
  stage, currentStage, advancing, onApprove, onApproveMock,
}: {
  stage: StageDef
  currentStage: WMRoadmapStage
  advancing: boolean
  onApprove: () => void
  onApproveMock: () => void
}) {
  const state = stageState(stage, currentStage)
  const meta = STAGE_STATE_META[state]
  const Icon = meta.icon
  // Only the next stage (4 of 5) has a downstream agent to kick off.
  // Stage 5 approval just locks the project; no continuation.
  const hasNextStage = stage.num < 5

  return (
    <div
      className={[
        'rounded-md border p-4 transition-colors',
        meta.containerClass,
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className={[
          'shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-bold',
          meta.numClass,
        ].join(' ')}>
          {stage.num}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-[14px] font-semibold text-wm-text">{stage.title}</h3>
            <WMStatusPill tone={meta.pillTone} size="sm" icon={<Icon size={10} />}>
              {meta.pillLabel}
            </WMStatusPill>
          </div>
          <p className="text-[12px] text-wm-text-muted leading-snug">{stage.description}</p>
          {state === 'awaiting' && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <WMButton
                variant="primary"
                size="sm"
                iconRight={<ArrowRight size={11} />}
                onClick={onApprove}
                loading={advancing}
                disabled={advancing}
              >
                {hasNextStage ? 'Approve & continue' : 'Approve & lock'}
              </WMButton>
              {hasNextStage && (
                <WMButton
                  variant="ghost"
                  size="sm"
                  onClick={onApproveMock}
                  disabled={advancing}
                  title="Approve and run the next stage in mock mode (no AI call)."
                >
                  Approve (mock next)
                </WMButton>
              )}
              <WMButton variant="ghost" size="sm" iconLeft={<RotateCw size={11} />} disabled={advancing}>
                Redo with changes
              </WMButton>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const STAGE_STATE_META: Record<StageState, {
  containerClass: string
  numClass: string
  pillTone: 'neutral' | 'ai' | 'info' | 'success' | 'warning' | 'danger'
  pillLabel: string
  icon: typeof Lock
}> = {
  locked: {
    containerClass: 'bg-wm-bg border-wm-border opacity-60',
    numClass: 'bg-wm-bg-hover text-wm-text-subtle',
    pillTone: 'neutral', pillLabel: 'Locked', icon: Lock,
  },
  pending: {
    containerClass: 'bg-wm-bg-elevated border-wm-border',
    numClass: 'bg-wm-bg-hover text-wm-text-muted',
    pillTone: 'neutral', pillLabel: 'Not started', icon: AlertCircle,
  },
  running: {
    containerClass: 'bg-wm-ai-bg border-wm-ai-border animate-wm-pulse-accent',
    numClass: 'bg-wm-accent text-white',
    pillTone: 'ai', pillLabel: 'AI working', icon: Loader2,
  },
  awaiting: {
    containerClass: 'bg-wm-warning-bg border-wm-warning/30',
    numClass: 'bg-wm-warning text-white',
    pillTone: 'warning', pillLabel: 'Awaiting approval', icon: AlertCircle,
  },
  done: {
    containerClass: 'bg-wm-bg-elevated border-wm-border',
    numClass: 'bg-wm-success text-white',
    pillTone: 'success', pillLabel: 'Approved', icon: CheckCircle2,
  },
}

// ── Property fields ──────────────────────────────────────────────────

interface PropertyFieldDef {
  key: string
  label: string
  placeholder: string
  rows?: number
}

const STRATEGY_PROPERTY_FIELDS: PropertyFieldDef[] = [
  { key: 'primary_goals',     label: 'Primary goals',      placeholder: 'Identity, connection, growth…', rows: 3 },
  { key: 'tone',              label: 'Tone characteristics', placeholder: 'e.g. Bold Truth · Grace-filled · Detroit Grit' },
  { key: 'target_audience',   label: 'Target audience',    placeholder: 'Multi-generational with growth in young families.', rows: 2 },
  { key: 'brand_style_tags',  label: 'Brand style tags',   placeholder: 'e.g. modern · approachable · classic · bold' },
  { key: 'x_factor',          label: 'X-factor / top attribute', placeholder: 'e.g. Relational community' },
  { key: 'engagement_type',   label: 'Engagement type',    placeholder: 'Redesign / Audit / New build' },
]

const INTERNAL_FLAG_FIELDS: PropertyFieldDef[] = [
  { key: 'hosting',           label: 'Hosting provider',   placeholder: 'GoDaddy, Pressable, etc.' },
  { key: 'domain_registrar',  label: 'Domain registrar',   placeholder: 'Squarespace, Namecheap, etc.' },
  { key: 'integrations',      label: 'Integrations needed', placeholder: 'PCO, Subsplash, Tithely, Mailchimp', rows: 2 },
  { key: 'tech_flags',        label: 'Tech flags',         placeholder: 'Requires ACF setup · Requires PCO integration', rows: 2 },
  { key: 'seo_targets',       label: 'SEO targets',        placeholder: 'Local keywords, city/state focus' },
  { key: 'identity_drivers',  label: 'Identity drivers',   placeholder: 'Logo redesign, color refresh, type pair update' },
]

function PropertyField({
  field, value, readOnly = false, onChange,
}: {
  field: PropertyFieldDef
  value: string
  readOnly?: boolean
  onChange?: (v: string) => void
}) {
  if (readOnly) {
    return (
      <div>
        <Label>{field.label}</Label>
        <ReadOnlyBlock value={value || '—'} small />
      </div>
    )
  }
  return (
    <div>
      <Label>{field.label}</Label>
      {field.rows && field.rows > 1 ? (
        <textarea
          value={value}
          onChange={e => onChange?.(e.target.value)}
          rows={field.rows}
          placeholder={field.placeholder}
          className="w-full rounded-md bg-wm-bg border border-wm-border px-3 py-2 text-sm text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={field.placeholder}
          className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
        />
      )}
    </div>
  )
}

// ── Shared mini-components ───────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[15px] font-semibold text-wm-text">{title}</h2>
      <p className="text-[12px] text-wm-text-muted mt-0.5">{subtitle}</p>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
      {children}
    </p>
  )
}

function ReadOnlyBlock({ value, small }: { value: string; small?: boolean }) {
  return (
    <div className={[
      'rounded-md bg-wm-bg border border-wm-border px-3 py-2 whitespace-pre-wrap',
      small ? 'text-[12px]' : 'text-sm',
      value === '—' || value.startsWith('— Will be') ? 'text-wm-text-subtle italic' : 'text-wm-text',
    ].join(' ')}>
      {value}
    </div>
  )
}

// ── Extraction sections (folded into the Web Roadmap card) ────────────
//
// Read-only displays of the rich AI output that doesn't fit in the
// single-line "strategy properties" grid above: audience breakdown,
// voice do/don't lists, personas, x-factor messaging, project goals
// split, sitemap signals (staff only), sources used + conflicts
// resolved (staff only).

function ExtractionSections({
  data, viewMode,
}: { data: Record<string, unknown>; viewMode: ViewMode }) {
  const audience       = data.audience            as Record<string, unknown> | undefined
  const voice          = data.voice_characteristics as Record<string, unknown> | undefined
  const personas       = data.personas             as Array<Record<string, unknown>> | undefined
  const xFactor        = data.x_factor             as Record<string, unknown> | undefined
  const goals          = data.project_goals        as Record<string, unknown> | undefined
  const sitemapSignals = data.sitemap_signals      as Record<string, unknown> | undefined
  const sources        = data.sources_used         as Record<string, unknown> | undefined
  const meta           = data._meta                as Record<string, unknown> | undefined

  const isStaff = viewMode === 'staff'

  return (
    <div className="space-y-5 pt-2 border-t border-wm-border">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
        <Sparkles size={11} /> AI extraction
        {meta?.extracted_at && (
          <span className="text-wm-text-subtle font-normal normal-case">· {new Date(meta.extracted_at as string).toLocaleString()}</span>
        )}
      </div>

      {/* Audience details */}
      {audience && (
        <ExtractionSection title="Audience details">
          <KVGrid pairs={[
            ['Primary segments', formatList(audience.primary_segments)],
            ['Age distribution', String(audience.age_distribution ?? '')],
            ['Geographic reach', String(audience.geographic_reach ?? '')],
            ['Online vs in-person', String(audience.online_vs_in_person ?? '')],
          ]} />
        </ExtractionSection>
      )}

      {/* Voice details */}
      {voice && (
        <ExtractionSection title="Voice guidance">
          {voice.description && <p className="text-sm text-wm-text leading-relaxed mb-3">{String(voice.description)}</p>}
          {(voice.tone_examples_do || voice.tone_examples_dont) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {voice.tone_examples_do && (
                <ExampleList tone="success" label="Do" items={voice.tone_examples_do as string[]} />
              )}
              {voice.tone_examples_dont && (
                <ExampleList tone="danger" label="Don't" items={voice.tone_examples_dont as string[]} />
              )}
            </div>
          )}
        </ExtractionSection>
      )}

      {/* Personas */}
      {personas && personas.length > 0 && (
        <ExtractionSection title={`Personas · ${personas.length}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {personas.map((p, i) => (
              <div key={i} className="rounded-md bg-wm-bg-elevated border border-wm-border p-3">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">{String(p.archetype ?? '')}</p>
                <h4 className="text-[14px] font-semibold text-wm-text">{String(p.name ?? '')}</h4>
                {p.description && <p className="text-[12px] text-wm-text-muted mt-1 leading-snug">{String(p.description)}</p>}
                {p.message && (
                  <blockquote className="mt-2 text-[12px] italic text-wm-text border-l-2 border-wm-accent pl-3">{String(p.message)}</blockquote>
                )}
              </div>
            ))}
          </div>
        </ExtractionSection>
      )}

      {/* X-factor messaging focus (the top_attribute is already in the
          editable Strategy properties grid above — only the longer
          messaging focus needs surfacing here) */}
      {xFactor?.messaging_focus && (
        <ExtractionSection title="X-factor messaging">
          <p className="text-sm text-wm-text-muted leading-relaxed">{String(xFactor.messaging_focus)}</p>
        </ExtractionSection>
      )}

      {/* Project goals split into Identity / Connection / Growth */}
      {goals && (
        <ExtractionSection title="Project goals (detail)">
          <KVGrid pairs={[
            ['Identity',  String(goals.identity ?? '')],
            ['Connection', String(goals.connection ?? '')],
            ['Growth',    String(goals.growth ?? '')],
          ]} />
        </ExtractionSection>
      )}

      {/* Sitemap signals — staff only (feeds Stage 2) */}
      {isStaff && sitemapSignals && (
        <ExtractionSection title="Sitemap signals (feeds Stage 2)">
          <KVGrid pairs={[
            ['Sermon blog requested', sitemapSignals.sermon_blog_requested ? 'Yes' : 'No'],
            ['Sermons display mode',  formatDisplayMode(sitemapSignals.sermons_display_mode as string)],
            ['Events display mode',   formatDisplayMode(sitemapSignals.events_display_mode as string)],
            ['Groups display mode',   formatDisplayMode(sitemapSignals.groups_display_mode as string)],
            ['Recommended pages',     formatList(sitemapSignals.recommended_pages)],
            ['Tech flags',            formatList(sitemapSignals.tech_flags)],
          ]} />
        </ExtractionSection>
      )}

      {/* Sources used + conflicts — staff only */}
      {isStaff && sources && (
        <ExtractionSection title="Sources used">
          <KVGrid pairs={[
            ['Strategy brief',          String(sources.strategy_brief ?? '—')],
            ['AM handoff',              String(sources.am_handoff ?? '—')],
            ['Discovery questionnaire', String(sources.discovery_questionnaire ?? '—')],
            ['Brand handoff',           String(sources.brand_handoff ?? '—')],
            ['Content collection',      String(sources.content_collection ?? '—')],
          ]} />
          {Array.isArray(sources.conflicts_resolved) && sources.conflicts_resolved.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Conflicts resolved</p>
              <ul className="space-y-1">
                {(sources.conflicts_resolved as string[]).map((c, i) => (
                  <li key={i} className="text-[12px] text-wm-text-muted">· {c}</li>
                ))}
              </ul>
            </div>
          )}
        </ExtractionSection>
      )}

      {/* Provenance footer — staff only */}
      {isStaff && meta && (
        <div className="text-[10px] text-wm-text-subtle pt-2 border-t border-wm-border">
          Model: <code>{String(meta.model)}</code>
          {meta.usage && typeof meta.usage === 'object' && (
            <> · Tokens: {((meta.usage as Record<string, number>).input_tokens ?? 0).toLocaleString()} in / {((meta.usage as Record<string, number>).output_tokens ?? 0).toLocaleString()} out</>
          )}
          {meta.files_loaded && Array.isArray(meta.files_loaded) && (
            <> · Files: {(meta.files_loaded as Array<{ filename: string }>).length}</>
          )}
        </div>
      )}
    </div>
  )
}

function ExtractionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">{title}</p>
      <div>{children}</div>
    </div>
  )
}

function KVGrid({ pairs }: { pairs: Array<[string, string]> }) {
  const visible = pairs.filter(([, v]) => v && v !== '—')
  if (visible.length === 0) return null
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
      {visible.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-wm-text-subtle whitespace-nowrap">{k}</dt>
          <dd className="text-wm-text">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ExampleList({ tone, label, items }: { tone: 'success' | 'danger'; label: string; items: string[] }) {
  const toneClass = tone === 'success' ? 'border-wm-success/20 bg-wm-success-bg' : 'border-wm-danger/20 bg-wm-danger-bg'
  const labelClass = tone === 'success' ? 'text-wm-success' : 'text-wm-danger'
  return (
    <div className={['rounded-md border p-2.5', toneClass].join(' ')}>
      <p className={['text-[10px] uppercase tracking-widest font-bold mb-1.5', labelClass].join(' ')}>{label}</p>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className="text-[12px] text-wm-text">· {it}</li>)}
      </ul>
    </div>
  )
}

function formatList(v: unknown): string {
  if (!Array.isArray(v)) return ''
  return v.join(' · ')
}

function formatDisplayMode(v: string | undefined): string {
  if (!v) return ''
  const map: Record<string, string> = {
    archive_link:      'Option 1 · External archive link',
    chms_embed:        'Option 2 · ChMS embed',
    wordpress_managed: 'Option 3 · Managed in WordPress',
    unspecified:       '— (unspecified in intake)',
  }
  return map[v] ?? v
}

// ── Stage 2 pointer (the full proposal renders in the Sitemap tab) ───

function Stage2Pointer({ projectId, phaseCount }: { projectId: string; phaseCount?: number }) {
  return (
    <a
      href={`/web/${projectId}/content?tab=sitemap`}
      className="block rounded-md border border-wm-ai-border bg-wm-ai-bg/40 p-3 hover:bg-wm-ai-bg transition-colors"
    >
      <div className="flex items-center gap-3">
        <Compass size={16} className="text-wm-accent-strong shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-wm-text">
            Sitemap proposal ready{phaseCount ? ` · ${phaseCount} pages` : ''}
          </p>
          <p className="text-[11px] text-wm-text-muted">
            Nav strategy, page outlines, vocabulary decisions, and CS flags live in the Sitemap &amp; Strategy tab.
          </p>
        </div>
        <ArrowRight size={14} className="text-wm-accent-strong shrink-0" />
      </div>
    </a>
  )
}

// ── Agent error banner ──────────────────────────────────────────────

function AgentErrorBanner({
  error, onDismiss,
}: {
  error: ExtractStrategyError | DraftSitemapError
  onDismiss: () => void
}) {
  return (
    <div className="mb-5 rounded-md border border-wm-danger/30 bg-wm-danger-bg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className="text-wm-danger" />
          <p className="text-[13px] font-semibold text-wm-danger">Pipeline run failed</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] text-wm-text-subtle hover:text-wm-text"
        >
          Dismiss
        </button>
      </div>
      <p className="text-[12px] text-wm-text mb-3">{error.error}</p>

      {'missing_sources' in error && error.missing_sources && error.missing_sources.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Missing sources</p>
          <ul className="space-y-0.5">
            {error.missing_sources.map((s, i) => (
              <li key={i} className="text-[12px] text-wm-text">· {s}</li>
            ))}
          </ul>
        </div>
      )}

      {error.files_failed && error.files_failed.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
            Files that failed pre-flight ({error.files_failed.length})
          </p>
          <ul className="space-y-1">
            {error.files_failed.map((f, i) => (
              <li key={i} className="text-[12px] text-wm-text bg-wm-bg rounded px-2 py-1 border border-wm-border">
                <span className="font-mono text-[11px] text-wm-accent-strong">{f.category}</span>
                <span className="mx-1">·</span>
                <span className="font-medium">{f.filename}</span>
                <span className="text-wm-text-subtle ml-1">({f.mime_type ?? 'unknown'})</span>
                <p className="text-[11px] text-wm-danger mt-0.5">{f.error}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-wm-text-muted mt-2 italic">
            Fix or replace these files in the Intake page, then try again. Stage 1 needs every available source.
          </p>
        </div>
      )}
    </div>
  )
}
