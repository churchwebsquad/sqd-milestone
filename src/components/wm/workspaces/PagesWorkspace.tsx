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
  ChevronDown, MessageSquare, ArrowRight, Copy, X,
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
import { markOverride } from '../../../lib/webFieldProvenance'
import { WMSegmentedToggle } from '../SegmentedToggle'
import { SectionList } from '../sectioneditor/SectionList'
import { useSectionDetailPublisher } from '../sectioneditor/SectionEditingContext'
import { ProjectPagesProvider } from '../sectioneditor/ProjectPagesContext'
import { ProjectIdProvider } from '../sectioneditor/ProjectIdContext'
import { SectionClipboardProvider, useSectionClipboard } from '../sectioneditor/SectionClipboard'
import { syncStaffLinkOnSave } from '../../../lib/staffLink'
import {
  fieldValuesToDocHtml, docHtmlToFieldValues, reconcileFieldValuesAcrossTemplates,
  computeUnmappedValues, computeDroppedDeepPaths,
  valuesToDocHtmlByShape, mergeFieldValuesPreferNonEmpty,
  type ReconcileTelemetry,
} from '../../../lib/webBrixiesDoc'
import {
  recordBindTelemetry, computeMatchedSlotKeys, collectPaletteTemplateIds,
  emptyReconcileTelemetry, type BindSource,
} from '../../../lib/webBindTelemetry'
import { normalizeFieldValuesForTemplate } from '../../../lib/webCopywriterOutput'
import {
  extractDocument, bindDocumentToTemplate,
} from '../../../lib/webContentDocument'
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
  WebTemplateKind, FieldProvenanceMap,
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
  draft:            'neutral',
  internal_review:  'info',
  partner_review:   'warning',
  partner_approved: 'success',
  archived:         'neutral',
}

const STATUS_LABELS: Record<WebPage['content_status'], string> = {
  draft:            'Draft',
  internal_review:  'Internal Review',
  partner_review:   'Partner Review',
  partner_approved: 'Partner Approved',
  archived:         'Archived',
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
      // Hide per-staff bio pages from the workspace sidebar. They're
      // routable on the rendered site (e.g. /staff/lewis-galloway) and
      // referenced from Team 14 cards in "linked" display_mode, but
      // they shouldn't clutter the page list — strategist edits them
      // via the "Linked staff pages" surface (Phase 4) or by clicking
      // through from the Team 14 item editor.
      .not('slug', 'like', 'staff/%')
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
      <ProjectIdProvider projectId={project.id}>
      <ProjectPagesProvider pages={pages.map(p => ({ id: p.id, name: p.name, slug: p.slug }))}>
      <SectionClipboardProvider>
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
              projectPages={pages}
              reviewState={reviewState}
              onReviewChange={loadReviewState}
              onProjectChange={onChange}
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
      </SectionClipboardProvider>
      </ProjectPagesProvider>
      </ProjectIdProvider>
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
                    {STATUS_LABELS[p.content_status] ?? p.content_status}
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

/** Normalize a partner-typed slug into a URL-safe form:
 *  lowercase, kebab-case, no spaces or special chars. Leading slash
 *  on the home page ("/") is preserved as-is; everything else strips
 *  leading/trailing slashes and runs of dashes. Empty input collapses
 *  to the previous draft (caller handles empty separately). */
function normalizeSlug(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '/') return '/'
  return trimmed
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9\-_/]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
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
  page, project, projectPages, reviewState, onReviewChange, onProjectChange, onPageChange, onArchived,
}: {
  page: WebPage
  project: StrategyWebProject
  /** The whole project's page list — threaded through to the section
   *  detail so the CTA editor's internal-route dropdown can resolve
   *  slugs against actual pages. */
  projectPages: WebPage[]
  reviewState: ProjectReviewState | null
  /** Refresh the project row from the host — fired when the
   *  SectionDetailsPanel's "Save to site library" action mutates
   *  `strategy_web_projects.curated_library`. */
  onProjectChange?: () => Promise<void>
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
  // by the brief-suggested family. The pick is routed through
  // computeBindNextValues so the catalog can detect dropped content
  // and surface the variant-swap confirm dialog before applying.
  const [bindingSection, setBindingSection] = useState<WebSection | null>(null)
  // Cached ranking for the open bind panel — both the deterministic
  // baseline (computed when the panel opens) and the AI re-rank (filled
  // on demand by the "Suggest with AI" button).
  const [bindRanking, setBindRanking] = useState<RankedVariant[]>([])
  const [bindAIRankingInFlight, setBindAIRankingInFlight] = useState(false)
  // Variant-swap confirmation — when picking a new variant would push
  // currently-visible content into the __unmapped stash, hold the
  // computed payload here and surface a ConfirmDialog so the user can
  // see exactly what falls out of view before committing.
  const [pendingSwap, setPendingSwap] = useState<{
    sectionId: string
    templateId: string
    newTemplate: WebContentTemplate
    newTemplateName: string
    nextValues: FieldValues
    droppedFromVisible: string[]
    telemetry: {
      reconcile: ReconcileTelemetry
      bindDurationMs: number
      sourceValuesSizeBytes: number
    }
  } | null>(null)
  const [pendingSwapApplying, setPendingSwapApplying] = useState(false)
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

  // Project-wide set of content_template_ids currently bound on ANY
  // active page in this project. Drives the catalog's "Active on this
  // site" filter so the strategist can quickly find variants already
  // in use elsewhere on the site. Re-loaded when the user opens the
  // catalog (cheap query — selects one tiny column).
  const [activeOnSiteIds, setActiveOnSiteIds] = useState<ReadonlySet<string>>(new Set())
  const loadActiveOnSiteIds = async () => {
    const { data: rows } = await supabase
      .from('web_sections')
      .select('content_template_id, web_page_id, web_pages!inner(archived, web_project_id)')
      .eq('web_pages.web_project_id', project.id)
      .eq('web_pages.archived', false)
      .not('content_template_id', 'is', null)
    const ids = new Set<string>()
    for (const r of (rows ?? []) as Array<{ content_template_id: string | null }>) {
      if (r.content_template_id) ids.add(r.content_template_id)
    }
    setActiveOnSiteIds(ids)
  }
  useEffect(() => { void loadActiveOnSiteIds() }, [project.id, sections.length])

  // Other pages in the project that a section can be duplicated TO.
  // Filter out the current page (no point listing it as a target — the
  // "Duplicate here" menu item handles same-page duplication) and any
  // archived pages.
  const duplicateTargetPages = useMemo(() => {
    return projectPages
      .filter(p => p.id !== page.id && !p.archived)
      .map(p => ({ id: p.id, name: p.name, slug: p.slug }))
  }, [projectPages, page.id])

  // Toast for duplicate-section confirmation. Set by duplicateSection()
  // after the insert succeeds; auto-dismisses after 4 seconds.
  const [duplicateToast, setDuplicateToast] = useState<{
    sectionName: string
    targetPageName: string
    sameTargetPage: boolean
  } | null>(null)
  useEffect(() => {
    if (!duplicateToast) return
    const t = setTimeout(() => setDuplicateToast(null), 4000)
    return () => clearTimeout(t)
  }, [duplicateToast])

  // Section clipboard — copy a section's content into a project-scoped
  // clipboard so it can be pasted as a card/tab item under another
  // section. Toast appears after copy until the strategist pastes
  // (or explicitly clears).
  const {
    clipboard,
    copy: copyToClipboard,
    clear: clearClipboard,
    pasteOffer,
    acknowledgePaste,
  } = useSectionClipboard()
  const copySectionToClipboard = (sectionId: string) => {
    const s = sections.find(x => x.id === sectionId)
    if (!s) return
    const tpl = s.content_template_id ? templates[s.content_template_id] : null
    copyToClipboard(s, tpl ?? null)
  }
  // After a successful paste, ask whether to archive the source
  // section. Calling notePaste in GroupEditor sets pasteOffer here.
  const handleArchiveAfterPaste = async (archive: boolean) => {
    if (archive && pasteOffer) {
      await supabase.from('web_sections').delete().eq('id', pasteOffer.sourceSectionId)
      await loadSections()
      void markEdited()
    }
    acknowledgePaste()
  }

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
    const cleanSlug = normalizeSlug(slugDraft)
    setSavingTitle(true)
    if (cleanSlug !== slugDraft) setSlugDraft(cleanSlug)
    await supabase
      .from('web_pages')
      .update({ name: titleDraft.trim(), slug: cleanSlug })
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

  const updateSection = async (
    sectionId: string,
    patch: Partial<WebSection>,
    opts: { markStaffOverride?: boolean } = {},
  ) => {
    let effectivePatch: Partial<WebSection> = { ...patch }

    // When the SlotEditor saves a field edit, flip every changed slot's
    // provenance to `override` so the next markdown re-flow preserves
    // it via `applyOverridesOnRebind`. Other updateSection call paths
    // (variant swap, unbind, sort_order changes, etc.) don't pass
    // markStaffOverride and therefore don't pin fields they recompute.
    if (opts.markStaffOverride && patch.field_values) {
      const current = sections.find(s => s.id === sectionId)
      if (current) {
        const currentValues = (current.field_values ?? {}) as Record<string, unknown>
        const newValues     = patch.field_values as Record<string, unknown>
        const changed: string[] = []
        for (const key of Object.keys(newValues)) {
          if (key.startsWith('__')) continue  // skip __unmapped / __overflow_html
          if (JSON.stringify(currentValues[key]) !== JSON.stringify(newValues[key])) {
            changed.push(key)
          }
        }
        if (changed.length > 0) {
          let nextProv = (current.field_provenance ?? {}) as FieldProvenanceMap
          for (const key of changed) nextProv = markOverride(nextProv, key)
          effectivePatch.field_provenance = nextProv
        }
      }
    }

    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ...effectivePatch } : s))
    await supabase.from('web_sections').update(effectivePatch).eq('id', sectionId)
    void markEdited()

    // Staff link two-way sync — if this section's bound template has
    // staff cards (Team 14 or Single Team Section 6) AND the patch
    // touched field_values, propagate any linked-staff updates through
    // church_facts to every other section in the project that points
    // at the same staff_fact_id. Fire-and-forget — errors are logged
    // but don't block the primary save.
    if (effectivePatch.field_values) {
      const current = sections.find(s => s.id === sectionId)
      const templateId = current?.content_template_id ?? null
      if (templateId === 'team-section-14' || templateId === 'single-team-section-6') {
        void syncStaffLinkOnSave(
          supabase,
          project.id,
          sectionId,
          templateId,
          effectivePatch.field_values as Record<string, unknown>,
        )
      }
    }
  }

  const archiveSection = async (sectionId: string) => {
    if (!confirm('Remove this section?')) return
    await supabase.from('web_sections').delete().eq('id', sectionId)
    await loadSections()
    void markEdited()
  }

  /** Copy a section to another page (or the same page if targetPageId
   *  equals the current page). Preserves template binding + every
   *  bound value: field_values, cowork_slot_values, cowork_section_meta,
   *  source_field_values, field_provenance, content_status, notes. The
   *  new row gets a fresh id + sort_order at the end of the target page. */
  const duplicateSection = async (sourceSectionId: string, targetPageId: string) => {
    const source = sections.find(s => s.id === sourceSectionId)
    if (!source) return
    const sameTargetPage = targetPageId === page.id
    let nextOrder: number
    if (sameTargetPage) {
      // Insert directly below the source: bump all sections after the
      // source up by 1, then place the dup at source.sort_order + 1.
      const insertAt = source.sort_order + 1
      const afterIds = sections.filter(s => s.sort_order >= insertAt).map(s => s.id)
      if (afterIds.length > 0) {
        await Promise.all(afterIds.map(id => {
          const s = sections.find(x => x.id === id)!
          return supabase.from('web_sections').update({ sort_order: s.sort_order + 1 }).eq('id', id)
        }))
      }
      nextOrder = insertAt
    } else {
      // Append to the end of the target page.
      const { data: tail } = await supabase
        .from('web_sections')
        .select('sort_order')
        .eq('web_page_id', targetPageId)
        .order('sort_order', { ascending: false })
        .limit(1)
      nextOrder = ((tail?.[0]?.sort_order ?? 0) as number) + 1
    }
    const payload: Partial<WebSection> = {
      web_page_id:         targetPageId,
      content_template_id: source.content_template_id,
      field_values:        source.field_values,
      sort_order:          nextOrder,
    }
    // Copy optional cowork-side fields if present so a duplicated
    // section keeps its Notion provenance + design directives.
    if ('cowork_slot_values' in source && source.cowork_slot_values != null) {
      ;(payload as Record<string, unknown>).cowork_slot_values = source.cowork_slot_values
    }
    if ('cowork_section_meta' in source && source.cowork_section_meta != null) {
      ;(payload as Record<string, unknown>).cowork_section_meta = source.cowork_section_meta
    }
    if ('source_field_values' in source && (source as Record<string, unknown>).source_field_values != null) {
      ;(payload as Record<string, unknown>).source_field_values = (source as Record<string, unknown>).source_field_values
    }
    if ('field_provenance' in source && (source as Record<string, unknown>).field_provenance != null) {
      ;(payload as Record<string, unknown>).field_provenance = (source as Record<string, unknown>).field_provenance
    }
    if (source.notes != null) (payload as Record<string, unknown>).notes = source.notes
    await supabase.from('web_sections').insert(payload as never)
    if (sameTargetPage) {
      await loadSections()
    }
    void markEdited()
    // Surface a brief confirmation. Section name comes from the bound
    // template's layer_name (e.g. "Feature Section 2"); falls back to
    // "Freehand section" when unbound. Target page name comes from the
    // projectPages list.
    const tpl = source.content_template_id ? templates[source.content_template_id] : null
    const sectionName = tpl?.layer_name ?? 'Freehand section'
    const targetPage = projectPages.find(p => p.id === targetPageId)
    const targetPageName = targetPage?.name ?? 'this page'
    setDuplicateToast({ sectionName, targetPageName, sameTargetPage })
  }

  /** Pure computation of the next field_values for binding `section` to
   *  `newTemplate`. Sources that fill the new template's slots:
   *    1. `section.source_field_values` (set at import time) — the
   *       immutable copywriter shape. Variant swap re-derives from this
   *       directly so content loss can't compound across swaps. User
   *       edits made post-import are overlaid on top.
   *    2. Legacy fallback for sections without `source_field_values`:
   *       remap from the current `field_values` against the old
   *       template, plus brief-driven auto-fill for freehand sections.
   *  Returns the payload plus the list of source keys that won't be
   *  represented in the new template's slots after the swap. The
   *  caller decides whether to prompt before persisting. */
  const computeBindNextValues = (
    section: WebSection,
    newTemplate: WebContentTemplate,
  ): {
    nextValues: FieldValues
    droppedFromVisible: string[]
    /** Side-channel data the persist step uses to write bind telemetry.
     *  Compute stays pure — applyBindPayload fires the actual insert. */
    telemetry: {
      reconcile: ReconcileTelemetry
      bindDurationMs: number
      sourceValuesSizeBytes: number
    }
  } => {
    const bindStart = Date.now()
    const reconcileTele = emptyReconcileTelemetry()
    const storedValues = (section.field_values ?? {}) as FieldValues
    const sourceFieldValues =
      (section.source_field_values && typeof section.source_field_values === 'object'
        ? section.source_field_values as FieldValues
        : null)
    // Merge any previously-stashed __unmapped entries back into the
    // source values BEFORE we route into the new template — that's
    // what gives previously-unmapped content a second chance to land
    // in a matching slot when the schema now supports it.
    const priorUnmapped = (storedValues.__unmapped as Record<string, unknown> | undefined) ?? {}
    const currentValues: FieldValues = { ...priorUnmapped, ...storedValues }
    delete (currentValues as Record<string, unknown>).__unmapped
    const oldTemplate = section.content_template_id ? templates[section.content_template_id] : null

    let nextValues: FieldValues
    let overflowHtml = ''
    let bindReport: ComposedBindResult['source_report'] | null = null

    if (sourceFieldValues && Object.keys(sourceFieldValues).length > 0) {
      // Source-of-truth path. Re-derive directly from the copywriter's
      // original shape via the ContentDocument IR, then overlay any
      // user edits so post-import authoring isn't lost on swap.
      const fromSource = bindDocumentToTemplate(
        extractDocument({ field_values: sourceFieldValues }),
        newTemplate,
        cardTemplates,
      ) as FieldValues

      const userEditsInNewShape = bindDocumentToTemplate(
        extractDocument({ field_values: currentValues }),
        newTemplate,
        cardTemplates,
      ) as FieldValues
      nextValues = mergeFieldValuesPreferNonEmpty(
        userEditsInNewShape, fromSource, newTemplate,
      ) as FieldValues

      const priorOverflow = typeof currentValues.__overflow_html === 'string'
        ? currentValues.__overflow_html
        : ''
      if (priorOverflow) overflowHtml = priorOverflow
    } else if (oldTemplate) {
      // Variant swap from one bound template to another. Run the
      // current values through the ContentDocument IR + binder so
      // every editable slot on the NEW template's schema gets filled
      // by intent match (not by key name) from the data we already
      // have. Replaces the legacy three-phase normalize / shape-doc
      // / reconcile pipeline.
      nextValues = bindDocumentToTemplate(
        extractDocument({ field_values: currentValues }),
        newTemplate,
        cardTemplates,
      ) as FieldValues
      const priorOverflow = typeof currentValues.__overflow_html === 'string'
        ? currentValues.__overflow_html
        : ''
      if (priorOverflow) overflowHtml = priorOverflow
    } else {
      // Initial bind from a freehand section. Two cases:
      //   (a) imported-as-freehand sections that still have structured
      //       field_values (heading / description / buttons / card_grid
      //       etc.) — route those through the value-shape doc emit so
      //       the new template's slots actually get filled.
      //   (b) plain-text freehand sections where everything's under
      //       `body` HTML — fall through to the legacy composeBind that
      //       parses the body against the brief.
      const sourceHtml = typeof currentValues.body === 'string'
        ? currentValues.body
        : (typeof currentValues.__overflow_html === 'string' ? currentValues.__overflow_html : '')

      // Has structured keys beyond body / reserved? If so, prefer the
      // value-shape route — composeBind doesn't see those keys.
      const structuralKeys = Object.keys(currentValues).filter(k =>
        k !== 'body' && k !== '__overflow_html' && k !== '__unmapped'
          && k !== '__bind_report' && k !== '__extra_ctas' && k !== '__extra_cards',
      )
      const hasStructuredValues = structuralKeys.length > 0

      if (hasStructuredValues) {
        // Initial bind from a freehand section with structured keys.
        // Route through the ContentDocument IR + binder; replaces the
        // legacy three-phase pipeline.
        nextValues = bindDocumentToTemplate(
          extractDocument({ field_values: currentValues }),
          newTemplate,
          cardTemplates,
        ) as FieldValues
      } else {
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
    }

    if (overflowHtml) nextValues.__overflow_html = overflowHtml
    if (bindReport) nextValues.__bind_report = bindReport

    // Recompute __unmapped against the new template. With
    // source_field_values present we compute against the canonical
    // source (so the editor's "Unmapped content" panel reflects what
    // the COPYWRITER shipped that doesn't fit, not just whatever was
    // visible right before the swap). Without source, fall back to
    // the legacy "compare against current visible+stash" behavior.
    const unmappedBasis: FieldValues = sourceFieldValues ?? currentValues
    const unmapped = computeUnmappedValues(unmappedBasis, nextValues, newTemplate)
    if (Object.keys(unmapped).length > 0) {
      nextValues.__unmapped = unmapped
    } else if ('__unmapped' in nextValues) {
      delete (nextValues as Record<string, unknown>).__unmapped
    }

    // "Dropped" = source/visible content that won't be represented in
    // the new template's slots, deep-walked so CTAs hidden inside
    // `card[N].buttons_card` (or any other nested group slot) trigger
    // the warning. With source_field_values we measure against the
    // canonical source so the warning catches drops the copywriter
    // shipped, even if a previous swap had already pushed them into
    // __unmapped. Legacy sections compare against the visible-stored
    // state instead.
    let droppedFromVisible: string[]
    if (sourceFieldValues) {
      droppedFromVisible = computeDroppedDeepPaths(sourceFieldValues, nextValues)
    } else {
      const visibleStored: FieldValues = { ...storedValues }
      delete (visibleStored as Record<string, unknown>).__unmapped
      droppedFromVisible = computeDroppedDeepPaths(visibleStored, nextValues)
    }

    const sourceValuesSizeBytes = sourceFieldValues
      ? JSON.stringify(sourceFieldValues).length
      : JSON.stringify(storedValues).length

    return {
      nextValues,
      droppedFromVisible,
      telemetry: {
        reconcile: reconcileTele,
        bindDurationMs: Date.now() - bindStart,
        sourceValuesSizeBytes,
      },
    }
  }

  /** Persist a previously-computed bind payload (and refresh local
   *  state). Used by both the no-prompt fast path and the
   *  confirm-then-apply flow for variant swaps that drop content. */
  const applyBindPayload = async (
    sectionId: string,
    templateId: string,
    nextValues: FieldValues,
    telemetry?: {
      reconcile: ReconcileTelemetry
      bindDurationMs: number
      sourceValuesSizeBytes: number
      bindSource: BindSource
      newTemplate: WebContentTemplate
    },
  ) => {
    await updateSection(sectionId, {
      content_template_id: templateId,
      field_values: nextValues,
    })
    await loadSections()
    if (telemetry) {
      const t = telemetry
      const section = sections.find(s => s.id === sectionId)
      const unmapped = (nextValues.__unmapped as Record<string, unknown> | undefined) ?? {}
      const sourceForDropCalc = (section?.source_field_values
        ?? (section?.field_values as Record<string, unknown> | null)
        ?? {}) as Record<string, unknown>
      void recordBindTelemetry({
        web_section_id:   sectionId,
        web_project_id:   project.id,
        bind_source:      t.bindSource,
        template_id:      templateId,
        palette_template_ids: collectPaletteTemplateIds(t.newTemplate.fields),
        matched_slot_keys:    computeMatchedSlotKeys(t.newTemplate, nextValues),
        unmapped_source_keys: Object.keys(unmapped),
        dropped_paths:        computeDroppedDeepPaths(sourceForDropCalc, nextValues),
        used_shape_align:     t.reconcile.used_shape_align,
        used_faq_inference:   Boolean(t.newTemplate.fields?.some(
          f => f.kind === 'group' && Array.isArray(f.item_schema)
            && f.item_schema.some(s => s.kind === 'slot' && s.key === 'question')
            && f.item_schema.some(s => s.kind === 'slot' && s.key === 'answer'),
        )),
        source_field_values_size_bytes: t.sourceValuesSizeBytes,
        bind_duration_ms: t.bindDurationMs,
      })
    }
  }

  /** Unbind a template-bound section back to freehand. Restores the
   *  overflow stash as the new freehand body so all the brief content is
   *  immediately editable again. If no overflow exists (rare — strategist
   *  cleared it), serialize the current slot values to HTML as a best-
   *  effort body. Carries the __unmapped stash forward so re-binding to
   *  a new template can rehydrate it. */
  const unbindSection = async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    const values = (section.field_values ?? {}) as FieldValues
    let body =
      typeof values.__overflow_html === 'string' ? values.__overflow_html : ''
    if (!body) {
      body = serializeFieldValuesToHtml(values, templates[section.content_template_id ?? ''])
    }
    const preservedUnmapped = values.__unmapped
    const next: FieldValues = { body }
    if (preservedUnmapped && typeof preservedUnmapped === 'object'
        && !Array.isArray(preservedUnmapped)
        && Object.keys(preservedUnmapped as Record<string, unknown>).length > 0) {
      next.__unmapped = preservedUnmapped
    }
    await updateSection(sectionId, {
      content_template_id: null,
      field_values: next,
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
    const reviewsById = Object.fromEntries(
      (reviewState?.reviews ?? []).map(r => [r.id, r]),
    )
    // Library template index — used by the SectionDetailsPanel's
    // "Save to site library" popover to render Replace lists with
    // real names rather than ids.
    const libraryTemplatesById: Record<string, { id: string; layer_name: string }> = {}
    for (const t of Object.values(templates)) {
      if (siteLibraryIds.has(t.id)) libraryTemplatesById[t.id] = { id: t.id, layer_name: t.layer_name }
    }

    publishDetail({
      section: selectedSection,
      template: selectedTemplate,
      snippets,
      cardTemplates,
      pages: projectPages.map(p => ({ id: p.id, name: p.name, slug: p.slug })),
      // Staff field edits in the Layout view flip provenance to
      // `override` for every changed slot — preserves them through the
      // next markdown re-flow.
      onChange: (patch) => void updateSection(selectedSection.id, patch, { markStaffOverride: true }),
      onClose: () => setSelectedSectionId(null),
      onChangeVariant: () => setBindingSection(selectedSection),
      onUnbind: () => void unbindSection(selectedSection.id),
      onRemove: () => void archiveSection(selectedSection.id),
      project,
      libraryTemplatesById,
      onLibraryChange: onProjectChange ?? (async () => {}),
      activeInternalReview,
      sectionComments,
      reviewsById,
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
            {STATUS_LABELS[page.content_status] ?? page.content_status}
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
              { key: 'edit',    label: 'Layout',  icon: <Edit3 size={11} /> },
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
      <div className="mt-1 flex items-center gap-2 text-[12px] text-wm-text-subtle">
        <label className="text-[10px] uppercase tracking-wider font-semibold text-wm-text-subtle/80">URL</label>
        <span className="text-wm-text-muted">/</span>
        <input
          type="text"
          value={slugDraft}
          onChange={e => { setSlugDraft(e.target.value); setTitleDirty(true) }}
          onBlur={() => { if (titleDirty) void saveTitleSlug() }}
          placeholder="page-slug"
          title="Click to edit. Lowercase letters, numbers, and dashes only."
          className="bg-wm-bg-elevated border border-wm-border/60 hover:border-wm-accent/40 focus:border-wm-accent focus:bg-wm-bg outline-none rounded px-2 py-0.5 transition-colors text-wm-text font-mono text-[12px] min-w-0 flex-1 max-w-md"
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
                // Open the Feedback panel in-place rather than yanking
                // the user off the Pages canvas. The AssistantRail
                // listens for ?rail=feedback, switches tab, then
                // clears the param.
                const next = new URLSearchParams(window.location.search)
                next.set('rail', 'feedback')
                setDeepLinkParams(next, { replace: false })
              }}
            />
          )}
          {headerNode}

          {viewMode === 'preview' ? (
            <PagePreview
              sections={sections}
              templates={templates}
              cardTemplates={cardTemplates}
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
            <>
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
              onDuplicateHere={(id) => void duplicateSection(id, page.id)}
              onDuplicateToPage={(id, targetPageId) => void duplicateSection(id, targetPageId)}
              availablePages={duplicateTargetPages}
              onCopyToClipboard={copySectionToClipboard}
            />
            {/* Bottom-of-page add affordance. Always visible (even
                when there are no sections yet) so the strategist
                has an obvious entry point to grow the page beyond
                the cowork-handed-off baseline. */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mt-4 w-full rounded-xl border-2 border-dashed border-wm-border bg-transparent px-6 py-5 text-[13px] font-semibold text-wm-text-muted hover:border-wm-accent hover:bg-wm-accent-tint hover:text-wm-accent-strong transition-colors flex items-center justify-center gap-2"
            >
              <span className="text-[18px] leading-none">+</span>
              Add section
            </button>
            </>
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
        activeOnSiteIds={activeOnSiteIds}
        mode="single"
        onSelect={async (ids) => {
          try {
            if (ids[0]) await addSection(ids[0])
          } catch (err) {
            console.error('[add-section] failed', err)
          } finally {
            setPickerOpen(false)
          }
        }}
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
        activeOnSiteIds={activeOnSiteIds}
        cardSubtitles={Object.fromEntries(bindRanking.map(r => [r.template.id, r.rationale]))}
        onRequestAIRank={
          (bindingSection && findBriefSection(pageBrief, extractSectionIdFromNotes(bindingSection.notes)))
            ? aiRankBindCandidates
            : undefined
        }
        aiRanking={bindAIRankingInFlight}
        onSelect={async (ids) => {
          const section = bindingSection
          const templateId = ids[0]
          if (!section || !templateId) { setBindingSection(null); return }
          try {
            const { data: tplRow } = await supabase
              .from('web_content_templates')
              .select('*')
              .eq('id', templateId)
              .maybeSingle()
            if (!tplRow) return
            const newTemplate = tplRow as WebContentTemplate
            const { nextValues, droppedFromVisible, telemetry } = computeBindNextValues(section, newTemplate)

            const isVariantSwap = section.content_template_id != null
            if (isVariantSwap && droppedFromVisible.length > 0) {
              setPendingSwap({
                sectionId: section.id,
                templateId,
                newTemplate,
                newTemplateName: newTemplate.layer_name ?? 'this variant',
                nextValues,
                droppedFromVisible,
                telemetry,
              })
              setBindingSection(null)
              return
            }

            await applyBindPayload(section.id, templateId, nextValues, {
              ...telemetry,
              bindSource: isVariantSwap ? 'variant_swap' : 'initial_bind',
              newTemplate,
            })
          } catch (err) {
            console.error('[change-variant] bind failed', err)
          } finally {
            setBindingSection(null)
          }
        }}
      />

      <ConfirmDialog
        open={pendingSwap !== null}
        title="Some content won't fit the new variant"
        destructive
        confirmLabel="Swap anyway"
        cancelLabel="Keep current variant"
        loading={pendingSwapApplying}
        body={
          <>
            <p>
              Swapping to <span className="font-medium text-wm-text">{pendingSwap?.newTemplateName}</span>
              {' '}will move these out of visible slots:
            </p>
            <ul className="list-disc pl-5 mt-2 text-wm-text">
              {pendingSwap?.droppedFromVisible.slice(0, 8).map(k => (
                <li key={k}>{k}</li>
              ))}
              {(pendingSwap?.droppedFromVisible.length ?? 0) > 8 && (
                <li>…and {(pendingSwap!.droppedFromVisible.length - 8)} more</li>
              )}
            </ul>
            <p className="mt-2">
              The content will be stashed under the section so it isn't lost —
              swapping to a variant that supports those fields will restore it.
            </p>
          </>
        }
        onCancel={() => { if (!pendingSwapApplying) setPendingSwap(null) }}
        onConfirm={async () => {
          if (!pendingSwap) return
          setPendingSwapApplying(true)
          try {
            await applyBindPayload(pendingSwap.sectionId, pendingSwap.templateId, pendingSwap.nextValues, {
              ...pendingSwap.telemetry,
              bindSource: 'variant_swap',
              newTemplate: pendingSwap.newTemplate,
            })
            setPendingSwap(null)
          } catch (err) {
            console.error('[change-variant] confirm-apply failed', err)
          } finally {
            setPendingSwapApplying(false)
          }
        }}
      />

      {/* Post-paste archive confirm. Set by GroupEditor via the
          clipboard context's notePaste(); strategist picks Keep or
          Archive for the source section. */}
      {pasteOffer && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-deep-plum/40 backdrop-blur-sm">
          <div className="max-w-md rounded-2xl bg-wm-bg-elevated shadow-xl border border-wm-border p-5">
            <div className="flex items-start gap-3">
              <div className="shrink-0 grid place-items-center w-9 h-9 rounded-full bg-emerald-50 text-emerald-700">
                <Copy size={16} />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-bold text-wm-text">Content pasted</p>
                <p className="text-[12px] text-wm-text-muted mt-1 leading-snug">
                  <span className="font-semibold text-wm-text">{pasteOffer.sourceLayerName}</span> was added to{' '}
                  <span className="font-semibold text-wm-text">{pasteOffer.targetSummary}</span>.
                  Do you want to archive the original section now?
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <WMButton variant="ghost" size="sm" onClick={() => void handleArchiveAfterPaste(false)}>
                Keep original
              </WMButton>
              <WMButton variant="primary" size="sm" onClick={() => void handleArchiveAfterPaste(true)}>
                Archive original
              </WMButton>
            </div>
          </div>
        </div>
      )}

      {/* Section clipboard toast — sticks until paste/clear so the
          strategist always knows there's content waiting to drop into
          a group on this (or another) page. */}
      {clipboard && clipboard.sourcePageId === page.id && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl bg-deep-plum text-white shadow-xl border border-primary-purple/40 px-4 py-3 flex items-start gap-3 animate-[fadeIn_0.2s_ease-out]"
        >
          <div className="shrink-0 mt-0.5 grid place-items-center w-7 h-7 rounded-full bg-primary-purple/30">
            <Copy size={14} className="text-lavender" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-snug">Content copied</p>
            <p className="text-xs text-white/85 mt-0.5 leading-snug">
              <span className="font-semibold">{clipboard.sourceLayerName}</span>
              {' '}is on the clipboard. Open a group editor on any section, then click <span className="font-semibold">Paste from clipboard</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={clearClipboard}
            aria-label="Clear clipboard"
            className="text-white/60 hover:text-white shrink-0 -mr-1 -mt-1 p-1"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Duplicate-section confirmation toast. Auto-dismisses after 4s
          via the effect above; user can also click X to close early. */}
      {duplicateToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl bg-deep-plum text-white shadow-xl border border-primary-purple/40 px-4 py-3 flex items-start gap-3 animate-[fadeIn_0.2s_ease-out]"
        >
          <div className="shrink-0 mt-0.5 grid place-items-center w-7 h-7 rounded-full bg-primary-purple/30">
            <Copy size={14} className="text-lavender" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-snug">Section duplicated</p>
            <p className="text-xs text-white/85 mt-0.5 leading-snug">
              <span className="font-semibold">{duplicateToast.sectionName}</span>
              {' '}was copied to{' '}
              <span className="font-semibold">{duplicateToast.targetPageName}</span>
              {duplicateToast.sameTargetPage && <span className="text-white/60 italic"> (this page)</span>}
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDuplicateToast(null)}
            aria-label="Dismiss"
            className="text-white/60 hover:text-white shrink-0 -mr-1 -mt-1 p-1"
          >
            <X size={14} />
          </button>
        </div>
      )}
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
    { value: 'draft',            label: 'Draft',            tone: 'neutral' },
    { value: 'internal_review',  label: 'Internal Review',  tone: 'info'    },
    { value: 'partner_review',   label: 'Partner Review',   tone: 'warning' },
    { value: 'partner_approved', label: 'Partner Approved', tone: 'success' },
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
        Open Feedback panel <ArrowRight size={10} />
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
