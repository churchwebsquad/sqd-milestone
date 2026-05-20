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

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FileText, Loader2, Plus, Trash2, Eye, Edit3, Upload, Archive, MoreHorizontal,
  ChevronDown, MessageSquare, ArrowRight,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { loadEditorSnippets } from '../../../lib/webSnippets'
import { WMButton } from '../Button'
import { WMIconButton } from '../IconButton'
import { WMStatusPill } from '../StatusPill'
import type { WMStatusTone } from '../StatusPill'
import type { WMSnippetOption } from '../RichTextEditor'
import { WMCatalogSidePanel } from '../CatalogSidePanel'
import { WMAIAttribution } from '../AIAttribution'
import { PageBriefImportModal } from '../PageBriefImportModal'
import { AddPageModal } from '../AddPageModal'
import { ConfirmDialog } from '../ConfirmDialog'
import { PagePreview } from '../PagePreview'
import { WMSegmentedToggle } from '../SegmentedToggle'
import { SectionList } from '../sectioneditor/SectionList'
import { useSectionDetailPublisher } from '../sectioneditor/SectionEditingContext'
import { fieldValuesToDocHtml, docHtmlToFieldValues } from '../../../lib/webBrixiesDoc'
import { extractSuggestedFamily, type PageBrief } from '../../../lib/webPageBrief'
import {
  composeBind, findBriefSection, extractSectionIdFromNotes,
  rankVariantsByBrief, type RankedVariant, type ComposedBindResult,
} from '../../../lib/webBindTemplate'
import { parseCuratedLibrary, getEffectiveLibraryIds } from '../../../lib/webCuratedLibrary'
import { augmentTemplate } from '../../../lib/webBrixiesSchemaAugment'
import { loadProjectReviewState, type ProjectReviewState } from '../../../lib/webReviews'
import type { SnippetMap } from '../../../lib/webBrixiesRender'
import type {
  StrategyWebProject, WebPage, WebSection, WebContentTemplate,
  WebTemplateKind,
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
  // Project-level review state — drives the active-review banner above
  // the page editor and the comment-creation entry point in the section
  // panel. Re-loaded after any mutation.
  const [reviewState, setReviewState] = useState<ProjectReviewState | null>(null)
  const loadReviewState = async () => {
    const s = await loadProjectReviewState(project.id)
    setReviewState(s)
  }
  useEffect(() => { void loadReviewState() }, [project.id])

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
      <div className="flex" style={{ minHeight: 'calc(100vh - var(--wm-header-h, 88px))' }}>
        {/* Page list (left) — sticky so it stays in view while the
            editor canvas scrolls. */}
        <aside
          className="w-72 shrink-0 border-r border-wm-border bg-wm-bg-elevated overflow-y-auto flex flex-col sticky self-start"
          style={{ top: 'var(--wm-header-h, 88px)', height: 'calc(100vh - var(--wm-header-h, 88px))' }}
        >
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
            pageReviewCounts={reviewState?.page_counts ?? {}}
          />
        </aside>

        {/* Active page editor (right) */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {activePage ? (
            <PageEditor
              page={activePage}
              project={project}
              reviewState={reviewState}
              onReviewChange={loadReviewState}
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
  pageReviewCounts,
}: {
  pages: WebPage[]
  loading: boolean
  activeId: string | null
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onToggleSelection: (id: string) => void
  onArchive: (id: string) => void
  onAddPageInPhase: (phase: string) => void
  pageReviewCounts: Record<string, import('../../../lib/webReviews').PageReviewCounts>
}) {
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
      <div className="px-4 mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Pages{pages.length > 0 ? ` · ${pages.length}` : ''}
        </p>
        <button
          type="button"
          onClick={() => onAddPageInPhase('1')}
          className="text-wm-text-subtle hover:text-wm-accent-strong transition-colors"
          title="Add a page"
        >
          <Plus size={12} />
        </button>
      </div>
      {pages.length === 0 ? (
        <button
          type="button"
          onClick={() => onAddPageInPhase('1')}
          className="mx-3 block w-[calc(100%-1.5rem)] rounded-md border border-dashed border-wm-border bg-wm-bg p-2.5 text-[11px] text-wm-text-muted hover:border-wm-border-focus hover:text-wm-text transition-colors"
        >
          + Add a page
        </button>
      ) : (
        <div className="space-y-0.5">
          {pages.map(p => {
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
                  <PageReviewBadge counts={pageReviewCounts[p.id]} />
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
  page, project, reviewState, onReviewChange, onPageChange, onArchived,
}: {
  page: WebPage
  project: StrategyWebProject
  reviewState: ProjectReviewState | null
  onReviewChange: () => Promise<void>
  onPageChange: () => Promise<void>
  onArchived: () => void
}) {
  // Deep-link from the Review queue / Feedback rail: ?section=<id>
  // selects that section once sections finish loading, then clears the
  // param so it doesn't re-fire on next render.
  const [deepLinkParams, setDeepLinkParams] = useSearchParams()
  const sectionDeepLink = deepLinkParams.get('section')
  const [titleDraft, setTitleDraft] = useState(page.name)
  const [slugDraft, setSlugDraft] = useState(page.slug)
  const [titleDirty, setTitleDirty] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)

  const [sections, setSections] = useState<WebSection[]>([])
  const [templates, setTemplates] = useState<Record<string, WebContentTemplate>>({})
  // All Card-family templates, loaded once per page. Threaded into
  // the renderer so palette-referenced groups (Feature 22/82/106 etc.)
  // can substitute against the chosen Card template's source_html.
  const [cardTemplates, setCardTemplates] = useState<Record<string, WebContentTemplate>>({})
  const [loadingSections, setLoadingSections] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Edit ↔ Preview mode for the page editor body. Edit is the live-
  // assembly canvas; Preview renders the full page via the bound
  // templates' source_html with current copy substituted (iframe).
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  // The currently-selected section in the canvas — drives the
  // right-side details panel.
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
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
    // Effective set merges explicit project bindings with the
    // concept-level defaults, so Feature Section 2 / 82 (and any other
    // defaulted concept) get the "Site library" badge even before the
    // strategist visits the Global Elements workspace.
    return getEffectiveLibraryIds(lib)
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
      const [{ data: tplRows }, { data: cardRows }] = await Promise.all([
        supabase.from('web_content_templates').select('*').in('id', ids),
        // Pre-load every Card template — palette-referenced groups
        // need their source_html + fields available at render time.
        supabase.from('web_content_templates').select('*').eq('family', 'Card'),
      ])
      const map: Record<string, WebContentTemplate> = {}
      for (const t of (tplRows ?? []) as WebContentTemplate[]) map[t.id] = augmentTemplate(t)
      setTemplates(map)
      const cards: Record<string, WebContentTemplate> = {}
      for (const t of (cardRows ?? []) as WebContentTemplate[]) cards[t.id] = augmentTemplate(t)
      setCardTemplates(cards)
    } else {
      setTemplates({})
      setCardTemplates({})
    }
    setLoadingSections(false)
  }
  useEffect(() => { void loadSections() }, [page.id])

  // After sections load, honor any ?section= deep link from the
  // review queue / feedback rail.
  useEffect(() => {
    if (!sectionDeepLink) return
    if (sections.some(s => s.id === sectionDeepLink)) {
      setSelectedSectionId(sectionDeepLink)
      queueMicrotask(() => {
        document.getElementById(`section-${sectionDeepLink}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      // Clear the param so a manual deselect doesn't re-fire on
      // the next render.
      const next = new URLSearchParams(window.location.search)
      next.delete('section')
      setDeepLinkParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, sectionDeepLink])

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
    const newTemplate = tplRow as WebContentTemplate

    const currentValues = (section.field_values ?? {}) as FieldValues
    const oldTemplate = section.content_template_id ? templates[section.content_template_id] : null

    let nextValues: FieldValues
    let overflowHtml = ''
    let bindReport: ComposedBindResult['source_report'] | null = null

    if (oldTemplate) {
      // Re-bind from a bound section. Convert the current values to a
      // proper Brixies doc HTML using the OLD template's slot schema,
      // then parse the doc back into the NEW template's slots. This
      // preserves structured content (tagline / headings / body / CTAs /
      // cards / images) across template swaps without falling back to
      // the rescue serializer that emits group data as literal
      // "buttons:" bullet lists.
      const oldDocHtml = fieldValuesToDocHtml(currentValues, oldTemplate)
      const { field_values } = docHtmlToFieldValues(oldDocHtml, newTemplate, {})
      nextValues = field_values
      // Carry the prior overflow forward — it's still the strategist's
      // safety net for anything they're routing in.
      const priorOverflow = typeof currentValues.__overflow_html === 'string'
        ? currentValues.__overflow_html
        : ''
      if (priorOverflow) overflowHtml = priorOverflow
    } else {
      // Initial bind from a freehand section. Use the body HTML
      // (which IS the Brixies doc HTML for freehand) + composeBind
      // to fill the new template's slots from the brief if available.
      const sourceHtml = typeof currentValues.body === 'string'
        ? currentValues.body
        : (typeof currentValues.__overflow_html === 'string' ? currentValues.__overflow_html : '')

      const briefSectionId = extractSectionIdFromNotes(section.notes)
      const briefSection = findBriefSection(pageBrief, briefSectionId)

      const composed = composeBind(briefSection, sourceHtml, newTemplate)
      nextValues = { ...composed.field_values }
      if (composed.residual_html) overflowHtml = composed.residual_html
      if (composed.source_report.unmatched_brief_keys.length > 0
          || composed.source_report.missing_slots.length > 0) {
        bindReport = composed.source_report
      }
    }

    if (overflowHtml) nextValues.__overflow_html = overflowHtml
    if (bindReport) nextValues.__bind_report = bindReport

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

  /** Swap two sections' sort_order to move one up (-1) or down (+1). */
  const moveSection = async (sectionId: string, dir: -1 | 1) => {
    const idx = sections.findIndex(s => s.id === sectionId)
    if (idx < 0) return
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= sections.length) return
    const a = sections[idx]
    const b = sections[targetIdx]
    // Optimistic swap so the user sees the move immediately.
    setSections(prev => {
      const next = [...prev]
      next[idx] = { ...b, sort_order: a.sort_order }
      next[targetIdx] = { ...a, sort_order: b.sort_order }
      return next.sort((x, y) => x.sort_order - y.sort_order)
    })
    await Promise.all([
      supabase.from('web_sections').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('web_sections').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    void markEdited()
  }

  /** Compute bind quality for the section strip dot. */
  const bindQualityFor = (section: WebSection): 'good' | 'partial' | 'attention' => {
    if (!section.content_template_id) return 'attention'
    const values = (section.field_values ?? {}) as FieldValues
    const report = values.__bind_report as
      | { matched_from_brief: string[]; matched_from_body: string[]; missing_slots: string[]; unmatched_brief_keys: string[] }
      | undefined
    if (!report) return 'good'
    return (report.unmatched_brief_keys.length > 0 || report.missing_slots.length > 1) ? 'partial' : 'good'
  }

  const snippets = useEditorSnippets()
  const snippetMap = useMemo<SnippetMap>(() => {
    const m: Record<string, string> = {}
    for (const s of snippets) m[s.token] = s.resolvedValue
    return m
  }, [snippets])

  const selectedSection = selectedSectionId
    ? sections.find(s => s.id === selectedSectionId) ?? null
    : null
  const selectedTemplate = selectedSection?.content_template_id
    ? (templates[selectedSection.content_template_id] ?? null)
    : null

  // Auto-clear selection if the selected section was removed.
  useEffect(() => {
    if (selectedSectionId && !sections.some(s => s.id === selectedSectionId)) {
      setSelectedSectionId(null)
    }
  }, [sections, selectedSectionId])

  // Publish the active section's data + handlers to the editing
  // context so the AssistantRail's Section tab renders the panel.
  const publishDetail = useSectionDetailPublisher()
  useEffect(() => {
    if (viewMode !== 'edit' || !selectedSection) {
      publishDetail(null)
      return
    }
    // Active internal review = the most recently started open internal
    // review on the project. Comments authored from the section panel
    // attach to it. When no internal review is open, the comment-create
    // affordance is hidden (rail panel renders a "start a review" hint).
    const activeInternalReview = reviewState?.open_reviews.find(r => r.kind === 'internal') ?? null
    const sectionComments = reviewState?.comments.filter(
      c => c.web_section_id === selectedSection.id,
    ) ?? []
    publishDetail({
      section: selectedSection,
      template: selectedTemplate,
      snippets,
      cardTemplates,
      onChange: (patch) => void updateSection(selectedSection.id, patch),
      onClose: () => setSelectedSectionId(null),
      onChangeVariant: () => setBindingSection(selectedSection),
      onUnbind: () => void unbindSection(selectedSection.id),
      onRemove: () => void archiveSection(selectedSection.id),
      activeInternalReview,
      sectionComments,
      // After a comment resolves we want both the comment list to
      // refresh AND the section's field_values to re-read from the
      // database — Apply / Amend writes to web_sections.field_values,
      // and the canvas iframe re-renders off the locally-held section.
      onCommentsChange: async () => {
        await Promise.all([onReviewChange(), loadSections()])
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSection, selectedTemplate, snippets, viewMode, cardTemplates, reviewState])

  // Always clear on unmount so the rail doesn't stick after navigation.
  useEffect(() => {
    return () => publishDetail(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Page-level header — title / slug / status / Edit-Preview toggle.
  const headerNode = (
    <header className="mb-5">
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
              { key: 'preview', label: 'Preview', icon: <Eye   size={11} /> },
            ]}
            active={viewMode}
            onChange={setViewMode}
          />
          <StatusMenu current={page.content_status} onChange={setStatus} />
          <PageActionsMenu onArchive={archivePage} />
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
  )

  // Per-page comment counts (open) — drives the active-review banner.
  const pageCommentCounts = useMemo(() => {
    if (!reviewState) return { open: 0, requested: 0, suggested: 0, comments: 0 }
    const mine = reviewState.comments.filter(c => c.web_page_id === page.id && c.status === 'open')
    return {
      open:      mine.length,
      requested: mine.filter(c => c.kind === 'requested').length,
      suggested: mine.filter(c => c.kind === 'suggested').length,
      comments:  mine.filter(c => c.kind === 'comment').length,
    }
  }, [reviewState, page.id])
  const hasOpenInternal = !!reviewState?.open_reviews.some(r => r.kind === 'internal')
  const hasOpenPartner  = !!reviewState?.has_open_partner

  // Per-section open-comment counts. The SectionList passes these into
  // SectionPreviewCard for the highlight + badge.
  const sectionReviewCounts = useMemo(() => {
    if (!reviewState) return {}
    const result: Record<string, {
      open_total: number; open_comments: number;
      open_suggested: number; open_requested: number;
    }> = {}
    for (const c of reviewState.comments) {
      if (c.status !== 'open' || !c.web_section_id) continue
      if (c.web_page_id !== page.id) continue
      const b = result[c.web_section_id] ??= {
        open_total: 0, open_comments: 0, open_suggested: 0, open_requested: 0,
      }
      b.open_total++
      if (c.kind === 'comment')   b.open_comments++
      if (c.kind === 'suggested') b.open_suggested++
      if (c.kind === 'requested') b.open_requested++
    }
    return result
  }, [reviewState, page.id])

  return (
    <div className="flex" style={{ minHeight: 'calc(100vh - var(--wm-header-h, 88px))' }}>
      {/* Single scrollable canvas — the section details panel lives in
          the AssistantRail (see SectionEditingContext). */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-6 md:px-10 py-6 max-w-4xl mx-auto">
          {(hasOpenInternal || hasOpenPartner) && (
            <ReviewBanner
              hasInternal={hasOpenInternal}
              hasPartner={hasOpenPartner}
              counts={pageCommentCounts}
              onJumpToReviews={() => {
                // SPA nav, not window.location.search = ... — full
                // reloads here were silently dropping unsaved work in
                // the section editor.
                const next = new URLSearchParams(window.location.search)
                next.set('tab', 'review')
                setDeepLinkParams(next, { replace: false })
              }}
            />
          )}
          {headerNode}

          {viewMode === 'preview' ? (
            <PagePreview
              sections={sections}
              templates={templates}
              snippetMap={snippetMap}
              onSelectSection={(id) => {
                setViewMode('edit')
                setSelectedSectionId(id)
                queueMicrotask(() => {
                  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                })
              }}
            />
          ) : loadingSections ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-32 rounded-xl bg-wm-bg-hover animate-pulse" />
              ))}
            </div>
          ) : (
            <SectionList
              sections={sections}
              templates={templates}
              cardTemplates={cardTemplates}
              selectedId={selectedSectionId}
              snippetMap={snippetMap}
              bindQualityFor={bindQualityFor}
              reviewCountsBySection={sectionReviewCounts}
              onSelect={setSelectedSectionId}
              onMoveSection={(id, dir) => void moveSection(id, dir)}
              onChangeVariant={(section) => setBindingSection(section)}
              onUnbind={(id) => void unbindSection(id)}
              onRemove={(id) => void archiveSection(id)}
              onInsertBefore={() => setPickerOpen(true)}
              onInsertAfter={() => setPickerOpen(true)}
            />
          )}
        </div>
      </div>

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

      {/* Catalog picker — bind a section to a Brixies template / change variant. */}
      <WMCatalogSidePanel
        open={bindingSection !== null}
        onClose={() => setBindingSection(null)}
        title={bindingSection?.content_template_id ? 'Change variant' : 'Bind to Brixies template'}
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

// ── Page actions menu ─────────────────────────────────────────────────

function PageActionsMenu({ onArchive }: { onArchive: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <WMIconButton label="More page actions" onClick={() => setOpen(o => !o)}>
        <MoreHorizontal size={14} />
      </WMIconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-44 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1 animate-wm-slide-in-up">
            <button
              type="button"
              onClick={() => { setOpen(false); onArchive() }}
              className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] text-wm-text-muted hover:bg-wm-danger-bg hover:text-wm-danger transition-colors"
            >
              <Archive size={11} />
              Archive page
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Active-review banner ─────────────────────────────────────────────

/** Surfaced above the page editor whenever an internal or partner
 *  review is open. Click jumps to the Review tab. Counts reflect open
 *  comments scoped to THIS page. */
function ReviewBanner({
  hasInternal, hasPartner, counts, onJumpToReviews,
}: {
  hasInternal: boolean
  hasPartner: boolean
  counts: { open: number; requested: number; suggested: number; comments: number }
  onJumpToReviews: () => void
}) {
  // Partner banner wins when both are active (it's the outward-facing one).
  const isPartner = hasPartner
  return (
    <div
      className={[
        'mb-4 rounded-md border px-3 py-2 flex items-center gap-3',
        isPartner
          ? 'border-wm-warn/30 bg-wm-warn-bg'
          : 'border-wm-accent/30 bg-wm-accent-tint',
      ].join(' ')}
    >
      <MessageSquare
        size={14}
        className={isPartner ? 'text-wm-warn shrink-0' : 'text-wm-accent-strong shrink-0'}
      />
      <div className="min-w-0 flex-1">
        <p className={[
          'text-[12px] font-semibold',
          isPartner ? 'text-wm-warn' : 'text-wm-accent-strong',
        ].join(' ')}>
          {isPartner ? 'Partner review active' : 'Internal review active'}
        </p>
        <p className="text-[11px] text-wm-text-muted">
          {counts.open === 0
            ? 'No open comments on this page yet.'
            : `${counts.open} open · ${counts.requested} requested · ${counts.suggested} suggested · ${counts.comments} comment${counts.comments === 1 ? '' : 's'}`}
        </p>
      </div>
      <button
        type="button"
        onClick={onJumpToReviews}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-wm-accent-strong hover:underline shrink-0"
      >
        Go to Review tab <ArrowRight size={10} />
      </button>
    </div>
  )
}

// ── Page-row review badge ────────────────────────────────────────────

/** Small pill rendered next to the per-page status pill in the left
 *  list. Shows "Edits requested", "Edits suggested", or "Commented"
 *  with a count. Source data is the project's review state, derived
 *  per page via `pageReviewBadge()`. */
function PageReviewBadge({
  counts,
}: {
  counts: import('../../../lib/webReviews').PageReviewCounts | undefined
}) {
  if (!counts || counts.open_total === 0) return null
  const tone =
    counts.open_requested > 0 ? 'warning'
    : counts.open_suggested > 0 ? 'info'
    : 'neutral'
  const label =
    counts.open_requested > 0 ? `${counts.open_requested} req`
    : counts.open_suggested > 0 ? `${counts.open_suggested} sug`
    : `${counts.open_comments} note${counts.open_comments === 1 ? '' : 's'}`
  return (
    <WMStatusPill tone={tone as WMStatusTone} size="sm">
      {label}
    </WMStatusPill>
  )
}
