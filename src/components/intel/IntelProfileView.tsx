import type { ChurchIntelProfile } from '../../types/database'

interface Props {
  profile: ChurchIntelProfile
  isUpdate?: boolean
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="mb-2.5">
      <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-deep-plum leading-relaxed">{value}</p>
    </div>
  )
}

function CtaRow({ cta }: { cta?: { consistent?: boolean; pattern?: string | null; observed_examples?: string[] } }) {
  if (!cta) return null
  const examples = (cta.observed_examples ?? []).filter(e => e?.length > 0)
  return (
    <div className="mb-2.5">
      <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">CTA</p>
      {cta.consistent && cta.pattern ? (
        <span className="inline-block text-xs font-medium text-green-700 bg-green-100 rounded-lg px-2.5 py-1 mb-1">
          Consistent — "{cta.pattern}"
        </span>
      ) : (
        <p className="text-xs text-purple-gray/50 italic mb-1">No consistent pattern detected</p>
      )}
      {examples.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {examples.map((ex, i) => (
            <span key={i} className="text-xs text-purple-gray bg-lavender-tint/40 rounded-lg px-2.5 py-1 italic">"{ex}"</span>
          ))}
        </div>
      )}
    </div>
  )
}

function SampleBox({ text }: { text?: string }) {
  if (!text) return null
  return (
    <div className="mt-2 px-3 py-2.5 bg-lavender-tint/40 rounded-lg text-sm text-deep-plum/80 leading-relaxed italic">
      "{text}"
    </div>
  )
}

function DeliverableCard({ emoji, title, bgClass, children }: { emoji: string; title: string; bgClass: string; children: React.ReactNode }) {
  return (
    <div className="border border-lavender rounded-xl overflow-hidden mb-3">
      <div className={`px-3.5 py-2.5 flex items-center gap-2 ${bgClass}`}>
        <span className="text-sm">{emoji}</span>
        <span className="text-xs font-semibold text-deep-plum">{title}</span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

export default function IntelProfileView({ profile, isUpdate }: Props) {
  return (
    <div className="bg-white border border-lavender rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-lavender-tint px-5 py-4 border-b border-lavender">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              {profile.church_number && (
                <span className="text-xs font-semibold text-primary-purple">#{profile.church_number}</span>
              )}
              <h2 className="text-lg font-semibold text-deep-plum">{profile.church_name || 'Church Profile'}</h2>
              {isUpdate && (
                <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Updated</span>
              )}
            </div>
            {profile.tagline_or_mission && (
              <p className="text-xs text-primary-purple mt-1">{profile.tagline_or_mission}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {profile.pastor_name && (
                <span className="text-[11px] bg-lavender/60 text-purple-gray rounded-full px-2.5 py-0.5">Pastor: {profile.pastor_name}</span>
              )}
              {profile.denomination && (
                <span className="text-[11px] bg-lavender/60 text-purple-gray rounded-full px-2.5 py-0.5">{profile.denomination}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* Audience */}
        {profile.audience?.primary && (
          <section className="pb-5 border-b border-lavender/50">
            <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-2">Audience</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-2.5">
              <div className="bg-lavender-tint/40 rounded-lg px-3 py-2.5">
                <p className="text-[10px] font-semibold text-purple-gray uppercase mb-1">Primary</p>
                <p className="text-sm text-deep-plum">{profile.audience.primary}</p>
              </div>
              {profile.audience.secondary && (
                <div className="bg-lavender-tint/40 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-purple-gray uppercase mb-1">Secondary</p>
                  <p className="text-sm text-deep-plum">{profile.audience.secondary}</p>
                </div>
              )}
            </div>
            {profile.audience.content_implication && (
              <div className="bg-primary-purple/5 border border-primary-purple/10 rounded-lg px-3 py-2.5 text-xs text-primary-purple leading-relaxed">
                <span className="font-semibold">Content implication:</span> {profile.audience.content_implication}
              </div>
            )}
          </section>
        )}

        {/* Brand Voice */}
        <section className="pb-5 border-b border-lavender/50">
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-2">Brand Voice</p>
          {profile.brand_voice?.tone_summary && (
            <p className="text-sm text-deep-plum leading-relaxed mb-4">{profile.brand_voice.tone_summary}</p>
          )}
          {(profile.brand_voice?.attributes ?? []).map((attr, i) => (
            <div key={i} className={`mb-3 pb-3 ${i < (profile.brand_voice!.attributes!.length - 1) ? 'border-b border-lavender/30' : ''}`}>
              <p className="text-xs font-semibold text-deep-plum mb-1">{attr.name}</p>
              <p className="text-xs text-purple-gray leading-relaxed mb-1.5">{attr.description}</p>
              <div className="bg-primary-purple/5 border border-primary-purple/10 rounded-lg px-2.5 py-1.5 text-[11px] text-primary-purple leading-relaxed">
                <span className="font-semibold">Write with this in mind:</span> {attr.write_with_this_in_mind}
              </div>
            </div>
          ))}

          {(profile.brand_voice?.vocabulary ?? []).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1.5">Vocabulary to use</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.brand_voice!.vocabulary!.map(v => (
                  <span key={v} className="text-[11px] font-medium text-primary-purple bg-primary-purple/10 rounded-full px-2.5 py-0.5">{v}</span>
                ))}
              </div>
            </div>
          )}

          {(profile.brand_voice?.avoid ?? []).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1.5">Avoid</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.brand_voice!.avoid!.map(a => (
                  <span key={a} className="text-[11px] font-medium text-red-700 bg-red-100 rounded-full px-2.5 py-0.5">{a}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Design */}
        <section className="pb-5 border-b border-lavender/50">
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-2">Design</p>

          {[
            { label: 'PRIMARY COLORS', value: profile.design?.primary_colors },
            { label: 'ACCENT COLORS', value: profile.design?.accent_colors },
          ].map(({ label, value }) => value ? (
            <div key={label} className="mb-2.5">
              <p className="text-[10px] font-semibold text-purple-gray uppercase mb-1.5">{label}</p>
              <div className="flex flex-wrap gap-2">
                {value.split(/[·,]/).map((c, i) => {
                  const hex = c.match(/#([0-9A-Fa-f]{3,6})/)
                  const name = c.replace(/#([0-9A-Fa-f]{3,6})/, '').replace(/[·,]/g, '').trim()
                  if (!name && !hex) return null
                  return (
                    <div key={i} className="flex items-center gap-2 bg-white border border-lavender rounded-lg px-2.5 py-1.5">
                      {hex && <div className="w-4 h-4 rounded border border-lavender/50 shrink-0" style={{ background: hex[0] }} />}
                      {name && <span className="text-xs font-medium text-deep-plum">{name}</span>}
                      {hex && <span className="text-[10px] text-purple-gray font-mono">{hex[0]}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null)}

          <div className="bg-lavender-tint/40 rounded-lg px-3 py-2 mb-2.5">
            <p className="text-[10px] font-semibold text-purple-gray uppercase mb-0.5">Visual Style</p>
            <p className="text-sm text-deep-plum">{profile.design?.visual_style ?? '—'}</p>
          </div>

          {(profile.design?.adobe_fonts ?? []).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1.5">Adobe Fonts (suggested)</p>
              <div className="flex flex-col gap-1">
                {profile.design!.adobe_fonts!.map((f, i) => (
                  <span key={i} className="text-xs text-deep-plum bg-lavender-tint/40 rounded-lg px-2.5 py-1">{f}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Weekly Deliverables */}
        <section className="pb-5 border-b border-lavender/50">
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-3">Weekly Deliverables</p>

          <DeliverableCard emoji="🎬" title="Sermon Recap Videos (×2)" bgClass="bg-primary-purple/5">
            <InfoRow label="Clip selection" value={profile.sermon_recap_videos?.clip_selection_guidance} />
            <InfoRow label="Hook — first 2 seconds" value={profile.sermon_recap_videos?.hook_approach} />
            <InfoRow label="Cover frame" value={profile.sermon_recap_videos?.cover_frame} />
            <InfoRow label="Caption style" value={profile.sermon_recap_videos?.caption_style} />
            <CtaRow cta={profile.sermon_recap_videos?.cta} />
            <InfoRow label="Background music" value={profile.sermon_recap_videos?.music_preference} />
            {profile.sermon_recap_videos?.worship_reels && (
              <div className={`mt-2 rounded-lg px-3 py-2 border ${
                profile.sermon_recap_videos.worship_reels.recommendation?.toLowerCase().startsWith('yes')
                  ? 'bg-green-50 border-green-200'
                  : profile.sermon_recap_videos.worship_reels.recommendation?.toLowerCase().startsWith('not')
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <p className="text-[10px] font-semibold text-purple-gray uppercase mb-0.5">Worship Reels</p>
                <p className="text-xs font-semibold text-deep-plum">{profile.sermon_recap_videos.worship_reels.recommendation}</p>
                <p className="text-xs text-purple-gray leading-relaxed">{profile.sermon_recap_videos.worship_reels.reasoning}</p>
              </div>
            )}
          </DeliverableCard>

          <DeliverableCard emoji="🖼️" title="Carousel Post" bgClass="bg-blue-50">
            <InfoRow label="Tone / format" value={profile.carousel_post?.tone} />
            <InfoRow label="Slide structure" value={profile.carousel_post?.slide_structure} />
            <InfoRow label="Design notes" value={profile.carousel_post?.design_notes} />
            <CtaRow cta={profile.carousel_post?.cta} />
          </DeliverableCard>

          <DeliverableCard emoji="📸" title="Photo Recap Post" bgClass="bg-green-50">
            <InfoRow label="Caption tone" value={profile.photo_recap_post?.caption_tone} />
            <InfoRow label="What to highlight" value={profile.photo_recap_post?.what_to_highlight} />
            <CtaRow cta={profile.photo_recap_post?.cta} />
            <SampleBox text={profile.photo_recap_post?.caption_example} />
          </DeliverableCard>

          <DeliverableCard emoji="🙏" title="Sunday Invite Post" bgClass="bg-amber-50">
            <InfoRow label="Tone" value={profile.sunday_invite_post?.tone} />
            <InfoRow label="Caption pattern" value={profile.sunday_invite_post?.caption_pattern} />
            <InfoRow label="Campus / service info" value={profile.campus_locations} />
            <CtaRow cta={profile.sunday_invite_post?.cta} />
            <SampleBox text={profile.sunday_invite_post?.caption_example} />
          </DeliverableCard>

          <DeliverableCard emoji="💬" title="Facebook Text Post" bgClass="bg-purple-50">
            <InfoRow label="Style" value={profile.facebook_text_post?.style} />
            <InfoRow label="Engagement approach" value={profile.facebook_text_post?.engagement_approach} />
            <CtaRow cta={profile.facebook_text_post?.cta} />
            <SampleBox text={profile.facebook_text_post?.example} />
          </DeliverableCard>

          <DeliverableCard emoji="📣" title="Caption CTA Patterns" bgClass="bg-lavender-tint/60">
            <InfoRow label="Observed pattern" value={profile.caption_cta_patterns?.observed_pattern} />
            {(profile.caption_cta_patterns?.examples ?? []).filter(e => e && !e.includes('only if observed')).length > 0 && (
              <div className="mb-2.5">
                <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">Examples</p>
                <div className="flex flex-col gap-1">
                  {profile.caption_cta_patterns!.examples!
                    .filter(e => e && !e.includes('only if observed'))
                    .map((ex, i) => (
                      <span key={i} className="text-xs text-purple-gray bg-lavender-tint/40 rounded-lg px-2.5 py-1 italic">"{ex}"</span>
                    ))}
                </div>
              </div>
            )}
            <InfoRow label="Recommendation" value={profile.caption_cta_patterns?.recommendation} />
          </DeliverableCard>
        </section>

        {/* What Performs Well */}
        {profile.what_performs_well?.summary && (
          <section className="pb-5 border-b border-lavender/50">
            <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-2">What Performs Well</p>
            <p className="text-sm text-deep-plum leading-relaxed mb-2.5">{profile.what_performs_well.summary}</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(profile.what_performs_well.themes ?? []).map(t => (
                <span key={t} className="text-[11px] font-medium text-amber-700 bg-amber-100 rounded-full px-2.5 py-0.5">{t}</span>
              ))}
            </div>
            {profile.what_performs_well.avoid_content && (
              <p className="text-xs text-purple-gray">
                <span className="font-semibold">Avoid:</span> {profile.what_performs_well.avoid_content}
              </p>
            )}
          </section>
        )}

        {/* Upcoming Opportunities */}
        {profile.upcoming_opportunities && (
          <section className="pb-5 border-b border-lavender/50">
            <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-2">Upcoming Opportunities</p>
            <p className="text-sm text-deep-plum leading-relaxed">{profile.upcoming_opportunities}</p>
          </section>
        )}

        {/* Tip for the Team */}
        {profile.week1_tip && (
          <div className="bg-primary-purple/5 border border-primary-purple/10 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold text-primary-purple uppercase tracking-widest mb-1">Tip for the Team</p>
            <p className="text-sm text-deep-plum leading-relaxed">{profile.week1_tip}</p>
          </div>
        )}
      </div>
    </div>
  )
}
