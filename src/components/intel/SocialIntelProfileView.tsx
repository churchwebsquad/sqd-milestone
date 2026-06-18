import React from 'react'

interface SocialIntelProfile {
  church_overview?: {
    church_name?: string
    partnership_id?: string
    am_name?: string
    website?: string
    instagram?: string
    facebook?: string
    youtube?: string
    tiktok?: string
    pastor_name?: string
    denomination?: string
    location?: string
  }
  whats_happening_now?: {
    current_series?: string
    series_week?: string
    upcoming_events?: string[]
    recent_changes?: string
    am_notes?: string
  }
  cms_history?: {
    milestones_completed?: string[]
    last_delivery?: string
    brand_guide_on_file?: string
    dropbox_assets_noted?: string
    notion_notes_summary?: string
  }
  brand_voice?: {
    tone_summary?: string
    attributes?: { name?: string; definition?: string; use?: string[]; avoid?: string[] }[]
    casual_to_formal_spectrum?: string
    cta_patterns?: string[]
    pastor_reference?: string
    church_self_reference?: string
  }
  deliverables?: {
    sermon_reel?: { tone?: string; topic_approach?: string; thumbnail_guidance?: string; hashtags?: string; cta?: string }
    worship_reel?: { recommendation?: string; reasoning?: string; emotional_vs_teaching?: string; caption_guidance?: string }
    carousel?: { teaching_vs_poetic?: string; bible_verse_approach?: string; caption_length?: string; cta?: string }
    invite_post?: { service_times?: string; locations?: string; online_option?: string; kids_ministry_language?: string }
    recap_post?: { has_recap_history?: string; recap_focus?: string; recap_feel?: string }
    facebook_text_post?: { format?: string; audience_response?: string; opening_pattern?: string; closing_pattern?: string }
  }
  what_performs_well?: {
    summary?: string
    top_content_types?: string[]
    themes_that_land?: string[]
    caption_style?: string
    what_to_lean_into?: string
    what_to_avoid?: string
  }
  design_notes?: {
    primary_colors?: string[]
    accent_colors?: string[]
    visual_style?: string
    font_suggestions?: string[]
    photography_vs_illustrated?: string
  }
  team_tips?: string
  change_log?: { date?: string; what?: string; sources?: string[] }[]
}

interface Props {
  profile: SocialIntelProfile
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="h-px bg-[#513DE5] mb-4 opacity-30" />
      <h2 className="text-lg font-bold text-[#341756] mb-4 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="mb-2">
      <span className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider">{label}: </span>
      <span className="text-sm text-[#341756]">{value}</span>
    </div>
  )
}

function Tag({ text }: { text: string }) {
  return (
    <span className="inline-block bg-[#CFC9F8] text-[#341756] text-xs px-2 py-1 rounded-full mr-1 mb-1">
      {text}
    </span>
  )
}

function LinkButton({ href, label }: { href?: string; label: string }) {
  if (!href) return null
  const url = href.startsWith('http') ? href : `https://${href}`
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs bg-[#513DE5] text-white px-3 py-1.5 rounded-full mr-2 mb-2 hover:opacity-80 transition-opacity"
    >
      {label} ↗
    </a>
  )
}

function DeliverableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#CFC9F8] rounded-xl p-4 mb-4">
      <h4 className="font-bold text-[#513DE5] text-sm mb-3">{title}</h4>
      {children}
    </div>
  )
}

function ColorSwatch({ hex }: { hex: string }) {
  const clean = hex.replace(/[^a-fA-F0-9#]/g, '')
  const display = clean.startsWith('#') ? clean : `#${clean}`
  const isValid = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(display)
  return (
    <div className="flex items-center gap-2 mr-3 mb-2">
      {isValid && (
        <div className="w-6 h-6 rounded-full border border-gray-200 flex-shrink-0" style={{ backgroundColor: display }} />
      )}
      <span className="text-xs text-[#341756] font-mono">{hex}</span>
    </div>
  )
}

function asArr(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (typeof val === 'string') return val.split(/[,;]/).map(s => s.trim()).filter(Boolean)
  return []
}

export default function SocialIntelProfileView({ profile }: Props) {
  const ov = profile.church_overview ?? {}
  const now = profile.whats_happening_now ?? {}
  const cms = profile.cms_history ?? {}
  const voice = profile.brand_voice ?? {}
  const del = profile.deliverables ?? {}
  const perf = profile.what_performs_well ?? {}
  const design = profile.design_notes ?? {}
  const log = profile.change_log ?? []

  return (
    <div className="text-[#341756]">

      {/* Header */}
      <div className="bg-[#341756] text-white rounded-xl p-6 mb-8">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">{ov.church_name ?? 'Church Intel Profile'}</h1>
            {ov.partnership_id && <p className="text-white/60 text-sm mt-1">Partnership ID: {ov.partnership_id}</p>}
            {ov.pastor_name && <p className="text-white/80 text-sm mt-1">Pastor: {ov.pastor_name}</p>}
            {ov.denomination && <p className="text-white/60 text-sm">{ov.denomination}</p>}
            {ov.location && <p className="text-white/60 text-sm">{ov.location}</p>}
          </div>
          {ov.am_name && (
            <div className="text-right">
              <p className="text-white/50 text-xs uppercase tracking-wider">Account Manager</p>
              <p className="text-white font-semibold">{ov.am_name}</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap">
          <LinkButton href={ov.website} label="Website" />
          <LinkButton href={ov.instagram} label="Instagram" />
          <LinkButton href={ov.facebook} label="Facebook" />
          <LinkButton href={ov.youtube} label="YouTube" />
          {ov.tiktok && <LinkButton href={ov.tiktok} label="TikTok" />}
        </div>
      </div>

      {/* What's Happening Now */}
      {(now.current_series || (now.upcoming_events ?? []).length > 0 || now.recent_changes || now.am_notes) && (
        <Section title="What's Happening Now">
          <div className="bg-[#F9F5F1] rounded-xl p-4">
            {now.current_series && (
              <div className="mb-3">
                <span className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider">Current Series: </span>
                <span className="text-sm font-semibold">{now.current_series}</span>
                {now.series_week && <span className="text-sm text-gray-500 ml-2">(Week {now.series_week})</span>}
              </div>
            )}
            {asArr(now.upcoming_events).length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-1">Upcoming Events</p>
                <ul className="list-disc list-inside space-y-1">
                  {asArr(now.upcoming_events).map((e, i) => <li key={i} className="text-sm">{e}</li>)}
                </ul>
              </div>
            )}
            {now.recent_changes && <Field label="Recent Changes" value={now.recent_changes} />}
            {now.am_notes && <Field label="AM Notes" value={now.am_notes} />}
          </div>
        </Section>
      )}

      {/* CMS History */}
      {(cms.last_delivery || cms.brand_guide_on_file || (cms.milestones_completed ?? []).length > 0 || cms.notion_notes_summary || cms.dropbox_assets_noted) && (
        <Section title="CMS History">
          <div className="bg-[#F9F5F1] rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {asArr(cms.milestones_completed).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-1">Milestones Completed</p>
                <ul className="list-disc list-inside space-y-1">
                  {asArr(cms.milestones_completed).map((m, i) => <li key={i} className="text-sm">{m}</li>)}
                </ul>
              </div>
            )}
            <div>
              <Field label="Last Delivery" value={cms.last_delivery} />
              <Field label="Brand Guide on File" value={cms.brand_guide_on_file} />
              <Field label="Dropbox Assets" value={cms.dropbox_assets_noted} />
            </div>
            {cms.notion_notes_summary && (
              <div className="md:col-span-2">
                <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-1">Notion Notes</p>
                <p className="text-sm text-[#341756] leading-relaxed">{cms.notion_notes_summary}</p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Brand Voice */}
      {(voice.tone_summary || (voice.attributes ?? []).length > 0) && (
        <Section title="Brand Voice">
          {voice.tone_summary && (
            <p className="text-sm mb-4 leading-relaxed bg-[#F9F5F1] rounded-xl p-4">{voice.tone_summary}</p>
          )}
          {voice.casual_to_formal_spectrum && (
            <Field label="Tone Spectrum" value={voice.casual_to_formal_spectrum} />
          )}
          {voice.pastor_reference && <Field label="Pastor Reference" value={voice.pastor_reference} />}
          {voice.church_self_reference && <Field label="Church Self-Reference" value={voice.church_self_reference} />}

          {asArr(voice.cta_patterns).length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-2">CTA Patterns</p>
              <div className="flex flex-wrap">
                {asArr(voice.cta_patterns).map((cta, i) => <Tag key={i} text={cta} />)}
              </div>
            </div>
          )}

          {(voice.attributes ?? []).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {(voice.attributes ?? []).map((attr, i) => (
                <div key={i} className="bg-white border border-[#CFC9F8] rounded-xl p-4">
                  <p className="font-bold text-[#513DE5] text-sm mb-1">{attr.name}</p>
                  {attr.definition && <p className="text-xs text-gray-600 mb-3">{attr.definition}</p>}
                  {asArr(attr.use).length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs font-semibold text-green-700 mb-1">Use</p>
                      <div className="flex flex-wrap">
                        {asArr(attr.use).map((w, j) => (
                          <span key={j} className="text-xs bg-green-50 text-green-800 px-2 py-0.5 rounded-full mr-1 mb-1">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {asArr(attr.avoid).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-600 mb-1">Avoid</p>
                      <div className="flex flex-wrap">
                        {asArr(attr.avoid).map((w, j) => (
                          <span key={j} className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full mr-1 mb-1">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* The 6 Deliverables */}
      <Section title="The 6 Deliverables">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {del.sermon_reel && (
            <DeliverableCard title="Sermon Reel ×2">
              <Field label="Tone" value={del.sermon_reel.tone} />
              <Field label="Topic Approach" value={del.sermon_reel.topic_approach} />
              <Field label="Thumbnail" value={del.sermon_reel.thumbnail_guidance} />
              <Field label="Hashtags" value={del.sermon_reel.hashtags} />
              <Field label="CTA" value={del.sermon_reel.cta} />
            </DeliverableCard>
          )}
          {del.worship_reel && (
            <DeliverableCard title="Worship Reel ×1">
              {del.worship_reel.recommendation && (
                <div className="mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    del.worship_reel.recommendation?.toLowerCase().includes('yes') ? 'bg-green-100 text-green-800' :
                    del.worship_reel.recommendation?.toLowerCase().includes('not') ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>{del.worship_reel.recommendation}</span>
                </div>
              )}
              <Field label="Reasoning" value={del.worship_reel.reasoning} />
              <Field label="Approach" value={del.worship_reel.emotional_vs_teaching} />
              <Field label="Caption Guidance" value={del.worship_reel.caption_guidance} />
            </DeliverableCard>
          )}
          {del.carousel && (
            <DeliverableCard title="Carousel ×1">
              <Field label="Style" value={del.carousel.teaching_vs_poetic} />
              <Field label="Bible Verses" value={del.carousel.bible_verse_approach} />
              <Field label="Caption Length" value={del.carousel.caption_length} />
              <Field label="CTA" value={del.carousel.cta} />
            </DeliverableCard>
          )}
          {del.invite_post && (
            <DeliverableCard title="Invite Post ×1">
              <Field label="Service Times" value={del.invite_post.service_times} />
              <Field label="Locations" value={del.invite_post.locations} />
              <Field label="Online Option" value={del.invite_post.online_option} />
              <Field label="Kids Ministry" value={del.invite_post.kids_ministry_language} />
            </DeliverableCard>
          )}
          {del.recap_post && (
            <DeliverableCard title="Recap Post ×1">
              <Field label="Recap History" value={del.recap_post.has_recap_history} />
              <Field label="Recap Focus" value={del.recap_post.recap_focus} />
              <Field label="Recap Feel" value={del.recap_post.recap_feel} />
            </DeliverableCard>
          )}
          {del.facebook_text_post && (
            <DeliverableCard title="FB Text Post ×1">
              <Field label="Format" value={del.facebook_text_post.format} />
              <Field label="Audience Response" value={del.facebook_text_post.audience_response} />
              <Field label="Opens With" value={del.facebook_text_post.opening_pattern} />
              <Field label="Closes With" value={del.facebook_text_post.closing_pattern} />
            </DeliverableCard>
          )}
        </div>
      </Section>

      {/* What Performs Well */}
      {perf.summary && (
        <Section title="What Performs Well">
          <p className="text-sm mb-4 leading-relaxed">{perf.summary}</p>
          {asArr(perf.top_content_types).length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-1">Top Content Types</p>
              <div className="flex flex-wrap">{asArr(perf.top_content_types).map((t, i) => <Tag key={i} text={t} />)}</div>
            </div>
          )}
          {asArr(perf.themes_that_land).length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-1">Themes That Land</p>
              <div className="flex flex-wrap">{asArr(perf.themes_that_land).map((t, i) => <Tag key={i} text={t} />)}</div>
            </div>
          )}
          <Field label="Caption Style" value={perf.caption_style} />
          <Field label="Lean Into" value={perf.what_to_lean_into} />
          <Field label="Stay Away From" value={perf.what_to_avoid} />
        </Section>
      )}

      {/* Design Notes */}
      {(design.visual_style || (design.primary_colors ?? []).length > 0) && (
        <Section title="Design Notes">
          {(design.primary_colors ?? []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-2">Primary Colors</p>
              <div className="flex flex-wrap">{(design.primary_colors ?? []).map((c, i) => <ColorSwatch key={i} hex={c} />)}</div>
            </div>
          )}
          {(design.accent_colors ?? []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-2">Accent Colors</p>
              <div className="flex flex-wrap">{(design.accent_colors ?? []).map((c, i) => <ColorSwatch key={i} hex={c} />)}</div>
            </div>
          )}
          <Field label="Visual Style" value={design.visual_style} />
          <Field label="Photography vs Illustrated" value={design.photography_vs_illustrated} />
          {asArr(design.font_suggestions).length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-1">Font Suggestions</p>
              <div className="flex flex-wrap">{asArr(design.font_suggestions).map((f, i) => <Tag key={i} text={f} />)}</div>
            </div>
          )}
        </Section>
      )}

      {/* Team Tips */}
      {profile.team_tips && (
        <Section title="Team Tips">
          <div className="bg-[#513DE5] text-white rounded-xl p-4">
            <p className="text-sm leading-relaxed">{profile.team_tips}</p>
          </div>
        </Section>
      )}

      {/* Change Log */}
      {log.length > 0 && (
        <Section title="Change Log">
          <div className="space-y-3">
            {log.map((entry, i) => (
              <div key={i} className="border-l-2 border-[#CFC9F8] pl-4">
                <p className="text-xs text-gray-500">{entry.date}</p>
                <p className="text-sm text-[#341756]">{entry.what}</p>
                {asArr(entry.sources).length > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">Sources: {asArr(entry.sources).join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

    </div>
  )
}
