/**
 * Web Manager — Style Guide workspace.
 *
 * The designer's review surface for the Brixies templates this project
 * uses. One card per distinct template, with:
 *   - A LIVE preview of an actual section bound to this template, with
 *     the partner's real field_values (heading, copy, images). Pulled
 *     from the first section using the template, sorted by page then
 *     section order so the preview lands on the most representative
 *     instance.
 *   - "Loaded into Figma" checkbox — same persistent state the old
 *     checklist on Design Handoff wrote to.
 *   - "Swap to" free-text input — same site-wide layout swap the old
 *     LayoutSwapBoard wrote to (figma_layout_swaps JSONB).
 *
 * Replaces the Templates Load Checklist that used to live on Design
 * Handoff. The Figma Style Guide URL field + setup steps remain on
 * Design Handoff (the "source" of the Figma file); this tab is the
 * picker-with-context the designer uses to walk through each template,
 * see what partner content lands in it, and decide whether to load it
 * into Figma as-is or swap to a different Brixies layout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Loader2, Palette, RefreshCw, Search, X,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMCard } from '../Card'
import { setProjectSwap, clearProjectSwap } from '../../../lib/webFigmaLayoutSwap'
import { loadEditorSnippets } from '../../../lib/webSnippets'
import { renderSectionToHtml, type SnippetMap } from '../../../lib/webBrixiesRender'
import {
  parseDesignSystemSpec, emptyDesignSystemSpec,
  type DesignSystemSpec,
} from '../../../lib/designSystemSpec'
import type {
  StrategyWebProject, WebContentTemplate, WebPage, WebSection,
} from '../../../types/database'

interface Props {
  project: StrategyWebProject
  onChange: () => Promise<void>
}

interface SectionWithPage extends WebSection {
  pageName:      string
  pageSlug:      string
  pageSortOrder: number
}

interface TemplateRow {
  template:  WebContentTemplate
  /** Representative section bound to this template — first by page
   *  sort_order, then section sort_order. */
  section:   SectionWithPage
  /** Count of sections across the project bound to this template. */
  count:     number
  /** For templates with palette-referenced groups (Feature 2 / 22 / 82
   *  / 106), the distinct card variants used across the project.
   *  Empty for templates that don't reference cards. */
  variants:  CardVariant[]
}

interface CardVariant {
  /** Card-family template id (e.g. 'card-193'). */
  cardTemplateId: string
  /** Resolved card template. May be null if catalog hasn't loaded yet
   *  or the saved id no longer exists. */
  cardTemplate:   WebContentTemplate | null
  /** Representative section using THIS card variant inside the parent
   *  template — picks the live preview content. */
  section:        SectionWithPage
  /** How many sections in the project use this variant. */
  count:          number
}

const BRIXIES_VIEWPORT_PX = 1512

/** Find every palette-shaped value inside a section's field_values.
 *  Returns the array of `__palette_template_id` strings (one per
 *  palette-referenced group on the section). A section can have
 *  multiple palette groups (rare); typical case is one per section. */
function extractPaletteTemplateIds(fv: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const v of Object.values(fv)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as { __palette_template_id?: unknown }
      if (typeof obj.__palette_template_id === 'string' && obj.__palette_template_id.trim()) {
        out.push(obj.__palette_template_id)
      }
    }
  }
  return out
}

export function StyleGuideWorkspace({ project, onChange }: Props) {
  const spec: DesignSystemSpec = useMemo(
    () => parseDesignSystemSpec(project.design_system) ?? emptyDesignSystemSpec(),
    [project.design_system],
  )

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [allTemplatesById, setAllTemplatesById] = useState<Record<string, WebContentTemplate>>({})
  const [cardTemplates, setCardTemplates] = useState<Record<string, WebContentTemplate>>({})
  const [snippetMap, setSnippetMap] = useState<SnippetMap>({})

  const [loadedIds, setLoadedIds] = useState<string[]>(spec.figma?.loaded_template_ids ?? [])
  const [savingLoaded, setSavingLoaded] = useState(false)
  useEffect(() => { setLoadedIds(spec.figma?.loaded_template_ids ?? []) }, [spec.figma?.loaded_template_ids])
  const loadedSet = useMemo(() => new Set(loadedIds), [loadedIds])

  const [swaps, setSwaps] = useState<StrategyWebProject['figma_layout_swaps']>(project.figma_layout_swaps ?? {})
  const [savingSwap, setSavingSwap] = useState<string | null>(null)
  useEffect(() => { setSwaps(project.figma_layout_swaps ?? {}) }, [project.figma_layout_swaps])

  const [searchQ, setSearchQ] = useState('')

  // Persist the loaded-template list onto the project's design_system
  // jsonb. Mirrors the path the old TemplateLoadChecklist used so existing
  // entries carry through transparently.
  const saveLoadedIds = useCallback(async (next: string[]) => {
    setSavingLoaded(true)
    setLoadedIds(next)
    const nextSpec: DesignSystemSpec = {
      ...spec,
      figma: { ...(spec.figma ?? {}), loaded_template_ids: next },
    }
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ design_system: nextSpec })
      .eq('id', project.id)
    setSavingLoaded(false)
    if (error) {
      console.error('[StyleGuideWorkspace] save loaded ids failed:', error)
      setLoadedIds(spec.figma?.loaded_template_ids ?? [])
      return
    }
    await onChange()
  }, [project.id, spec, onChange])

  const toggleLoaded = (templateId: string, next: boolean) => {
    const current = new Set(loadedIds)
    if (next) current.add(templateId); else current.delete(templateId)
    void saveLoadedIds([...current])
  }

  const saveSwapMap = useCallback(async (
    next: StrategyWebProject['figma_layout_swaps'],
    fromTemplateId: string,
  ) => {
    setSavingSwap(fromTemplateId)
    setSwaps(next)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ figma_layout_swaps: next })
      .eq('id', project.id)
    setSavingSwap(null)
    if (error) {
      console.error('[StyleGuideWorkspace] swap save failed:', error)
      setSwaps(project.figma_layout_swaps ?? {})
      return
    }
    await onChange()
  }, [project.id, project.figma_layout_swaps, onChange])

  const handleSwapText = useCallback(async (fromTemplateId: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) {
      const next = clearProjectSwap(swaps, fromTemplateId)
      await saveSwapMap(next, fromTemplateId)
      return
    }
    const lower = trimmed.toLowerCase()
    const match = Object.values(allTemplatesById).find(t => t.layer_name.toLowerCase() === lower)
    const { data: { session } } = await supabase.auth.getSession()
    const next = setProjectSwap(swaps, fromTemplateId, {
      to_template_id:    match?.id ?? '',
      to_template_label: trimmed,
      note:              swaps[fromTemplateId]?.note ?? null,
      swapped_at:        new Date().toISOString(),
      swapped_by:        session?.user?.id ?? '',
    })
    await saveSwapMap(next, fromTemplateId)
  }, [swaps, allTemplatesById, saveSwapMap])

  // ── Initial load — pages + sections + templates + cards + snippets ─

  const load = useCallback(async () => {
    setLoading(true)

    const [pagesRes, allTplRes, cardRes, snippetsRes] = await Promise.all([
      supabase
        .from('web_pages')
        .select('id, name, slug, sort_order, archived, web_sections:web_sections(*)')
        .eq('web_project_id', project.id)
        .eq('archived', false)
        .order('sort_order'),
      supabase
        .from('web_content_templates')
        .select('id, layer_name, family, fields, source_html, kind, variant, preview_image_url, paired_post_template, paired_url_pattern')
        .eq('is_published', true),
      supabase
        .from('web_content_templates')
        .select('*')
        .eq('family', 'Card'),
      loadEditorSnippets(project),
    ])

    // Flatten sections with page metadata.
    const flat: SectionWithPage[] = []
    for (const p of (pagesRes.data ?? []) as Array<WebPage & { web_sections: WebSection[] }>) {
      for (const s of p.web_sections ?? []) {
        flat.push({
          ...s,
          pageName:      p.name ?? p.slug,
          pageSlug:      p.slug,
          pageSortOrder: p.sort_order ?? 0,
        })
      }
    }

    // Index templates.
    const tplMap: Record<string, WebContentTemplate> = {}
    for (const t of (allTplRes.data ?? []) as WebContentTemplate[]) tplMap[t.id] = t
    setAllTemplatesById(tplMap)

    const cardMap: Record<string, WebContentTemplate> = {}
    for (const t of (cardRes.data ?? []) as WebContentTemplate[]) cardMap[t.id] = t
    setCardTemplates(cardMap)

    // Group sections by template id; representative = first section
    // by page sort, then section sort.
    const byTpl = new Map<string, SectionWithPage[]>()
    for (const s of flat) {
      if (!s.content_template_id) continue
      const list = byTpl.get(s.content_template_id) ?? []
      list.push(s)
      byTpl.set(s.content_template_id, list)
    }
    const out: TemplateRow[] = []
    for (const [tplId, sections] of byTpl.entries()) {
      const template = tplMap[tplId]
      if (!template) continue
      sections.sort((a, b) => {
        if (a.pageSortOrder !== b.pageSortOrder) return a.pageSortOrder - b.pageSortOrder
        return (a.sort_order ?? 0) - (b.sort_order ?? 0)
      })

      // Walk the sections looking for palette-referenced card variants.
      // Feature Section 2 / 22 / 82 / 106 ship with a palette-shaped
      // group whose card variant lives in field_values; the strategist
      // can pick any Card-family template per section, so a single
      // parent layout may render very differently across the site.
      // Build one variant row per distinct card template id used.
      const cardVariants = new Map<string, SectionWithPage[]>()
      for (const s of sections) {
        const fv = (s.field_values ?? {}) as Record<string, unknown>
        const ids = extractPaletteTemplateIds(fv)
        for (const id of ids) {
          const bucket = cardVariants.get(id) ?? []
          bucket.push(s)
          cardVariants.set(id, bucket)
        }
      }
      const variants: CardVariant[] = []
      for (const [cardId, vSections] of cardVariants.entries()) {
        vSections.sort((a, b) => {
          if (a.pageSortOrder !== b.pageSortOrder) return a.pageSortOrder - b.pageSortOrder
          return (a.sort_order ?? 0) - (b.sort_order ?? 0)
        })
        variants.push({
          cardTemplateId: cardId,
          cardTemplate:   cardMap[cardId] ?? tplMap[cardId] ?? null,
          section:        vSections[0],
          count:          vSections.length,
        })
      }
      // Order variants: most-used first, then alpha by card layer_name.
      variants.sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count
        return (a.cardTemplate?.layer_name ?? a.cardTemplateId).localeCompare(
          b.cardTemplate?.layer_name ?? b.cardTemplateId,
        )
      })

      out.push({ template, section: sections[0], count: sections.length, variants })
    }
    // Order: most-used first, then alpha.
    out.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      return (a.template.layer_name ?? '').localeCompare(b.template.layer_name ?? '')
    })
    setRows(out)

    // Snippet map.
    const m: Record<string, string> = {}
    for (const s of (snippetsRes ?? [])) m[s.token] = s.resolvedValue
    setSnippetMap(m)

    setLoading(false)
  }, [project])

  useEffect(() => { void load() }, [load])

  const allTemplatesSorted = useMemo(() =>
    Object.values(allTemplatesById).slice().sort((a, b) =>
      (a.layer_name ?? '').localeCompare(b.layer_name ?? '')),
    [allTemplatesById],
  )

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.template.layer_name.toLowerCase().includes(q) ||
      (r.template.family ?? '').toLowerCase().includes(q),
    )
  }, [rows, searchQ])

  const loadedCount = rows.filter(r => loadedSet.has(r.template.id)).length

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <Palette size={13} />
            <p className="text-[11px] font-bold uppercase tracking-widest">Style Guide</p>
          </div>
          <h1 className="text-2xl font-semibold text-wm-text">Walk the layouts in context</h1>
          <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
            Each Brixies layout this project uses, previewed with the
            partner's actual copy. Scroll through, check off the ones
            you've loaded into Figma, or type a different layout name
            in the "Swap to" field to call out a redesign.
          </p>
        </header>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[18rem]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-wm-text-subtle" />
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Filter by layer name or family…"
              className="w-full text-[12.5px] pl-7 pr-3 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
            />
          </div>
          <p className="text-[12px] text-wm-text-muted shrink-0">
            <span className="font-semibold text-wm-text">{loadedCount}</span> of {rows.length} loaded into Figma
            {savingLoaded && <Loader2 size={11} className="inline-block animate-spin ml-2" />}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text px-2 py-1 rounded hover:bg-wm-bg-hover disabled:opacity-50 shrink-0"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-16 grid place-items-center text-wm-text-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-wm-text-muted italic">
            {rows.length === 0
              ? 'No Brixies-bound sections yet. Add sections in the Pages workspace and they\'ll appear here.'
              : 'No layouts match that filter.'}
          </p>
        ) : (
          <div className="space-y-5">
            {filtered.map(row => (
              <StyleGuideCard
                key={row.template.id}
                row={row}
                cardTemplates={cardTemplates}
                snippetMap={snippetMap}
                loaded={loadedSet.has(row.template.id)}
                onToggleLoaded={(next) => toggleLoaded(row.template.id, next)}
                swaps={swaps}
                savingSwap={savingSwap}
                onSwapText={(fromId, text) => void handleSwapText(fromId, text)}
                allTemplates={allTemplatesSorted}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Per-template card ───────────────────────────────────────────────

function StyleGuideCard({
  row, cardTemplates, snippetMap,
  loaded, onToggleLoaded,
  swaps, savingSwap, onSwapText, allTemplates,
}: {
  row:           TemplateRow
  cardTemplates: Record<string, WebContentTemplate>
  snippetMap:    SnippetMap
  loaded:        boolean
  onToggleLoaded: (next: boolean) => void
  /** Full swap map so the card can read both the parent layout swap
   *  AND any per-variant card swap from the same source. */
  swaps:         StrategyWebProject['figma_layout_swaps']
  savingSwap:    string | null
  /** Save / clear a swap for a specific template id (parent or card). */
  onSwapText:    (fromTemplateId: string, text: string) => void
  allTemplates:  WebContentTemplate[]
}) {
  const { template, section, count, variants } = row
  const family = template.family ?? '(uncategorized)'
  const parentSwapEntry = swaps?.[template.id] ?? null
  const parentSwapValue = parentSwapEntry?.to_template_label ?? ''
  const parentSaving = savingSwap === template.id
  const hasVariants = variants.length > 0

  return (
    <WMCard padding="loose">
      {/* Header strip — template name + usage + load checkbox */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            {family}
          </p>
          <h3 className={[
            'text-[15px] font-semibold leading-tight',
            loaded ? 'text-wm-text-subtle line-through' : 'text-wm-text',
          ].join(' ')}>
            {template.layer_name}
          </h3>
          <p className="text-[11px] text-wm-text-muted mt-0.5">
            {hasVariants ? (
              <>
                <span className="text-wm-text font-medium">{variants.length}</span> card variant{variants.length === 1 ? '' : 's'} used
                <span className="ml-2 text-wm-text-subtle">· {count} section{count === 1 ? '' : 's'} total</span>
              </>
            ) : (
              <>
                Previewing <span className="text-wm-text font-medium">{section.pageName}</span>
                <code className="ml-1 text-[10.5px] text-wm-text-subtle">/{section.pageSlug}</code>
                {count > 1 && (
                  <span className="ml-2 text-wm-text-subtle">· {count} sections use this layout</span>
                )}
              </>
            )}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={loaded}
            onChange={(e) => onToggleLoaded(e.target.checked)}
            className="accent-wm-accent cursor-pointer"
          />
          <span className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Loaded into Figma
          </span>
        </label>
      </div>

      {/* Layouts with palette-referenced groups (Feature 2 / 22 / 82 /
          106) show one preview per distinct card variant the strategist
          picked across the project. Layouts without variants get the
          single preview path. */}
      {hasVariants ? (
        <div className="space-y-3">
          {variants.map(v => (
            <CardVariantRow
              key={v.cardTemplateId}
              parentTemplate={template}
              variant={v}
              cardTemplates={cardTemplates}
              snippetMap={snippetMap}
              swapEntry={swaps?.[v.cardTemplateId] ?? null}
              saving={savingSwap === v.cardTemplateId}
              onSwapText={(text) => onSwapText(v.cardTemplateId, text)}
              allTemplates={allTemplates}
            />
          ))}
        </div>
      ) : (
        <LivePreview
          template={template}
          values={(section.field_values ?? {}) as Record<string, unknown>}
          snippetMap={snippetMap}
          cardTemplates={cardTemplates}
        />
      )}

      {/* Parent-layout swap — always present so the designer can ALSO
          swap the outer Brixies layout independent of any card variant
          decisions inside. */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <ArrowRight size={12} className="text-wm-text-subtle shrink-0" />
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle shrink-0">
          Swap {hasVariants ? 'parent layout' : 'to'}
        </span>
        <input
          type="text"
          list={`tpl-options-${template.id}`}
          defaultValue={parentSwapValue}
          key={parentSwapValue}
          onBlur={e => onSwapText(template.id, e.target.value)}
          placeholder="Type a Brixies template name (or leave blank to keep this layout)"
          disabled={parentSaving}
          className="flex-1 min-w-[14rem] text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:border-wm-accent focus:outline-none disabled:opacity-50"
        />
        <datalist id={`tpl-options-${template.id}`}>
          {allTemplates.map(opt => (
            <option key={opt.id} value={opt.layer_name}>{opt.family ?? '(uncategorized)'}</option>
          ))}
        </datalist>
        {parentSwapEntry && (
          <button
            type="button"
            onClick={() => onSwapText(template.id, '')}
            className="text-wm-text-muted hover:text-wm-danger shrink-0"
            title="Clear swap"
          >
            <X size={12} />
          </button>
        )}
        {parentSaving && <Loader2 size={12} className="animate-spin text-wm-accent shrink-0" />}
      </div>
    </WMCard>
  )
}

/** One row per distinct card variant under a palette-referenced parent
 *  layout. Renders a live preview of an actual section using THIS
 *  variant + a swap input that targets the card template id. */
function CardVariantRow({
  parentTemplate, variant, cardTemplates, snippetMap,
  swapEntry, saving, onSwapText, allTemplates,
}: {
  parentTemplate: WebContentTemplate
  variant:        CardVariant
  cardTemplates:  Record<string, WebContentTemplate>
  snippetMap:     SnippetMap
  swapEntry:      NonNullable<StrategyWebProject['figma_layout_swaps']>[string] | null
  saving:         boolean
  onSwapText:     (text: string) => void
  allTemplates:   WebContentTemplate[]
}) {
  const swapDisplayValue = swapEntry?.to_template_label ?? ''
  const cardName = variant.cardTemplate?.layer_name ?? variant.cardTemplateId
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-hover/30 p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
            Card variant
          </p>
          <p className="text-[13px] font-semibold text-wm-text leading-tight">{cardName}</p>
          <p className="text-[11px] text-wm-text-muted mt-0.5">
            Previewing <span className="text-wm-text font-medium">{variant.section.pageName}</span>
            <code className="ml-1 text-[10.5px] text-wm-text-subtle">/{variant.section.pageSlug}</code>
            {variant.count > 1 && (
              <span className="ml-2 text-wm-text-subtle">· {variant.count} section{variant.count === 1 ? '' : 's'} use this variant</span>
            )}
          </p>
        </div>
      </div>

      <LivePreview
        template={parentTemplate}
        values={(variant.section.field_values ?? {}) as Record<string, unknown>}
        snippetMap={snippetMap}
        cardTemplates={cardTemplates}
      />

      <div className="mt-3 rounded-md border border-wm-accent/30 bg-wm-accent-tint/30 p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <ArrowRight size={13} className="text-wm-accent-strong shrink-0" />
          <span className="text-[11.5px] font-bold uppercase tracking-wider text-wm-accent-strong">
            Swap card or layout
          </span>
        </div>
        <p className="text-[11px] text-wm-text-muted mb-2 leading-snug">
          Type a different <span className="font-semibold">card template</span> name to redress this
          variant, or a different <span className="font-semibold">parent layout</span> name to break
          this case off into a different Brixies section entirely.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            list={`card-options-${variant.cardTemplateId}`}
            defaultValue={swapDisplayValue}
            key={swapDisplayValue}
            onBlur={e => onSwapText(e.target.value)}
            placeholder="e.g. Card 65 or Feature Section 22 — blank keeps the current layout"
            disabled={saving}
            className="flex-1 min-w-[14rem] text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-3 py-1.5 focus:border-wm-accent focus:outline-none disabled:opacity-50"
          />
          <datalist id={`card-options-${variant.cardTemplateId}`}>
            {allTemplates.map(opt => (
              <option key={opt.id} value={opt.layer_name}>{opt.family ?? '(uncategorized)'}</option>
            ))}
          </datalist>
          {swapEntry && (
            <button
              type="button"
              onClick={() => onSwapText('')}
              className="text-wm-text-muted hover:text-wm-danger shrink-0 inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded hover:bg-wm-danger-bg"
              title="Clear swap"
            >
              <X size={12} /> Clear
            </button>
          )}
          {saving && <Loader2 size={13} className="animate-spin text-wm-accent shrink-0" />}
        </div>
      </div>
    </div>
  )
}

// ── Live section preview ────────────────────────────────────────────
//
// Reuses the same render path as PagePreview.SectionFrame — Brixies
// HTML rendered into an iframe at the native 1512px viewport, scaled
// to fit the container width.

function LivePreview({
  template, values, snippetMap, cardTemplates,
}: {
  template:      WebContentTemplate
  values:        Record<string, unknown>
  snippetMap:    SnippetMap
  cardTemplates: Record<string, WebContentTemplate>
}) {
  const html = useMemo(
    () => renderSectionToHtml(template, values, snippetMap, cardTemplates),
    [template, values, snippetMap, cardTemplates],
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [scale, setScale] = useState(0.55)
  const [intrinsicHeight, setIntrinsicHeight] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth
      setScale(Math.min(1, w / BRIXIES_VIEWPORT_PX))
    }
    compute()
    const obs = new ResizeObserver(compute)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let bodyObserver: ResizeObserver | null = null
    const measure = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc) return
        const body = doc.body
        if (!body) return
        setIntrinsicHeight(Math.max(120, body.scrollHeight))
        if (!bodyObserver) {
          bodyObserver = new ResizeObserver(() => {
            try {
              setIntrinsicHeight(Math.max(120, body.scrollHeight))
            } catch { /* iframe detached */ }
          })
          bodyObserver.observe(body)
        }
      } catch { /* cross-origin or detached */ }
    }
    iframe.addEventListener('load', measure)
    return () => {
      iframe.removeEventListener('load', measure)
      bodyObserver?.disconnect()
    }
  }, [html])

  const scaledHeight = intrinsicHeight * scale

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated overflow-hidden">
      <div ref={containerRef} className="relative w-full" style={{ height: scaledHeight }}>
        <iframe
          ref={iframeRef}
          srcDoc={html}
          title="Section preview"
          className="absolute top-0 left-0 border-0 pointer-events-none"
          style={{
            width:           BRIXIES_VIEWPORT_PX,
            height:          intrinsicHeight,
            transform:       `scale(${scale})`,
            transformOrigin: '0 0',
          }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  )
}
