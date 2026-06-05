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
import { ChevronDown, ChevronRight, FileText, Target, Megaphone, AlertTriangle, Sparkles, Check, Unlock, RotateCcw, Loader2, Pencil, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import {
  approveCopy, unlockCopy, restoreApproval, getApproval, isApproved,
  type PageApprovalRecord,
} from '../../../lib/pageApprovals'
import { SitemapStrip } from './SitemapStrip'
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

export function PerPageReview({
  project,
  onChange,
}: {
  project:  StrategyWebProject
  onChange?: () => void | Promise<void>
}) {
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

  // Refresh the project + DB-backed sections after any mutation
  // (approve/unlock/restore/inline edit). The parent supplies
  // onChange to re-fetch strategy_web_projects; we also re-pull
  // web_sections locally so RenderedCopy renders the fresh state.
  const refresh = async () => {
    if (onChange) await onChange()
    const { data: sectionsRes } = await supabase
      .from('web_sections')
      .select('id, web_page_id, sort_order, content_template_id, field_values')
      .eq('archived', false)
    const pageIds = new Set(webPages.map(p => p.id))
    setWebSections(((sectionsRes ?? []) as WebSectionRow[]).filter(s => pageIds.has(s.web_page_id)))
  }

  return (
    <div className="space-y-3">
      <SitemapStrip
        roadmapState={roadmap}
        activeSlug={openSlug}
        onSelect={(slug) => setOpenSlug(slug)}
      />
      {orderedPages.map(p => (
        <PageCard
          key={p.slug}
          projectId={project.id}
          slug={p.slug}
          name={p.name}
          open={openSlug === p.slug}
          onToggle={() => setOpenSlug(openSlug === p.slug ? null : p.slug)}
          stage4Page={stage4Pages.find(sp => sp.page_slug === p.slug)}
          webPage={p.bound}
          webSections={webSections}
          rewrites={rewrites}
          findings={findings}
          approval={getApproval(roadmap, p.slug)}
          locked={isApproved(roadmap, p.slug)}
          onChange={refresh}
        />
      ))}
    </div>
  )
}

function PageCard({
  projectId, slug, name, open, onToggle, stage4Page, webPage, webSections, rewrites, findings,
  approval, locked, onChange,
}: {
  projectId: string
  slug: string
  name: string
  open: boolean
  onToggle: () => void
  stage4Page?: Stage4Page
  webPage?: WebPageRow
  webSections: WebSectionRow[]
  rewrites: Stage7Rewrite[]
  findings: Stage8Finding[]
  approval: PageApprovalRecord | null
  locked:   boolean
  onChange: () => void | Promise<void>
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
          {/* Approval banner — the load-bearing state UI. Shows current
              approval state + Approve/Unlock/Restore controls. */}
          <ApprovalBanner
            projectId={projectId}
            slug={slug}
            approval={approval}
            onChange={onChange}
          />

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
                locked={locked}
                onChange={onChange}
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

/** Compose the effective field_values for a section by overlaying
 *  active voice-pass rewrites on top of the current web_sections
 *  field_values. Omitted rewrites pass through; user_value beats
 *  new_value beats the bound original. The result is what the page
 *  WILL look like after Apply runs — i.e. the strategist sees the
 *  final state without having to click Apply first. */
function effectiveValues(
  bound: WebSectionRow | undefined,
  rewrites: Stage7Rewrite[],
): { values: Record<string, unknown>; pending: Set<string> } {
  const out = { ...(bound?.field_values ?? {}) }
  const pending = new Set<string>()
  for (const r of rewrites) {
    if (r.omitted === true) continue
    if (!r.field_key) continue
    const v = typeof r.user_value === 'string' && r.user_value.length > 0 ? r.user_value : r.new_value
    if (v == null) continue
    out[r.field_key] = v
    pending.add(r.field_key)
  }
  return { values: out, pending }
}

function SectionRow({
  index, outline, bound, rewrites, findings, locked, onChange,
}: {
  index:    number
  outline?: Stage4Section
  bound?:   WebSectionRow
  rewrites: Stage7Rewrite[]
  findings: Stage8Finding[]
  locked:   boolean
  onChange: () => void | Promise<void>
}) {
  // Lead with rendered copy. Sections are expanded by default so the
  // strategist can scan writing quality without clicking every section
  // open. Strategy backbone + raw values collapse below.
  const [expanded, setExpanded] = useState(true)
  const [showBackbone, setShowBackbone] = useState(false)
  const [showRewrites, setShowRewrites] = useState(false)
  const [showRaw,      setShowRaw]      = useState(false)
  const sectionLabel = outline?.section_id
    ?? (bound ? `section-${index + 1}` : `section-${index + 1}`)
  const sectionJob = outline?.section_job
  const requiredCount = outline?.required_messages?.length ?? 0
  const activeRewriteCount = rewrites.filter(r => r.omitted !== true).length
  const findingsCount = findings.length
  const { values: effective, pending } = effectiveValues(bound, rewrites)

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
        <div className="border-t border-wm-border bg-wm-bg/30">
          {/* LEAD: Rendered final copy (effective values).
              This is what the strategist actually wants to see — the
              section as it WILL appear after Apply, with active manifest
              rewrites overlaid on bound field_values. */}
          {bound && (
            <div className="px-4 py-4 border-b border-wm-border bg-white/40">
              <RenderedCopy
                values={effective}
                pending={pending}
                sectionId={bound.id}
                locked={locked}
                onChange={onChange}
              />
            </div>
          )}

          {/* QA findings stay visible at the top below copy — these
              are the things the strategist NEEDS to see, not collapse. */}
          {findings.length > 0 && (
            <div className="px-3 py-2 border-b border-wm-border">
              <FindingsBlock title="QA findings on this section" findings={findings} />
            </div>
          )}

          {/* Everything below collapses by default — strategy backbone
              + raw voice rewrites + raw field_values. Toggles, not
              auto-expand, so the page reads as copy first. */}
          <div className="px-3 py-2 space-y-1.5">
            {outline && (
              <CollapseToggle
                open={showBackbone}
                onToggle={() => setShowBackbone(o => !o)}
                label="Strategy backbone"
                count={requiredCount + (outline.cta ? 1 : 0)}
                countLabel="contract items"
              >
                <OutlineBlock outline={outline} />
              </CollapseToggle>
            )}
            {rewrites.length > 0 && (
              <CollapseToggle
                open={showRewrites}
                onToggle={() => setShowRewrites(o => !o)}
                label="Voice-pass diff (before → after)"
                count={activeRewriteCount}
                countLabel="active rewrites"
              >
                <RewritesBlock rewrites={rewrites} />
              </CollapseToggle>
            )}
            {bound && (
              <CollapseToggle
                open={showRaw}
                onToggle={() => setShowRaw(o => !o)}
                label="Raw field_values (debug)"
                count={Object.keys(bound.field_values ?? {}).length}
                countLabel="slots"
              >
                <BoundCopyBlock bound={bound} />
              </CollapseToggle>
            )}
          </div>

          {!outline && !bound && (
            <p className="px-3 py-3 text-[11px] text-wm-text-muted italic">
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

/** Renders a section's effective field_values as styled text — heading
 *  as a display title, tagline/eyebrow as caption, description/body as
 *  paragraph, buttons as buttons. Slots with pending voice-pass rewrites
 *  get a small "pending" dot so the strategist sees what's not yet
 *  applied. Structured slots (cards, grid_row, accordion, etc.) render
 *  as a flexible mini-grid so the user can scan repeated items, not as
 *  raw JSON. */
function RenderedCopy({
  values, pending, sectionId, locked, onChange,
}: {
  values:    Record<string, unknown>
  pending:   Set<string>
  sectionId: string
  locked:    boolean
  onChange:  () => void | Promise<void>
}) {
  // Pluck known slots (best-effort — Brixies field naming is consistent
  // enough that this covers ~95% of sections). Unrecognized string
  // slots fall into "other" and render as a small caption row.
  // For each text slot, we resolve the canonical field key so inline
  // edits write to the right field. The render functions below use
  // the resolved key (e.g. 'heading' or 'title' depending on what
  // actually exists in field_values).
  const get = (k: string): string | null => {
    const v = values[k]
    return typeof v === 'string' && v.trim().length > 0 ? v : null
  }
  const firstKey = (keys: string[]): string => keys.find(k => typeof values[k] === 'string') ?? keys[0]
  const eyebrowKey     = firstKey(['eyebrow','tagline'])
  const eyebrow        = get(eyebrowKey)
  const headingKey     = firstKey(['heading','title','h1','h2'])
  const heading        = get(headingKey)
  const subheadKey     = firstKey(['subhead','subheading'])
  const subhead        = get(subheadKey) ?? (heading && get('tagline') !== eyebrow ? get('tagline') : null)
  const descriptionKey = firstKey(['description','accent_description','intro'])
  const description    = get(descriptionKey)
  const bodyKey        = firstKey(['body','rich_text','long_text','content'])
  const body           = get(bodyKey)
  // Lift structured-slot items so cards/rows preview visually.
  const buttons  = pickArrayOfObjects(values, ['buttons'])
  const cards    = pickArrayOfObjects(values, ['cards', 'card_group', 'grid_row.items'])
  const rows     = pickArrayOfObjects(values, ['row_list', 'list'])
  const accordion = pickArrayOfObjects(values, ['accordion_items', 'accordion_left', 'accordion_right', 'faqs', 'faq_items'])
  const stepGroup = pickArrayOfObjects(values, ['steps', 'step_group'])
  // Catch-all: any string slot not in the explicit list. Shown small
  // and last so the strategist can spot a stray field, but rendered
  // copy stays clean.
  const known = new Set([
    'eyebrow','tagline','heading','title','h1','h2',
    'subhead','subheading',
    'description','accent_description','intro',
    'body','rich_text','long_text','content',
    'buttons','cards','card_group','grid_row',
    'row_list','list',
    'accordion_items','accordion_left','accordion_right','faqs','faq_items',
    'steps','step_group',
  ])
  const otherStrings = Object.entries(values)
    .filter(([k, v]) => !known.has(k) && typeof v === 'string' && v.trim().length > 0) as Array<[string, string]>

  const dot = (key: string) => pending.has(key)
    ? <span title="Pending voice-pass rewrite (not yet applied to web_sections)"
            className="inline-block w-1.5 h-1.5 rounded-full bg-wm-accent mr-1 align-middle" />
    : null

  return (
    <div className="space-y-3">
      {(eyebrow || pending.has(eyebrowKey)) && (
        <EditableText
          value={eyebrow} fieldKey={eyebrowKey} sectionId={sectionId}
          locked={locked} pending={pending.has(eyebrowKey)} onChange={onChange}
          className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong"
        />
      )}
      {(heading || pending.has(headingKey)) && (
        <EditableText
          value={heading} fieldKey={headingKey} sectionId={sectionId}
          locked={locked} pending={pending.has(headingKey)} onChange={onChange}
          className="text-[20px] md:text-[22px] font-semibold text-wm-text leading-tight"
        />
      )}
      {subhead && (
        <EditableText
          value={subhead} fieldKey={subheadKey} sectionId={sectionId}
          locked={locked} pending={pending.has(subheadKey)} onChange={onChange}
          className="text-[14px] text-wm-text-muted leading-snug"
        />
      )}
      {description && (
        <EditableText
          value={description} fieldKey={descriptionKey} sectionId={sectionId}
          locked={locked} pending={pending.has(descriptionKey)} onChange={onChange}
          className="text-[13px] text-wm-text leading-relaxed whitespace-pre-wrap"
          multiline
        />
      )}
      {body && (
        <EditableText
          value={body} fieldKey={bodyKey} sectionId={sectionId}
          locked={locked} pending={pending.has(bodyKey)} onChange={onChange}
          className="text-[13px] text-wm-text leading-relaxed whitespace-pre-wrap"
          multiline
        />
      )}
      {buttons.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {dot('buttons')}
          {buttons.map((b, i) => {
            const label = typeof b.label === 'string' ? b.label : '(button)'
            const url   = typeof b.url   === 'string' ? b.url   : null
            return (
              <span key={i} className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full bg-wm-text text-white text-[11px] font-semibold">
                {label}
                {url && <code className="text-[9px] font-mono opacity-70">{url}</code>}
              </span>
            )
          })}
        </div>
      )}
      {cards.length > 0 && (
        <MiniList label="Cards" items={cards} fieldOrder={['title','heading','description','body']} />
      )}
      {rows.length > 0 && (
        <MiniList label="Rows" items={rows} fieldOrder={['title','heading','description','body']} />
      )}
      {accordion.length > 0 && (
        <MiniList label="Accordion items" items={accordion} fieldOrder={['title','question','description','answer','body']} />
      )}
      {stepGroup.length > 0 && (
        <MiniList label="Steps" items={stepGroup} fieldOrder={['title','heading','description','body']} numbered />
      )}
      {otherStrings.length > 0 && (
        <details className="text-[11px]">
          <summary className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle cursor-pointer">
            Other slots ({otherStrings.length})
          </summary>
          <dl className="space-y-1 mt-1">
            {otherStrings.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[100px_1fr] gap-2 text-[11px]">
                <dt className="font-mono text-wm-text-subtle truncate">{dot(k)}{k}</dt>
                <dd className="text-wm-text-muted leading-snug whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {/* Empty-state — section bound but every known slot is empty */}
      {!eyebrow && !heading && !subhead && !description && !body
        && buttons.length === 0 && cards.length === 0 && rows.length === 0
        && accordion.length === 0 && stepGroup.length === 0
        && otherStrings.length === 0 && (
        <p className="text-[12px] text-wm-text-muted italic">
          Section is bound but every slot is empty. The strategist needs to fill content here.
        </p>
      )}
    </div>
  )
}

function pickArrayOfObjects(
  values: Record<string, unknown>,
  keys: string[],
): Array<Record<string, unknown>> {
  for (const k of keys) {
    // Support "a.b" notation for nested picks (e.g. grid_row.items).
    let v: unknown = values
    for (const segment of k.split('.')) {
      v = v && typeof v === 'object' ? (v as Record<string, unknown>)[segment] : undefined
    }
    if (Array.isArray(v) && v.every(item => item && typeof item === 'object')) {
      return v as Array<Record<string, unknown>>
    }
  }
  return []
}

function MiniList({
  label, items, fieldOrder, numbered,
}: {
  label:      string
  items:      Array<Record<string, unknown>>
  fieldOrder: string[]
  numbered?:  boolean
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
        {label} ({items.length})
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.map((item, i) => {
          const title = fieldOrder.map(f => item[f]).find(v => typeof v === 'string' && v.length > 0) as string | undefined
          const body  = fieldOrder.slice(fieldOrder.indexOf('description')).map(f => item[f])
            .find(v => typeof v === 'string' && v.length > 0) as string | undefined
          return (
            <div key={i} className="rounded border border-wm-border bg-wm-bg-elevated/60 px-2.5 py-1.5">
              <p className="text-[12px] font-semibold text-wm-text leading-snug">
                {numbered && <span className="text-wm-text-subtle font-mono text-[10px] mr-1">{i + 1}.</span>}
                {title ?? <span className="italic text-wm-text-subtle">(no title)</span>}
              </p>
              {body && body !== title && (
                <p className="text-[11px] text-wm-text-muted leading-snug mt-0.5">{body}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CollapseToggle({
  open, onToggle, label, count, countLabel, children,
}: {
  open:        boolean
  onToggle:    () => void
  label:       string
  count?:      number
  countLabel?: string
  children:    React.ReactNode
}) {
  return (
    <div className="rounded border border-wm-border bg-wm-bg-elevated/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-2.5 py-1.5 flex items-baseline gap-2 text-left hover:bg-wm-bg-hover"
      >
        {open
          ? <ChevronDown size={10} className="shrink-0 text-wm-text-muted self-center" />
          : <ChevronRight size={10} className="shrink-0 text-wm-text-muted self-center" />}
        <span className="text-[11px] font-semibold text-wm-text">{label}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[10px] text-wm-text-muted">
            {count}{countLabel ? ` ${countLabel}` : ''}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-1.5 border-t border-wm-border bg-wm-bg/30">
          {children}
        </div>
      )}
    </div>
  )
}

/** Page approval state banner with controls. The load-bearing UI for
 *  the new approval workflow — Draft → Approved → Unlocked → Re-approve.
 *  Reflects state of roadmap_state.approved_pages[slug] and exposes
 *  buttons that call the pageApprovals helpers.
 */
function ApprovalBanner({
  projectId, slug, approval, onChange,
}: {
  projectId: string
  slug:      string
  approval:  PageApprovalRecord | null
  onChange:  () => void | Promise<void>
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'unlock' | 'restore'>(null)
  const [error, setError] = useState<string | null>(null)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockReason, setUnlockReason] = useState('')

  const wrap = async (kind: 'approve' | 'unlock' | 'restore', fn: () => Promise<{ ok: true } | { ok: true; version: number } | { ok: false; error: string }>) => {
    setBusy(kind); setError(null)
    try {
      const result = await fn()
      if (!result.ok) setError(result.error)
      else await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const handleApprove = () => wrap('approve', () => approveCopy({
    projectId, pageSlug: slug, userId: null,
  }))
  const handleRestore = () => wrap('restore', () => restoreApproval({
    projectId, pageSlug: slug,
  }))
  const submitUnlock = () => wrap('unlock', async () => {
    const r = await unlockCopy({
      projectId, pageSlug: slug, userId: null,
      reason: unlockReason.trim() || 'No reason given',
    })
    if (r.ok) { setUnlockOpen(false); setUnlockReason('') }
    return r
  })

  // ── States ──
  const status = approval?.status
  const version = approval?.version
  const stale = approval?.stale === true
  const approvedAt = approval?.approved_at ? new Date(approval.approved_at).toLocaleDateString() : null
  const unlockedAt = approval?.unlocked_at ? new Date(approval.unlocked_at).toLocaleDateString() : null

  // Approved state — green banner, primary action is Unlock
  if (status === 'approved' && !stale) {
    return (
      <div className="rounded border border-wm-success/40 bg-wm-success-bg/40 px-3 py-2 flex items-center gap-2 flex-wrap">
        <Check size={13} className="text-wm-success shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-wm-text">
            <strong className="text-wm-success">Approved</strong>
            {version && <span className="text-wm-text-muted"> · v{version}</span>}
            {approvedAt && <span className="text-wm-text-muted"> · {approvedAt}</span>}
          </p>
          <p className="text-[10px] text-wm-text-muted leading-snug">
            Voice-pass + bind are locked. Re-runs will skip this page until you unlock it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUnlockOpen(o => !o)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold border border-wm-border text-wm-text bg-wm-bg-elevated hover:bg-wm-bg-hover disabled:opacity-40"
        >
          <Unlock size={11} /> Unlock for re-run
        </button>
        {unlockOpen && (
          <div className="basis-full mt-2 p-2 rounded border border-wm-border bg-wm-bg-elevated">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
              Unlock reason
            </p>
            <p className="text-[11px] text-wm-text-muted mb-1.5 leading-snug">
              Unlocking removes the approval and lets the pipeline write here again. The
              approved version (v{version}) is preserved — you can restore at any time.
            </p>
            <input
              type="text"
              value={unlockReason}
              onChange={e => setUnlockReason(e.target.value)}
              disabled={busy === 'unlock'}
              placeholder="Why unlock? e.g., 'Headings need rework after SEO audit'"
              className="w-full text-[12px] px-2 py-1.5 rounded border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setUnlockOpen(false); setUnlockReason('') }}
                disabled={busy === 'unlock'}
                className="text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitUnlock()}
                disabled={busy === 'unlock' || !unlockReason.trim()}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-warning text-white hover:opacity-90 disabled:opacity-40"
              >
                {busy === 'unlock' ? <Loader2 size={11} className="animate-spin" /> : <Unlock size={11} />}
                Confirm unlock
              </button>
            </div>
          </div>
        )}
        {error && <p className="basis-full text-[11px] text-wm-danger mt-1">Action failed: {error}</p>}
      </div>
    )
  }

  // Approved + stale state — yellow banner
  if (status === 'approved' && stale) {
    return (
      <div className="rounded border border-wm-warning/40 bg-wm-warning/10 px-3 py-2 flex items-center gap-2 flex-wrap">
        <AlertTriangle size={13} className="text-wm-warning shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-wm-text">
            <strong className="text-wm-warning">Approved v{version} — but stale</strong>
            {approvedAt && <span className="text-wm-text-muted"> · approved {approvedAt}</span>}
          </p>
          <p className="text-[10px] text-wm-text-muted leading-snug">
            {approval?.stale_reasons?.length
              ? `Stage 8 / upstream context changes: ${approval.stale_reasons.join('; ')}`
              : 'Upstream context changed since approval — review and re-approve, or unlock to re-run.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-success text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy === 'approve' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Re-approve as-is
        </button>
        <button
          type="button"
          onClick={() => setUnlockOpen(o => !o)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold border border-wm-border text-wm-text bg-wm-bg-elevated hover:bg-wm-bg-hover disabled:opacity-40"
        >
          <Unlock size={11} /> Unlock for re-run
        </button>
        {error && <p className="basis-full text-[11px] text-wm-danger mt-1">{error}</p>}
      </div>
    )
  }

  // Unlocked state — orange banner with Restore option
  if (status === 'unlocked') {
    return (
      <div className="rounded border border-wm-accent/40 bg-wm-accent-tint/40 px-3 py-2 flex items-center gap-2 flex-wrap">
        <Unlock size={13} className="text-wm-accent-strong shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-wm-text">
            <strong className="text-wm-accent-strong">Unlocked</strong>
            {version && <span className="text-wm-text-muted"> · was v{version}</span>}
            {unlockedAt && <span className="text-wm-text-muted"> · {unlockedAt}</span>}
          </p>
          <p className="text-[10px] text-wm-text-muted leading-snug">
            {approval?.unlock_reason && <em>"{approval.unlock_reason}"</em>}
            {' '}Pipeline can write here again. Approve when ready (creates v{(version ?? 0) + 1}) or restore the previous approval.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-success text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy === 'approve' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Approve as v{(version ?? 0) + 1}
        </button>
        <button
          type="button"
          onClick={() => void handleRestore()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold border border-wm-border text-wm-text bg-wm-bg-elevated hover:bg-wm-bg-hover disabled:opacity-40"
        >
          {busy === 'restore' ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
          Restore v{version}
        </button>
        {error && <p className="basis-full text-[11px] text-wm-danger mt-1">{error}</p>}
      </div>
    )
  }

  // Draft state — neutral banner with Approve as primary
  return (
    <div className="rounded border border-wm-border bg-wm-bg/40 px-3 py-2 flex items-center gap-2 flex-wrap">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-wm-text font-semibold">Draft</p>
        <p className="text-[10px] text-wm-text-muted leading-snug">
          This page hasn't been approved. Pipeline can write here freely. Read the copy
          below, edit anything that's off, then approve when it's ready to ship.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void handleApprove()}
        disabled={busy !== null}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-success text-white hover:opacity-90 disabled:opacity-40"
      >
        {busy === 'approve' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        Approve copy
      </button>
      {error && <p className="basis-full text-[11px] text-wm-danger mt-1">{error}</p>}
    </div>
  )
}

/** Hover-to-edit text slot. Click on the rendered text → opens an
 *  inline input/textarea → save writes to web_sections.field_values
 *  with field_provenance flipped to 'override' so voice pass leaves
 *  the strategist's edit alone on future runs.
 *
 *  When locked, the slot renders read-only (cursor: default, no hover
 *  affordance, click does nothing). The lock comes from the page's
 *  approval state.
 */
function EditableText({
  value, fieldKey, sectionId, locked, pending, onChange,
  className, multiline,
}: {
  value:     string | null
  fieldKey:  string
  sectionId: string
  locked:    boolean
  pending:   boolean
  onChange:  () => void | Promise<void>
  className?: string
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = () => {
    if (locked) return
    setDraft(value ?? '')
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    if (saving) return
    setSaving(true); setError(null)
    try {
      const { data: sec, error: readErr } = await supabase
        .from('web_sections')
        .select('field_values, field_provenance')
        .eq('id', sectionId)
        .single()
      if (readErr || !sec) throw new Error(readErr?.message ?? 'Section not found')
      const fv   = ((sec as { field_values: Record<string, unknown> | null }).field_values   ?? {}) as Record<string, unknown>
      const prov = ((sec as { field_provenance: Record<string, { source?: string }> | null }).field_provenance ?? {}) as Record<string, { source?: string }>
      const nextFv   = { ...fv,   [fieldKey]: draft }
      const nextProv = { ...prov, [fieldKey]: { ...(prov[fieldKey] ?? {}), source: 'override' } }
      const { error: writeErr } = await supabase
        .from('web_sections')
        .update({ field_values: nextFv, field_provenance: nextProv } as never)
        .eq('id', sectionId)
      if (writeErr) throw new Error(writeErr.message)
      setEditing(false)
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setEditing(false)
    setDraft(value ?? '')
    setError(null)
  }

  if (editing) {
    return (
      <div className="space-y-1.5">
        {multiline ? (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={saving}
            rows={4}
            autoFocus
            className="w-full text-[13px] px-2 py-1.5 rounded border-2 border-wm-accent bg-white focus:outline-none disabled:opacity-60"
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={saving}
            autoFocus
            className="w-full text-[13px] px-2 py-1.5 rounded border-2 border-wm-accent bg-white focus:outline-none disabled:opacity-60"
          />
        )}
        {error && <p className="text-[11px] text-wm-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="text-[11px] text-wm-text-muted hover:text-wm-text px-2 py-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || draft === (value ?? '')}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-accent text-white hover:bg-wm-accent-hover disabled:opacity-40"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Save edit
          </button>
        </div>
      </div>
    )
  }

  const dot = pending
    ? <span title="Pending voice-pass rewrite (not yet applied)"
            className="inline-block w-1.5 h-1.5 rounded-full bg-wm-accent mr-1.5 align-middle" />
    : null

  return (
    <div
      className={[
        className,
        'group relative',
        locked
          ? 'cursor-default'
          : 'cursor-text hover:bg-wm-accent-tint/15 -mx-1 px-1 rounded transition-colors',
      ].join(' ')}
      onClick={startEdit}
      title={locked ? 'Page is approved — unlock to edit' : 'Click to edit'}
    >
      {!locked && (
        <Pencil
          size={10}
          className="opacity-0 group-hover:opacity-50 absolute top-1 right-1 text-wm-accent-strong"
        />
      )}
      {dot}
      {value || <span className="italic text-wm-text-subtle">(empty)</span>}
    </div>
  )
}
