import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Check, ChevronDown, ChevronRight, AlertCircle, Edit3, Send,
  Save, X, Loader2, CheckCircle2, ArrowRight, Pencil,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { normalizeBlock } from '../lib/parseCopyReviewHtml'
import type {
  CopyReviewPortalPayload, CopyReviewDecision,
  ParsedCopyReviewBlock, ParsedCopyReviewPage, ParsedCopyReviewSection,
} from '../types/database'

// ── localStorage helpers ────────────────────────────────────────────────────

const NAME_KEY = 'copy-review-name:global'

function clientIdFor(reviewId: string): string {
  const key = `copy-review-client:${reviewId}`
  let id = localStorage.getItem(key)
  if (!id) {
    id = (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `c-${Math.random().toString(36).slice(2)}-${Date.now()}`
    localStorage.setItem(key, id)
  }
  return id
}
function getSavedName(): string { return localStorage.getItem(NAME_KEY) ?? '' }
function saveName(name: string) {
  const clean = name.trim()
  if (clean) localStorage.setItem(NAME_KEY, clean)
  else localStorage.removeItem(NAME_KEY)
}

// ── Block visual classification ─────────────────────────────────────────────

type DisplayKind = 'h1' | 'h2' | 'h3' | 'subhead' | 'cta' | 'eyebrow' | 'body' | 'meta' | 'card' | 'unknown'

const META_LABEL_RX = /(primary keyword|secondary keyword|metadata title|metadata description|aeo|smart snippet|image alt|alt text)/
const CARD_PREFIX_RX = /^\[(.+?)\]\s*(.+)$/

function classify(block: ParsedCopyReviewBlock): DisplayKind {
  const lbl = (block.label ?? '').toLowerCase().trim()
  if (!lbl) return 'body'
  if (/^h1(\s*\(.+\))?$/.test(lbl)) return 'h1'
  if (/^h2(\s*\(.+\))?$/.test(lbl)) return 'h2'
  if (/^h[3-6](\s*\(.+\))?$/.test(lbl)) return 'h3'
  if (lbl.includes('subhead')) return 'subhead'
  if (lbl.includes('cta') || lbl.includes('button')) return 'cta'
  if (lbl.includes('eyebrow')) return 'eyebrow'
  if (META_LABEL_RX.test(lbl)) return 'meta'
  if (CARD_PREFIX_RX.test(block.label ?? '')) return 'card'
  return 'unknown'
}

/** Render a block in a way that communicates what's *actual copy* vs reviewer-annotation. */
function BlockPreview({ block: rawBlock }: { block: ParsedCopyReviewBlock }) {
  const block = normalizeBlock(rawBlock)
  const kind = classify(block)

  switch (kind) {
    case 'h1':
      return <p className="font-serif italic text-deep-plum text-xl md:text-2xl leading-tight">{block.text}</p>
    case 'h2':
      return <p className="font-serif text-deep-plum text-lg md:text-xl leading-snug">{block.text}</p>
    case 'h3':
      return <p className="font-semibold text-deep-plum text-base leading-snug">{block.text}</p>
    case 'subhead':
      return <p className="font-medium text-deep-plum text-base leading-snug">{block.text}</p>
    case 'eyebrow':
      return <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple">{block.text}</p>
    case 'cta':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-3.5 py-1.5">
          {block.text} <ArrowRight size={11} />
        </span>
      )
    case 'card': {
      // "[Card 1] Lakeway Kids" → eyebrow "Card 1" + H3-styled "Lakeway Kids".
      const m = (block.label ?? '').match(CARD_PREFIX_RX)
      const prefix = m?.[1] ?? ''
      const heading = m?.[2] ?? block.label ?? ''
      return (
        <div>
          {prefix && <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-0.5">{prefix}</p>}
          <p className="font-semibold text-deep-plum text-base leading-snug">{heading}</p>
          {block.text && block.text !== block.label && (
            <p className="text-sm text-deep-plum leading-relaxed mt-1">{block.text}</p>
          )}
        </div>
      )
    }
    case 'unknown': {
      // Label isn't a type hint — treat it as inline emphasis on body copy.
      // If text === label (redundant), just render label as bold paragraph.
      if (!block.text || block.text === block.label) {
        return <p className="text-sm font-semibold text-deep-plum leading-relaxed">{block.label}</p>
      }
      return (
        <p className="text-sm text-deep-plum leading-relaxed">
          <strong className="font-semibold">{block.label}</strong> {block.text}
        </p>
      )
    }
    case 'meta':
      // Rendered inside SEOSection as a key:value row — see renderMetaRow.
      return (
        <p className="text-sm text-deep-plum leading-relaxed">
          {block.label && <strong className="font-semibold">{block.label}: </strong>}
          {block.text}
        </p>
      )
    default:
      return <p className="text-sm text-deep-plum leading-relaxed">{block.text}</p>
  }
}

/** Only show a type chip when it's genuinely informational — i.e. a known copy type. */
function BlockLabelChip({ kind, label }: { kind: DisplayKind; label: string | null }) {
  if (!label) return null
  if (kind === 'unknown' || kind === 'card' || kind === 'meta' || kind === 'body') return null
  const style = kind === 'cta'
    ? 'bg-deep-plum/10 text-deep-plum'
    : kind === 'eyebrow'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-primary-purple/10 text-primary-purple'
  return (
    <span className={`inline-block text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${style}`}>
      {label}
    </span>
  )
}

function sectionIsSEO(section: ParsedCopyReviewSection): boolean {
  if (section.blocks.length === 0) return false
  return section.blocks.every(b => classify(b) === 'meta')
}

/** A page counts as "reviewed" when the partner has either approved everything
 *  or left at least one comment somewhere in the page. Per-block edit_requested
 *  decisions also count (legacy flows). */
function isPageReviewed(
  page: ParsedCopyReviewPage,
  decisionMap: Map<string, CopyReviewDecision>,
  commentsByBlock: Map<string, CopyReviewPortalPayload['comments']>,
): boolean {
  const blocks = page.sections.flatMap(s => s.blocks)
  if (blocks.length === 0) return true
  if (blocks.every(b => decisionMap.get(b.id) === 'approved')) return true
  if ((commentsByBlock.get(page.id) ?? []).length > 0) return true
  for (const s of page.sections) {
    if ((commentsByBlock.get(s.id) ?? []).length > 0) return true
    for (const b of s.blocks) {
      if ((commentsByBlock.get(b.id) ?? []).length > 0) return true
      if (decisionMap.get(b.id) === 'edit_requested') return true
    }
  }
  return false
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CopyReviewPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [payload, setPayload] = useState<CopyReviewPortalPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [name, setName] = useState(() => getSavedName())
  const [nameModalOpen, setNameModalOpen] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data, error: err } = await supabase.rpc('get_copy_review_by_token', { p_token: token })
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setPayload(data as CopyReviewPortalPayload | null)
      setLoading(false)
      if (data && !getSavedName()) setNameModalOpen(true)
    }
    load()
    return () => { cancelled = true }
  }, [token])

  const refresh = async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_copy_review_by_token', { p_token: token })
    setPayload(data as CopyReviewPortalPayload | null)
  }

  if (loading) return <Shell><Loading /></Shell>
  if (error) return <Shell><Message kind="error" title="Couldn't load review" body={error} /></Shell>
  if (!payload) return <Shell><Message kind="empty" title="No review available" body="Your team hasn't shared a copy review yet, or the link has expired. Reach out to your account manager if you think this is wrong." /></Shell>

  const { review, decisions, comments } = payload
  const isReadOnly = review.status === 'finalized' || justSubmitted
  const isSubmitted = review.status === 'submitted' || justSubmitted

  const decisionMap = new Map<string, CopyReviewDecision>()
  for (const d of decisions) decisionMap.set(d.block_id, d.decision)
  const commentsByBlock = new Map<string, CopyReviewPortalPayload['comments']>()
  for (const c of comments) {
    const arr = commentsByBlock.get(c.block_id) ?? []
    arr.push(c)
    commentsByBlock.set(c.block_id, arr)
  }

  const totalPages = review.parsed.pages.length
  const reviewedPages = review.parsed.pages.filter(p => isPageReviewed(p, decisionMap, commentsByBlock)).length
  const progress = totalPages === 0 ? 100 : Math.round((reviewedPages / totalPages) * 100)
  const canSubmit = reviewedPages === totalPages && totalPages > 0

  const onSubmit = async () => {
    if (!token) return
    setSubmitting(true)
    const { data: ok } = await supabase.rpc('submit_copy_review', { p_token: token, p_review_id: review.id })
    setSubmitting(false)
    if (ok) {
      setJustSubmitted(true)
      // Fire-and-forget Slack notification to #am-pm-web. Same shape
      // as ContentCollectionPage.submitFinal's notify hook — failures
      // here don't block the partner's submit confirmation.
      void supabase.functions.invoke('notify-copy-review-submitted', {
        body: { review_id: review.id },
      }).catch(err => { console.error('[copy-review notify] failed', err) })
      refresh()
    }
  }

  const saveUserName = (newName: string) => {
    saveName(newName)
    setName(newName)
    setNameModalOpen(false)
  }

  return (
    <Shell>
      {/* Hero */}
      <section className="bg-hero-gradient px-6 pt-10 pb-12 text-center">
        <img
          src="/brand/Style=Circle Badge Filled.svg"
          alt="Church Media Squad"
          className="h-10 w-10 brightness-0 invert mx-auto mb-3"
        />
        <p className="text-[10px] font-bold uppercase tracking-widest text-lavender mb-1">Copy Review</p>
        <h1 className="text-2xl md:text-3xl font-semibold text-white">{review.title}</h1>
        <p className="text-sm text-lavender/80 mt-2 max-w-xl mx-auto">
          Review each section and let us know if it's ready or needs a change. Your responses save as you go.
        </p>
        {name && !isReadOnly && (
          <button
            type="button"
            onClick={() => setNameModalOpen(true)}
            className="mt-3 inline-flex items-center gap-1 text-xs text-lavender/80 hover:text-white transition-colors"
          >
            Signing as <span className="font-semibold text-white">{name}</span>
            <Pencil size={10} />
          </button>
        )}
      </section>

      {/* Status banners */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 mt-6 space-y-3">
        {isSubmitted && (
          <Banner
            kind="success"
            title="Review submitted"
            body={isReadOnly
              ? 'Thanks! Your team is working through your feedback.'
              : 'Your review has been submitted. You can still update answers if anything changes.'}
          />
        )}
        {!isSubmitted && !isReadOnly && (
          <Banner kind="info" body="Changes save automatically — you can come back anytime." />
        )}

        {/* Progress */}
        <div className="bg-white border border-lavender rounded-2xl px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="text-sm font-semibold text-deep-plum">
              {reviewedPages} of {totalPages} {totalPages === 1 ? 'page' : 'pages'} reviewed
            </p>
            <p className="text-xs text-purple-gray">{progress}%</p>
          </div>
          <div className="h-2 rounded-full bg-lavender/40 overflow-hidden">
            <div className="h-full bg-primary-purple transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* Pages */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 mt-6 space-y-4 pb-16">
        {review.parsed.pages.map((page, idx) => (
          <PageReviewCard
            key={page.id}
            page={page}
            defaultOpen={idx === 0}
            decisionMap={decisionMap}
            commentsByBlock={commentsByBlock}
            token={token!}
            reviewId={review.id}
            readOnly={isReadOnly}
            authorName={name}
            onChange={refresh}
          />
        ))}

        {!isReadOnly && (
          <div className="bg-white border border-lavender rounded-2xl px-5 py-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-purple-gray">
                {isSubmitted
                  ? 'Review submitted — you can keep updating until your team finalizes it.'
                  : canSubmit
                    ? 'Every page has a response. Submit when you\'re ready.'
                    : `${totalPages - reviewedPages} page${totalPages - reviewedPages === 1 ? '' : 's'} still need approval or edits.`}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={async () => {
                    if (!token) return
                    const pending = review.parsed.pages.flatMap(p => p.sections.flatMap(s => s.blocks)).filter(b => decisionMap.get(b.id) !== 'approved')
                    if (pending.length === 0) return
                    const ok = window.confirm(`Approve the entire review? This marks every page across all ${totalPages} page${totalPages === 1 ? '' : 's'} as approved.`)
                    if (!ok) return
                    await Promise.all(pending.map(b =>
                      supabase.rpc('upsert_copy_review_decision', {
                        p_token: token, p_review_id: review.id, p_block_id: b.id, p_decision: 'approved',
                      })
                    ))
                    refresh()
                  }}
                  disabled={canSubmit && review.parsed.pages.flatMap(p => p.sections.flatMap(s => s.blocks)).every(b => decisionMap.get(b.id) === 'approved')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 text-green-800 text-sm font-semibold px-4 py-2 hover:bg-green-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check size={13} /> Approve entire review
                </button>
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={submitting || !canSubmit}
                  title={canSubmit ? '' : `Approve or request edits on ${totalPages - reviewedPages} more page${totalPages - reviewedPages === 1 ? '' : 's'} first.`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2.5 hover:bg-primary-purple transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {isSubmitted ? 'Resubmit review' : 'Submit review'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {nameModalOpen && (
        <NamePromptModal
          initial={name}
          onSave={saveUserName}
          onSkip={() => { setNameModalOpen(false); if (!name) saveName('') }}
        />
      )}
    </Shell>
  )
}

// ── Name prompt modal ──────────────────────────────────────────────────────

function NamePromptModal({ initial, onSave, onSkip }: {
  initial: string
  onSave: (name: string) => void
  onSkip: () => void
}) {
  const [val, setVal] = useState(initial)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deep-plum/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-lavender shadow-xl w-full max-w-md">
        <div className="px-6 pt-6 pb-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple mb-1">Before we start</p>
          <h2 className="text-lg font-semibold text-deep-plum">What name should we credit on your feedback?</h2>
          <p className="text-xs text-purple-gray mt-1">We'll show this on your comments so your team knows who wrote what. You only need to set this once.</p>
          <input
            type="text"
            autoFocus
            value={val}
            onChange={e => setVal(e.target.value)}
            placeholder="e.g. Pastor Mike"
            className="mt-4 w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            onKeyDown={e => { if (e.key === 'Enter' && val.trim()) onSave(val) }}
          />
        </div>
        <div className="px-6 pb-5 flex items-center justify-between gap-2">
          <button type="button" onClick={onSkip} className="text-xs text-purple-gray hover:text-deep-plum">
            Skip for now
          </button>
          <button
            type="button"
            onClick={() => onSave(val)}
            disabled={!val.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-sm font-semibold px-4 py-2 hover:bg-primary-purple transition-colors disabled:opacity-40"
          >
            Continue <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page card ───────────────────────────────────────────────────────────────

interface PageReviewCardProps {
  page: ParsedCopyReviewPage
  defaultOpen: boolean
  decisionMap: Map<string, CopyReviewDecision>
  commentsByBlock: Map<string, CopyReviewPortalPayload['comments']>
  token: string
  reviewId: string
  readOnly: boolean
  authorName: string
  onChange: () => void
}

function PageReviewCard({ page, defaultOpen, decisionMap, commentsByBlock, token, reviewId, readOnly, authorName, onChange }: PageReviewCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [approving, setApproving] = useState(false)
  const [pageComposerOpen, setPageComposerOpen] = useState(false)

  const pageReviewed = isPageReviewed(page, decisionMap, commentsByBlock)
  const pageBlockCount = page.sections.reduce((n, s) => n + s.blocks.length, 0)
  const fullyApproved = pageBlockCount > 0 && page.sections.every(s => s.blocks.every(b => decisionMap.get(b.id) === 'approved'))
  const pageLevelComments = commentsByBlock.get(page.id) ?? []

  // Has ANY edit feedback (page-level, section-level, or legacy block edit_requested).
  const hasEdits =
    pageLevelComments.length > 0 ||
    page.sections.some(s => (commentsByBlock.get(s.id) ?? []).length > 0 || s.blocks.some(b => (commentsByBlock.get(b.id) ?? []).length > 0 || decisionMap.get(b.id) === 'edit_requested'))

  const statusPill = fullyApproved
    ? { label: 'Approved', cls: 'bg-green-100 text-green-700' }
    : hasEdits
      ? { label: 'Edits requested', cls: 'bg-amber-100 text-amber-800' }
      : { label: 'Needs review', cls: 'bg-lavender/40 text-purple-gray' }

  const approveEntirePage = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (readOnly || fullyApproved || approving) return
    const blocks = page.sections.flatMap(s => s.blocks).filter(b => decisionMap.get(b.id) !== 'approved')
    const ok = window.confirm(`Approve everything on the "${page.label}" page?`)
    if (!ok) return
    setApproving(true)
    await Promise.all(blocks.map(b =>
      supabase.rpc('upsert_copy_review_decision', {
        p_token: token, p_review_id: reviewId, p_block_id: b.id, p_decision: 'approved',
      })
    ))
    setApproving(false)
    setOpen(false) // collapse once approved so user can move on
    onChange()
  }

  return (
    <div className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${
      pageReviewed ? 'border-lavender' : 'border-primary-purple/40'
    }`}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-lavender/50 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
        >
          {open ? <ChevronDown size={16} className="text-primary-purple shrink-0" /> : <ChevronRight size={16} className="text-purple-gray shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-primary-purple mb-0.5">
              {page.emoji ?? '📄'} Page
            </p>
            <h2 className="text-lg font-semibold text-deep-plum">
              {page.label}
              {page.url && <span className="text-purple-gray font-normal ml-2 text-sm">· {page.url}</span>}
            </h2>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-1 ${statusPill.cls}`}>
            {statusPill.label}
          </span>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={approveEntirePage}
                disabled={fullyApproved || approving}
                className={`text-[11px] font-semibold rounded-full px-3 py-1.5 border transition-colors ${
                  fullyApproved
                    ? 'bg-green-600 text-white border-green-600 cursor-default'
                    : 'border-green-200 bg-green-50 text-green-800 hover:bg-green-100 disabled:opacity-40'
                }`}
              >
                <Check size={11} className="inline -mt-0.5 mr-0.5" /> {fullyApproved ? 'Approved' : 'Approve page'}
              </button>
              <button
                type="button"
                onClick={() => { setPageComposerOpen(v => !v); setOpen(true) }}
                className="text-[11px] font-semibold rounded-full px-3 py-1.5 border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"
              >
                <Edit3 size={11} className="inline -mt-0.5 mr-0.5" /> Request edits
              </button>
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 md:px-5 py-5 space-y-5">
          {pageComposerOpen && !readOnly && (
            <SectionComposer
              sectionId={page.id}
              token={token}
              reviewId={reviewId}
              authorName={authorName}
              onClose={() => setPageComposerOpen(false)}
              onChange={onChange}
            />
          )}

          {pageLevelComments.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Page-level notes</p>
              {pageLevelComments.map(c => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  reviewId={reviewId}
                  token={token}
                  readOnly={readOnly}
                  onChange={onChange}
                />
              ))}
            </div>
          )}

          {page.sections.map(section => (
            sectionIsSEO(section) ? (
              <SEOSection
                key={section.id}
                section={section}
                decisionMap={decisionMap}
                commentsByBlock={commentsByBlock}
                token={token}
                reviewId={reviewId}
                readOnly={readOnly}
                authorName={authorName}
                onChange={onChange}
              />
            ) : (
              <SectionReviewGroup
                key={section.id}
                section={section}
                decisionMap={decisionMap}
                commentsByBlock={commentsByBlock}
                token={token}
                reviewId={reviewId}
                readOnly={readOnly}
                authorName={authorName}
                onChange={onChange}
              />
            )
          ))}

          {/* Footer recap — avoids scrolling back up to act on the page */}
          {!readOnly && (
            <div className="rounded-xl border border-lavender bg-lavender-tint/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap mt-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple">
                  {page.emoji ?? '📄'} Page recap
                </p>
                <p className="text-sm font-semibold text-deep-plum truncate">
                  {page.label}
                  {page.url && <span className="text-purple-gray font-normal ml-1.5 text-xs">· {page.url}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={approveEntirePage}
                  disabled={fullyApproved || approving}
                  className={`text-[11px] font-semibold rounded-full px-3 py-1.5 border transition-colors ${
                    fullyApproved
                      ? 'bg-green-600 text-white border-green-600 cursor-default'
                      : 'border-green-200 bg-green-50 text-green-800 hover:bg-green-100 disabled:opacity-40'
                  }`}
                >
                  <Check size={11} className="inline -mt-0.5 mr-0.5" />
                  {approving ? 'Approving…' : fullyApproved ? 'Approved' : 'Approve page'}
                </button>
                <button
                  type="button"
                  onClick={() => setPageComposerOpen(v => !v)}
                  className="text-[11px] font-semibold rounded-full px-3 py-1.5 border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"
                >
                  <Edit3 size={11} className="inline -mt-0.5 mr-0.5" /> Request edits
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── SEO section (compact metadata card) ─────────────────────────────────────

function SEOSection({ section, commentsByBlock, token, reviewId, readOnly, authorName, onChange }: SectionGroupProps) {
  const [composerOpen, setComposerOpen] = useState(false)
  const sectionScopedComments = [
    ...(commentsByBlock.get(section.id) ?? []),
    ...section.blocks.flatMap(b => commentsByBlock.get(b.id) ?? []),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const hasComments = sectionScopedComments.length > 0

  // SEO sections don't use approve — staff doesn't need partner sign-off
  // on SEO data. They can still flag concerns via Request edits.
  const accent = hasComments ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-amber-200'

  return (
    <section className={`rounded-xl border border-lavender/70 bg-lavender-tint/20 overflow-hidden ${accent}`}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-0.5">SEO & AEO</p>
          <h3 className="text-sm font-semibold text-deep-plum">{section.label}</h3>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setComposerOpen(v => !v)}
            className="text-[11px] font-semibold rounded-full border border-amber-200 bg-white text-amber-800 px-2.5 py-1 hover:bg-amber-50 shrink-0"
          >
            <Edit3 size={10} className="inline -mt-0.5 mr-0.5" /> Request edits
          </button>
        )}
      </div>

      <div className="px-4 pb-4 space-y-1">
        {section.blocks.map(b => {
          const n = normalizeBlock(b)
          return (
            <div key={b.id} className="flex items-baseline gap-3 text-xs py-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-gray shrink-0 min-w-[90px] md:min-w-[130px]">{n.label ?? 'Value'}</span>
              <span className="text-deep-plum flex-1 min-w-0 break-words">{n.text}</span>
            </div>
          )
        })}

        {composerOpen && !readOnly && (
          <div className="pt-2">
            <SectionComposer
              sectionId={section.id}
              token={token}
              reviewId={reviewId}
              authorName={authorName}
              onClose={() => setComposerOpen(false)}
              onChange={onChange}
            />
          </div>
        )}

        {sectionScopedComments.length > 0 && (
          <div className="pt-2 mt-2 border-t border-lavender/40 space-y-2">
            {sectionScopedComments.map(c => (
              <CommentCard
                key={c.id}
                comment={c}
                reviewId={reviewId}
                token={token}
                readOnly={readOnly}
                onChange={onChange}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Copy section (page copy, not SEO) ───────────────────────────────────────

interface SectionGroupProps {
  section: ParsedCopyReviewSection
  decisionMap: Map<string, CopyReviewDecision>
  commentsByBlock: Map<string, CopyReviewPortalPayload['comments']>
  token: string
  reviewId: string
  readOnly: boolean
  authorName: string
  onChange: () => void
}

function SectionReviewGroup({ section, decisionMap, commentsByBlock, token, reviewId, readOnly, authorName, onChange }: SectionGroupProps) {
  const [composerOpen, setComposerOpen] = useState(false)

  const allApproved = section.blocks.length > 0 && section.blocks.every(b => decisionMap.get(b.id) === 'approved')
  // Gather every comment that belongs to this section — on the section id itself
  // OR on any of its child blocks (blocks may carry comments from earlier flows).
  const sectionScopedComments = [
    ...(commentsByBlock.get(section.id) ?? []),
    ...section.blocks.flatMap(b => commentsByBlock.get(b.id) ?? []),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const hasComments = sectionScopedComments.length > 0

  // Card accent reflects whatever state the section has. Approve happens at
  // the page level now — sections only carry the Request edits action.
  const cardAccent = hasComments
    ? 'border-l-4 border-l-amber-400'
    : allApproved
      ? 'border-l-4 border-l-green-500'
      : 'border-l-4 border-l-lavender'

  return (
    <section className={`rounded-2xl border border-lavender bg-white shadow-sm ${cardAccent}`}>
      <div className="flex items-center justify-between gap-2 px-4 md:px-5 py-3 border-b border-lavender/60 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple">Section</p>
          <h3 className="text-sm font-semibold text-deep-plum truncate">{section.label}</h3>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setComposerOpen(v => !v)}
            className="text-[11px] font-semibold rounded-full px-3 py-1.5 border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors shrink-0"
          >
            <Edit3 size={11} className="inline -mt-0.5 mr-0.5" /> Request edits
          </button>
        )}
      </div>

      <div className="px-4 md:px-5 py-4 space-y-4">
        {section.blocks.map(block => (
          <BlockRow key={block.id} block={block} />
        ))}

        {composerOpen && !readOnly && (
          <SectionComposer
            sectionId={section.id}
            token={token}
            reviewId={reviewId}
            authorName={authorName}
            onClose={() => setComposerOpen(false)}
            onChange={onChange}
          />
        )}

        {sectionScopedComments.length > 0 && (
          <div className="pt-2 border-t border-lavender/40 space-y-2">
            {sectionScopedComments.map(c => (
              <CommentCard
                key={c.id}
                comment={c}
                reviewId={reviewId}
                token={token}
                readOnly={readOnly}
                onChange={onChange}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Block row (preview only — decisions happen at the section level now) ───

function BlockRow({ block: rawBlock }: { block: ParsedCopyReviewBlock }) {
  const block = normalizeBlock(rawBlock)
  const kind = classify(block)
  return (
    <div>
      <BlockLabelChip kind={kind} label={block.label} />
      <div className={kind === 'h1' || kind === 'h2' || kind === 'h3' || kind === 'subhead' || kind === 'eyebrow' || kind === 'cta' ? 'mt-1' : ''}>
        <BlockPreview block={block} />
      </div>
    </div>
  )
}

// ── Section composer — just a textarea; all comments attach at section level ──

function SectionComposer({ sectionId, token, reviewId, authorName, onClose, onChange }: {
  sectionId: string
  token: string
  reviewId: string
  authorName: string
  onClose: () => void
  onChange: () => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const post = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    await supabase.rpc('insert_copy_review_comment', {
      p_token: token,
      p_review_id: reviewId,
      p_block_id: sectionId,
      p_body: body,
      p_author_name: authorName.trim() || null,
      p_client_id: clientIdFor(reviewId),
    })
    setBusy(false)
    setBody('')
    onClose()
    onChange()
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-amber-300/60 bg-amber-50/50 p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Request edits</p>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="What should we change about this section?"
        rows={3}
        autoFocus
        className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-amber-500"
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose}
          className="text-xs text-purple-gray hover:text-deep-plum px-2 py-1.5">
          Cancel
        </button>
        <button type="button" onClick={post} disabled={!body.trim() || busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-amber-700 disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          Post comment
        </button>
      </div>
    </div>
  )
}

// ── Comment card ───────────────────────────────────────────────────────────

function CommentCard({ comment, reviewId, token, readOnly, onChange }: {
  comment: CopyReviewPortalPayload['comments'][number]
  reviewId: string
  token: string
  readOnly: boolean
  onChange: () => void
}) {
  const [editMode, setEditMode] = useState(false)
  const [body, setBody] = useState(comment.body)
  const [busy, setBusy] = useState(false)

  const mine = comment.client_id && comment.client_id === clientIdFor(reviewId) && comment.author_kind === 'partner'
  const isStaff = comment.author_kind === 'staff'

  const saveEdit = async () => {
    if (!body.trim()) return
    setBusy(true)
    await supabase.rpc('update_copy_review_comment', {
      p_token: token, p_comment_id: comment.id, p_client_id: clientIdFor(reviewId), p_body: body,
    })
    setBusy(false)
    setEditMode(false)
    onChange()
  }

  const del = async () => {
    setBusy(true)
    await supabase.rpc('delete_copy_review_comment', {
      p_token: token, p_comment_id: comment.id, p_client_id: clientIdFor(reviewId),
    })
    setBusy(false)
    onChange()
  }

  return (
    <div className={`rounded-lg px-3 py-2 text-sm border ${
      isStaff
        ? 'border-deep-plum/20 bg-deep-plum/5'
        : comment.resolved
          ? 'border-green-200 bg-green-50/40 opacity-80'
          : 'border-amber-200 bg-amber-50/60'
    }`}>
      <div className="flex items-center justify-between gap-2 mb-0.5 flex-wrap">
        <p className="text-[10px] font-bold uppercase tracking-wider text-purple-gray truncate">
          {isStaff ? 'Your team' : (comment.author_name ?? 'You')}
          {comment.resolved && <span className="ml-1.5 text-green-700">· resolved</span>}
          <span className="text-purple-gray/60 font-normal normal-case ml-1.5">· {new Date(comment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </p>
        {mine && !readOnly && !editMode && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => setEditMode(true)} className="text-[11px] text-primary-purple hover:underline">Edit</button>
            <button type="button" onClick={del} disabled={busy} className="text-[11px] text-red-700 hover:underline">Delete</button>
          </div>
        )}
      </div>

      {editMode ? (
        <div className="flex items-start gap-2 mt-1">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={2}
            className="flex-1 rounded-lg border border-lavender px-2 py-1.5 text-xs text-deep-plum outline-none focus:border-primary-purple"
          />
          <button type="button" onClick={saveEdit} disabled={busy}
            className="text-[11px] rounded-full bg-deep-plum text-white font-semibold px-3 py-1 hover:bg-primary-purple disabled:opacity-40">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          </button>
          <button type="button" onClick={() => { setEditMode(false); setBody(comment.body) }}
            className="text-[11px] text-purple-gray hover:text-deep-plum px-1">
            <X size={11} />
          </button>
        </div>
      ) : (
        <p className="text-deep-plum whitespace-pre-wrap mt-0.5">{comment.body}</p>
      )}
    </div>
  )
}

// ── Shell / helpers ────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-cream text-deep-plum">{children}</div>
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={22} className="animate-spin text-primary-purple" />
    </div>
  )
}

function Message({ kind, title, body }: { kind: 'error' | 'empty'; title: string; body: string }) {
  const isError = kind === 'error'
  return (
    <div className="max-w-xl mx-auto px-6 py-24 text-center">
      <div className={`inline-flex items-center justify-center h-12 w-12 rounded-full mb-4 ${
        isError ? 'bg-red-100 text-red-700' : 'bg-lavender-tint text-primary-purple'
      }`}>
        {isError ? <AlertCircle size={22} /> : <CheckCircle2 size={22} />}
      </div>
      <h1 className="text-xl font-semibold text-deep-plum">{title}</h1>
      <p className="text-sm text-purple-gray mt-2">{body}</p>
    </div>
  )
}

function Banner({ kind, title, body }: { kind: 'info' | 'success' | 'warning'; title?: string; body: string }) {
  const cls = kind === 'success'
    ? 'border-green-200 bg-green-50 text-green-800'
    : kind === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-primary-purple/20 bg-lavender-tint text-deep-plum'
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {title && <p className="font-semibold">{title}</p>}
      <p className={title ? 'mt-0.5' : ''}>{body}</p>
    </div>
  )
}

