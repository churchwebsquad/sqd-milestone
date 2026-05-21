/**
 * Web Manager — Internal review workspace.
 *
 * Decluttered staff version of the partner review portal:
 *
 *   ┌─────────────────────────────────────────┐
 *   │  Top bar: project, review meta, exit    │
 *   ├──────────┬──────────────────────────────┤
 *   │ Page nav │  Scaled iframe stack         │
 *   │          │  (click to select)           │
 *   └──────────┴──────────────────────────────┘
 *
 * Right side is the existing AssistantRail (Feedback when nothing is
 * selected, Section editor when a section is). We re-use the same
 * SectionEditingContext that PagesWorkspace publishes through, so
 * everything the rail already does — comments, variant changes,
 * field edits — works here unchanged.
 *
 * URL contract mirrors PagesWorkspace so the rail's existing
 * `?page=` + `?section=` plumbing works without modification:
 *   - ?page=<page id>     → selected page
 *   - ?section=<sec id>   → selected section (auto-publishes to rail)
 *
 * When the active internal review closes, the parent ReviewWorkspace
 * swaps this back out for the queue / inbox view.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  X, Loader2, FileText, MessageSquare, Check,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { augmentTemplate } from '../../../lib/webBrixiesSchemaAugment'
import { loadEditorSnippets } from '../../../lib/webSnippets'
import { loadProjectReviewState, type ProjectReviewState, closeReview, finalizeReview } from '../../../lib/webReviews'
import { SectionList } from '../sectioneditor/SectionList'
import { useSectionDetailPublisher } from '../sectioneditor/SectionEditingContext'
import type { WMSnippetOption } from '../RichTextEditor'
import type { SnippetMap } from '../../../lib/webBrixiesRender'
import type {
  StrategyWebProject, WebPage, WebSection, WebContentTemplate, WebReview,
} from '../../../types/database'

interface Props {
  project: StrategyWebProject
  /** The currently-open internal review session this workspace is
   *  scoped to. When this becomes null (closed externally) the parent
   *  flips back to the inbox view. */
  review: WebReview
  /** Switch back to the inbox view (rendered by ReviewWorkspace). */
  onExitToInbox: () => void
  /** Refresh the review state after Apply / Amend / Close. */
  onReviewChange: () => Promise<void>
}

export function InternalReviewWorkspace({
  project, review, onExitToInbox, onReviewChange,
}: Props) {
  const [params, setParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [pages, setPages] = useState<WebPage[]>([])
  const [sectionsByPage, setSectionsByPage] = useState<Record<string, WebSection[]>>({})
  const [templates, setTemplates] = useState<Record<string, WebContentTemplate>>({})
  const [cardTemplates, setCardTemplates] = useState<Record<string, WebContentTemplate>>({})
  const [snippets, setSnippets] = useState<readonly WMSnippetOption[]>([])
  const [snippetMap, setSnippetMap] = useState<SnippetMap>({})
  const [reviewState, setReviewState] = useState<ProjectReviewState | null>(null)
  const [closing, setClosing] = useState(false)

  const activePageId    = params.get('page')
  const selectedSectionId = params.get('section')

  const setActivePage = useCallback((pageId: string) => {
    const next = new URLSearchParams(window.location.search)
    next.set('page', pageId)
    next.delete('section')
    setParams(next, { replace: false })
  }, [setParams])

  const setSelectedSection = useCallback((sectionId: string | null) => {
    const next = new URLSearchParams(window.location.search)
    if (sectionId) next.set('section', sectionId)
    else           next.delete('section')
    setParams(next, { replace: false })
  }, [setParams])

  // ── Initial load ────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: pageRows }, snip, state] = await Promise.all([
      supabase.from('web_pages')
        .select('*')
        .eq('web_project_id', project.id)
        .eq('archived', false)
        .order('sort_order'),
      loadEditorSnippets(project),
      loadProjectReviewState(project.id),
    ])
    const ps = (pageRows ?? []) as WebPage[]
    setPages(ps)

    // Sections for every page in one shot.
    const pageIds = ps.map(p => p.id)
    let secRows: WebSection[] = []
    if (pageIds.length > 0) {
      const { data: sRows } = await supabase
        .from('web_sections')
        .select('*')
        .in('web_page_id', pageIds)
        .order('sort_order')
      secRows = (sRows ?? []) as WebSection[]
    }
    const byPage: Record<string, WebSection[]> = {}
    for (const s of secRows) (byPage[s.web_page_id] ??= []).push(s)
    setSectionsByPage(byPage)

    // Templates — content templates referenced by sections + every Card
    // template so palette-referenced groups render correctly.
    const tplIds = Array.from(new Set(secRows.map(s => s.content_template_id).filter((x): x is string => !!x)))
    if (tplIds.length > 0) {
      const [{ data: tplRows }, { data: cardRows }] = await Promise.all([
        supabase.from('web_content_templates').select('*').in('id', tplIds),
        supabase.from('web_content_templates').select('*').eq('family', 'Card'),
      ])
      const t: Record<string, WebContentTemplate> = {}
      for (const x of (tplRows ?? []) as WebContentTemplate[]) t[x.id] = augmentTemplate(x)
      setTemplates(t)
      const c: Record<string, WebContentTemplate> = {}
      for (const x of (cardRows ?? []) as WebContentTemplate[]) c[x.id] = augmentTemplate(x)
      setCardTemplates(c)
    } else {
      setTemplates({})
      setCardTemplates({})
    }

    setSnippets(snip)
    const sm: Record<string, string> = {}
    for (const s of snip) sm[s.token] = s.resolvedValue
    setSnippetMap(sm)
    setReviewState(state)

    // First mount: default the active page to page #1 when nothing
    // is selected, so the canvas isn't empty.
    if (!params.get('page') && ps[0]) {
      const next = new URLSearchParams(window.location.search)
      next.set('page', ps[0].id)
      setParams(next, { replace: true })
    }
    setLoading(false)
  }, [project, params, setParams])

  useEffect(() => { void load() }, [project.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selected section → publish to rail ──────────────────────────

  const activeSections = useMemo(
    () => activePageId ? (sectionsByPage[activePageId] ?? []) : [],
    [activePageId, sectionsByPage],
  )
  const selectedSection = useMemo(
    () => activeSections.find(s => s.id === selectedSectionId) ?? null,
    [activeSections, selectedSectionId],
  )
  const selectedTemplate = useMemo(
    () => selectedSection?.content_template_id ? templates[selectedSection.content_template_id] : null,
    [selectedSection, templates],
  )

  // Per-section open-comment counts, scoped to the active page, for
  // the gold left-edge accent + count badge on each section card.
  const sectionReviewCounts = useMemo(() => {
    if (!reviewState || !activePageId) return {}
    const result: Record<string, {
      open_total: number; open_comments: number;
      open_suggested: number; open_requested: number;
    }> = {}
    for (const c of reviewState.comments) {
      if (c.status !== 'open' || !c.web_section_id) continue
      if (c.web_page_id !== activePageId) continue
      const b = result[c.web_section_id] ??= {
        open_total: 0, open_comments: 0, open_suggested: 0, open_requested: 0,
      }
      b.open_total++
      if (c.kind === 'comment')   b.open_comments++
      if (c.kind === 'suggested') b.open_suggested++
      if (c.kind === 'requested') b.open_requested++
    }
    return result
  }, [reviewState, activePageId])

  const updateSection = useCallback(async (sectionId: string, patch: Partial<WebSection>) => {
    // Optimistic local update so the iframe re-renders immediately.
    setSectionsByPage(prev => {
      const next: Record<string, WebSection[]> = {}
      for (const [pid, list] of Object.entries(prev)) {
        next[pid] = list.map(s => s.id === sectionId ? { ...s, ...patch } : s)
      }
      return next
    })
    await supabase.from('web_sections').update(patch).eq('id', sectionId)
  }, [])

  const refreshAfterCommentAction = useCallback(async () => {
    // Apply / Amend writes into web_sections.field_values; reload
    // both the section list and the review state so the canvas
    // refreshes and the rail counts stay accurate.
    await Promise.all([
      (async () => {
        if (!activePageId) return
        const { data: sRows } = await supabase
          .from('web_sections')
          .select('*')
          .eq('web_page_id', activePageId)
          .order('sort_order')
        setSectionsByPage(prev => ({ ...prev, [activePageId]: (sRows ?? []) as WebSection[] }))
      })(),
      (async () => setReviewState(await loadProjectReviewState(project.id)))(),
      onReviewChange(),
    ])
  }, [activePageId, project.id, onReviewChange])

  const publishDetail = useSectionDetailPublisher()
  useEffect(() => {
    if (!selectedSection) {
      publishDetail(null)
      return
    }
    publishDetail({
      section: selectedSection,
      template: selectedTemplate,
      snippets,
      cardTemplates,
      onChange:        (patch) => void updateSection(selectedSection.id, patch),
      onClose:         () => setSelectedSection(null),
      onChangeVariant: () => {}, // not surfaced in v1 of review mode
      onUnbind:        () => {},
      onRemove:        () => {},
      activeInternalReview: review,
      sectionComments:      reviewState?.comments.filter(c => c.web_section_id === selectedSection.id) ?? [],
      onCommentsChange:     refreshAfterCommentAction,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSection, selectedTemplate, snippets, cardTemplates, reviewState, review])

  // Clear on unmount so the rail's Section tab disappears when the
  // user navigates away from review mode.
  useEffect(() => () => publishDetail(null), [publishDetail])

  // ── Close review ────────────────────────────────────────────────

  const handleClose = async () => {
    if (!confirm('Close this internal review? Open comments stay attached to their pages and carry into the next session. Pages keep their current status.')) return
    setClosing(true)
    const res = await closeReview(review.id)
    setClosing(false)
    if (res.ok) {
      await onReviewChange()
      onExitToInbox()
    }
  }

  const handleFinalize = async () => {
    if (!confirm('Finalize this review? Pages with no remaining open feedback will be marked Approved; pages with unresolved comments stay In Review.')) return
    setClosing(true)
    const res = await finalizeReview({ reviewId: review.id, projectId: project.id })
    setClosing(false)
    if (res.ok) {
      const d = res.data
      if (d) {
        alert(`Review finalized.\n${d.pagesApproved} page(s) approved.\n${d.pagesPending} page(s) still pending (open feedback).`)
      }
      await onReviewChange()
      onExitToInbox()
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="grid place-items-center p-12">
        <Loader2 size={20} className="animate-spin text-wm-text-muted" />
      </div>
    )
  }

  const totalOpen = reviewState?.totals.open_total ?? 0

  return (
    <div className="flex h-full" style={{ minHeight: 'calc(100vh - var(--wm-header-h, 88px))' }}>
      {/* Left — page nav (portal-style simple list) */}
      <aside className="w-60 shrink-0 border-r border-wm-border bg-wm-bg-elevated p-3 overflow-y-auto sticky top-0" style={{ maxHeight: 'calc(100vh - var(--wm-header-h, 88px))' }}>
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2 px-1">
          Pages · {pages.length}
        </p>
        <nav className="space-y-0.5">
          {pages.map(p => {
            const sectionCount = (sectionsByPage[p.id] ?? []).length
            const pageOpen = reviewState?.page_counts[p.id]?.open_total ?? 0
            const active = p.id === activePageId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePage(p.id)}
                className={[
                  'w-full text-left rounded-lg px-2.5 py-1.5 transition-colors flex items-center gap-2',
                  active
                    ? 'bg-wm-text text-wm-bg-elevated'
                    : 'bg-transparent text-wm-text hover:bg-wm-bg-hover',
                ].join(' ')}
              >
                <FileText size={12} className="shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold truncate">{p.name}</p>
                  <p className={[
                    'text-[10px] truncate',
                    active ? 'opacity-70' : 'text-wm-text-subtle',
                  ].join(' ')}>
                    /{p.slug} · {sectionCount} section{sectionCount === 1 ? '' : 's'}
                  </p>
                </div>
                {pageOpen > 0 && (
                  <span className={[
                    'shrink-0 inline-flex items-center gap-0.5 rounded-full text-[9px] font-bold px-1.5 py-0.5',
                    active ? 'bg-wm-bg-elevated/20 text-wm-bg-elevated' : 'bg-amber-100 text-amber-800',
                  ].join(' ')}>
                    <MessageSquare size={8} /> {pageOpen}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Center — iframe canvas */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* In-flow top bar — review meta + exit */}
        <header className="sticky top-0 z-10 bg-wm-bg/95 backdrop-blur border-b border-wm-border px-6 md:px-10 py-3">
          <div className="max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
                Internal Review · {review.started_by_name ?? 'Staff'}
              </p>
              <h1 className="text-[16px] font-semibold text-wm-text truncate">
                {project.church_name ?? project.name} Wireframes: Internal Review
              </h1>
            </div>
            {totalOpen > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-1">
                <MessageSquare size={11} /> {totalOpen} open
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleClose()}
              disabled={closing}
              className="inline-flex items-center gap-1.5 rounded-full border border-wm-border bg-wm-bg-elevated text-[11px] font-semibold text-wm-text-muted hover:border-wm-danger hover:text-wm-danger px-3 py-1.5 transition-colors disabled:opacity-40"
              title="Close this review session. Pages keep their current status — open comments stay open."
            >
              {closing ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
              Close review
            </button>
            <button
              type="button"
              onClick={() => void handleFinalize()}
              disabled={closing}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 px-3 py-1.5 transition-colors disabled:opacity-40"
              title="Finalize: close this review and mark pages with no open feedback as Approved."
            >
              {closing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Finalize review
            </button>
          </div>
        </header>

        <div className="px-6 md:px-10 py-6 max-w-4xl mx-auto">
          {!activePageId ? (
            <div className="rounded-xl border border-dashed border-wm-border bg-wm-bg-elevated p-10 text-center text-wm-text-muted">
              Pick a page on the left to start reviewing.
            </div>
          ) : activeSections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-wm-border bg-wm-bg-elevated p-10 text-center text-wm-text-muted">
              This page has no sections yet.
            </div>
          ) : (
            <SectionList
              sections={activeSections}
              templates={templates}
              cardTemplates={cardTemplates}
              selectedId={selectedSectionId}
              snippetMap={snippetMap}
              // Review mode shouldn't surface the "freehand / bind"
              // chrome — always show a neutral dot.
              bindQualityFor={() => 'good'}
              reviewCountsBySection={sectionReviewCounts}
              onSelect={(id) => setSelectedSection(id === selectedSectionId ? null : id)}
              onMoveSection={() => {}}
              onChangeVariant={() => {}}
              onUnbind={() => {}}
              onRemove={() => {}}
              onInsertBefore={() => {}}
              onInsertAfter={() => {}}
            />
          )}
        </div>
      </div>
    </div>
  )
}
