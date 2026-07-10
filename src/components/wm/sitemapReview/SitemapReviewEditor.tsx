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
  saveSiteStrategy,
  saveSitemapReview,
  startNextRound,
  type ContentMigration,
  type PersonaPosture,
  type ReviewPageAnnotation,
  type SitemapReview,
  type SiteStrategyBlob,
} from '../../../lib/sitemapReview'
import { buildCoworkPrompt } from '../../../lib/sitemapReviewCoworkPrompt'
import { buildPortalUrl } from '../../../lib/portalUrl'
import { uploadAttachment } from '../../../lib/attachmentUpload'
import { PartnerEditRequestsInbox } from './PartnerEditRequestsInbox'
import SitemapPartnerViewV2 from './SitemapPartnerViewV2'

/** Slugs + names lifted from site_strategy for use by the editor's
 *  page picker widgets (persona key pages, tier descriptions, topnav
 *  item slug, header CTA slug). Kept minimal so the widgets keep
 *  working without dragging the whole site_strategy blob through
 *  every prop chain. */
interface StrategyPageOption { slug: string; name: string; purpose: string }

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
  const [siteStrategy, setSiteStrategy] = useState<SiteStrategyBlob | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Recompose against the latest project state so newer reviews
    // pick up missing defaults (executive_summary, navigation_
    // strategy, footer_info, seeded why_cards) without wiping
    // anything the strategist authored.
    const [existing, { data: proj }] = await Promise.all([
      loadSitemapReview(supabase, projectId),
      supabase.from('strategy_web_projects')
        .select([
          'id, church_name, personas, nav_group_definitions, roadmap_state',
          'address, city_state, phone, email, primary_service_time, all_service_times',
          'social_facebook_url, social_instagram_url, social_youtube_url',
          'social_tiktok_url, social_twitter_url, social_linkedin_url',
        ].join(', '))
        .eq('id', projectId).maybeSingle(),
    ])
    const composed = composeSitemapReview({
      project:      (proj ?? { id: projectId }) as never,
      existing,
    })
    // AUTO-PERSIST on drift the compose introduced. Two triggers left
    // after the site-strategy-is-source-of-truth refactor:
    //   1. Footer link groups just seeded from empty — cowork emitted
    //      grouped nav.footer that compose translated into headed
    //      columns for the first time.
    //   2. Stale persona key_page_slugs got pruned — compose filters
    //      slugs against the current site_strategy pages set.
    // Both are idempotent; stable loads don't write.
    const footerGroupsSeeded =
      ((composed.footer_info?.footer_link_groups?.length ?? 0) > 0) &&
      ((existing?.footer_info?.footer_link_groups?.length ?? 0) === 0)
    const posturesKeyPagesPruned = existing != null && composed.persona_postures.some(next => {
      const prior = existing.persona_postures.find(p => p.persona_id === next.persona_id)
      const priorKeys = prior?.key_page_slugs ?? []
      const nextKeys  = next.key_page_slugs ?? []
      return priorKeys.length !== nextKeys.length
        || priorKeys.some((s, i) => s !== nextKeys[i])
    })
    if (footerGroupsSeeded || posturesKeyPagesPruned) {
      const persistRes = await saveSitemapReview(supabase, projectId, composed)
      setReview(persistRes.ok ? persistRes.review : composed)
    } else {
      setReview(composed)
    }
    // Extract site_strategy from the project row we already fetched;
    // one round trip carries everything the editor needs.
    const rs = ((proj as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state ?? {}) as { site_strategy?: SiteStrategyBlob }
    setSiteStrategy(rs.site_strategy ?? null)
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const persist = useCallback(async (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => {
    // Race-safe write. Every child editor used to compute
    // `{ ...review, X: Y }` from its closed-over `review` prop, then
    // hand the full review to persist. That pattern squashed any
    // write that landed between the child's render and its call —
    // cowork writes, another tab, another editor firing onBlur in
    // parallel. Now the resolved `next` is computed inside a
    // functional setter so it reads the LATEST client state at
    // commit time. Children that pass an updater (r => r') stay
    // race-safe end-to-end.
    setSaving(true)
    setError(null)
    let resolved: SitemapReview | null = null
    setReview(current => {
      if (!current) return current
      resolved = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater
      return resolved
    })
    // `resolved` is guaranteed set here because setReview ran the
    // updater synchronously above. TS can't see that, so we assert.
    if (!resolved) { setSaving(false); return }
    const res = await saveSitemapReview(supabase, projectId, resolved as SitemapReview)
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setReview(res.review)
    if (onChange) await onChange()
  }, [projectId, onChange])

  // Publish path — recomposes so any seeded defaults land, then
  // marks the review published. Post-refactor there's no drift to
  // worry about (site_strategy is the live source; the partner view
  // reads pages/nav from it directly), so this is a plain compose +
  // save round-trip.
  const publishWithResync = useCallback(async () => {
    if (!review) return
    setSaving(true)
    setError(null)
    try {
      const { data: proj } = await supabase.from('strategy_web_projects')
        .select([
          'id, church_name, personas, nav_group_definitions, roadmap_state',
          'address, city_state, phone, email, primary_service_time, all_service_times',
          'social_facebook_url, social_instagram_url, social_youtube_url',
          'social_tiktok_url, social_twitter_url, social_linkedin_url',
        ].join(', '))
        .eq('id', projectId).maybeSingle()
      const fresh = composeSitemapReview({
        project:  (proj ?? { id: projectId }) as never,
        existing: review,
      })
      const published = publishReview(fresh)
      const res = await saveSitemapReview(supabase, projectId, published)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setReview(res.review)
      const rs = ((proj as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state ?? {}) as { site_strategy?: SiteStrategyBlob }
      setSiteStrategy(rs.site_strategy ?? null)
      if (onChange) await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [projectId, review, onChange])

  // Save a JSON-edited site_strategy blob. Delegates to
  // saveSiteStrategy which validates + bumps _meta.generated_at.
  const persistSiteStrategy = useCallback(async (parsed: SiteStrategyBlob): Promise<{ ok: true } | { ok: false; error: string }> => {
    setSaving(true)
    setError(null)
    const res = await saveSiteStrategy(supabase, projectId, parsed)
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return { ok: false, error: res.error }
    }
    setSiteStrategy(res.strategy)
    if (onChange) await onChange()
    return { ok: true }
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

  // Slug + name option list for the editor's page pickers (persona
  // key pages, tier descriptions, topnav slug, header CTA slug).
  // Derived from site_strategy, filtered to real destinations (drops
  // rows the strategist has flagged as nav-parent-only in the
  // review's page_annotations).
  const strategyPageOptions: StrategyPageOption[] = (siteStrategy?.pages ?? [])
    .filter(p => typeof p.slug === 'string' && p.slug && p.slug !== '_meta')
    .filter(p => review.page_annotations?.[p.slug as string]?.is_nav_parent_only !== true)
    .map(p => ({
      slug:    p.slug as string,
      name:    p.name ?? (p.slug as string),
      purpose: p.purpose ?? '',
    }))

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
            <h2 className="text-[16px] font-bold text-wm-text">
              Content Strategy Review
              {(review.round_number ?? 1) > 1 && (
                <span className="ml-2 text-[10.5px] uppercase tracking-widest font-bold text-wm-accent-strong bg-wm-accent/10 border border-wm-accent/30 rounded-full px-2 py-0.5 align-middle">
                  Round {review.round_number}
                </span>
              )}
            </h2>
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
            <button
              type="button"
              disabled={saving || isApproved}
              onClick={() => void load()}
              className="text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-accent-strong disabled:opacity-40"
              title="Reload site_strategy + review from the database. Use after a cowork sitemap run or a JSON edit."
            >
              ↻ Reload
            </button>
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

        {/* Action bar — always visible below the header so the strategist
            never has to scroll to find Publish / Approve / Start next round
            / Retract. Same buttons the footer used to carry, moved up and
            made outside the scrollable body so they stay in view on long
            reviews. */}
        <ReviewActionBar
          review={review}
          saving={saving}
          error={error}
          shareUrl={shareUrl}
          siteStrategy={siteStrategy}
          publishWithResync={publishWithResync}
          persist={persist}
        />

        {/* Body */}
        {viewMode === 'edit' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            <PartnerOverallNoteView review={review} />
            {(review.round_number ?? 1) > 1 && (
              <RoundChangeSummaryEditor review={review} onChange={persist} disabled={isApproved} />
            )}
            {(review.round_history?.length ?? 0) > 0 && (
              <PreviousRoundsPanel review={review} />
            )}
            <PartnerEditRequestsInbox review={review} onChange={persist} disabled={isApproved} />
            <CoworkPromptPanel review={review} projectId={projectId} churchName={churchName ?? null} />

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
              <NavEditor
                siteStrategy={siteStrategy}
                onSaveSiteStrategy={persistSiteStrategy}
                disabled={isApproved}
              />
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Announcement banner (above nav)</p>
                <AnnouncementBannerEditor review={review} onChange={persist} disabled={isApproved} />
              </div>
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
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Pages (annotations)</p>
                <PagesEditor
                  review={review}
                  siteStrategy={siteStrategy}
                  onChange={persist}
                  onSaveSiteStrategy={persistSiteStrategy}
                  disabled={isApproved}
                />
              </div>
            </SectionBand>

            <SectionBand num="04b" label="Inspiration image (optional)">
              <InspirationImageEditor
                review={review}
                projectId={projectId}
                onChange={persist}
                disabled={isApproved}
              />
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
              <PersonaPosturesEditor
                review={review}
                strategyPages={strategyPageOptions}
                onChange={persist}
                disabled={isApproved}
              />
            </SectionBand>

            <SectionBand num="Cowork" label="Presentation layer (authored by cowork sessions)">
              <PresentationEditor review={review} onChange={persist} disabled={isApproved} />
            </SectionBand>

            <SectionBand num="JSON" label="Edit site_strategy JSON (pages, nav, cowork blob)">
              <SiteStrategyJsonEditor
                siteStrategy={siteStrategy}
                onSave={persistSiteStrategy}
                disabled={isApproved}
              />
            </SectionBand>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SitemapPartnerViewV2
              review={review}
              siteStrategy={siteStrategy}
              churchName={churchName}
              readOnly
            />
          </div>
        )}

        {/* Footer — kept for saving/error status only. All action
            buttons moved to the ReviewActionBar directly under the
            header so the strategist doesn't have to scroll to find
            them on long reviews. */}
        <div className="border-t border-wm-border px-5 py-2 flex items-center gap-2 flex-wrap text-[11px] text-wm-text-muted">
          {saving && <span className="text-wm-text-subtle">Saving…</span>}
          {isApproved && (
            <>
              <span>This review is the canonical sitemap. Downstream tools read from here.</span>
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
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
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
              const v = e.target.value
              void onChange((current: SitemapReview) => ({
                ...current,
                intro: { ...(current.intro ?? { headline: '', body: '' }), headline: v },
              }))
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
              const v = e.target.value
              void onChange((current: SitemapReview) => ({
                ...current,
                intro: { ...(current.intro ?? { headline: '', body: '' }), body: v },
              }))
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
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
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
          const v = e.target.value
          void onChange((current: SitemapReview) => ({ ...current, executive_summary: v }))
        }}
        className="w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50 leading-relaxed"
      />
    </Section>
  )
}

function NavigationStrategyEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
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
          const v = e.target.value
          void onChange((current: SitemapReview) => ({ ...current, navigation_strategy: v }))
        }}
        className="w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50 leading-relaxed"
      />
    </Section>
  )
}

function FooterInfoEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const footer = review.footer_info ?? {}
  const update = (patch: Partial<NonNullable<SitemapReview['footer_info']>>) => {
    // Race-safe: derive footer from current state at commit time so
    // sibling edits (a parallel social_link save, another editor's
    // footer_link_groups write) don't get clobbered by this patch.
    void onChange((current: SitemapReview) => ({
      ...current,
      footer_info: { ...(current.footer_info ?? {}), ...patch },
    }))
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
        <FooterField label="Service times"  value={footer.service_times}  disabled={disabled} onSave={v => update({ service_times: v })} />
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

      <div className="mt-5 pt-3 border-t border-wm-border">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Footer link groups</p>
        <p className="text-[10.5px] text-wm-text-subtle mb-2">Multi-column footer layout with headings (Visiting / Take a next step / Get to know us / etc). When any group has links, this replaces the single Explore column above.</p>
        <ul className="space-y-3">
          {(footer.footer_link_groups ?? []).map((group, gIdx) => {
            const updateGroup = (patch: Partial<typeof group>) => {
              const next = [...(footer.footer_link_groups ?? [])]
              next[gIdx] = { ...group, ...patch }
              update({ footer_link_groups: next })
            }
            return (
              <li key={group.id} className="rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    defaultValue={group.heading}
                    placeholder="Column heading (e.g. Visiting)"
                    disabled={disabled}
                    onBlur={e => {
                      if (e.target.value === group.heading) return
                      updateGroup({ heading: e.target.value })
                    }}
                    className="flex-1 text-[12.5px] font-semibold text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                  />
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = (footer.footer_link_groups ?? []).filter((_, i) => i !== gIdx)
                        update({ footer_link_groups: next })
                      }}
                      className="text-wm-text-subtle hover:text-wm-danger text-[11px] font-semibold px-1"
                    >remove column</button>
                  )}
                </div>
                <ul className="space-y-1">
                  {(group.links ?? []).map((link, lIdx) => (
                    <li key={lIdx} className="flex items-center gap-2 text-[12px]">
                      <input
                        type="text"
                        defaultValue={link.label}
                        placeholder="Label"
                        disabled={disabled}
                        onBlur={e => {
                          if (e.target.value === link.label) return
                          const nextLinks = [...(group.links ?? [])]
                          nextLinks[lIdx] = { ...link, label: e.target.value }
                          updateGroup({ links: nextLinks })
                        }}
                        className="w-40 text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                      />
                      <input
                        type="text"
                        defaultValue={link.url ?? ''}
                        placeholder="/path or https://…"
                        disabled={disabled}
                        onBlur={e => {
                          if (e.target.value === (link.url ?? '')) return
                          const nextLinks = [...(group.links ?? [])]
                          nextLinks[lIdx] = { ...link, url: e.target.value || null }
                          updateGroup({ links: nextLinks })
                        }}
                        className="flex-1 text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                      />
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextLinks = (group.links ?? []).filter((_, i) => i !== lIdx)
                            updateGroup({ links: nextLinks })
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
                    onClick={() => updateGroup({ links: [...(group.links ?? []), { label: '', url: '' }] })}
                    className="mt-1 text-[11px] font-semibold text-wm-accent-strong hover:underline"
                  >
                    + Add link to this column
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {!disabled && (
          <button
            type="button"
            onClick={() => update({
              footer_link_groups: [
                ...(footer.footer_link_groups ?? []),
                { id: `grp-${(footer.footer_link_groups ?? []).length + 1}-${Math.random().toString(36).slice(2, 8)}`, heading: '', links: [] },
              ],
            })}
            className="mt-2 text-[11px] font-semibold text-wm-accent-strong hover:underline"
          >
            + Add footer column
          </button>
        )}
      </div>
    </Section>
  )
}

function AnnouncementBannerEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const pres = review.presentation ?? {}
  const banner = pres.announcement_banner
  const hasBanner = !!banner && banner.text.trim().length > 0
  // Race-safe writes. Reading `current.presentation` inside the
  // functional updater guarantees this editor's sub-field change
  // (announcement_banner only) doesn't clobber sibling sub-fields
  // (why_cards, tiers, congregations, etc.) that another editor or
  // a cowork write may have updated between renders.
  const updateBanner = (patch: Partial<NonNullable<typeof banner>> | null) => {
    if (patch === null) {
      void onChange((current: SitemapReview) => {
        const nextPres = { ...(current.presentation ?? {}) }
        delete nextPres.announcement_banner
        return { ...current, presentation: nextPres }
      })
      return
    }
    void onChange((current: SitemapReview) => {
      const currentBanner = current.presentation?.announcement_banner
      return {
        ...current,
        presentation: {
          ...(current.presentation ?? {}),
          announcement_banner: {
            text: '',
            ...currentBanner,
            ...patch,
          },
        },
      }
    })
  }
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated px-3 py-2.5">
      <p className="text-[10.5px] text-wm-text-subtle mb-2">A thin strip above the primary nav. Use for seasonal callouts (camp registration, Christmas services, giving campaigns). Leave blank to hide.</p>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_auto] gap-2 items-start">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Banner text</span>
          <input
            type="text"
            defaultValue={banner?.text ?? ''}
            placeholder="WinShape Camps, summer day camp for kids, register now"
            disabled={disabled}
            onBlur={e => {
              const v = e.target.value.trim()
              if (v === (banner?.text ?? '')) return
              if (!v) { updateBanner(null); return }
              updateBanner({ text: v })
            }}
            className="mt-1 w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">CTA label (optional)</span>
          <input
            type="text"
            defaultValue={banner?.cta_label ?? ''}
            placeholder="Register"
            disabled={disabled || !hasBanner}
            onBlur={e => {
              const v = e.target.value.trim()
              if (v === (banner?.cta_label ?? '')) return
              updateBanner({ cta_label: v || null })
            }}
            className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">CTA link</span>
          <input
            type="text"
            defaultValue={banner?.cta_url ?? ''}
            placeholder="/camp or https://…"
            disabled={disabled || !hasBanner}
            onBlur={e => {
              const v = e.target.value.trim()
              if (v === (banner?.cta_url ?? '')) return
              updateBanner({ cta_url: v || null })
            }}
            className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Tone</span>
          <select
            value={banner?.tone ?? 'info'}
            disabled={disabled || !hasBanner}
            onChange={e => updateBanner({ tone: e.target.value as 'warning' | 'info' | 'neutral' })}
            className="mt-1 w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          >
            <option value="info">Info (purple)</option>
            <option value="warning">Warning (amber)</option>
            <option value="neutral">Neutral (gray)</option>
          </select>
        </label>
      </div>
      {hasBanner && !disabled && (
        <button
          type="button"
          onClick={() => updateBanner(null)}
          className="mt-2 text-[11px] font-semibold text-wm-text-subtle hover:text-wm-danger"
        >Remove banner</button>
      )}
    </div>
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
  review, siteStrategy, onChange, onSaveSiteStrategy, disabled,
}: {
  review:             SitemapReview
  siteStrategy:       SiteStrategyBlob | null
  onChange:           (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  onSaveSiteStrategy: (updated: SiteStrategyBlob) => Promise<{ ok: true } | { ok: false; error: string }>
  disabled:           boolean
}) {
  const annotations = review.page_annotations ?? {}

  // Ordered list from site_strategy.pages (source of truth). We keep
  // the array order because reorder up/down mutates positional order
  // in site_strategy.pages directly. Annotation-only orphans (a slug
  // that used to exist and still has an annotation entry) get
  // appended at the end so the strategist can see + clean them up.
  const strategyPagesOrdered = (siteStrategy?.pages ?? [])
    .filter(p => typeof p.slug === 'string' && p.slug && p.slug !== '_meta')

  const orphanSlugs = Object.keys(annotations).filter(
    s => !strategyPagesOrdered.some(p => p.slug === s),
  )

  const [addOpen,   setAddOpen]   = useState(false)
  const [addSlug,   setAddSlug]   = useState('')
  const [addName,   setAddName]   = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError,  setAddError]  = useState<string | null>(null)

  const updateAnnotation = (slug: string, patch: Partial<ReviewPageAnnotation>) => {
    void onChange((current: SitemapReview) => {
      const curAnns = current.page_annotations ?? {}
      const prior = curAnns[slug] ?? {}
      const next: ReviewPageAnnotation = { ...prior, ...patch }
      if (next.what_changed && !next.what_changed.trim()) delete next.what_changed
      if (next.why_change && !next.why_change.trim()) delete next.why_change
      if (next.strategic_alignment && !next.strategic_alignment.trim()) delete next.strategic_alignment
      if (next.is_nav_parent_only === false) delete next.is_nav_parent_only
      if (next.sitemap_tag === undefined) delete next.sitemap_tag
      const nextMap = { ...curAnns, [slug]: next }
      if (Object.keys(next).length === 0) delete nextMap[slug]
      return { ...current, page_annotations: nextMap }
    })
  }

  // Walks review.presentation.tiers[].page_entries[] to locate the
  // entry with a matching slug and update its description_override.
  // Merged in from the retired TierPageDescriptionsEditor — same
  // logic, per-page-row placement.
  const updateDescriptionOverride = (slug: string, override: string) => {
    void onChange((current: SitemapReview) => {
      const curTiers = current.presentation?.tiers ?? []
      const nextTiers = curTiers.map(t => ({
        ...t,
        page_entries: (t.page_entries ?? []).map(e =>
          e.slug !== slug ? e : { ...e, description_override: override.trim() || undefined },
        ),
      }))
      return {
        ...current,
        presentation: { ...(current.presentation ?? {}), tiers: nextTiers },
      }
    })
  }

  // Look up the current description_override across all tiers for
  // this slug. First non-undefined wins (a slug typically only lives
  // in one tier row).
  const findDescriptionOverride = (slug: string): string => {
    const tiers = review.presentation?.tiers ?? []
    for (const t of tiers) {
      for (const e of t.page_entries ?? []) {
        if (e.slug === slug && typeof e.description_override === 'string') return e.description_override
      }
    }
    return ''
  }

  const renamePage = async (slug: string, nextName: string) => {
    const trimmed = nextName.trim()
    if (!trimmed || !siteStrategy) return
    const currentPages = siteStrategy.pages ?? []
    const idx = currentPages.findIndex(p => p.slug === slug)
    if (idx < 0) return
    if ((currentPages[idx].name ?? '') === trimmed) return
    const nextPages = [...currentPages]
    nextPages[idx] = { ...nextPages[idx], name: trimmed }
    await onSaveSiteStrategy({ ...siteStrategy, pages: nextPages })
  }

  const removePage = async (slug: string) => {
    if (!siteStrategy) return
    const pg = (siteStrategy.pages ?? []).find(p => p.slug === slug)
    const label = pg?.name ?? slug
    if (!confirm(`Remove "${label}" from the sitemap? This drops it from site_strategy.pages and clears any review annotation. Nav references to this page are NOT auto-purged — check nav after saving.`)) return
    const nextPages = (siteStrategy.pages ?? []).filter(p => p.slug !== slug)
    const res = await onSaveSiteStrategy({ ...siteStrategy, pages: nextPages })
    if (!res.ok) return
    // Clean up any annotation for the removed slug so the row doesn't
    // reappear as an orphan.
    if (annotations[slug]) {
      void onChange((current: SitemapReview) => {
        const curAnns = { ...(current.page_annotations ?? {}) }
        delete curAnns[slug]
        return { ...current, page_annotations: curAnns }
      })
    }
  }

  const removeOrphanAnnotation = (slug: string) => {
    if (!confirm(`Clear the leftover annotation for "${slug}"? The page isn't in site_strategy.pages, so this row is purely dead data.`)) return
    void onChange((current: SitemapReview) => {
      const curAnns = { ...(current.page_annotations ?? {}) }
      delete curAnns[slug]
      return { ...current, page_annotations: curAnns }
    })
  }

  const movePage = async (slug: string, direction: -1 | 1) => {
    if (!siteStrategy) return
    const currentPages = [...(siteStrategy.pages ?? [])]
    const idx = currentPages.findIndex(p => p.slug === slug)
    if (idx < 0) return
    const target = idx + direction
    if (target < 0 || target >= currentPages.length) return
    const swapped = currentPages[idx]
    currentPages[idx] = currentPages[target]
    currentPages[target] = swapped
    await onSaveSiteStrategy({ ...siteStrategy, pages: currentPages })
  }

  const addPage = async () => {
    setAddError(null)
    const slug = addSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    const name = addName.trim()
    if (!slug) { setAddError('Slug is required (letters, numbers, hyphens).'); return }
    if (!name) { setAddError('Label is required.'); return }
    const currentPages = siteStrategy?.pages ?? []
    if (currentPages.some(p => p.slug === slug)) {
      setAddError(`A page with slug "${slug}" already exists.`); return
    }
    setAddSaving(true)
    const next: SiteStrategyBlob = {
      ...(siteStrategy ?? {}),
      pages: [...currentPages, { slug, name }],
    }
    const res = await onSaveSiteStrategy(next)
    setAddSaving(false)
    if (!res.ok) { setAddError(res.error); return }
    setAddSlug(''); setAddName(''); setAddOpen(false)
  }

  const totalCount = strategyPagesOrdered.length + orphanSlugs.length

  const renderRow = (
    slug: string,
    strategyPg: { slug: string; name?: string; purpose?: string } | undefined,
    idx: number | null,
  ) => {
    const ann = annotations[slug] ?? {}
    const name = strategyPg?.name ?? slug
    const purpose = strategyPg?.purpose ?? ''
    const isOrphan = !strategyPg
    const canMoveUp = idx !== null && idx > 0
    const canMoveDown = idx !== null && idx < strategyPagesOrdered.length - 1
    return (
      <li key={slug} className="border border-wm-border rounded p-2.5 bg-wm-bg">
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          {!isOrphan && (
            <div className="flex items-center gap-0.5" role="group" aria-label="Reorder">
              <button
                type="button"
                onClick={() => void movePage(slug, -1)}
                disabled={disabled || !canMoveUp}
                title="Move up"
                className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1 py-0.5"
              >↑</button>
              <button
                type="button"
                onClick={() => void movePage(slug, 1)}
                disabled={disabled || !canMoveDown}
                title="Move down"
                className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1 py-0.5"
              >↓</button>
            </div>
          )}
          {!isOrphan ? (
            <input
              type="text"
              defaultValue={name}
              disabled={disabled}
              onBlur={e => { void renamePage(slug, e.target.value) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="text-[13px] font-semibold text-wm-text bg-transparent border-b border-transparent hover:border-wm-border focus:border-wm-accent focus:outline-none px-0.5 min-w-[10rem]"
              title="Edit page label. Saves to site_strategy on blur."
            />
          ) : (
            <span className="text-[13px] font-semibold text-wm-text">{name}</span>
          )}
          <code className="text-[11px] font-mono text-wm-text-muted">/{slug}</code>
          {isOrphan && (
            <span className="text-[10px] uppercase tracking-widest font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
              Not in site_strategy
            </span>
          )}
          <button
            type="button"
            onClick={() => isOrphan ? removeOrphanAnnotation(slug) : void removePage(slug)}
            disabled={disabled}
            className="ml-auto text-[11px] font-semibold text-wm-text-muted hover:text-red-600 disabled:opacity-40"
            title={isOrphan ? 'Clear this stale annotation' : 'Remove this page from site_strategy'}
          >Remove</button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <label className="flex items-center gap-1.5 text-[10px] text-wm-text-muted">
            <span className="uppercase tracking-wider font-semibold">Role</span>
            <select
              value={
                ann.sitemap_tag === 'hub' || ann.sitemap_tag === 'ministry'
                  || ann.sitemap_tag === 'churchwide' || ann.sitemap_tag === 'foundation'
                  ? ann.sitemap_tag
                  : ''
              }
              disabled={disabled}
              onChange={e => updateAnnotation(slug, {
                sitemap_tag: e.target.value === ''
                  ? undefined
                  : (e.target.value as ReviewPageAnnotation['sitemap_tag']),
              })}
              className="text-[11px] rounded-full border border-wm-border bg-white px-2 py-0.5 font-semibold text-wm-text focus:outline-none focus:border-wm-accent disabled:opacity-50"
            >
              <option value="">unset</option>
              <option value="hub">hub</option>
              <option value="ministry">ministry</option>
              <option value="churchwide">church-wide</option>
              <option value="foundation">foundation</option>
            </select>
          </label>
        </div>
        <label
          className="flex items-center gap-1.5 text-[11px] text-wm-text-muted mb-1"
          title="Check when this row is only a dropdown label in the nav (e.g. 'Teaching' opens Messages / Blog / Podcast) and not a real destination page. Hidden from Full Page List; skipped by web_pages creation; no copy is written for it."
        >
          <input
            type="checkbox"
            checked={ann.is_nav_parent_only === true}
            disabled={disabled}
            onChange={e => updateAnnotation(slug, { is_nav_parent_only: e.target.checked || undefined })}
          />
          <span>
            Nav dropdown label only <span className="text-wm-text-subtle">— not a real page</span>
          </span>
        </label>
        {purpose && (
          <p className="text-[11.5px] text-wm-text-muted italic mt-1 mb-2 leading-snug">
            Purpose (from site_strategy): {purpose}
          </p>
        )}
        <label className="block mt-2">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">What changed</span>
          <textarea
            key={`what-changed-${slug}`}
            defaultValue={ann.what_changed ?? ''}
            placeholder="Optional. Partner-facing note about what changed for this page vs their current site."
            disabled={disabled}
            rows={2}
            onBlur={e => { if (e.target.value !== (ann.what_changed ?? '')) updateAnnotation(slug, { what_changed: e.target.value.trim() || undefined }) }}
            className="mt-1 w-full text-[11.5px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
        <label className="block mt-2">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Description override (partner-facing tier list)
          </span>
          <textarea
            key={`desc-override-${slug}`}
            defaultValue={findDescriptionOverride(slug)}
            placeholder={purpose || 'Optional. Overrides the one-line description under this page in the partner-facing tier list. Blank falls back to the purpose above.'}
            disabled={disabled}
            rows={1}
            onBlur={e => { if (e.target.value !== findDescriptionOverride(slug)) updateDescriptionOverride(slug, e.target.value) }}
            className="mt-1 w-full text-[11.5px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </label>
      </li>
    )
  }

  return (
    <Section title="Pages" subtitle={`${totalCount} pages · rename inline, reorder with ↑↓, remove with the Remove button, add with the + button below.`}>
      {/* Add-page control kept near the TOP of the list so the strategist
          doesn't have to scroll to the end of a 20-page site to find it. */}
      <div className="mb-3">
        {!addOpen ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAddOpen(true)}
            className="text-[12px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
          >+ Add page</button>
        ) : (
          <div className="border border-wm-border rounded p-2.5 bg-wm-bg-elevated space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-wm-text-muted flex items-center gap-1.5">
                <span className="uppercase tracking-wider font-semibold">Slug</span>
                <input
                  type="text"
                  value={addSlug}
                  onChange={e => setAddSlug(e.target.value)}
                  placeholder="volunteer"
                  disabled={addSaving || disabled}
                  className="text-[12px] font-mono border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent"
                />
              </label>
              <label className="text-[11px] text-wm-text-muted flex items-center gap-1.5">
                <span className="uppercase tracking-wider font-semibold">Label</span>
                <input
                  type="text"
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  placeholder="Volunteer"
                  disabled={addSaving || disabled}
                  className="text-[12px] border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent min-w-[10rem]"
                />
              </label>
            </div>
            {addError && <div className="text-[11px] text-red-600">{addError}</div>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={addSaving || disabled}
                onClick={() => void addPage()}
                className="text-[12px] font-semibold px-3 py-1 rounded-full bg-wm-accent-strong text-white hover:bg-wm-accent disabled:opacity-50"
              >{addSaving ? 'Saving…' : 'Add page'}</button>
              <button
                type="button"
                disabled={addSaving}
                onClick={() => { setAddOpen(false); setAddSlug(''); setAddName(''); setAddError(null) }}
                className="text-[12px] text-wm-text-muted hover:underline disabled:opacity-50"
              >Cancel</button>
            </div>
          </div>
        )}
      </div>
      <ul className="space-y-2">
        {strategyPagesOrdered.map((p, i) => renderRow(p.slug as string, {
          slug: p.slug as string, name: p.name, purpose: p.purpose,
        }, i))}
        {orphanSlugs.map(slug => renderRow(slug, undefined, null))}
      </ul>
    </Section>
  )
}

function PersonaPosturesEditor({
  review, strategyPages, onChange, disabled,
}: {
  review:        SitemapReview
  strategyPages: StrategyPageOption[]
  onChange:      (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled:      boolean
}) {
  const updatePosture = (id: string, patch: Partial<PersonaPosture>) => {
    // Race-safe: map over the latest persona_postures at commit time.
    void onChange((current: SitemapReview) => ({
      ...current,
      persona_postures: current.persona_postures.map(p => p.persona_id === id ? { ...p, ...patch } : p),
    }))
  }
  const toggleKeyPage = (id: string, slug: string) => {
    // Race-safe: read latest key_page_slugs at commit time so a
    // sibling toggle for a different persona doesn't get stomped.
    void onChange((currentReview: SitemapReview) => ({
      ...currentReview,
      persona_postures: currentReview.persona_postures.map(p => {
        if (p.persona_id !== id) return p
        const keys = p.key_page_slugs ?? []
        const has = keys.includes(slug)
        const nextKeys = has ? keys.filter(s => s !== slug) : [...keys, slug].slice(0, 3)
        return { ...p, key_page_slugs: nextKeys }
      }),
    }))
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
          // Only count key page slugs that still exist as real pages
          // — stale references from older strategy states get filtered
          // out so the count matches what the partner actually sees.
          const validKeys = currentKeys.filter(s => strategyPages.some(pg => pg.slug === s))
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
                <p className="text-[10px] text-wm-text-subtle">{validKeys.length}/3 selected</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {strategyPages.map(pg => {
                  const active   = currentKeys.includes(pg.slug)
                  const disable  = disabled || (!active && validKeys.length >= 3)
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
              {/* Selected key page descriptions render read-only from
                * site_strategy.pages[].purpose. To rewrite a purpose,
                * edit it in the site_strategy JSON block below (or run
                * a cowork revise-site-strategy pass). */}
              {validKeys.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {validKeys.map(slug => {
                    const pg = strategyPages.find(x => x.slug === slug)
                    if (!pg) return null
                    return (
                      <li key={slug} className="rounded border border-wm-border bg-wm-bg-elevated px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-wm-text mb-1">{pg.name}</div>
                        <p className="text-[11.5px] text-wm-text-muted italic leading-snug">
                          {pg.purpose || <span className="text-wm-text-subtle">No purpose set on site_strategy for this page.</span>}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
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
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const migrations = review.content_migrations
  const updateMig = (id: string, patch: Partial<ContentMigration>) => {
    // Race-safe: map over the latest content_migrations at commit time.
    void onChange((current: SitemapReview) => ({
      ...current,
      content_migrations: current.content_migrations.map(m => m.id === id ? { ...m, ...patch } : m),
    }))
  }
  const addMig = () => {
    const newMig: ContentMigration = {
      id:          crypto.randomUUID(),
      title:       '',
      merged_from: [],
      merged_to:   '',
      rationale:   '',
    }
    void onChange((current: SitemapReview) => ({
      ...current,
      content_migrations: [...current.content_migrations, newMig],
    }))
  }
  const removeMig = (id: string) => {
    void onChange((current: SitemapReview) => ({
      ...current,
      content_migrations: current.content_migrations.filter(m => m.id !== id),
    }))
  }

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
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
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
      // Race-safe write: read LATEST review inside the parent's
      // functional setter so per-field editors saving in parallel
      // don't stomp this JSON payload with stale local state.
      void onChange((current: SitemapReview) => ({ ...current, presentation: parsed }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.')
    }
  }

  const clear = () => {
    if (!confirm('Clear the entire presentation layer? The partner view falls back to system defaults.')) return
    setText('{}')
    void onChange((current: SitemapReview) => ({ ...current, presentation: undefined }))
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

// ─────────────────────────────────────────────────────────────────
// NavEditor. Structured writer for site_strategy.nav.{primary,
// cta_only, footer}. Replaces the four retired zombie editors that
// used to write to review.nav_presentation (a field the partner
// view now ignores per commit 8814b6d). Every mutation here lands
// in site_strategy — so the partner view, all pickers, and the
// composer preview reflect the change on the next render.
//
// Primary nav: reorderable top-level items, each with an optional
// children array. Children use slug pickers from site_strategy.pages.
//
// CTA-only: separate reorderable list (Visit, Give style pills).
//
// Footer: three named columns (primary_links, explore, legal) each
// reorderable and edit-in-place.
//
// The old NavPresentationEditor / TopnavItemsEditor / HeaderCtasEditor
// wrote to review.nav_presentation, which is now dead data. Existing
// review.nav_presentation blobs stay on rows (no destructive
// migration) but this editor writes to site_strategy so the partner
// view sees changes immediately.
// ─────────────────────────────────────────────────────────────────

type NavChild = { slug?: string; label?: string; children?: NavChild[] }

function siteStrategyNavPrimary(strategy: SiteStrategyBlob | null): NavChild[] {
  const raw = (strategy?.nav?.primary ?? []) as unknown[]
  return raw.map(coerceNavItem).filter(i => (i.label ?? i.slug ?? '').length > 0)
}

function siteStrategyNavCtaOnly(strategy: SiteStrategyBlob | null): NavChild[] {
  const raw = (strategy?.nav?.cta_only ?? []) as unknown[]
  return raw.map(coerceNavItem).filter(i => (i.label ?? i.slug ?? '').length > 0)
}

function coerceNavItem(item: unknown): NavChild {
  if (typeof item === 'string') return { slug: item }
  if (!item || typeof item !== 'object') return {}
  const it = item as { slug?: unknown; label?: unknown; children?: unknown }
  const out: NavChild = {}
  if (typeof it.slug === 'string')  out.slug = it.slug
  if (typeof it.label === 'string') out.label = it.label
  if (Array.isArray(it.children)) {
    out.children = it.children.map(coerceNavItem).filter(c => (c.slug ?? c.label ?? '').length > 0)
  }
  return out
}

function NavEditor({
  siteStrategy, onSaveSiteStrategy, disabled,
}: {
  siteStrategy:       SiteStrategyBlob | null
  onSaveSiteStrategy: (updated: SiteStrategyBlob) => Promise<{ ok: true } | { ok: false; error: string }>
  disabled:           boolean
}) {
  const allPages = (siteStrategy?.pages ?? [])
    .filter(p => typeof p.slug === 'string' && p.slug && p.slug !== '_meta')
    .map(p => ({ slug: p.slug as string, name: p.name ?? (p.slug as string) }))
  const nameBySlug = new Map(allPages.map(p => [p.slug, p.name]))

  const primary = siteStrategyNavPrimary(siteStrategy)
  const ctaOnly = siteStrategyNavCtaOnly(siteStrategy)

  const setPrimary = async (next: NavChild[]) => {
    const nav = { ...(siteStrategy?.nav ?? {}), primary: next }
    await onSaveSiteStrategy({ ...(siteStrategy ?? {}), nav })
  }
  const setCtaOnly = async (next: NavChild[]) => {
    const nav = { ...(siteStrategy?.nav ?? {}), cta_only: next }
    await onSaveSiteStrategy({ ...(siteStrategy ?? {}), nav })
  }

  const renderChildRow = (
    child: NavChild,
    childIdx: number,
    parentIdx: number,
    parentItems: NavChild[],
    setParentChildren: (next: NavChild[]) => void,
  ) => {
    const kids = parentItems[parentIdx].children ?? []
    const move = (dir: -1 | 1) => {
      const target = childIdx + dir
      if (target < 0 || target >= kids.length) return
      const next = [...kids]
      const swapped = next[childIdx]; next[childIdx] = next[target]; next[target] = swapped
      setParentChildren(next)
    }
    const patch = (p: Partial<NavChild>) => {
      const next = kids.map((c, i) => i === childIdx ? { ...c, ...p } : c)
      setParentChildren(next)
    }
    const remove = () => setParentChildren(kids.filter((_, i) => i !== childIdx))
    return (
      <div key={childIdx} className="flex items-center gap-1.5 ml-6 mb-1">
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => move(-1)} disabled={disabled || childIdx === 0} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↑</button>
          <button type="button" onClick={() => move(1)}  disabled={disabled || childIdx === kids.length - 1} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↓</button>
        </div>
        <select
          value={child.slug ?? ''}
          disabled={disabled}
          onChange={e => patch({ slug: e.target.value || undefined })}
          className="text-[11px] text-wm-text bg-white border border-wm-border rounded px-1 py-0.5 disabled:opacity-50 max-w-[180px]"
        >
          <option value="">(no page)</option>
          {allPages.map(pg => <option key={pg.slug} value={pg.slug}>/{pg.slug}</option>)}
        </select>
        <input
          type="text"
          defaultValue={child.label ?? (child.slug ? nameBySlug.get(child.slug) ?? child.slug : '')}
          placeholder="Label"
          disabled={disabled}
          onBlur={e => patch({ label: e.target.value.trim() || undefined })}
          className="flex-1 text-[12px] text-wm-text bg-white border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
        />
        <button type="button" onClick={remove} disabled={disabled} className="text-wm-text-subtle hover:text-red-600 text-[14px] leading-none px-1">×</button>
      </div>
    )
  }

  const renderPrimaryRow = (item: NavChild, idx: number, list: NavChild[]) => {
    const move = (dir: -1 | 1) => {
      const target = idx + dir
      if (target < 0 || target >= list.length) return
      const next = [...list]
      const swapped = next[idx]; next[idx] = next[target]; next[target] = swapped
      void setPrimary(next)
    }
    const patch = (p: Partial<NavChild>) => {
      const next = list.map((c, i) => i === idx ? { ...c, ...p } : c)
      void setPrimary(next)
    }
    const remove = () => {
      if (!confirm(`Remove "${item.label ?? item.slug ?? 'this item'}" from the primary nav? (Page stays in site_strategy.pages — this only removes it from the nav.)`)) return
      void setPrimary(list.filter((_, i) => i !== idx))
    }
    const setChildren = (nextKids: NavChild[]) => {
      const next = list.map((c, i) => i === idx ? { ...c, children: nextKids } : c)
      void setPrimary(next)
    }
    const addChild = () => {
      const next = list.map((c, i) => i === idx ? { ...c, children: [...(c.children ?? []), {}] } : c)
      void setPrimary(next)
    }
    return (
      <li key={idx} className="border border-wm-border rounded p-2 bg-wm-bg">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => move(-1)} disabled={disabled || idx === 0} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↑</button>
            <button type="button" onClick={() => move(1)}  disabled={disabled || idx === list.length - 1} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↓</button>
          </div>
          <select
            value={item.slug ?? ''}
            disabled={disabled}
            onChange={e => patch({ slug: e.target.value || undefined })}
            className="text-[11px] text-wm-text bg-white border border-wm-border rounded px-1 py-0.5 disabled:opacity-50 max-w-[180px]"
            title="Which page this item links to. Leave empty for a nav parent that only opens a dropdown."
          >
            <option value="">(dropdown label only)</option>
            {allPages.map(pg => <option key={pg.slug} value={pg.slug}>/{pg.slug}</option>)}
          </select>
          <input
            type="text"
            defaultValue={item.label ?? (item.slug ? nameBySlug.get(item.slug) ?? item.slug : '')}
            placeholder="Label"
            disabled={disabled}
            onBlur={e => patch({ label: e.target.value.trim() || undefined })}
            className="flex-1 text-[12px] font-semibold text-wm-text bg-white border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50 min-w-[10rem]"
          />
          <button type="button" onClick={remove} disabled={disabled} className="text-[11px] font-semibold text-wm-text-muted hover:text-red-600 disabled:opacity-40">Remove</button>
        </div>
        {(item.children ?? []).length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] uppercase tracking-wider font-bold text-wm-text-subtle mb-1 ml-6">Dropdown children</div>
            {(item.children ?? []).map((child, ci) => renderChildRow(child, ci, idx, list, setChildren))}
          </div>
        )}
        {!disabled && (
          <button type="button" onClick={addChild} className="text-[11px] font-semibold text-wm-accent-strong hover:underline ml-6 mt-1">+ Add dropdown child</button>
        )}
      </li>
    )
  }

  const renderFlatRow = (item: NavChild, idx: number, list: NavChild[], set: (next: NavChild[]) => Promise<void>) => {
    const move = (dir: -1 | 1) => {
      const target = idx + dir
      if (target < 0 || target >= list.length) return
      const next = [...list]
      const swapped = next[idx]; next[idx] = next[target]; next[target] = swapped
      void set(next)
    }
    const patch = (p: Partial<NavChild>) => {
      const next = list.map((c, i) => i === idx ? { ...c, ...p } : c)
      void set(next)
    }
    return (
      <div key={idx} className="flex items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => move(-1)} disabled={disabled || idx === 0} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↑</button>
          <button type="button" onClick={() => move(1)}  disabled={disabled || idx === list.length - 1} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↓</button>
        </div>
        <select
          value={item.slug ?? ''}
          disabled={disabled}
          onChange={e => patch({ slug: e.target.value || undefined })}
          className="text-[11px] text-wm-text bg-white border border-wm-border rounded px-1 py-0.5 disabled:opacity-50 max-w-[180px]"
        >
          <option value="">(no page)</option>
          {allPages.map(pg => <option key={pg.slug} value={pg.slug}>/{pg.slug}</option>)}
        </select>
        <input
          type="text"
          defaultValue={item.label ?? (item.slug ? nameBySlug.get(item.slug) ?? item.slug : '')}
          placeholder="Label"
          disabled={disabled}
          onBlur={e => patch({ label: e.target.value.trim() || undefined })}
          className="flex-1 text-[12px] text-wm-text bg-white border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
        />
        <button type="button" onClick={() => void set(list.filter((_, i) => i !== idx))} disabled={disabled} className="text-wm-text-subtle hover:text-red-600 text-[14px] leading-none px-1">×</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] text-wm-text-muted leading-snug">
        Writes to <code>site_strategy.nav</code>. Partner view + all page-pickers read from here live — no compose step, no manual refresh. Add / remove / reorder any time.
      </p>

      <div>
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <div className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Primary nav</div>
          <span className="text-[10.5px] text-wm-text-subtle">{primary.length} top-level {primary.length === 1 ? 'item' : 'items'}</span>
        </div>
        <ul className="space-y-1.5">
          {primary.map((it, i) => renderPrimaryRow(it, i, primary))}
        </ul>
        {!disabled && (
          <button
            type="button"
            onClick={() => void setPrimary([...primary, {}])}
            className="mt-2 text-[11px] font-semibold text-wm-accent-strong hover:underline"
          >+ Add primary nav item</button>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <div className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">CTA-only items (pill buttons, e.g. Visit, Give)</div>
          <span className="text-[10.5px] text-wm-text-subtle">{ctaOnly.length}/3 · keep it tight</span>
        </div>
        <div className="space-y-1.5">
          {ctaOnly.map((it, i) => renderFlatRow(it, i, ctaOnly, setCtaOnly))}
        </div>
        {!disabled && ctaOnly.length < 3 && (
          <button
            type="button"
            onClick={() => void setCtaOnly([...ctaOnly, {}])}
            className="mt-2 text-[11px] font-semibold text-wm-accent-strong hover:underline"
          >+ Add CTA item</button>
        )}
      </div>

      <NavFooterEditor
        siteStrategy={siteStrategy}
        onSaveSiteStrategy={onSaveSiteStrategy}
        disabled={disabled}
        allPages={allPages}
        nameBySlug={nameBySlug}
      />
    </div>
  )
}

// Footer groups editor. Writes to site_strategy.nav.footer as a
// CoworkGroupedFooter (primary_links, explore, legal). Each column
// is an ordered list of {slug, label} items with add/remove/reorder.
function NavFooterEditor({
  siteStrategy, onSaveSiteStrategy, disabled, allPages, nameBySlug,
}: {
  siteStrategy:       SiteStrategyBlob | null
  onSaveSiteStrategy: (updated: SiteStrategyBlob) => Promise<{ ok: true } | { ok: false; error: string }>
  disabled:           boolean
  allPages:           Array<{ slug: string; name: string }>
  nameBySlug:         Map<string, string>
}) {
  const rawFooter = (siteStrategy?.nav as { footer?: unknown } | undefined)?.footer
  const grouped = (rawFooter && typeof rawFooter === 'object' && !Array.isArray(rawFooter))
    ? (rawFooter as Record<string, unknown>)
    : {}
  const readGroup = (key: 'primary_links' | 'explore' | 'legal'): NavChild[] => {
    const raw = grouped[key]
    if (!Array.isArray(raw)) return []
    return raw.map(coerceNavItem).filter(i => (i.slug ?? i.label ?? '').length > 0)
  }
  const primaryLinks = readGroup('primary_links')
  const explore      = readGroup('explore')
  const legal        = readGroup('legal')

  const writeGroup = async (key: 'primary_links' | 'explore' | 'legal', next: NavChild[]) => {
    const newFooter = { ...grouped, [key]: next }
    const nav = { ...(siteStrategy?.nav ?? {}), footer: newFooter }
    await onSaveSiteStrategy({ ...(siteStrategy ?? {}), nav })
  }

  const renderRow = (
    item: NavChild, idx: number, list: NavChild[], set: (next: NavChild[]) => Promise<void>,
  ) => {
    const move = (dir: -1 | 1) => {
      const target = idx + dir
      if (target < 0 || target >= list.length) return
      const next = [...list]
      const swapped = next[idx]; next[idx] = next[target]; next[target] = swapped
      void set(next)
    }
    const patch = (p: Partial<NavChild>) => {
      const next = list.map((c, i) => i === idx ? { ...c, ...p } : c)
      void set(next)
    }
    return (
      <div key={idx} className="flex items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => move(-1)} disabled={disabled || idx === 0} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↑</button>
          <button type="button" onClick={() => move(1)}  disabled={disabled || idx === list.length - 1} className="text-[13px] leading-none text-wm-text-muted hover:text-wm-text disabled:opacity-30 px-1">↓</button>
        </div>
        <select
          value={item.slug ?? ''}
          disabled={disabled}
          onChange={e => patch({ slug: e.target.value || undefined })}
          className="text-[11px] text-wm-text bg-white border border-wm-border rounded px-1 py-0.5 disabled:opacity-50 max-w-[180px]"
        >
          <option value="">(no page)</option>
          {allPages.map(pg => <option key={pg.slug} value={pg.slug}>/{pg.slug}</option>)}
        </select>
        <input
          type="text"
          defaultValue={item.label ?? (item.slug ? nameBySlug.get(item.slug) ?? item.slug : '')}
          placeholder="Label"
          disabled={disabled}
          onBlur={e => patch({ label: e.target.value.trim() || undefined })}
          className="flex-1 text-[12px] text-wm-text bg-white border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
        />
        <button type="button" onClick={() => void set(list.filter((_, i) => i !== idx))} disabled={disabled} className="text-wm-text-subtle hover:text-red-600 text-[14px] leading-none px-1">×</button>
      </div>
    )
  }

  const renderColumn = (
    key: 'primary_links' | 'explore' | 'legal',
    heading: string,
    hint: string,
    items: NavChild[],
  ) => (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <div className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{heading}</div>
        <span className="text-[10.5px] text-wm-text-subtle">{hint}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => renderRow(it, i, items, next => writeGroup(key, next)))}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={() => void writeGroup(key, [...items, {}])}
          className="mt-1.5 text-[11px] font-semibold text-wm-accent-strong hover:underline"
        >+ Add link to {heading.toLowerCase()}</button>
      )}
    </div>
  )

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">Footer link groups</div>
      <div className="space-y-4">
        {renderColumn('primary_links', 'Take a next step', 'prominent footer links (Give / Prayer / Contact)', primaryLinks)}
        {renderColumn('explore',       'Explore',           'secondary footer links (About / Ministries / etc.)', explore)}
        {renderColumn('legal',         'Fine print',        'legal + gated (Privacy / Terms / Staff login)',      legal)}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────
// WhyCardsEditor. Structured editor for presentation.why_cards so
// the strategist can override the auto-seeded strategy cards per
// partner. Each card carries an icon + title + body.
// ─────────────────────────────────────────────────────────────────

function WhyCardsEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const cards = review.presentation?.why_cards ?? []
  // Race-safe write of the why_cards array. Any callback here either
  // recomputes the array from the latest presentation.why_cards
  // (patchCard, removeCard, addCard) or gets handed a fresh next
  // array that it wraps into a functional updater. Either way, we
  // never spread stale closure state into the payload.
  const writeCards = (
    compute: (currentCards: NonNullable<SitemapReview['presentation']>['why_cards']) => NonNullable<SitemapReview['presentation']>['why_cards'],
  ) => {
    void onChange((current: SitemapReview) => ({
      ...current,
      presentation: {
        ...(current.presentation ?? {}),
        why_cards: compute(current.presentation?.why_cards ?? []),
      },
    }))
  }
  const patchCard = (id: string, patch: Partial<NonNullable<typeof cards>[number]>) =>
    writeCards(cur => (cur ?? []).map(cc => cc.id === id ? { ...cc, ...patch } : cc))
  const addCard = () =>
    writeCards(cur => [...(cur ?? []), { id: cryptoRandomIdLocal(), icon: '◆', title: '', body: '' }])
  const removeCard = (id: string) =>
    writeCards(cur => (cur ?? []).filter(c => c.id !== id))

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
              onBlur={e => patchCard(c.id, { icon: e.target.value })}
              className="text-[16px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded-md px-2 py-0.5 w-12 text-center focus:outline-none focus:border-wm-accent disabled:opacity-50"
              title="Icon character (◆ ◇ ✦ ↗ or any glyph)"
            />
            <input
              type="text"
              defaultValue={c.title}
              placeholder="Card title (e.g. Built on what makes you distinct)"
              disabled={disabled}
              onBlur={e => patchCard(c.id, { title: e.target.value })}
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
            onBlur={e => patchCard(c.id, { body: e.target.value })}
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

// TierPageDescriptionsEditor was retired in the Phase C consolidation
// (2026-07). Its per-page description_override input is now an inline
// row inside PagesEditor — one row per page, everything about that
// page in one place. Data path unchanged: still writes to
// review.presentation.tiers[].page_entries[].description_override
// (via PagesEditor.updateDescriptionOverride).

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
// InspirationImageEditor. Optional file upload + caption for the
// inspiration-image block on the partner review. Renders below the
// Full Page List when the URL is set; the entire section is
// omitted when the URL is empty. Uploads land in the brand-assets
// bucket via attachmentUpload with a project-scoped path prefix.
// ─────────────────────────────────────────────────────────────────

function InspirationImageEditor({
  review, projectId, onChange, disabled,
}: {
  review:    SitemapReview
  projectId: string
  onChange:  (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled:  boolean
}) {
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const pres  = review.presentation ?? {}
  const image = pres.inspiration_image

  const setImage = (
    next: NonNullable<SitemapReview['presentation']>['inspiration_image'] | undefined,
  ) => {
    // Race-safe: merge into the latest presentation so sibling cowork
    // writes to other presentation fields don't get clobbered.
    void onChange((current: SitemapReview) => ({
      ...current,
      presentation: { ...(current.presentation ?? {}), inspiration_image: next },
    }))
  }

  const handleFile = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket:      'brand-assets',
        pathPrefix:  `sitemap-review/${projectId}`,
        allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        maxBytes:    10 * 1024 * 1024,
      })
      setImage({
        url:     result.url,
        alt:     image?.alt,
        caption: image?.caption,
      })
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-wm-text-muted">
        Optional. Upload a reference visual to render below the Full Page List (moodboard tile, competitor screenshot, brand-guide swatch, a photo of the physical space). When empty, the section is hidden entirely on the partner view.
      </p>

      {image?.url ? (
        <div className="flex gap-3 items-start rounded border border-wm-border bg-white p-3">
          <img
            src={image.url}
            alt={image.alt ?? 'Inspiration'}
            className="w-32 h-20 object-cover rounded border border-wm-border"
          />
          <div className="flex-1 min-w-0 space-y-1.5">
            <input
              type="text"
              defaultValue={image.alt ?? ''}
              placeholder="Alt text (screen readers, SEO)"
              disabled={disabled}
              onBlur={e => setImage({ ...image, alt: e.target.value.trim() || undefined })}
              className="w-full text-[12px] text-wm-text bg-white border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            <input
              type="text"
              defaultValue={image.caption ?? ''}
              placeholder="Caption (shown under the image, optional)"
              disabled={disabled}
              onBlur={e => setImage({ ...image, caption: e.target.value.trim() || undefined })}
              className="w-full text-[12px] text-wm-text bg-white border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            <div className="flex items-center gap-3 pt-1">
              <label className="text-[11px] font-semibold text-wm-accent-strong cursor-pointer hover:underline">
                Replace image
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={disabled || uploading}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) void handleFile(f)
                    e.target.value = ''
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setImage(undefined)}
                disabled={disabled}
                className="text-[11px] font-semibold text-wm-text-subtle hover:text-wm-danger disabled:opacity-40"
              >
                Remove
              </button>
              {uploading && <span className="text-[11px] text-wm-text-subtle">Uploading…</span>}
            </div>
          </div>
        </div>
      ) : (
        <label
          className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-wm-border bg-white px-6 py-8 text-center hover:border-wm-accent hover:bg-wm-accent-tint/20 cursor-pointer transition-colors"
        >
          <span className="text-[22px] leading-none text-wm-text-subtle">↑</span>
          <span className="text-[13px] font-semibold text-wm-text">
            {uploading ? 'Uploading…' : 'Upload an inspiration image'}
          </span>
          <span className="text-[11px] text-wm-text-muted">
            Optional. JPG, PNG, WebP, or GIF. Up to 10 MB. Renders below the Full Page List on the partner review.
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            disabled={disabled || uploading}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
              e.target.value = ''
            }}
          />
        </label>
      )}

      {uploadError && (
        <p className="text-[11.5px] text-red-600">{uploadError}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// SharedHubsIntroEditor. Edits the headline + body text shown above
// the Shared Hub Pages cards on the partner preview. Both fields
// optional; falls back to defaults when unset.
// ─────────────────────────────────────────────────────────────────

function SharedHubsIntroEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const pres = review.presentation ?? {}
  const setField = (k: 'shared_hubs_headline' | 'shared_hubs_body', v: string) => {
    // Race-safe: merge into the latest presentation.
    void onChange((current: SitemapReview) => ({
      ...current,
      presentation: { ...(current.presentation ?? {}), [k]: v.trim() ? v : undefined },
    }))
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
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const congs = review.presentation?.congregations ?? []
  // Race-safe write of the congregations array. Every mutation
  // recomputes from the latest presentation.congregations at commit
  // time so sibling edits to other presentation fields (why_cards,
  // tiers, banner) aren't stomped.
  const writeCongs = (
    compute: (currentCongs: NonNullable<SitemapReview['presentation']>['congregations']) => NonNullable<SitemapReview['presentation']>['congregations'],
  ) => {
    void onChange((current: SitemapReview) => ({
      ...current,
      presentation: {
        ...(current.presentation ?? {}),
        congregations: compute(current.presentation?.congregations ?? []),
      },
    }))
  }
  const patchCong = (id: string, patch: Partial<NonNullable<typeof congs>[number]>) => {
    writeCongs(cur => (cur ?? []).map(c => c.id === id ? { ...c, ...patch } : c))
  }
  const addCong = () =>
    writeCongs(cur => [...(cur ?? []), { id: cryptoRandomIdLocal(), label: '', service_time: '', address: '' }])
  const removeCong = (id: string) => {
    if (!confirm('Remove this congregation? Its row disappears from Shared Hub Pages, Persistent Nav, and the Get Connected mega.')) return
    writeCongs(cur => (cur ?? []).filter(c => c.id !== id))
  }
  const setPrimary = (id: string) =>
    writeCongs(cur => (cur ?? []).map(c => ({ ...c, is_primary: c.id === id })))

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
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const fh = review.presentation?.featured_highlight
  // Race-safe: replace featured_highlight on the LATEST presentation
  // so a parallel per-field write elsewhere doesn't get stomped.
  const patch = (next: NonNullable<SitemapReview['presentation']>['featured_highlight'] | undefined) => {
    void onChange((current: SitemapReview) => ({
      ...current,
      presentation: { ...(current.presentation ?? {}), featured_highlight: next },
    }))
  }
  const setField = (k: string, v: string) => {
    // Race-safe against a parallel edit to a different featured_
    // highlight field: derive the merge target from current state.
    void onChange((current: SitemapReview) => {
      const cur = current.presentation?.featured_highlight ?? { label: '', description: '' }
      const nextFh = { ...cur, [k]: v || undefined } as NonNullable<SitemapReview['presentation']>['featured_highlight']
      return {
        ...current,
        presentation: { ...(current.presentation ?? {}), featured_highlight: nextFh },
      }
    })
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
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const tiers = review.presentation?.tiers ?? []
  const patchTier = (id: string, patch: Partial<NonNullable<typeof tiers>[number]>) => {
    // Race-safe: recompute the tiers array from current state so a
    // parallel per-page description override edit (which writes to
    // the same tiers array) doesn't get stomped.
    void onChange((current: SitemapReview) => {
      const curTiers = current.presentation?.tiers ?? []
      const next = curTiers.map(t => t.id === id ? { ...t, ...patch } : t)
      return {
        ...current,
        presentation: { ...(current.presentation ?? {}), tiers: next },
      }
    })
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
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
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
            const v = e.target.value
            // Race-safe: merge into the latest presentation.
            void onChange((current: SitemapReview) => ({
              ...current,
              presentation: { ...(current.presentation ?? {}), hero_em_phrase: v || undefined },
            }))
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
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const cards = review.presentation?.whats_changing_cards ?? []
  // Race-safe write of whats_changing_cards. Every mutation reads
  // the latest cards array from current state at commit time so
  // sibling presentation edits don't get clobbered.
  const writeCards = (
    compute: (currentCards: NonNullable<SitemapReview['presentation']>['whats_changing_cards']) => NonNullable<SitemapReview['presentation']>['whats_changing_cards'],
  ) => {
    void onChange((current: SitemapReview) => ({
      ...current,
      presentation: {
        ...(current.presentation ?? {}),
        whats_changing_cards: compute(current.presentation?.whats_changing_cards ?? []),
      },
    }))
  }
  const patch = (id: string, p: Partial<NonNullable<typeof cards>[number]>) => {
    writeCards(cur => (cur ?? []).map(c => c.id === id ? { ...c, ...p } : c))
  }
  const add = () =>
    writeCards(cur => [...(cur ?? []), { id: cryptoRandomIdLocal(), tag: 'kept', title: '', body: '' }])
  const remove = (id: string) =>
    writeCards(cur => (cur ?? []).filter(c => c.id !== id))

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

// ─────────────────────────────────────────────────────────────────
// SiteStrategyJsonEditor. Paste-JSON affordance for the whole
// site_strategy blob. Cowork's iteration has been unreliable
// enough that the strategist sometimes needs to edit pages / nav /
// meta directly. Validates that the parsed JSON is an object with
// a `pages` array and a `nav` object before writing; the save
// endpoint bumps `_meta.generated_at` so downstream tools see the
// revision. Shows any validation error inline.
// ─────────────────────────────────────────────────────────────────

function SiteStrategyJsonEditor({
  siteStrategy, onSave, disabled,
}: {
  siteStrategy: SiteStrategyBlob | null
  onSave:       (parsed: SiteStrategyBlob) => Promise<{ ok: true } | { ok: false; error: string }>
  disabled:     boolean
}) {
  const initial = useMemo(
    () => siteStrategy ? JSON.stringify(siteStrategy, null, 2) : '{}',
    [siteStrategy],
  )
  const [text,   setText]   = useState(initial)
  const [error,  setError]  = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => { setText(initial); setError(null); setStatus(null) }, [initial])

  const save = async () => {
    setError(null); setStatus(null)
    let parsed: SiteStrategyBlob
    try {
      const raw = text.trim() ? JSON.parse(text) : {}
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('site_strategy must be a JSON object.')
      }
      if (!Array.isArray(raw.pages)) {
        throw new Error('site_strategy must have a `pages` array.')
      }
      if (!raw.nav || typeof raw.nav !== 'object' || Array.isArray(raw.nav)) {
        throw new Error('site_strategy must have a `nav` object.')
      }
      parsed = raw as SiteStrategyBlob
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.')
      return
    }
    const res = await onSave(parsed)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setStatus('Saved. _meta.generated_at bumped.')
  }

  const dirty = text !== initial

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-wm-text-muted leading-snug">
        Direct-edit the <code>roadmap_state.site_strategy</code> blob. Use this to rename a page, tweak a purpose, or reshape nav without running a cowork revise pass. On save, the app validates that <code>pages</code> and <code>nav</code> exist, bumps <code>_meta.generated_at</code>, and stamps <code>_meta.skill_name = &apos;strategist-json-edit&apos;</code>. The partner view reads pages + nav live from this blob, so a save shows up immediately in the preview and on the partner portal.
      </p>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setStatus(null) }}
        disabled={disabled}
        rows={20}
        spellCheck={false}
        className="w-full rounded-md border border-wm-border bg-white text-[12px] font-mono text-wm-text p-3 outline-none focus:border-wm-accent"
        placeholder="{}"
      />
      {error && <div className="text-[11.5px] text-red-600">{error}</div>}
      {status && !error && <div className="text-[11.5px] text-green-700">{status}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || !dirty}
          onClick={() => void save()}
          className="text-[12px] font-semibold px-4 py-1.5 rounded-full bg-wm-accent-strong text-white hover:bg-wm-accent disabled:opacity-50"
        >
          Save site_strategy
        </button>
        {dirty && <span className="text-[11px] text-wm-text-subtle">Unsaved changes</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// RoundChangeSummaryEditor. Strategist-authored "what changed since
// Round N-1" that the partner reads at the top of the Round 2+
// review. Only rendered when round_number > 1.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// ReviewActionBar. Persistent status-aware action row that sits
// directly below the composer header, outside the scrollable body,
// so Publish / Approve / Start next round / Retract are always in
// view no matter how far the strategist has scrolled. Same actions
// the footer used to carry — moved up so partner-reviewed reviews
// don't require hunting for the button.
// ─────────────────────────────────────────────────────────────────

function ReviewActionBar({
  review, saving, error, shareUrl, siteStrategy,
  publishWithResync, persist,
}: {
  review:             SitemapReview
  saving:             boolean
  error:              string | null
  shareUrl:           string | null
  siteStrategy:       SiteStrategyBlob | null
  publishWithResync:  () => Promise<void>
  persist:            (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
}) {
  const status = review.status
  return (
    <div className="border-b border-wm-border bg-wm-bg-elevated px-5 py-2.5 flex items-center gap-2 flex-wrap">
      {status === 'draft' && (
        <button
          type="button"
          onClick={() => void publishWithResync()}
          disabled={saving}
          className="inline-flex items-center gap-1 text-[12px] font-semibold bg-wm-accent-strong text-white rounded-full px-4 py-1.5 hover:bg-wm-accent disabled:opacity-50"
        >
          Publish for partner review →
        </button>
      )}
      {(status === 'published' || status === 'partner_reviewed') && (
        <>
          {status === 'partner_reviewed' ? (
            <button
              type="button"
              onClick={() => {
                if (!confirm(`Start Round ${(review.round_number ?? 1) + 1}? The current round's partner feedback and drafted state get snapshotted into round history, then the review resets to draft so you can iterate. Nothing gets deleted.`)) return
                void persist((current: SitemapReview) => startNextRound(current, {
                  siteStrategyGeneratedAt: siteStrategy?._meta?.generated_at,
                }))
              }}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[12px] font-semibold bg-wm-accent-strong text-white rounded-full px-4 py-1.5 hover:bg-wm-accent disabled:opacity-50"
              title="Snapshot this round's feedback and open Round N+1 as a new draft."
            >
              Start next round →
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void persist(approveReview(review, 'staff'))}
            disabled={saving}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-full border border-wm-accent text-wm-accent-strong hover:bg-wm-accent-strong hover:text-white disabled:opacity-50"
          >
            Approve as canonical
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
          <button
            type="button"
            onClick={() => {
              const suffix = status === 'partner_reviewed'
                ? ' Partner feedback stays attached to the review — nothing gets deleted, and the round number does not change. (Use "Start next round" instead to bump to Round N+1.)'
                : ''
              if (!confirm(`Retract this review to draft? The partner-facing link stops working until you publish again.${suffix}`)) return
              void persist((current: SitemapReview) => ({
                ...current,
                status:              'draft',
                published_at:        null,
                partner_reviewed_at: status === 'partner_reviewed' ? current.partner_reviewed_at : null,
                partner_reviewed_by: status === 'partner_reviewed' ? current.partner_reviewed_by : null,
              }))
            }}
            disabled={saving}
            className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text ml-auto"
          >
            Retract to draft
          </button>
        </>
      )}
      {status === 'approved' && (
        <>
          <span className="text-[11.5px] text-wm-text-muted">Locked as canonical.</span>
          <button
            type="button"
            onClick={() => void persist((current: SitemapReview) => ({ ...current, status: 'partner_reviewed', approved_at: null, approved_by: null }))}
            disabled={saving}
            className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text ml-auto"
          >
            Unlock for edits
          </button>
        </>
      )}
      {saving && <span className="text-[11px] text-wm-text-subtle ml-2">Saving…</span>}
      {error && <span className="text-[11px] text-red-600 ml-2">err: {error}</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// PartnerOverallNoteView. Renders the partner's overall note
// (`review.partner_notes`) in the composer's edit mode so the
// strategist doesn't have to switch to Preview to see what the
// partner wrote broadly. Read-only — the partner owns this field.
// Hides when the note is empty so drafts stay clean.
// ─────────────────────────────────────────────────────────────────

function PartnerOverallNoteView({ review }: { review: SitemapReview }) {
  const raw = (review.partner_notes ?? '').trim()
  if (!raw) return null
  const author = review.partner_reviewed_by?.trim()
  const at = review.partner_reviewed_at
  const when = at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null
  return (
    <section
      className="rounded-lg border border-wm-accent/40 bg-wm-accent/5 px-4 py-3"
      title="What the partner wrote in the overall-note field on the portal."
    >
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
        Overall note from the partner
        {author && <span className="text-wm-text-muted ml-2 normal-case tracking-normal">· {author}</span>}
        {when && <span className="text-wm-text-subtle ml-2 normal-case tracking-normal">· {when}</span>}
      </p>
      <p className="text-[13px] text-wm-text whitespace-pre-wrap leading-snug">
        {raw}
      </p>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────
// CoworkPromptPanel. Ports the "Ready-to-paste cowork prompt"
// affordance from the old standalone /sitemap-feedback page directly
// into the composer, so once Phase B collapses the standalone page
// there is no lost function. Collapsible by default; only renders
// when the review is partner_reviewed and has at least one open
// edit request (nothing to feed the cowork session otherwise).
// ─────────────────────────────────────────────────────────────────

function CoworkPromptPanel({
  review, projectId, churchName,
}: {
  review:     SitemapReview
  projectId:  string
  churchName: string | null
}) {
  const openReqCount = (review.partner_edit_requests ?? []).filter(r => r.status === 'open').length
  const [copied, setCopied] = useState(false)
  if (review.status !== 'partner_reviewed') return null
  if (openReqCount === 0) return null
  const prompt = buildCoworkPrompt(review, projectId, churchName)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }
  return (
    <section className="rounded-lg border border-wm-border bg-wm-bg-elevated">
      <details>
        <summary className="cursor-pointer px-4 py-2.5 flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Apply feedback via cowork
          </span>
          <span className="text-[11.5px] text-wm-text-muted">
            {openReqCount} open {openReqCount === 1 ? 'note' : 'notes'} · copy the prompt below and paste into a fresh Claude Code session
          </span>
        </summary>
        <div className="px-4 pb-3 space-y-2">
          <p className="text-[11.5px] text-wm-text-muted leading-snug">
            Self-contained prompt: names the Supabase project, inlines the <code>revise-site-strategy</code> skill, gives the exact SQL, and lists the note IDs to resolve. A fresh session with zero project context can run it end-to-end.
          </p>
          <textarea
            readOnly
            value={prompt}
            className="w-full text-[11.5px] font-mono text-wm-text bg-white leading-snug px-3 py-2 border border-wm-border rounded outline-none resize-y min-h-[180px]"
          />
          <div>
            <button
              type="button"
              onClick={() => void copy()}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-wm-accent-strong text-white hover:bg-wm-accent"
            >
              {copied ? 'Copied ✓' : 'Copy cowork prompt'}
            </button>
          </div>
        </div>
      </details>
    </section>
  )
}

function RoundChangeSummaryEditor({
  review, onChange, disabled,
}: {
  review:   SitemapReview
  onChange: (nextOrUpdater: SitemapReview | ((current: SitemapReview) => SitemapReview)) => Promise<void> | void
  disabled: boolean
}) {
  const value = review.round_change_summary ?? ''
  const priorRound = (review.round_number ?? 1) - 1
  return (
    <section className="rounded-lg border border-wm-accent/30 bg-wm-accent/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
        What changed since Round {priorRound}
      </p>
      <p className="text-[11.5px] text-wm-text-muted mb-2 leading-snug">
        Write a partner-facing note explaining what you revised for this round. Appears at the top of the Round {review.round_number} portal view. Leave blank if you'd rather stay silent about the changes.
      </p>
      <textarea
        key={`round-change-summary-${review.round_number}`}
        defaultValue={value}
        disabled={disabled}
        rows={3}
        placeholder={`E.g. "We rebuilt the site around three congregations, added a Volunteer page, and simplified the top nav based on your notes."`}
        onBlur={e => {
          const next = e.target.value.trim() || undefined
          if (next === (review.round_change_summary ?? undefined)) return
          void onChange((current: SitemapReview) => ({
            ...current,
            round_change_summary: next,
          }))
        }}
        className="w-full text-[12px] text-wm-text bg-white border border-wm-border rounded-md px-3 py-2 focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────
// PreviousRoundsPanel. Read-only collapsible listing every prior
// round: when it was published, when the partner submitted feedback,
// their notes, and their per-section edit requests. So Round 2+ can
// see everything Round 1 said without hunting.
// ─────────────────────────────────────────────────────────────────

function PreviousRoundsPanel({ review }: { review: SitemapReview }) {
  const history = review.round_history ?? []
  if (history.length === 0) return null
  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  return (
    <section className="rounded-lg border border-wm-border bg-wm-bg-elevated">
      <details>
        <summary className="cursor-pointer px-4 py-2.5 flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Previous rounds
          </span>
          <span className="text-[11.5px] text-wm-text-muted">
            {history.length} {history.length === 1 ? 'round' : 'rounds'} archived · partner feedback preserved below
          </span>
        </summary>
        <div className="px-4 pb-3 space-y-3">
          {[...history].reverse().map(snap => (
            <div key={snap.round_number} className="border border-wm-border rounded p-3 bg-white">
              <div className="flex items-baseline gap-2 flex-wrap mb-1">
                <span className="text-[13px] font-bold text-wm-text">Round {snap.round_number}</span>
                <span className="text-[11px] text-wm-text-muted">
                  Published {fmt(snap.published_at)}
                  {snap.partner_reviewed_at && ` · Partner submitted ${fmt(snap.partner_reviewed_at)}${snap.partner_reviewed_by ? ` by ${snap.partner_reviewed_by}` : ''}`}
                  {snap.closed_at && ` · Closed ${fmt(snap.closed_at)}`}
                </span>
              </div>
              {snap.round_change_summary && (
                <p className="text-[11.5px] text-wm-text italic mb-2">
                  <span className="text-wm-text-muted not-italic">Change summary shown to partner: </span>
                  {snap.round_change_summary}
                </p>
              )}
              {snap.partner_notes && (
                <div className="mb-2">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">Partner-wide note</p>
                  <p className="text-[12px] text-wm-text whitespace-pre-wrap">{snap.partner_notes}</p>
                </div>
              )}
              {snap.partner_edit_requests.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                    Section-level feedback ({snap.partner_edit_requests.length})
                  </p>
                  <ul className="space-y-1.5">
                    {snap.partner_edit_requests.map(r => (
                      <li key={r.id} className="text-[11.5px] text-wm-text">
                        <span className="font-semibold">{r.section_label}</span>
                        {r.author_name && <span className="text-wm-text-muted"> · {r.author_name}</span>}
                        <div className="text-[11.5px] text-wm-text-muted whitespace-pre-wrap">{r.comment}</div>
                        {r.suggested_change && (
                          <div className="text-[11.5px] text-wm-text-muted italic">Suggested: {r.suggested_change}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!snap.partner_notes && snap.partner_edit_requests.length === 0 && (
                <p className="text-[11.5px] text-wm-text-subtle italic">No partner feedback recorded for this round.</p>
              )}
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}
