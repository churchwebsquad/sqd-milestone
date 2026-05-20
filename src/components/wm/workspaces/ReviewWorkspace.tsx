/**
 * Web Manager — Review workspace (placeholder for now).
 *
 * The substance of the review console (in-app client reviews, Markup
 * link integration, approve/request-changes flow) ships in a later
 * phase. For v1 of the Site Manager restructure we just surface the
 * placeholder copy here so the tab is visible and discoverable in
 * the right slot.
 */

import { Eye } from 'lucide-react'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

export function ReviewWorkspace({ project: _project }: Props) {
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <Eye size={13} />
            <p className="text-[11px] font-bold uppercase tracking-widest">Review</p>
          </div>
          <h1 className="text-2xl font-semibold text-wm-text">Review console</h1>
          <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
            Centralizes review state across content, design, and dev. Coming
            in a follow-up phase.
          </p>
        </header>

        <div className="space-y-4">
          <PlaceholderGroup
            title="Content reviews (in-app)"
            items={[
              'Per-page client review packets, generated when the strategist clicks "Send for review" inside Pages.',
              'Comment threads + suggest-edit, scoped per section.',
              'Approve / Request Changes per section. Page-level approve rolls up automatically.',
              "Threaded back into the strategist's queue with status badges.",
            ]}
          />
          <PlaceholderGroup
            title="Design + Dev reviews (Markup links)"
            items={[
              'Design Handoff + Dev Handoff each capture a Markup link.',
              'This page surfaces the latest link per tool and the most recent activity timestamp from Markup.',
            ]}
          />
          <PlaceholderGroup
            title="Status pill rule"
            items={[
              'Aggregate of "open content reviews" + "pending markup responses". Tile turns green when nothing is awaiting the partner.',
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function PlaceholderGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-4">
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">{title}</p>
      <ul className="space-y-1.5 text-[13px] text-wm-text-muted">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-wm-text-subtle">·</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
