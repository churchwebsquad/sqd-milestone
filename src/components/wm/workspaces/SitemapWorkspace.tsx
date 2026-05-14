/**
 * Web Manager — Sitemap & Strategy workspace.
 *
 * Author mode: project's page tree grouped by phase, chrome
 * designation row at top, add/archive page actions, page-level
 * status pills. Click a page → routes to Pages workspace.
 *
 * Content Strategy preview mode: renders the 5-section partner-facing
 * deliverable produced by the AI Sitemap agent (Stage 2). Phase A
 * shows a placeholder until the agent ships in Phase C.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GitBranch, Eye, Edit3, Plus, Archive,
  Layout, FileText, MoreHorizontal, Sparkles, CheckCircle2, RotateCw, ChevronDown, ChevronRight,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMSegmentedToggle } from '../SegmentedToggle'
import { WMCard } from '../Card'
import { WMButton } from '../Button'
import { WMIconButton } from '../IconButton'
import { WMStatusPill } from '../StatusPill'
import type { WMStatusTone } from '../StatusPill'
import { WMCatalogSidePanel } from '../CatalogSidePanel'
import { Stage2SitemapView } from '../Stage2SitemapView'
import { RedoModal } from '../RedoModal'
import { commitSitemapToPages } from '../../../lib/webSitemap'
import { draftSitemap } from '../../../lib/webAgents'
import type { StrategyWebProject, WebPage, WebContentTemplate, WebTemplateKind } from '../../../types/database'

interface Props {
  project: StrategyWebProject
  onChange?: () => Promise<void>
}

type ViewMode = 'author' | 'preview'

type ChromeSlot = 'header' | 'footer' | 'megamenu' | 'offcanvas'

const PHASES: Array<{ key: string; label: string; description: string }> = [
  { key: 'global',   label: 'Global',   description: 'Site-wide chrome (header / footer) + reference pages' },
  { key: '1',        label: 'Phase 1',  description: 'Launched at site launch' },
  { key: '2',        label: 'Phase 2',  description: 'Shipped after launch' },
  { key: 'nav-only', label: 'Nav-only', description: 'Surfaces in navigation but no authored page yet' },
]

export function SitemapWorkspace({ project, onChange }: Props) {
  const navigate = useNavigate()
  const [view, setView] = useState<ViewMode>('author')
  const [pages, setPages] = useState<WebPage[]>([])
  const [chromeTemplates, setChromeTemplates] = useState<Record<string, WebContentTemplate>>({})
  const [loading, setLoading] = useState(true)
  const [picker, setPicker] = useState<ChromeSlot | null>(null)
  const [addPageOpen, setAddPageOpen] = useState<string | null>(null) // phase key or null

  const load = async () => {
    setLoading(true)
    const [pageRes, templateIds] = await Promise.all([
      supabase
        .from('web_pages')
        .select('*')
        .eq('web_project_id', project.id)
        .eq('archived', false)
        .order('sort_order'),
      Promise.resolve(
        [project.primary_header_template_id, project.primary_footer_template_id,
         ...(project.megamenu_template_ids ?? []), ...(project.offcanvas_template_ids ?? [])]
          .filter((x): x is string => !!x),
      ),
    ])
    setPages((pageRes.data ?? []) as WebPage[])
    if (templateIds.length > 0) {
      const { data: tplRows } = await supabase
        .from('web_content_templates')
        .select('*')
        .in('id', templateIds)
      const map: Record<string, WebContentTemplate> = {}
      for (const t of (tplRows ?? []) as WebContentTemplate[]) map[t.id] = t
      setChromeTemplates(map)
    } else {
      setChromeTemplates({})
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [project.id])

  const setPrimaryChrome = async (slot: ChromeSlot, id: string | null) => {
    const col = slot === 'header'   ? 'primary_header_template_id'
              : slot === 'footer'   ? 'primary_footer_template_id'
              : null
    if (col) {
      await supabase.from('strategy_web_projects').update({ [col]: id }).eq('id', project.id)
    }
    await load()
  }

  const setChromeArray = async (slot: 'megamenu' | 'offcanvas', ids: string[]) => {
    const col = slot === 'megamenu' ? 'megamenu_template_ids' : 'offcanvas_template_ids'
    await supabase.from('strategy_web_projects').update({ [col]: ids }).eq('id', project.id)
    await load()
  }

  const archivePage = async (id: string) => {
    if (!confirm('Archive this page?')) return
    await supabase.from('web_pages').update({ archived: true }).eq('id', id)
    await load()
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
              <GitBranch size={13} />
              <p className="text-[11px] font-bold uppercase tracking-widest">Sitemap & strategy</p>
            </div>
            <h1 className="text-2xl font-semibold text-wm-text">Page structure</h1>
          </div>
          <WMSegmentedToggle
            options={[
              { key: 'author',  label: 'Author',                  icon: <Edit3 size={11} /> },
              { key: 'preview', label: 'Content strategy preview', icon: <Eye   size={11} /> },
            ]}
            active={view}
            onChange={setView}
          />
        </div>

        {view === 'author' ? (
          <>
            {/* Stage 2 proposal banner — surfaces when stage_2 exists,
                whether or not pages have been committed yet. */}
            <SitemapProposalBanner
              project={project}
              onCommitted={async () => {
                await load()
                if (onChange) await onChange()
              }}
              onRefreshed={async () => {
                if (onChange) await onChange()
              }}
            />

            {/* Chrome designation */}
            <ChromeDesignationRow
              project={project}
              chromeTemplates={chromeTemplates}
              onOpenPicker={setPicker}
            />

            {/* Page tree */}
            <div className="space-y-5">
              {PHASES.map(phase => {
                const phasePages = pages.filter(p => p.phase === phase.key)
                return (
                  <PhaseGroup
                    key={phase.key}
                    phase={phase}
                    pages={phasePages}
                    loading={loading}
                    onAddPage={() => setAddPageOpen(phase.key)}
                    onOpenPage={(id) => navigate(`/web/${project.id}/content?tab=pages&page=${id}`)}
                    onArchivePage={(id) => void archivePage(id)}
                  />
                )
              })}
            </div>
          </>
        ) : (
          <ContentStrategyPreview project={project} />
        )}
      </div>

      {/* Catalog side panel — chrome designation */}
      <WMCatalogSidePanel
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'header'   ? 'Pick a primary header'
            : picker === 'footer'   ? 'Pick a primary footer'
            : picker === 'megamenu' ? 'Pick megamenu reference(s)'
            : picker === 'offcanvas'? 'Pick offcanvas reference(s)'
            : ''}
        subtitle="Chrome designation"
        kindFilter={['chrome'] as readonly WebTemplateKind[]}
        familyFilter={
          picker === 'header'   ? ['Header']           :
          picker === 'footer'   ? ['Footer']           :
          picker === 'megamenu' ? ['Megamenu Section'] :
          picker === 'offcanvas'? ['Offcanvas']        :
          undefined
        }
        mode={picker === 'megamenu' || picker === 'offcanvas' ? 'multi' : 'single'}
        selectedIds={
          picker === 'header'   ? (project.primary_header_template_id ? [project.primary_header_template_id] : []) :
          picker === 'footer'   ? (project.primary_footer_template_id ? [project.primary_footer_template_id] : []) :
          picker === 'megamenu' ? project.megamenu_template_ids :
          picker === 'offcanvas'? project.offcanvas_template_ids :
          []
        }
        onSelect={async (ids) => {
          if (picker === 'header' || picker === 'footer') {
            await setPrimaryChrome(picker, ids[0] ?? null)
          } else if (picker === 'megamenu' || picker === 'offcanvas') {
            await setChromeArray(picker, ids)
          }
        }}
      />

      {/* Add page modal — inline form */}
      {addPageOpen && (
        <AddPageModal
          projectId={project.id}
          phase={addPageOpen}
          existingPages={pages}
          onClose={() => setAddPageOpen(null)}
          onCreated={async () => { setAddPageOpen(null); await load() }}
        />
      )}
    </div>
  )
}

// ── Chrome designation row ───────────────────────────────────────────

function ChromeDesignationRow({
  project, chromeTemplates, onOpenPicker,
}: {
  project: StrategyWebProject
  chromeTemplates: Record<string, WebContentTemplate>
  onOpenPicker: (slot: ChromeSlot) => void
}) {
  const headerTpl = project.primary_header_template_id ? chromeTemplates[project.primary_header_template_id] : null
  const footerTpl = project.primary_footer_template_id ? chromeTemplates[project.primary_footer_template_id] : null

  return (
    <WMCard padding="loose" className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Layout size={13} className="text-wm-accent-strong" />
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle">Chrome designation</p>
      </div>
      <p className="text-[12px] text-wm-text-muted mb-4">
        Primary header + footer render on every page. Megamenu + Offcanvas are reference variants
        for the dev style guide; they don't auto-render on pages.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ChromeSlotCard
          slot="header"
          label="Primary header"
          template={headerTpl}
          onClick={() => onOpenPicker('header')}
        />
        <ChromeSlotCard
          slot="footer"
          label="Primary footer"
          template={footerTpl}
          onClick={() => onOpenPicker('footer')}
        />
        <ChromeSlotCard
          slot="megamenu"
          label={`Megamenu references${project.megamenu_template_ids?.length ? ` (${project.megamenu_template_ids.length})` : ''}`}
          template={null}
          listCount={project.megamenu_template_ids?.length ?? 0}
          onClick={() => onOpenPicker('megamenu')}
        />
        <ChromeSlotCard
          slot="offcanvas"
          label={`Offcanvas references${project.offcanvas_template_ids?.length ? ` (${project.offcanvas_template_ids.length})` : ''}`}
          template={null}
          listCount={project.offcanvas_template_ids?.length ?? 0}
          onClick={() => onOpenPicker('offcanvas')}
        />
      </div>
    </WMCard>
  )
}

function ChromeSlotCard({
  label, template, listCount, onClick,
}: {
  slot: ChromeSlot
  label: string
  template: WebContentTemplate | null
  listCount?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-md bg-wm-bg border border-wm-border hover:border-wm-border-focus hover:bg-wm-bg-elevated transition-colors text-left"
    >
      <div className="w-16 h-12 rounded-md bg-wm-bg-hover border border-wm-border overflow-hidden shrink-0">
        {template?.preview_image_url ? (
          <img src={template.preview_image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full grid place-items-center text-[9px] text-wm-text-subtle">
            {listCount && listCount > 0 ? `${listCount}` : '—'}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</p>
        <p className="text-[13px] font-medium text-wm-text truncate">
          {template ? template.layer_name : 'Not designated'}
        </p>
        {template && (
          <p className="text-[10px] text-wm-text-subtle truncate">{template.family}</p>
        )}
      </div>
    </button>
  )
}

// ── Phase group ──────────────────────────────────────────────────────

function PhaseGroup({
  phase, pages, loading, onAddPage, onOpenPage, onArchivePage,
}: {
  phase: { key: string; label: string; description: string }
  pages: WebPage[]
  loading: boolean
  onAddPage: () => void
  onOpenPage: (id: string) => void
  onArchivePage: (id: string) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-wm-text">{phase.label}</h3>
          <p className="text-[11px] text-wm-text-muted">{phase.description}</p>
        </div>
        <WMButton variant="ghost" size="sm" iconLeft={<Plus size={12} />} onClick={onAddPage}>
          Add page
        </WMButton>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-14 rounded-md bg-wm-bg-hover animate-pulse" />
          ))}
        </div>
      ) : pages.length === 0 ? (
        <button
          type="button"
          onClick={onAddPage}
          className="w-full rounded-md border border-dashed border-wm-border bg-wm-bg p-4 text-[12px] text-wm-text-muted hover:border-wm-border-focus hover:text-wm-text transition-colors"
        >
          No pages yet. Click to add one.
        </button>
      ) : (
        <div className="space-y-1.5">
          {pages.map(p => <PageRow key={p.id} page={p} onOpen={() => onOpenPage(p.id)} onArchive={() => onArchivePage(p.id)} />)}
        </div>
      )}
    </div>
  )
}

function PageRow({
  page, onOpen, onArchive,
}: {
  page: WebPage
  onOpen: () => void
  onArchive: () => void
}) {
  const statusTone: WMStatusTone =
    page.content_status === 'approved'  ? 'success' :
    page.content_status === 'in_review' ? 'info'    :
    page.content_status === 'archived'  ? 'neutral' :
    'neutral'

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-md bg-wm-bg-elevated border border-wm-border hover:border-wm-border-focus transition-colors">
      <FileText size={14} className="text-wm-text-subtle shrink-0" />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <p className="text-[13px] font-medium text-wm-text truncate">{page.name}</p>
        <p className="text-[11px] text-wm-text-subtle truncate">/{page.slug}</p>
      </button>
      <WMStatusPill tone={statusTone} size="sm">{page.content_status}</WMStatusPill>
      {page.ai_drafted_at && !page.edited_since_ai && (
        <WMStatusPill tone="ai" size="sm">AI draft</WMStatusPill>
      )}
      <WMIconButton label="Archive page" size="sm" onClick={onArchive} className="opacity-0 group-hover:opacity-100 transition-opacity">
        <Archive size={13} />
      </WMIconButton>
      <WMIconButton label="More actions" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
        <MoreHorizontal size={13} />
      </WMIconButton>
    </div>
  )
}

// ── Add page modal ───────────────────────────────────────────────────

function AddPageModal({
  projectId, phase, existingPages, onClose, onCreated,
}: {
  projectId: string
  phase: string
  existingPages: WebPage[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNameChange = (v: string) => {
    setName(v)
    if (!slug || slug === toSlug(name)) setSlug(toSlug(v))
  }

  const save = async () => {
    setError(null)
    if (!name.trim() || !slug.trim()) { setError('Name and slug are required.'); return }
    if (existingPages.some(p => p.slug === slug.trim())) {
      setError(`Slug "${slug}" is already in use on this project.`); return
    }
    setSaving(true)
    const maxOrder = existingPages.filter(p => p.phase === phase).reduce((m, p) => Math.max(m, p.sort_order), 0)
    const { error: insertErr } = await supabase.from('web_pages').insert({
      web_project_id: projectId,
      name: name.trim(),
      slug: slug.trim(),
      phase,
      sort_order: maxOrder + 1,
    })
    setSaving(false)
    if (insertErr) { setError(insertErr.message); return }
    await onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-wm-text/30 backdrop-blur-[1px] animate-wm-fade-in" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-wm-bg-elevated rounded-lg border border-wm-border shadow-2xl w-full max-w-md p-5 animate-wm-slide-in-up">
        <h3 className="text-[15px] font-semibold text-wm-text mb-1">Add page</h3>
        <p className="text-[12px] text-wm-text-muted mb-4">
          Phase: <span className="font-semibold text-wm-text">{phase}</span>
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Page name</label>
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              autoFocus
              placeholder="e.g. Plan a Visit"
              className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Slug</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-wm-text-subtle">/</span>
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(toSlug(e.target.value))}
                placeholder="plan-a-visit"
                className="flex-1 h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
              />
            </div>
          </div>
          {error && <p className="text-[12px] text-wm-danger">{error}</p>}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <WMButton variant="ghost" size="sm" onClick={onClose}>Cancel</WMButton>
          <WMButton variant="primary" size="sm" loading={saving} onClick={save}>Create page</WMButton>
        </div>
      </div>
    </div>
  )
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

// ── Content strategy preview — renders the full Stage 2 proposal ─────

function ContentStrategyPreview({ project }: { project: StrategyWebProject }) {
  const stage2 = (project.roadmap_state as { stage_2?: Record<string, unknown> } | null)?.stage_2
  const hasData = !!stage2 && Object.keys(stage2).some(k => k !== '_meta')

  if (!hasData) {
    return (
      <WMCard padding="loose">
        <div className="text-center py-8">
          <GitBranch size={28} className="text-wm-text-subtle mx-auto mb-3" />
          <h3 className="text-[15px] font-semibold text-wm-text mb-1">Sitemap proposal</h3>
          <p className="text-[12px] text-wm-text-muted max-w-md mx-auto">
            The AI Sitemap agent populates this at Stage 2 of the pipeline. Approve Stage 1
            on the Roadmap tab to kick it off.
          </p>
        </div>
      </WMCard>
    )
  }

  return (
    <WMCard padding="loose">
      <Stage2SitemapView data={stage2!} viewMode="preview" />
    </WMCard>
  )
}

// ── Stage 2 proposal banner (author mode) ────────────────────────────

function SitemapProposalBanner({
  project, onCommitted, onRefreshed,
}: {
  project: StrategyWebProject
  onCommitted: () => void | Promise<void>
  onRefreshed: () => void | Promise<void>
}) {
  const stage2 = (project.roadmap_state as { stage_2?: Record<string, unknown> } | null)?.stage_2
  const hasData = !!stage2 && Object.keys(stage2).some(k => k !== '_meta')
  const meta = stage2?._meta as Record<string, unknown> | undefined
  const committedAt = meta?.committed_at as string | undefined
  const phaseSummary = stage2?.phase_summary as Record<string, unknown> | undefined
  const totalPages = phaseSummary?.total as number | undefined

  const [expanded, setExpanded] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitMsg, setCommitMsg] = useState<string | null>(null)
  const [redoOpen, setRedoOpen] = useState(false)
  const [redoing, setRedoing] = useState(false)
  const [redoMsg, setRedoMsg] = useState<string | null>(null)

  if (!hasData) return null

  const handleCommit = async () => {
    if (!confirm('Create web_pages records from the AI proposal? Existing pages with the same slug will be skipped.')) return
    setCommitting(true)
    setCommitMsg(null)
    const { result, error } = await commitSitemapToPages(project.id)
    setCommitting(false)
    if (error) {
      setCommitMsg(`Error: ${error.error}`)
      return
    }
    if (result) {
      setCommitMsg(`Created ${result.created} page${result.created === 1 ? '' : 's'}${result.skipped ? ` · skipped ${result.skipped} duplicate slug${result.skipped === 1 ? '' : 's'}` : ''}.`)
      await onCommitted()
    }
  }

  const alreadyCommitted = !!committedAt

  const handleRedo = async (context: string) => {
    setRedoOpen(false)
    setRedoing(true)
    setRedoMsg(null)
    try {
      const { result, error } = await draftSitemap(project.id, context)
      if (error) {
        setRedoMsg(`Error: ${error.error}`)
        return
      }
      if (result) {
        setRedoMsg('Proposal refined.')
        await onRefreshed()
      }
    } catch (e) {
      setRedoMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRedoing(false)
    }
  }

  return (
    <WMCard padding="loose" className="mb-5 border-wm-ai-border bg-wm-ai-bg/40">
      <div className="flex items-start gap-3 flex-wrap">
        <Sparkles size={18} className="text-wm-accent-strong shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-wm-text">
              Sitemap proposal{totalPages ? ` · ${totalPages} pages` : ''}
            </p>
            {alreadyCommitted && (
              <WMStatusPill tone="success" size="sm" icon={<CheckCircle2 size={10} />}>
                Committed
              </WMStatusPill>
            )}
            {!alreadyCommitted && (
              <WMStatusPill tone="ai" size="sm">Awaiting approval</WMStatusPill>
            )}
          </div>
          <p className="text-[12px] text-wm-text-muted mt-0.5">
            {alreadyCommitted
              ? `Committed to web pages ${new Date(committedAt!).toLocaleString()}. Proposal stays available for reference.`
              : 'Review the full proposal, then commit the pages so they appear in the tree below and the Pages tab.'}
          </p>
          {commitMsg && (
            <p className="text-[12px] mt-2 text-wm-accent-strong">{commitMsg}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <WMButton
            variant="ghost"
            size="sm"
            iconLeft={expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            onClick={() => setExpanded(o => !o)}
          >
            {expanded ? 'Hide proposal' : 'View proposal'}
          </WMButton>
          {!alreadyCommitted && (
            <>
              <WMButton
                variant="primary"
                size="sm"
                onClick={handleCommit}
                loading={committing}
                disabled={committing}
              >
                Approve &amp; commit pages
              </WMButton>
              <WMButton
                variant="ghost"
                size="sm"
                iconLeft={<RotateCw size={11} />}
                onClick={() => setRedoOpen(true)}
                disabled={redoing}
              >
                Redo with changes
              </WMButton>
            </>
          )}
        </div>
      </div>
      {redoMsg && (
        <p className="text-[12px] mt-3 text-wm-accent-strong">{redoMsg}</p>
      )}
      {expanded && (
        <div className="mt-5 pt-5 border-t border-wm-border">
          <Stage2SitemapView data={stage2!} viewMode="author" />
        </div>
      )}
      {redoOpen && (
        <RedoModal
          stageNum={2}
          stageTitle="Sitemap"
          loading={redoing}
          onClose={() => setRedoOpen(false)}
          onSubmit={handleRedo}
        />
      )}
    </WMCard>
  )
}
