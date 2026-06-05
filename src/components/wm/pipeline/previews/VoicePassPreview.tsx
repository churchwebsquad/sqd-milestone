/**
 * Voice pass (Stage 7) rewrite manifest preview.
 *
 * The model emits ~50-100 per-slot rewrites with old/new values + a
 * rationale + a voice_alignment_score per item, plus a skipped[]
 * array explaining why other slots were left alone.
 *
 * Per-rewrite controls (when onUpdateRewrite is provided):
 *   • Omit — flag this rewrite as `omitted: true`; the apply step
 *     skips it (the original copy survives).
 *   • Edit — open an inline textarea seeded with the model's
 *     new_value; saves to `user_value` and the apply step uses
 *     user_value in place of new_value.
 *   • Reset — clears any omit + user_value, returning the row to
 *     pure model output.
 *   • Whole-stage revision is handled by the drawer's Refine button.
 *
 * Layout:
 *   - Top summary: active / omitted / overridden counts
 *   - Per-page expandable groups, each showing rewrites + section_id
 *     references resolved against the project's bound web_sections
 *   - Each rewrite row: rationale + alignment score + old/new diff
 *     (and, when overridden, user's variation as a third panel) +
 *     row-level Omit/Edit controls
 *   - Skipped section at the bottom grouped by reason
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, X, Pencil, RotateCcw, Loader2, Check } from 'lucide-react'
import { supabase } from '../../../../lib/supabase'

interface Rewrite {
  field_key:             string
  old_value:             string
  new_value:             string
  rationale:             string
  web_section_id:        string
  voice_alignment_score: number
  /** Strategist set this to true to omit this rewrite from the apply
   *  step. The pre-rewrite value survives untouched. */
  omitted?:              boolean
  /** Strategist's hand-edited override of new_value. When set + non-
   *  empty, the apply step uses this string instead of new_value. */
  user_value?:           string
}

interface SkipRow {
  field_key:      string
  web_section_id: string
  reason:         'already_on_voice' | 'override_locked' | 'over_budget_after_rewrite' | 'structured_slot_not_supported' | string
}

interface VoicePassData {
  rewrites?: Rewrite[]
  skipped?:  SkipRow[]
}

interface SectionMeta {
  id:        string
  slug:      string         // page slug
  page_name: string
  sort_order: number
  // best-effort short label for the section, e.g. heading text
  section_label: string | null
}

/** Threaded down through PreviewDrawer from PipelineWorkspace. Lets
 *  each row mutate roadmap_state.stage_7.rewrites[index]. Optional —
 *  when undefined the rows render in read-only mode. */
type UpdateRewrite = (
  index: number,
  patch: Partial<{ omitted: boolean | undefined; user_value: string | undefined }>,
) => Promise<void>

export function VoicePassPreview({ output, onUpdateRewrite }: {
  output: Record<string, unknown>
  onUpdateRewrite?: UpdateRewrite
}) {
  const data = output as VoicePassData
  const rewrites = data.rewrites ?? []
  const skipped  = data.skipped  ?? []

  // Stable per-rewrite indexing — we need each row to know its index
  // in the canonical rewrites[] array so updates target the right
  // slot. We index BEFORE grouping/sorting so any reordering in the
  // UI doesn't drift the index away from the persisted manifest.
  const indexed = useMemo(() => rewrites.map((r, i) => ({ ...r, _index: i })), [rewrites])

  const sectionIds = useMemo(() => {
    const set = new Set<string>()
    for (const r of rewrites) set.add(r.web_section_id)
    for (const s of skipped)  set.add(s.web_section_id)
    return Array.from(set)
  }, [rewrites, skipped])

  // Resolve section IDs → page slug + section label so the manifest
  // reads as "Home · home-hero · description" not a UUID.
  const [sections, setSections] = useState<Map<string, SectionMeta>>(new Map())
  useEffect(() => {
    if (sectionIds.length === 0) return
    let cancelled = false
    void (async () => {
      const { data: secs } = await supabase
        .from('web_sections')
        .select('id, web_page_id, sort_order, field_values')
        .in('id', sectionIds)
      if (cancelled || !secs) return
      const pageIds = Array.from(new Set((secs as any[]).map(s => s.web_page_id)))
      const { data: pages } = await supabase
        .from('web_pages')
        .select('id, slug, name')
        .in('id', pageIds)
      if (cancelled) return
      const pagesById = new Map<string, { slug: string; name: string }>()
      for (const p of (pages ?? []) as any[]) pagesById.set(p.id, { slug: p.slug, name: p.name })
      const map = new Map<string, SectionMeta>()
      for (const s of secs as any[]) {
        const page = pagesById.get(s.web_page_id)
        if (!page) continue
        const fv = (s.field_values ?? {}) as Record<string, unknown>
        const heading = typeof fv.heading === 'string' ? fv.heading : null
        const tagline = typeof fv.tagline === 'string' ? fv.tagline : null
        const label = (heading?.slice(0, 60) ?? tagline?.slice(0, 60)) || null
        map.set(s.id, {
          id:            s.id,
          slug:          page.slug,
          page_name:     page.name,
          sort_order:    s.sort_order ?? 0,
          section_label: label,
        })
      }
      setSections(map)
    })()
    return () => { cancelled = true }
  }, [sectionIds])

  // Group rewrites by page slug, sort each page's rewrites by section sort_order
  const byPage = useMemo(() => {
    const groups = new Map<string, { name: string; rewrites: Array<Rewrite & { _index: number }> }>()
    for (const r of indexed) {
      const meta = sections.get(r.web_section_id)
      const key  = meta?.slug ?? '__unresolved__'
      const name = meta?.page_name ?? 'Unresolved'
      if (!groups.has(key)) groups.set(key, { name, rewrites: [] })
      groups.get(key)!.rewrites.push(r)
    }
    return Array.from(groups.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name))
  }, [indexed, sections])

  const skipByReason = useMemo(() => {
    const m = new Map<string, SkipRow[]>()
    for (const s of skipped) {
      const k = s.reason ?? 'unknown'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b.length - a.length)
  }, [skipped])

  const activeCount     = rewrites.filter(r => r.omitted !== true).length
  const omittedCount    = rewrites.length - activeCount
  const overriddenCount = rewrites.filter(r => typeof r.user_value === 'string' && r.user_value.length > 0).length

  return (
    <div className="space-y-5">
      <SummaryBar
        active={activeCount}
        omitted={omittedCount}
        overridden={overriddenCount}
        skipped={skipped.length}
        pages={byPage.length}
        readOnly={!onUpdateRewrite}
      />

      {byPage.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
            Rewrites by page
          </p>
          {byPage.map(([slug, group]) => (
            <PageGroup
              key={slug}
              slug={slug}
              name={group.name}
              rewrites={group.rewrites}
              sections={sections}
              onUpdateRewrite={onUpdateRewrite}
            />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-wm-text-muted italic">No rewrites in this manifest.</p>
      )}

      {skipByReason.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Skipped ({skipped.length})
          </p>
          <div className="rounded-md border border-wm-border bg-wm-bg/40 p-3 space-y-2">
            {skipByReason.map(([reason, rows]) => (
              <div key={reason} className="flex items-baseline gap-2">
                <span className="text-[11px] font-mono text-wm-text">{reason.replace(/_/g, ' ')}</span>
                <span className="text-[11px] text-wm-text-muted">· {rows.length}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryBar({ active, omitted, overridden, skipped, pages, readOnly }: {
  active: number; omitted: number; overridden: number; skipped: number; pages: number; readOnly: boolean
}) {
  return (
    <div className="rounded-md border-2 border-wm-accent/40 bg-wm-accent-tint/30 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
        <span className="text-wm-text">
          <strong className="text-base">{active}</strong> active rewrite{active === 1 ? '' : 's'}
        </span>
        {omitted > 0 && (
          <>
            <span className="text-wm-text-muted">·</span>
            <span className="text-wm-text-muted"><strong className="text-wm-text">{omitted}</strong> omitted</span>
          </>
        )}
        {overridden > 0 && (
          <>
            <span className="text-wm-text-muted">·</span>
            <span className="text-wm-text-muted"><strong className="text-wm-text">{overridden}</strong> with your edits</span>
          </>
        )}
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text-muted">{pages} page{pages === 1 ? '' : 's'} affected</span>
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text-muted">{skipped} skipped by model</span>
      </div>
      <p className="text-[11px] text-wm-text-muted mt-1 leading-snug">
        {readOnly
          ? <>This is a read-only view. Each rewrite touches one slot in one bound web_section.</>
          : <><strong>Omit</strong> a rewrite to drop it from the batch (the original copy stays).
              <strong> Edit</strong> to type your own variation in place of the model&rsquo;s.
              <strong> Refine</strong> in the header re-runs the whole pass with new direction.
              Click <em>Apply</em> when ready — omitted rewrites + fields marked
              <code className="text-[10px] mx-0.5">field_provenance=&apos;override&apos;</code>
              are skipped automatically.</>}
      </p>
    </div>
  )
}

function PageGroup({ slug, name, rewrites, sections, onUpdateRewrite }: {
  slug: string
  name: string
  rewrites: Array<Rewrite & { _index: number }>
  sections: Map<string, SectionMeta>
  onUpdateRewrite?: UpdateRewrite
}) {
  const [open, setOpen] = useState(true)
  const activeOnPage = rewrites.filter(r => r.omitted !== true).length
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2 flex items-baseline gap-2 text-left hover:bg-wm-bg-hover"
      >
        {open
          ? <ChevronDown size={11} className="shrink-0 text-wm-text-muted self-center" />
          : <ChevronRight size={11} className="shrink-0 text-wm-text-muted self-center" />}
        <span className="text-[13px] font-semibold text-wm-text">{name}</span>
        <span className="text-[10px] font-mono text-wm-text-subtle">/{slug}</span>
        <span className="ml-auto text-[11px] text-wm-text-muted">
          {activeOnPage === rewrites.length
            ? `${rewrites.length} rewrite${rewrites.length === 1 ? '' : 's'}`
            : `${activeOnPage}/${rewrites.length} active`}
        </span>
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-2 border-t border-wm-border bg-wm-bg/20">
          {rewrites
            .slice()
            .sort((a, b) => (sections.get(a.web_section_id)?.sort_order ?? 0) - (sections.get(b.web_section_id)?.sort_order ?? 0))
            .map(r => (
              <RewriteRow
                key={`${r._index}`}
                rewrite={r}
                index={r._index}
                meta={sections.get(r.web_section_id)}
                onUpdateRewrite={onUpdateRewrite}
              />
            ))}
        </ul>
      )}
    </div>
  )
}

function RewriteRow({ rewrite, index, meta, onUpdateRewrite }: {
  rewrite: Rewrite
  index:   number
  meta:    SectionMeta | undefined
  onUpdateRewrite?: UpdateRewrite
}) {
  const score = rewrite.voice_alignment_score ?? 0
  const scoreTone =
    score >= 0.85 ? 'success' :
    score >= 0.7  ? 'accent'  :
    score >= 0.55 ? 'warning' :
    'danger'
  const omitted    = rewrite.omitted === true
  const overridden = typeof rewrite.user_value === 'string' && rewrite.user_value.length > 0
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(rewrite.user_value ?? rewrite.new_value)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const toggleOmit = async () => {
    if (!onUpdateRewrite || saving) return
    setSaving(true); setError(null)
    try { await onUpdateRewrite(index, { omitted: omitted ? undefined : true }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to update') }
    finally   { setSaving(false) }
  }

  const startEdit = () => {
    setDraft(rewrite.user_value ?? rewrite.new_value)
    setEditing(true); setError(null)
  }

  const saveEdit = async () => {
    if (!onUpdateRewrite || saving) return
    const trimmed = draft.trim()
    // If user typed back the model default, clear the override.
    const next = trimmed === rewrite.new_value.trim() ? undefined : trimmed
    setSaving(true); setError(null)
    try {
      await onUpdateRewrite(index, { user_value: next })
      setEditing(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save') }
    finally   { setSaving(false) }
  }

  const resetRow = async () => {
    if (!onUpdateRewrite || saving) return
    setSaving(true); setError(null)
    try { await onUpdateRewrite(index, { omitted: undefined, user_value: undefined }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to reset') }
    finally   { setSaving(false) }
  }

  return (
    <li className={[
      'rounded-md border p-2.5 transition-opacity',
      omitted ? 'border-wm-border bg-wm-bg/30 opacity-60' : 'border-wm-border bg-wm-bg-elevated',
    ].join(' ')}>
      {/* Section + slot heading */}
      <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
        {meta && (
          <>
            <span className="text-[11px] font-mono text-wm-text-subtle">
              {String((meta.sort_order ?? 0) + 1).padStart(2, '0')}
            </span>
            {meta.section_label && (
              <span className="text-[11px] text-wm-text-muted italic truncate max-w-[260px]">
                &ldquo;{meta.section_label}&rdquo;
              </span>
            )}
          </>
        )}
        <span className="text-[11px] font-mono font-semibold text-wm-accent-strong">
          {rewrite.field_key}
        </span>
        {omitted && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-wm-danger-bg text-wm-danger border border-wm-danger/30">
            Omitted
          </span>
        )}
        {overridden && !omitted && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30">
            Your edit
          </span>
        )}
        <span className={[
          'ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tabular-nums',
          scoreTone === 'success' ? 'bg-wm-success-bg text-wm-success border border-wm-success/30' :
          scoreTone === 'accent'  ? 'bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30' :
          scoreTone === 'warning' ? 'bg-wm-warning/10 text-wm-warning border border-wm-warning/30' :
                                    'bg-wm-danger-bg text-wm-danger border border-wm-danger/30',
        ].join(' ')}>
          {(score * 100).toFixed(0)}
        </span>
      </div>

      {/* Old / new diff */}
      <div className="space-y-1.5">
        <div className="rounded border border-wm-danger/20 bg-wm-danger-bg/30 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-danger mb-0.5">Before</p>
          <p className="text-[12px] text-wm-text leading-relaxed whitespace-pre-wrap">{rewrite.old_value || <span className="italic text-wm-text-subtle">(empty)</span>}</p>
        </div>
        <div className="rounded border border-wm-success/30 bg-wm-success-bg/30 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-success mb-0.5">
            After (model){overridden ? ' — overridden by your edit below' : ''}
          </p>
          <p className="text-[12px] text-wm-text leading-relaxed whitespace-pre-wrap">{rewrite.new_value || <span className="italic text-wm-text-subtle">(empty)</span>}</p>
        </div>
        {overridden && rewrite.user_value && (
          <div className="rounded border-2 border-wm-accent/40 bg-wm-accent-tint/40 px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-widest font-bold text-wm-accent-strong mb-0.5">Your variation (will be applied)</p>
            <p className="text-[12px] text-wm-text leading-relaxed whitespace-pre-wrap">{rewrite.user_value}</p>
          </div>
        )}
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="mt-2 rounded border border-wm-accent/40 bg-wm-accent-tint/30 p-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
            Type your variation
          </p>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={saving}
            rows={4}
            className="w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none disabled:opacity-60"
          />
          <p className="text-[10px] text-wm-text-muted mt-1">
            Save with the model&rsquo;s exact text to clear your override and return to model output.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => { setEditing(false); setError(null) }}
              disabled={saving}
              className="text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving}
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover disabled:opacity-40"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
              Save variation
            </button>
          </div>
        </div>
      )}

      {/* Rationale */}
      {rewrite.rationale && !editing && (
        <p className="text-[11px] text-wm-text-muted leading-snug mt-1.5">
          <span className="text-wm-text-subtle">Why:</span> {rewrite.rationale}
        </p>
      )}

      {/* Row actions */}
      {onUpdateRewrite && !editing && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <button
            type="button"
            onClick={() => void toggleOmit()}
            disabled={saving}
            title={omitted ? 'Restore this rewrite to the active batch' : 'Drop this rewrite — the original copy survives'}
            className={[
              'inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold border disabled:opacity-50',
              omitted
                ? 'border-wm-success/40 text-wm-success bg-wm-success-bg hover:bg-wm-success/10'
                : 'border-wm-danger/40 text-wm-danger bg-wm-bg-elevated hover:bg-wm-danger-bg',
            ].join(' ')}
          >
            {saving
              ? <Loader2 size={10} className="animate-spin" />
              : omitted ? <Check size={10} /> : <X size={10} />}
            {omitted ? 'Restore' : 'Omit'}
          </button>
          <button
            type="button"
            onClick={startEdit}
            disabled={saving || omitted}
            title="Override the model's new_value with your own variation"
            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold border border-wm-border text-wm-text bg-wm-bg-elevated hover:bg-wm-bg-hover disabled:opacity-50"
          >
            <Pencil size={10} />
            {overridden ? 'Edit again' : 'Edit'}
          </button>
          {(overridden || omitted) && (
            <button
              type="button"
              onClick={() => void resetRow()}
              disabled={saving}
              title="Clear your changes — back to pure model output"
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold text-wm-text-muted hover:text-wm-text disabled:opacity-50"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          )}
          {error && (
            <span className="text-[10px] text-wm-danger ml-2">{error}</span>
          )}
        </div>
      )}
    </li>
  )
}
