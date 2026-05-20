import { ExternalLink, Paperclip, Image, FileText, FolderOpen, Sparkles, BookOpen, Camera, Archive } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { StrategyAccountProgress } from '../../types/database'
import type { EnrichedSubmission } from '../../pages/ChurchDetailPage'
import { ASSET_TYPE_LABELS } from '../submit/types'
import { SectionHeader, SubSectionLabel } from './ChurchUI'
import DiscoveryBriefCard from './DiscoveryBriefCard'

interface Props {
  church: StrategyAccountProgress
  submissions: EnrichedSubmission[]
}

interface AssetRow {
  id:      string
  label:   string
  meta?:   string
  url:     string
  icon:    LucideIcon
}

export default function AssetsSection({ church, submissions }: Props) {
  const raw = church as Record<string, unknown>

  // Church-level assets — typed fields routed straight from
  // strategy_account_progress. Photos surface in three slots so staff
  // can pick the right library without hunting.
  const churchAssets: AssetRow[] = [
    { id: 'photos_link',                       label: 'Photos from Discovery',     meta: 'Discovery questionnaire upload', icon: Image,      url: stringField(raw.photos_link) },
    { id: 'photos_from_all_in_discovery_form', label: 'Supplemental Photos',       meta: 'All-in discovery form',           icon: Camera,     url: stringField(raw.photos_from_all_in_discovery_form) },
    { id: 'legacy_photo_library',              label: 'Photo Library Backup',      meta: 'Backup if no Discovery photos',   icon: Archive,    url: stringField(raw.legacy_photo_library) },
    { id: 'discovery_view_link',               label: 'Discovery Questionnaire',   meta: 'Full intake responses',           icon: FileText,   url: stringField(raw.discovery_view_link) },
    { id: 'strategy_brief',                    label: 'Strategy Brief',            meta: 'Strategist-authored brief',       icon: BookOpen,   url: stringField(raw.strategy_brief) },
    { id: 'notion_dashboard',                  label: 'Notion Dashboard',          meta: 'Account workspace',               icon: FolderOpen, url: stringField(raw.notion_dashboard) },
    { id: 'custom_gpt',                        label: 'Custom GPT',                meta: 'Account-specific assistant',      icon: Sparkles,   url: stringField(raw.custom_gpt) },
  ].filter(a => a.url)

  const submissionAssets = submissions.flatMap(e => e.assets)

  return (
    <section id="assets" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <SectionHeader icon={Paperclip} title="Assets" />

      {/* Discovery Brief — featured CTA. The brief informs every other
          asset on this page (logos, brand voice, web answers), so it
          gets prime real estate above the rest. */}
      <div className="mb-5">
        <DiscoveryBriefCard member={church.member} />
      </div>

      {/* Church-level documents */}
      {churchAssets.length > 0 && (
        <div className="mb-5">
          <SubSectionLabel label="Church Documents" icon={FileText} variant="docs" />
          <AssetGrid items={churchAssets} />
        </div>
      )}

      {/* Milestone-attached assets — distinct from church docs.
          Label + type so the asset_type carries through visually. */}
      {submissionAssets.length > 0 && (
        <div>
          <SubSectionLabel label="From Milestone Submissions" icon={Paperclip} variant="docs" />
          <AssetGrid
            items={submissionAssets.map(a => ({
              id:    a.id,
              label: a.asset_label || ASSET_TYPE_LABELS[a.asset_type] || a.asset_type,
              meta:  ASSET_TYPE_LABELS[a.asset_type] || a.asset_type,
              url:   a.asset_url,
              icon:  Paperclip,
            }))}
            accent="milestone"
          />
        </div>
      )}

      {churchAssets.length === 0 && submissionAssets.length === 0 && (
        <p className="text-xs text-purple-gray/50 italic">No assets linked yet.</p>
      )}
    </section>
  )
}

function AssetGrid({ items, accent = 'church' }: { items: AssetRow[]; accent?: 'church' | 'milestone' }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {items.map(item => (
        <AssetCard key={item.id} item={item} accent={accent} />
      ))}
    </div>
  )
}

function AssetCard({ item, accent }: { item: AssetRow; accent: 'church' | 'milestone' }) {
  const accentCls = accent === 'milestone'
    ? 'border-primary-purple/20 bg-primary-purple/5 hover:border-primary-purple/40 hover:bg-primary-purple/10'
    : 'border-lavender bg-white hover:border-primary-purple/40 hover:bg-lavender-tint/40'
  const iconBg = accent === 'milestone'
    ? 'bg-primary-purple/15 text-primary-purple'
    : 'bg-lavender-tint text-primary-purple'

  return (
    <a
      href={normalizeHref(item.url)}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${accentCls}`}
      title={item.url}
    >
      <div className={`h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${iconBg}`}>
        <item.icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-deep-plum truncate">{item.label}</p>
        {item.meta && (
          <p className="text-[10px] text-purple-gray truncate">{item.meta}</p>
        )}
      </div>
      <ExternalLink size={11} className="text-purple-gray shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
    </a>
  )
}

function stringField(v: unknown): string {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : ''
}

function normalizeHref(raw: string): string {
  const v = raw.trim()
  if (!v) return v
  if (/^https?:\/\//i.test(v)) return v
  if (v.startsWith('mailto:') || v.startsWith('tel:')) return v
  return `https://${v.replace(/^\/+/, '')}`
}
