/**
 * Partner-facing sitemap-and-navigation review portal.
 *
 * URL: /portal/sitemap/<token>
 *   - Public (no auth). Token IS the credential. Anyone with the link
 *     can read + edit the review. Staff mints the token from
 *     CopyEngineWorkspace via the SitemapReviewEditor's "Publish for
 *     partner review" button.
 *
 * Flow:
 *   1. Look up review by token via get_sitemap_review_by_token RPC.
 *      Not-found / not-yet-published → polite unavailable screen.
 *   2. Render intro + pages (with purpose) + persona postures +
 *      user journeys + nav preview + "where content went" migrations
 *      — every field inline-editable.
 *   3. Any edit calls save_sitemap_review_by_token, which merges the
 *      change into roadmap_state.sitemap_review and transitions
 *      status published → partner_reviewed the first time.
 *   4. Partner can click "Approve" to lock as canonical — staff
 *      still sees the review, but downstream tools switch to it
 *      immediately.
 *
 * Distinct from PortalReviewPage (the copy-review portal): that one
 * captures suggested edits on already-committed pages; this one is
 * an editable structural review of the sitemap itself, upstream of
 * page copy.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  loadSitemapReviewByToken,
  savePartnerSitemapReview,
  approveReview,
  type ContentMigration,
  type FooterInfo,
  type JourneyStep,
  type NavItem,
  type PersonaPosture,
  type ReviewPage,
  type SitemapReview,
} from '../lib/sitemapReview'

export default function SitemapReviewPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [review, setReview] = useState<SitemapReview | null>(null)
  const [churchName, setChurchName] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) { setStatus('not-found'); return }
    setStatus('loading')
    const res = await loadSitemapReviewByToken(token)
    if (!res) { setStatus('not-found'); return }
    setReview(res.review)
    setChurchName(res.church_name)
    setStatus('ready')
  }, [token])

  useEffect(() => { void load() }, [load])

  const persist = useCallback(async (next: SitemapReview) => {
    if (!token) return
    setReview(next)
    setSaving(true)
    setError(null)
    const res = await savePartnerSitemapReview({ token, next })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      // Reload authoritative state so the partner doesn't diverge.
      await load()
      return
    }
  }, [token, load])

  if (status === 'loading') {
    return <PortalShell><p className="text-center text-wm-text-muted">Loading review…</p></PortalShell>
  }
  if (status === 'not-found' || !review) {
    return (
      <PortalShell>
        <div className="text-center space-y-3">
          <h1 className="text-[24px] font-bold text-wm-text">Review not available</h1>
          <p className="text-wm-text-muted">
            This link isn't valid. Your review may have been rescinded, or your team
            hasn't published it yet. Reach out to Church Media Squad and we'll get you
            the current link.
          </p>
        </div>
      </PortalShell>
    )
  }

  const locked = review.status === 'approved'

  return (
    <PortalShell>
      {/* Intro */}
      <header className="mb-10">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
          {churchName ?? 'Your church'} · sitemap review
        </p>
        <h1 className="text-[28px] md:text-[32px] font-bold text-wm-text leading-tight">
          {review.intro?.headline ?? `${churchName ?? 'Your church'} website content strategy`}
        </h1>
        <p className="text-[15px] text-wm-text-muted mt-3 leading-relaxed max-w-2xl">
          {review.intro?.body ?? 'Here\'s the proposed structure for your new website. Read through it, share it with your team, and tell us what to refine. This is a working draft we build together.'}
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <StatusPill status={review.status} />
          {saving && <span className="text-[11px] text-wm-text-subtle">Saving…</span>}
          {error && <span className="text-[11px] text-red-600">Save failed: {error}</span>}
        </div>
      </header>

      <div className="space-y-10">
        {/* Executive summary. Big-picture "here's what this site is
            designed to do for you" framing that opens the review. */}
        {review.executive_summary && (
          <PortalCallout title="Executive summary" tone="accent">
            <MultilineText
              value={review.executive_summary}
              onSave={locked ? null : (v) => void persist({ ...review, executive_summary: v })}
              placeholder="Executive summary in progress."
              rows={6}
              className="text-[15px] text-wm-text leading-relaxed"
            />
          </PortalCallout>
        )}

        {/* Navigation strategy. The "heart and why" paragraph before
            the partner scans the actual menu structure below. */}
        {(review.navigation_strategy || !locked) && (
          <PortalSection
            title="Primary navigation strategy"
            description="How the menu is built and why."
          >
            <MultilineText
              value={review.navigation_strategy ?? ''}
              onSave={locked ? null : (v) => void persist({ ...review, navigation_strategy: v })}
              placeholder="The reasoning behind the menu structure will land here once the strategist finalizes it."
              rows={5}
              className="rounded-lg border border-wm-border bg-white px-4 py-3 text-[14px] text-wm-text leading-relaxed"
            />
            <div className="mt-4 space-y-4">
              <NavRegionPreview
                label="Primary (always visible)"
                items={review.nav_layout.header}
                tone="primary"
              />
              {review.nav_layout.secondary && review.nav_layout.secondary.length > 0 && (
                <NavRegionPreview
                  label={review.nav_layout.secondary_label ?? 'Secondary menu'}
                  hint="Off-canvas, utility, or drawer nav; opens alongside the primary nav rather than replacing it."
                  items={review.nav_layout.secondary}
                  tone="secondary"
                />
              )}
            </div>
          </PortalSection>
        )}

        {/* Persona postures. Ordered before pages so the partner sees
            the WHO before the WHAT. */}
        {review.persona_postures.length > 0 && (
          <PortalSection
            title="Who we're speaking to"
            description="How the site is angled toward each person you're inviting into your community."
          >
            <div className="space-y-4">
              {review.persona_postures.map(p => (
                <PersonaPortalCard key={p.persona_id} posture={p} review={review} onChange={persist} locked={locked} />
              ))}
            </div>
          </PortalSection>
        )}

        {/* Pages. Each page card consolidates purpose, what changed,
            why, and how it aligns with strategy. */}
        <PortalSection title="Pages" description="What each page on your new site is for.">
          <ul className="space-y-4">
            {review.pages.map(p => (
              <PagePortalCard key={p.id} page={p} review={review} onChange={persist} locked={locked} />
            ))}
          </ul>
        </PortalSection>

        {/* Content migrations. */}
        {review.content_migrations.length > 0 && (
          <PortalSection
            title="Where your content went"
            description="Pages that changed shape from your current site. What merged, what got its own home, and why."
          >
            <div className="space-y-3">
              {review.content_migrations.map(m => (
                <MigrationPortalCard key={m.id} migration={m} review={review} onChange={persist} locked={locked} />
              ))}
            </div>
          </PortalSection>
        )}

        {/* Footer information */}
        {review.footer_info && (
          <FooterPortalSection footer={review.footer_info} />
        )}

        {/* Partner notes */}
        <PortalSection title="Your notes" description="Anything else you want us to know.">
          <textarea
            defaultValue={review.partner_notes ?? ''}
            placeholder="Anything else you'd like us to consider: priorities, missing pages, terminology preferences, and any concerns."
            disabled={locked}
            rows={4}
            onBlur={e => {
              if (e.target.value === (review.partner_notes ?? '')) return
              void persist({ ...review, partner_notes: e.target.value })
            }}
            className="w-full text-[14px] text-wm-text bg-white border border-wm-border rounded-lg px-3 py-2 focus:outline-none focus:border-wm-accent disabled:opacity-50"
          />
        </PortalSection>

        {/* Approve */}
        {!locked && (
          <div className="rounded-lg border-2 border-wm-accent bg-wm-accent-tint p-5 text-center">
            <h2 className="text-[18px] font-bold text-wm-text mb-1">Ready to move forward?</h2>
            <p className="text-[13px] text-wm-text-muted mb-3">
              Approving locks in the structure and lets your Church Media Squad start the next stage.
              If something surfaces later, we can always reopen the review together.
            </p>
            <button
              type="button"
              onClick={() => void persist(approveReview(review, 'partner'))}
              disabled={saving}
              className="inline-flex items-center gap-2 text-[13px] font-semibold bg-wm-accent-strong text-white rounded-full px-6 py-2 hover:bg-wm-accent disabled:opacity-50"
            >
              Approve this sitemap →
            </button>
          </div>
        )}
        {locked && (
          <div className="rounded-lg border-2 border-green-400 bg-green-50 p-5 text-center">
            <h2 className="text-[18px] font-bold text-green-800 mb-1">Approved. Thank you.</h2>
            <p className="text-[13px] text-green-700">
              This sitemap is locked as the official direction. Your Church Media Squad is picking it up
              from here. Reach out anytime if something needs to be reopened.
            </p>
          </div>
        )}
      </div>
    </PortalShell>
  )
}

// ── Sub-cards ────────────────────────────────────────────────────────

function PagePortalCard({
  page, review, onChange, locked,
}: {
  page:     ReviewPage
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  locked:   boolean
}) {
  const update = (patch: Partial<ReviewPage>) => {
    void onChange({ ...review, pages: review.pages.map(p => p.id === page.id ? { ...p, ...patch } : p) })
  }
  return (
    <li className="rounded-lg border border-wm-border bg-white p-4">
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <input
          type="text"
          defaultValue={page.name}
          disabled={locked}
          onBlur={e => { if (e.target.value !== page.name) update({ name: e.target.value }) }}
          className="text-[15px] font-bold text-wm-text bg-transparent border-b border-transparent focus:border-wm-accent focus:outline-none min-w-0 flex-1 disabled:opacity-50"
        />
        <code className="text-[11px] font-mono text-wm-text-muted">/{page.slug}</code>
        {page.nav_position && (
          <span className="text-[10.5px] text-wm-text-subtle">{page.nav_position}</span>
        )}
      </div>
      {(page.primary_audience || page.funnel_stage) && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {page.primary_audience && (
            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-wm-accent-tint border border-wm-accent/30 text-wm-accent-strong">
              For: {page.primary_audience}
            </span>
          )}
          {page.funnel_stage && (
            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-wm-bg-elevated border border-wm-border text-wm-text-muted">
              Funnel: {page.funnel_stage}
            </span>
          )}
        </div>
      )}
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Purpose</p>
      <textarea
        defaultValue={page.purpose}
        placeholder="What this page is for. Tell us if the framing doesn't match how you'd describe it."
        disabled={locked}
        rows={2}
        onBlur={e => { if (e.target.value !== page.purpose) update({ purpose: e.target.value }) }}
        className="w-full text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />

      {(page.what_changed || page.why_change || page.strategic_alignment || !locked) && (
        <div className="mt-3 space-y-3">
          {(page.what_changed || !locked) && (
            <PagePortalNote
              label="What changed"
              value={page.what_changed}
              placeholder="If this page is new, renamed, elevated, or merged from your current site, the strategist will explain the shift here."
              locked={locked}
              onSave={v => update({ what_changed: v })}
            />
          )}
          {(page.why_change || !locked) && (
            <PagePortalNote
              label="Why we made this change"
              value={page.why_change}
              placeholder="The reasoning behind the decision, in the context of the person this serves."
              locked={locked}
              onSave={v => update({ why_change: v })}
            />
          )}
          {(page.strategic_alignment || !locked) && (
            <PagePortalNote
              label="How it aligns with strategy"
              value={page.strategic_alignment}
              placeholder="How this page reflects your mission, values, and the goals set in Discovery."
              locked={locked}
              onSave={v => update({ strategic_alignment: v })}
            />
          )}
        </div>
      )}
    </li>
  )
}

/** One "What changed / Why / Alignment" subsection inside a page card.
 *  Reads as a small labeled paragraph when populated; becomes an
 *  editable textarea when the review isn't locked and the field is
 *  focused. Empty locked fields collapse entirely. */
function PagePortalNote({
  label, value, placeholder, locked, onSave,
}: {
  label:       string
  value:       string | undefined
  placeholder: string
  locked:      boolean
  onSave:      (v: string) => void
}) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">{label}</p>
      {locked && !value ? null : (
        <textarea
          defaultValue={value ?? ''}
          placeholder={placeholder}
          disabled={locked}
          rows={2}
          onBlur={e => { if (e.target.value !== (value ?? '')) onSave(e.target.value) }}
          className="w-full text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50"
        />
      )}
    </div>
  )
}

function PersonaPortalCard({
  posture, review, onChange, locked,
}: {
  posture:  PersonaPosture
  review:   SitemapReview
  onChange: (next: SitemapReview) => Promise<void> | void
  locked:   boolean
}) {
  const update = (patch: Partial<PersonaPosture>) => {
    void onChange({
      ...review,
      persona_postures: review.persona_postures.map(p => p.persona_id === posture.persona_id ? { ...p, ...patch } : p),
    })
  }
  const updateStep = (idx: number, patch: Partial<JourneyStep>) => {
    update({ user_journey: posture.user_journey.map((s, i) => i === idx ? { ...s, ...patch } : s) })
  }
  const removeStep = (idx: number) => {
    update({ user_journey: posture.user_journey.filter((_, i) => i !== idx) })
  }
  const addStep = () => update({ user_journey: [...posture.user_journey, { step_label: '' }] })
  return (
    <div className="rounded-lg border border-wm-border bg-white p-4">
      <p className="text-[15px] font-bold text-wm-text mb-2">{posture.persona_name}</p>
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">How the site meets them</p>
      <textarea
        defaultValue={posture.posture_summary}
        placeholder={`How the site meets ${posture.persona_name}: the tone, the first message, what's easy to find, what quietly earns their trust.`}
        disabled={locked}
        rows={2}
        onBlur={e => { if (e.target.value !== posture.posture_summary) update({ posture_summary: e.target.value }) }}
        className="w-full text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mt-3 mb-1">Their journey through the site</p>
      <ol className="space-y-1 list-decimal list-inside">
        {posture.user_journey.map((step, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <input
              type="text"
              defaultValue={step.step_label}
              disabled={locked}
              placeholder="Step (e.g. Lands on homepage, taps 'I'm new')"
              onBlur={e => { if (e.target.value !== step.step_label) updateStep(i, { step_label: e.target.value }) }}
              className="flex-1 text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            {!locked && (
              <button
                type="button"
                onClick={() => removeStep(i)}
                className="text-wm-text-subtle hover:text-wm-danger text-[15px] leading-none px-1"
              >×</button>
            )}
          </li>
        ))}
      </ol>
      {!locked && (
        <button
          type="button"
          onClick={addStep}
          className="mt-1 text-[11px] font-semibold text-wm-accent-strong hover:underline"
        >
          + Add step
        </button>
      )}
    </div>
  )
}

/** Renders one nav region (primary or secondary) with a label header
 *  and a scannable item list. Tone changes the visual weight so
 *  primary reads as the loud one and secondary reads as supportive. */
function NavRegionPreview({
  label, items, hint, tone,
}: {
  label: string
  items: NavItem[]
  hint?: string
  tone:  'primary' | 'secondary'
}) {
  if (items.length === 0) {
    return <p className="text-[13px] text-wm-text-muted italic">No {tone} nav items proposed yet.</p>
  }
  const containerCls = tone === 'primary'
    ? 'rounded-lg border border-wm-border bg-white p-4'
    : 'rounded-lg border border-wm-border/70 bg-wm-bg-elevated/60 p-4'
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">{label}</p>
      {hint && <p className="text-[11.5px] text-wm-text-subtle mb-2">{hint}</p>}
      <nav className={containerCls}>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {items.map((it, i) => (
            <li key={i} className={`text-[14px] ${tone === 'primary' ? 'font-semibold text-wm-text' : 'font-medium text-wm-text-muted'}`}>
              {it.label}
              {it.slug && <code className="ml-1 text-[10.5px] font-mono text-wm-text-subtle">/{it.slug}</code>}
              {it.children && it.children.length > 0 && (
                <ul className="ml-4 mt-1 space-y-0.5">
                  {it.children.map((c, j) => (
                    <li key={j} className="text-[12.5px] font-normal text-wm-text-muted">
                      · {c.label} {c.slug && <code className="text-[10px] font-mono">/{c.slug}</code>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function MigrationPortalCard({
  migration, review, onChange, locked,
}: {
  migration: ContentMigration
  review:    SitemapReview
  onChange:  (next: SitemapReview) => Promise<void> | void
  locked:    boolean
}) {
  const update = (patch: Partial<ContentMigration>) => {
    void onChange({
      ...review,
      content_migrations: review.content_migrations.map(m => m.id === migration.id ? { ...m, ...patch } : m),
    })
  }
  return (
    <div className="rounded-lg border border-wm-border bg-white p-4">
      <div className="flex items-baseline gap-2 flex-wrap mb-2">
        <span className="text-[13px] font-semibold text-wm-text">
          {migration.merged_from.join(' + ') || 'Old page(s)'}
        </span>
        <span className="text-wm-text-subtle">→</span>
        <span className="text-[13px] font-semibold text-wm-accent-strong">
          {migration.merged_to || 'New page'}
        </span>
      </div>
      {migration.title && migration.title !== `${migration.merged_from.join(' + ')} → ${migration.merged_to}` && (
        <p className="text-[13px] font-bold text-wm-text mb-1">{migration.title}</p>
      )}
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Why</p>
      <textarea
        defaultValue={migration.rationale}
        placeholder="Why this change makes sense (edit if it doesn't feel right)"
        disabled={locked}
        rows={2}
        onBlur={e => { if (e.target.value !== migration.rationale) update({ rationale: e.target.value }) }}
        className="w-full text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />
    </div>
  )
}

// ── Chrome ───────────────────────────────────────────────────────────

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-wm-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {children}
      </div>
    </div>
  )
}

function PortalSection({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[18px] font-bold text-wm-text mb-1">{title}</h2>
      {description && (
        <p className="text-[12.5px] text-wm-text-muted mb-3">{description}</p>
      )}
      {children}
    </section>
  )
}

/** Full-width accent callout used for the executive summary. Tinted
 *  background + accent border so it reads as the strategic opener,
 *  distinct from the per-page cards below. */
function PortalCallout({
  title, children, tone = 'accent',
}: { title: string; children: React.ReactNode; tone?: 'accent' | 'neutral' }) {
  const cls = tone === 'accent'
    ? 'border-wm-accent/40 bg-wm-accent-tint/40'
    : 'border-wm-border bg-white'
  return (
    <section className={`rounded-xl border-2 ${cls} p-5`}>
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">{title}</p>
      {children}
    </section>
  )
}

/** Textarea-when-editable / paragraph-when-locked. Persists on blur. */
function MultilineText({
  value, onSave, placeholder, rows = 4, className = '',
}: {
  value:       string
  onSave:      ((v: string) => void) | null
  placeholder: string
  rows?:       number
  className?:  string
}) {
  if (!onSave) {
    return value ? (
      <div className={`whitespace-pre-wrap ${className}`}>{value}</div>
    ) : (
      <p className={`italic text-wm-text-subtle ${className}`}>{placeholder}</p>
    )
  }
  return (
    <textarea
      defaultValue={value}
      placeholder={placeholder}
      rows={rows}
      onBlur={e => { if (e.target.value !== value) onSave(e.target.value) }}
      className={`w-full bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-wm-accent focus:rounded resize-vertical ${className}`}
    />
  )
}

/** Footer section renders the site-wide contact + link block as a
 *  clean read-only preview. Editing footer info happens on the staff
 *  side; partners see the block to verify accuracy and flag anything
 *  wrong in the partner_notes textarea at the bottom of the page. */
function FooterPortalSection({ footer }: { footer: FooterInfo }) {
  const hasAny =
    footer.church_name ||
    footer.address ||
    footer.phone ||
    footer.email ||
    footer.office_hours ||
    footer.newsletter_signup_url ||
    (footer.social_links && footer.social_links.length > 0) ||
    (footer.footer_page_links && footer.footer_page_links.length > 0)
  if (!hasAny) return null

  return (
    <PortalSection
      title="Footer information"
      description="The contact block and page links that sit at the bottom of every page. Confirm these read correctly for your church today."
    >
      <div className="rounded-lg border border-wm-border bg-white p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-8 text-[13.5px] text-wm-text">
          {footer.church_name && <FooterRow label="Church name"  value={footer.church_name} />}
          {footer.address     && <FooterRow label="Address"      value={footer.address} />}
          {footer.phone       && <FooterRow label="Phone"        value={footer.phone} />}
          {footer.email       && <FooterRow label="Email"        value={footer.email} />}
          {footer.office_hours && <FooterRow label="Office hours" value={footer.office_hours} />}
          {footer.newsletter_signup_url && (
            <FooterRow
              label="Newsletter"
              value={
                <a href={footer.newsletter_signup_url} target="_blank" rel="noopener noreferrer" className="text-wm-accent-strong underline break-all">
                  {footer.newsletter_signup_url}
                </a>
              }
            />
          )}
        </div>
        {footer.social_links && footer.social_links.length > 0 && (
          <div className="mt-4">
            <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">Social</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {footer.social_links.map((s, i) => (
                <li key={`${s.platform}-${i}`}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-wm-accent-strong underline capitalize">
                    {s.platform}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {footer.footer_page_links && footer.footer_page_links.length > 0 && (
          <div className="mt-4">
            <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">Footer page links</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {footer.footer_page_links.map((l, i) => (
                <li key={i}>
                  <span className="text-wm-text">{l.label}</span>
                  {l.url && <span className="text-wm-text-subtle ml-1">({l.url})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PortalSection>
  )
}

function FooterRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">{label}</p>
      <div className="text-[13.5px] text-wm-text">{value}</div>
    </div>
  )
}

function StatusPill({ status }: { status: SitemapReview['status'] }) {
  const label = {
    draft:            'Draft',
    published:        'Ready for your review',
    partner_reviewed: 'Your edits saved',
    approved:         'Approved',
  }[status]
  const cls = {
    draft:            'bg-wm-bg-elevated text-wm-text-muted border-wm-border',
    published:        'bg-blue-50 text-blue-700 border-blue-200',
    partner_reviewed: 'bg-amber-50 text-amber-800 border-amber-200',
    approved:         'bg-green-50 text-green-700 border-green-300',
  }[status]
  return (
    <span className={`inline-block text-[10.5px] uppercase tracking-wider font-bold border rounded-full px-2.5 py-0.5 ${cls}`}>
      {label}
    </span>
  )
}
