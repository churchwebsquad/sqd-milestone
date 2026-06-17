/**
 * Website Manager — Site Manager (formerly Content Manager).
 *
 * The strategist's single entry point for a partner project. Tabs at
 * the top cover every artifact-producing surface; per-project
 * reference content (writing rules, brand voice, snippets) lives in
 * the assistant rail on the right.
 *
 *   Intake         — foundational inputs checklist (Discovery, Strategy
 *                    Brief, Brand Handoff, AM Handoff, Content Collection)
 *   Site Library   — curated Brixies palette (Header / Footer / Heroes /
 *                    Cards / etc.) — formerly "Global Elements"
 *   Pages          — per-page section editor
 *   Design Handoff — design system spec, role anchors, Figma exports +
 *                    the Style Guide assembler plugin
 *   Dev Handoff    — ACSS Pro GVM JSON + (future) full handoff document
 *   Review         — review console
 *
 * Roadmap + Rollup tabs were dropped — they were AI-pipeline workspaces
 * that weren't being used in the day-to-day flow. Snippets, Voice, and
 * Heuristics moved to the assistant rail.
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  ClipboardList, LayoutGrid, FileText, Palette, Cog, Eye, Loader2, CalendarClock, Rocket, Target,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { WebManagerShell } from '../../components/wm'
import type { WMTabItem } from '../../components/wm'
import { AssistantRail } from '../../components/wm/AssistantRail'
import { SectionEditingProvider } from '../../components/wm/sectioneditor/SectionEditingContext'
import { GlobalElementsWorkspace } from '../../components/wm/workspaces/GlobalElementsWorkspace'
import { PagesWorkspace } from '../../components/wm/workspaces/PagesWorkspace'
import { DesignWorkspace } from '../../components/wm/workspaces/DesignWorkspace'
import { DevHandoffWorkspace } from '../../components/wm/workspaces/DevHandoffWorkspace'
import { IntakeWorkspace } from '../../components/wm/workspaces/IntakeWorkspace'
import { ReviewWorkspace } from '../../components/wm/workspaces/ReviewWorkspace'
import { PlanningWorkspace } from '../../components/wm/workspaces/PlanningWorkspace'
import { FoundationWorkspace } from '../../components/wm/workspaces/FoundationWorkspace'
import { CoworkWorkspace } from '../../components/wm/workspaces/CoworkWorkspace'
import type { StrategyWebProject } from '../../types/database'

type TabKey =
  | 'planning'
  | 'cowork'
  | 'intake'
  | 'foundation'
  | 'library'
  | 'pages'
  | 'design'
  | 'devhandoff'
  | 'review'

const TABS: readonly WMTabItem<TabKey>[] = [
  { key: 'planning',   label: 'Planning',         icon: <CalendarClock size={13} /> },
  { key: 'intake',     label: 'Intake & Crawl',   icon: <ClipboardList size={13} /> },
  { key: 'foundation', label: 'Foundation',       icon: <Target        size={13} /> },
  { key: 'cowork',     label: 'Content Engine',   icon: <Rocket        size={13} /> },
  { key: 'library',    label: 'Site Library',     icon: <LayoutGrid    size={13} /> },
  { key: 'pages',      label: 'Pages',            icon: <FileText      size={13} /> },
  { key: 'design',     label: 'Design Handoff',   icon: <Palette       size={13} /> },
  { key: 'devhandoff', label: 'Dev Handoff',      icon: <Cog           size={13} /> },
  { key: 'review',     label: 'Review',           icon: <Eye           size={13} /> },
]

const DEFAULT_TAB: TabKey = 'pages'

export default function WebContentManagerPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [params, setParams] = useSearchParams()
  // Migrate legacy ?tab=… values from the old tab vocabulary so existing
  // bookmarks don't 404 their tab and silently fall back.
  const rawTab = params.get('tab')
  const activeTab: TabKey = (() => {
    if (!rawTab) return DEFAULT_TAB
    if (rawTab === 'global') return 'library'                        // renamed
    if (rawTab === 'atoms' || rawTab === 'goals') return 'foundation' // merged into Foundation
    if (rawTab === 'engine' || rawTab === 'pipeline') return 'cowork' // legacy workspaces folded into Content Engine
    if (rawTab === 'roadmap' || rawTab === 'rollup' || rawTab === 'snippets' || rawTab === 'voice' || rawTab === 'heuristics') {
      return DEFAULT_TAB                                              // dropped/moved → land on pages
    }
    if (rawTab === 'settings') return DEFAULT_TAB   // moved to /web (org-wide)
    if (rawTab === 'crawl')    return 'intake'      // merged into intake
    const known: ReadonlyArray<TabKey> = ['planning','cowork','intake','foundation','library','pages','design','devhandoff','review']
    return (known as readonly string[]).includes(rawTab) ? (rawTab as TabKey) : DEFAULT_TAB
  })()

  const [project, setProject] = useState<StrategyWebProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(true)

  // Silent by default — in-app mutations that call onChange refetch
  // without flipping the loading spinner, which would unmount the
  // tab body and read as a page refresh to the user. Only the
  // initial mount + project change flip the spinner.
  const loadProject = async (silent = true) => {
    if (!projectId) return
    if (!silent) setLoading(true)
    const { data, error: err } = await supabase
      .from('strategy_web_projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle()
    if (err || !data) setError(err?.message ?? 'Project not found')
    else setProject(data as StrategyWebProject)
    if (!silent) setLoading(false)
  }

  useEffect(() => { void loadProject(false) }, [projectId])

  // Project polling was removed: it ran every 5 seconds and replaced
  // the `project` object reference even when nothing changed, which
  // re-rendered every workspace + flickered the iframe canvas. The
  // AI-status pill that originally needed live updates has been
  // dropped, and any in-app mutation already calls loadProject()
  // explicitly via onChange callbacks. External jsonb edits land on
  // the next page refresh — that's acceptable.

  if (loading) {
    return (
      <div className="min-h-full grid place-items-center bg-wm-bg text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (error || !project) {
    return (
      <div className="min-h-full py-6 px-4 md:px-6 max-w-3xl mx-auto">
        <div className="rounded-xl bg-wm-danger-bg border border-wm-danger/15 px-4 py-3 text-sm text-wm-danger">
          {error ?? 'Project not found.'}
        </div>
      </div>
    )
  }

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  return (
    <SectionEditingProvider>
      <WebManagerShell
        projectId={project.id}
        projectName={project.name}
        breadcrumb={[{ label: 'Site Manager' }]}
        aiStatus={null}
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setTab}
        rail={<AssistantRail
          projectId={project.id}
          activeTab={activeTab}
          project={project}
          onProjectChange={loadProject}
        />}
        railOpen={railOpen}
        onRailToggle={setRailOpen}
      >
        {activeTab === 'planning'   && <PlanningWorkspace project={project} onChange={loadProject} />}
        {activeTab === 'intake'     && <IntakeWorkspace project={project} onChange={loadProject} />}
        {activeTab === 'foundation' && <FoundationWorkspace project={project} onChange={loadProject} />}
        {activeTab === 'cowork'     && <CoworkWorkspace project={project} onChange={loadProject} />}
        {activeTab === 'library'    && <GlobalElementsWorkspace project={project} onChange={loadProject} />}
        {activeTab === 'pages'      && <PagesWorkspace project={project} onChange={loadProject} />}
        {activeTab === 'design'     && <DesignWorkspace project={project} onChange={loadProject} />}
        {activeTab === 'devhandoff' && <DevHandoffWorkspace project={project} />}
        {activeTab === 'review'     && <ReviewWorkspace project={project} />}
      </WebManagerShell>
    </SectionEditingProvider>
  )
}
