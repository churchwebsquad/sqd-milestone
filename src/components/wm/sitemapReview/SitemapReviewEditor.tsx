/**
 * Staff-side sitemap review editor.
 *
 * Composes the review from the project's current state (personas,
 * web_pages, nav groups) via composeSitemapReview, then lets the
 * strategist edit every field — pages + purposes, persona postures +
 * journeys, nav layout, content-consolidation rationale. Publishes
 * to a shareable partner URL when ready; approves it as canonical
 * once the partner has weighed in.
 *
 * Mounted as a modal-ish overlay from CopyEngineWorkspace. The
 * partner-facing portal reads the same data via a public RPC and
 * writes back through a token-gated save path (see sitemapReview.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  approveReview,
  composeSitemapReview,
  loadSitemapReview,
  publishReview,
  saveSitemapReview,
  type ContentMigration,
  type JourneyStep,
  type NavItem,
  type NavLayout,
  type PersonaPosture,
  type ReviewPage,
  type SitemapReview,
} from '../../../lib/sitemapReview'
import { buildPortalUrl } from '../../../lib/portalUrl'

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const existing = await loadSitemapReview(supabase, projectId)
    if (existing) {
      setReview(existing)
      setLoading(false)
      return
    }
    // No review yet — compose one from current project state.
    // Pull roadmap_state so composeSitemapReview can read
    // site_strategy (the cowork sitemap step output — has rich
    // per-page purposes, primary_audience, funnel_stage, curated nav,
    // persona journeys, and pages_considered_dropped for the "where
    // content went" section). Without site_strategy every field starts
    // blank; with it, the review pre-fills with the strategist's work.
    const [{ data: proj }, { data: pgs }] = await Promise.all([
      supabase.from('strategy_web_projects')
        .select('id, church_name, personas, nav_group_definitions, roadmap_state')
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
      existing: null,
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
  const inner = embed
    ? 'flex flex-col h-full'
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
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <IntroEditor review={review} onChange={persist} disabled={isApproved} />
          <PagesEditor review={review} onChange={persist} disabled={isApproved} />
          <PersonaPosturesEditor review={review} onChange={persist} disabled={isApproved} />
          <NavLayoutEditor review={review} onChange={persist} disabled={isApproved} />
          <ContentMigrationsEditor review={review} onChange={persist} disabled={isApproved} />
        </div>

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
            {(p.primary_audience || p.funnel_stage) && (
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
              </div>
            )}
            <textarea
              defaultValue={p.purpose}
              placeholder="What this page is for — 1-2 sentences the partner will read"
              disabled={disabled}
              rows={2}
              onBlur={e => { if (e.target.value !== p.purpose) updatePage(p.id, { purpose: e.target.value }) }}
              className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
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
  const addJourney = (id: string) => {
    const p = review.persona_postures.find(pp => pp.persona_id === id)
    if (!p) return
    updatePosture(id, { user_journey: [...p.user_journey, { step_label: '' }] })
  }
  const removeJourney = (id: string, idx: number) => {
    const p = review.persona_postures.find(pp => pp.persona_id === id)
    if (!p) return
    updatePosture(id, { user_journey: p.user_journey.filter((_, i) => i !== idx) })
  }
  const updateJourney = (id: string, idx: number, patch: Partial<JourneyStep>) => {
    const p = review.persona_postures.find(pp => pp.persona_id === id)
    if (!p) return
    updatePosture(id, { user_journey: p.user_journey.map((s, i) => i === idx ? { ...s, ...patch } : s) })
  }
  if (review.persona_postures.length === 0) {
    return (
      <Section title="Persona postures" subtitle="One posture per project persona">
        <p className="text-[12px] text-wm-text-muted italic">
          No personas on this project yet. Add personas in the Roadmap workspace first.
        </p>
      </Section>
    )
  }
  return (
    <Section title="Persona postures" subtitle="How the site is angled to each person + their user journey">
      <div className="space-y-3">
        {review.persona_postures.map(p => (
          <div key={p.persona_id} className="border border-wm-border rounded p-3 bg-wm-bg">
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <p className="text-[13px] font-bold text-wm-text">{p.persona_name}</p>
              {p.entry_points && p.entry_points.length > 0 && (
                <span className="text-[10.5px] text-wm-text-subtle">
                  Enters at: {p.entry_points.map(s => `/${s}`).join(', ')}
                </span>
              )}
            </div>
            {p.drop_off_risk && (
              <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-widest font-bold text-amber-800 mb-0.5">
                  Drop-off risk at /{p.drop_off_risk.at_slug}
                </p>
                <p className="text-[11.5px] text-amber-900 leading-snug">{p.drop_off_risk.reason}</p>
                {p.drop_off_risk.mitigation && (
                  <p className="text-[11px] text-amber-800 leading-snug mt-0.5">
                    <span className="font-semibold">Mitigation:</span> {p.drop_off_risk.mitigation}
                  </p>
                )}
              </div>
            )}
            <textarea
              defaultValue={p.posture_summary}
              placeholder={`How the site meets ${p.persona_name} — what they see first, how the message lands, tone`}
              disabled={disabled}
              rows={2}
              onBlur={e => { if (e.target.value !== p.posture_summary) updatePosture(p.persona_id, { posture_summary: e.target.value }) }}
              className="w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">User journey</p>
              <ol className="space-y-1 list-decimal list-inside">
                {p.user_journey.map((step, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <input
                      type="text"
                      defaultValue={step.step_label}
                      placeholder="Step (e.g. Lands on homepage, taps 'I'm new')"
                      disabled={disabled}
                      onBlur={e => { if (e.target.value !== step.step_label) updateJourney(p.persona_id, i, { step_label: e.target.value }) }}
                      className="flex-1 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                    />
                    <select
                      defaultValue={step.page_slug ?? ''}
                      disabled={disabled}
                      onChange={e => updateJourney(p.persona_id, i, { page_slug: e.target.value || undefined })}
                      className="text-[11px] text-wm-text bg-wm-bg border border-wm-border rounded px-1 py-0.5 disabled:opacity-50"
                    >
                      <option value="">(no page)</option>
                      {review.pages.map(pg => <option key={pg.slug} value={pg.slug}>/{pg.slug}</option>)}
                    </select>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => removeJourney(p.persona_id, i)}
                        className="text-wm-text-subtle hover:text-wm-danger text-[14px] leading-none px-1"
                      >×</button>
                    )}
                  </li>
                ))}
              </ol>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => addJourney(p.persona_id)}
                  className="mt-1 text-[11px] font-semibold text-wm-accent-strong hover:underline"
                >
                  + Add step
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function NavLayoutEditor({
  review, onChange, disabled,
}: { review: SitemapReview; onChange: (next: SitemapReview) => Promise<void> | void; disabled: boolean }) {
  const nav = review.nav_layout
  const setNav = (next: NavLayout) => { void onChange({ ...review, nav_layout: next }) }
  const updateHeaderItem = (idx: number, patch: Partial<NavItem>) => {
    setNav({ ...nav, header: nav.header.map((it, i) => i === idx ? { ...it, ...patch } : it) })
  }
  const addHeaderItem = () => setNav({ ...nav, header: [...nav.header, { label: '' }] })
  const removeHeaderItem = (idx: number) => setNav({ ...nav, header: nav.header.filter((_, i) => i !== idx) })
  return (
    <Section title="Navigation layout" subtitle="Header items + footer sections">
      <div className="space-y-3">
        <div>
          <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Header</p>
          <ol className="space-y-1">
            {nav.header.map((it, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <input
                  type="text"
                  defaultValue={it.label}
                  placeholder="Nav label"
                  disabled={disabled}
                  onBlur={e => { if (e.target.value !== it.label) updateHeaderItem(i, { label: e.target.value }) }}
                  className="flex-1 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent disabled:opacity-50"
                />
                <select
                  defaultValue={it.slug ?? ''}
                  disabled={disabled}
                  onChange={e => updateHeaderItem(i, { slug: e.target.value || undefined })}
                  className="text-[11px] text-wm-text bg-wm-bg border border-wm-border rounded px-1 py-0.5 disabled:opacity-50"
                >
                  <option value="">(no target)</option>
                  {review.pages.map(pg => <option key={pg.slug} value={pg.slug}>/{pg.slug}</option>)}
                </select>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeHeaderItem(i)}
                    className="text-wm-text-subtle hover:text-wm-danger text-[14px] leading-none px-1"
                  >×</button>
                )}
              </li>
            ))}
          </ol>
          {!disabled && (
            <button
              type="button"
              onClick={addHeaderItem}
              className="mt-1 text-[11px] font-semibold text-wm-accent-strong hover:underline"
            >
              + Add header item
            </button>
          )}
        </div>
        <p className="text-[10.5px] text-wm-text-subtle italic">
          Footer sections editor coming in a follow-up — for now, the partner sees the header nav preview.
        </p>
      </div>
    </Section>
  )
}

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
    <Section title="Where content went" subtitle="Consolidation rationale — e.g. Youth + Kids → Family, and why">
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
              placeholder="Why the merge — what the partner gains, what stays intact"
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

// (silence unused var lint — buildPortalUrl imported for parity with
// other portal builders; the partner sitemap URL doesn't need it yet.)
void buildPortalUrl
