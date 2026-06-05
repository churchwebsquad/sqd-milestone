/**
 * Voice pass (Stage 7) rewrite manifest preview.
 *
 * The model emits ~50-100 per-slot rewrites with old/new values + a
 * rationale + a voice_alignment_score per item, plus a skipped[]
 * array explaining why other slots were left alone. Without this
 * preview the strategist has to either trust the count blindly
 * before clicking "Apply N rewrites" or read raw JSON.
 *
 * Layout:
 *   - Top summary: rewrites count · skipped count · grouped by reason
 *   - Per-page expandable groups, each showing rewrites + section_id
 *     references resolved against the project's bound web_sections so
 *     the strategist sees "Home · home-hero · description" not
 *     a bare UUID
 *   - Each rewrite row has the rationale + alignment score + an
 *     old/new diff (line-by-line strikethrough/highlight when the
 *     diff is short; full both-shown layout when long)
 *   - Skipped section at the bottom grouped by reason
 *
 * The data needs to be resolved against web_sections + web_pages to
 * label rewrites by page slug + section position. We do that inside
 * the component with a useEffect fetch so the parent doesn't need to
 * know.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../../../lib/supabase'

interface Rewrite {
  field_key:             string
  old_value:             string
  new_value:             string
  rationale:             string
  web_section_id:        string
  voice_alignment_score: number
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

export function VoicePassPreview({ output }: { output: Record<string, unknown> }) {
  const data = output as VoicePassData
  const rewrites = data.rewrites ?? []
  const skipped  = data.skipped  ?? []
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
      // Pull the sections, then their pages. Two-step query because
      // Supabase doesn't compose joins from this client cleanly.
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
        // Best-effort section label: prefer field_values.heading, fall
        // back to section_id if present in field_values, else null.
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
    const groups = new Map<string, { name: string; rewrites: Rewrite[] }>()
    for (const r of rewrites) {
      const meta = sections.get(r.web_section_id)
      const key  = meta?.slug ?? '__unresolved__'
      const name = meta?.page_name ?? 'Unresolved'
      if (!groups.has(key)) groups.set(key, { name, rewrites: [] })
      groups.get(key)!.rewrites.push(r)
    }
    // Stable order: by page name
    return Array.from(groups.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name))
  }, [rewrites, sections])

  const skipByReason = useMemo(() => {
    const m = new Map<string, SkipRow[]>()
    for (const s of skipped) {
      const k = s.reason ?? 'unknown'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b.length - a.length)
  }, [skipped])

  return (
    <div className="space-y-5">
      <SummaryBar rewrites={rewrites.length} skipped={skipped.length} pages={byPage.length} />

      {byPage.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
            Rewrites by page
          </p>
          {byPage.map(([slug, group]) => (
            <PageGroup key={slug} slug={slug} name={group.name} rewrites={group.rewrites} sections={sections} />
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

function SummaryBar({ rewrites, skipped, pages }: { rewrites: number; skipped: number; pages: number }) {
  return (
    <div className="rounded-md border-2 border-wm-accent/40 bg-wm-accent-tint/30 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-4 text-[12px]">
        <span className="text-wm-text">
          <strong className="text-base">{rewrites}</strong> rewrites proposed
        </span>
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text-muted">{pages} page{pages === 1 ? '' : 's'} affected</span>
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text-muted">{skipped} skipped</span>
      </div>
      <p className="text-[11px] text-wm-text-muted mt-1 leading-snug">
        Each rewrite touches one slot in one bound web_section. Click <em>Apply N rewrites</em>
        in the header to write all of these into <code className="text-[10px]">web_sections.field_values</code> —
        fields with <code className="text-[10px]">field_provenance=&apos;override&apos;</code> are protected and skip.
      </p>
    </div>
  )
}

function PageGroup({ slug, name, rewrites, sections }: {
  slug: string
  name: string
  rewrites: Rewrite[]
  sections: Map<string, SectionMeta>
}) {
  const [open, setOpen] = useState(true)
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
          {rewrites.length} rewrite{rewrites.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-2 border-t border-wm-border bg-wm-bg/20">
          {rewrites
            .slice()
            .sort((a, b) => (sections.get(a.web_section_id)?.sort_order ?? 0) - (sections.get(b.web_section_id)?.sort_order ?? 0))
            .map((r, i) => (
              <RewriteRow key={`${r.web_section_id}-${r.field_key}-${i}`} rewrite={r} meta={sections.get(r.web_section_id)} />
            ))}
        </ul>
      )}
    </div>
  )
}

function RewriteRow({ rewrite, meta }: { rewrite: Rewrite; meta: SectionMeta | undefined }) {
  const score = rewrite.voice_alignment_score ?? 0
  const scoreTone =
    score >= 0.85 ? 'success' :
    score >= 0.7  ? 'accent'  :
    score >= 0.55 ? 'warning' :
    'danger'
  return (
    <li className="rounded-md border border-wm-border bg-wm-bg-elevated p-2.5">
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
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-success mb-0.5">After</p>
          <p className="text-[12px] text-wm-text leading-relaxed whitespace-pre-wrap">{rewrite.new_value || <span className="italic text-wm-text-subtle">(empty)</span>}</p>
        </div>
      </div>

      {/* Rationale */}
      {rewrite.rationale && (
        <p className="text-[11px] text-wm-text-muted leading-snug mt-1.5">
          <span className="text-wm-text-subtle">Why:</span> {rewrite.rationale}
        </p>
      )}
    </li>
  )
}
