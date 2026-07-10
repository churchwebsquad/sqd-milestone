/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Design Handoff — Layout Swap Board.
 *
 * One row per distinct wireframe Brixies layout used on this project's
 * pages. Designer picks a site-wide Figma replacement (one swap, fans
 * out across every slot using that layout). Per-section overrides
 * collapse beneath each row when the designer wants ONE specific slot
 * to break from the site-wide default.
 *
 * Storage:
 *   - Site-wide swap → strategy_web_projects.figma_layout_swaps jsonb
 *       { from_template_id: { to_template_id, note, swapped_at, swapped_by } }
 *   - Per-section override → web_sections.figma_template_override_id
 *       (+ figma_swap_note / figma_swap_at / figma_swap_by)
 *
 * Render rule (effective layout shown in Figma + dev handoff):
 *   section_override
 *     ?? project_swap[content_template_id]?.to_template_id
 *     ?? content_template_id
 *
 * The page editor + content pipeline ignore both swap layers entirely —
 * this UI is metadata-only for handoff.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Layers, Loader2, RefreshCw, X, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { effectiveFigmaTemplate, groupSectionsByWireframeTemplate, setProjectSwap, clearProjectSwap } from '../../lib/webFigmaLayoutSwap'
import { composeSectionName } from '../../lib/webSectionRoles'
import type { StrategyWebProject, WebContentTemplate, WebPage, WebSection } from '../../types/database'

interface Props {
  project: StrategyWebProject
  /** Refresh project from host after the swap map writes — lets the
   *  parent's effective resolver pick up the new state. */
  onChange?: () => Promise<void>
  /** v2 merge: take the style-guide-load-checklist state. When provided,
   *  each row renders a "Loaded" checkbox alongside the swap target so
   *  the designer manages both surfaces from one place. */
  loadedTemplateIds?: string[]
  onToggleLoaded?: (templateId: string, loaded: boolean) => Promise<void> | void
}

interface SectionWithPage extends WebSection {
  pageName:      string
  pageSlug:      string
  pageSortOrder: number
}

export function LayoutSwapBoard({ project, onChange, loadedTemplateIds, onToggleLoaded }: Props) {
  const loadedSet = useMemo(() => new Set(loadedTemplateIds ?? []), [loadedTemplateIds])
  const [loading, setLoading] = useState(true)
  const [sections, setSections] = useState<SectionWithPage[]>([])
  /** All templates in the catalog, keyed by id. Used to render names +
   *  drive the swap picker filtered by family. */
  const [templates, setTemplates] = useState<Record<string, WebContentTemplate>>({})
  /** Working copy of the project's swap map. Edits are persisted on
   *  blur via saveProjectSwaps; this state mirrors what's in the DB. */
  const [swaps, setSwaps] = useState<StrategyWebProject['figma_layout_swaps']>(project.figma_layout_swaps ?? {})
  const [savingSwap, setSavingSwap] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)

  // Reload when the project changes (e.g. after the parent's onChange fires)
  useEffect(() => {
    setSwaps(project.figma_layout_swaps ?? {})
  }, [project.figma_layout_swaps])

  const load = useCallback(async () => {
    setLoading(true)
    // Pull every section on this project (joined to page name) + the
    // template catalog (the swap picker needs every layout's metadata).
    const [{ data: pagesData }, { data: tplData }] = await Promise.all([
      supabase
        .from('web_pages')
        .select('id, name, slug, sort_order, archived, web_sections:web_sections(*)')
        .eq('web_project_id', project.id)
        .eq('archived', false)
        .order('sort_order'),
      supabase
        .from('web_content_templates')
        .select('id, layer_name, family, figma_component_key'),
    ])
    const flat: SectionWithPage[] = []
    for (const p of (pagesData ?? []) as Array<WebPage & { web_sections: WebSection[] }>) {
      for (const s of p.web_sections ?? []) {
        flat.push({
          ...s,
          pageName:      p.name ?? p.slug,
          pageSlug:      p.slug,
          pageSortOrder: p.sort_order ?? 0,
        })
      }
    }
    // Order: page sort_order (natural site nav order), then section
    // sort_order within the page. Alphabetical-by-name was wrong here
    // because page sort_order != alphabetical.
    flat.sort((a, b) => {
      if (a.pageSortOrder !== b.pageSortOrder) return a.pageSortOrder - b.pageSortOrder
      return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    })
    setSections(flat)
    const tplMap: Record<string, WebContentTemplate> = {}
    for (const t of (tplData ?? []) as WebContentTemplate[]) tplMap[t.id] = t
    setTemplates(tplMap)
    setLoading(false)
  }, [project.id])

  useEffect(() => { void load() }, [load])

  /** Group sections by their wireframe content_template_id — each
   *  group becomes one row of the swap board. */
  const groupedRows = useMemo(() => {
    const map = groupSectionsByWireframeTemplate(sections)
    const rows = Array.from(map.entries())
      .map(([templateId, secs]) => ({
        templateId,
        template: templates[templateId],
        sections: secs,
      }))
      // Order: most-used layouts first, then alphabetical
      .sort((a, b) => {
        if (a.sections.length !== b.sections.length) return b.sections.length - a.sections.length
        return (a.template?.layer_name ?? '').localeCompare(b.template?.layer_name ?? '')
      })
    return rows
  }, [sections, templates])

  /** Every template in the catalog, sorted by layer_name. The free-
   *  text input on the main row + the per-section override dropdown
   *  both pull from this. Previously the main row was family-filtered
   *  ("hero only swaps to hero"); per the strategist + designer ask,
   *  the swap target is now any Brixies template OR an arbitrary
   *  free-text label. */
  const allTemplatesSorted = useMemo(() =>
    Object.values(templates).slice().sort((a, b) => (a.layer_name ?? '').localeCompare(b.layer_name ?? '')),
    [templates],
  )

  const saveProjectSwapMap = async (
    nextSwaps: StrategyWebProject['figma_layout_swaps'],
    fromTemplateId: string,
  ) => {
    setSavingSwap(fromTemplateId)
    setSwaps(nextSwaps)
    setSaveError(null)
    const { error } = await (supabase as any)
      .from('strategy_web_projects')
      .update({ figma_layout_swaps: nextSwaps })
      .eq('id', project.id)
    setSavingSwap(null)
    if (error) {
      console.error('[LayoutSwapBoard] swap save failed:', error)
      setSaveError(`Couldn't save swap: ${error.message}`)
      // Optimistic UI rollback so the picker reflects what's actually
      // persisted, not what we tried to write.
      setSwaps(project.figma_layout_swaps ?? {})
      return
    }
    await onChange?.()
  }

  /** Save a swap from a free-text input. The designer may type either:
   *    - A known template's layer_name (we look it up and store the id)
   *    - An arbitrary string (a Brixies variant not in our catalog yet)
   *  Empty string clears the swap. */
  const handleSiteSwapText = async (fromTemplateId: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) {
      const next = clearProjectSwap(swaps, fromTemplateId)
      await saveProjectSwapMap(next, fromTemplateId)
      return
    }
    // Lookup by layer_name (case-insensitive). Falls back to free-text
    // when no catalog template matches.
    const lower = trimmed.toLowerCase()
    const match = Object.values(templates).find(t => t.layer_name.toLowerCase() === lower)
    const { data: { session } } = await supabase.auth.getSession()
    const next = setProjectSwap(swaps, fromTemplateId, {
      to_template_id:    match?.id ?? '',
      to_template_label: trimmed,
      note:              swaps[fromTemplateId]?.note ?? null,
      swapped_at:        new Date().toISOString(),
      swapped_by:        session?.user?.id ?? '',
    })
    await saveProjectSwapMap(next, fromTemplateId)
  }

  const handleSiteSwapNote = async (fromTemplateId: string, note: string) => {
    const entry = swaps[fromTemplateId]
    if (!entry) return
    const next = setProjectSwap(swaps, fromTemplateId, {
      ...entry,
      note: note.trim() || null,
      swapped_at: new Date().toISOString(),
    })
    await saveProjectSwapMap(next, fromTemplateId)
  }

  const toggleRowExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <Layers size={13} />
            <h2 className="text-[13px] font-bold uppercase tracking-widest">Layout swap board</h2>
          </div>
          <p className="text-[12px] text-wm-text-muted mt-1 max-w-2xl">
            One row per Brixies layout in use across this site. Pick a Figma replacement
            for the layout and the choice applies everywhere it's used. Expand a row to
            override the swap for individual slots. The lo-fi wireframe in the page editor
            stays on the original layout — these notes only inform the Figma style guide
            and the dev handoff.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-wm-text-muted hover:text-wm-text px-2 py-1 rounded hover:bg-wm-bg-hover disabled:opacity-50"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      </div>

      {saveError && (
        <div className="mb-3 rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 text-[11.5px] text-wm-danger flex items-start gap-2">
          <span className="flex-1">{saveError}</span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-wm-danger hover:opacity-70 shrink-0"
            aria-label="Dismiss"
          ><X size={11} /></button>
        </div>
      )}

      {loading ? (
        <div className="py-6 grid place-items-center text-wm-text-muted">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : groupedRows.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-wm-text-muted">
          No Brixies-bound sections yet. Bind sections to layouts in the Pages workspace and they'll appear here.
        </p>
      ) : (
        <div className="space-y-2">
          {groupedRows.map(row => {
            const swapEntry = row.templateId in swaps ? swaps[row.templateId] : null
            const swapTemplate = swapEntry?.to_template_id ? templates[swapEntry.to_template_id] : null
            const family = row.template?.family ?? '(uncategorized)'
            const isExpanded = expanded.has(row.templateId)
            const saving = savingSwap === row.templateId
            const isLoadedInStyleGuide = loadedSet.has(row.templateId)
            // The displayed swap value: label first (free-text or
            // designer-typed match), else look up the catalog id.
            const swapDisplayValue = swapEntry?.to_template_label
              ?? swapTemplate?.layer_name
              ?? ''
            return (
              <div key={row.templateId} className="rounded-md border border-wm-border bg-wm-bg-hover/30">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleRowExpand(row.templateId)}
                    className="text-wm-text-muted hover:text-wm-text shrink-0"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>

                  {/* Style-guide load checkbox — only when host wires it.
                      Lets the designer track "this template is loaded
                      into the Figma style guide" on the same row as
                      the swap target. */}
                  {onToggleLoaded && (
                    <label
                      className="inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      title={isLoadedInStyleGuide ? 'Loaded into the Figma style guide' : 'Not yet loaded into the Figma style guide'}
                    >
                      <input
                        type="checkbox"
                        checked={isLoadedInStyleGuide}
                        onChange={(e) => { void onToggleLoaded(row.templateId, e.target.checked) }}
                        className="accent-wm-accent cursor-pointer"
                        aria-label={`Loaded in style guide: ${row.template?.layer_name ?? 'template'}`}
                      />
                      <span className="text-[9px] uppercase tracking-wider font-bold text-wm-text-subtle">Loaded</span>
                    </label>
                  )}

                  {/* Wireframe layout name + section count */}
                  <div className="min-w-[12rem] shrink-0">
                    <p className={[
                      'text-[12px] font-semibold leading-tight',
                      isLoadedInStyleGuide ? 'text-wm-text-subtle line-through' : 'text-wm-text',
                    ].join(' ')}>
                      {row.template?.layer_name ?? '(unknown template)'}
                    </p>
                    <p className="text-[10px] text-wm-text-subtle">
                      {family} · {row.sections.length} slot{row.sections.length === 1 ? '' : 's'}
                    </p>
                  </div>

                  <ArrowRight size={11} className="text-wm-text-muted shrink-0" />

                  {/* Figma swap target — free-text input. Designer can
                      type any Brixies template name; matching catalog
                      entries autocomplete via the datalist below. Non-
                      matching values are preserved as free-text labels
                      (Brixies variants we haven't catalogued). */}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <input
                      type="text"
                      list={`tpl-options-${row.templateId}`}
                      defaultValue={swapDisplayValue}
                      onBlur={e => void handleSiteSwapText(row.templateId, e.target.value)}
                      placeholder={`Type a Brixies template name (or leave blank to use ${row.template?.layer_name ?? 'wireframe layout'})`}
                      disabled={saving}
                      className="flex-1 min-w-0 text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:border-wm-accent focus:outline-none disabled:opacity-50"
                    />
                    <datalist id={`tpl-options-${row.templateId}`}>
                      {allTemplatesSorted.map(t => (
                        <option key={t.id} value={t.layer_name}>{t.family ?? '(uncategorized)'}</option>
                      ))}
                    </datalist>
                    {swapEntry && (
                      <button
                        type="button"
                        onClick={() => void handleSiteSwapText(row.templateId, '')}
                        className="text-wm-text-muted hover:text-wm-danger shrink-0"
                        title="Clear swap"
                      >
                        <X size={12} />
                      </button>
                    )}
                    {saving && <Loader2 size={11} className="animate-spin text-wm-accent shrink-0" />}
                  </div>
                </div>

                {/* Site-wide note + per-section overrides */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-wm-border space-y-3">
                    {swapEntry && (
                      <div className="mt-3">
                        <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                          Swap note (optional)
                        </label>
                        <textarea
                          defaultValue={swapEntry.note ?? ''}
                          onBlur={e => void handleSiteSwapNote(row.templateId, e.target.value)}
                          placeholder={`Why ${swapTemplate?.layer_name ?? 'the swap'}? e.g. "reads cleaner on long page titles"`}
                          rows={2}
                          className="w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:border-wm-accent focus:outline-none resize-y leading-snug"
                        />
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
                        Slots using this layout ({row.sections.length})
                      </p>
                      <div className="space-y-1">
                        {row.sections.map(s => (
                          <SectionOverrideRow
                            key={s.id}
                            section={s}
                            swapTemplate={swapTemplate ?? null}
                            wireframeTemplate={row.template ?? null}
                            candidates={allTemplatesSorted}
                            allTemplates={templates}
                            projectSwaps={swaps}
                            onChange={onChange}
                            onError={msg => setSaveError(msg)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Per-section override row — designer can break a single slot from
 *  the site-wide swap and pick a different layout (or revert to the
 *  wireframe original). */
function SectionOverrideRow({
  section, swapTemplate, wireframeTemplate, candidates, allTemplates, projectSwaps, onChange, onError,
}: {
  section: SectionWithPage
  swapTemplate: WebContentTemplate | null
  wireframeTemplate: WebContentTemplate | null
  candidates: WebContentTemplate[]
  /** Full template catalog so we can name an override even when it's
   *  from a different family than the wireframe layout. */
  allTemplates: Record<string, WebContentTemplate>
  projectSwaps: StrategyWebProject['figma_layout_swaps']
  onChange?: () => Promise<void>
  /** Surface save errors to the parent banner. */
  onError?: (message: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [overrideId, setOverrideId] = useState<string>(section.figma_template_override_id ?? '')
  const [note, setNote] = useState<string>(section.figma_swap_note ?? '')

  const effective = effectiveFigmaTemplate(section, projectSwaps)
  // Look up the effective template from the FULL catalog so cross-
  // family overrides display with their real name. Falls back to the
  // wireframe/swap template references for the common same-family case.
  const effectiveTemplate =
    (effective.effective_template_id && allTemplates[effective.effective_template_id]) ??
    (effective.effective_template_id === wireframeTemplate?.id ? wireframeTemplate : null) ??
    (effective.effective_template_id === swapTemplate?.id     ? swapTemplate     : null)

  const saveOverride = async (toId: string, noteVal: string) => {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await (supabase as any)
      .from('web_sections')
      .update({
        figma_template_override_id: toId || null,
        figma_swap_note: noteVal.trim() || null,
        figma_swap_at:   new Date().toISOString(),
        figma_swap_by:   session?.user?.id ?? null,
      })
      .eq('id', section.id)
    setSaving(false)
    if (error) {
      console.error('[SectionOverrideRow] override save failed:', error)
      onError?.(`Couldn't save override for "${section.pageName}" section: ${error.message}`)
      // Rollback the optimistic state so the picker reflects what's
      // actually persisted.
      setOverrideId(section.figma_template_override_id ?? '')
      setNote(section.figma_swap_note ?? '')
      return
    }
    await onChange?.()
  }

  const handleOverridePick = (val: string) => {
    setOverrideId(val)
    void saveOverride(val, note)
  }
  const handleNoteBlur = () => {
    if ((note.trim() || null) === (section.figma_swap_note ?? null)) return
    void saveOverride(overrideId, note)
  }

  const display = composeSectionName({
    page:    { name: section.pageName },
    section: { sort_order: section.sort_order ?? 0, section_role: section.section_role, section_role_label: section.section_role_label },
  })

  return (
    <div className="rounded border border-wm-border/60 bg-wm-bg px-2.5 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-wm-text flex-1 min-w-0 truncate" title={display}>{display}</span>
        <span className="text-[10px] text-wm-text-subtle shrink-0">
          {effective.source === 'section_override' && <>Override → <b className="text-wm-accent">{(effectiveTemplate as any)?.layer_name ?? overrideId}</b></>}
          {effective.source === 'project_swap'     && <>Site-wide → <b>{(swapTemplate as any)?.layer_name}</b></>}
          {effective.source === 'wireframe'        && <>Wireframe → <b>{(wireframeTemplate as any)?.layer_name}</b></>}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          value={overrideId}
          onChange={e => handleOverridePick(e.target.value)}
          disabled={saving}
          className="flex-1 min-w-0 text-[11.5px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-0.5 focus:border-wm-accent focus:outline-none disabled:opacity-50"
        >
          <option value="">(use site-wide swap or wireframe)</option>
          {candidates.map(c => (
            <option key={c.id} value={c.id}>{c.layer_name}</option>
          ))}
        </select>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={handleNoteBlur}
          placeholder="Note (optional)"
          className="w-48 shrink-0 text-[11.5px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-0.5 focus:border-wm-accent focus:outline-none"
        />
        {saving && <Loader2 size={11} className="animate-spin text-wm-accent shrink-0" />}
        {overrideId && !saving && <Check size={11} className="text-wm-success shrink-0" />}
      </div>
    </div>
  )
}
