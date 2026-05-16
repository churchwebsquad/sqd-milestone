/**
 * Web Manager — Pages workspace (Phase B).
 *
 * Two-pane authoring surface:
 *   - Left: scrollable list of project pages, grouped by phase, with
 *     status pills + AI draft attribution.
 *   - Right: active page editor — page header (title, slug, phase,
 *     status) + section blocks (collapsed / expanded) backed by Brixies
 *     content templates. Each block renders inputs per the template's
 *     `fields` schema: text, richtext (TipTap), cta, image, url, email,
 *     phone, form-input. Groups render with +/− repeaters and recursive
 *     item_schema.
 *
 * Active page is tracked in URL `?tab=pages&page=<id>` so navigating
 * from Sitemap workspace's page rows lands directly on the right page.
 *
 * Phase B scope:
 *   - Page editor + TipTap richtext ✓
 *   - Section blocks rendering ✓
 *   - Per-page status flip + AI attribution ✓
 *   - Add section via Catalog side panel ✓
 *   - Drag-reorder sections — deferred
 *   - 'Redo with AI' per section — placeholder (no agent until Phase C)
 *
 * Phase C plug-in points (already typed in field_values shape):
 *   - AI fills field_values via the copywriter agent
 *   - AI redo opens context modal, streams replacement, accept/reject
 *   - Audit engine scans this surface against heuristics
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FileText, Loader2, ChevronDown, ChevronRight, Plus, Trash2,
  Sparkles, RotateCw, Eye, Edit3, GripVertical, MoreHorizontal, Upload, Archive,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { loadEditorSnippets } from '../../../lib/webSnippets'
import { WMCard } from '../Card'
import { WMButton } from '../Button'
import { WMIconButton } from '../IconButton'
import { WMStatusPill } from '../StatusPill'
import type { WMStatusTone } from '../StatusPill'
import { WMRichTextEditor } from '../RichTextEditor'
import type { WMSnippetOption } from '../RichTextEditor'
import { WMCatalogSidePanel } from '../CatalogSidePanel'
import { WMAIAttribution } from '../AIAttribution'
import { PageBriefImportModal } from '../PageBriefImportModal'
import { AddPageModal } from '../AddPageModal'
import { SitemapProposalBanner } from '../SitemapProposalBanner'
import { ConfirmDialog } from '../ConfirmDialog'
import { PagePreview } from '../PagePreview'
import { WMSegmentedToggle } from '../SegmentedToggle'
import { BrixiesEditor } from '../brixies/BrixiesEditor'
import { fieldValuesToDocHtml, docHtmlToFieldValues } from '../../../lib/webBrixiesDoc'
import { refreshSnippetChips, extractSuggestedFamily, type PageBrief } from '../../../lib/webPageBrief'
import {
  composeBind, findBriefSection, extractSectionIdFromNotes,
  rankVariantsByBrief, type RankedVariant,
} from '../../../lib/webBindTemplate'
import { parseCuratedLibrary } from '../../../lib/webCuratedLibrary'
import type {
  StrategyWebProject, WebPage, WebSection, WebContentTemplate,
  WebFieldDef, WebSlotDef, WebGroupDef, WebTemplateKind,
} from '../../../types/database'

interface Props {
  project: StrategyWebProject
  /** Refresh the project row from the host — used after the Stage 2
   *  proposal commits new pages so the top-level project state (and
   *  the proposal banner's _meta.committed_at) updates. */
  onChange?: () => Promise<void>
}

type FieldValues = Record<string, unknown>

/** Snippets context — lets nested editor instances pull the project's
 *  snippet list without prop-drilling through every section / field. */
const SnippetsContext = createContext<readonly WMSnippetOption[]>([])
const useEditorSnippets = () => useContext(SnippetsContext)

const STATUS_TONES: Record<WebPage['content_status'], WMStatusTone> = {
  draft:     'neutral',
  in_review: 'info',
  approved:  'success',
  archived:  'neutral',
}

export function PagesWorkspace({ project, onChange }: Props) {
  const [params, setParams] = useSearchParams()
  const [pages, setPages] = useState<WebPage[]>([])
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePage] = useState<WebPage | null>(null)
  const [snippets, setSnippets] = useState<readonly WMSnippetOption[]>([])
  const [importOpen, setImportOpen] = useState(false)
  // Add Page modal — opened from the left panel per phase. The state
  // holds the target phase key so the modal pre-fills it.
  const [addPageInPhase, setAddPageInPhase] = useState<string | null>(null)
  // Bulk selection for archive — left panel checkboxes (hover-reveal
  // by default, persistent once anything is selected).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Archive confirmation modal (single or bulk).
  const [archiveConfirm, setArchiveConfirm] = useState<
    | { kind: 'single'; id: string; name: string }
    | { kind: 'bulk' }
    | null
  >(null)
  const [archiving, setArchiving] = useState(false)

  const activePageId = params.get('page')

  // Load snippets once on project change — re-load whenever a snippet
  // is added downstream (right rail / Snippets workspace) by also
  // listening to project mutations.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await loadEditorSnippets(project)
      if (!cancelled) setSnippets(list)
    })()
    return () => { cancelled = true }
  }, [project])

  const loadPages = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('web_pages')
      .select('*')
      .eq('web_project_id', project.id)
      .eq('archived', false)
      .order('sort_order')
    setPages((data ?? []) as WebPage[])
    setLoading(false)
  }

  useEffect(() => { void loadPages() }, [project.id])

  useEffect(() => {
    if (!activePageId) { setActivePage(null); return }
    const p = pages.find(p => p.id === activePageId)
    setActivePage(p ?? null)
  }, [activePageId, pages])

  const selectPage = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('page', id)
    setParams(next, { replace: true })
  }

  const clearActivePageSelection = () => {
    const next = new URLSearchParams(params)
    next.delete('page')
    setParams(next, { replace: true })
  }

  const togglePageSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const clearBulkSelection = () => setSelectedIds(new Set())

  const requestArchive = (id: string) => {
    const page = pages.find(p => p.id === id)
    if (!page) return
    setArchiveConfirm({ kind: 'single', id, name: page.name })
  }

  const requestBulkArchive = () => {
    if (selectedIds.size === 0) return
    setArchiveConfirm({ kind: 'bulk' })
  }

  const executeArchive = async () => {
    setArchiving(true)
    try {
      const idsToArchive: string[] = archiveConfirm?.kind === 'bulk'
        ? [...selectedIds]
        : archiveConfirm?.kind === 'single'
          ? [archiveConfirm.id]
          : []
      if (idsToArchive.length === 0) return
      await supabase.from('web_pages').update({ archived: true }).in('id', idsToArchive)
      // If the active page got archived, drop it from the URL.
      if (activePage && idsToArchive.includes(activePage.id)) {
        clearActivePageSelection()
      }
      clearBulkSelection()
      setArchiveConfirm(null)
      await loadPages()
    } finally {
      setArchiving(false)
    }
  }

  return (
    <SnippetsContext.Provider value={snippets}>
      <div className="flex min-h-[calc(100vh-120px)]">
        {/* Page list (left) */}
        <aside className="w-72 shrink-0 border-r border-wm-border bg-wm-bg-elevated overflow-y-auto flex flex-col">
          {/* Import action — always available */}
          <div className="p-3 border-b border-wm-border sticky top-0 bg-wm-bg-elevated z-10">
            <WMButton
              variant="secondary"
              size="sm"
              iconLeft={<Upload size={11} />}
              onClick={() => setImportOpen(true)}
              className="w-full"
            >
              Import from brief
            </WMButton>
          </div>
          {/* Bulk selection toolbar — visible only with 1+ checked */}
          {selectedIds.size > 0 && (
            <div className="p-3 border-b border-wm-border bg-wm-ai-bg/40 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-wm-text">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-1">
                <WMIconButton label="Clear selection" size="sm" onClick={clearBulkSelection}>
                  <Trash2 size={11} />
                </WMIconButton>
                <WMButton variant="danger" size="sm" iconLeft={<Archive size={11} />} onClick={requestBulkArchive}>
                  Archive
                </WMButton>
              </div>
            </div>
          )}
          <PageList
            pages={pages}
            loading={loading}
            activeId={activePage?.id ?? null}
            selectedIds={selectedIds}
            onSelect={selectPage}
            onToggleSelection={togglePageSelection}
            onArchive={requestArchive}
            onAddPageInPhase={(phase) => setAddPageInPhase(phase)}
          />
        </aside>

        {/* Active page editor (right) */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="px-6 md:px-10 pt-6 max-w-4xl mx-auto">
            <SitemapProposalBanner
              project={project}
              onCommitted={async () => {
                await loadPages()
                if (onChange) await onChange()
              }}
              onRefreshed={async () => {
                if (onChange) await onChange()
              }}
            />
          </div>
          {activePage ? (
            <PageEditor
              page={activePage}
              project={project}
              onPageChange={async () => {
                await loadPages()
              }}
              onArchived={() => { clearActivePageSelection(); void loadPages() }}
            />
          ) : (
            <EmptyEditor
              pageCount={pages.length}
              onImport={() => setImportOpen(true)}
              onAddPage={() => setAddPageInPhase('1')}
            />
          )}
        </main>
      </div>

      <PageBriefImportModal
        project={project}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async (result) => {
          await loadPages()
          setImportOpen(false)
          const next = new URLSearchParams(params)
          next.set('page', result.page_id)
          setParams(next, { replace: true })
        }}
      />

      {addPageInPhase && (
        <AddPageModal
          projectId={project.id}
          phase={addPageInPhase}
          existingPages={pages}
          onClose={() => setAddPageInPhase(null)}
          onCreated={async () => { setAddPageInPhase(null); await loadPages() }}
        />
      )}

      <ConfirmDialog
        open={archiveConfirm !== null}
        title={
          archiveConfirm?.kind === 'bulk'
            ? `Archive ${selectedIds.size} page${selectedIds.size === 1 ? '' : 's'}?`
            : `Archive "${archiveConfirm?.kind === 'single' ? archiveConfirm.name : ''}"?`
        }
        body={
          archiveConfirm?.kind === 'bulk' ? (
            <div>
              <p className="mb-2">These pages will be archived:</p>
              <ul className="space-y-0.5 text-wm-text">
                {[...selectedIds].map(id => {
                  const p = pages.find(x => x.id === id)
                  return p ? <li key={id}>· {p.name} <code className="text-wm-text-subtle text-[11px]">/{p.slug}</code></li> : null
                })}
              </ul>
              <p className="mt-3">Archived pages disappear from the tree but stay in the database. Re-running Stage 2's commit won't bring them back automatically.</p>
            </div>
          ) : (
            'Archived pages disappear from the tree but stay in the database. You can restore manually from Supabase if needed.'
          )
        }
        confirmLabel={
          archiveConfirm?.kind === 'bulk'
            ? `Archive ${selectedIds.size} page${selectedIds.size === 1 ? '' : 's'}`
            : 'Archive page'
        }
        destructive
        loading={archiving}
        onConfirm={executeArchive}
        onCancel={() => { if (!archiving) setArchiveConfirm(null) }}
      />
    </SnippetsContext.Provider>
  )
}

// ── Page list ─────────────────────────────────────────────────────────

function PageList({
  pages, loading, activeId, selectedIds,
  onSelect, onToggleSelection, onArchive, onAddPageInPhase,
}: {
  pages: WebPage[]
  loading: boolean
  activeId: string | null
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onToggleSelection: (id: string) => void
  onArchive: (id: string) => void
  onAddPageInPhase: (phase: string) => void
}) {
  const byPhase = useMemo(() => {
    const m = new Map<string, WebPage[]>()
    for (const p of pages) {
      const k = p.phase
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    return m
  }, [pages])

  const PHASES: Array<{ key: string; label: string }> = [
    { key: 'global',   label: 'Global'   },
    { key: '1',        label: 'Phase 1'  },
    { key: '2',        label: 'Phase 2'  },
    { key: 'nav-only', label: 'Nav-only' },
  ]

  const selectionActive = selectedIds.size > 0

  if (loading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-wm-bg-hover animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="py-3 flex-1">
      {PHASES.map(phase => {
        const list = byPhase.get(phase.key) ?? []
        return (
          <div key={phase.key} className="mb-4">
            <div className="px-4 mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
                {phase.label}{list.length > 0 ? ` · ${list.length}` : ''}
              </p>
              <button
                type="button"
                onClick={() => onAddPageInPhase(phase.key)}
                className="text-wm-text-subtle hover:text-wm-accent-strong transition-colors"
                title={`Add page to ${phase.label}`}
              >
                <Plus size={12} />
              </button>
            </div>
            {list.length === 0 ? (
              <button
                type="button"
                onClick={() => onAddPageInPhase(phase.key)}
                className="mx-3 block w-[calc(100%-1.5rem)] rounded-md border border-dashed border-wm-border bg-wm-bg p-2.5 text-[11px] text-wm-text-muted hover:border-wm-border-focus hover:text-wm-text transition-colors"
              >
                + Add a page
              </button>
            ) : (
              <div className="space-y-0.5">
                {list.map(p => {
                  const isSelected = selectedIds.has(p.id)
                  return (
                    <div
                      key={p.id}
                      className={[
                        'group relative flex items-center border-l-2 transition-colors',
                        p.id === activeId
                          ? 'bg-wm-bg-selected border-wm-accent'
                          : isSelected
                            ? 'bg-wm-ai-bg/30 border-transparent'
                            : 'border-transparent hover:bg-wm-bg-hover',
                      ].join(' ')}
                    >
                      <label className={[
                        'shrink-0 pl-3 py-2 cursor-pointer flex items-center justify-center transition-opacity',
                        selectionActive || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      ].join(' ')}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelection(p.id)}
                          className="accent-wm-accent cursor-pointer"
                          aria-label={`Select ${p.name}`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => onSelect(p.id)}
                        className="min-w-0 flex-1 text-left px-2 py-2 flex items-center gap-2"
                      >
                        <FileText size={13} className="text-wm-text-subtle shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-wm-text truncate">{p.name}</p>
                          <p className="text-[10px] text-wm-text-subtle truncate">/{p.slug}</p>
                        </div>
                        <WMStatusPill tone={STATUS_TONES[p.content_status]} size="sm">
                          {p.content_status === 'in_review' ? 'review' : p.content_status}
                        </WMStatusPill>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onArchive(p.id) }}
                        className="shrink-0 pr-2 py-2 text-wm-text-subtle hover:text-wm-danger opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Archive page"
                      >
                        <Archive size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────

function EmptyEditor({
  pageCount, onImport, onAddPage,
}: {
  pageCount: number
  onImport: () => void
  onAddPage: () => void
}) {
  return (
    <div className="grid place-items-center px-10 py-16">
      <div className="text-center max-w-md">
        <FileText size={32} className="text-wm-text-subtle mx-auto mb-3" />
        <h2 className="text-[15px] font-semibold text-wm-text mb-1">
          {pageCount > 0 ? 'Pick a page to begin' : 'No pages yet'}
        </h2>
        <p className="text-[12px] text-wm-text-muted mb-4">
          {pageCount > 0
            ? 'Pages appear in the left panel grouped by phase. Import a page brief from cowork or pick one to start editing.'
            : 'Import a page brief from cowork, or add the first page directly.'}
        </p>
        <div className="flex items-center justify-center gap-2">
          <WMButton
            variant="primary"
            size="sm"
            iconLeft={<Upload size={11} />}
            onClick={onImport}
          >
            Import page brief
          </WMButton>
          <WMButton
            variant="secondary"
            size="sm"
            iconLeft={<Plus size={11} />}
            onClick={onAddPage}
          >
            Add a page
          </WMButton>
        </div>
      </div>
    </div>
  )
}

/** Best-effort HTML serialization of a section's field_values when
 *  unbinding to freehand and there's no overflow stash to fall back on.
 *  Walks the template's slots in order, emitting headings for heading-
 *  shaped slots and paragraphs for the rest. Groups serialize as nested
 *  lists. Lossy by design — the brief→template flow is the round-trip,
 *  this is just rescue copy. */
function serializeFieldValuesToHtml(
  values: Record<string, unknown>,
  template: WebContentTemplate | null | undefined,
): string {
  if (!template) {
    const body = typeof values.body === 'string' ? values.body : ''
    return body
  }
  const parts: string[] = []
  for (const field of template.fields) {
    if (field.kind === 'slot') {
      const v = values[field.key]
      if (v == null || v === '') continue
      if (field.type === 'richtext' && typeof v === 'string') {
        parts.push(v)
      } else if (field.type === 'cta' && typeof v === 'object' && v !== null) {
        const obj = v as { label?: string; url?: string }
        if (obj.label) parts.push(`<p><a href="${obj.url ?? '#'}">${obj.label}</a></p>`)
      } else if (typeof v === 'string') {
        const level = field.heading_level
        if (level) parts.push(`<h${level}>${v}</h${level}>`)
        else parts.push(`<p>${v}</p>`)
      }
    } else {
      const items = Array.isArray(values[field.key]) ? values[field.key] as Record<string, unknown>[] : []
      if (items.length === 0) continue
      parts.push(`<p><strong>${field.key.replace(/_/g, ' ')}:</strong></p>`)
      parts.push('<ul>')
      for (const item of items) {
        const summary = Object.entries(item)
          .filter(([, val]) => typeof val === 'string' && val !== '')
          .map(([, val]) => val as string)
          .join(' — ')
        if (summary) parts.push(`<li>${summary}</li>`)
      }
      parts.push('</ul>')
    }
  }
  return parts.join('')
}

// ── Page editor (right pane) ──────────────────────────────────────────

function PageEditor({
  page, project, onPageChange, onArchived,
}: {
  page: WebPage
  project: StrategyWebProject
  onPageChange: () => Promise<void>
  onArchived: () => void
}) {
  const [titleDraft, setTitleDraft] = useState(page.name)
  const [slugDraft, setSlugDraft] = useState(page.slug)
  const [titleDirty, setTitleDirty] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)

  const [sections, setSections] = useState<WebSection[]>([])
  const [templates, setTemplates] = useState<Record<string, WebContentTemplate>>({})
  const [loadingSections, setLoadingSections] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Edit ↔ Preview mode for the page editor body.
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  // Bind-to-template flow: when set, opens the catalog panel pre-filtered
  // by the brief-suggested family and routes the pick into bindSection().
  const [bindingSection, setBindingSection] = useState<WebSection | null>(null)
  // Cached ranking for the open bind panel — both the deterministic
  // baseline (computed when the panel opens) and the AI re-rank (filled
  // on demand by the "Suggest with AI" button).
  const [bindRanking, setBindRanking] = useState<RankedVariant[]>([])
  const [bindAIRankingInFlight, setBindAIRankingInFlight] = useState(false)
  // Page brief, loaded once per page. Drives the brief→slot auto-fill on
  // bind. Lookups are by `Section ID: <id>` on web_sections.notes.
  const pageBrief = (page.brief as PageBrief | null | undefined) ?? null

  // Flatten the project's curated library into a Set of template ids
  // so the catalog picker can badge them as "Site library" picks.
  const siteLibraryIds = useMemo(() => {
    const lib = parseCuratedLibrary(project.curated_library)
    return new Set<string>(Object.values(lib).flat())
  }, [project.curated_library])

  useEffect(() => {
    setTitleDraft(page.name); setSlugDraft(page.slug); setTitleDirty(false)
  }, [page.id])

  const loadSections = async () => {
    setLoadingSections(true)
    const { data: sectionRows } = await supabase
      .from('web_sections')
      .select('*')
      .eq('web_page_id', page.id)
      .order('sort_order')
    const list = (sectionRows ?? []) as WebSection[]
    setSections(list)
    const ids = [...new Set(list.map(s => s.content_template_id))]
    if (ids.length > 0) {
      const { data: tplRows } = await supabase
        .from('web_content_templates')
        .select('*')
        .in('id', ids)
      const map: Record<string, WebContentTemplate> = {}
      for (const t of (tplRows ?? []) as WebContentTemplate[]) map[t.id] = t
      setTemplates(map)
    } else {
      setTemplates({})
    }
    setLoadingSections(false)
  }
  useEffect(() => { void loadSections() }, [page.id])

  // When the bind panel opens, compute the deterministic ranking of
  // candidate templates against the brief section's content shape. This
  // hydrates the panel with a sensible default ordering before the user
  // clicks "Suggest with AI". Reset to [] when the panel closes.
  //
  // We load templates broadly (substring-match on family when present,
  // otherwise everything) so the ranking covers anything the catalog
  // panel might show — the panel's own family filter is tolerant in the
  // same way, so the two stay in sync even when the brief's family name
  // doesn't exactly equal the DB family name ("Hero" vs "Hero Section").
  useEffect(() => {
    if (bindingSection == null) {
      setBindRanking([])
      return
    }
    const family = extractSuggestedFamily(bindingSection.notes)
    const briefSectionId = extractSectionIdFromNotes(bindingSection.notes)
    const briefSection = findBriefSection(pageBrief, briefSectionId)
    let cancelled = false
    void (async () => {
      let q = supabase
        .from('web_content_templates')
        .select('*')
      if (family) q = q.ilike('family', `%${family}%`)
      const { data } = await q
      if (cancelled) return
      let candidates = (data ?? []) as WebContentTemplate[]
      // Fallback — if the family substring matched nothing, rank against
      // the full catalog so the panel still gets a useful ordering.
      if (candidates.length === 0) {
        const { data: all } = await supabase.from('web_content_templates').select('*')
        candidates = (all ?? []) as WebContentTemplate[]
      }
      // Rank, then force site-library picks to the head of the list so
      // they're always visible first when binding.
      const ranked = rankVariantsByBrief(briefSection, candidates)
      const sitePicks: RankedVariant[] = []
      const rest: RankedVariant[] = []
      for (const r of ranked) {
        if (siteLibraryIds.has(r.template.id)) sitePicks.push(r)
        else rest.push(r)
      }
      setBindRanking([...sitePicks, ...rest])
    })()
    return () => { cancelled = true }
  }, [bindingSection, pageBrief])

  const saveTitleSlug = async () => {
    setSavingTitle(true)
    await supabase
      .from('web_pages')
      .update({ name: titleDraft.trim(), slug: slugDraft.trim() })
      .eq('id', page.id)
    setSavingTitle(false); setTitleDirty(false)
    await onPageChange()
  }

  const setStatus = async (status: WebPage['content_status']) => {
    await supabase.from('web_pages').update({ content_status: status }).eq('id', page.id)
    await onPageChange()
  }

  const markEdited = async () => {
    if (!page.edited_since_ai && page.ai_drafted_at) {
      await supabase.from('web_pages').update({ edited_since_ai: true }).eq('id', page.id)
      await onPageChange()
    }
  }

  const archivePage = async () => {
    if (!confirm(`Archive "${page.name}"?`)) return
    await supabase.from('web_pages').update({ archived: true }).eq('id', page.id)
    onArchived()
  }

  const addSection = async (templateId: string) => {
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.sort_order), 0)
    await supabase.from('web_sections').insert({
      web_page_id: page.id,
      content_template_id: templateId,
      field_values: {},
      sort_order: maxOrder + 1,
    })
    await loadSections()
  }

  /** Add a freehand TipTap-only section. User-facing escape hatch when
   *  the right Brixies template doesn't exist yet. AI agents (Phase C)
   *  MUST NOT use this path — every AI-drafted section gets a template. */
  const addFreehandSection = async () => {
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.sort_order), 0)
    await supabase.from('web_sections').insert({
      web_page_id: page.id,
      content_template_id: null,
      field_values: { body: '' },
      sort_order: maxOrder + 1,
    })
    await loadSections()
  }

  const updateSection = async (sectionId: string, patch: Partial<WebSection>) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ...patch } : s))
    await supabase.from('web_sections').update(patch).eq('id', sectionId)
    void markEdited()
  }

  const archiveSection = async (sectionId: string) => {
    if (!confirm('Remove this section?')) return
    await supabase.from('web_sections').delete().eq('id', sectionId)
    await loadSections()
    void markEdited()
  }

  /** Bind a freehand section to a Brixies template.
   *  Two sources fill the slots:
   *    1. The page brief's `fields` object (if cowork's brief includes
   *       this section — looked up by `Section ID:` in section.notes).
   *    2. Heuristic mapping from the freehand body HTML (h1 → heading,
   *       <p> → body, etc.) for anything the brief didn't cover.
   *  The original freehand body is always stashed under `__overflow_html`
   *  so the strategist can verify nothing was dropped, route remaining
   *  copy manually, then clear the overflow when satisfied. */
  const bindSection = async (sectionId: string, templateId: string) => {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    const { data: tplRow } = await supabase
      .from('web_content_templates')
      .select('*')
      .eq('id', templateId)
      .maybeSingle()
    if (!tplRow) return
    const template = tplRow as WebContentTemplate

    const currentValues = (section.field_values ?? {}) as FieldValues
    // Source HTML for re-binding:
    //   - Freehand section: body field
    //   - Already-bound section (Change template): serialize current
    //     slot values + any existing residual back to HTML, so the new
    //     bind has everything to work with.
    let sourceHtml =
      typeof currentValues.body === 'string' && section.content_template_id == null
        ? currentValues.body
        : ''
    if (!sourceHtml && section.content_template_id != null) {
      const currentTpl = templates[section.content_template_id]
      sourceHtml = serializeFieldValuesToHtml(currentValues, currentTpl)
      const existingResidual = typeof currentValues.__overflow_html === 'string'
        ? currentValues.__overflow_html
        : ''
      if (existingResidual) sourceHtml += existingResidual
    } else if (!sourceHtml) {
      sourceHtml = typeof currentValues.__overflow_html === 'string'
        ? currentValues.__overflow_html
        : ''
    }

    // Find the brief section by ID (notes carries "Section ID: <id>" from
    // the importer). When binding a hand-added section, briefSection is null
    // and only the body heuristic runs.
    const briefSectionId = extractSectionIdFromNotes(section.notes)
    const briefSection = findBriefSection(pageBrief, briefSectionId)

    const composed = composeBind(briefSection, sourceHtml, template)
    const nextValues: FieldValues = { ...composed.field_values }
    // Stash ONLY the residual — chunks of the freehand body that didn't
    // get routed into any slot. If everything mapped, residual is empty
    // and no overflow panel renders. Keeps the editor from showing the
    // same prose twice (slot + overflow).
    if (composed.residual_html) nextValues.__overflow_html = composed.residual_html
    // Stash the source report for the "what mapped" badge on the section
    // header. Hidden from field iteration by the underscore prefix.
    if (composed.source_report.unmatched_brief_keys.length > 0
        || composed.source_report.missing_slots.length > 0) {
      nextValues.__bind_report = composed.source_report
    }

    await updateSection(sectionId, {
      content_template_id: templateId,
      field_values: nextValues,
    })
    await loadSections()
  }

  /** Unbind a template-bound section back to freehand. Restores the
   *  overflow stash as the new freehand body so all the brief content is
   *  immediately editable again. If no overflow exists (rare — strategist
   *  cleared it), serialize the current slot values to HTML as a best-
   *  effort body. */
  const unbindSection = async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    const values = (section.field_values ?? {}) as FieldValues
    let body =
      typeof values.__overflow_html === 'string' ? values.__overflow_html : ''
    if (!body) {
      body = serializeFieldValuesToHtml(values, templates[section.content_template_id ?? ''])
    }
    await updateSection(sectionId, {
      content_template_id: null,
      field_values: { body },
    })
    await loadSections()
  }

  /** Re-rank the bind panel's candidates using the AI suggest endpoint.
   *  The deterministic ranking is already populated by the bindingSection
   *  effect; this overlays the AI-refined order + per-card rationale on
   *  top so the strategist sees voice/intent-aware suggestions. */
  const aiRankBindCandidates = async () => {
    if (!bindingSection || bindRanking.length === 0) return
    const briefSectionId = extractSectionIdFromNotes(bindingSection.notes)
    const briefSection = findBriefSection(pageBrief, briefSectionId)
    if (!briefSection) return  // no brief → nothing for AI to weigh on
    setBindAIRankingInFlight(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const resp = await fetch('/api/web/agents/suggest-template-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          briefSection,
          candidates: bindRanking.map(r => ({
            id: r.template.id,
            family: r.template.family,
            layer_name: r.template.layer_name,
            kind: r.template.kind,
            fields: r.template.fields.map(f => f.kind === 'slot'
              ? { kind: f.kind, key: f.key }
              : { kind: f.kind, key: f.key, default_count: f.default_count }),
          })),
          pageContext: `Page: ${page.name} (${page.slug}). Brief purpose: ${briefSection.purpose ?? '(none)'}.`,
        }),
      })
      if (!resp.ok) {
        console.error('[suggest-variant] non-200', await resp.text())
        return
      }
      const { ranking } = await resp.json() as {
        ranking: Array<{ template_id: string; rationale: string }>
      }
      const byId = new Map(bindRanking.map(r => [r.template.id, r.template]))
      setBindRanking(ranking
        .map((r, i) => {
          const tpl = byId.get(r.template_id)
          if (!tpl) return null
          return { template: tpl, score: ranking.length - i, rationale: r.rationale }
        })
        .filter((r): r is RankedVariant => r !== null))
    } finally {
      setBindAIRankingInFlight(false)
    }
  }

  /** Clear the overflow stash once the strategist has finished routing the
   *  freehand copy into slot fields. */
  const clearOverflow = async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    const currentValues = (section.field_values ?? {}) as FieldValues
    if (!('__overflow_html' in currentValues)) return
    const { __overflow_html: _drop, ...rest } = currentValues
    void _drop
    await updateSection(sectionId, { field_values: rest })
  }

  return (
    <div className="px-6 md:px-10 py-6 md:py-8 max-w-4xl mx-auto">
      {/* Page header */}
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <WMStatusPill tone={STATUS_TONES[page.content_status]} size="md">
              {page.content_status === 'in_review' ? 'in review' : page.content_status}
            </WMStatusPill>
            {page.ai_drafted_at && (
              <WMAIAttribution
                draftedAt={page.ai_drafted_at}
                muted={page.edited_since_ai}
                label={page.edited_since_ai ? 'AI draft (edited)' : 'AI draft'}
              />
            )}
            <span className="text-[11px] text-wm-text-subtle">Phase {page.phase}</span>
          </div>
          <div className="flex items-center gap-2">
            <WMSegmentedToggle
              options={[
                { key: 'edit',    label: 'Edit',    icon: <Edit3 size={11} /> },
                { key: 'preview', label: 'Preview', icon: <Eye size={11} /> },
              ]}
              active={viewMode}
              onChange={setViewMode}
            />
            <StatusMenu current={page.content_status} onChange={setStatus} />
            <WMIconButton label="More page actions" onClick={archivePage}>
              <MoreHorizontal size={14} />
            </WMIconButton>
          </div>
        </div>

        <input
          type="text"
          value={titleDraft}
          onChange={e => { setTitleDraft(e.target.value); setTitleDirty(true) }}
          onBlur={() => { if (titleDirty) void saveTitleSlug() }}
          className="w-full text-3xl font-bold text-wm-text bg-transparent outline-none focus:bg-wm-bg-hover rounded px-1 -mx-1 py-0.5 transition-colors"
        />
        <div className="mt-1 flex items-center gap-1 text-[12px] text-wm-text-subtle">
          <span>/</span>
          <input
            type="text"
            value={slugDraft}
            onChange={e => { setSlugDraft(e.target.value); setTitleDirty(true) }}
            onBlur={() => { if (titleDirty) void saveTitleSlug() }}
            className="bg-transparent outline-none focus:bg-wm-bg-hover rounded px-1 -mx-1 py-0.5 transition-colors text-wm-text-muted min-w-0 flex-1"
          />
          {savingTitle && <Loader2 size={11} className="animate-spin" />}
        </div>
      </header>

      {/* Preview mode — JPG-stacked low-fi wireframe. Click any thumb to
          jump back to the Edit view scrolled to that section (Phase v2:
          render brixies source_html with live copy in iframes). */}
      {viewMode === 'preview' ? (
        <PagePreview
          sections={sections}
          templates={templates}
          onSelectSection={(id) => {
            setViewMode('edit')
            queueMicrotask(() => {
              document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
          }}
        />
      ) : (

      /* Section blocks */
      <div className="space-y-6">
        {loadingSections ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-wm-bg-hover animate-pulse" />
          ))
        ) : sections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-wm-border bg-wm-bg p-8 text-center">
            <Plus size={20} className="text-wm-text-subtle mx-auto mb-2" />
            <p className="text-[13px] font-semibold text-wm-text">Add the first section</p>
            <p className="text-[11px] text-wm-text-muted mt-1 mb-4">
              In Phase C the AI copywriter pre-drafts every page. For now, add sections manually.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <WMButton variant="primary" size="sm" iconLeft={<Plus size={12} />} onClick={() => setPickerOpen(true)}>
                From template
              </WMButton>
              <WMButton variant="secondary" size="sm" iconLeft={<Plus size={12} />} onClick={() => void addFreehandSection()}>
                Freehand
              </WMButton>
            </div>
          </div>
        ) : (
          sections.map(section => (
            <SectionBlock
              key={section.id}
              section={section}
              template={section.content_template_id ? templates[section.content_template_id] : null}
              onChange={(patch) => void updateSection(section.id, patch)}
              onRemove={() => void archiveSection(section.id)}
              onBindRequest={() => setBindingSection(section)}
              onUnbindRequest={() => void unbindSection(section.id)}
              onClearOverflow={() => void clearOverflow(section.id)}
            />
          ))
        )}

        {/* + Add section between/below */}
        {sections.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex-1 rounded-md border border-dashed border-wm-border bg-wm-bg py-3 inline-flex items-center justify-center gap-1.5 text-[12px] font-semibold text-wm-text-muted hover:border-wm-border-focus hover:text-wm-text transition-colors"
            >
              <Plus size={12} /> Add from template
            </button>
            <button
              type="button"
              onClick={() => void addFreehandSection()}
              className="rounded-md border border-dashed border-wm-border bg-wm-bg py-3 px-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-wm-text-muted hover:border-wm-border-focus hover:text-wm-text transition-colors"
              title="Add a freehand TipTap-only block — for one-off copy outside the Brixies template set"
            >
              <Plus size={12} /> Freehand
            </button>
          </div>
        )}
      </div>
      )}

      {/* Catalog picker — add a new section */}
      <WMCatalogSidePanel
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add a section"
        subtitle={page.name}
        kindFilter={['content', 'media', 'post_template'] as readonly WebTemplateKind[]}
        siteLibraryIds={siteLibraryIds}
        mode="single"
        onSelect={async (ids) => { if (ids[0]) await addSection(ids[0]) }}
      />

      {/* Catalog picker — bind a freehand section to a Brixies template.
          Pre-filtered by the brief-suggested family when present so the
          strategist lands on the right variants immediately. Ranked by
          structural fit; AI re-rank available when a brief is present. */}
      <WMCatalogSidePanel
        open={bindingSection !== null}
        onClose={() => setBindingSection(null)}
        title="Bind to Brixies template"
        subtitle={bindingSection
          ? (extractSuggestedFamily(bindingSection.notes) ?? page.name)
          : page.name}
        kindFilter={['content', 'media', 'post_template'] as readonly WebTemplateKind[]}
        familyFilter={bindingSection && extractSuggestedFamily(bindingSection.notes)
          ? [extractSuggestedFamily(bindingSection.notes)!]
          : undefined}
        mode="single"
        rankedIds={bindRanking.map(r => r.template.id)}
        siteLibraryIds={siteLibraryIds}
        cardSubtitles={Object.fromEntries(bindRanking.map(r => [r.template.id, r.rationale]))}
        onRequestAIRank={
          // Only offer AI ranking when there's a brief to weigh on.
          (bindingSection && findBriefSection(pageBrief, extractSectionIdFromNotes(bindingSection.notes)))
            ? aiRankBindCandidates
            : undefined
        }
        aiRanking={bindAIRankingInFlight}
        onSelect={async (ids) => {
          if (bindingSection && ids[0]) {
            await bindSection(bindingSection.id, ids[0])
            setBindingSection(null)
          }
        }}
      />
    </div>
  )
}

// ── Section block ─────────────────────────────────────────────────────

function SectionBlock({
  section, template, onChange, onRemove, onBindRequest, onUnbindRequest, onClearOverflow,
}: {
  section: WebSection
  template: WebContentTemplate | null | undefined
  onChange: (patch: Partial<WebSection>) => void
  onRemove: () => void
  onBindRequest: () => void
  onUnbindRequest: () => void
  onClearOverflow: () => void
}) {
  const [open, setOpen] = useState(true)
  const [actionsOpen, setActionsOpen] = useState(false)
  const values = (section.field_values ?? {}) as FieldValues
  const isFreehand = section.content_template_id == null
  const suggestedFamily = extractSuggestedFamily(section.notes)
  const overflowHtml = typeof values.__overflow_html === 'string' ? values.__overflow_html : null
  const bindReport = values.__bind_report as
    | { matched_from_brief: string[]; matched_from_body: string[]; missing_slots: string[]; unmatched_brief_keys: string[] }
    | undefined

  // Bind quality — green = fully mapped, yellow = some overflow / missing
  // slots, red = freehand or major unmapped content. Drives the dot at
  // the section header so the strategist can scan for what needs review.
  const bindQuality: 'good' | 'partial' | 'attention' =
    isFreehand ? 'attention'
    : !bindReport ? 'good'
    : (bindReport.unmatched_brief_keys.length > 0 || bindReport.missing_slots.length > 1) ? 'partial'
    : 'good'

  const setValue = (key: string, v: unknown) => {
    onChange({ field_values: { ...values, [key]: v } })
  }

  // Template was referenced but isn't in the catalog — broken state
  if (!isFreehand && !template) {
    return (
      <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg p-4">
        <p className="text-[12px] text-wm-danger">
          Section's template (id: <code>{section.content_template_id}</code>) not found in the catalog.
        </p>
      </div>
    )
  }

  // Header content varies for freehand vs template-bound
  const headerLabel = isFreehand ? 'Freehand section' : template!.layer_name
  const headerFamily = isFreehand ? null : template!.family
  const headerKind   = isFreehand ? 'freehand' : template!.kind

  return (
    <div
      id={`section-${section.id}`}
      className={[
        'group/section relative scroll-mt-6 transition-colors',
        // Document-style — no enclosing card, just a left border accent
        // on hover/focus to keep the page reading like prose, not forms.
        'border-l-2 pl-4 py-2',
        isFreehand
          ? 'border-wm-warning/40 hover:border-wm-warning'
          : bindQuality === 'good'
            ? 'border-wm-success/40 hover:border-wm-success'
            : bindQuality === 'partial'
              ? 'border-wm-warning/40 hover:border-wm-warning'
              : 'border-wm-border hover:border-wm-border-strong',
      ].join(' ')}
    >
      {/* Block header — compact toolbar with the bind-quality dot,
          section title, and action affordances. Background blends with
          the main editor canvas so individual sections feel like
          consecutive paragraphs of one doc, not separate cards. */}
      <div className="flex items-center gap-2 mb-2 -ml-1">
        <GripVertical size={13} className="text-wm-text-subtle cursor-grab shrink-0 opacity-0 group-hover/section:opacity-100 transition-opacity" />
        <span
          className={[
            'shrink-0 w-2 h-2 rounded-full',
            bindQuality === 'good' ? 'bg-wm-success'
            : bindQuality === 'partial' ? 'bg-wm-warning'
            : 'bg-wm-text-subtle',
          ].join(' ')}
          title={
            bindQuality === 'good' ? 'Bound cleanly — no overflow'
            : bindQuality === 'partial' ? 'Bound with overflow or missing slots'
            : 'Freehand — needs a template'
          }
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle hover:text-wm-accent-strong transition-colors min-w-0"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="truncate">{headerLabel}</span>
        </button>
        {headerFamily && (
          <span className="text-[9px] tracking-wide text-wm-text-subtle italic">· {headerFamily}</span>
        )}
        {isFreehand && (
          <WMStatusPill tone="warning" size="sm">{headerKind}</WMStatusPill>
        )}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 transition-opacity">
          {!isFreehand && (
            <WMIconButton label="Redo with AI" size="sm">
              <Sparkles size={13} />
            </WMIconButton>
          )}
          <div className="relative">
            <WMIconButton
              label="Section actions"
              size="sm"
              onClick={() => setActionsOpen(o => !o)}
            >
              <MoreHorizontal size={13} />
            </WMIconButton>
            {actionsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
                <div className="absolute right-0 mt-1 w-48 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1 animate-wm-slide-in-up">
                  {!isFreehand && (
                    <>
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); onBindRequest() }}
                        className="w-full text-left px-3 py-1.5 text-[12px] text-wm-text hover:bg-wm-bg-hover font-semibold"
                      >
                        Change template…
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); onUnbindRequest() }}
                        className="w-full text-left px-3 py-1.5 text-[12px] text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text"
                      >
                        Unbind to freehand
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <WMIconButton label="Remove section" size="sm" onClick={onRemove}>
            <Trash2 size={13} />
          </WMIconButton>
        </div>
      </div>

      {/* Block body */}
      {open && (
        <div className="space-y-4">
          {isFreehand ? (
            <FreehandBody
              value={typeof values.body === 'string' ? values.body : ''}
              onChange={(v) => setValue('body', v)}
              suggestedFamily={suggestedFamily}
              onBindRequest={onBindRequest}
            />
          ) : (
            <>
              {bindReport && <BindReportBadge report={bindReport} />}
              {overflowHtml && (
                <OverflowPanel html={overflowHtml} onClear={onClearOverflow} />
              )}
              {template!.fields.length === 0 ? (
                <p className="text-[12px] text-wm-text-subtle italic">This template has no editable fields.</p>
              ) : (
                <BrixiesSectionContent
                  values={values}
                  template={template!}
                  onChangeFieldValues={(next) => onChange({ field_values: next })}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Detect whether a template field is "doc-handled" — represented in
 *  the Brixies TipTap editor rather than the form-row stack below it.
 *  Tagline / heading / richtext body / CTA / image slots + CTA-shaped
 *  groups + the first card-shaped group flow through the editor;
 *  everything else (additional groups, datetime, boolean) stays as
 *  form rows. */
function isDocHandledField(field: WebFieldDef, template: WebContentTemplate): boolean {
  if (field.kind === 'slot') {
    const c = field.key.toLowerCase().replace(/[_\s-]+/g, '')
    if (field.heading_level || c === 'h' || c.includes('heading') || c.includes('title')) return true
    if (c.includes('tagline') || c.includes('eyebrow') || c.includes('kicker')) return true
    if (field.type === 'richtext') return true
    if (field.type === 'cta') return true
    if (field.type === 'image') return true
    return false
  }
  // CTA-shaped group → handled as a stream of CTA nodes.
  const c = field.key.toLowerCase().replace(/[_\s-]+/g, '')
  const isCta = c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
  if (isCta) return true
  // First card-shaped group on the template → handled as a Card Grid
  // node. Additional card-shaped groups (rare) still render as form
  // rows below.
  const isCardShape = c.includes('card') || c === 'items' || c === 'features'
    || c === 'tiles' || c === 'blocks' || c === 'list' || c === 'rows'
    || c === 'pillars' || c === 'tiers' || c === 'programs'
    || c === 'members' || c === 'groups' || c === 'classes'
    || c === 'events' || c === 'steps' || c === 'doctrines'
    || c === 'values' || c === 'routing'
  if (!isCardShape) return false
  const firstCardGroup = template.fields.find(f => {
    if (f.kind !== 'group') return false
    const fc = f.key.toLowerCase().replace(/[_\s-]+/g, '')
    if (fc === 'cta' || fc === 'ctas' || fc.includes('button') || fc.includes('action')) return false
    return fc.includes('card') || fc === 'items' || fc === 'features'
      || fc === 'tiles' || fc === 'blocks' || fc === 'list' || fc === 'rows'
      || fc === 'pillars' || fc === 'tiers' || fc === 'programs'
      || fc === 'members' || fc === 'groups' || fc === 'classes'
      || fc === 'events' || fc === 'steps' || fc === 'doctrines'
      || fc === 'values' || fc === 'routing'
  })
  return firstCardGroup?.key === field.key
}

/** The Brixies-aware content surface for a bound section. One TipTap
 *  editor handles the doc-shaped slots (tagline + heading + body + CTAs);
 *  any remaining slots / groups render as form rows below.
 *
 *  Round-trip: field_values → doc HTML on first mount, then editor
 *  changes drive doc state; on each change docHtmlToFieldValues stuffs
 *  the new doc back into the template's slots and the section row is
 *  patched. Group items (cards) stay in field_values and are edited
 *  via the form rows below — they're preserved across doc edits. */
function BrixiesSectionContent({
  values, template, onChangeFieldValues,
}: {
  values: FieldValues
  template: WebContentTemplate
  onChangeFieldValues: (next: FieldValues) => void
}) {
  const snippets = useEditorSnippets()
  // The doc IS the source of truth once mounted. We initialize ONCE
  // from field_values; further changes flow editor → values, never the
  // other way around. Avoids the parent-derives-from-values ping-pong
  // that was killing cursor position and CTA input focus on every keystroke.
  //
  // External writes to field_values (AI redo, etc.) require remounting —
  // SectionBlock's key is the section id, so changing sections rebuilds.
  // If an out-of-band write happens to the same section, the strategist
  // can re-open it to pick up the new content.
  const [docHtml, setDocHtml] = useState<string>(() => fieldValuesToDocHtml(values, template))

  // We keep a ref to the latest non-doc values so the change handler
  // can preserve them without subscribing to values changes via state
  // (which would re-trigger the editor).
  const valuesRef = useRef(values)
  valuesRef.current = values

  const handleDocChange = (nextDoc: string) => {
    setDocHtml(nextDoc)
    // Translate the doc back to field_values, preserving group items
    // and non-doc slots untouched. Read from the ref so we always see
    // the latest values without re-rendering when they change.
    const v = valuesRef.current
    const preserved: Record<string, unknown> = {}
    for (const f of template.fields) {
      if (!isDocHandledField(f, template)) preserved[f.key] = v[f.key]
    }
    for (const k of Object.keys(v)) {
      if (k.startsWith('__')) preserved[k] = v[k]
    }
    const { field_values } = docHtmlToFieldValues(nextDoc, template, preserved)
    onChangeFieldValues(field_values)
  }

  // Doc-handled fields are rendered by the editor; everything else
  // (additional groups, datetime/boolean slots, secondary cards groups)
  // renders as form rows below under "Other fields".
  const remainingFields = template.fields.filter(f => !isDocHandledField(f, template))

  return (
    <div className="space-y-4">
      <BrixiesEditor
        value={docHtml}
        onChange={handleDocChange}
        snippets={snippets}
        placeholder="Start writing the section content…"
      />
      {remainingFields.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-wm-border/60">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Other fields
          </p>
          {remainingFields.map((f, i) => (
            <FieldRow
              key={f.key + '-' + i}
              field={f}
              value={values[f.key]}
              onChange={(v) => {
                onChangeFieldValues({ ...values, [f.key]: v })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Bind report — surfaces what the auto-mapping did when a freehand
 *  section was bound to a template. Strategist sees at a glance which
 *  slots came from the brief vs body heuristics, and what didn't land. */
function BindReportBadge({
  report,
}: {
  report: { matched_from_brief: string[]; matched_from_body: string[]; missing_slots: string[]; unmatched_brief_keys: string[] }
}) {
  const briefCount = report.matched_from_brief.length
  const bodyCount = report.matched_from_body.length
  const missing = report.missing_slots
  const unmatched = report.unmatched_brief_keys
  return (
    <div className="rounded-md border border-wm-info/30 bg-wm-info-bg/60 p-3">
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-info">Auto-fill summary</p>
      <ul className="mt-1 space-y-0.5 text-[12px] text-wm-text">
        {briefCount > 0 && <li>{briefCount} slot{briefCount === 1 ? '' : 's'} from page brief</li>}
        {bodyCount > 0 && <li>{bodyCount} slot{bodyCount === 1 ? '' : 's'} from body heuristics</li>}
        {missing.length > 0 && (
          <li className="text-wm-text-muted">
            {missing.length} slot{missing.length === 1 ? '' : 's'} still empty: <span className="font-mono text-[11px]">{missing.slice(0, 6).join(', ')}{missing.length > 6 ? '…' : ''}</span>
          </li>
        )}
        {unmatched.length > 0 && (
          <li className="text-wm-warning">
            {unmatched.length} brief field{unmatched.length === 1 ? '' : 's'} unmapped: <span className="font-mono text-[11px]">{unmatched.slice(0, 6).join(', ')}{unmatched.length > 6 ? '…' : ''}</span> — check the overflow panel.
          </li>
        )}
      </ul>
    </div>
  )
}

/** Overflow panel — the freehand body that was stashed when a section was
 *  bound to a template. Renders read-only as a reference so the strategist
 *  can route copy into the slot fields below, then clears the stash. */
function OverflowPanel({ html, onClear }: { html: string; onClear: () => void }) {
  return (
    <div className="rounded-md border border-wm-warning/40 bg-wm-warning-bg/60 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest font-bold text-wm-warning">
            Overflow content
          </p>
          <p className="text-[11px] text-wm-text-muted mt-0.5">
            Original freehand copy — route the pieces into the fields below, then clear.
          </p>
        </div>
        <WMButton variant="ghost" size="sm" onClick={onClear}>
          Clear
        </WMButton>
      </div>
      <div
        className="wm-theme prose-sm max-w-none text-[13px] text-wm-text bg-wm-bg-elevated rounded p-2 border border-wm-border max-h-64 overflow-auto"
        // The stash is HTML produced by our own brief renderer / TipTap.
        // No untrusted input pathway lands here — strategist-authored only.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

/** Freehand body — same Brixies-aware TipTap editor used for bound
 *  sections. No template means no slot mapping; the doc HTML is saved
 *  as-is to `field_values.body`. AI agents always bind sections to a
 *  template, so freehand is the manual-authoring path. */
function FreehandBody({
  value, onChange, suggestedFamily, onBindRequest,
}: {
  value: string
  onChange: (v: string) => void
  suggestedFamily: string | null
  onBindRequest: () => void
}) {
  const snippets = useEditorSnippets()
  return (
    <div className="space-y-3">
      {/* Bind CTA — prominent when a brief-suggested family is present,
          quieter when the section is purely strategist-authored. */}
      <div className={[
        'rounded-md border p-3 flex items-center gap-3 flex-wrap',
        suggestedFamily
          ? 'border-wm-accent/40 bg-wm-accent-tint'
          : 'border-dashed border-wm-border bg-wm-bg',
      ].join(' ')}>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-wm-text">
            {suggestedFamily
              ? `Suggested template family: ${suggestedFamily}`
              : 'Freehand section — bind to a Brixies template to flow into Design and Dev exports.'}
          </p>
          {suggestedFamily && (
            <p className="text-[11px] text-wm-text-muted mt-0.5">
              From the page brief. Bind to pick a variant; the freehand copy below is preserved.
            </p>
          )}
        </div>
        <WMButton variant="primary" size="sm" onClick={onBindRequest}>
          Bind to template
        </WMButton>
      </div>

      <BrixiesEditor
        value={value}
        onChange={onChange}
        snippets={snippets}
        placeholder="Start writing — use the Brixies block toolbar to add tagline, headings, CTAs, card grids, images."
      />
    </div>
  )
}

/** RichTextEditor wrapper that auto-supplies snippets from context and
 *  refreshes any existing snippet chips against the current library
 *  before passing the HTML to TipTap. This is the "page inherits the
 *  filled content once the snippet is fixed" behavior — every load
 *  re-resolves stale chips. */
function RichTextWithSnippets(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const snippets = useEditorSnippets()
  // Memo because refreshSnippetChips parses + walks DOM — cheap but not free.
  const refreshedValue = useMemo(
    () => refreshSnippetChips(props.value, snippets),
    [props.value, snippets],
  )
  return (
    <WMRichTextEditor
      value={refreshedValue}
      onChange={props.onChange}
      placeholder={props.placeholder}
      headingLevels={[2, 3, 4, 5]}
      snippets={snippets}
    />
  )
}

// ── Field rendering — slot vs group ──────────────────────────────────

function FieldRow({
  field, value, onChange,
}: {
  field: WebFieldDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (field.kind === 'group') return <GroupRow group={field} value={value} onChange={onChange} />
  // Hide empty optional image slots — they clutter the editor when the
  // brief had no image and the strategist isn't ready to source one.
  // Required image slots and slots that already have a value still render.
  if (field.type === 'image' && !field.required) {
    const stringVal = typeof value === 'string' ? value : ''
    if (!stringVal) return null
  }
  return <SlotRow slot={field} value={value} onChange={onChange} />
}

/** Classify a slot into a label "kind" for color coding. Mirrors the
 *  squad-os web-hub pattern: heading=accent, cta=teal, quote=indigo,
 *  placeholder/unmapped=amber, etc. */
function slotLabelKind(slot: WebSlotDef): 'heading' | 'subhead' | 'body' | 'cta' | 'image' | 'tagline' | 'other' {
  if (slot.heading_level === 1) return 'heading'
  if (slot.heading_level && slot.heading_level >= 2) return 'subhead'
  const k = slot.key.toLowerCase().replace(/[_\s-]+/g, '')
  if (k.includes('tagline') || k.includes('eyebrow') || k.includes('kicker')) return 'tagline'
  if (slot.type === 'cta' || (slot.type === 'text' && slot.scope === 'button')) return 'cta'
  if (slot.type === 'image') return 'image'
  if (slot.type === 'richtext' || k.includes('body') || k.includes('content') || k.includes('description')) return 'body'
  if (k.includes('heading') || k === 'h' || k.includes('title')) return 'heading'
  return 'other'
}

const LABEL_KIND_TONES: Record<ReturnType<typeof slotLabelKind>, string> = {
  heading:  'text-wm-accent-strong  bg-wm-accent-tint    border-wm-accent/30',
  subhead:  'text-wm-accent-strong  bg-wm-accent-tint    border-wm-accent/20',
  tagline:  'text-wm-text-muted     bg-wm-bg-hover       border-wm-border',
  body:     'text-wm-text-muted     bg-wm-bg-hover       border-wm-border',
  cta:      'text-emerald-700       bg-emerald-50        border-emerald-200',
  image:    'text-wm-text-muted     bg-wm-bg-hover       border-wm-border',
  other:    'text-wm-text-muted     bg-wm-bg-hover       border-wm-border',
}

/** Small bracketed pill label rendered above each slot value. Borrows
 *  the squad-os web-hub aesthetic — [H1 HEADLINE], [SUB-HEADLINE],
 *  [PRIMARY CTA BUTTON], color-coded by kind. */
function SlotLabel({ slot, override }: { slot: WebSlotDef; override?: string }) {
  const kind = slotLabelKind(slot)
  // Display text — explicit override first, then a friendly form of the
  // slot's label / key with heading_level adornment.
  const base = override ?? slot.label ?? slot.key.replace(/_/g, ' ')
  let display = base.toUpperCase()
  if (slot.heading_level && !/H\d/.test(display)) {
    display = `H${slot.heading_level} ${display}`
  }
  if (slot.required && !display.includes('*')) display = `${display} *`
  return (
    <span
      className={[
        'inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-[0.07em]',
        LABEL_KIND_TONES[kind],
      ].join(' ')}
    >
      [{display}]
    </span>
  )
}

function SlotRow({
  slot, value, onChange,
}: {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const renderField = () => {
    const stringVal = typeof value === 'string' ? value : ''
    // Borderless input with focus-only chrome — keeps the editor reading
    // like a document, not a stack of form boxes.
    const borderlessClass =
      'w-full bg-transparent text-wm-text outline-none px-0 py-1 ' +
      'border-b border-transparent hover:border-wm-border focus:border-wm-accent ' +
      'transition-colors'

    // Heading-shaped text slots get larger type so they read like the
    // headlines they are.
    const isHeading = slot.heading_level === 1
    const isSubhead = slot.heading_level === 2 || slotLabelKind(slot) === 'subhead'

    switch (slot.type) {
      case 'text':
      case 'url':
      case 'email':
      case 'phone': {
        const inputType = slot.type === 'url' ? 'url' : slot.type === 'email' ? 'email' : slot.type === 'phone' ? 'tel' : 'text'
        return (
          <input
            type={inputType}
            value={stringVal}
            maxLength={slot.max_chars}
            onChange={e => onChange(e.target.value)}
            placeholder={slot.description ?? ''}
            className={[
              borderlessClass,
              isHeading ? 'text-2xl font-bold leading-tight'
                : isSubhead ? 'text-lg font-semibold leading-snug'
                : 'text-[14px]',
            ].join(' ')}
          />
        )
      }

      case 'richtext':
        return (
          <RichTextWithSnippets
            value={stringVal}
            onChange={onChange}
            placeholder={slot.description ?? 'Write…'}
          />
        )

      case 'cta': {
        const ctaVal = (typeof value === 'object' && value !== null) ? value as { label?: string; url?: string } : { label: '', url: '' }
        return (
          // Inline "Label (link to /target)" — borrows the web-hub format
          // so the page reads like a doc. Both fields are inline-editable.
          <div className="flex items-baseline gap-1.5 flex-wrap text-[14px] text-wm-text">
            <input
              type="text"
              value={ctaVal.label ?? ''}
              onChange={e => onChange({ ...ctaVal, label: e.target.value })}
              placeholder="Button label"
              className={`${borderlessClass} font-semibold min-w-[160px] flex-1`}
            />
            <span className="text-wm-text-subtle">(link to</span>
            <input
              type="url"
              value={ctaVal.url ?? ''}
              onChange={e => onChange({ ...ctaVal, url: e.target.value })}
              placeholder="/route"
              className={`${borderlessClass} text-wm-text-muted font-mono text-[12px] min-w-[120px] flex-1`}
            />
            <span className="text-wm-text-subtle">)</span>
          </div>
        )
      }

      case 'image':
        return (
          <input
            type="url"
            value={stringVal}
            onChange={e => onChange(e.target.value)}
            placeholder="Image URL"
            className={`${borderlessClass} text-[13px] font-mono text-wm-text-muted`}
          />
        )

      case 'datetime':
        return (
          <input
            type="datetime-local"
            value={stringVal}
            onChange={e => onChange(e.target.value)}
            className={`${borderlessClass} text-[13px]`}
          />
        )

      case 'boolean':
        return (
          <label className="inline-flex items-center gap-2 text-sm text-wm-text">
            <input
              type="checkbox"
              checked={value === true}
              onChange={e => onChange(e.target.checked)}
              className="h-4 w-4 rounded border-wm-border text-wm-accent focus:ring-wm-accent"
            />
            {slot.description ?? slot.label ?? slot.key}
          </label>
        )

      default:
        return (
          <input
            type="text"
            value={stringVal}
            onChange={e => onChange(e.target.value)}
            placeholder={`(${slot.type})`}
            className={`${borderlessClass} italic text-wm-text-muted text-[13px]`}
          />
        )
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <SlotLabel slot={slot} />
        {(slot.unmapped || slot.auto_populated) && (
          <div className="flex items-center gap-1.5">
            {slot.unmapped && <WMStatusPill tone="warning" size="sm">unmapped</WMStatusPill>}
            {slot.auto_populated && <WMStatusPill tone="ai" size="sm">auto</WMStatusPill>}
          </div>
        )}
      </div>
      {renderField()}
      {slot.max_chars && typeof value === 'string' && value.length > slot.max_chars * 0.7 && (
        <p className={[
          'text-[10px] text-right',
          value.length > slot.max_chars ? 'text-wm-danger font-semibold' : 'text-wm-text-subtle',
        ].join(' ')}>
          {value.length} / {slot.max_chars}
        </p>
      )}
    </div>
  )
}

function GroupRow({
  group, value, onChange,
}: {
  group: WebGroupDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const items: FieldValues[] = Array.isArray(value)
    ? value as FieldValues[]
    : Array.from({ length: group.default_count ?? 1 }, () => ({}))

  const setItem = (idx: number, patch: FieldValues) => {
    const next = [...items]
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }

  const addItem = () => onChange([...items, {}])
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx))

  const groupLabel = group.key.replace(/_/g, ' ').toUpperCase()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-wm-border bg-wm-bg-hover text-[9px] font-bold tracking-[0.07em] text-wm-text-muted">
          [{groupLabel}]
        </span>
        <WMButton variant="ghost" size="sm" iconLeft={<Plus size={11} />} onClick={addItem}>
          Add item
        </WMButton>
      </div>
      {group.item_template_ref === 'from_palette' && (
        <p className="text-[10px] text-wm-text-subtle italic">Items use the project's card palette at render</p>
      )}

      {/* Items render as a flowing stack of indented sub-fields. No
          boxed cards per item — the [Item N] pill label is enough to
          separate them visually. */}
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="group relative pl-3 border-l-2 border-wm-border hover:border-wm-accent/40 transition-colors">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-wm-border bg-wm-bg-elevated text-[9px] font-bold tracking-[0.07em] text-wm-text-subtle">
                [{groupLabel} · ITEM {idx + 1}]
              </span>
              <WMIconButton
                label="Remove item"
                size="sm"
                onClick={() => removeItem(idx)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={11} />
              </WMIconButton>
            </div>
            <div className="space-y-2">
              {group.item_schema.map((f, i) => (
                <FieldRow
                  key={f.key + '-' + i}
                  field={f}
                  value={item[f.key]}
                  onChange={(v) => setItem(idx, { [f.key]: v })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Status menu ───────────────────────────────────────────────────────

function StatusMenu({
  current, onChange,
}: {
  current: WebPage['content_status']
  onChange: (status: WebPage['content_status']) => void
}) {
  const [open, setOpen] = useState(false)
  const options: Array<{ value: WebPage['content_status']; label: string; tone: WMStatusTone }> = [
    { value: 'draft',     label: 'Draft',          tone: 'neutral' },
    { value: 'in_review', label: 'In review',      tone: 'info'    },
    { value: 'approved',  label: 'Approved',       tone: 'success' },
  ]
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-wm-bg-elevated border border-wm-border text-[12px] font-semibold text-wm-text hover:border-wm-border-strong transition-colors"
      >
        <Eye size={12} /> Set status
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-44 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1 animate-wm-slide-in-up">
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={[
                  'w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors',
                  opt.value === current
                    ? 'bg-wm-bg-selected text-wm-text font-semibold'
                    : 'text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text',
                ].join(' ')}
              >
                <WMStatusPill tone={opt.tone} size="sm">{opt.label}</WMStatusPill>
                {opt.value === current && <span className="ml-auto text-wm-accent">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
