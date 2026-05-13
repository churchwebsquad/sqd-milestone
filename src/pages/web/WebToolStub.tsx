/**
 * Shared layout for the Phase-1 tool stubs (Intake / Content / Design /
 * Dev / Reviews). Renders breadcrumbs + project header + a
 * "what-this-will-do" block per tool. Each tool page hands in its
 * label, icon, and copy.
 *
 * Once a real tool ships, the corresponding page replaces this stub
 * wholesale — the wrapper isn't meant to evolve into the production
 * UI.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { StrategyWebProject } from '../../types/database'

interface BulletGroup {
  title: string
  items: string[]
}

export interface WebToolStubProps {
  toolKey: string
  toolLabel: string
  icon: LucideIcon
  /** One-sentence purpose statement for the tool. */
  purpose: string
  /** What ships in this tool eventually. */
  groups: BulletGroup[]
  /** Phase this tool ships in (e.g. "Phase 3"). */
  shipsIn: string
}

export function WebToolStub({ toolKey, toolLabel, icon: Icon, purpose, groups, shipsIn }: WebToolStubProps) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<StrategyWebProject | null>(null)
  const [churchName, setChurchName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const load = async () => {
      const { data } = await supabase
        .from('strategy_web_projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle()
      if (cancelled || !data) { setLoading(false); return }
      const p = data as StrategyWebProject
      setProject(p)
      const { data: c } = await supabase
        .from('strategy_account_progress')
        .select('church_name')
        .eq('member', p.member)
        .maybeSingle()
      if (!cancelled) setChurchName((c as { church_name: string | null } | null)?.church_name ?? null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [projectId])

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-4xl mx-auto">
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center flex-wrap gap-1 text-xs text-purple-gray">
          <Link to="/web" className="hover:text-primary-purple transition-colors">Website Manager</Link>
          <ChevronRight size={12} className="opacity-60" />
          {project ? (
            <Link
              to={`/web/${project.id}`}
              className="hover:text-primary-purple transition-colors max-w-[40ch] truncate"
            >
              {project.name}
            </Link>
          ) : (
            <span className="opacity-60">Project</span>
          )}
          <ChevronRight size={12} className="opacity-60" />
          <span className="text-deep-plum font-semibold">{toolLabel}</span>
        </nav>

        <button
          type="button"
          onClick={() => projectId ? navigate(`/web/${projectId}`) : navigate('/web')}
          className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to project
        </button>

        {/* Header */}
        <div className="bg-white border border-lavender rounded-2xl p-5 shadow-sm mb-5">
          <div className="flex items-start gap-3">
            <span className="h-11 w-11 rounded-xl bg-lavender-tint/60 inline-flex items-center justify-center shrink-0">
              <Icon size={20} className="text-primary-purple" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold text-primary-purple uppercase tracking-widest mb-0.5">
                {loading ? 'Loading…' : (churchName ?? `Member #${project?.member ?? ''}`)}
                {project && <> · {project.name}</>}
              </p>
              <h1 className="text-2xl font-semibold text-deep-plum tracking-tight">{toolLabel}</h1>
              <p className="text-sm text-purple-gray mt-1">{purpose}</p>
            </div>
            <span className="inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
              {shipsIn}
            </span>
          </div>
        </div>

        {/* What this will do */}
        <div className="bg-white border border-lavender rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-3">
            What {toolLabel} will do
          </p>
          <div className="space-y-4">
            {groups.map(g => (
              <div key={g.title}>
                <p className="text-sm font-semibold text-deep-plum mb-1.5">{g.title}</p>
                <ul className="space-y-1">
                  {g.items.map((it, i) => (
                    <li key={i} className="text-sm text-deep-plum/85 leading-relaxed flex gap-2">
                      <span className="text-primary-purple shrink-0">·</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-purple-gray/70 italic mt-3 text-center">
          Tool key: <code className="bg-lavender-tint/60 px-1.5 py-0.5 rounded">{toolKey}</code> · Stub for build-out review.
        </p>
      </div>
    </div>
  )
}
