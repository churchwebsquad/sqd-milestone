import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileEdit, Plus, X, Check, Link as LinkIcon, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { parseCopyReviewHtml } from '../../lib/parseCopyReviewHtml'
import type { StrategyCopyReview, CopyReviewStatus } from '../../types/database'
import { SectionHeader } from './ChurchUI'

const STATUS_BADGE: Record<CopyReviewStatus, string> = {
  draft: 'bg-purple-gray/10 text-purple-gray',
  open: 'bg-primary-purple/10 text-primary-purple',
  submitted: 'bg-amber-100 text-amber-700',
  finalized: 'bg-green-100 text-green-700',
}

interface Props {
  memberId: number
  portalToken: string | null | undefined
}

export default function CopyReviewSection({ memberId, portalToken }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reviews, setReviews] = useState<StrategyCopyReview[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [portalCopiedFor, setPortalCopiedFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('strategy_copy_reviews')
        .select('*')
        .eq('member', memberId)
        .order('created_at', { ascending: false })
      if (!cancelled) {
        setReviews((data ?? []) as StrategyCopyReview[])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [memberId])

  const handleCreated = (newReview: StrategyCopyReview) => {
    setReviews(prev => [newReview, ...prev])
    setModalOpen(false)
    navigate(`/churches/${memberId}/copy-review/${newReview.id}`)
  }

  const handleCopyPortalLink = (reviewId: string) => {
    const token = portalToken ?? ''
    if (!token) return
    const url = `${window.location.origin}/portal/${token}/copy-review`
    navigator.clipboard.writeText(url).then(() => {
      setPortalCopiedFor(reviewId)
      setTimeout(() => setPortalCopiedFor(null), 2000)
    })
  }

  return (
    <div id="copy-review" className="bg-white border border-lavender rounded-2xl p-5 md:p-6 shadow-sm scroll-mt-4">
      <SectionHeader
        icon={FileEdit}
        title="Copy Review"
        theme="web"
        action={
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple transition-colors"
          >
            <Plus size={11} /> New Review
          </button>
        }
      />

      {loading ? (
        <div className="h-12 rounded-lg bg-lavender-tint/40 animate-pulse" />
      ) : reviews.length === 0 ? (
        <p className="text-sm text-purple-gray">
          No copy reviews yet. Upload a Notion-exported HTML doc to create the first one.
        </p>
      ) : (
        <div className="space-y-2">
          {reviews.map(r => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-xl border border-lavender bg-white px-4 py-3 hover:bg-lavender-tint/30 transition-colors"
            >
              <button
                type="button"
                onClick={() => navigate(`/churches/${memberId}/copy-review/${r.id}`)}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium text-deep-plum truncate">{r.title}</p>
                <p className="text-xs text-purple-gray mt-0.5">
                  {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {r.submitted_at ? ` · submitted ${new Date(r.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                </p>
              </button>

              <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${STATUS_BADGE[r.status]}`}>
                {r.status}
              </span>

              {r.status !== 'draft' && portalToken && (
                <button
                  type="button"
                  onClick={() => handleCopyPortalLink(r.id)}
                  title="Copy partner link"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-full hover:bg-lavender-tint text-purple-gray hover:text-primary-purple transition-colors"
                >
                  {portalCopiedFor === r.id ? <Check size={11} className="text-green-600" /> : <LinkIcon size={11} />}
                </button>
              )}

              <button
                type="button"
                onClick={() => navigate(`/churches/${memberId}/copy-review/${r.id}`)}
                className="text-xs text-primary-purple font-semibold hover:underline shrink-0"
              >
                Open <ExternalLink size={10} className="inline -mt-0.5 ml-0.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <UploadModal
          memberId={memberId}
          userId={user?.id ?? null}
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

// ── Upload modal ────────────────────────────────────────────────────────────

interface UploadModalProps {
  memberId: number
  userId: string | null
  onClose: () => void
  onCreated: (review: StrategyCopyReview) => void
}

function UploadModal({ memberId, userId, onClose, onCreated }: UploadModalProps) {
  const [title, setTitle] = useState('')
  const [html, setHtml] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ pages: number; sections: number; blocks: number } | null>(null)

  const handleParse = () => {
    setError(null)
    setPreview(null)
    try {
      const parsed = parseCopyReviewHtml(html)
      if (parsed.pages.length === 0) {
        setError('No pages found in the HTML. Make sure this is a Notion export containing toggle pages.')
        return
      }
      const sections = parsed.pages.reduce((n, p) => n + p.sections.length, 0)
      const blocks = parsed.pages.reduce((n, p) => n + p.sections.reduce((m, s) => m + s.blocks.length, 0), 0)
      setPreview({ pages: parsed.pages.length, sections, blocks })
      if (!title.trim()) setTitle(parsed.title)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to parse HTML')
    }
  }

  const handleSubmit = async () => {
    setError(null)
    if (!html.trim()) { setError('Paste the HTML export first.'); return }
    const parsed = (() => {
      try { return parseCopyReviewHtml(html) } catch { return null }
    })()
    if (!parsed || parsed.pages.length === 0) {
      setError('Parsing failed. Run Parse Preview first to diagnose.')
      return
    }
    const finalTitle = title.trim() || parsed.title

    setBusy(true)
    const { data, error: insertErr } = await supabase
      .from('strategy_copy_reviews')
      .insert({
        member: memberId,
        title: finalTitle,
        status: 'draft',
        source_html: html,
        parsed,
        submitted_at: null,
        finalized_at: null,
        created_by: userId,
      })
      .select()
      .single()
    setBusy(false)

    if (insertErr || !data) {
      setError(insertErr?.message ?? 'Failed to save review')
      return
    }
    onCreated(data as StrategyCopyReview)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deep-plum/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-lavender shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-lavender bg-lavender-tint/40">
          <h3 className="text-sm font-bold text-deep-plum uppercase tracking-wider">Upload Copy Review</h3>
          <button type="button" onClick={onClose} className="text-purple-gray hover:text-deep-plum">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-deep-plum mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Lakeway Church — Round 1"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
            <p className="text-[11px] text-purple-gray mt-1">Leave blank to use the HTML's page title.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-deep-plum mb-1">Notion HTML export</label>
            <textarea
              value={html}
              onChange={e => { setHtml(e.target.value); setPreview(null) }}
              placeholder="Paste the full HTML contents of the Notion export here…"
              rows={10}
              className="w-full rounded-lg border border-lavender px-3 py-2 text-xs text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 font-mono"
            />
            <p className="text-[11px] text-purple-gray mt-1">
              In Notion: <span className="text-deep-plum">Export → HTML</span>, then open the resulting .html file, copy the full contents, and paste here.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {preview && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
              Parsed: <strong>{preview.pages}</strong> pages · <strong>{preview.sections}</strong> sections · <strong>{preview.blocks}</strong> blocks
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={handleParse}
              disabled={!html.trim() || busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs font-medium text-deep-plum px-3 py-1.5 hover:bg-lavender-tint disabled:opacity-40"
            >
              Parse Preview
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="text-xs text-purple-gray hover:text-deep-plum px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!html.trim() || busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-40"
              >
                {busy ? 'Uploading…' : 'Upload & Continue →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
