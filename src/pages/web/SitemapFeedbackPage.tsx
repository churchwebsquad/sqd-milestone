/**
 * SitemapFeedbackPage — /web/:projectId/sitemap-feedback
 *
 * Staff-side dedicated view of a partner's content strategy feedback
 * (sitemap review). Renders once the partner has clicked "Share Sitemap
 * Review Feedback" and the review's status has flipped to
 * `partner_reviewed`. Entry points:
 *   - Content Engine → Step 6 "View partner feedback" button
 *   - #am-pm-web Slack notification's "View partner feedback" button
 *
 * Layout:
 *   Header      — church name + submitted-by + submitted-at
 *   Two columns —
 *     Left  (2/3): partner_edit_requests grouped by section_id, each
 *                  row shows the comment, suggested change, and the
 *                  original review content for that section side-by-side.
 *     Right (1/3): a ready-to-paste cowork prompt containing every
 *                  feedback item in a shape the plan-site-strategy
 *                  cowork skill can consume, plus a "mark all resolved
 *                  & approve" action once the strategist has applied
 *                  the edits.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  loadSitemapReview,
  saveSitemapReview,
  approveReview,
  type SitemapReview,
  type PartnerEditRequest,
} from '../../lib/sitemapReview'

interface ProjectSummary {
  id:          string
  member:      number | null
  name:        string | null
  church_name: string | null
}

/** Group edit requests by section_id so multiple notes on the same
 *  section render together. Preserves the order the partner left them
 *  within each section. */
function groupBySection(reqs: PartnerEditRequest[]): Array<{ section_id: string; section_label: string; items: PartnerEditRequest[] }> {
  const map = new Map<string, { section_id: string; section_label: string; items: PartnerEditRequest[] }>()
  for (const r of reqs) {
    const key = r.section_id
    if (!map.has(key)) map.set(key, { section_id: key, section_label: r.section_label, items: [] })
    map.get(key)!.items.push(r)
  }
  return [...map.values()]
}

/** Render the original review content for a section, so the strategist
 *  sees exactly what the partner was looking at when they left their
 *  note. Falls back to a compact "n/a" pill when the section id doesn't
 *  match a known slot on the review (e.g. legacy section id from an
 *  older schema version). */
function contextForSection(review: SitemapReview, sectionId: string): { label: string; body: string | null } {
  // page-<slug> → look up the page
  if (sectionId.startsWith('page-')) {
    const slug = sectionId.slice(5)
    const page = review.pages.find(p => p.slug === slug)
    if (page) {
      return {
        label: `Page: ${page.name ?? slug}`,
        body: [
          page.purpose ? `Purpose: ${page.purpose}` : null,
          page.primary_audience ? `Audience: ${page.primary_audience}` : null,
          page.primary_funnel ? `Funnel: ${page.primary_funnel}` : null,
        ].filter(Boolean).join('\n') || null,
      }
    }
    return { label: `Page: ${slug}`, body: null }
  }
  if (sectionId === 'intro') {
    return { label: 'Introduction', body: review.intro ? `${review.intro.headline}\n\n${review.intro.body}` : null }
  }
  if (sectionId === 'executive-summary' || sectionId === 'what-changed') {
    return { label: 'Executive summary / what changed', body: review.executive_summary ?? null }
  }
  if (sectionId === 'why' || sectionId === 'navigation-strategy') {
    return { label: 'Navigation strategy', body: review.navigation_strategy ?? null }
  }
  if (sectionId === 'nav-primary') {
    return { label: 'Primary nav', body: (review.nav_layout?.primary ?? []).join(' · ') || null }
  }
  if (sectionId === 'nav-secondary') {
    return { label: 'Secondary nav', body: (review.nav_layout?.secondary ?? []).join(' · ') || null }
  }
  if (sectionId === 'footer') {
    return { label: 'Footer', body: review.footer_info ? JSON.stringify(review.footer_info, null, 2) : null }
  }
  if (sectionId === 'hubs') {
    return { label: 'Persona hubs', body: (review.persona_postures ?? []).map(p => `${p.persona_name}: ${p.goal ?? ''}`).join('\n') || null }
  }
  return { label: sectionId, body: null }
}

/** Compose a cowork prompt the strategist can paste into a Content
 *  Engine session to re-emit site_strategy after applying feedback.
 *  The plan-site-strategy skill knows how to read partner_edit_requests
 *  off the review, but a paste-ready summary is faster for AMs. */
function buildCoworkPrompt(review: SitemapReview, projectId: string, churchName: string | null): string {
  const church = churchName ?? 'this partner'
  const openReqs = (review.partner_edit_requests ?? []).filter(r => r.status === 'open')
  const overallNotes = review.partner_notes?.trim() ?? ''

  const lines: string[] = []
  lines.push(`The partner (${church}) submitted feedback on the sitemap review for project ${projectId}. Apply the following changes and re-emit site_strategy following the plan-site-strategy skill's contract.`)
  lines.push('')
  lines.push(`Submitted ${review.partner_reviewed_at ?? 'recently'}${review.partner_reviewed_by ? ` by ${review.partner_reviewed_by}` : ''}.`)
  lines.push('')

  if (overallNotes) {
    lines.push('## Overall notes')
    lines.push(overallNotes)
    lines.push('')
  }

  if (openReqs.length > 0) {
    lines.push('## Section notes')
    const grouped = groupBySection(openReqs)
    for (const group of grouped) {
      lines.push(`### ${group.section_label} (\`${group.section_id}\`)`)
      for (const r of group.items) {
        lines.push(`- ${r.comment}${r.author_name ? ` — ${r.author_name}` : ''}`)
        if (r.suggested_change) lines.push(`  Suggested change: ${r.suggested_change}`)
      }
      lines.push('')
    }
  }

  lines.push('## What to do')
  lines.push('1. Read the plan-site-strategy skill in cowork-skills/plan-site-strategy/SKILL.md.')
  lines.push('2. Apply each item above to `roadmap_state.site_strategy` (pages, nav, per-page purpose/audience/funnel, presentation, tiers, congregations, footer) as appropriate.')
  lines.push('3. Re-emit site_strategy end-to-end, including nav_presentation. Do a nav-sweep on any page that gets renamed or removed so no stale slugs remain in nav.primary/secondary/footer, nav_presentation.*, persona_journeys, presentation.tiers/congregations, or stage_2.nav_presentation.')
  lines.push('4. Do NOT change fields the partner did not ask about. Leave strategist-authored fields intact unless a note explicitly asks for a change.')
  lines.push('5. When done, re-open /web/' + projectId + '/sitemap-feedback and mark this batch resolved.')
  return lines.join('\n')
}

export default function SitemapFeedbackPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [review, setReview]   = useState<SitemapReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [copied, setCopied]   = useState(false)

  const reload = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    const [projRes, rev] = await Promise.all([
      supabase.from('strategy_web_projects').select('id, member, name, church_name').eq('id', projectId).maybeSingle<ProjectSummary>(),
      loadSitemapReview(supabase, projectId),
    ])
    if (projRes.error) setError(projRes.error.message)
    setProject(projRes.data ?? null)
    setReview(rev)
    setLoading(false)
  }, [projectId])

  useEffect(() => { void reload() }, [reload])

  const openReqs = useMemo(
    () => review ? (review.partner_edit_requests ?? []).filter(r => r.status === 'open') : [],
    [review],
  )
  const groups = useMemo(() => groupBySection(openReqs), [openReqs])

  const prompt = useMemo(
    () => review ? buildCoworkPrompt(review, projectId ?? '', project?.church_name ?? null) : '',
    [review, projectId, project?.church_name],
  )

  const copyPrompt = useCallback(async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('Could not copy — select the text and copy manually.')
    }
  }, [prompt])

  const markOneResolved = useCallback(async (id: string) => {
    if (!review || !projectId) return
    const next: SitemapReview = {
      ...review,
      partner_edit_requests: (review.partner_edit_requests ?? []).map(r =>
        r.id === id ? { ...r, status: 'resolved' as const } : r,
      ),
    }
    setSaving(true)
    const res = await saveSitemapReview(supabase, projectId, next)
    setSaving(false)
    if (res.ok) {
      setReview(next)
    } else {
      setError(res.error)
    }
  }, [review, projectId])

  const markAllResolvedAndApprove = useCallback(async () => {
    if (!review || !projectId) return
    if (!confirm('Mark every partner note resolved and approve the sitemap as canonical? Downstream tools will read from it.')) return
    const withResolved: SitemapReview = {
      ...review,
      partner_edit_requests: (review.partner_edit_requests ?? []).map(r => ({ ...r, status: 'resolved' as const })),
    }
    const approved = approveReview(withResolved, 'staff')
    setSaving(true)
    const res = await saveSitemapReview(supabase, projectId, approved)
    setSaving(false)
    if (res.ok) setReview(approved)
    else setError(res.error)
  }, [review, projectId])

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-8 flex items-center gap-2 text-wm-text-muted text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading partner feedback…
      </div>
    )
  }

  if (error && !review) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <p className="text-wm-danger">{error}</p>
        <Link to={`/web/${projectId ?? ''}?tab=cowork`} className="text-wm-accent underline text-sm">Back to Content Engine</Link>
      </div>
    )
  }

  if (!review) {
    return (
      <div className="max-w-3xl mx-auto p-8 space-y-3">
        <h1 className="text-lg font-semibold text-wm-text">No content strategy review yet</h1>
        <p className="text-wm-text-muted text-[13px]">
          There isn't a content strategy review for this project yet, so there's nothing to review. Head back to the Content Engine, run Step 6, and use <strong>Create content strategy review</strong> to draft one.
        </p>
        <Link to={`/web/${projectId ?? ''}?tab=cowork`} className="inline-flex items-center gap-1 text-wm-accent text-[13px] font-semibold hover:underline">
          <ArrowLeft size={13} /> Back to Content Engine
        </Link>
      </div>
    )
  }

  const submittedAt = review.partner_reviewed_at
    ? new Date(review.partner_reviewed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  const isApproved = review.status === 'approved'
  const hasOverall = !!review.partner_notes?.trim()

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 space-y-6">
      <div>
        <Link to={`/web/${projectId ?? ''}?tab=cowork`} className="inline-flex items-center gap-1 text-wm-text-muted hover:text-wm-text text-[12px]">
          <ArrowLeft size={12} /> Back to Content Engine
        </Link>
        <h1 className="text-2xl font-semibold text-wm-text mt-2">
          {project?.church_name ?? 'Partner'} content strategy feedback
        </h1>
        <p className="text-wm-text-muted text-[13px] mt-1">
          {review.partner_reviewed_by
            ? <>Submitted by <strong className="text-wm-text">{review.partner_reviewed_by}</strong></>
            : 'Submitted by the partner'}
          {submittedAt && <> · {submittedAt}</>}
          {isApproved && (
            <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-wm-success-bg text-wm-success">
              <Check size={10} /> Approved as canonical
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feedback list */}
        <section className="lg:col-span-2 space-y-4">
          {hasOverall && (
            <article className="rounded-xl border border-wm-border bg-wm-bg-elevated p-4">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">Overall notes</p>
              <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-wm-text">{review.partner_notes}</p>
            </article>
          )}

          {groups.length === 0 && !hasOverall && (
            <article className="rounded-xl border border-wm-border bg-wm-bg-elevated p-6 text-center">
              <p className="text-wm-text font-medium">No open partner notes.</p>
              <p className="text-wm-text-muted text-[12px] mt-1">
                Everything on this review has already been resolved. If the partner needs to send more, they can come back to their review portal.
              </p>
            </article>
          )}

          {groups.map(group => {
            const context = contextForSection(review, group.section_id)
            return (
              <article key={group.section_id} className="rounded-xl border border-wm-border bg-wm-bg-elevated overflow-hidden">
                <header className="px-4 py-3 border-b border-wm-border flex items-baseline justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">{group.section_label}</p>
                    <p className="text-[11px] text-wm-text-muted font-mono mt-0.5">{group.section_id}</p>
                  </div>
                  <span className="text-[11px] text-wm-text-muted shrink-0">
                    {group.items.length} note{group.items.length === 1 ? '' : 's'}
                  </span>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                  <div className="space-y-3">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Partner said</p>
                    <ul className="space-y-3">
                      {group.items.map(r => (
                        <li key={r.id} className="rounded-md border border-wm-border bg-wm-bg p-3">
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <span className="text-[12px] font-semibold text-wm-text">{r.author_name || 'Partner'}</span>
                            <span className="text-[10.5px] text-wm-text-subtle">
                              {new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-[13px] text-wm-text whitespace-pre-wrap leading-snug">{r.comment}</p>
                          {r.suggested_change && (
                            <div className="mt-2 pt-2 border-t border-dashed border-wm-border">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-wm-accent-strong mb-0.5">Suggested change</p>
                              <p className="text-[12.5px] text-wm-text whitespace-pre-wrap leading-snug">{r.suggested_change}</p>
                            </div>
                          )}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void markOneResolved(r.id)}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
                          >
                            <Check size={11} /> Mark resolved
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">What the partner was looking at</p>
                    {context.body ? (
                      <pre className="whitespace-pre-wrap text-[12.5px] text-wm-text bg-wm-bg rounded-md border border-wm-border p-3 leading-snug">{context.body}</pre>
                    ) : (
                      <p className="text-[12px] text-wm-text-muted italic">No matching section content found on the current draft, this note likely references a page or section that has since been renamed or removed.</p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </section>

        {/* Cowork prompt */}
        <aside className="lg:col-span-1">
          <div className="rounded-xl border border-wm-border bg-wm-bg-elevated overflow-hidden lg:sticky lg:top-6">
            <header className="px-4 py-3 border-b border-wm-border">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Ready-to-paste cowork prompt</p>
              <p className="text-[11px] text-wm-text-muted mt-1">
                Copy this and paste into a plan-site-strategy Cowork session to apply the feedback.
              </p>
            </header>
            <textarea
              readOnly
              value={prompt}
              className="w-full text-[11.5px] font-mono text-wm-text bg-wm-bg leading-snug px-4 py-3 border-b border-wm-border outline-none resize-y min-h-[240px]"
            />
            <div className="p-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void copyPrompt()}
                disabled={!prompt}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy prompt'}
              </button>
              {!isApproved && (
                <button
                  type="button"
                  onClick={() => void markAllResolvedAndApprove()}
                  disabled={saving}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-wm-success/50 text-wm-success hover:bg-wm-success-bg disabled:opacity-50"
                  title="Mark every note resolved and lock the sitemap as canonical for downstream tools."
                >
                  {saving ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
                  Mark all resolved &amp; approve
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
