import { ExternalLink } from 'lucide-react'
import type { StrategyAccountProgress } from '../../types/database'
import type { EnrichedSubmission } from '../../pages/ChurchDetailPage'
import { ASSET_TYPE_LABELS } from '../submit/types'

interface Props {
  church: StrategyAccountProgress
  submissions: EnrichedSubmission[]
}

/** Renders a known URL field as a pill link if the value is non-null. */
function AssetPill({ label, url }: { label: string; url: string | null | undefined }) {
  if (!url || typeof url !== 'string') return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
    >
      <ExternalLink size={10} className="shrink-0" />
      {label}
    </a>
  )
}

export default function AssetsSection({ church, submissions }: Props) {
  // Known URL fields — mapped per data mapping doc
  const knownAssets = [
    { label: 'Photos', field: 'photos_link', source: 'church' as const },
    { label: 'Discovery Questionnaire', field: 'discovery_view_link', source: 'church' as const },
    { label: 'Strategy Brief', field: 'strategy_brief', source: 'church' as const },
    { label: 'Notion Dashboard', field: 'notion_dashboard', source: 'church' as const },
    { label: 'Custom GPT', field: 'custom_gpt', source: 'church' as const },
  ]

  // All assets from milestone submissions
  const submissionAssets = submissions.flatMap(e => e.assets)

  return (
    <section id="assets" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider mb-4">Assets</h2>

      {/* Church-level asset links */}
      <div className="flex flex-wrap gap-2 mb-4">
        {knownAssets.map(({ label, field }) => (
          <AssetPill key={field} label={label} url={(church as Record<string, unknown>)[field] as string | null} />
        ))}
      </div>

      {knownAssets.every(a => !(church as Record<string, unknown>)[a.field]) && submissionAssets.length === 0 && (
        <p className="text-xs text-purple-gray/50 italic">No assets linked yet.</p>
      )}

      {/* Submission assets */}
      {submissionAssets.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-2 mt-2">From Milestone Submissions</p>
          <div className="flex flex-wrap gap-2">
            {submissionAssets.map(a => (
              <a
                key={a.id}
                href={a.asset_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
              >
                <ExternalLink size={10} className="shrink-0" />
                {a.asset_label || ASSET_TYPE_LABELS[a.asset_type] || a.asset_type}
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
