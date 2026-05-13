/**
 * Website Manager — Screen 2: Per-project hub.
 *
 * Five tools land here, each as its own tile with a status pill and
 * an "Open" affordance. Tiles map 1:1 to the WebHub Roadmap's five
 * agents:
 *
 *   Intake             → Site crawl + AM handoff + content + brand assets + strategy brief
 *   Content Manager    → Snippets + brand-voice-aligned copy bound to Brixies
 *   Design Manager     → Design system display + style-guide build instructions
 *   Dev Manager        → ACF + Bricks/Novamira import package
 *   Review Console     → Content gates (Phase 1); Design + Dev use markup links later
 *
 * Phase 1 of the Web Manager build only renders the hub. Each tool
 * page is a stub with a what-this-will-do empty state until the
 * subsequent phases build it out.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, ChevronRight, ClipboardList, Code2, Eye, FileEdit, Palette,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { LucideIcon } from 'lucide-react'
import type { StrategyWebProject } from '../../types/database'

type ToolKey = 'intake' | 'content' | 'design' | 'dev' | 'reviews'
type ToolStatus = 'not_started' | 'in_progress' | 'ready_for_review' | 'approved' | 'unknown'

interface ToolTile {
  key: ToolKey
  label: string
  icon: LucideIcon
  description: string
  status: ToolStatus
  statusLabel: string
}

interface ChurchInfo {
  member: number
  church_name: string | null
  css_rep: string | null
}

export default function WebProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<StrategyWebProject | null>(null)
  const [church, setChurch] = useState<ChurchInfo | null>(null)
  // Discovery-questionnaire presence is the only real signal we can
  // read in Phase 1. The other four tiles render with placeholder
  // status until their tools are built.
  const [hasDiscovery, setHasDiscovery] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const { data: projRes, error: projErr } = await supabase
        .from('strategy_web_projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle()
      if (projErr) throw projErr
      if (!projRes) {
        setError('Project not found.')
        setLoading(false)
        return
      }
      const p = projRes as StrategyWebProject
      setProject(p)

      const [churchRes, dqRes] = await Promise.all([
        supabase
          .from('strategy_account_progress')
          .select('member, church_name, css_rep')
          .eq('member', p.member)
          .maybeSingle(),
        supabase
          .from('strategy_discovery_questionnaire')
          .select('id')
          .eq('member', p.member)
          .limit(1),
      ])
      if (churchRes.data) setChurch(churchRes.data as ChurchInfo)
      setHasDiscovery((dqRes.data ?? []).length > 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [projectId])

  const tiles: ToolTile[] = useMemo(() => {
    const intakeStatus: ToolStatus = hasDiscovery ? 'in_progress' : 'not_started'
    const intakeLabel = hasDiscovery ? 'Discovery on file' : 'Not started'
    return [
      {
        key: 'intake',
        label: 'Intake',
        icon: ClipboardList,
        description: 'Existing site crawl, AM handoff notes, content collection (with client amendments), brand assets, strategy brief.',
        status: intakeStatus,
        statusLabel: intakeLabel,
      },
      {
        key: 'content',
        label: 'Content Manager',
        icon: FileEdit,
        description: 'Snippets, brand-voice-aligned copy, page-by-page binding to Brixies sections, ship for client review.',
        status: 'not_started',
        statusLabel: 'Not started',
      },
      {
        key: 'design',
        label: 'Design Manager',
        icon: Palette,
        description: 'Design system surface, style-guide build instructions, unique Brixies section roll-up.',
        status: 'not_started',
        statusLabel: 'Not started',
      },
      {
        key: 'dev',
        label: 'Dev Manager',
        icon: Code2,
        description: 'ACF field groups, Bricks / Novamira import, Church Settings options page generated from snippets.',
        status: 'not_started',
        statusLabel: 'Not started',
      },
      {
        key: 'reviews',
        label: 'Review Console',
        icon: Eye,
        description: 'Content gates first. Design + Dev reviews flow through markup links.',
        status: 'not_started',
        statusLabel: 'Not started',
      },
    ]
  }, [hasDiscovery])

  const handleArchive = async () => {
    if (!project) return
    const next = !project.archived
    const ok = window.confirm(
      next
        ? 'Archive this project?\n\nIt drops off the active Website Manager grid. Toggle "Show archived" to restore.'
        : 'Restore this project?',
    )
    if (!ok) return
    setArchiving(true)
    try {
      const { error: updErr } = await supabase
        .from('strategy_web_projects')
        .update({ archived: next })
        .eq('id', project.id)
      if (updErr) throw updErr
      await load()
    } catch (e) {
      setWarning(e instanceof Error ? e.message : 'Archive failed')
    } finally {
      setArchiving(false)
    }
  }

  const churchName = church?.church_name ?? (project ? `Member #${project.member}` : '')

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center flex-wrap gap-1 text-xs text-purple-gray">
          <Link to="/web" className="hover:text-primary-purple transition-colors">Website Manager</Link>
          <ChevronRight size={12} className="opacity-60" />
          <span className="text-deep-plum font-semibold truncate max-w-[40ch]">
            {project?.name ?? 'Project'}
          </span>
        </nav>

        <button
          type="button"
          onClick={() => navigate('/web')}
          className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          All projects
        </button>

        {loading && (
          <div className="space-y-3">
            <div className="h-20 bg-lavender-tint/40 rounded-2xl animate-pulse" />
            <div className="h-32 bg-lavender-tint/40 rounded-2xl animate-pulse" />
          </div>
        )}
        {error && !loading && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && project && (
          <>
            {/* Header */}
            <div className="bg-white border border-lavender rounded-2xl p-5 shadow-sm mb-6 flex items-start justify-between flex-wrap gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-primary-purple uppercase tracking-widest mb-0.5">
                  {churchName}
                </p>
                <h1 className="text-2xl font-semibold text-deep-plum tracking-tight">{project.name}</h1>
                <p className="text-xs text-purple-gray mt-1">
                  Member #{project.member}
                  {church?.css_rep && (<> · AM: <span className="font-medium text-deep-plum">{church.css_rep}</span></>)}
                  {' · Engagement: '}<span className="capitalize">{project.kind.replace('_', ' ')}</span>
                  {' · Phase: '}<span className="capitalize">{project.current_phase}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  to={`/churches/${project.member}`}
                  className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
                >
                  Church detail
                </Link>
                <button
                  type="button"
                  onClick={handleArchive}
                  disabled={archiving}
                  className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-xs font-semibold text-purple-gray px-3 py-1.5 hover:border-deep-plum hover:text-deep-plum transition-colors disabled:opacity-60"
                >
                  {archiving ? '…' : project.archived ? 'Restore' : 'Archive'}
                </button>
              </div>
            </div>

            {warning && (
              <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
                {warning}
              </div>
            )}

            {/* Tool tiles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tiles.map(tile => (
                <ToolTileCard key={tile.key} projectId={project.id} tile={tile} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ToolTileCard({ projectId, tile }: { projectId: string; tile: ToolTile }) {
  const Icon = tile.icon
  return (
    <Link
      to={`/web/${projectId}/${tile.key}`}
      className="group rounded-xl border border-lavender bg-white p-4 hover:border-primary-purple hover:shadow-sm transition-all flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="h-9 w-9 rounded-lg bg-lavender-tint/60 inline-flex items-center justify-center shrink-0">
            <Icon size={16} className="text-primary-purple" />
          </span>
          <h2 className="text-base font-semibold text-deep-plum truncate">{tile.label}</h2>
        </div>
        <StatusPill status={tile.status} label={tile.statusLabel} />
      </div>
      <p className="text-xs text-purple-gray leading-relaxed">{tile.description}</p>
      <div className="text-xs font-semibold text-primary-purple inline-flex items-center gap-1 mt-auto">
        Open {tile.label}
        <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  )
}

function StatusPill({ status, label }: { status: ToolStatus; label: string }) {
  const styles = {
    not_started:        'bg-lavender-tint text-purple-gray border-lavender',
    in_progress:        'bg-amber-100 text-amber-800 border-amber-200',
    ready_for_review:   'bg-blue-100 text-blue-800 border-blue-200',
    approved:           'bg-green-100 text-green-800 border-green-200',
    unknown:            'bg-lavender-tint text-purple-gray border-lavender',
  }[status]
  return (
    <span className={`inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 border ${styles} shrink-0`}>
      {label}
    </span>
  )
}
