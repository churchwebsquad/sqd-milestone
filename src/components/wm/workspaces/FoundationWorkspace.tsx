/**
 * Foundation workspace — stacked Core Messages + Strategic Goals.
 *
 * Replaces the separate "Core messages" + "Strategic goals" tabs
 * (2026-06-17). Both surfaces show on one scrollable page, each
 * under a sticky group header. The strategist used to flip between
 * the two tabs constantly because they're conceptually one piece
 * of work — the project's strategic base — so they live together
 * here.
 *
 * Implementation is intentionally thin: this workspace owns layout
 * only; the two child workspaces own their own data + persistence.
 * Anchor links land directly on either section.
 */
import { Target, MessageSquareQuote } from 'lucide-react'

import { AtomReviewWorkspace } from './AtomReviewWorkspace'
import { StrategicGoalsWorkspace } from './StrategicGoalsWorkspace'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project:  StrategyWebProject
  onChange: () => Promise<void> | void
}

export function FoundationWorkspace({ project, onChange }: Props) {
  return (
    <div className="space-y-6">
      <SectionHeader
        id="foundation-core-messages"
        icon={<MessageSquareQuote size={14} className="text-wm-text-muted" />}
        title="Core messages"
        subtitle="The partner's normalized content atoms — the durable phrases pages can lift verbatim. Approved atoms feed every downstream step."
      />
      <div id="foundation-core-messages-body">
        <AtomReviewWorkspace project={project} onChange={onChange} />
      </div>

      <div className="h-px bg-wm-border my-8" />

      <SectionHeader
        id="foundation-strategic-goals"
        icon={<Target size={14} className="text-wm-text-muted" />}
        title="Strategic goals"
        subtitle="Approved goals + tone + content allocation rules. Cowork reads these on every step; outline → draft → critique enforce them."
      />
      <div id="foundation-strategic-goals-body">
        <StrategicGoalsWorkspace project={project} onChange={onChange} />
      </div>
    </div>
  )
}

function SectionHeader({
  id, icon, title, subtitle,
}: {
  id:       string
  icon:     React.ReactNode
  title:    string
  subtitle: string
}) {
  return (
    <header id={id} className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-wm-bg/95 backdrop-blur border-b border-wm-border scroll-mt-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-[15px] font-semibold text-wm-text">{title}</h2>
      </div>
      <p className="mt-0.5 text-[11.5px] text-wm-text-muted">{subtitle}</p>
    </header>
  )
}
