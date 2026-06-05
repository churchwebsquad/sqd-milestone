/**
 * Human-readable view of Stage 2.5 (sitemap coverage audit) output.
 *
 * Shows: overall coverage score + recommendation banner, the prioritized
 * gaps panel (the strategist's punch list before approving Stage 2),
 * and the full per-topic audit table.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

interface Audit {
  topic_key?:        string
  topic_label?:      string
  topic_group?:      string
  atom_count?:       number
  fact_count?:       number
  crawl_passages?:   number
  crawl_coverage?:   string | null
  importance?:       'high' | 'medium' | 'low'
  destination_kind?: 'dedicated_page' | 'anchored_section' | 'nav_only' | 'orphan' | 'intentional_omission'
  destination_slug?:   string | null
  destination_anchor?: string | null
  nav_reference?:    'header' | 'footer' | 'in_page_grid' | 'breadcrumb_from_related' | 'none'
  findable_score?:   number
  rationale?:        string
}

interface Gap {
  topic_key?:     string
  topic_label?:   string
  importance?:    'high' | 'medium' | 'low'
  why_a_gap?:     string
  suggested_fix?: string
}

interface Summary {
  total_topics?:           number
  dedicated_pages?:        number
  anchored_sections?:      number
  nav_only?:               number
  orphans?:                number
  intentional_omissions?:  number
  gaps_count?:             number
  average_findable_score?: number
  overall_coverage_score?: number
}

interface IdentityAuditRow {
  kind?:              'x_factor' | 'project_goal' | 'persona_need'
  label?:             string
  source_quote?:      string
  destination_kind?:  'dedicated_page' | 'anchored_section' | 'hero_position' | 'unsupported'
  destination_slug?:  string | null
  destination_anchor?: string | null
  findable_score?:    number
  rationale?:         string
}

interface IdentityGap {
  kind?:          'x_factor' | 'project_goal' | 'persona_need'
  label?:         string
  source_quote?:  string
  why_a_gap?:     string
  suggested_fix?: string
}

interface VoiceAuditRow {
  nav_path?:        string
  current_label?:   string
  suggested_label?: string
  issue?:           'banned_term' | 'vocabulary_mismatch' | 'generic_when_owned'
                  | 'insider_term' | 'inward_pointing'
  source_quote?:    string
  severity?:        'high' | 'medium' | 'low'
}

interface GroupingAuditRow {
  nav_path?:               string
  parent_label?:           string
  inferred_parent_intent?: string
  children_intents?:       string[]
  issue?:                  'mixed_intent' | 'parent_label_mismatch' | 'thin_group' | 'clean'
  severity?:               'high' | 'medium' | 'low'
  rationale?:              string
  suggested_fix?:          string
}

interface CoverageData {
  topic_audit?:        Audit[]
  summary?:            Summary
  gaps?:               Gap[]
  identity_audit?:     IdentityAuditRow[]
  identity_gaps?:      IdentityGap[]
  grouping_audit?:     GroupingAuditRow[]
  voice_audit?:        VoiceAuditRow[]
  recommended_action?: 'proceed_to_stage_3' | 'redo_stage_2_with_gaps'
}

export function SitemapCoveragePreview({ output }: { output: Record<string, unknown> }) {
  const data           = output as CoverageData
  const audit          = data.topic_audit ?? []
  const gaps           = data.gaps ?? []
  const identityAudit  = data.identity_audit ?? []
  const identityGaps   = data.identity_gaps ?? []
  const groupingAudit  = data.grouping_audit ?? []
  const voiceAudit     = data.voice_audit ?? []
  const summary        = data.summary ?? {}
  const action         = data.recommended_action

  const groupingFlagged = groupingAudit.filter(g => g.severity === 'high' || g.severity === 'medium')

  return (
    <div className="space-y-6">
      <RecommendationBanner action={action} score={summary.overall_coverage_score} />

      <Summary summary={summary} />

      {gaps.length > 0           && <GapsPanel gaps={gaps} />}
      {identityGaps.length > 0   && <IdentityGapsPanel gaps={identityGaps} />}
      {groupingFlagged.length > 0 && <GroupingAuditPanel rows={groupingFlagged} />}
      {voiceAudit.some(v => v.severity === 'high' || v.severity === 'medium') &&
        <VoiceAuditPanel rows={voiceAudit} />}

      {identityAudit.length > 0 && <IdentityAuditTable rows={identityAudit} />}
      <TopicAuditTable audit={audit} />
    </div>
  )
}

function RecommendationBanner({ action, score }: { action?: CoverageData['recommended_action']; score?: number }) {
  const isProceed = action === 'proceed_to_stage_3'
  const pct = typeof score === 'number' ? Math.round(score * 100) : null
  return (
    <div className={[
      'rounded-md border-2 p-3 flex items-start gap-3',
      isProceed ? 'border-wm-success bg-wm-success-bg' : 'border-wm-warning bg-wm-warning-bg',
    ].join(' ')}>
      {isProceed
        ? <CheckCircle2 size={20} className="shrink-0 mt-0.5 text-wm-success" />
        : <AlertTriangle size={20} className="shrink-0 mt-0.5 text-wm-warning" />}
      <div>
        <p className="text-[13px] font-semibold text-wm-text">
          {isProceed ? 'Coverage looks good — clear to proceed to Stage 3.' : 'Coverage gaps detected — redo Stage 2 recommended.'}
        </p>
        {pct != null && (
          <p className="text-[12px] text-wm-text-muted mt-0.5">
            Overall coverage score: <strong>{pct}%</strong>
          </p>
        )}
      </div>
    </div>
  )
}

function Summary({ summary }: { summary: Summary }) {
  const stats = [
    { label: 'Total topics',         value: summary.total_topics },
    { label: 'Dedicated pages',      value: summary.dedicated_pages,        tone: 'success' as const },
    { label: 'Anchored sections',    value: summary.anchored_sections,      tone: 'accent'  as const },
    { label: 'Nav only',             value: summary.nav_only,               tone: 'muted'   as const },
    { label: 'Orphans',              value: summary.orphans,                tone: summary.orphans && summary.orphans > 0 ? 'warning' as const : 'muted' as const },
    { label: 'Intentional omissions', value: summary.intentional_omissions, tone: 'muted'   as const },
    { label: 'Gaps',                 value: summary.gaps_count,             tone: summary.gaps_count && summary.gaps_count > 0 ? 'warning' as const : 'success' as const },
  ]
  return (
    <Section label="Summary">
      <div className="flex gap-2 flex-wrap">
        {stats.filter(s => s.value != null).map(s => (
          <div key={s.label} className={[
            'rounded-md border bg-wm-bg/40 px-3 py-2',
            s.tone === 'success' ? 'border-wm-success/30' :
            s.tone === 'warning' ? 'border-wm-warning/40' :
            s.tone === 'accent'  ? 'border-wm-accent/40'  :
            'border-wm-border',
          ].join(' ')}>
            <p className={[
              'text-xl font-semibold leading-none',
              s.tone === 'success' ? 'text-wm-success' :
              s.tone === 'warning' ? 'text-wm-warning' :
              s.tone === 'accent'  ? 'text-wm-accent-strong' :
              'text-wm-text',
            ].join(' ')}>{s.value}</p>
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

function GapsPanel({ gaps }: { gaps: Gap[] }) {
  return (
    <Section label={`Gaps to fix (${gaps.length})`}>
      <ul className="space-y-2">
        {gaps.map((g, i) => (
          <li key={i} className="rounded-md border border-wm-warning/30 bg-wm-warning-bg/40 px-3 py-2">
            <div className="flex items-baseline gap-2 mb-1 flex-wrap">
              <span className="text-[12px] font-semibold text-wm-text">{g.topic_label ?? g.topic_key ?? '—'}</span>
              {g.importance && <ImportanceTag importance={g.importance} />}
            </div>
            {g.why_a_gap && (
              <p className="text-[12px] text-wm-text leading-relaxed">
                <span className="text-wm-text-subtle">Why:</span> {g.why_a_gap}
              </p>
            )}
            {g.suggested_fix && (
              <p className="text-[12px] text-wm-text leading-relaxed mt-1">
                <span className="text-wm-text-subtle">Suggested fix:</span> {g.suggested_fix}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function IdentityGapsPanel({ gaps }: { gaps: IdentityGap[] }) {
  return (
    <Section label={`Identity gaps — Stage 1 outputs not addressed (${gaps.length})`}>
      <ul className="space-y-2">
        {gaps.map((g, i) => (
          <li key={i} className="rounded-md border border-wm-accent/40 bg-wm-accent-tint/40 px-3 py-2">
            <div className="flex items-baseline gap-2 mb-1 flex-wrap">
              <KindTag kind={g.kind} />
              <span className="text-[12px] font-semibold text-wm-text">{g.label ?? '—'}</span>
            </div>
            {g.source_quote && (
              <p className="text-[11px] text-wm-text-muted italic mt-1 leading-relaxed">
                <span className="text-wm-text-subtle">Source:</span> &ldquo;{g.source_quote}&rdquo;
              </p>
            )}
            {g.why_a_gap && (
              <p className="text-[12px] text-wm-text leading-relaxed mt-1">
                <span className="text-wm-text-subtle">Why:</span> {g.why_a_gap}
              </p>
            )}
            {g.suggested_fix && (
              <p className="text-[12px] text-wm-text leading-relaxed mt-1">
                <span className="text-wm-text-subtle">Suggested fix:</span> {g.suggested_fix}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function GroupingAuditPanel({ rows }: { rows: GroupingAuditRow[] }) {
  const high   = rows.filter(r => r.severity === 'high')
  const medium = rows.filter(r => r.severity === 'medium')
  return (
    <Section label={`Grouping audit — dropdown intent matches (${rows.length})`}>
      {high.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-danger mb-1.5">
            High severity ({high.length})
          </p>
          <ul className="space-y-2">{high.map((r, i) => <GroupingRow key={`h-${i}`} row={r} tone="danger" />)}</ul>
        </div>
      )}
      {medium.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-1.5">
            Medium severity ({medium.length})
          </p>
          <ul className="space-y-2">{medium.map((r, i) => <GroupingRow key={`m-${i}`} row={r} tone="warning" />)}</ul>
        </div>
      )}
    </Section>
  )
}

function GroupingRow({ row, tone }: { row: GroupingAuditRow; tone: 'danger' | 'warning' }) {
  return (
    <li className={[
      'rounded-md border px-3 py-2',
      tone === 'danger'  ? 'border-wm-danger/30 bg-wm-danger-bg/40' :
                           'border-wm-warning/30 bg-wm-warning-bg/40',
    ].join(' ')}>
      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
        <span className="text-[10px] font-mono text-wm-text-subtle">{row.nav_path}</span>
        <span className="text-[12px] font-semibold text-wm-text">&ldquo;{row.parent_label}&rdquo;</span>
        {row.issue && <Tag tone={tone === 'danger' ? 'warning' : 'muted'}>{row.issue.replace(/_/g,' ')}</Tag>}
        {row.inferred_parent_intent && (
          <Tag tone="muted">parent: {row.inferred_parent_intent.replace(/_/g,' ')}</Tag>
        )}
      </div>
      {row.children_intents && row.children_intents.length > 0 && (
        <p className="text-[11px] text-wm-text-muted leading-snug">
          <span className="text-wm-text-subtle">Children:</span>{' '}
          {row.children_intents.map(c => c.replace(/_/g,' ')).join(' · ')}
        </p>
      )}
      {row.rationale && (
        <p className="text-[12px] text-wm-text leading-relaxed mt-1">
          <span className="text-wm-text-subtle">Why:</span> {row.rationale}
        </p>
      )}
      {row.suggested_fix && (
        <p className="text-[12px] text-wm-text leading-relaxed mt-1">
          <span className="text-wm-text-subtle">Suggested fix:</span> {row.suggested_fix}
        </p>
      )}
    </li>
  )
}

function VoiceAuditPanel({ rows }: { rows: VoiceAuditRow[] }) {
  const high   = rows.filter(r => r.severity === 'high')
  const medium = rows.filter(r => r.severity === 'medium')
  const low    = rows.filter(r => r.severity === 'low')
  return (
    <Section label={`Voice audit — nav labels vs church vocabulary (${rows.length})`}>
      {high.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-danger mb-1.5">
            High severity ({high.length})
          </p>
          <ul className="space-y-2">{high.map((r, i) => <VoiceRow key={`h-${i}`} row={r} tone="danger" />)}</ul>
        </div>
      )}
      {medium.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-1.5">
            Medium severity ({medium.length})
          </p>
          <ul className="space-y-2">{medium.map((r, i) => <VoiceRow key={`m-${i}`} row={r} tone="warning" />)}</ul>
        </div>
      )}
      {low.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
            Low severity ({low.length})
          </p>
          <ul className="space-y-2">{low.map((r, i) => <VoiceRow key={`l-${i}`} row={r} tone="muted" />)}</ul>
        </div>
      )}
    </Section>
  )
}

function VoiceRow({ row, tone }: { row: VoiceAuditRow; tone: 'danger' | 'warning' | 'muted' }) {
  return (
    <li className={[
      'rounded-md border px-3 py-2',
      tone === 'danger'  ? 'border-wm-danger/30 bg-wm-danger-bg/40' :
      tone === 'warning' ? 'border-wm-warning/30 bg-wm-warning-bg/40' :
                           'border-wm-border bg-wm-bg/40',
    ].join(' ')}>
      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
        <span className="text-[10px] font-mono text-wm-text-subtle">{row.nav_path}</span>
        <span className="text-[12px] text-wm-text">
          <span className="line-through opacity-70">&ldquo;{row.current_label}&rdquo;</span>
          <span className="mx-1 text-wm-text-subtle">→</span>
          <span className="font-semibold">&ldquo;{row.suggested_label}&rdquo;</span>
        </span>
        {row.issue && <Tag tone={tone === 'danger' ? 'warning' : 'muted'}>{row.issue.replace(/_/g,' ')}</Tag>}
      </div>
      {row.source_quote && (
        <p className="text-[11px] text-wm-text-muted italic leading-snug">
          &ldquo;{row.source_quote}&rdquo;
        </p>
      )}
    </li>
  )
}

function IdentityAuditTable({ rows }: { rows: IdentityAuditRow[] }) {
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (a.findable_score ?? 1) - (b.findable_score ?? 1))
  }, [rows])
  return (
    <Section label={`Strategic identity audit (${rows.length})`}>
      <div className="space-y-1.5">
        {sorted.map((r, i) => <IdentityRow key={i} row={r} />)}
      </div>
    </Section>
  )
}

function IdentityRow({ row }: { row: IdentityAuditRow }) {
  const [open, setOpen] = useState(false)
  const score = row.findable_score ?? 0
  const scoreTone =
    score >= 0.8 ? 'success' :
    score >= 0.6 ? 'accent'  :
    score >= 0.4 ? 'warning' :
    'danger'
  const hasDetail = !!(row.rationale || row.source_quote)
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg/40">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(o => !o)}
        className={['w-full px-2.5 py-1.5 flex items-baseline gap-2 text-left',
                    hasDetail ? 'hover:bg-wm-bg-hover' : 'cursor-default'].join(' ')}
      >
        {hasDetail
          ? (open ? <ChevronDown size={11} className="shrink-0 text-wm-text-muted self-center" />
                  : <ChevronRight size={11} className="shrink-0 text-wm-text-muted self-center" />)
          : <span className="shrink-0 w-3" />}
        <KindTag kind={row.kind} />
        <span className="text-[12px] font-semibold text-wm-text truncate">{row.label ?? '—'}</span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <DestinationTag
            kind={row.destination_kind === 'hero_position' ? 'anchored_section' : (row.destination_kind as any)}
            slug={row.destination_slug}
            anchor={row.destination_anchor}
          />
          <ScoreBadge score={score} tone={scoreTone} />
        </span>
      </button>
      {hasDetail && open && (
        <div className="px-2.5 pb-2 pt-1 pl-8 space-y-1 border-t border-wm-border bg-wm-bg/20">
          {row.source_quote && (
            <p className="text-[11px] text-wm-text-muted italic leading-relaxed">
              <span className="text-wm-text-subtle">Source:</span> &ldquo;{row.source_quote}&rdquo;
            </p>
          )}
          {row.rationale && (
            <p className="text-[11px] text-wm-text leading-relaxed">
              <span className="text-wm-text-subtle">Rationale:</span> {row.rationale}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function KindTag({ kind }: { kind?: 'x_factor' | 'project_goal' | 'persona_need' }) {
  if (!kind) return null
  const label =
    kind === 'x_factor'     ? 'x-factor'   :
    kind === 'project_goal' ? 'goal'       :
    kind === 'persona_need' ? 'persona'    :
    kind
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30">
      {label}
    </span>
  )
}

function TopicAuditTable({ audit }: { audit: Audit[] }) {
  // Sort by: low findable_score first within high importance, then by importance.
  const sorted = useMemo(() => {
    const impRank = { high: 0, medium: 1, low: 2 } as Record<string, number>
    return [...audit].sort((a, b) => {
      const ai = impRank[a.importance ?? 'low'] ?? 2
      const bi = impRank[b.importance ?? 'low'] ?? 2
      if (ai !== bi) return ai - bi
      return (a.findable_score ?? 1) - (b.findable_score ?? 1)
    })
  }, [audit])

  return (
    <Section label={`Per-topic audit (${audit.length})`}>
      <div className="space-y-1.5">
        {sorted.map((a, i) => <TopicRow key={a.topic_key ?? i} a={a} />)}
      </div>
    </Section>
  )
}

function TopicRow({ a }: { a: Audit }) {
  const [open, setOpen] = useState(false)
  const score = a.findable_score ?? 0
  const scoreTone =
    score >= 0.8 ? 'success' :
    score >= 0.6 ? 'accent'  :
    score >= 0.4 ? 'warning' :
    'danger'
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-2.5 py-1.5 flex items-baseline gap-2 text-left hover:bg-wm-bg-hover"
      >
        {open
          ? <ChevronDown size={11} className="shrink-0 text-wm-text-muted self-center" />
          : <ChevronRight size={11} className="shrink-0 text-wm-text-muted self-center" />}
        <span className="text-[12px] font-semibold text-wm-text truncate">{a.topic_label ?? a.topic_key ?? '—'}</span>
        {a.importance && <ImportanceTag importance={a.importance} />}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <DestinationTag kind={a.destination_kind} slug={a.destination_slug} anchor={a.destination_anchor} />
          <NavTag reference={a.nav_reference} />
          <ScoreBadge score={score} tone={scoreTone} />
        </span>
      </button>
      {open && (
        <div className="px-2.5 pb-2 pt-1 pl-8 space-y-1 border-t border-wm-border bg-wm-bg/20">
          <p className="text-[11px] text-wm-text leading-relaxed">
            <span className="text-wm-text-subtle">Rationale:</span> {a.rationale ?? '—'}
          </p>
          <p className="text-[11px] text-wm-text-muted">
            <span className="text-wm-text-subtle">Atoms:</span> {a.atom_count ?? 0}
            {a.fact_count != null && <> · <span className="text-wm-text-subtle">Facts:</span> {a.fact_count}</>}
            {a.crawl_passages != null && <> · <span className="text-wm-text-subtle">Crawl passages:</span> {a.crawl_passages}</>}
            {a.crawl_coverage && <> · <span className="text-wm-text-subtle">Crawl coverage:</span> {a.crawl_coverage}</>}
          </p>
        </div>
      )}
    </div>
  )
}

function ImportanceTag({ importance }: { importance: 'high' | 'medium' | 'low' }) {
  return (
    <span className={[
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono',
      importance === 'high'   ? 'bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30' :
      importance === 'medium' ? 'bg-wm-bg-hover text-wm-text-muted border border-wm-border' :
                                'bg-wm-bg-hover text-wm-text-subtle border border-wm-border',
    ].join(' ')}>
      {importance}
    </span>
  )
}

function DestinationTag({ kind, slug, anchor }: { kind?: Audit['destination_kind']; slug?: string | null; anchor?: string | null }) {
  if (!kind) return null
  const label = (() => {
    if (kind === 'dedicated_page')        return slug ? `/${slug}` : 'page'
    if (kind === 'anchored_section')      return `/${slug ?? '?'}#${anchor ?? '?'}`
    if (kind === 'nav_only')              return 'nav only'
    if (kind === 'orphan')                return 'orphan'
    if (kind === 'intentional_omission')  return 'omitted'
    return kind
  })()
  const tone =
    kind === 'orphan' ? 'warning' :
    kind === 'dedicated_page' ? 'accent' :
    'muted'
  return (
    <span className={[
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono max-w-[180px] truncate',
      tone === 'warning' ? 'bg-wm-warning/10 text-wm-warning border border-wm-warning/30' :
      tone === 'accent'  ? 'bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30' :
                           'bg-wm-bg-hover text-wm-text-muted border border-wm-border',
    ].join(' ')} title={label}>
      {label}
    </span>
  )
}

function NavTag({ reference }: { reference?: Audit['nav_reference'] }) {
  if (!reference) return null
  const label =
    reference === 'header'                   ? 'header' :
    reference === 'footer'                   ? 'footer' :
    reference === 'in_page_grid'             ? 'grid'   :
    reference === 'breadcrumb_from_related'  ? 'breadcrumb' :
    'no nav'
  const isMissing = reference === 'none'
  return (
    <span className={[
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono',
      isMissing ? 'bg-wm-warning/10 text-wm-warning border border-wm-warning/30'
                : 'bg-wm-bg-hover text-wm-text-muted border border-wm-border',
    ].join(' ')}>
      {label}
    </span>
  )
}

function ScoreBadge({ score, tone }: { score: number; tone: 'success' | 'accent' | 'warning' | 'danger' }) {
  return (
    <span className={[
      'inline-flex items-center w-10 justify-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tabular-nums',
      tone === 'success' ? 'bg-wm-success-bg text-wm-success border border-wm-success/30' :
      tone === 'accent'  ? 'bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30' :
      tone === 'warning' ? 'bg-wm-warning/10 text-wm-warning border border-wm-warning/30' :
                           'bg-wm-danger-bg text-wm-danger border border-wm-danger/30',
    ].join(' ')}>
      {(score * 100).toFixed(0)}
    </span>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2 pb-1.5 border-b border-wm-border">
        {label}
      </p>
      {children}
    </section>
  )
}

// re-exporting unused icon to avoid lint
void AlertCircle
