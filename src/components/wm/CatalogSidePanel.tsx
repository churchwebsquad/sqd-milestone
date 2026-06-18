/**
 * Web Manager — Catalog Side Panel.
 *
 * Reusable template picker. Hosts mount it with mode + kind filters;
 * users browse the 257-template Brixies library and pick one (single
 * mode) or several (multi mode).
 *
 * First host: Sitemap workspace chrome designation (single-select,
 * kind=chrome, family-restricted to Header/Footer/Megamenu/Offcanvas).
 * Future hosts: Pages section picker (single, kind=content), Design
 * Manager card palette (multi, kind=component, max 4).
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Search, Check, Sparkles, X, Star, Layers } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { WMFlyoutPanel } from './FlyoutPanel'
import { WMButton } from './Button'
import { WMStatusPill } from './StatusPill'
import type { WebContentTemplate, WebTemplateKind } from '../../types/database'

export interface WMCatalogSidePanelProps {
  open: boolean
  onClose: () => void

  /** Header copy (e.g. "Pick a primary header") */
  title: string
  subtitle?: string

  /** Filter templates by kind. Empty array shows all. */
  kindFilter?: readonly WebTemplateKind[]
  /** Filter templates by family name (case-insensitive). Empty shows all. */
  familyFilter?: readonly string[]

  /** Selection mode */
  mode: 'single' | 'multi'
  /** Currently-selected template ids (for indicating + multi limits) */
  selectedIds?: readonly string[]
  /** Max number of selections for multi mode */
  maxSelections?: number

  /** Called on pick (single) or save (multi) */
  onSelect: (ids: string[]) => void | Promise<void>

  /** Optional ranked ordering. When provided, visible templates are
   *  sorted by appearance in this array (ids not present sink to the
   *  bottom). Use with rankVariantsByBrief() from webBindTemplate.ts
   *  to surface best-fit variants first. */
  rankedIds?: readonly string[]

  /** Template ids that are already in the project's curated library
   *  (Global Elements bindings). Rendered with a small ★ Site library
   *  badge so the strategist can spot site picks at a glance. */
  siteLibraryIds?: ReadonlySet<string>

  /** Template ids currently bound on ANY active page in this project.
   *  Drives the "Active on site" filter chip + a small badge on each
   *  matching card so the strategist can quickly find variants already
   *  in use elsewhere on the site (e.g. "I want the events layout from
   *  the home page"). */
  activeOnSiteIds?: ReadonlySet<string>

  /** Optional subtitle to show under each template card — used to
   *  surface the AI / deterministic rationale for the rank. Keyed by
   *  template id. */
  cardSubtitles?: Record<string, string>

  /** Optional AI re-rank button. When present, the panel renders a
   *  "Suggest with AI" button in its header; the host wires it to the
   *  /api/web/agents/suggest-template-variant endpoint and pipes the
   *  returned ordering back via `rankedIds`. */
  onRequestAIRank?: () => void | Promise<void>
  /** Set while the AI re-rank is in flight — disables the button. */
  aiRanking?: boolean
}

export function WMCatalogSidePanel({
  open, onClose, title, subtitle,
  kindFilter, familyFilter,
  mode, selectedIds = [], maxSelections,
  onSelect,
  rankedIds, siteLibraryIds, activeOnSiteIds, cardSubtitles, onRequestAIRank, aiRanking,
}: WMCatalogSidePanelProps) {
  const [rows, setRows] = useState<WebContentTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [draftSelection, setDraftSelection] = useState<string[]>([...selectedIds])
  const [saving, setSaving] = useState(false)
  // Whether the optional family filter is currently active. Starts on
  // whenever `familyFilter` is supplied; strategist can toggle off via
  // the chip in the header to browse the full catalog.
  const [familyFilterActive, setFamilyFilterActive] = useState(true)
  // Whether the "Active on site" filter is currently active. Starts off
  // so the catalog shows the full set; strategist toggles on to narrow
  // to templates already in use elsewhere on the site.
  const [activeOnSiteFilter, setActiveOnSiteFilter] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraftSelection([...selectedIds])
    // Re-enable family filter every time the panel opens.
    setFamilyFilterActive(true)
    // Reset the Active-on-site filter so a fresh open shows the full catalog.
    setActiveOnSiteFilter(false)
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data } = await supabase
        .from('web_content_templates')
        .select('*')
        .order('family')
        .order('layer_name')
      if (cancelled) return
      setRows((data ?? []) as WebContentTemplate[])
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** Normalize a family name for tolerant comparison — strip punctuation
   *  and case so "Hero Section" matches "Hero", "hero-section",
   *  "Hero Sections", etc. */
  const normalizeFamily = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rows.filter(r => {
      if (kindFilter && kindFilter.length > 0 && !kindFilter.includes(r.kind)) return false
      if (familyFilterActive && familyFilter && familyFilter.length > 0) {
        const fam = normalizeFamily(r.family)
        const matches = familyFilter.some(f => {
          const target = normalizeFamily(f)
          return fam === target || fam.includes(target) || target.includes(fam)
        })
        if (!matches) return false
      }
      if (activeOnSiteFilter && activeOnSiteIds && !activeOnSiteIds.has(r.id)) return false
      if (!q) return true
      return `${r.family} ${r.layer_name} ${r.id}`.toLowerCase().includes(q)
    })
    // Apply optional ranking — keep ids in `rankedIds` order, then
    // append everything else in the original (family, layer_name) order.
    // Sort policy: site-library picks ALWAYS go first (the project's
    // curated palette is the strategist's preferred choices). Within
    // each tier — library vs. non-library — apply the explicit
    // ranking when present, else preserve catalog order.
    const order = (rankedIds && rankedIds.length > 0)
      ? new Map(rankedIds.map((id, idx) => [id, idx]))
      : null
    return [...filtered].sort((a, b) => {
      const aLib = siteLibraryIds?.has(a.id) ? 0 : 1
      const bLib = siteLibraryIds?.has(b.id) ? 0 : 1
      if (aLib !== bLib) return aLib - bLib
      if (order) {
        const ai = order.has(a.id) ? order.get(a.id)! : Number.MAX_SAFE_INTEGER
        const bi = order.has(b.id) ? order.get(b.id)! : Number.MAX_SAFE_INTEGER
        return ai - bi
      }
      return 0
    })
  }, [rows, query, kindFilter, familyFilter, familyFilterActive, activeOnSiteFilter, activeOnSiteIds, rankedIds, siteLibraryIds])

  const handleCardClick = async (id: string) => {
    if (mode === 'single') {
      await onSelect([id])
      onClose()
      return
    }
    // Multi-select
    setDraftSelection(prev => {
      if (prev.includes(id)) return prev.filter(p => p !== id)
      if (maxSelections && prev.length >= maxSelections) return prev
      return [...prev, id]
    })
  }

  const handleSave = async () => {
    setSaving(true)
    await onSelect(draftSelection)
    setSaving(false)
    onClose()
  }

  return (
    <WMFlyoutPanel
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width="lg"
      footer={mode === 'multi' ? (
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-wm-text-muted">
            {draftSelection.length}{maxSelections ? ` of ${maxSelections}` : ''} selected
          </p>
          <div className="flex items-center gap-2">
            <WMButton variant="ghost" size="sm" onClick={onClose}>Cancel</WMButton>
            <WMButton variant="primary" size="sm" onClick={handleSave} loading={saving}>
              Save selection
            </WMButton>
          </div>
        </div>
      ) : undefined}
    >
      <div className="p-4 border-b border-wm-border bg-wm-bg-elevated sticky top-0 z-10">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-wm-text-subtle" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by family, layer name, or id…"
            className="w-full h-9 pl-9 pr-3 rounded-md bg-wm-bg border border-wm-border text-[13px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          />
        </div>
        {/* Active family-filter chip — toggle off to browse the full catalog
            when the suggested family doesn't match anything in the DB. */}
        {((familyFilter && familyFilter.length > 0) || (activeOnSiteIds && activeOnSiteIds.size > 0)) && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {familyFilter && familyFilter.length > 0 && (
              <>
                <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Family:</span>
                {familyFilter.map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFamilyFilterActive(v => !v)}
                    className={[
                      'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] transition-colors',
                      familyFilterActive
                        ? 'bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30'
                        : 'bg-wm-bg-hover text-wm-text-muted border border-wm-border line-through',
                    ].join(' ')}
                    title={familyFilterActive ? 'Click to show all families' : 'Click to re-apply family filter'}
                  >
                    {f}
                    {familyFilterActive && <X size={10} />}
                  </button>
                ))}
                {!familyFilterActive && (
                  <span className="text-[10px] text-wm-text-subtle italic">showing all families</span>
                )}
              </>
            )}
            {activeOnSiteIds && activeOnSiteIds.size > 0 && (
              <button
                type="button"
                onClick={() => setActiveOnSiteFilter(v => !v)}
                className={[
                  'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] transition-colors',
                  activeOnSiteFilter
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                    : 'bg-wm-bg-hover text-wm-text-muted border border-wm-border hover:bg-wm-bg-elevated',
                ].join(' ')}
                title={activeOnSiteFilter
                  ? 'Showing only templates already in use on this site'
                  : 'Filter to templates already in use on this site'}
              >
                <Layers size={10} />
                Active on site ({activeOnSiteIds.size})
                {activeOnSiteFilter && <X size={10} />}
              </button>
            )}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-wm-text-subtle">
            {loading ? 'Loading…' : `${visible.length} of ${rows.length} templates`}
            {rankedIds && rankedIds.length > 0 && !loading && (
              <span className="ml-1 text-wm-accent-strong">· ranked</span>
            )}
          </p>
          {onRequestAIRank && (
            <WMButton
              variant="ghost"
              size="sm"
              iconLeft={<Sparkles size={11} />}
              loading={aiRanking}
              onClick={() => void onRequestAIRank()}
            >
              {aiRanking ? 'Ranking…' : 'Suggest with AI'}
            </WMButton>
          )}
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[4/3] rounded-md bg-wm-bg-hover animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-10 text-sm text-wm-text-muted">
            No templates match these filters.
            {familyFilterActive && familyFilter && familyFilter.length > 0 && (
              <div className="mt-3">
                <WMButton variant="secondary" size="sm" onClick={() => setFamilyFilterActive(false)}>
                  Show all families
                </WMButton>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((t, idx) => {
              const isSelected = draftSelection.includes(t.id)
              const isSiteLibrary = !!siteLibraryIds?.has(t.id)
              const isActiveOnSite = !!activeOnSiteIds?.has(t.id)
              // Inject section headers (full-width grid rows) so the
              // strategist can see where the site-library tier ends and
              // the broader catalog begins. The boundaries fall between
              // the last library row and the first non-library row.
              const prevIsLibrary = idx > 0 ? !!siteLibraryIds?.has(visible[idx - 1].id) : false
              const isFirst        = idx === 0
              const showLibraryHeader  = isFirst && isSiteLibrary
              const showCatalogHeader  = !isSiteLibrary && (isFirst || prevIsLibrary)
              return (
                <Fragment key={t.id}>
                {showLibraryHeader && (
                  <p className="col-span-2 text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong flex items-center gap-1.5 mb-0">
                    <Star size={10} className="fill-wm-accent-strong" /> Site library
                  </p>
                )}
                {showCatalogHeader && (
                  <p className="col-span-2 text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mt-2 mb-0">
                    Brixies catalog
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleCardClick(t.id)}
                  className={[
                    'group text-left rounded-md overflow-hidden border bg-wm-bg-elevated transition-all relative',
                    isSelected
                      ? 'border-wm-accent ring-2 ring-wm-accent/30'
                      : isSiteLibrary
                        ? 'border-wm-accent ring-1 ring-wm-accent/20 hover:shadow-md'
                        : 'border-wm-border hover:border-wm-border-focus hover:shadow-sm',
                  ].join(' ')}
                >
                  {/* Site library banner — full-width strip at the top of the
                      card so curated picks are unmistakable. */}
                  {isSiteLibrary && (
                    <div
                      title="In the project's Global Elements library"
                      className="bg-wm-accent text-white px-2.5 py-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
                    >
                      <Star size={10} className="fill-white" /> Site library
                    </div>
                  )}
                  <div className="relative aspect-[4/3] bg-wm-bg-hover">
                    {t.preview_image_url ? (
                      <img src={t.preview_image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-[10px] text-wm-text-subtle">no preview</div>
                    )}
                    {isSelected && (
                      <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-wm-accent text-white inline-flex items-center justify-center">
                        <Check size={12} />
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-[12px] font-semibold text-wm-text truncate">{t.layer_name}</p>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-[10px] text-wm-text-subtle truncate">{t.family}</p>
                      <WMStatusPill tone="neutral" size="sm">{t.kind}</WMStatusPill>
                    </div>
                    {isActiveOnSite && (
                      <p
                        className="text-[10px] mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold uppercase tracking-widest"
                        title="This template is already bound on at least one page in this project"
                      >
                        <Layers size={9} /> Active on site
                      </p>
                    )}
                    {cardSubtitles?.[t.id] && (
                      <p className="text-[10px] text-wm-accent-strong italic mt-1.5 line-clamp-2" title={cardSubtitles[t.id]}>
                        {cardSubtitles[t.id]}
                      </p>
                    )}
                  </div>
                </button>
                </Fragment>
              )
            })}
          </div>
        )}
      </div>
    </WMFlyoutPanel>
  )
}
