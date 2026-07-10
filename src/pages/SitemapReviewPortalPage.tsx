/**
 * Partner-facing sitemap-and-navigation review portal.
 *
 * URL: /portal/sitemap/<token>
 *   - Public (no auth). Token IS the credential. Anyone with the link
 *     can read + edit the review. Staff mints the token from the
 *     Content Engine sitemap review editor.
 *
 * v2 flow:
 *   1. Look up review by token via get_sitemap_review_by_token RPC.
 *      Not-found / not-yet-published route to a polite unavailable
 *      screen.
 *   2. Name gate. First visit prompts for the reviewer's name so every
 *      section note is credited to a real person. Stored in
 *      localStorage keyed by token so the partner isn't re-prompted on
 *      subsequent visits. Mirrors the pattern used by PortalReviewPage
 *      (the copy-review portal) so the two feel consistent.
 *   3. Render the Squad-palette v2 visualization
 *      (SitemapPartnerViewV2). Each section is clickable and opens a
 *      drawer to leave a scoped edit request. All requests carry the
 *      captured name automatically.
 *   4. "Approve as-is" locks the review as canonical.
 *      "Share Sitemap Review Feedback" surfaces once any edit request
 *      or overall note is pending; sets status to partner_reviewed.
 *
 * Distinct from PortalReviewPage (the copy-review portal): that one
 * captures suggested edits on already-committed pages; this one is a
 * structural review of the sitemap itself, upstream of page copy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  loadSitemapReviewByToken,
  savePartnerSitemapReview,
  approveReview,
  type PartnerEditRequest,
  type SitemapReview,
} from '../lib/sitemapReview'
import { supabase } from '../lib/supabase'
import SitemapPartnerViewV2 from '../components/wm/sitemapReview/SitemapPartnerViewV2'

const STORAGE_KEY = (token: string) => `sitemap_review_${token}_name`

export default function SitemapReviewPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [review, setReview] = useState<SitemapReview | null>(null)
  const [churchName, setChurchName] = useState<string | null>(null)
  const [partnerPortalToken, setPartnerPortalToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)

  // Restore partner name from localStorage on load so returning
  // visitors skip the name gate. Keyed by token so the same browser
  // hosting multiple partner links stays separated.
  useEffect(() => {
    if (!token) return
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY(token))
      if (stored) setPartnerName(stored)
    } catch {
      // localStorage unavailable (private browsing, iframe sandboxing).
      // We'll re-prompt every visit in that case, which is acceptable.
    }
  }, [token])

  const load = useCallback(async () => {
    if (!token) { setStatus('not-found'); return }
    setStatus('loading')
    const res = await loadSitemapReviewByToken(token)
    if (!res) { setStatus('not-found'); return }
    setReview(res.review)
    setChurchName(res.church_name)
    setPartnerPortalToken(res.partner_portal_token)
    setStatus('ready')
  }, [token])

  useEffect(() => { void load() }, [load])

  const persist = useCallback(async (next: SitemapReview): Promise<boolean> => {
    if (!token) return false
    setReview(next)
    setSaving(true)
    setError(null)
    const res = await savePartnerSitemapReview({ token, next })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      await load()
      return false
    }
    return true
  }, [token, load])

  const addEditRequest = useCallback(async (req: Omit<PartnerEditRequest, 'id' | 'created_at' | 'status'>) => {
    if (!review) return
    const entry: PartnerEditRequest = {
      ...req,
      author_name: req.author_name ?? partnerName ?? undefined,
      id:          cryptoRandomId(),
      created_at:  new Date().toISOString(),
      status:      'open',
    }
    const next: SitemapReview = {
      ...review,
      partner_edit_requests: [...(review.partner_edit_requests ?? []), entry],
    }
    const ok = await persist(next)
    if (ok) setFlash('Feedback shared.')
  }, [review, persist, partnerName])

  const removeEditRequest = useCallback(async (id: string) => {
    if (!review) return
    const next: SitemapReview = {
      ...review,
      partner_edit_requests: (review.partner_edit_requests ?? []).filter(r => r.id !== id),
    }
    await persist(next)
  }, [review, persist])

  const updatePartnerNotes = useCallback(async (notes: string) => {
    if (!review) return
    await persist({ ...review, partner_notes: notes })
  }, [review, persist])

  const handleApprove = useCallback(async () => {
    if (!review) return
    if (!confirm('Approve this sitemap as your website structure? Downstream steps will read from it as canonical.')) return
    // Stamp who submitted so the Slack notif to #am-pm-web credits
    // them; matches the partner_reviewed path.
    const approved: SitemapReview = {
      ...approveReview(review, 'partner'),
      partner_reviewed_at: new Date().toISOString(),
      partner_reviewed_by: partnerName ?? null,
    }
    const ok = await persist(approved)
    if (ok) {
      setFlash('Sitemap approved. Thank you!')
      if (token) {
        void supabase.functions.invoke('notify-sitemap-feedback-submitted', {
          body: { token },
        }).catch(err => {
          console.warn('[sitemap-feedback] notify invoke failed:', err)
        })
      }
    }
  }, [review, persist, partnerName, token])

  const handleSubmitFeedback = useCallback(async () => {
    if (!review) return
    const openCount = (review.partner_edit_requests ?? []).filter(r => r.status === 'open').length
    if (!confirm(`Share your feedback with the Church Media Squad team? ${openCount} section note${openCount === 1 ? '' : 's'} plus your overall notes will be sent.`)) return
    const submittedAt = new Date().toISOString()
    const next: SitemapReview = {
      ...review,
      status:              'partner_reviewed',
      partner_reviewed_at: submittedAt,
      partner_reviewed_by: partnerName ?? null,
    }
    const ok = await persist(next)
    if (ok) {
      setFlash('Feedback sent. Your Squad team will review and follow up.')
      // Fire-and-forget Slack notification to #am-pm-web so the AM
      // knows partner feedback landed without polling the composer.
      // Matches the notify-content-collection-submitted /
      // notify-copy-review-submitted pattern. Failures are logged
      // server-side; we don't block the partner UX on it.
      if (token) {
        void supabase.functions.invoke('notify-sitemap-feedback-submitted', {
          body: { token },
        }).catch(err => {
          console.warn('[sitemap-feedback] notify invoke failed:', err)
        })
      }
    }
  }, [review, persist, partnerName, token])

  const submitName = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed || !token) return
    try { window.localStorage.setItem(STORAGE_KEY(token), trimmed) } catch { /* ignore */ }
    setPartnerName(trimmed)
  }, [token])

  const projectName = useMemo(() => churchName ?? 'your church', [churchName])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F9F5F1', color: '#341756', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" }}>
        <p>Loading your review…</p>
      </div>
    )
  }
  if (status === 'not-found' || !review) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F9F5F1', color: '#341756', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" }}>
        <div style={{ maxWidth: 480, textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Review not available</h1>
          <p style={{ color: '#6B6180', lineHeight: 1.6 }}>
            This link isn't valid. Your review may have been rescinded, or your team
            hasn't published it yet. Reach out to Church Media Squad and we'll get you
            the current link.
          </p>
        </div>
      </div>
    )
  }

  const locked = review.status === 'approved'

  // Name gate. Partner does not see the review until they say who
  // they are so every note carries their name. Skipped for locked
  // reviews (read-only viewing) so we don't harass someone who's
  // just checking the approved artifact.
  if (!partnerName && !locked) {
    return <NameGate projectName={projectName} onSubmit={submitName} />
  }

  return (
    <>
      {partnerPortalToken && (
        <div style={{ background: '#EDE9FC', textAlign: 'center', padding: '8px 20px', fontSize: 12.5, borderBottom: '1px solid #CFC9F8' }}>
          <a
            href={`/portal/${partnerPortalToken}`}
            style={{ color: '#513DE5', fontWeight: 600, textDecoration: 'none' }}
          >
            ← Back to your review hub
          </a>
        </div>
      )}
      {locked && (
        <div style={{ background: '#3f7d55', color: '#fff', textAlign: 'center', padding: '10px 20px', fontSize: 13, fontWeight: 620, letterSpacing: '.04em', textTransform: 'uppercase' }}>
          ✓ Approved · locked as canonical
        </div>
      )}
      {flash && (
        <div
          role="status"
          style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#341756', color: '#fff', padding: '12px 22px', borderRadius: 999, fontSize: 13, fontWeight: 620, boxShadow: '0 20px 40px -20px rgba(52,23,86,.6)', zIndex: 100 }}
          onAnimationEnd={() => setFlash(null)}
        >{flash}</div>
      )}
      {error && (
        <div style={{ background: '#FBE0E0', color: '#7A1A1A', textAlign: 'center', padding: '10px 20px', fontSize: 13 }}>
          Save failed. {error}. Please try again.
        </div>
      )}
      <SitemapPartnerViewV2
        review={review}
        churchName={churchName}
        saving={saving}
        authorName={partnerName ?? undefined}
        onAddEditRequest={locked ? () => Promise.resolve() : addEditRequest}
        onRemoveEditRequest={locked ? undefined : removeEditRequest}
        onUpdatePartnerNotes={locked ? () => Promise.resolve() : updatePartnerNotes}
        onApprove={handleApprove}
        onSubmitFeedback={handleSubmitFeedback}
      />
    </>
  )
}

// Full-screen name capture shown on first visit. Follows the same
// pattern as PortalReviewPage's NameGate so partners recognize the
// prompt across reviews.
function NameGate({ projectName, onSubmit }: { projectName: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F9F5F1',
        fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
        padding: 24,
      }}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(name) }}
        style={{
          maxWidth: 440, width: '100%',
          background: '#fff', border: '1px solid #CFC9F8', borderRadius: 16,
          padding: '28px 28px 24px', textAlign: 'center',
          boxShadow: '0 20px 40px -20px rgba(52,23,86,.25)',
        }}
      >
        <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#513DE5', margin: 0 }}>{projectName}</p>
        <h1 style={{ fontSize: 22, fontWeight: 650, color: '#341756', margin: '6px 0 8px' }}>Welcome to your sitemap review</h1>
        <p style={{ fontSize: 13.5, color: '#6B6180', lineHeight: 1.55, margin: '0 0 20px' }}>
          Let us know who's reviewing so your Church Media Squad can credit your feedback.
        </p>
        <label style={{ display: 'block', textAlign: 'left', marginBottom: 18 }}>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#6B6180', marginBottom: 6 }}>Your name</span>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            placeholder="Pastor Chris"
            style={{
              width: '100%',
              padding: '11px 16px',
              borderRadius: 999,
              border: '1px solid #CFC9F8',
              background: '#fff',
              color: '#341756',
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#341756', color: '#fff', border: 'none',
            padding: '10px 22px', borderRadius: 999,
            fontSize: 13.5, fontWeight: 650, cursor: 'pointer',
            opacity: name.trim() ? 1 : 0.5,
          }}
        >
          Start reviewing →
        </button>
      </form>
    </div>
  )
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `per_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
