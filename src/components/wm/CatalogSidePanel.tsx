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

import { useEffect, useMemo, useState } from 'react'
import { Search, Check, Sparkles } from 'lucide-react'
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
  rankedIds, cardSubtitles, onRequestAIRank, aiRanking,
}: WMCatalogSidePanelProps) {
  const [rows, setRows] = useState<WebContentTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [draftSelection, setDraftSelection] = useState<string[]>([...selectedIds])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraftSelection([...selectedIds])
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rows.filter(r => {
      if (kindFilter && kindFilter.length > 0 && !kindFilter.includes(r.kind)) return false
      if (familyFilter && familyFilter.length > 0) {
        const fam = r.family.toLowerCase()
        if (!familyFilter.some(f => f.toLowerCase() === fam)) return false
      }
      if (!q) return true
      return `${r.family} ${r.layer_name} ${r.id}`.toLowerCase().includes(q)
    })
    // Apply optional ranking — keep ids in `rankedIds` order, then
    // append everything else in the original (family, layer_name) order.
    if (rankedIds && rankedIds.length > 0) {
      const order = new Map(rankedIds.map((id, idx) => [id, idx]))
      return [...filtered].sort((a, b) => {
        const ai = order.has(a.id) ? order.get(a.id)! : Number.MAX_SAFE_INTEGER
        const bi = order.has(b.id) ? order.get(b.id)! : Number.MAX_SAFE_INTEGER
        return ai - bi
      })
    }
    return filtered
  }, [rows, query, kindFilter, familyFilter, rankedIds])

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
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map(t => {
              const isSelected = draftSelection.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void handleCardClick(t.id)}
                  className={[
                    'group text-left rounded-md overflow-hidden border bg-wm-bg-elevated transition-all',
                    isSelected
                      ? 'border-wm-accent ring-2 ring-wm-accent/30'
                      : 'border-wm-border hover:border-wm-border-focus hover:shadow-sm',
                  ].join(' ')}
                >
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
                    {cardSubtitles?.[t.id] && (
                      <p className="text-[10px] text-wm-accent-strong italic mt-1.5 line-clamp-2" title={cardSubtitles[t.id]}>
                        {cardSubtitles[t.id]}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </WMFlyoutPanel>
  )
}
