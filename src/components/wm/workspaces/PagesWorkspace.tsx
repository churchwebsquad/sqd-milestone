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
  FileText, Loader2, ChevronDown, ChevronRight, Plus, Trash2,
  Sparkles, RotateCw, Eye, GripVertical, MoreHorizontal,
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
import type {
  StrategyWebProject, WebPage, WebSection, WebContentTemplate,
  WebFieldDef, WebSlotDef, WebGroupDef, WebTemplateKind,
} from '../../../types/database'

interface Props {
  project: StrategyWebProject
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

export function PagesWorkspace({ project }: Props) {
  const [params, setParams] = useSearchParams()
  const [pages, setPages] = useState<WebPage[]>([])
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePage] = useState<WebPage | null>(null)
  const [snippets, setSnippets] = useState<readonly WMSnippetOption[]>([])

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

  const clearSelection = () => {
    const next = new URLSearchParams(params)
    next.delete('page')
    setParams(next, { replace: true })
  }

  return (
    <SnippetsContext.Provider value={snippets}>
      <div className="flex min-h-[calc(100vh-120px)]">
        {/* Page list (left) */}
        <aside className="w-72 shrink-0 border-r border-wm-border bg-wm-bg-elevated overflow-y-auto">
          <PageList
            pages={pages}
            loading={loading}
            activeId={activePage?.id ?? null}
            onSelect={selectPage}
          />
        </aside>

        {/* Active page editor (right) */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {activePage ? (
            <PageEditor
              page={activePage}
              project={project}
              onPageChange={async () => {
                await loadPages()
              }}
              onArchived={() => { clearSelection(); void loadPages() }}
            />
          ) : (
            <EmptyEditor pageCount={pages.length} />
          )}
        </main>
      </div>
    </SnippetsContext.Provider>
  )
}

// ── Page list ─────────────────────────────────────────────────────────

function PageList({
  pages, loading, activeId, onSelect,
}: {
  pages: WebPage[]
  loading: boolean
  activeId: string | null
  onSelect: (id: string) => void
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

  if (loading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-wm-bg-hover animate-pulse" />
        ))}
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="p-6 text-center text-[12px] text-wm-text-muted">
        No pages yet. Add a page from the <strong className="text-wm-text">Sitemap & Strategy</strong> tab.
      </div>
    )
  }

  return (
    <div className="py-3">
      {PHASES.map(phase => {
        const list = byPhase.get(phase.key) ?? []
        if (list.length === 0) return null
        return (
          <div key={phase.key} className="mb-4">
            <p className="px-4 mb-1 text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
              {phase.label} · {list.length}
            </p>
            <div className="space-y-0.5">
              {list.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className={[
                    'w-full text-left px-4 py-2 flex items-center gap-2 border-l-2 transition-colors',
                    p.id === activeId
                      ? 'bg-wm-bg-selected border-wm-accent'
                      : 'border-transparent hover:bg-wm-bg-hover',
                  ].join(' ')}
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
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────

function EmptyEditor({ pageCount }: { pageCount: number }) {
  return (
    <div className="h-full grid place-items-center p-10">
      <div className="text-center max-w-md">
        <FileText size={32} className="text-wm-text-subtle mx-auto mb-3" />
        <h2 className="text-[15px] font-semibold text-wm-text mb-1">
          {pageCount > 0 ? 'Pick a page to begin' : 'No pages yet'}
        </h2>
        <p className="text-[12px] text-wm-text-muted">
          {pageCount > 0
            ? 'Pages appear in the left panel grouped by phase. Once the AI copywriter ships in Phase C, drafted pages will be ready for review when you arrive.'
            : 'Use the Sitemap & Strategy tab to add pages first, then come back here to author them.'}
        </p>
      </div>
    </div>
  )
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
          <div className="flex items-center gap-1.5">
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

      {/* Section blocks */}
      <div className="space-y-3">
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

      {/* Catalog picker */}
      <WMCatalogSidePanel
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add a section"
        subtitle={page.name}
        kindFilter={['content', 'media', 'post_template'] as readonly WebTemplateKind[]}
        mode="single"
        onSelect={async (ids) => { if (ids[0]) await addSection(ids[0]) }}
      />
    </div>
  )
}

// ── Section block ─────────────────────────────────────────────────────

function SectionBlock({
  section, template, onChange, onRemove,
}: {
  section: WebSection
  template: WebContentTemplate | null | undefined
  onChange: (patch: Partial<WebSection>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)
  const values = (section.field_values ?? {}) as FieldValues
  const isFreehand = section.content_template_id == null

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
    <div className={[
      'rounded-lg border bg-wm-bg-elevated overflow-hidden',
      isFreehand ? 'border-wm-border border-dashed' : 'border-wm-border',
    ].join(' ')}>
      {/* Block header */}
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-wm-border bg-wm-bg-elevated">
        <GripVertical size={13} className="text-wm-text-subtle cursor-grab" />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-wm-text hover:text-wm-accent-strong transition-colors min-w-0"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="truncate">{headerLabel}</span>
        </button>
        {headerFamily && (
          <span className="text-[10px] uppercase tracking-wide text-wm-text-subtle">{headerFamily}</span>
        )}
        <WMStatusPill tone={isFreehand ? 'warning' : 'neutral'} size="sm">{headerKind}</WMStatusPill>
        <div className="ml-auto flex items-center gap-0.5">
          {!isFreehand && (
            <WMIconButton label="Redo with AI" size="sm">
              <Sparkles size={13} />
            </WMIconButton>
          )}
          <WMIconButton label="Section actions" size="sm">
            <MoreHorizontal size={13} />
          </WMIconButton>
          <WMIconButton label="Remove section" size="sm" onClick={onRemove}>
            <Trash2 size={13} />
          </WMIconButton>
        </div>
      </div>

      {/* Block body */}
      {open && (
        <div className="px-4 py-4 space-y-4">
          {isFreehand ? (
            <FreehandBody
              value={typeof values.body === 'string' ? values.body : ''}
              onChange={(v) => setValue('body', v)}
            />
          ) : template!.fields.length === 0 ? (
            <p className="text-[12px] text-wm-text-subtle italic">This template has no editable fields.</p>
          ) : (
            template!.fields.map((f, i) => (
              <FieldRow
                key={f.key + '-' + i}
                field={f}
                value={values[f.key]}
                onChange={(v) => setValue(f.key, v)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Freehand body — single TipTap richtext editor. Stored as
 *  `field_values.body` (HTML). User-facing only; AI agents always bind
 *  sections to a template. */
function FreehandBody({
  value, onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Body
        </label>
        <span className="text-[10px] text-wm-text-subtle italic">
          Freehand · no template binding · won't flow to Design / Dev exports until tied to a template
        </span>
      </div>
      <RichTextWithSnippets
        value={value}
        onChange={onChange}
        placeholder="Start writing — headings, lists, bold, italic, links, inline code all supported."
      />
    </div>
  )
}

/** RichTextEditor wrapper that auto-supplies snippets from context. */
function RichTextWithSnippets(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const snippets = useEditorSnippets()
  return (
    <WMRichTextEditor
      value={props.value}
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
  return <SlotRow slot={field} value={value} onChange={onChange} />
}

function SlotRow({
  slot, value, onChange,
}: {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const labelText = (slot.label ?? slot.key.replace(/_/g, ' ')) + (slot.required ? ' *' : '')

  const renderField = () => {
    const stringVal = typeof value === 'string' ? value : ''

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
            className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              value={ctaVal.label ?? ''}
              onChange={e => onChange({ ...ctaVal, label: e.target.value })}
              placeholder="Button label"
              className="h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
            <input
              type="url"
              value={ctaVal.url ?? ''}
              onChange={e => onChange({ ...ctaVal, url: e.target.value })}
              placeholder="https:// or /route"
              className="h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </div>
        )
      }

      case 'image':
        return (
          <input
            type="url"
            value={stringVal}
            onChange={e => onChange(e.target.value)}
            placeholder="Image URL — uploads land in Phase C"
            className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          />
        )

      case 'datetime':
        return (
          <input
            type="datetime-local"
            value={stringVal}
            onChange={e => onChange(e.target.value)}
            className="h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
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
            className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text-muted outline-none italic"
          />
        )
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle">
          {labelText}
        </label>
        <div className="flex items-center gap-1.5">
          {slot.heading_level && (
            <span className="text-[10px] text-wm-text-subtle">H{slot.heading_level}</span>
          )}
          {slot.scope && (
            <span className="text-[10px] text-wm-text-subtle italic">{slot.scope}</span>
          )}
          {slot.unmapped && (
            <WMStatusPill tone="warning" size="sm">unmapped</WMStatusPill>
          )}
          {slot.auto_populated && (
            <WMStatusPill tone="ai" size="sm">auto</WMStatusPill>
          )}
        </div>
      </div>
      {renderField()}
      {slot.max_chars && typeof value === 'string' && (
        <p className="text-[10px] text-wm-text-subtle text-right mt-1">
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

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle">
            {group.key.replace(/_/g, ' ')} <span className="text-wm-text-subtle">· group · default {group.default_count}</span>
          </p>
          {group.item_template_ref === 'from_palette' && (
            <p className="text-[10px] text-wm-text-subtle italic mt-0.5">Items use the project's card palette at render</p>
          )}
        </div>
        <WMButton variant="ghost" size="sm" iconLeft={<Plus size={11} />} onClick={addItem}>
          Add item
        </WMButton>
      </div>

      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="rounded-md bg-wm-bg-elevated border border-wm-border p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wide font-bold text-wm-text-subtle">
                Item {idx + 1}
              </span>
              <WMIconButton label="Remove item" size="sm" onClick={() => removeItem(idx)}>
                <Trash2 size={11} />
              </WMIconButton>
            </div>
            <div className="space-y-3">
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
