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
    attributes?: { name?: string; definition?: string; write_with_this_in_mind?: string; use?: string[]; avoid?: string[] }[]
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
  editMode?: boolean
  onProfileChange?: (updated: SocialIntelProfile) => void
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

function Field({
  label, value, editMode, onChange,
}: {
  label: string; value?: string | null; editMode?: boolean; onChange?: (v: string) => void
}) {
  if (editMode) {
    return (
      <div className="mb-3">
        <label className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider block mb-1">{label}</label>
        <textarea
          value={value ?? ''}
          onChange={e => onChange?.(e.target.value)}
          rows={3}
          className="w-full text-sm text-[#341756] border border-[#CFC9F8] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#513DE5] resize-y bg-white"
        />
      </div>
    )
  }
  if (!value) return null
  return (
    <div className="mb-2">
      <span className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider">{label}: </span>
      <span className="text-sm text-[#341756]">{value}</span>
    </div>
  )
}

function InlineField({
  label, value, editMode, onChange,
}: {
  label: string; value?: string | null; editMode?: boolean; onChange?: (v: string) => void
}) {
  if (editMode) {
    return (
      <div className="mb-2">
        <label className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider block mb-1">{label}</label>
        <input
          type="text"
          value={value ?? ''}
          onChange={e => onChange?.(e.target.value)}
          className="w-full text-sm text-[#341756] border border-[#CFC9F8] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#513DE5] bg-white"
        />
      </div>
    )
  }
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

function EditableTagList({
  label, items, editMode, onChange,
}: {
  label: string; items: string[]; editMode?: boolean; onChange?: (items: string[]) => void
}) {
  if (editMode) {
    return (
      <div className="mb-3">
        <label className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider block mb-1">
          {label} <span className="font-normal text-gray-400 normal-case">(comma-separated)</span>
        </label>
        <input
          type="text"
          value={items.join(', ')}
          onChange={e => onChange?.(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          className="w-full text-sm text-[#341756] border border-[#CFC9F8] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#513DE5] bg-white"
        />
      </div>
    )
  }
  if (!items.length) return null
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider mb-1">{label}</p>
      <div className="flex flex-wrap">{items.map((t, i) => <Tag key={i} text={t} />)}</div>
    </div>
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

export default function SocialIntelProfileView({ profile, editMode, onProfileChange }: Props) {
  const ov = profile.church_overview ?? {}
  const now = profile.whats_happening_now ?? {}
  const cms = profile.cms_history ?? {}
  const voice = profile.brand_voice ?? {}
  const del = profile.deliverables ?? {}
  const perf = profile.what_performs_well ?? {}
  const design = profile.design_notes ?? {}
  const log = profile.change_log ?? []

  function setOv(key: keyof typeof ov, val: string) {
    onProfileChange?.({ ...profile, church_overview: { ...ov, [key]: val } })
  }
  function setNow(key: keyof typeof now, val: string | string[]) {
    onProfileChange?.({ ...profile, whats_happening_now: { ...now, [key]: val } })
  }
  function setCms(key: keyof typeof cms, val: string | string[]) {
    onProfileChange?.({ ...profile, cms_history: { ...cms, [key]: val } })
  }
  function setVoice(key: keyof typeof voice, val: string | string[]) {
    onProfileChange?.({ ...profile, brand_voice: { ...voice, [key]: val } })
  }
  function setDel<S extends keyof typeof del>(section: S, key: string, val: string) {
    onProfileChange?.({
      ...profile,
      deliverables: {
        ...del,
        [section]: { ...(del[section] as Record<string, unknown>), [key]: val },
      },
    })
  }
  function setPerf(key: keyof typeof perf, val: string | string[]) {
    onProfileChange?.({ ...profile, what_performs_well: { ...perf, [key]: val } })
  }
  function setDesign(key: keyof typeof design, val: string | string[]) {
    onProfileChange?.({ ...profile, design_notes: { ...design, [key]: val } })
  }

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
        {editMode ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
            <InlineField label="Church Name" value={ov.church_name} editMode onChange={v => setOv('church_name', v)} />
            <InlineField label="Pastor" value={ov.pastor_name} editMode onChange={v => setOv('pastor_name', v)} />
            <InlineField label="Location" value={ov.location} editMode onChange={v => setOv('location', v)} />
            <InlineField label="Denomination" value={ov.denomination} editMode onChange={v => setOv('denomination', v)} />
            <InlineField label="Website" value={ov.website} editMode onChange={v => setOv('website', v)} />
            <InlineField label="Instagram" value={ov.instagram} editMode onChange={v => setOv('instagram', v)} />
            <InlineField label="Facebook" value={ov.facebook} editMode onChange={v => setOv('facebook', v)} />
            <InlineField label="YouTube" value={ov.youtube} editMode onChange={v => setOv('youtube', v)} />
            <InlineField label="TikTok" value={ov.tiktok} editMode onChange={v => setOv('tiktok', v)} />
            <InlineField label="Account Manager" value={ov.am_name} editMode onChange={v => setOv('am_name', v)} />
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap">
            <LinkButton href={ov.website} label="Website" />
            <LinkButton href={ov.instagram} label="Instagram" />
            <LinkButton href={ov.facebook} label="Facebook" />
            <LinkButton href={ov.youtube} label="YouTube" />
            {ov.tiktok && <LinkButton href={ov.tiktok} label="TikTok" />}
          </div>
        )}
      </div>

      {/* What's Happening Now */}
      {(editMode || now.current_series || (now.upcoming_events ?? []).length > 0 || now.recent_changes || now.am_notes) && (
        <Section title="What's Happening Now">
          <div className="bg-[#F9F5F1] rounded-xl p-4">
            {editMode ? (
              <>
                <InlineField label="Current Series" value={now.current_series} editMode onChange={v => setNow('current_series', v)} />
                <InlineField label="Series Week" value={now.series_week} editMode onChange={v => setNow('series_week', v)} />
                <EditableTagList label="Upcoming Events" items={asArr(now.upcoming_events)} editMode onChange={v => setNow('upcoming_events', v)} />
                <Field label="Recent Changes" value={now.recent_changes} editMode onChange={v => setNow('recent_changes', v)} />
                <Field label="AM Notes" value={now.am_notes} editMode onChange={v => setNow('am_notes', v)} />
              </>
            ) : (
              <>
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
                <Field label="Recent Changes" value={now.recent_changes} />
                <Field label="AM Notes" value={now.am_notes} />
              </>
            )}
          </div>
        </Section>
      )}

      {/* CMS History */}
      {(editMode || cms.last_delivery || cms.brand_guide_on_file || (cms.milestones_completed ?? []).length > 0 || cms.notion_notes_summary || cms.dropbox_assets_noted) && (
        <Section title="CMS History">
          <div className="bg-[#F9F5F1] rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {editMode ? (
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                <EditableTagList label="Milestones Completed" items={asArr(cms.milestones_completed)} editMode onChange={v => setCms('milestones_completed', v)} />
                <InlineField label="Last Delivery" value={cms.last_delivery} editMode onChange={v => setCms('last_delivery', v)} />
                <InlineField label="Brand Guide on File" value={cms.brand_guide_on_file} editMode onChange={v => setCms('brand_guide_on_file', v)} />
                <InlineField label="Dropbox Assets" value={cms.dropbox_assets_noted} editMode onChange={v => setCms('dropbox_assets_noted', v)} />
                <div className="md:col-span-2">
                  <Field label="Notion Notes" value={cms.notion_notes_summary} editMode onChange={v => setCms('notion_notes_summary', v)} />
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        </Section>
      )}

      {/* Brand Voice */}
      {(editMode || voice.tone_summary || (voice.attributes ?? []).length > 0) && (
        <Section title="Brand Voice">
          {editMode ? (
            <div className="bg-[#F9F5F1] rounded-xl p-4 mb-4">
              <Field label="Tone Summary" value={voice.tone_summary} editMode onChange={v => setVoice('tone_summary', v)} />
              <InlineField label="Tone Spectrum" value={voice.casual_to_formal_spectrum} editMode onChange={v => setVoice('casual_to_formal_spectrum', v)} />
              <InlineField label="Pastor Reference" value={voice.pastor_reference} editMode onChange={v => setVoice('pastor_reference', v)} />
              <InlineField label="Church Self-Reference" value={voice.church_self_reference} editMode onChange={v => setVoice('church_self_reference', v)} />
              <EditableTagList label="CTA Patterns" items={asArr(voice.cta_patterns)} editMode onChange={v => setVoice('cta_patterns', v)} />
            </div>
          ) : (
            <>
              {voice.tone_summary && (
                <p className="text-sm mb-4 leading-relaxed bg-[#F9F5F1] rounded-xl p-4">{voice.tone_summary}</p>
              )}
              {voice.casual_to_formal_spectrum && <Field label="Tone Spectrum" value={voice.casual_to_formal_spectrum} />}
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
            </>
          )}

          {(voice.attributes ?? []).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {(voice.attributes ?? []).map((attr, i) => (
                <div key={i} className="bg-white border border-[#CFC9F8] rounded-xl p-4">
                  {editMode ? (
                    <>
                      <input
                        type="text"
                        value={attr.name ?? ''}
                        onChange={e => {
                          const attrs = [...(voice.attributes ?? [])]
                          attrs[i] = { ...attrs[i], name: e.target.value }
                          setVoice('attributes', attrs as unknown as string[])
                        }}
                        className="w-full text-sm font-bold text-[#513DE5] border border-[#CFC9F8] rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-[#513DE5] bg-white"
                      />
                      <textarea
                        value={attr.definition ?? ''}
                        rows={2}
                        onChange={e => {
                          const attrs = [...(voice.attributes ?? [])]
                          attrs[i] = { ...attrs[i], definition: e.target.value }
                          setVoice('attributes', attrs as unknown as string[])
                        }}
                        placeholder="Definition..."
                        className="w-full text-xs text-gray-600 border border-[#CFC9F8] rounded-lg px-2 py-1 mb-2 resize-y focus:outline-none focus:ring-1 focus:ring-[#513DE5] bg-white"
                      />
                      <label className="text-xs font-semibold text-[#513DE5] block mb-1">Write with this in mind</label>
                      <textarea
                        value={attr.write_with_this_in_mind ?? ''}
                        rows={2}
                        onChange={e => {
                          const attrs = [...(voice.attributes ?? [])]
                          attrs[i] = { ...attrs[i], write_with_this_in_mind: e.target.value }
                          setVoice('attributes', attrs as unknown as string[])
                        }}
                        placeholder="Concrete copywriting guidance..."
                        className="w-full text-xs text-gray-600 border border-[#CFC9F8] rounded-lg px-2 py-1 mb-2 resize-y focus:outline-none focus:ring-1 focus:ring-[#513DE5] bg-white"
                      />
                      <label className="text-xs font-semibold text-green-700 block mb-1">Use (comma-separated)</label>
                      <input
                        type="text"
                        value={asArr(attr.use).join(', ')}
                        onChange={e => {
                          const attrs = [...(voice.attributes ?? [])]
                          attrs[i] = { ...attrs[i], use: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }
                          setVoice('attributes', attrs as unknown as string[])
                        }}
                        className="w-full text-xs border border-[#CFC9F8] rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-[#513DE5] bg-white"
                      />
                      <label className="text-xs font-semibold text-red-600 block mb-1">Avoid (comma-separated)</label>
                      <input
                        type="text"
                        value={asArr(attr.avoid).join(', ')}
                        onChange={e => {
                          const attrs = [...(voice.attributes ?? [])]
                          attrs[i] = { ...attrs[i], avoid: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }
                          setVoice('attributes', attrs as unknown as string[])
                        }}
                        className="w-full text-xs border border-[#CFC9F8] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#513DE5] bg-white"
                      />
                    </>
                  ) : (
                    <>
                      <p className="font-bold text-[#513DE5] text-sm mb-1">{attr.name}</p>
                      {attr.definition && <p className="text-xs text-gray-600 mb-2">{attr.definition}</p>}
                      {attr.write_with_this_in_mind && (
                        <div className="bg-[#EDE9FC] rounded-lg px-3 py-2 mb-3">
                          <p className="text-[10px] font-semibold text-[#513DE5] uppercase tracking-wider mb-0.5">Write with this in mind</p>
                          <p className="text-xs text-[#341756]">{attr.write_with_this_in_mind}</p>
                        </div>
                      )}
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
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Design Notes */}
      {(editMode || design.visual_style || (design.primary_colors ?? []).length > 0) && (
        <Section title="Design Notes">
          {editMode ? (
            <>
              <EditableTagList label="Primary Colors (hex values, comma-separated)" items={asArr(design.primary_colors)} editMode onChange={v => setDesign('primary_colors', v)} />
              <EditableTagList label="Accent Colors (hex values, comma-separated)" items={asArr(design.accent_colors)} editMode onChange={v => setDesign('accent_colors', v)} />
              <Field label="Visual Style" value={design.visual_style} editMode onChange={v => setDesign('visual_style', v)} />
              <Field label="Photography vs Illustrated" value={design.photography_vs_illustrated} editMode onChange={v => setDesign('photography_vs_illustrated', v)} />
              <EditableTagList label="Font Suggestions" items={asArr(design.font_suggestions)} editMode onChange={v => setDesign('font_suggestions', v)} />
            </>
          ) : (
            <>
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
            </>
          )}
        </Section>
      )}

      {/* The 6 Deliverables */}
      <Section title="The 6 Deliverables">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(editMode || del.sermon_reel) && (
            <DeliverableCard title="Sermon Reel ×2">
              <Field label="Tone" value={del.sermon_reel?.tone} editMode={editMode} onChange={v => setDel('sermon_reel', 'tone', v)} />
              <Field label="Topic Approach" value={del.sermon_reel?.topic_approach} editMode={editMode} onChange={v => setDel('sermon_reel', 'topic_approach', v)} />
              <Field label="Thumbnail" value={del.sermon_reel?.thumbnail_guidance} editMode={editMode} onChange={v => setDel('sermon_reel', 'thumbnail_guidance', v)} />
              <InlineField label="Hashtags" value={del.sermon_reel?.hashtags} editMode={editMode} onChange={v => setDel('sermon_reel', 'hashtags', v)} />
              <Field label="CTA" value={del.sermon_reel?.cta} editMode={editMode} onChange={v => setDel('sermon_reel', 'cta', v)} />
            </DeliverableCard>
          )}
          {(editMode || del.worship_reel) && (
            <DeliverableCard title="Worship Reel ×1">
              {!editMode && del.worship_reel?.recommendation && (
                <div className="mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    del.worship_reel.recommendation?.toLowerCase().includes('yes') ? 'bg-green-100 text-green-800' :
                    del.worship_reel.recommendation?.toLowerCase().includes('not') ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>{del.worship_reel.recommendation}</span>
                </div>
              )}
              <InlineField label="Recommendation" value={del.worship_reel?.recommendation} editMode={editMode} onChange={v => setDel('worship_reel', 'recommendation', v)} />
              <Field label="Reasoning" value={del.worship_reel?.reasoning} editMode={editMode} onChange={v => setDel('worship_reel', 'reasoning', v)} />
              <Field label="Approach" value={del.worship_reel?.emotional_vs_teaching} editMode={editMode} onChange={v => setDel('worship_reel', 'emotional_vs_teaching', v)} />
              <Field label="Caption Guidance" value={del.worship_reel?.caption_guidance} editMode={editMode} onChange={v => setDel('worship_reel', 'caption_guidance', v)} />
            </DeliverableCard>
          )}
          {(editMode || del.carousel) && (
            <DeliverableCard title="Carousel ×1">
              <Field label="Style" value={del.carousel?.teaching_vs_poetic} editMode={editMode} onChange={v => setDel('carousel', 'teaching_vs_poetic', v)} />
              <Field label="Bible Verses" value={del.carousel?.bible_verse_approach} editMode={editMode} onChange={v => setDel('carousel', 'bible_verse_approach', v)} />
              <InlineField label="Caption Length" value={del.carousel?.caption_length} editMode={editMode} onChange={v => setDel('carousel', 'caption_length', v)} />
              <Field label="CTA" value={del.carousel?.cta} editMode={editMode} onChange={v => setDel('carousel', 'cta', v)} />
            </DeliverableCard>
          )}
          {(editMode || del.invite_post) && (
            <DeliverableCard title="Invite Post ×1">
              <InlineField label="Service Times" value={del.invite_post?.service_times} editMode={editMode} onChange={v => setDel('invite_post', 'service_times', v)} />
              <InlineField label="Locations" value={del.invite_post?.locations} editMode={editMode} onChange={v => setDel('invite_post', 'locations', v)} />
              <InlineField label="Online Option" value={del.invite_post?.online_option} editMode={editMode} onChange={v => setDel('invite_post', 'online_option', v)} />
              <Field label="Kids Ministry" value={del.invite_post?.kids_ministry_language} editMode={editMode} onChange={v => setDel('invite_post', 'kids_ministry_language', v)} />
            </DeliverableCard>
          )}
          {(editMode || del.recap_post) && (
            <DeliverableCard title="Recap Post ×1">
              <InlineField label="Recap History" value={del.recap_post?.has_recap_history} editMode={editMode} onChange={v => setDel('recap_post', 'has_recap_history', v)} />
              <Field label="Recap Focus" value={del.recap_post?.recap_focus} editMode={editMode} onChange={v => setDel('recap_post', 'recap_focus', v)} />
              <Field label="Recap Feel" value={del.recap_post?.recap_feel} editMode={editMode} onChange={v => setDel('recap_post', 'recap_feel', v)} />
            </DeliverableCard>
          )}
          {(editMode || del.facebook_text_post) && (
            <DeliverableCard title="FB Text Post ×1">
              <Field label="Format" value={del.facebook_text_post?.format} editMode={editMode} onChange={v => setDel('facebook_text_post', 'format', v)} />
              <Field label="Audience Response" value={del.facebook_text_post?.audience_response} editMode={editMode} onChange={v => setDel('facebook_text_post', 'audience_response', v)} />
              <Field label="Opens With" value={del.facebook_text_post?.opening_pattern} editMode={editMode} onChange={v => setDel('facebook_text_post', 'opening_pattern', v)} />
              <Field label="Closes With" value={del.facebook_text_post?.closing_pattern} editMode={editMode} onChange={v => setDel('facebook_text_post', 'closing_pattern', v)} />
            </DeliverableCard>
          )}
        </div>
      </Section>

      {/* What Performs Well */}
      {(editMode || perf.summary) && (
        <Section title="What Performs Well">
          <Field label="Summary" value={perf.summary} editMode={editMode} onChange={v => setPerf('summary', v)} />
          <EditableTagList label="Top Content Types" items={asArr(perf.top_content_types)} editMode={editMode} onChange={v => setPerf('top_content_types', v)} />
          <EditableTagList label="Themes That Land" items={asArr(perf.themes_that_land)} editMode={editMode} onChange={v => setPerf('themes_that_land', v)} />
          <Field label="Caption Style" value={perf.caption_style} editMode={editMode} onChange={v => setPerf('caption_style', v)} />
          <Field label="Lean Into" value={perf.what_to_lean_into} editMode={editMode} onChange={v => setPerf('what_to_lean_into', v)} />
          <Field label="Stay Away From" value={perf.what_to_avoid} editMode={editMode} onChange={v => setPerf('what_to_avoid', v)} />
        </Section>
      )}

      {/* Team Tips */}
      {(editMode || profile.team_tips) && (
        <Section title="Team Tips">
          {editMode ? (
            <textarea
              value={profile.team_tips ?? ''}
              rows={4}
              onChange={e => onProfileChange?.({ ...profile, team_tips: e.target.value })}
              className="w-full text-sm text-[#341756] border border-[#CFC9F8] rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-[#513DE5] resize-y bg-white"
            />
          ) : (
            <div className="bg-[#513DE5] text-white rounded-xl p-4">
              <p className="text-sm leading-relaxed">{profile.team_tips}</p>
            </div>
          )}
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
