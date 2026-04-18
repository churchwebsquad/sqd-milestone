import { ExternalLink, FileText, Sparkles, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { StrategyAccountProgress, Account, StrategyChurchIntel, ChurchIntelProfile } from '../../types/database'

interface Props {
  church: StrategyAccountProgress
  account: Account | null
  churchIntel: StrategyChurchIntel | null
}

function freshnessBadge(updatedAt: string | null): { label: string; cls: string } {
  if (!updatedAt) return { label: 'No intel', cls: 'bg-purple-gray/10 text-purple-gray' }
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days < 60) return { label: `${days}d ago`, cls: 'bg-green-100 text-green-700' }
  if (days < 120) return { label: `${days}d ago`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${days}d ago`, cls: 'bg-red-100 text-red-700' }
}

function LinkPill({ label, url }: { label: string; url: string | null | undefined }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1 hover:bg-lavender-tint transition-colors">
      <ExternalLink size={10} /> {label}
    </a>
  )
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

  // Check what social links are available from any source
  const instagram = account?.instagram ?? null
  const facebook = account?.facebook ?? null
  const hasAnySocialLinks = instagram || facebook || churchWebsite

  return (
    <section id="social-media" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider mb-4">Social Media</h2>

      {/* Social links + website — always visible */}
      {hasAnySocialLinks && (
        <div className="mb-4 pb-4 border-b border-lavender/50">
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-2">Links</p>
          <div className="flex flex-wrap gap-2">
            <LinkPill label="Website" url={churchWebsite} />
            <LinkPill label="Instagram" url={instagram} />
            <LinkPill label="Facebook" url={facebook} />
          </div>
        </div>
      )}

      {/* Church Intel summary */}
      <div className="mb-5 rounded-xl border border-lavender bg-lavender-tint/20 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-primary-purple" />
            <p className="text-xs font-bold text-deep-plum uppercase tracking-wide">Church Intelligence</p>
          </div>
          <span className={`inline-flex items-center rounded-full text-[10px] font-semibold px-2 py-0.5 ${freshness.cls}`}>
            {churchIntel ? `v${churchIntel.intel_version} · ${freshness.label}` : freshness.label}
          </span>
        </div>

        {intel ? (
          <>
            {intel.tagline_or_mission && (
              <p className="text-xs text-primary-purple italic mb-2">{intel.tagline_or_mission}</p>
            )}

            {/* Audience */}
            {intel.audience?.primary && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                <div className="bg-white/60 rounded-lg px-2.5 py-1.5">
                  <p className="text-[9px] font-semibold text-purple-gray uppercase">Primary Audience</p>
                  <p className="text-xs text-deep-plum">{intel.audience.primary}</p>
                </div>
                {intel.audience.secondary && (
                  <div className="bg-white/60 rounded-lg px-2.5 py-1.5">
                    <p className="text-[9px] font-semibold text-purple-gray uppercase">Secondary</p>
                    <p className="text-xs text-deep-plum">{intel.audience.secondary}</p>
                  </div>
                )}
              </div>
            )}

            {/* Brand voice tone */}
            {intel.brand_voice?.tone_summary && (
              <p className="text-xs text-deep-plum leading-relaxed mb-2 line-clamp-3">{intel.brand_voice.tone_summary}</p>
            )}

            {/* Vocabulary pills */}
            {(intel.brand_voice?.vocabulary ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {intel.brand_voice!.vocabulary!.slice(0, 8).map(v => (
                  <span key={v} className="text-[10px] font-medium text-primary-purple bg-primary-purple/10 rounded-full px-2 py-0.5">{v}</span>
                ))}
              </div>
            )}

            {/* Denomination + pastor if available */}
            {(intel.denomination || intel.pastor_name) && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {intel.denomination && <span className="text-[10px] bg-lavender/60 text-purple-gray rounded-full px-2 py-0.5">{intel.denomination}</span>}
                {intel.pastor_name && <span className="text-[10px] bg-lavender/60 text-purple-gray rounded-full px-2 py-0.5">Pastor: {intel.pastor_name}</span>}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate(`/social/intel?member=${church.member}`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
              >
                <FileText size={10} /> View Full Profile
              </button>
              <button
                type="button"
                onClick={() => navigate(`/social/intel?member=${church.member}`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary-purple/20 bg-primary-purple/5 text-xs text-primary-purple px-3 py-1.5 hover:bg-primary-purple/10 transition-colors"
              >
                <Sparkles size={10} /> Refresh Intel
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-3">
            <AlertCircle size={16} className="text-lavender mx-auto mb-1.5" />
            <p className="text-xs text-purple-gray/50 mb-2">No Church Intel profile generated yet.</p>
            <button
              type="button"
              onClick={() => navigate(`/social/intel?member=${church.member}`)}
              className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-2 hover:bg-primary-purple transition-colors"
            >
              <Sparkles size={12} /> Generate Church Intel →
            </button>
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
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-0.5">Branded Carousel Task</p>
          {brandedCarouselTask
            ? <LinkPill label="View Task" url={brandedCarouselTask} />
            : <p className="text-sm text-purple-gray/50 italic">Not set</p>}
        </div>
        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-0.5">Branded Carousel Dropbox</p>
          {brandedCarouselDropbox
            ? <LinkPill label="Dropbox File" url={brandedCarouselDropbox} />
            : <p className="text-sm text-purple-gray/50 italic">Not set</p>}
        </div>
      </div>

      {/* Tools */}
      <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-2">Tools</p>
      <div className="flex flex-wrap gap-2">
        <LinkPill label="Vista Social" url="https://vistasocial.com/dashboard" />
        <LinkPill label="Viddrop" url="https://viddrop.thesqd.com/auth/login" />
      </div>
    </section>
  )
}
