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
            This link isn't valid — the review may have been rescinded, or your team
            hasn't published it for review yet. Reach out to Church Media Squad and
            we'll get you the current link.
          </p>
        </div>
      </PortalShell>
    )
  }

  const locked = review.status === 'approved'

  return (
    <PortalShell>
      {/* Intro */}
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
          {churchName ?? 'Your church'} · sitemap review
        </p>
        <h1 className="text-[28px] md:text-[32px] font-bold text-wm-text leading-tight">
          {review.intro?.headline ?? 'Sitemap & Navigation Review'}
        </h1>
        <p className="text-[14px] text-wm-text-muted mt-3 leading-relaxed max-w-2xl">
          {review.intro?.body ?? 'Here\'s the proposed structure for your new site. Every field is editable — refine what feels off and hit Approve when you\'re happy.'}
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <StatusPill status={review.status} />
          {saving && <span className="text-[11px] text-wm-text-subtle">Saving…</span>}
          {error && <span className="text-[11px] text-red-600">Save failed: {error}</span>}
        </div>
      </header>

      <div className="space-y-8">
        {/* Pages */}
        <PortalSection title="Pages" description="What each page on your new site is for.">
          <ul className="space-y-3">
            {review.pages.map(p => (
              <PagePortalCard key={p.id} page={p} review={review} onChange={persist} locked={locked} />
            ))}
          </ul>
        </PortalSection>

        {/* Persona postures */}
        {review.persona_postures.length > 0 && (
          <PortalSection
            title="How we're speaking to each person"
            description="Site posture and user journey per persona."
          >
            <div className="space-y-4">
              {review.persona_postures.map(p => (
                <PersonaPortalCard key={p.persona_id} posture={p} review={review} onChange={persist} locked={locked} />
              ))}
            </div>
          </PortalSection>
        )}

        {/* Nav layout */}
        <PortalSection title="Navigation" description="Where each page lives in the site's main nav.">
          <NavPreview items={review.nav_layout.header} />
        </PortalSection>

        {/* Content migrations */}
        {review.content_migrations.length > 0 && (
          <PortalSection
            title="Where your content went"
            description="Pages that changed shape from your current site — what merged, and why."
          >
            <div className="space-y-3">
              {review.content_migrations.map(m => (
                <MigrationPortalCard key={m.id} migration={m} review={review} onChange={persist} locked={locked} />
              ))}
            </div>
          </PortalSection>
        )}

        {/* Partner notes */}
        <PortalSection title="Your notes" description="Anything else you want us to know.">
          <textarea
            defaultValue={review.partner_notes ?? ''}
            placeholder="Anything else you'd like us to consider — priorities, missing pages, terminology preferences…"
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
            <h2 className="text-[18px] font-bold text-wm-text mb-1">Approve this sitemap?</h2>
            <p className="text-[13px] text-wm-text-muted mb-3">
              Approving locks the sitemap as-is and unblocks the next stage of work.
              You can still ask us to reopen it if you spot something later.
            </p>
            <button
              type="button"
              onClick={() => void persist(approveReview(review, 'partner'))}
              disabled={saving}
              className="inline-flex items-center gap-2 text-[13px] font-semibold bg-wm-accent-strong text-white rounded-full px-6 py-2 hover:bg-wm-accent disabled:opacity-50"
            >
              Approve sitemap →
            </button>
          </div>
        )}
        {locked && (
          <div className="rounded-lg border-2 border-green-400 bg-green-50 p-5 text-center">
            <h2 className="text-[18px] font-bold text-green-800 mb-1">Approved</h2>
            <p className="text-[13px] text-green-700">
              This sitemap is locked as the official direction. Any further changes need to
              go through Church Media Squad.
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
        placeholder="What this page is for — tell us if this doesn't match how you'd describe it."
        disabled={locked}
        rows={2}
        onBlur={e => { if (e.target.value !== page.purpose) update({ purpose: e.target.value }) }}
        className="w-full text-[13px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 focus:outline-none focus:border-wm-accent disabled:opacity-50"
      />
    </li>
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
        placeholder={`How the site is angled to ${posture.persona_name} — the tone, the first message, what's easy to find`}
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

function NavPreview({ items }: { items: NavItem[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-wm-text-muted italic">No nav items proposed yet.</p>
  }
  return (
    <nav className="rounded-lg border border-wm-border bg-white p-4">
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {items.map((it, i) => (
          <li key={i} className="text-[14px] font-semibold text-wm-text">
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
