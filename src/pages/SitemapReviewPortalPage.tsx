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
 *      Not-found / not-yet-published → polite unavailable screen.
 *   2. Render the Squad-palette v2 visualization
 *      (SitemapPartnerViewV2). Each section is clickable and opens a
 *      drawer to leave a scoped edit request.
 *   3. "Approve as-is" locks the review as canonical.
 *      "Share Sitemap Review Feedback" surfaces once any edit request
 *      or overall note is pending; sets status → partner_reviewed.
 *
 * Distinct from PortalReviewPage (the copy-review portal): that one
 * captures suggested edits on already-committed pages; this one is a
 * structural review of the sitemap itself, upstream of page copy.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  loadSitemapReviewByToken,
  savePartnerSitemapReview,
  approveReview,
  type PartnerEditRequest,
  type SitemapReview,
} from '../lib/sitemapReview'
import SitemapPartnerViewV2 from '../components/wm/sitemapReview/SitemapPartnerViewV2'

export default function SitemapReviewPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [review, setReview] = useState<SitemapReview | null>(null)
  const [churchName, setChurchName] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

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
      id:         cryptoRandomId(),
      created_at: new Date().toISOString(),
      status:     'open',
    }
    const next: SitemapReview = {
      ...review,
      partner_edit_requests: [...(review.partner_edit_requests ?? []), entry],
    }
    const ok = await persist(next)
    if (ok) setFlash('Note saved.')
  }, [review, persist])

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
    const approved = approveReview(review, 'partner')
    const ok = await persist(approved)
    if (ok) setFlash('Sitemap approved. Thank you!')
  }, [review, persist])

  const handleSubmitFeedback = useCallback(async () => {
    if (!review) return
    const openCount = (review.partner_edit_requests ?? []).filter(r => r.status === 'open').length
    if (!confirm(`Share your feedback with the Church Media Squad team? ${openCount} section note${openCount === 1 ? '' : 's'} plus your overall notes will be sent.`)) return
    const next: SitemapReview = { ...review, status: 'partner_reviewed' }
    const ok = await persist(next)
    if (ok) setFlash('Feedback sent. Your Squad team will review and follow up.')
  }, [review, persist])

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

  return (
    <>
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
          Save failed — {error}. Please try again.
        </div>
      )}
      <SitemapPartnerViewV2
        review={review}
        churchName={churchName}
        saving={saving}
        onAddEditRequest={locked ? () => Promise.resolve() : addEditRequest}
        onRemoveEditRequest={locked ? undefined : removeEditRequest}
        onUpdatePartnerNotes={locked ? () => Promise.resolve() : updatePartnerNotes}
        onApprove={handleApprove}
        onSubmitFeedback={handleSubmitFeedback}
      />
    </>
  )
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `per_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
