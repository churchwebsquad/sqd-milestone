import { Paperclip, Image, FileText, FolderOpen, Sparkles, BookOpen } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { StrategyAccountProgress } from '../../types/database'
import type { EnrichedSubmission } from '../../pages/ChurchDetailPage'
import { ASSET_TYPE_LABELS } from '../submit/types'
import { SectionHeader, SubSectionLabel, DocLink } from './ChurchUI'

interface Props {
  church: StrategyAccountProgress
  submissions: EnrichedSubmission[]
}

export default function AssetsSection({ church, submissions }: Props) {
  // Known URL fields — mapped per data mapping doc
  const knownAssets: { label: string; field: string; icon: LucideIcon }[] = [
    { label: 'Photos', field: 'photos_link', icon: Image },
    { label: 'Discovery Questionnaire', field: 'discovery_view_link', icon: FileText },
    { label: 'Strategy Brief', field: 'strategy_brief', icon: BookOpen },
    { label: 'Notion Dashboard', field: 'notion_dashboard', icon: FolderOpen },
    { label: 'Custom GPT', field: 'custom_gpt', icon: Sparkles },
  ]

  const submissionAssets = submissions.flatMap(e => e.assets)
  const churchAssetsPresent = knownAssets.filter(a => (church as Record<string, unknown>)[a.field])

  return (
    <section id="assets" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <SectionHeader icon={Paperclip} title="Assets" />

      {/* Church-level asset links */}
      {churchAssetsPresent.length > 0 && (
        <div className="mb-4">
          <SubSectionLabel label="Church Documents" icon={FileText} variant="docs" />
          <div className="flex flex-wrap gap-2">
            {churchAssetsPresent.map(({ label, field, icon }) => {
              const url = (church as Record<string, unknown>)[field] as string | null
              if (!url) return null
              return <DocLink key={field} label={label} url={url} icon={icon} />
            })}
          </div>
        </div>
      )}

      {/* Submission assets */}
      {submissionAssets.length > 0 && (
        <div>
          <SubSectionLabel label="From Milestone Submissions" icon={Paperclip} variant="docs" />
          <div className="flex flex-wrap gap-2">
            {submissionAssets.map(a => (
              <DocLink
                key={a.id}
                label={a.asset_label || ASSET_TYPE_LABELS[a.asset_type] || a.asset_type}
                url={a.asset_url}
              />
            ))}
          </div>
        </div>
      )}

      {churchAssetsPresent.length === 0 && submissionAssets.length === 0 && (
        <p className="text-xs text-purple-gray/50 italic">No assets linked yet.</p>
      )}
    </section>
  )
}
