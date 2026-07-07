/**
 * Staff-side sitemap review editor.
 *
 * Composes the review from the project's current state (personas,
 * web_pages, nav groups) via composeSitemapReview, then lets the
 * strategist edit every field, pages + purposes, persona postures +
 * journeys, nav layout, content-consolidation rationale. Publishes
 * to a shareable partner URL when ready; approves it as canonical
 * once the partner has weighed in.
 *
 * Mounted as a modal-ish overlay from CopyEngineWorkspace. The
 * partner-facing portal reads the same data via a public RPC and
 * writes back through a token-gated save path (see sitemapReview.ts).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  approveReview,
  composeSitemapReview,
  loadSitemapReview,
  publishReview,
  saveSitemapReview,
  type ContentMigration,
  type PersonaPosture,
  type ReviewPage,
  type SitemapReview,
} from '../../../lib/sitemapReview'
import { buildPortalUrl } from '../../../lib/portalUrl'
import { PartnerEditRequestsInbox } from './PartnerEditRequestsInbox'
import SitemapPartnerViewV2 from './SitemapPartnerViewV2'

interface Props {
  projectId: string
  /** Rendered in the header for context. */
  churchName?: string | null
  /** Called on publish / approve / significant change so the parent
   *  can refresh its own state. */
  onChange?: () => void | Promise<void>
  /** When true, renders as a full-panel embed; when false (default),
   *  renders as an overlay with a Close button that fires onClose. */
  embed?: boolean
  onClose?: () => void
}

export function SitemapReviewEditor({
  projectId, churchName, onChange, embed = false, onClose,
}: Props) {
  const [review, setReview] = useState<SitemapReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Always recompose against the latest project state so older
    // reviews get missing defaults (executive_summary, navigation_
    // strategy, footer_info, sitemap_tag per page, seeded why_cards)
    // filled in without wiping anything the strategist authored.
    // composeSitemapReview preserves every existing field it finds;
    // the caller passes existing through so authored purposes,
    // intro copy, footer overrides, presentation blocks, and
    // partner_edit_requests round-trip.
    const [existing, { data: proj }, { data: pgs }] = await Promise.all([
      loadSitemapReview(supabase, projectId),
      supabase.from('strategy_web_projects')
        .select([
          'id, church_name, personas, nav_group_definitions, roadmap_state',
          'address, city_state, phone, email, primary_service_time, all_service_times',
          'social_facebook_url, social_instagram_url, social_youtube_url',
          'social_tiktok_url, social_twitter_url, social_linkedin_url',
        ].join(', '))
        .eq('id', projectId).maybeSingle(),
      supabase.from('web_pages')
        .select('id, slug, name, phase, sort_order, nav_group_label, user_journey_step')
        .eq('web_project_id', projectId)
        .eq('archived', false)
        .order('sort_order', { ascending: true }),
    ])
    const composed = composeSitemapReview({
      project:  (proj ?? { id: projectId }) as never,
      pages:    (pgs ?? []) as never,
      existing,
    })
    setReview(composed)
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const persist = useCallback(async (next: SitemapReview) => {
    setReview(next)
    setSaving(true)
    setError(null)
    const res = await saveSitemapReview(supabase, projectId, next)
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setReview(res.review)
    if (onChange) await onChange()
  }, [projectId, onChange])

  const shareUrl = useMemo(() => {
    if (!review?.token || review.status === 'draft') return null
    return buildPartnerReviewUrl(review.token)
  }, [review])

  if (loading) {
    return <div className="p-6 text-[13px] text-wm-text-muted">Loading sitemap review…</div>
  }
  if (!review) {
    return (
      <div className="p-6 text-[13px] text-red-600">
        Couldn't load the sitemap review. {error && <span>· {error}</span>}
      </div>
    )
  }

  const status = review.status
  const isApproved = status === 'approved'

  const container = embed
    ? 'flex flex-col h-full bg-wm-bg'
    : 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4'
  // Preview mode widens the modal because the partner render packs
  // 2 or 3 megamenu columns + a featured tile side by side and needs
  // ~1100px to breathe. Edit mode keeps the narrower form-friendly
  // width so per-page textareas don't stretch line-length.
  const inner = embed
    ? 'flex flex-col h-full'
    : viewMode === 'preview'
      ? 'bg-wm-bg rounded-lg shadow-2xl w-full max-w-6xl h-[95vh] flex flex-col'
      : 'bg-wm-bg rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col'

  return (
    <div className={container}>
      <div className={inner}>
        {/* Header */}
        <div className="border-b border-wm-border px-5 py-3 flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[16px] font-bold text-wm-text">Sitemap &amp; Navigation Review</h2>
            <p className="text-[11.5px] text-wm-text-muted">
              {churchName ?? 'This project'}
              {' · '}
              <StatusChip status={status} />
              {isApproved && review.approved_by && (
                <span className="text-[10.5px] text-wm-text-subtle ml-1">
                  · approved by {review.approved_by}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full border border-wm-border overflow-hidden text-[11.5px] font-semibold">
              <button
                type="button"
                onClick={() => setViewMode('edit')}
                className={
                  viewMode === 'edit'
                    ? 'bg-wm-accent-strong text-white px-3 py-1.5'
                    : 'bg-white text-wm-text-muted px-3 py-1.5 hover:text-wm-text'
                }
              >Edit</button>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={
                  viewMode === 'preview'
                    ? 'bg-wm-accent-strong text-white px-3 py-1.5'
                    : 'bg-white text-wm-text-muted px-3 py-1.5 hover:text-wm-text'
                }
              >Preview as partner</button>
            </div>
            {saving && <span className="text-[11px] text-wm-text-subtle">Saving…</span>}
            {shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline"
              >
                Open partner link ↗
              </a>
            )}
            {!embed && (
              <button
                type="button"
                onClick={onClose}
                className="text-[12px] text-wm-text-muted hover:text-wm-text"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        {viewMode === 'edit' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            <PartnerEditRequestsInbox review={review} onChange={persist} disabled={isApproved} />

            {/* Sections are ordered to mirror the partner-facing wrapper 1:1.
                Each header calls out the artifact section it feeds so the
                strategist knows exactly where the field renders. */}

            {/* Every editor here maps 1:1 to a partner-visible section
                so the strategist edits exactly what the partner sees.
                Anything strategist-only (persona postures) is tucked
                into an Advanced group at the bottom so it does not
                clutter the primary flow. */}

            <SectionBand num="Hero" label="What the partner reads first">
              <IntroEditor review={review} onChange={persist} disabled={isApproved} />
              <div className="mt-3">
                <HeroEmPhraseEditor review={review} onChange={persist} disabled={isApproved} />
              </div>
            </SectionBand>

            <SectionBand num="01" label="The heart behind your new site">
              <ExecutiveSummaryEditor review={review} onChange={persist} disabled={isApproved} />
            </SectionBand>

            <SectionBand num="02" label="Primary Navigation">
              <NavigationStrategyEditor review={review} onChange={persist} disabled={isApproved} />
              <NavPresentationEditor review={review} onChange={persist} disabled={isApproved} />
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Featured highlight tile</p>
                <FeaturedHighlightEditor review={review} onChange={persist} disabled={isApproved} />
              </div>
            </SectionBand>

            <SectionBand num="02b" label="Congregations (Shared Hub Pages + Persistent Nav)">
              <SharedHubsIntroEditor review={review} onChange={persist} disabled={isApproved} />
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Congregations</p>
                <CongregationsEditor review={review} onChange={persist} disabled={isApproved} />
              </div>
            </SectionBand>

            <SectionBand num="03" label="Footer">
              <FooterInfoEditor review={review} onChange={persist} disabled={isApproved} />
            </SectionBand>

            <SectionBand num="04" label="Full Page List">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Tier headings</p>
                <TiersEditor review={review} onChange={persist} disabled={isApproved} />
              </div>
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Pages</p>
                <PagesEditor review={review} onChange={persist} disabled={isApproved} />
              </div>
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Per-page descriptions</p>
                <TierPageDescriptionsEditor review={review} onChange={persist} disabled={isApproved} />
              </div>
            </SectionBand>

            <SectionBand num="05" label="What's changing from your current site">
              <WhatsChangingCardsEditor review={review} onChange={persist} disabled={isApproved} />
              <details className="mt-4 rounded border border-wm-border bg-wm-bg px-3 py-2">
                <summary className="text-[11.5px] font-semibold text-wm-text-muted cursor-pointer">Content migrations (strategist-only, feeds the cards above when unauthored)</summary>
                <div className="mt-3">
                  <ContentMigrationsEditor review={review} onChange={persist} disabled={isApproved} />
                </div>
              </details>
            </SectionBand>

            <SectionBand num="06" label="Why we shaped it this way">
              <WhyCardsEditor review={review} onChange={persist} disabled={isApproved} />
            </SectionBand>

            <SectionBand num="07" label="Who this site is built for (personas + journeys)">
              <p className="text-[11.5px] text-wm-text-muted mb-2">
                Each persona plus the step-by-step journey the partner sees on the review. Only personas with a posture summary or at least one journey step render on the partner view.
              </p>
              <PersonaPosturesEditor review={review} onChange={persist} disabled={isApproved} />
            </SectionBand>

            <SectionBand num="Cowork" label="Presentation layer (authored by cowork sessions)">
              <PresentationEditor review={review} onChange={persist} disabled={isApproved} />
            </SectionBand>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SitemapPartnerViewV2 review={review} churchName={churchName} readOnly />
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-wm-border px-5 py-3 flex items-center gap-2 flex-wrap">
          {status === 'draft' && (
            <button
              type="button"
              onClick={() => void persist(publishReview(review))}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[12px] font-semibold bg-wm-accent-strong text-white rounded-full px-4 py-1.5 hover:bg-wm-accent disabled:opacity-50"
            >
              Publish for partner review →
            </button>
          )}
          {(status === 'published' || status === 'partner_reviewed') && (
            <>
              <button
                type="button"
                onClick={() => void persist(approveReview(review, 'staff'))}
                disabled={saving}
                className="inline-flex items-center gap-1 text-[12px] font-semibold bg-wm-accent-strong text-white rounded-full px-4 py-1.5 hover:bg-wm-accent disabled:opacity-50"
              >
                Approve as canonical →
              </button>
              {shareUrl && (
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(shareUrl) }}
                  className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline"
                >
                  Copy partner link
                </button>
              )}
            </>
          )}
          {isApproved && (
            <>
              <span className="text-[11.5px] text-wm-text-muted">
                This review is the canonical sitemap. Downstream tools read from here.
              </span>
              <button
                type="button"
                onClick={() => void persist({ ...review, status: 'partner_reviewed', approved_at: null, approved_by: null })}
                disabled={saving}
                className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text ml-auto"
              >
                Unlock for edits
              </button>
            </>
          )}
          {error && <span className="text-[11px] text-red-600">err: {error}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Sub-editors ──────────────────────────────────────────────────────

function StatusChip({ status }: { status: SitemapReview['status'] }) {
  const label = {
    draft:            'Draft',
    published:        'Published for partner',
    partner_reviewed: 'Partner-reviewed',
    approved:         'Approved',
  }[status]
  const cls = {
    draft:            'bg-wm-bg-elevated text-wm-text-muted border-wm-border',
    published:        'bg-blue-50 text-blue-700 border-blue-200',
    partner_reviewed: 'bg-amber-50 text-amber-800 border-amber-200',
    approved:         'bg-green-50 text-green-700 border-green-300',
  }[status]
  return (
    <span className={`inline-block text-[10px] uppercase tracking-wider font-bold border rounded-full px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  )
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <details className="rounded-md border border-wm-border bg-wm-bg-elevated" open>
      <summary className="px-4 py-3 cursor-pointer">
        <span className="text-[13.5px] font-bold text-wm-text">{title}</span>
        {subtitle && <span className="text-[11px] text-wm-text-muted ml-2">{subtitle}</span>}
      </summary>
      <div className="border-t border-wm-border px-4 py-3">{children}</div>
    </details>
  )
}

function IntroEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  const intro = review.intro ?? { headline: '', body: '' }
  return (
    <Section title="Intro" subtitle="What the partner sees at the top of their review">
      <div className="space-y-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Headline</span>
          <input
            type="text"
            defaultValue={intro.headline}
            disabled={disabled}
            onBlur={e => {
              if (e.target.value === intro.headline) return
              void onChange({ ...review, intro: { ...intro, headline: e.target.value } })
            }}
            className="mt-1 w-full text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Body</span>
          <textarea
            defaultValue={intro.body}
            disabled={disabled}
            rows={3}
            onBlur={e => {
              if (e.target.value === intro.body) return
              void onChange({ ...review, intro: { ...intro, body: e.target.value } })
            }}
            className="mt-1 w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
      </div>
    </Section>
  )
}

function ExecutiveSummaryEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  return (
    <Section
      title="Executive summary"
      subtitle="Big-picture strategic framing that opens the review"
    >
      <textarea
        defaultValue={review.executive_summary ?? ''}
        placeholder="Two or three warm paragraphs on what this site is designed to accomplish for the partner. Speaks to their heart, not just the mechanics."
        disabled={disabled}
        rows={8}
        onBlur={e => {
          if (e.target.value === (review.executive_summary ?? '')) return
          void onChange({ ...review, executive_summary: e.target.value })
        }}
        className="w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50 leading-relaxed"
      />
    </Section>
  )
}

function NavigationStrategyEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  return (
    <Section
      title="Navigation strategy"
      subtitle="The 'heart and why' paragraph for the menu structure"
    >
      <textarea
        defaultValue={review.navigation_strategy ?? ''}
        placeholder="Explain the reasoning behind the menu structure in prose. Who each layer serves, why items were grouped this way, what the partner will feel when their audience uses it."
        disabled={disabled}
        rows={6}
        onBlur={e => {
          if (e.target.value === (review.navigation_strategy ?? '')) return
          void onChange({ ...review, navigation_strategy: e.target.value })
        }}
        className="w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50 leading-relaxed"
      />
    </Section>
  )
}

function FooterInfoEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  const footer = review.footer_info ?? {}
  const update = (patch: Partial<NonNullable<SitemapReview['footer_info']>>) => {
    void onChange({ ...review, footer_info: { ...footer, ...patch } })
  }
  return (
    <Section
      title="Footer information"
      subtitle="Contact details, hours, socials, and footer page links"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <FooterField label="Church name"    value={footer.church_name}    disabled={disabled} onSave={v => update({ church_name: v })} />
        <FooterField label="Address"        value={footer.address}        disabled={disabled} onSave={v => update({ address: v })} />
        <FooterField label="Phone"          value={footer.phone}          disabled={disabled} onSave={v => update({ phone: v })} />
        <FooterField label="Email"          value={footer.email}          disabled={disabled} onSave={v => update({ email: v })} />
        <FooterField label="Office hours"   value={footer.office_hours}   disabled={disabled} onSave={v => update({ office_hours: v })} />
        <FooterField label="Newsletter URL" value={footer.newsletter_signup_url} disabled={disabled} onSave={v => update({ newsletter_signup_url: v })} />
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Social links</p>
        {(footer.social_links ?? []).length === 0 && (
          <p className="text-[11.5px] text-wm-text-subtle italic">No socials pulled from intake yet.</p>
        )}
        <ul className="space-y-1">
          {(footer.social_links ?? []).map((s, i) => (
            <li key={`${s.platform}-${i}`} className="flex items-center gap-2 text-[12px]">
              <span className="w-20 text-wm-text-muted capitalize">{s.platform}</span>
              <input
                type="text"
                defaultValue={s.url}
                disabled={disabled}
                onBlur={e => {
                  if (e.target.value === s.url) return
                  const next = [...(footer.social_links ?? [])]
                  next[i] = { ...s, url: e.target.value }
                  update({ social_links: next })
                }}
                className="flex-1 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => {
                    const next = (footer.social_links ?? []).filter((_, idx) => idx !== i)
                    update({ social_links: next })
                  }}
                  className="text-wm-text-subtle hover:text-wm-danger text-[14px] leading-none px-1"
                >×</button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Footer page links</p>
        <p className="text-[10.5px] text-wm-text-subtle mb-1.5">Extra links the partner wants in the footer (Preschool, Careers, Memorial Garden, etc.).</p>
        <ul className="space-y-1">
          {(footer.footer_page_links ?? []).map((link, i) => (
            <li key={i} className="flex items-center gap-2 text-[12px]">
              <input
                type="text"
                defaultValue={link.label}
                placeholder="Label"
                disabled={disabled}
                onBlur={e => {
                  if (e.target.value === link.label) return
                  const next = [...(footer.footer_page_links ?? [])]
                  next[i] = { ...link, label: e.target.value }
                  update({ footer_page_links: next })
                }}
                className="w-40 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
              <input
                type="text"
                defaultValue={link.url}
                placeholder="/path or https://…"
                disabled={disabled}
                onBlur={e => {
                  if (e.target.value === link.url) return
                  const next = [...(footer.footer_page_links ?? [])]
                  next[i] = { ...link, url: e.target.value }
                  update({ footer_page_links: next })
                }}
                className="flex-1 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => {
                    const next = (footer.footer_page_links ?? []).filter((_, idx) => idx !== i)
                    update({ footer_page_links: next })
                  }}
                  className="text-wm-text-subtle hover:text-wm-danger text-[14px] leading-none px-1"
                >×</button>
              )}
            </li>
          ))}
        </ul>
        {!disabled && (
          <button
            type="button"
            onClick={() => update({ footer_page_links: [...(footer.footer_page_links ?? []), { label: '', url: '' }] })}
            className="mt-1 text-[11px] font-semibold text-wm-accent-strong hover:underline"
          >
            + Add footer link
          </button>
        )}
      </div>
    </Section>
  )
}

function FooterField({
  label, value, disabled, onSave,
}: { label: string; value: string | null | undefined; disabled: boolean; onSave: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</span>
      <input
        type="text"
        defaultValue={value ?? ''}
        disabled={disabled}
        onBlur={e => { if (e.target.value !== (value ?? '')) onSave(e.target.value) }}
        className="mt-1 w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />
    </label>
  )
}

function PagesEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  const updatePage = (id: string, patch: Partial<ReviewPage>) => {
    void onChange({ ...review, pages: review.pages.map(p => p.id === id ? { ...p, ...patch } : p) })
  }
  return (
    <Section title="Pages" subtitle={`${review.pages.length} pages · edit each purpose so partners see what each page is for`}>
      <ul className="space-y-2">
        {review.pages.map(p => (
          <li key={p.id} className="border border-wm-border rounded p-2.5 bg-wm-bg">
            <div className="flex items-baseline gap-2 mb-1 flex-wrap">
              <input
                type="text"
                defaultValue={p.name}
                disabled={disabled}
                onBlur={e => { if (e.target.value !== p.name) updatePage(p.id, { name: e.target.value }) }}
                className="text-[13px] font-semibold text-wm-text bg-transparent focus:outline-none border-b border-transparent focus:border-wm-accent disabled:opacity-50"
              />
              <code className="text-[11px] font-mono text-wm-text-muted">/{p.slug}</code>
              {p.nav_position && (
                <span className="text-[10.5px] text-wm-text-subtle ml-auto">{p.nav_position}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              {p.primary_audience && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-wm-accent-tint border border-wm-accent/30 text-wm-accent-strong">
                  Audience: {p.primary_audience}
                </span>
              )}
              {p.funnel_stage && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-wm-bg-elevated border border-wm-border text-wm-text-muted">
                  Funnel: {p.funnel_stage}
                </span>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-[10px] text-wm-text-muted">
                <span className="uppercase tracking-wider font-semibold">Tag</span>
                <select
                  value={p.sitemap_tag ?? 'kept'}
                  disabled={disabled}
                  onChange={e => updatePage(p.id, { sitemap_tag: e.target.value as ReviewPage['sitemap_tag'] })}
                  className="text-[11px] rounded-full border border-wm-border bg-white px-2 py-0.5 font-semibold text-wm-text focus:outline-none focus:border-wm-accent disabled:opacity-50"
                >
                  <option value="kept">have today</option>
                  <option value="unified">now shared</option>
                  <option value="consolidated">combined</option>
                  <option value="new">new</option>
                </select>
              </label>
            </div>
            <label className="block mt-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Purpose</span>
              <textarea
                defaultValue={p.purpose}
                placeholder="What this page is for. One or two warm sentences the partner will read."
                disabled={disabled}
                rows={2}
                onBlur={e => { if (e.target.value !== p.purpose) updatePage(p.id, { purpose: e.target.value }) }}
                className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
            </label>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function PersonaPosturesEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  const updatePosture = (id: string, patch: Partial<PersonaPosture>) => {
    void onChange({
      ...review,
      persona_postures: review.persona_postures.map(p => p.persona_id === id ? { ...p, ...patch } : p),
    })
  }
  const toggleKeyPage = (id: string, slug: string) => {
    const p = review.persona_postures.find(pp => pp.persona_id === id)
    if (!p) return
    const current = p.key_page_slugs ?? []
    const has = current.includes(slug)
    const next = has ? current.filter(s => s !== slug) : [...current, slug].slice(0, 3)
    updatePosture(id, { key_page_slugs: next })
  }
  if (review.persona_postures.length === 0) {
    return (
      <Section title="Persona postures" subtitle="One posture per project persona">
        <p className="text-[12px] text-wm-text-muted italic">
          No personas on this project yet. Add personas to the strategy brief first — do not invent them here.
        </p>
      </Section>
    )
  }
  return (
    <Section title="Persona postures" subtitle="How the site is angled to each person and the top 3 pages that must serve them">
      <div className="space-y-3">
        {review.persona_postures.map(p => {
          const currentKeys = p.key_page_slugs ?? []
          return (
          <div key={p.persona_id} className="border border-wm-border rounded p-3 bg-wm-bg">
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <p className="text-[13px] font-bold text-wm-text">{p.persona_name}</p>
            </div>
            {p.drop_off_risk && (
              <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-widest font-bold text-amber-800 mb-0.5">
                  How we're clearing the way at /{p.drop_off_risk.at_slug}
                </p>
                {p.drop_off_risk.mitigation && (
                  <p className="text-[11.5px] text-amber-900 leading-snug">{p.drop_off_risk.mitigation}</p>
                )}
                {p.drop_off_risk.reason && (
                  <p className="text-[10.5px] text-amber-800/80 leading-snug mt-0.5 italic">
                    Context: {p.drop_off_risk.reason}
                  </p>
                )}
              </div>
            )}
            <textarea
              defaultValue={p.posture_summary}
              placeholder={`How the site meets ${p.persona_name}: contextualize their brief-stated desire and barrier into a paragraph about the site's job for them.`}
              disabled={disabled}
              rows={2}
              onBlur={e => { if (e.target.value !== p.posture_summary) updatePosture(p.persona_id, { posture_summary: e.target.value }) }}
              className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Goal</p>
              <input
                type="text"
                defaultValue={p.goal ?? ''}
                placeholder={`What ${p.persona_name} is trying to reach on the site (specific, not "plan a visit" for everyone).`}
                disabled={disabled}
                onBlur={e => { const v = e.target.value.trim(); if (v !== (p.goal ?? '')) updatePosture(p.persona_id, { goal: v || undefined }) }}
                className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
            </div>
            <div className="mt-2">
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Key pages</p>
                <p className="text-[10px] text-wm-text-subtle">{currentKeys.length}/3 selected</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {review.pages.map(pg => {
                  const active   = currentKeys.includes(pg.slug)
                  const disable  = disabled || (!active && currentKeys.length >= 3)
                  return (
                    <button
                      key={pg.slug}
                      type="button"
                      disabled={disable}
                      onClick={() => toggleKeyPage(p.persona_id, pg.slug)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                        active
                          ? 'bg-wm-accent text-white border-wm-accent'
                          : 'bg-wm-bg-elevated text-wm-text border-wm-border hover:border-wm-accent'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                      title={pg.purpose}
                    >
                      {pg.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )})}
      </div>
    </Section>
  )
}

// NavLayoutEditor and NavListEditor removed. Nav shell + content
// authoring now lives in NavPresentationEditor above, and footer
// links have their own FooterPageLinksEditor.

function ContentMigrationsEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  const migrations = review.content_migrations
  const setMigrations = (next: ContentMigration[]) => { void onChange({ ...review, content_migrations: next }) }
  const updateMig = (id: string, patch: Partial<ContentMigration>) => {
    setMigrations(migrations.map(m => m.id === id ? { ...m, ...patch } : m))
  }
  const addMig = () => {
    setMigrations([...migrations, {
      id:          crypto.randomUUID(),
      title:       '',
      merged_from: [],
      merged_to:   '',
      rationale:   '',
    }])
  }
  const removeMig = (id: string) => setMigrations(migrations.filter(m => m.id !== id))

  return (
    <Section title="Where content went" subtitle="Consolidation rationale. For example, Youth and Kids folding into a single Family page, and why that serves families better.">
      <p className="text-[11.5px] text-wm-text-muted mb-2">
        Document pages the partner had before but that now live under a
        different structure. Each migration explains what merged into
        what, and why.
      </p>
      <ul className="space-y-2">
        {migrations.map(m => (
          <li key={m.id} className="border border-wm-border rounded p-2.5 bg-wm-bg space-y-2">
            <input
              type="text"
              defaultValue={m.title}
              placeholder="Title, e.g. Youth + Kids → Family"
              disabled={disabled}
              onBlur={e => { if (e.target.value !== m.title) updateMig(m.id, { title: e.target.value }) }}
              className="w-full text-[13px] font-semibold text-wm-text bg-transparent border-b border-wm-border focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">Merged from (comma-separated)</p>
                <input
                  type="text"
                  defaultValue={m.merged_from.join(', ')}
                  placeholder="Youth Ministry, Kids Ministry"
                  disabled={disabled}
                  onBlur={e => {
                    const parts = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    if (JSON.stringify(parts) !== JSON.stringify(m.merged_from)) updateMig(m.id, { merged_from: parts })
                  }}
                  className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">Merged to</p>
                <input
                  type="text"
                  defaultValue={m.merged_to}
                  placeholder="Family"
                  disabled={disabled}
                  onBlur={e => { if (e.target.value !== m.merged_to) updateMig(m.id, { merged_to: e.target.value }) }}
                  className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                />
              </div>
            </div>
            <textarea
              defaultValue={m.rationale}
              placeholder="Why the change serves the partner well: what they gain, what stays intact, why the new page is a better fit for the person visiting."
              disabled={disabled}
              rows={2}
              onBlur={e => { if (e.target.value !== m.rationale) updateMig(m.id, { rationale: e.target.value }) }}
              className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => removeMig(m.id)}
                className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-danger"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <button
          type="button"
          onClick={addMig}
          className="mt-2 text-[11.5px] font-semibold text-wm-accent-strong hover:underline"
        >
          + Add migration
        </button>
      )}
    </Section>
  )
}

// ── Partner URL builder ──────────────────────────────────────────────

/** Build the public partner review URL. Uses buildPortalUrl when the
 *  brand portal host is in play; otherwise same-origin. */
function buildPartnerReviewUrl(token: string): string {
  // Mount the sitemap portal at /portal/sitemap/:token on the same
  // origin the strategist is using. buildPortalUrl handles the
  // brand-portal-host swap for brand guides, but this is not a brand
  // guide, so we build against the current origin.
  if (typeof window === 'undefined') return `/portal/sitemap/${token}`
  return `${window.location.origin}/portal/sitemap/${token}`
}

// (silence unused var lint, buildPortalUrl imported for parity with
// other portal builders; the partner sitemap URL doesn't need it yet.)
void buildPortalUrl

// ─────────────────────────────────────────────────────────────────
// SectionBand: visual grouper that stamps the wrapper's section
// number next to each editor cluster so the strategist can trace
// "this is what feeds section 02 of the partner view" without
// switching to Preview.
// ─────────────────────────────────────────────────────────────────

function SectionBand({ num, label, children }: { num: string; label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-wm-border bg-wm-bg-elevated p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="inline-flex items-center rounded-full bg-wm-accent-tint text-wm-accent-strong text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 font-mono">
          {num}
        </span>
        <span className="text-[13px] font-semibold text-wm-text">{label}</span>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// PresentationEditor: raw JSON textarea for the cowork-authored
// SitemapReview.presentation layer. Rich per-field editors will
// follow; for now this is the round-trip surface a cowork session
// pastes its output into.
// ─────────────────────────────────────────────────────────────────

function PresentationEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const initial = useMemo(
    () => JSON.stringify(review.presentation ?? {}, null, 2),
    [review.presentation],
  )
  const [text,  setText]  = useState(initial)
  const [error, setError] = useState<string | null>(null)

  // Reset when the underlying data updates from elsewhere.
  useEffect(() => { setText(initial); setError(null) }, [initial])

  const save = () => {
    setError(null)
    try {
      const parsed = text.trim() ? JSON.parse(text) : {}
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Must be a JSON object.')
      }
      void onChange({ ...review, presentation: parsed })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.')
    }
  }

  const clear = () => {
    if (!confirm('Clear the entire presentation layer? The partner view falls back to system defaults.')) return
    setText('{}')
    void onChange({ ...review, presentation: undefined })
  }

  const dirty = text !== initial

  return (
    <div className="space-y-2">
      <div className="text-[11.5px] text-wm-text-muted leading-snug">
        Cowork sessions push their output here. Fields the schema accepts:
        <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">hero_em_phrase</code>,
        <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">congregations[]</code>,
        <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">featured_highlight</code>,
        <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">tiers[]</code>,
        <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">whats_changing_cards[]</code>,
        <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">why_cards[]</code>,
        <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">your_turn_prompts[]</code>.
        See <code className="bg-wm-bg px-1 mx-0.5 rounded text-[10.5px]">src/lib/sitemapReview.ts</code> for the full type.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={disabled}
        rows={16}
        spellCheck={false}
        className="w-full rounded-md border border-wm-border bg-white text-[12px] font-mono text-wm-text p-3 outline-none focus:border-wm-accent"
        placeholder="{}"
      />
      {error && <div className="text-[11.5px] text-red-600">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || !dirty}
          onClick={save}
          className="text-[12px] font-semibold px-4 py-1.5 rounded-full bg-wm-accent-strong text-white hover:bg-wm-accent disabled:opacity-50"
        >
          Save presentation
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={clear}
          className="text-[11.5px] text-wm-text-muted hover:text-red-600"
        >
          Clear presentation
        </button>
        {dirty && <span className="text-[11px] text-wm-text-subtle">Unsaved changes</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// NavPresentationEditor. Shell selector (dropdowns / megamenu /
// off-canvas) plus a JSON textarea for the body (visible_top_level,
// megamenu_panels, standard_dropdowns, offcanvas_overlay). Rich per
// field editors for nested columns and featured tiles are a later
// pass; this gives the strategist a working editing surface today
// for the nav shell + preview content.
// ─────────────────────────────────────────────────────────────────

function NavPresentationEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const np = review.nav_presentation
  const shell = (np?.shell
    ?? (np?.megamenu_panels && np.megamenu_panels.length > 0 ? 'megamenu'
        : np?.standard_dropdowns ? 'standard_dropdowns'
        : np?.offcanvas_overlay ? 'offcanvas' : 'megamenu')) as 'standard_dropdowns' | 'megamenu' | 'offcanvas'

  const initial = useMemo(() => JSON.stringify(np ?? {}, null, 2), [np])
  const [text,  setText]  = useState(initial)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setText(initial); setError(null) }, [initial])

  const setShell = (nextShell: typeof shell) => {
    const nextNp = { ...(np ?? {}), shell: nextShell }
    void onChange({ ...review, nav_presentation: nextNp })
  }

  const saveJson = () => {
    setError(null)
    try {
      const parsed = text.trim() ? JSON.parse(text) : {}
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be a JSON object.')
      void onChange({ ...review, nav_presentation: parsed })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.')
    }
  }
  const dirty = text !== initial

  const shellOptions: Array<{ key: typeof shell; label: string; hint: string }> = [
    { key: 'megamenu',           label: 'Mega menu',           hint: 'Rich dropdowns with columns + featured tiles. Best for churches with several ministries under one top-level item.' },
    { key: 'standard_dropdowns', label: 'Standard dropdowns',  hint: 'Simple link lists per top-level item. Best for small sites with clear parent-child structure.' },
    { key: 'offcanvas',          label: 'Off-canvas overlay',  hint: 'Full nav lives behind the hamburger with a short header. Best when mobile-first or when the top nav needs to stay minimal.' },
  ]

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">Nav shell</div>
        <div className="flex flex-wrap gap-1.5">
          {shellOptions.map(opt => (
            <button
              key={opt.key}
              type="button"
              disabled={disabled}
              onClick={() => setShell(opt.key)}
              className={
                'text-[12px] font-medium px-3 py-1.5 rounded-full border ' +
                (shell === opt.key
                  ? 'bg-wm-accent-strong text-white border-wm-accent-strong'
                  : 'bg-white text-wm-text-muted border-wm-border hover:border-wm-accent')
              }
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-wm-text-muted mt-1.5">
          {shellOptions.find(o => o.key === shell)?.hint}
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Nav content (visible header, panels, columns)</div>
          <span className="text-[10.5px] text-wm-text-subtle">JSON matching <code className="bg-wm-bg px-1 rounded">SitemapReviewNavPresentation</code></span>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={disabled}
          rows={16}
          spellCheck={false}
          className="w-full rounded-md border border-wm-border bg-white text-[12px] font-mono text-wm-text p-3 outline-none focus:border-wm-accent"
        />
        {error && <div className="text-[11.5px] text-red-600 mt-1">{error}</div>}
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            disabled={disabled || !dirty}
            onClick={saveJson}
            className="text-[12px] font-semibold px-4 py-1.5 rounded-full bg-wm-accent-strong text-white hover:bg-wm-accent disabled:opacity-50"
          >Save nav content</button>
          {dirty && <span className="text-[11px] text-wm-text-subtle">Unsaved changes</span>}
          <span className="ml-auto text-[10.5px] text-wm-text-subtle">
            Rich per-field editors (add / remove megamenu columns, featured tiles) coming next; JSON round-trip works today.
          </span>
        </div>
      </div>
    </div>
  )
}

// FooterPageLinksEditor removed. FooterInfoEditor already renders
// the authoring surface for footer_info.footer_page_links; keeping a
// second wrapper here caused the double-render bug on the edit tab.

// ─────────────────────────────────────────────────────────────────
// WhyCardsEditor. Structured editor for presentation.why_cards so
// the strategist can override the auto-seeded strategy cards per
// partner. Each card carries an icon + title + body.
// ─────────────────────────────────────────────────────────────────

function WhyCardsEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const cards = review.presentation?.why_cards ?? []
  const update = (next: NonNullable<SitemapReview['presentation']>['why_cards']) => {
    void onChange({
      ...review,
      presentation: { ...(review.presentation ?? {}), why_cards: next },
    })
  }
  const addCard = () => update([...(cards ?? []), { id: cryptoRandomIdLocal(), icon: '◆', title: '', body: '' }])
  const removeCard = (id: string) => update((cards ?? []).filter(c => c.id !== id))

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-wm-text-muted">
        The partner render prefers these authored cards over the auto-seeded strategy defaults. Add or remove to match how you want the partner to hear the reasoning behind the sitemap.
      </p>
      {(cards ?? []).map(c => (
        <div key={c.id} className="rounded border border-wm-border bg-white px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <input
              type="text"
              defaultValue={c.icon ?? '◆'}
              disabled={disabled}
              onBlur={e => update((cards ?? []).map(cc => cc.id === c.id ? { ...cc, icon: e.target.value } : cc))}
              className="text-[16px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded-md px-2 py-0.5 w-12 text-center focus:outline-none focus:border-wm-accent disabled:opacity-50"
              title="Icon character (◆ ◇ ✦ ↗ or any glyph)"
            />
            <input
              type="text"
              defaultValue={c.title}
              placeholder="Card title (e.g. Built on what makes you distinct)"
              disabled={disabled}
              onBlur={e => update((cards ?? []).map(cc => cc.id === c.id ? { ...cc, title: e.target.value } : cc))}
              className="flex-1 text-[13px] font-semibold text-wm-text bg-transparent border-b border-transparent focus:border-wm-accent focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeCard(c.id)}
              className="text-[10.5px] text-wm-text-subtle hover:text-red-600 disabled:opacity-50"
            >Remove</button>
          </div>
          <textarea
            defaultValue={c.body}
            placeholder="One or two warm sentences the partner reads."
            disabled={disabled}
            rows={2}
            onBlur={e => update((cards ?? []).map(cc => cc.id === c.id ? { ...cc, body: e.target.value } : cc))}
            className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </div>
      ))}
      {(cards ?? []).length === 0 && (
        <p className="text-[11.5px] text-wm-text-subtle italic">No authored Why cards yet; the partner view shows the strategy-seeded default.</p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={addCard}
        className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
      >+ Add why card</button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// TierPageDescriptionsEditor. Lets the strategist override the
// one-line description shown under each page in the Full Page List.
// Reads from presentation.tiers[].page_entries[].description_override
// and writes back to the same. Grouped by tier so the strategist
// sees which tier each page belongs to.
// ─────────────────────────────────────────────────────────────────

function TierPageDescriptionsEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const tiers = review.presentation?.tiers ?? []
  if (tiers.length === 0) {
    return (
      <p className="text-[11.5px] text-wm-text-subtle italic">
        No tiers defined yet. Add them via the Presentation JSON below, then per-page overrides show up here.
      </p>
    )
  }
  const updateEntry = (tierId: string, slug: string, override: string) => {
    const nextTiers = tiers.map(t => t.id !== tierId ? t : {
      ...t,
      page_entries: (t.page_entries ?? []).map(e => e.slug !== slug ? e : { ...e, description_override: override || undefined }),
    })
    void onChange({ ...review, presentation: { ...(review.presentation ?? {}), tiers: nextTiers } })
  }
  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-wm-text-muted">
        Override the one-line description shown under each page. Blank falls back to the page's own <code className="bg-wm-bg px-1 rounded">purpose</code>.
      </p>
      {tiers.map(t => (
        <div key={t.id} className="rounded border border-wm-border bg-white px-3 py-2.5">
          <p className="text-[12px] font-semibold text-wm-text mb-1.5">
            {t.letter ? `${t.letter}. ` : ''}{t.title}
            {t.meta && <span className="text-[10.5px] text-wm-text-subtle font-normal ml-2">{t.meta}</span>}
          </p>
          {(t.page_entries ?? []).length === 0 && (
            <p className="text-[11px] text-wm-text-subtle italic">No pages in this tier yet.</p>
          )}
          <div className="space-y-1.5">
            {(t.page_entries ?? []).map(entry => {
              const page = review.pages.find(p => p.slug === entry.slug)
              return (
                <div key={entry.slug} className="flex items-start gap-2">
                  <div className="w-40 shrink-0 pt-1">
                    <span className={'text-[12px] ' + (entry.is_child ? 'ml-4 text-wm-text-muted' : 'font-semibold text-wm-text')}>
                      {page?.name ?? entry.slug}
                    </span>
                  </div>
                  <textarea
                    defaultValue={entry.description_override ?? ''}
                    placeholder={page?.purpose ?? 'One-line description shown under this page.'}
                    disabled={disabled}
                    rows={1}
                    onBlur={e => { if (e.target.value !== (entry.description_override ?? '')) updateEntry(t.id, entry.slug, e.target.value) }}
                    className="flex-1 text-[11.5px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function cryptoRandomIdLocal(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `sr_${Math.random().toString(36).slice(2, 10)}`
}

// ─────────────────────────────────────────────────────────────────
// CongregationsEditor. Rich per-cong editor for the Shared Hub Pages
// section + the Get Connected mega row layout. Fields:
//   label, service_time, address, note, is_primary flag.
// Nested link edit + featured highlight edit still route through the
// Presentation JSON block for now (deeper edit UIs to follow).
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// SharedHubsIntroEditor. Edits the headline + body text shown above
// the Shared Hub Pages cards on the partner preview. Both fields
// optional; falls back to defaults when unset.
// ─────────────────────────────────────────────────────────────────

function SharedHubsIntroEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const pres = review.presentation ?? {}
  const setField = (k: 'shared_hubs_headline' | 'shared_hubs_body', v: string) => {
    void onChange({
      ...review,
      presentation: { ...pres, [k]: v.trim() ? v : undefined },
    })
  }
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Section intro</p>
      <label className="block">
        <span className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle">Headline</span>
        <input
          type="text"
          defaultValue={pres.shared_hubs_headline ?? ''}
          disabled={disabled}
          placeholder="Shared Hub Pages"
          onBlur={e => { if (e.target.value !== (pres.shared_hubs_headline ?? '')) setField('shared_hubs_headline', e.target.value) }}
          className="mt-1 w-full text-[13px] font-semibold text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
        />
      </label>
      <label className="block">
        <span className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle">Body</span>
        <textarea
          defaultValue={pres.shared_hubs_body ?? ''}
          disabled={disabled}
          rows={3}
          placeholder="Visit is a warm welcome page for the whole church, with a card that leads to a dedicated page for each congregation. Watch works the same way."
          onBlur={e => { if (e.target.value !== (pres.shared_hubs_body ?? '')) setField('shared_hubs_body', e.target.value) }}
          className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50 resize-y"
        />
        <p className="text-[10.5px] text-wm-text-subtle mt-1">Leave blank to use the built-in default. Rendered as plain text under the section heading.</p>
      </label>
    </div>
  )
}

function CongregationsEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const congs = review.presentation?.congregations ?? []
  const update = (next: NonNullable<SitemapReview['presentation']>['congregations']) => {
    void onChange({
      ...review,
      presentation: { ...(review.presentation ?? {}), congregations: next },
    })
  }
  const patchCong = (id: string, patch: Partial<NonNullable<typeof congs>[number]>) => {
    update((congs ?? []).map(c => c.id === id ? { ...c, ...patch } : c))
  }
  const addCong = () => update([...(congs ?? []), { id: cryptoRandomIdLocal(), label: '', service_time: '', address: '' }])
  const removeCong = (id: string) => {
    if (!confirm('Remove this congregation? Its row disappears from Shared Hub Pages, Persistent Nav, and the Get Connected mega.')) return
    update((congs ?? []).filter(c => c.id !== id))
  }
  const setPrimary = (id: string) => update((congs ?? []).map(c => ({ ...c, is_primary: c.id === id })))

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-wm-text-muted">
        Each row drives one card in <b>Shared Hub Pages</b>, one bar in <b>Persistent Navigation</b>, and one row inside the Get Connected mega. Links are still authored via the Presentation JSON below.
      </p>
      {(congs ?? []).length === 0 && (
        <p className="text-[11.5px] text-wm-text-subtle italic">No congregations yet. Single-campus partners skip this section entirely.</p>
      )}
      {(congs ?? []).map(c => (
        <div key={c.id} className="rounded border border-wm-border bg-white px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              defaultValue={c.label}
              disabled={disabled}
              placeholder="Congregation name (e.g. Southwest)"
              onBlur={e => { if (e.target.value !== c.label) patchCong(c.id, { label: e.target.value }) }}
              className="flex-1 min-w-[160px] text-[13px] font-semibold text-wm-text bg-transparent border-b border-transparent focus:border-wm-accent focus:outline-none disabled:opacity-50"
            />
            <label className="text-[11px] text-wm-text-muted inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="cong-primary"
                checked={!!c.is_primary}
                disabled={disabled}
                onChange={() => setPrimary(c.id)}
              />
              Primary
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeCong(c.id)}
              className="text-[10.5px] text-wm-text-subtle hover:text-red-600 disabled:opacity-50"
            >Remove</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Service time</span>
              <input
                type="text"
                defaultValue={c.service_time ?? ''}
                disabled={disabled}
                placeholder="Sundays 9 and 10:30am"
                onBlur={e => { if (e.target.value !== (c.service_time ?? '')) patchCong(c.id, { service_time: e.target.value || undefined }) }}
                className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Address</span>
              <input
                type="text"
                defaultValue={c.address ?? ''}
                disabled={disabled}
                placeholder="4805 Arborlawn Dr, Fort Worth"
                onBlur={e => { if (e.target.value !== (c.address ?? '')) patchCong(c.id, { address: e.target.value || undefined }) }}
                className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Note (optional)</span>
            <input
              type="text"
              defaultValue={c.note ?? ''}
              disabled={disabled}
              placeholder="Future campus: 1805 FM 156, Haslet"
              onBlur={e => { if (e.target.value !== (c.note ?? '')) patchCong(c.id, { note: e.target.value || undefined }) }}
              className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
          </label>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <CongregationLinksColumn
              title="Left column"
              hint="First column of the persistent nav bar (e.g. Family Life, Community Life)."
              links={c.links_left ?? []}
              disabled={disabled}
              onChange={next => patchCong(c.id, { links_left: next.length > 0 ? next : undefined })}
            />
            <CongregationLinksColumn
              title="Right column"
              hint="Second column (e.g. Next Steps, Resources, Events shared)."
              links={c.links_right ?? []}
              disabled={disabled}
              onChange={next => patchCong(c.id, { links_right: next.length > 0 ? next : undefined })}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={addCong}
        className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
      >+ Add congregation</button>
    </div>
  )
}

// One column of congregation links. Each link has label + optional
// is_dropdown flag + optional kids (comma-separated child labels for
// the expanded ddpanel) + optional is_shared flag (renders `↗ shared`
// in the persistent nav bar).
type CongLink = NonNullable<NonNullable<SitemapReview['presentation']>['congregations']>[number]['links_left'] extends (infer T)[] | undefined ? T : never
function CongregationLinksColumn({
  title, hint, links, disabled, onChange,
}: {
  title:    string
  hint:     string
  links:    CongLink[]
  disabled: boolean
  onChange: (next: CongLink[]) => void
}) {
  const patch = (idx: number, p: Partial<CongLink>) => {
    onChange(links.map((l, i) => i === idx ? { ...l, ...p } : l))
  }
  const add    = () => onChange([...links, { label: '' }])
  const remove = (idx: number) => onChange(links.filter((_, i) => i !== idx))
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle">{title}</p>
      <p className="text-[10.5px] text-wm-text-subtle mb-1.5">{hint}</p>
      <div className="space-y-1.5">
        {links.map((l, i) => (
          <div key={i} className="rounded bg-wm-bg-elevated border border-wm-border px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                defaultValue={l.label}
                disabled={disabled}
                placeholder="Link label"
                onBlur={e => { if (e.target.value !== l.label) patch(i, { label: e.target.value }) }}
                className="flex-1 min-w-0 text-[12px] font-semibold text-wm-text bg-transparent focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(i)}
                className="text-[10.5px] text-wm-text-subtle hover:text-red-600 disabled:opacity-50"
              >×</button>
            </div>
            <div className="flex items-center gap-3 text-[10.5px] text-wm-text-muted mt-1 flex-wrap">
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!l.is_dropdown}
                  disabled={disabled}
                  onChange={e => patch(i, { is_dropdown: e.target.checked || undefined })}
                />
                dropdown
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!l.is_shared}
                  disabled={disabled}
                  onChange={e => patch(i, { is_shared: e.target.checked || undefined })}
                />
                shared (↗)
              </label>
            </div>
            {l.is_dropdown && (
              <input
                type="text"
                defaultValue={l.kids ?? ''}
                disabled={disabled}
                placeholder="Kids · Youth (comma-separated child labels)"
                onBlur={e => { if (e.target.value !== (l.kids ?? '')) patch(i, { kids: e.target.value || undefined }) }}
                className="mt-1 w-full text-[11.5px] text-wm-text bg-white border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
              />
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={add}
        className="mt-1 text-[10.5px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
      >+ Add link</button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// FeaturedHighlightEditor. Edits presentation.featured_highlight,
// which drives the Kingdom Come card in the About Doxology mega.
// ─────────────────────────────────────────────────────────────────

function FeaturedHighlightEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const fh = review.presentation?.featured_highlight
  const patch = (next: NonNullable<SitemapReview['presentation']>['featured_highlight'] | undefined) => {
    void onChange({
      ...review,
      presentation: { ...(review.presentation ?? {}), featured_highlight: next },
    })
  }
  const setField = (k: string, v: string) => {
    const current = fh ?? { label: '', description: '' }
    patch({ ...current, [k]: v || undefined } as typeof fh)
  }
  const clear = () => {
    if (!confirm('Clear the featured highlight? The tile disappears from the About mega.')) return
    patch(undefined)
  }

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-wm-text-muted">
        Rendered as a boxed card inside the About mega panel. Leave blank to hide the tile entirely.
      </p>
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Label</span>
        <input
          type="text"
          defaultValue={fh?.label ?? ''}
          disabled={disabled}
          placeholder="Kingdom Come"
          onBlur={e => { if (e.target.value !== (fh?.label ?? '')) setField('label', e.target.value) }}
          className="mt-1 w-full text-[13px] font-semibold text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Description</span>
        <textarea
          defaultValue={fh?.description ?? ''}
          disabled={disabled}
          rows={3}
          placeholder="A featured highlight that links to its own site, and the spot can feature your next initiative down the road."
          onBlur={e => { if (e.target.value !== (fh?.description ?? '')) setField('description', e.target.value) }}
          className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50 resize-y"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Link URL (optional)</span>
          <input
            type="text"
            defaultValue={fh?.url ?? ''}
            disabled={disabled}
            placeholder="https://…"
            onBlur={e => { if (e.target.value !== (fh?.url ?? '')) setField('url', e.target.value) }}
            className="mt-1 w-full text-[12px] font-mono text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Primary CTA label</span>
          <input
            type="text"
            defaultValue={fh?.cta_label ?? ''}
            disabled={disabled}
            placeholder="Learn more"
            onBlur={e => { if (e.target.value !== (fh?.cta_label ?? '')) setField('cta_label', e.target.value) }}
            className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Secondary CTA label (optional)</span>
        <input
          type="text"
          defaultValue={fh?.secondary_cta_label ?? ''}
          disabled={disabled}
          placeholder="Give"
          onBlur={e => { if (e.target.value !== (fh?.secondary_cta_label ?? '')) setField('secondary_cta_label', e.target.value) }}
          className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
        />
      </label>
      {fh && (
        <button
          type="button"
          disabled={disabled}
          onClick={clear}
          className="text-[11px] text-wm-text-muted hover:text-red-600 disabled:opacity-50"
        >Clear featured highlight</button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// TiersEditor. Edit each tier's letter/title/meta so strategist can
// rename the section headings that appear in the Full Page List
// without touching the Presentation JSON. Page assignments still
// live in the JSON block; a rich per-page tier assignment editor is
// a follow-up.
// ─────────────────────────────────────────────────────────────────

function TiersEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const tiers = review.presentation?.tiers ?? []
  const patchTier = (id: string, patch: Partial<NonNullable<typeof tiers>[number]>) => {
    const next = (tiers ?? []).map(t => t.id === id ? { ...t, ...patch } : t)
    void onChange({ ...review, presentation: { ...(review.presentation ?? {}), tiers: next } })
  }
  if (tiers.length === 0) {
    return <p className="text-[11.5px] text-wm-text-subtle italic">No tiers yet. Author them via the Presentation JSON below; the letter/title/meta editors show up once tiers exist.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-wm-text-muted">Edit the tier headings shown in the Full Page List (A. About Doxology, B. For everyone, etc.).</p>
      {tiers.map(t => (
        <div key={t.id} className="rounded border border-wm-border bg-white px-3 py-2.5 grid grid-cols-[48px_1fr_1fr] gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Letter</span>
            <input
              type="text"
              defaultValue={t.letter ?? ''}
              disabled={disabled}
              maxLength={2}
              onBlur={e => { if (e.target.value !== (t.letter ?? '')) patchTier(t.id, { letter: e.target.value || undefined }) }}
              className="mt-1 w-full text-[13px] font-semibold text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 text-center focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Title</span>
            <input
              type="text"
              defaultValue={t.title}
              disabled={disabled}
              onBlur={e => { if (e.target.value !== t.title) patchTier(t.id, { title: e.target.value }) }}
              className="mt-1 w-full text-[13px] font-semibold text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Meta (sub-label)</span>
            <input
              type="text"
              defaultValue={t.meta ?? ''}
              disabled={disabled}
              placeholder="The whole church"
              onBlur={e => { if (e.target.value !== (t.meta ?? '')) patchTier(t.id, { meta: e.target.value || undefined }) }}
              className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
          </label>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// HeroEmPhraseEditor. Trivial single-input for
// presentation.hero_em_phrase (the italic emphasis phrase in the
// hero body).
// ─────────────────────────────────────────────────────────────────

function HeroEmPhraseEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const value = review.presentation?.hero_em_phrase ?? ''
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Emphasis phrase</span>
      <input
        type="text"
        defaultValue={value}
        disabled={disabled}
        placeholder="three congregations"
        onBlur={e => {
          if (e.target.value !== value) {
            void onChange({
              ...review,
              presentation: { ...(review.presentation ?? {}), hero_em_phrase: e.target.value || undefined },
            })
          }
        }}
        className="mt-1 w-full text-[13px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />
      <p className="text-[10.5px] text-wm-text-subtle mt-1">Rendered in serif italic inside the hero subline. Must be a substring of the hero body copy.</p>
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────
// WhatsChangingCardsEditor. Structured editor for
// presentation.whats_changing_cards. Each card carries a tag
// (kept/unified/consolidated/new), a title, and a body.
// ─────────────────────────────────────────────────────────────────

function WhatsChangingCardsEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  disabled: boolean
}) {
  const cards = review.presentation?.whats_changing_cards ?? []
  const update = (next: NonNullable<SitemapReview['presentation']>['whats_changing_cards']) => {
    void onChange({
      ...review,
      presentation: { ...(review.presentation ?? {}), whats_changing_cards: next },
    })
  }
  const patch = (id: string, p: Partial<NonNullable<typeof cards>[number]>) => {
    update((cards ?? []).map(c => c.id === id ? { ...c, ...p } : c))
  }
  const add = () => update([...(cards ?? []), { id: cryptoRandomIdLocal(), tag: 'kept', title: '', body: '' }])
  const remove = (id: string) => update((cards ?? []).filter(c => c.id !== id))

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-wm-text-muted">
        Cards shown in the What&apos;s changing from your current site section. Each card gets a color-coded pill. When empty, the partner view shows two warm defaults.
      </p>
      {(cards ?? []).map(c => (
        <div key={c.id} className="rounded border border-wm-border bg-white px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              defaultValue={c.tag ?? 'kept'}
              disabled={disabled}
              onChange={e => patch(c.id, { tag: e.target.value as NonNullable<typeof cards>[number]['tag'] })}
              className="text-[11px] rounded-full border border-wm-border bg-white px-2 py-0.5 font-semibold text-wm-text focus:outline-none focus:border-wm-accent disabled:opacity-50"
            >
              <option value="kept">have today</option>
              <option value="unified">now shared</option>
              <option value="consolidated">combined</option>
              <option value="new">new</option>
            </select>
            <input
              type="text"
              defaultValue={c.title}
              disabled={disabled}
              placeholder="Card title (e.g. Kept, just re-homed)"
              onBlur={e => { if (e.target.value !== c.title) patch(c.id, { title: e.target.value }) }}
              className="flex-1 min-w-[160px] text-[13px] font-semibold text-wm-text bg-transparent border-b border-transparent focus:border-wm-accent focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(c.id)}
              className="text-[10.5px] text-wm-text-subtle hover:text-red-600 disabled:opacity-50"
            >Remove</button>
          </div>
          <textarea
            defaultValue={c.body}
            disabled={disabled}
            rows={2}
            placeholder="One partner-facing sentence describing what changed."
            onBlur={e => { if (e.target.value !== c.body) patch(c.id, { body: e.target.value }) }}
            className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50 resize-y"
          />
        </div>
      ))}
      {(cards ?? []).length === 0 && (
        <p className="text-[11.5px] text-wm-text-subtle italic">No cards yet; the partner view shows generic defaults.</p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={add}
        className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
      >+ Add card</button>
    </div>
  )
}
