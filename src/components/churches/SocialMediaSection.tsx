import { Share2, FileText, Sparkles, AlertCircle, Globe, Wrench, Link2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { StrategyAccountProgress, Account, StrategyChurchIntel, ChurchIntelProfile } from '../../types/database'
import { SectionHeader, SubSectionLabel, DocLink, AppLink, ToolLink } from './ChurchUI'

interface Props {
  church: StrategyAccountProgress
  account: Account | null
  churchIntel: StrategyChurchIntel | null
}

/** Strip Claude web_search <cite> tags from a string. */
function stripCites(s: string | null | undefined): string | null {
  if (!s) return s ?? null
  return s
    .replace(/<cite[^>]*>([\s\S]*?)<\/cite>/g, '$1')
    .replace(/<\/?cite[^>]*>/g, '')
}

function freshnessBadge(updatedAt: string | null): { label: string; cls: string } {
  if (!updatedAt) return { label: 'No intel', cls: 'bg-purple-gray/10 text-purple-gray' }
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days < 60) return { label: `${days}d ago`, cls: 'bg-green-100 text-green-700' }
  if (days < 120) return { label: `${days}d ago`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${days}d ago`, cls: 'bg-red-100 text-red-700' }
}

export default function SocialMediaSection({ church, account, churchIntel }: Props) {
  const navigate = useNavigate()
  const raw = church as Record<string, unknown>
  const intel = churchIntel?.intel_profile as ChurchIntelProfile | null

  const selectedPlatforms = raw.selected_platforms as string | null ?? null
  const bibleTranslation = raw.bible_translation as string | null ?? null
  const brandedCarouselTask = raw.branded_carousel_task as string | null ?? null
  const brandedCarouselDropbox = raw.branded_carousel_dropbox_file as string | null ?? null
  const churchWebsite = raw.church_website as string | null ?? null

  const freshness = freshnessBadge(churchIntel?.intel_updated_at ?? null)

  const instagram = account?.instagram ?? null
  const facebook = account?.facebook ?? null
  const hasAnySocialLinks = instagram || facebook || churchWebsite

  return (
    <section id="social-media" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <SectionHeader icon={Share2} title="Social Media" theme="social" />

      {/* Social links + website — always visible */}
      {hasAnySocialLinks && (
        <div className="mb-4 pb-4 border-b border-lavender/50">
          <SubSectionLabel label="Church Links" icon={Link2} variant="docs" />
          <div className="flex flex-wrap gap-2">
            {churchWebsite && <DocLink label="Website" url={churchWebsite} icon={Globe} />}
            {instagram && <DocLink label="Instagram" url={instagram} icon={Link2} />}
            {facebook && <DocLink label="Facebook" url={facebook} icon={Link2} />}
          </div>
        </div>
      )}

      {/* Church Intel summary */}
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-amber-100 flex items-center justify-center">
              <Sparkles size={12} className="text-amber-700" />
            </div>
            <p className="text-xs font-bold text-deep-plum uppercase tracking-wide">Church Intelligence</p>
          </div>
          <span className={`inline-flex items-center rounded-full text-[10px] font-semibold px-2 py-0.5 ${freshness.cls}`}>
            {churchIntel ? `v${churchIntel.intel_version} · ${freshness.label}` : freshness.label}
          </span>
        </div>

        {intel ? (
          <>
            {intel.tagline_or_mission && (
              <p className="text-xs text-primary-purple italic mb-2">{stripCites(intel.tagline_or_mission)}</p>
            )}

            {intel.audience?.primary && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                <div className="bg-white/60 rounded-lg px-2.5 py-1.5">
                  <p className="text-[9px] font-semibold text-purple-gray uppercase">Primary Audience</p>
                  <p className="text-xs text-deep-plum">{stripCites(intel.audience.primary)}</p>
                </div>
                {intel.audience.secondary && (
                  <div className="bg-white/60 rounded-lg px-2.5 py-1.5">
                    <p className="text-[9px] font-semibold text-purple-gray uppercase">Secondary</p>
                    <p className="text-xs text-deep-plum">{stripCites(intel.audience.secondary)}</p>
                  </div>
                )}
              </div>
            )}

            {intel.brand_voice?.tone_summary && (
              <p className="text-xs text-deep-plum leading-relaxed mb-2 line-clamp-3">{stripCites(intel.brand_voice.tone_summary)}</p>
            )}

            {(intel.brand_voice?.vocabulary ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {intel.brand_voice!.vocabulary!.slice(0, 8).map(v => (
                  <span key={v} className="text-[10px] font-medium text-primary-purple bg-primary-purple/10 rounded-full px-2 py-0.5">{v}</span>
                ))}
              </div>
            )}

            {(intel.denomination || intel.pastor_name) && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {intel.denomination && <span className="text-[10px] bg-lavender/60 text-purple-gray rounded-full px-2 py-0.5">{stripCites(intel.denomination)}</span>}
                {intel.pastor_name && <span className="text-[10px] bg-lavender/60 text-purple-gray rounded-full px-2 py-0.5">Pastor: {stripCites(intel.pastor_name)}</span>}
              </div>
            )}

            <div className="flex gap-2">
              <AppLink
                label="View Full Profile"
                icon={FileText}
                variant="ghost"
                onClick={() => navigate(`/social/intel?member=${church.member}`)}
              />
              <AppLink
                label="Refresh Intel"
                icon={Sparkles}
                onClick={() => navigate(`/social/intel?member=${church.member}`)}
              />
            </div>
          </>
        ) : (
          <div className="text-center py-3">
            <AlertCircle size={16} className="text-amber-400 mx-auto mb-1.5" />
            <p className="text-xs text-purple-gray/70 mb-3">No Church Intel profile generated yet.</p>
            <AppLink
              label="Generate Church Intel"
              icon={Sparkles}
              onClick={() => navigate(`/social/intel?member=${church.member}`)}
            />
          </div>
        )}
      </div>

      {/* Church data fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-0.5">Selected Platforms</p>
          <p className="text-sm text-deep-plum">{selectedPlatforms ?? <span className="text-purple-gray/50 italic">Not set</span>}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-0.5">Bible Translation</p>
          <p className="text-sm text-deep-plum">{bibleTranslation ?? <span className="text-purple-gray/50 italic">Not set</span>}</p>
        </div>
      </div>

      {/* Branded carousel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-1">Branded Carousel Task</p>
          {brandedCarouselTask
            ? <DocLink label="View Task" url={brandedCarouselTask} icon={FileText} />
            : <p className="text-sm text-purple-gray/50 italic">Not set</p>}
        </div>
        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-1">Branded Carousel Dropbox</p>
          {brandedCarouselDropbox
            ? <DocLink label="Dropbox File" url={brandedCarouselDropbox} icon={FileText} />
            : <p className="text-sm text-purple-gray/50 italic">Not set</p>}
        </div>
      </div>

      {/* Tools */}
      <SubSectionLabel label="Tools" icon={Wrench} variant="tools" />
      <div className="flex flex-wrap gap-2">
        <ToolLink label="Vista Social" url="https://vistasocial.com/dashboard" />
        <ToolLink label="Viddrop" url="https://viddrop.thesqd.com/auth/login" />
      </div>
    </section>
  )
}
