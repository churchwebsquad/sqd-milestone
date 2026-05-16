/**
 * Website Manager — Content Manager.
 *
 * The strategist's primary workspace. Hosts seven views via the
 * WebManagerShell's tabbed surface:
 *
 *   Roadmap         — Web Roadmap deliverable + AI pipeline orchestration
 *   Global Elements — curated Brixies palette (Header/Footer, Heroes, Cards, …)
 *   Pages           — per-page section editor (TipTap, Phase B)
 *   Snippets        — global merge fields + custom snippets
 *   Voice           — read-only brand voice rollup
 *   Heuristics      — writing rules (global + project) + denominational filter + personas
 *   Rollup          — editable structured extract from intake
 *
 * The old Sitemap tab was consolidated — page tree management moves into
 * the Pages workspace left panel (Phase 2 of the restructure) and chrome
 * designation moves into Global Elements alongside the broader site
 * palette (Phase 1, done).
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Compass, LayoutGrid, FileText, Tag, Mic, BookOpen, Layers, Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { WebManagerShell } from '../../components/wm'
import type { WMTabItem, WMAIStatusBadgeProps } from '../../components/wm'
import { AssistantRail } from '../../components/wm/AssistantRail'
import { RoadmapWorkspace } from '../../components/wm/workspaces/RoadmapWorkspace'
import { GlobalElementsWorkspace } from '../../components/wm/workspaces/GlobalElementsWorkspace'
import { PagesWorkspace } from '../../components/wm/workspaces/PagesWorkspace'
import { SnippetsWorkspace } from '../../components/wm/workspaces/SnippetsWorkspace'
import { VoiceWorkspace } from '../../components/wm/workspaces/VoiceWorkspace'
import { HeuristicsWorkspace } from '../../components/wm/workspaces/HeuristicsWorkspace'
import { RollupWorkspace } from '../../components/wm/workspaces/RollupWorkspace'
import type { StrategyWebProject } from '../../types/database'

type TabKey =
  | 'roadmap'
  | 'global'
  | 'pages'
  | 'snippets'
  | 'voice'
  | 'heuristics'
  | 'rollup'

const TABS: readonly WMTabItem<TabKey>[] = [
  { key: 'roadmap',    label: 'Roadmap',         icon: <Compass    size={13} /> },
  { key: 'global',     label: 'Global Elements', icon: <LayoutGrid size={13} /> },
  { key: 'pages',      label: 'Pages',           icon: <FileText   size={13} /> },
  { key: 'snippets',   label: 'Snippets',        icon: <Tag        size={13} /> },
  { key: 'voice',      label: 'Voice',           icon: <Mic        size={13} /> },
  { key: 'heuristics', label: 'Heuristics',      icon: <BookOpen   size={13} /> },
  { key: 'rollup',     label: 'Rollup',          icon: <Layers     size={13} /> },
]

export default function WebContentManagerPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [params, setParams] = useSearchParams()
  const activeTab = (params.get('tab') as TabKey) || 'roadmap'

  const [project, setProject] = useState<StrategyWebProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(true)

  const loadProject = async (silent = false) => {
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

  useEffect(() => { void loadProject() }, [projectId])

  // Always poll while the project page is open. The previous "poll only
  // when drafting_*" gate failed because the client doesn't know the
  // server-side stage flipped until it polls — chicken-and-egg. A 5s
  // interval is lightweight (one row read) and catches every state
  // transition (agent start, agent finish, DB write).
  useEffect(() => {
    if (!projectId) return
    const interval = setInterval(() => { void loadProject(true) }, 5000)
    return () => clearInterval(interval)
  }, [projectId])

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

  const aiStatus = deriveAIStatus(project)

  return (
    <WebManagerShell
      projectId={project.id}
      projectName={project.name}
      breadcrumb={[{ label: 'Content Manager' }]}
      aiStatus={aiStatus}
      onClickAIStatus={() => setTab('roadmap')}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setTab}
      rail={<AssistantRail projectId={project.id} activeTab={activeTab} />}
      railOpen={railOpen}
      onRailToggle={setRailOpen}
    >
      {activeTab === 'roadmap'    && <RoadmapWorkspace project={project} onChange={loadProject} />}
      {activeTab === 'global'     && <GlobalElementsWorkspace project={project} onChange={loadProject} />}
      {activeTab === 'pages'      && <PagesWorkspace project={project} />}
      {activeTab === 'snippets'   && <SnippetsWorkspace project={project} onChange={loadProject} />}
      {activeTab === 'voice'      && <VoiceWorkspace project={project} />}
      {activeTab === 'heuristics' && <HeuristicsWorkspace project={project} />}
      {activeTab === 'rollup'     && <RollupWorkspace project={project} />}
    </WebManagerShell>
  )
}

// ── AI status derivation ────────────────────────────────────────────

/**
 * The top-of-shell AI status pill. Reads both `roadmap_stage` (for
 * the currently-running state) AND the sticky approval markers on
 * `roadmap_state.stage_N._meta` so it stays consistent with the
 * Roadmap workspace's stage cards. Walks the pipeline to find the
 * topmost stage that hasn't been approved — that's the focus.
 */
function deriveAIStatus(project: StrategyWebProject): WMAIStatusBadgeProps {
  // Currently running takes precedence
  const stage = project.roadmap_stage
  if (stage === 'extracting_strategy') return { state: 'extracting', message: 'Extracting strategy' }
  if (stage === 'drafting_sitemap')    return { state: 'drafting', message: 'Drafting sitemap' }
  if (stage === 'drafting_journey')    return { state: 'drafting', message: 'Drafting user journey' }
  if (stage === 'drafting_roadmap')    return { state: 'drafting', message: 'Drafting web roadmap' }
  if (stage === 'drafting_pages')      return { state: 'drafting', message: 'Drafting pages' }
  if (stage === 'pre_intake')          return { state: 'idle', message: 'Awaiting intake' }

  // Find the topmost unapproved stage with output → "awaiting your approval"
  // OR topmost unapproved stage WITHOUT output → "ready to run"
  const state = (project.roadmap_state as Record<string, unknown> | null) ?? {}
  const stageNames: Record<number, string> = { 1: 'Strategy', 2: 'Sitemap', 3: 'Journey', 4: 'Roadmap', 5: 'Pages' }
  for (let n = 1; n <= 5; n++) {
    const stageData = state[`stage_${n}`] as Record<string, unknown> | undefined
    const meta = stageData?._meta as Record<string, unknown> | undefined
    const approved = !!(meta?.approved_at || meta?.committed_at)
    const hasOutput = !!stageData && Object.keys(stageData).some(k => k !== '_meta')

    if (approved) continue  // sticky-approved, look at next stage
    if (hasOutput) return { state: 'awaiting', message: `Awaiting your approval — ${stageNames[n]}` }
    // No output for this stage. If we got here, the previous stage IS approved.
    return { state: 'idle', message: `Ready to run — ${stageNames[n]}` }
  }
  // Everything approved through Stage 5
  return { state: 'done', message: 'All pages drafted' }
}
