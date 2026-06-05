/**
 * Per-page review surface.
 *
 * Flips the pipeline view from stage-major (Stage 1 → all pages,
 * Stage 4 → all pages) to page-major (Home → outline + bound copy
 * + voice rewrites + QA findings). Strategist clicks a page and
 * sees the whole lifecycle for that one page collapsed into a
 * single card.
 *
 * Data sources (all read; no writes from this view):
 *  • roadmap_state.stage_2.pages         — sitemap of pages
 *  • roadmap_state.stage_4.page_outlines — section contracts
 *  • web_pages + web_sections            — bound copy in DB
 *  • roadmap_state.stage_7.rewrites      — voice pass output
 *  • roadmap_state.stage_8.findings      — final QA findings
 *
 * The section_id in Stage 4 outlines does NOT match the web_sections.id
 * UUIDs (Stage 4 invents readable ids like "home-hero"; web_sections
 * use real UUIDs assigned at bind time). Right now there's no formal
 * mapping table — we line them up by sort_order within a page. If
 * counts differ the unbound Stage 4 sections are still shown but
 * without bound copy or rewrites.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Target, Megaphone, AlertTriangle, Sparkles } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { StrategyWebProject } from '../../../types/database'

interface Stage2Page  { slug: string; name?: string; nav_label?: string; page_type?: string }
interface Stage4Section {
  section_id?:          string
  section_job?:         string
  content_summary?:     string
  serves_personas?:     string[]
  addresses_goal?:      string | null
  required_messages?:   string[]
  cta?:                 { intent?: string; label?: string; destination_page?: string } | null
  keyword_assignments?: { primary?: string[]; supporting?: string[] } | null
  voice_notes?:         string | null
  atoms_used?:          string[]
}
interface Stage4Page {
  page_slug?:        string
  primary_persona?:  string | null
  page_seo_targets?: {
    search_phrases?:          string[]
    answer_intents?:          string[]
    geo_anchors?:             string[]
    title_target?:            string | null
    meta_description_target?: string | null
  } | null
  sections?:         Stage4Section[]
  voice_notes?:      string | null
}

interface WebSectionRow {
  id:           string
  web_page_id:  string
  sort_order:   number | null
  content_template_id: string | null
  field_values: Record<string, unknown> | null
}
interface WebPageRow {
  id:       string
  slug:     string
  name:     string
  sort_order: number | null
}

interface Stage7Rewrite {
  web_section_id?:        string
  field_key?:             string
  old_value?:             string
  new_value?:             string
  rationale?:             string
  voice_alignment_score?: number
  omitted?:               boolean
  user_value?:            string
}

interface Stage8Finding {
  severity?:       'blocker' | 'warning' | 'nit' | string
  page_slug?:      string | null
  web_section_id?: string | null
  category?:       string
  issue?:          string
  suggested_fix?:  string
}

export function PerPageReview({ project }: { project: StrategyWebProject }) {
  const roadmap = (project.roadmap_state ?? {}) as Record<string, any>
  const stage2Pages: Stage2Page[]   = roadmap.stage_2?.pages ?? []
  const stage4Pages: Stage4Page[]   = roadmap.stage_4?.page_outlines ?? []
  const rewrites:    Stage7Rewrite[] = roadmap.stage_7?.rewrites ?? []
  const findings:    Stage8Finding[] = roadmap.stage_8?.findings ?? []

  const [webPages,    setWebPages]    = useState<WebPageRow[]>([])
  const [webSections, setWebSections] = useState<WebSectionRow[]>([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [pagesRes, sectionsRes] = await Promise.all([
        supabase.from('web_pages')
          .select('id, slug, name, sort_order')
          .eq('web_project_id', project.id).eq('archived', false),
        supabase.from('web_sections')
          .select('id, web_page_id, sort_order, content_template_id, field_values')
          .eq('archived', false),
      ])
      if (cancelled) return
      const pages = (pagesRes.data ?? []) as WebPageRow[]
      const pageIds = new Set(pages.map(p => p.id))
      const sections = ((sectionsRes.data ?? []) as WebSectionRow[]).filter(s => pageIds.has(s.web_page_id))
      setWebPages(pages)
      setWebSections(sections)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [project.id])

  /** Sitemap order — Stage 2 pages drive the list. Anything in
   *  web_pages that ISN'T in Stage 2 (rare; legacy) tacks on at the end. */
  const orderedPages = useMemo(() => {
    const order = new Map(stage2Pages.map((p, i) => [p.slug, i]))
    const stage2Slugs = new Set(stage2Pages.map(p => p.slug))
    const stage2Order: Array<{ slug: string; name: string; bound?: WebPageRow }> = []
    for (const sp of stage2Pages) {
      const bound = webPages.find(wp => wp.slug === sp.slug)
      stage2Order.push({ slug: sp.slug, name: sp.name ?? sp.nav_label ?? sp.slug, bound })
    }
    const extras = webPages
      .filter(wp => !stage2Slugs.has(wp.slug))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(wp => ({ slug: wp.slug, name: wp.name, bound: wp }))
    return [...stage2Order, ...extras]
    // unused, kept for future deep-link order resolution
    void order
  }, [stage2Pages, webPages])

  const [openSlug, setOpenSlug] = useState<string | null>(orderedPages[0]?.slug ?? null)

  if (loading) {
    return <p className="text-[12px] text-wm-text-muted italic p-4">Loading pages…</p>
  }
  if (orderedPages.length === 0) {
    return (
      <p className="text-[12px] text-wm-text-muted italic p-4">
        No sitemap pages yet. Run Stage 2 in the pipeline to draft a sitemap.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {orderedPages.map(p => (
        <PageCard
          key={p.slug}
          slug={p.slug}
          name={p.name}
          open={openSlug === p.slug}
          onToggle={() => setOpenSlug(openSlug === p.slug ? null : p.slug)}
          stage4Page={stage4Pages.find(sp => sp.page_slug === p.slug)}
          webPage={p.bound}
          webSections={webSections}
          rewrites={rewrites}
          findings={findings}
        />
      ))}
    </div>
  )
}

function PageCard({
  slug, name, open, onToggle, stage4Page, webPage, webSections, rewrites, findings,
}: {
  slug: string
  name: string
  open: boolean
  onToggle: () => void
  stage4Page?: Stage4Page
  webPage?: WebPageRow
  webSections: WebSectionRow[]
  rewrites: Stage7Rewrite[]
  findings: Stage8Finding[]
}) {
  const pageSections = webPage
    ? webSections
        .filter(s => s.web_page_id === webPage.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : []
  const pageSectionIds = new Set(pageSections.map(s => s.id))
  const pageRewrites = rewrites.filter(r => r.web_section_id && pageSectionIds.has(r.web_section_id))
  const pageFindings = findings.filter(f =>
    (f.page_slug && f.page_slug === slug) ||
    (f.web_section_id && pageSectionIds.has(f.web_section_id)),
  )

  // Per-section stats for the header summary chip row.
  const outlineSections = stage4Page?.sections ?? []
  const requiredCount = outlineSections.reduce((s, sec) => s + (sec.required_messages?.length ?? 0), 0)
  const ctaCount      = outlineSections.filter(sec => sec.cta).length
  const activeRewrites = pageRewrites.filter(r => r.omitted !== true).length

  return (
    <div className={[
      'rounded-md border bg-wm-bg-elevated',
      open ? 'border-wm-accent/40' : 'border-wm-border',
    ].join(' ')}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-baseline gap-2 text-left hover:bg-wm-bg-hover transition-colors"
      >
        {open
          ? <ChevronDown size={13} className="shrink-0 text-wm-text-muted self-center" />
          : <ChevronRight size={13} className="shrink-0 text-wm-text-muted self-center" />}
        <FileText size={13} className="shrink-0 text-wm-text-subtle self-center" />
        <span className="text-[13px] font-semibold text-wm-text">{name}</span>
        <span className="text-[10px] font-mono text-wm-text-subtle">/{slug}</span>
        <span className="ml-auto inline-flex items-baseline gap-2 text-[10px] font-mono">
          {outlineSections.length > 0 && (
            <span className="text-wm-text-muted">{outlineSections.length} sections</span>
          )}
          {requiredCount > 0 && (
            <span className="text-wm-accent-strong">{requiredCount} req</span>
          )}
          {ctaCount > 0 && (
            <span className="text-wm-text-muted">{ctaCount} CTA</span>
          )}
          {activeRewrites > 0 && (
            <span className="text-wm-success">{activeRewrites} voice</span>
          )}
          {pageFindings.length > 0 && (
            <span className="text-wm-warning">{pageFindings.length} QA</span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-wm-border px-3 py-3 space-y-3 bg-wm-bg/30">
          {/* Page-level meta */}
          <PageMeta stage4Page={stage4Page} />

          {/* Page-wide QA findings (those without a section_id) */}
          {pageFindings.filter(f => !f.web_section_id).length > 0 && (
            <FindingsBlock title="Page-level QA findings" findings={pageFindings.filter(f => !f.web_section_id)} />
          )}

          {/* Sections — combine Stage 4 outlines with bound web_sections.
              Index-aligned: outline[i] paired with bound section[i] by
              sort order. If counts differ, extras render section-only
              or outline-only. */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
              Sections — outline → bound copy → voice → QA
            </p>
            {pairSections(outlineSections, pageSections).map((pair, i) => (
              <SectionRow
                key={`${pair.bound?.id ?? pair.outline?.section_id ?? i}`}
                index={i}
                outline={pair.outline}
                bound={pair.bound}
                rewrites={pair.bound ? pageRewrites.filter(r => r.web_section_id === pair.bound!.id) : []}
                findings={pair.bound ? pageFindings.filter(f => f.web_section_id === pair.bound!.id) : []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function pairSections(
  outlines: Stage4Section[],
  sections: WebSectionRow[],
): Array<{ outline?: Stage4Section; bound?: WebSectionRow }> {
  const maxLen = Math.max(outlines.length, sections.length)
  const out: Array<{ outline?: Stage4Section; bound?: WebSectionRow }> = []
  for (let i = 0; i < maxLen; i++) {
    out.push({ outline: outlines[i], bound: sections[i] })
  }
  return out
}

function PageMeta({ stage4Page }: { stage4Page?: Stage4Page }) {
  if (!stage4Page) return null
  const seo = stage4Page.page_seo_targets
  const hasSeo = seo && (
    seo.title_target ||
    seo.meta_description_target ||
    (seo.search_phrases?.length ?? 0) > 0 ||
    (seo.answer_intents?.length ?? 0) > 0 ||
    (seo.geo_anchors?.length ?? 0) > 0
  )
  if (!stage4Page.primary_persona && !stage4Page.voice_notes && !hasSeo) return null
  return (
    <div className="rounded border border-wm-accent/20 bg-wm-accent-tint/30 px-2.5 py-2 space-y-2">
      {stage4Page.primary_persona && (
        <div>
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-accent-strong">Primary persona</p>
          <p className="text-[12px] text-wm-text">{stage4Page.primary_persona}</p>
        </div>
      )}
      {hasSeo && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1.5">
          {seo!.title_target && (
            <Mini label={`Title (${seo!.title_target.length} chars)`}>{seo!.title_target}</Mini>
          )}
          {seo!.meta_description_target && (
            <Mini label={`Meta (${seo!.meta_description_target.length} chars)`}>{seo!.meta_description_target}</Mini>
          )}
          {(seo!.search_phrases?.length ?? 0) > 0 && (
            <ChipRow label="Search phrases" items={seo!.search_phrases!} tone="accent" />
          )}
          {(seo!.answer_intents?.length ?? 0) > 0 && (
            <ChipRow label="Answer intents" items={seo!.answer_intents!} tone="muted" />
          )}
          {(seo!.geo_anchors?.length ?? 0) > 0 && (
            <ChipRow label="Geo anchors" items={seo!.geo_anchors!} tone="muted" />
          )}
        </div>
      )}
      {stage4Page.voice_notes && (
        <div>
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">Page voice anchors</p>
          <p className="text-[11px] text-wm-text leading-snug">{stage4Page.voice_notes}</p>
        </div>
      )}
    </div>
  )
}

function SectionRow({
  index, outline, bound, rewrites, findings,
}: {
  index:    number
  outline?: Stage4Section
  bound?:   WebSectionRow
  rewrites: Stage7Rewrite[]
  findings: Stage8Finding[]
}) {
  const [expanded, setExpanded] = useState(false)
  const sectionLabel = outline?.section_id
    ?? (bound ? `section-${index + 1}` : `section-${index + 1}`)
  const sectionJob = outline?.section_job
  const requiredCount = outline?.required_messages?.length ?? 0
  const activeRewriteCount = rewrites.filter(r => r.omitted !== true).length
  const findingsCount = findings.length

  return (
    <div className="rounded border border-wm-border bg-wm-bg-elevated">
      <button
        type="button"
        onClick={() => setExpanded(o => !o)}
        className="w-full px-2.5 py-1.5 flex items-baseline gap-2 text-left hover:bg-wm-bg-hover"
      >
        {expanded
          ? <ChevronDown size={11} className="shrink-0 text-wm-text-muted self-center" />
          : <ChevronRight size={11} className="shrink-0 text-wm-text-muted self-center" />}
        <span className="text-[10px] font-mono text-wm-text-subtle tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-[12px] font-mono text-wm-text">{sectionLabel}</span>
        {sectionJob && (
          <span className="text-[11px] text-wm-text-muted italic truncate flex-1 min-w-0">
            {sectionJob}
          </span>
        )}
        <span className="ml-auto inline-flex items-baseline gap-2 text-[10px] font-mono shrink-0">
          {outline?.cta && (
            <span className="inline-flex items-center gap-0.5 text-wm-accent-strong">
              <Megaphone size={9} /> CTA
            </span>
          )}
          {requiredCount > 0 && (
            <span className="text-wm-accent-strong">{requiredCount} req</span>
          )}
          {activeRewriteCount > 0 && (
            <span className="text-wm-success inline-flex items-center gap-0.5">
              <Sparkles size={9} />{activeRewriteCount}
            </span>
          )}
          {findingsCount > 0 && (
            <span className="text-wm-warning inline-flex items-center gap-0.5">
              <AlertTriangle size={9} />{findingsCount}
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-wm-border px-3 py-2 space-y-3 bg-wm-bg/30">
          {/* Contract block (Stage 4) */}
          {outline && <OutlineBlock outline={outline} />}

          {/* Bound copy block (web_sections.field_values) */}
          {bound && <BoundCopyBlock bound={bound} />}

          {/* Voice rewrites block (Stage 7) */}
          {rewrites.length > 0 && <RewritesBlock rewrites={rewrites} />}

          {/* QA findings for this section (Stage 8) */}
          {findings.length > 0 && <FindingsBlock title="Section QA findings" findings={findings} />}

          {!outline && !bound && (
            <p className="text-[11px] text-wm-text-muted italic">
              No outline, no bound copy, no rewrites yet for this section position.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function OutlineBlock({ outline }: { outline: Stage4Section }) {
  const kw = outline.keyword_assignments
  const kwTotal = (kw?.primary?.length ?? 0) + (kw?.supporting?.length ?? 0)
  return (
    <div className="space-y-2">
      <p className="text-[9px] uppercase tracking-widest font-bold text-wm-accent-strong">Outline (Stage 4)</p>
      {outline.serves_personas && outline.serves_personas.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">Serves</p>
          <div className="flex flex-wrap gap-1">
            {outline.serves_personas.map(p => (
              <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-wm-bg-hover text-wm-text border border-wm-border">{p}</span>
            ))}
          </div>
        </div>
      )}
      {outline.addresses_goal && (
        <div>
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5 inline-flex items-center gap-1">
            <Target size={9} /> Advances goal
          </p>
          <p className="text-[11px] text-wm-text leading-snug">{outline.addresses_goal}</p>
        </div>
      )}
      {outline.required_messages && outline.required_messages.length > 0 && (
        <div className="rounded border border-wm-accent/30 bg-wm-accent-tint/30 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
            Required messages ({outline.required_messages.length})
          </p>
          <ol className="space-y-0.5 list-decimal list-inside text-[11px] text-wm-text leading-snug">
            {outline.required_messages.map((m, i) => <li key={i}>{m}</li>)}
          </ol>
        </div>
      )}
      {outline.cta && (
        <div className="rounded border border-wm-success/30 bg-wm-success-bg/30 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-widest font-bold text-wm-success mb-0.5 inline-flex items-center gap-1">
            <Megaphone size={9} /> CTA · {outline.cta.intent}
          </p>
          <p className="text-[11px] text-wm-text">
            <span className="font-semibold">{outline.cta.label}</span>
            {outline.cta.destination_page && (
              <>
                <span className="text-wm-text-muted"> → </span>
                <code className="text-[10px] font-mono text-wm-accent-strong">{outline.cta.destination_page}</code>
              </>
            )}
          </p>
        </div>
      )}
      {kw && kwTotal > 0 && (
        <div className="space-y-1">
          {kw.primary && kw.primary.length > 0 && (
            <ChipRow label="Primary keywords (heading or lead sentence)" items={kw.primary} tone="accent" />
          )}
          {kw.supporting && kw.supporting.length > 0 && (
            <ChipRow label="Supporting keywords (body)" items={kw.supporting} tone="muted" />
          )}
        </div>
      )}
      {outline.content_summary && (
        <details className="text-[11px]">
          <summary className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle cursor-pointer">
            Content summary
          </summary>
          <p className="text-[11px] text-wm-text leading-relaxed whitespace-pre-wrap mt-1">
            {outline.content_summary}
          </p>
        </details>
      )}
    </div>
  )
}

function BoundCopyBlock({ bound }: { bound: WebSectionRow }) {
  const values = (bound.field_values ?? {}) as Record<string, unknown>
  // Surface only top-level string slots for review. Arrays/objects get a
  // count badge — strategist can dig into the page in PagesWorkspace.
  const stringSlots: Array<[string, string]> = []
  const structuredSlots: Array<[string, string]> = []
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string') {
      stringSlots.push([k, v])
    } else if (Array.isArray(v)) {
      structuredSlots.push([k, `array(${v.length})`])
    } else if (v && typeof v === 'object') {
      structuredSlots.push([k, `object(${Object.keys(v).length} keys)`])
    }
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">
        Bound copy <span className="font-mono text-[10px] text-wm-text-subtle">{bound.id.slice(0, 8)}…</span>
      </p>
      {stringSlots.length === 0 && structuredSlots.length === 0 && (
        <p className="text-[11px] text-wm-text-muted italic">No field values bound.</p>
      )}
      {stringSlots.length > 0 && (
        <dl className="space-y-1">
          {stringSlots.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[100px_1fr] gap-2 text-[11px]">
              <dt className="font-mono text-wm-text-subtle truncate">{k}</dt>
              <dd className="text-wm-text leading-snug whitespace-pre-wrap">
                {v || <span className="italic text-wm-text-subtle">(empty)</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {structuredSlots.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {structuredSlots.map(([k, summary]) => (
            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-wm-bg-hover text-wm-text-muted border border-wm-border font-mono">
              {k} · {summary}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function RewritesBlock({ rewrites }: { rewrites: Stage7Rewrite[] }) {
  const active = rewrites.filter(r => r.omitted !== true)
  const omitted = rewrites.length - active.length
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] uppercase tracking-widest font-bold text-wm-success">
        Voice pass · {active.length} active rewrite{active.length === 1 ? '' : 's'}
        {omitted > 0 && <span className="text-wm-text-muted"> · {omitted} omitted</span>}
      </p>
      <ul className="space-y-1.5">
        {rewrites.map((r, i) => {
          const score = r.voice_alignment_score ?? 0
          const overridden = typeof r.user_value === 'string' && r.user_value.length > 0
          const final = overridden ? r.user_value : r.new_value
          return (
            <li key={`${r.field_key}-${i}`}
              className={[
                'rounded border px-2 py-1.5',
                r.omitted ? 'border-wm-border bg-wm-bg/30 opacity-60' : 'border-wm-border bg-wm-bg-elevated',
              ].join(' ')}>
              <div className="flex items-baseline gap-1.5 mb-0.5 flex-wrap">
                <span className="text-[10px] font-mono font-semibold text-wm-accent-strong">
                  {r.field_key}
                </span>
                {r.omitted && (
                  <span className="text-[9px] uppercase tracking-wider font-bold px-1 rounded bg-wm-danger-bg text-wm-danger">
                    omitted
                  </span>
                )}
                {overridden && !r.omitted && (
                  <span className="text-[9px] uppercase tracking-wider font-bold px-1 rounded bg-wm-accent-tint text-wm-accent-strong">
                    your edit
                  </span>
                )}
                <span className="ml-auto text-[9px] font-mono text-wm-text-subtle tabular-nums">
                  {(score * 100).toFixed(0)}
                </span>
              </div>
              <div className="text-[11px] text-wm-text-muted line-through truncate" title={r.old_value ?? ''}>
                {r.old_value}
              </div>
              <div className="text-[11px] text-wm-text leading-snug whitespace-pre-wrap">
                {final}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function FindingsBlock({ title, findings }: { title: string; findings: Stage8Finding[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] uppercase tracking-widest font-bold text-wm-warning inline-flex items-center gap-1">
        <AlertTriangle size={9} /> {title} ({findings.length})
      </p>
      <ul className="space-y-1">
        {findings.map((f, i) => (
          <li key={i} className={[
            'rounded border px-2 py-1.5 text-[11px]',
            f.severity === 'blocker' ? 'border-wm-danger/40 bg-wm-danger-bg/30' :
            f.severity === 'warning' ? 'border-wm-warning/40 bg-wm-warning/10' :
                                       'border-wm-border bg-wm-bg/40',
          ].join(' ')}>
            <p className="text-wm-text leading-snug">
              <span className={[
                'inline-block text-[9px] uppercase tracking-wider font-bold mr-1.5',
                f.severity === 'blocker' ? 'text-wm-danger' :
                f.severity === 'warning' ? 'text-wm-warning' :
                                           'text-wm-text-subtle',
              ].join(' ')}>
                {f.severity ?? 'nit'}
              </span>
              {f.category && <span className="text-[10px] font-mono text-wm-text-subtle mr-1">[{f.category}]</span>}
              {f.issue}
            </p>
            {f.suggested_fix && (
              <p className="text-[10px] text-wm-text-muted italic mt-0.5">→ {f.suggested_fix}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</p>
      <p className="text-[11px] text-wm-text leading-snug">{children}</p>
    </div>
  )
}

function ChipRow({ label, items, tone }: { label: string; items: string[]; tone: 'accent' | 'muted' }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">{label}</p>
      <div className="flex flex-wrap gap-0.5">
        {items.map(item => (
          <span key={item}
            className={[
              'text-[10px] px-1.5 py-0.5 rounded border',
              tone === 'accent'
                ? 'bg-wm-accent-tint text-wm-accent-strong border-wm-accent/30 font-semibold'
                : 'bg-wm-bg-hover text-wm-text border-wm-border',
            ].join(' ')}>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
