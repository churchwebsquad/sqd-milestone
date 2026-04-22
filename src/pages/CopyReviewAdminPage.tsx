import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronDown, ChevronRight, Check, CheckCircle2, MessageSquare,
  Link as LinkIcon, Loader2, Play, AlertCircle, X, Download, UploadCloud, Pencil,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  StrategyCopyReview, StrategyCopyReviewDecision, StrategyCopyReviewComment,
  StrategyCopyReviewEdit, CopyReviewStatus, ParsedCopyReview, ParsedCopyReviewBlock,
  ParsedCopyReviewPage, ParsedCopyReviewSection,
} from '../types/database'
import { parseCopyReviewHtml, normalizeBlock } from '../lib/parseCopyReviewHtml'
import {
  parsedToMarkdown, downloadText, mergeParsed, countDroppedBlocks, replaceBlockText,
  type MergeMode,
} from '../lib/copyReviewSerialize'

// Shape used throughout — review plus all related rows kept in sync locally.
interface LoadedReview {
  review: StrategyCopyReview
  decisions: StrategyCopyReviewDecision[]
  comments: StrategyCopyReviewComment[]
  edits: StrategyCopyReviewEdit[]
  portalToken: string | null
}

const STATUS_BADGE: Record<CopyReviewStatus, string> = {
  draft: 'bg-purple-gray/10 text-purple-gray',
  open: 'bg-primary-purple/10 text-primary-purple',
  submitted: 'bg-amber-100 text-amber-700',
  finalized: 'bg-green-100 text-green-700',
}

type FilterKey = 'all' | 'edit_requested' | 'approved' | 'unresolved'

export default function CopyReviewAdminPage() {
  const { memberId, reviewId } = useParams<{ memberId: string; reviewId: string }>()
  const navigate = useNavigate()
  const memberNum = Number(memberId)

  const [data, setData] = useState<LoadedReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [openPageIds, setOpenPageIds] = useState<Set<string>>(new Set())
  const treeScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!reviewId || !memberNum) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [reviewRes, decRes, comRes, editRes, churchRes] = await Promise.all([
          supabase.from('strategy_copy_reviews').select('*').eq('id', reviewId).maybeSingle(),
          supabase.from('strategy_copy_review_decisions').select('*').eq('review_id', reviewId),
          supabase.from('strategy_copy_review_comments').select('*').eq('review_id', reviewId).order('created_at', { ascending: true }),
          supabase.from('strategy_copy_review_edits').select('*').eq('review_id', reviewId),
          supabase.from('strategy_account_progress').select('portal_token').eq('member', memberNum).maybeSingle(),
        ])
        if (reviewRes.error) throw reviewRes.error
        if (!reviewRes.data) { setError('Review not found.'); return }
        if (cancelled) return
        setData({
          review: reviewRes.data as StrategyCopyReview,
          decisions: (decRes.data ?? []) as StrategyCopyReviewDecision[],
          comments: (comRes.data ?? []) as StrategyCopyReviewComment[],
          edits: (editRes.data ?? []) as StrategyCopyReviewEdit[],
          portalToken: (churchRes.data as { portal_token?: string } | null)?.portal_token ?? null,
        })
      } catch (err) {
        if (!cancelled) setError((err as { message?: string })?.message ?? 'Failed to load review')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [reviewId, memberNum])

  const handleStatus = async (next: CopyReviewStatus) => {
    if (!data) return
    const patch: Record<string, unknown> = { status: next }
    if (next === 'finalized' && !data.review.finalized_at) patch.finalized_at = new Date().toISOString()
    const { error: err } = await supabase
      .from('strategy_copy_reviews')
      .update(patch)
      .eq('id', data.review.id)
    if (err) { setError(err.message); return }
    setData({ ...data, review: { ...data.review, ...patch } as StrategyCopyReview })
  }

  const handleCopyLink = () => {
    if (!data?.portalToken) return
    const url = `${window.location.origin}/portal/${data.portalToken}/copy-review`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleAddStaffComment = async (blockId: string, body: string) => {
    if (!data || !body.trim()) return
    const { data: inserted, error: insertErr } = await supabase
      .from('strategy_copy_review_comments')
      .insert({
        review_id: data.review.id,
        block_id: blockId,
        author_kind: 'staff',
        author_name: null,
        author_uid: null,
        body: body.trim(),
        resolved: false,
        client_id: null,
      })
      .select()
      .single()
    if (insertErr || !inserted) { setError(insertErr?.message ?? 'Failed to post comment'); return }
    setData({ ...data, comments: [...data.comments, inserted as StrategyCopyReviewComment] })
  }

  const handleToggleResolved = async (commentId: string, resolved: boolean) => {
    if (!data) return
    const { error: err } = await supabase
      .from('strategy_copy_review_comments')
      .update({ resolved })
      .eq('id', commentId)
    if (err) { setError(err.message); return }
    setData({
      ...data,
      comments: data.comments.map(c => c.id === commentId ? { ...c, resolved } : c),
    })
  }

  const handleMarkBlockResolved = async (blockId: string) => {
    if (!data) return
    // Flip decision → approved, resolve all comments on this block.
    const blockComments = data.comments.filter(c => c.block_id === blockId && !c.resolved)
    await Promise.all([
      supabase.from('strategy_copy_review_decisions').upsert({
        review_id: data.review.id,
        block_id: blockId,
        decision: 'approved',
        decided_at: new Date().toISOString(),
      }, { onConflict: 'review_id,block_id' }),
      ...blockComments.map(c =>
        supabase.from('strategy_copy_review_comments').update({ resolved: true }).eq('id', c.id)
      ),
    ])
    setData(prev => prev ? {
      ...prev,
      decisions: upsertDecision(prev.decisions, { review_id: prev.review.id, block_id: blockId, decision: 'approved', decided_at: new Date().toISOString() } as StrategyCopyReviewDecision),
      comments: prev.comments.map(c => c.block_id === blockId ? { ...c, resolved: true } : c),
    } : prev)
  }

  // Live-edit a block's text — writes directly to parsed JSONB so the
  // partner portal reflects the updated copy on next load.
  const handleEditBlock = async (blockId: string, nextText: string) => {
    if (!data || !nextText.trim()) return
    const nextParsed = replaceBlockText(data.review.parsed, blockId, nextText.trim())
    const { error: err } = await supabase
      .from('strategy_copy_reviews')
      .update({ parsed: nextParsed })
      .eq('id', data.review.id)
    if (err) { setError(err.message); return }
    setData({ ...data, review: { ...data.review, parsed: nextParsed } })
  }

  // Export the current tree as Markdown — Notion imports .md cleanly.
  const handleExport = () => {
    if (!data) return
    const md = parsedToMarkdown(data.review.parsed)
    const slug = data.review.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    downloadText(md, `${slug || 'copy-review'}.md`, 'text/markdown')
  }

  // Apply a re-upload (either replace the tree or merge pages in).
  const handleReupload = async (nextParsed: ParsedCopyReview, sourceHtml: string, mode: MergeMode) => {
    if (!data) return
    const merged = mergeParsed(data.review.parsed, nextParsed, mode)
    const patch: Record<string, unknown> = { parsed: merged, source_html: sourceHtml }
    if (merged.title) patch.title = merged.title
    const { error: err } = await supabase
      .from('strategy_copy_reviews')
      .update(patch)
      .eq('id', data.review.id)
    if (err) { setError(err.message); return }
    setData({
      ...data,
      review: { ...data.review, parsed: merged, source_html: sourceHtml, title: merged.title ?? data.review.title },
    })
    setUploadModalOpen(false)
  }

  // Scroll the tree to a block or section and auto-expand its containing page.
  const jumpToBlock = (blockId: string) => {
    if (!data) return
    // Find the page the block belongs to.
    const page = findPageForBlockOrSection(data.review.parsed, blockId)
    if (page) {
      setOpenPageIds(prev => new Set(prev).add(page.id))
    }
    // setTimeout so the page has rendered before we scroll.
    setTimeout(() => {
      const el = document.getElementById(`admin-block-${blockId}`) ?? document.getElementById(`admin-section-${blockId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  const togglePageOpen = (pageId: string) => {
    setOpenPageIds(prev => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  // ── Loading / error ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-6xl mx-auto">
        <div className="h-10 w-1/3 bg-lavender-tint rounded-lg animate-pulse mb-4" />
        <div className="h-64 bg-lavender-tint rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => navigate(`/churches/${memberId}`)}
          className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple mb-4"
        >
          <ArrowLeft size={14} /> Back to Church
        </button>
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? 'Review not found.'}
        </div>
      </div>
    )
  }

  const { review, decisions, comments, portalToken } = data
  const decisionByBlock = new Map(decisions.map(d => [d.block_id, d]))
  const commentsByBlock = new Map<string, StrategyCopyReviewComment[]>()
  for (const c of comments) {
    const arr = commentsByBlock.get(c.block_id) ?? []
    arr.push(c)
    commentsByBlock.set(c.block_id, arr)
  }

  const filteredComments = filterComments(comments, decisions, filter)
  const allPending = countPending(review.parsed.pages, decisionByBlock, commentsByBlock)
  const canFinalize = allPending === 0 && review.status !== 'finalized'

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-6xl mx-auto">

        <button
          type="button"
          onClick={() => navigate(`/churches/${memberId}`)}
          className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple mb-4"
        >
          <ArrowLeft size={14} /> Back to Church
        </button>

        {/* Meta card */}
        <div className="bg-white border border-lavender rounded-2xl p-5 md:p-6 shadow-sm mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Copy Review</p>
              <h1 className="text-xl md:text-2xl font-semibold text-deep-plum">{review.title}</h1>
              <p className="text-xs text-purple-gray mt-1">
                Uploaded {new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {review.submitted_at ? ` · submitted ${new Date(review.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                {review.finalized_at ? ` · finalized ${new Date(review.finalized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-1 ${STATUS_BADGE[review.status]}`}>
                {review.status}
              </span>

              {review.status === 'draft' && (
                <button
                  type="button"
                  onClick={() => handleStatus('open')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple transition-colors"
                >
                  <Play size={11} /> Open for Partner
                </button>
              )}

              {(review.status === 'open' || review.status === 'submitted') && portalToken && (
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
                >
                  {copied ? <Check size={11} className="text-green-600" /> : <LinkIcon size={11} />}
                  {copied ? 'Copied' : 'Copy Portal Link'}
                </button>
              )}

              {review.status === 'submitted' && (
                <button
                  type="button"
                  onClick={() => handleStatus('open')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
                  title="Let the partner keep reviewing"
                >
                  Re-open
                </button>
              )}

              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
                title="Download as Markdown (import into Notion)"
              >
                <Download size={11} /> Export Markdown
              </button>

              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
                title="Re-upload HTML to replace or add pages"
              >
                <UploadCloud size={11} /> Re-upload
              </button>

              <button
                type="button"
                onClick={() => handleStatus('finalized')}
                disabled={!canFinalize}
                title={canFinalize ? '' : `${allPending} block${allPending === 1 ? '' : 's'} still need action`}
                className="inline-flex items-center gap-1.5 rounded-full bg-green-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={11} /> Finalize
              </button>
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <SummaryCard label="Pages" value={review.parsed.pages.length} />
          <SummaryCard
            label="Approved"
            value={decisions.filter(d => d.decision === 'approved').length}
          />
          <SummaryCard
            label="Edit Requested"
            value={decisions.filter(d => d.decision === 'edit_requested').length}
          />
          <SummaryCard
            label="Unresolved Comments"
            value={comments.filter(c => !c.resolved).length}
          />
        </div>

        {/* Two-column on desktop: tree | comments */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">

          {/* Tree */}
          <div ref={treeScrollRef} className="bg-white border border-lavender rounded-2xl p-4 md:p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">Review Tree</h2>
            {review.parsed.pages.map(page => (
              <PageTree
                key={page.id}
                page={page}
                open={openPageIds.has(page.id)}
                onToggleOpen={() => togglePageOpen(page.id)}
                decisionByBlock={decisionByBlock}
                commentsByBlock={commentsByBlock}
                onMarkBlockResolved={handleMarkBlockResolved}
                onEditBlock={handleEditBlock}
                readOnly={review.status === 'finalized'}
              />
            ))}
          </div>

          {/* Comments pane */}
          <div className="bg-white border border-lavender rounded-2xl p-4 md:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare size={14} className="text-primary-purple" />
                Comments
              </h2>
              <div className="flex items-center gap-1 flex-wrap">
                <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
                <FilterChip label="Edit req." active={filter === 'edit_requested'} onClick={() => setFilter('edit_requested')} />
                <FilterChip label="Approved" active={filter === 'approved'} onClick={() => setFilter('approved')} />
                <FilterChip label="Unresolved" active={filter === 'unresolved'} onClick={() => setFilter('unresolved')} />
              </div>
            </div>

            {filteredComments.length === 0 ? (
              <p className="text-sm text-purple-gray">
                {review.status === 'draft'
                  ? 'No partner activity yet. Open the review to make it visible.'
                  : 'No comments match this filter.'}
              </p>
            ) : (
              <CommentList
                comments={filteredComments}
                blockLookup={buildBlockLookup(review.parsed.pages)}
                onToggleResolved={handleToggleResolved}
                onReply={handleAddStaffComment}
                onJump={jumpToBlock}
                readOnly={review.status === 'finalized'}
              />
            )}
          </div>

        </div>
      </div>

      {uploadModalOpen && (
        <ReuploadModal
          existing={review.parsed}
          onClose={() => setUploadModalOpen(false)}
          onApply={handleReupload}
        />
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findPageForBlockOrSection(parsed: ParsedCopyReview, id: string): ParsedCopyReviewPage | null {
  for (const p of parsed.pages) {
    for (const s of p.sections) {
      if (s.id === id) return p
      if (s.blocks.some(b => b.id === id)) return p
    }
  }
  return null
}

// ── Tree rendering ──────────────────────────────────────────────────────────

interface PageTreeProps {
  page: ParsedCopyReviewPage
  open: boolean
  onToggleOpen: () => void
  decisionByBlock: Map<string, StrategyCopyReviewDecision>
  commentsByBlock: Map<string, StrategyCopyReviewComment[]>
  onMarkBlockResolved: (blockId: string) => void
  onEditBlock: (blockId: string, text: string) => Promise<void>
  readOnly: boolean
}

function PageTree({ page, open, onToggleOpen, decisionByBlock, commentsByBlock, onMarkBlockResolved, onEditBlock, readOnly }: PageTreeProps) {
  const counts = pageCounts(page, decisionByBlock, commentsByBlock)

  return (
    <div className="border border-lavender rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggleOpen}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-lavender-tint/30 transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-primary-purple shrink-0" /> : <ChevronRight size={14} className="text-purple-gray shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-deep-plum">
            {page.emoji ?? '📄'} {page.label}
            {page.url && <span className="text-purple-gray font-normal"> · {page.url}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
          <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 font-semibold">{counts.approved}✓</span>
          <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-semibold">{counts.edits}!</span>
          <span className="rounded-full bg-purple-gray/10 text-purple-gray px-2 py-0.5 font-semibold">{counts.pending}·</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-lavender/50 space-y-3">
          {page.sections.map(section => (
            <SectionTree
              key={section.id}
              section={section}
              decisionByBlock={decisionByBlock}
              commentsByBlock={commentsByBlock}
              onMarkBlockResolved={onMarkBlockResolved}
              onEditBlock={onEditBlock}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SectionTree({ section, decisionByBlock, commentsByBlock, onMarkBlockResolved, onEditBlock, readOnly }: {
  section: ParsedCopyReviewSection
  decisionByBlock: Map<string, StrategyCopyReviewDecision>
  commentsByBlock: Map<string, StrategyCopyReviewComment[]>
  onMarkBlockResolved: (blockId: string) => void
  onEditBlock: (blockId: string, text: string) => Promise<void>
  readOnly: boolean
}) {
  return (
    <div id={`admin-section-${section.id}`} className="scroll-mt-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-primary-purple mt-3 mb-1.5">{section.label}</p>
      <div className="space-y-1.5">
        {section.blocks.map(block => (
          <BlockRow
            key={block.id}
            block={block}
            decision={decisionByBlock.get(block.id) ?? null}
            comments={commentsByBlock.get(block.id) ?? []}
            onMarkResolved={() => onMarkBlockResolved(block.id)}
            onEditBlock={onEditBlock}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  )
}

function BlockRow({ block: rawBlock, decision, comments, onMarkResolved, onEditBlock, readOnly }: {
  block: ParsedCopyReviewBlock
  decision: StrategyCopyReviewDecision | null
  comments: StrategyCopyReviewComment[]
  onMarkResolved: () => void
  onEditBlock: (blockId: string, text: string) => Promise<void>
  readOnly: boolean
}) {
  const block = normalizeBlock(rawBlock)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState(block.text)
  const [saving, setSaving] = useState(false)
  const unresolved = comments.filter(c => !c.resolved).length

  // If the block's text changes upstream (re-upload, another edit), sync draft.
  useEffect(() => {
    if (!editMode) setDraft(block.text)
  }, [block.text, editMode])

  const submit = async () => {
    if (!draft.trim() || draft === block.text) { setEditMode(false); return }
    setSaving(true)
    await onEditBlock(block.id, draft)
    setSaving(false)
    setEditMode(false)
  }

  return (
    <div
      id={`admin-block-${block.id}`}
      className={`rounded-lg border px-3 py-2 text-sm scroll-mt-4 ${
        decision?.decision === 'approved' ? 'border-green-200 bg-green-50/40'
        : decision?.decision === 'edit_requested' ? 'border-amber-200 bg-amber-50/40'
        : 'border-lavender bg-white'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {block.label && (
            <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-primary-purple bg-primary-purple/10 rounded px-1.5 py-0.5 mr-2">
              {block.label}
            </span>
          )}
          {editMode ? (
            <div className="mt-1.5 flex items-start gap-2">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
                rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 80)))}
                className="flex-1 rounded-lg border border-primary-purple/40 px-2 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple"
              />
              <button type="button" onClick={submit} disabled={saving || !draft.trim()}
                className="text-[11px] rounded-full bg-deep-plum text-white font-semibold px-3 py-1 hover:bg-primary-purple disabled:opacity-40">
                {saving ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
              </button>
              <button type="button" onClick={() => { setEditMode(false); setDraft(block.text) }}
                className="text-[11px] text-purple-gray hover:text-deep-plum px-2">
                <X size={11} />
              </button>
            </div>
          ) : (
            <span className="text-deep-plum whitespace-pre-wrap">{block.text}</span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5 pt-0.5">
          {unresolved > 0 && (
            <span className="text-[10px] font-semibold rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5">
              {unresolved}
            </span>
          )}
          {decision?.decision === 'approved' && <Check size={12} className="text-green-600" />}
          {decision?.decision === 'edit_requested' && <AlertCircle size={12} className="text-amber-600" />}
          {!readOnly && !editMode && (
            <button
              type="button"
              onClick={() => setEditMode(true)}
              title="Edit this block's copy"
              className="text-purple-gray hover:text-primary-purple transition-colors"
            >
              <Pencil size={11} />
            </button>
          )}
        </div>
      </div>

      {!readOnly && !editMode && unresolved > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onMarkResolved}
            className="text-[11px] text-green-700 hover:underline font-semibold"
          >
            Mark block resolved
          </button>
        </div>
      )}
    </div>
  )
}

// ── Comments pane ───────────────────────────────────────────────────────────

interface BlockLookupEntry { pageLabel: string; sectionLabel: string; blockLabel: string | null; blockText: string }

function buildBlockLookup(pages: ParsedCopyReviewPage[]): Map<string, BlockLookupEntry> {
  const m = new Map<string, BlockLookupEntry>()
  for (const p of pages) {
    // Allow comments on the page id itself (page-level Request edits).
    m.set(p.id, { pageLabel: p.label, sectionLabel: '—', blockLabel: 'Page', blockText: p.label })
    for (const s of p.sections) {
      for (const b of s.blocks) {
        const n = normalizeBlock(b)
        m.set(b.id, { pageLabel: p.label, sectionLabel: s.label, blockLabel: n.label, blockText: n.text })
      }
      // Allow commenting on section header itself using its id.
      m.set(s.id, { pageLabel: p.label, sectionLabel: s.label, blockLabel: 'Section', blockText: s.label })
    }
  }
  return m
}

function CommentList({ comments, blockLookup, onToggleResolved, onReply, onJump, readOnly }: {
  comments: StrategyCopyReviewComment[]
  blockLookup: Map<string, BlockLookupEntry>
  onToggleResolved: (id: string, resolved: boolean) => void
  onReply: (blockId: string, body: string) => Promise<void>
  onJump: (blockId: string) => void
  readOnly: boolean
}) {
  return (
    <div className="space-y-3">
      {comments.map(c => {
        const ref = blockLookup.get(c.block_id)
        return (
          <CommentRow
            key={c.id}
            comment={c}
            contextLabel={ref ? `${ref.pageLabel} → ${ref.sectionLabel}${ref.blockLabel ? ` → ${ref.blockLabel}` : ''}` : 'Unknown block'}
            blockText={ref?.blockText ?? ''}
            onToggleResolved={onToggleResolved}
            onReply={onReply}
            onJump={() => onJump(c.block_id)}
            readOnly={readOnly}
          />
        )
      })}
    </div>
  )
}

function CommentRow({ comment, contextLabel, blockText, onToggleResolved, onReply, onJump, readOnly }: {
  comment: StrategyCopyReviewComment
  contextLabel: string
  blockText: string
  onToggleResolved: (id: string, resolved: boolean) => void
  onReply: (blockId: string, body: string) => Promise<void>
  onJump: () => void
  readOnly: boolean
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [posting, setPosting] = useState(false)

  const postReply = async () => {
    if (!reply.trim()) return
    setPosting(true)
    await onReply(comment.block_id, reply)
    setPosting(false)
    setReply('')
    setReplyOpen(false)
  }

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${comment.resolved ? 'border-green-200 bg-green-50/40 opacity-80' : 'border-lavender bg-white hover:border-primary-purple/40 hover:shadow-sm'} transition-all`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <button
          type="button"
          onClick={onJump}
          title="Jump to this line in the tree"
          className="text-[10px] font-bold uppercase tracking-widest text-primary-purple truncate hover:underline text-left min-w-0"
        >
          {contextLabel} ↗
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${
            comment.author_kind === 'staff' ? 'bg-deep-plum text-white' : 'bg-primary-purple/10 text-primary-purple'
          }`}>
            {comment.author_kind}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onToggleResolved(comment.id, !comment.resolved)}
              className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${
                comment.resolved ? 'bg-green-100 text-green-700' : 'bg-lavender/40 text-purple-gray hover:text-green-700'
              }`}
            >
              {comment.resolved ? 'resolved' : 'mark resolved'}
            </button>
          )}
        </div>
      </div>

      {blockText && (
        <p className="text-[11px] text-purple-gray italic mb-1.5 line-clamp-2">“{blockText}”</p>
      )}

      <p className="text-sm text-deep-plum whitespace-pre-wrap">{comment.body}</p>

      <p className="text-[10px] text-purple-gray mt-1">
        {comment.author_name ?? (comment.author_kind === 'staff' ? 'Staff' : 'Partner')}
        {' · '}
        {new Date(comment.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </p>

      {!readOnly && (
        <div className="mt-2">
          {!replyOpen ? (
            <button type="button" onClick={() => setReplyOpen(true)}
              className="text-[11px] text-primary-purple hover:underline font-semibold">
              Reply
            </button>
          ) : (
            <div className="flex items-start gap-2">
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                rows={2}
                placeholder="Staff reply (visible on the partner portal if you want it to be — currently internal-only)"
                className="flex-1 rounded-lg border border-lavender px-2 py-1.5 text-xs text-deep-plum outline-none focus:border-primary-purple"
              />
              <button type="button" onClick={postReply} disabled={posting || !reply.trim()}
                className="text-[11px] rounded-full bg-deep-plum text-white font-semibold px-3 py-1 hover:bg-primary-purple disabled:opacity-40">
                {posting ? <Loader2 size={11} className="animate-spin" /> : 'Post'}
              </button>
              <button type="button" onClick={() => { setReplyOpen(false); setReply('') }}
                className="text-[11px] text-purple-gray hover:text-deep-plum px-2">
                <X size={11} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-lavender rounded-xl px-4 py-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple">{label}</p>
      <p className="text-xl font-semibold text-deep-plum mt-0.5">{value}</p>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-1 transition-colors ${
        active ? 'bg-deep-plum text-white' : 'bg-lavender-tint text-purple-gray hover:bg-lavender/50 hover:text-deep-plum'
      }`}
    >
      {label}
    </button>
  )
}

function upsertDecision(list: StrategyCopyReviewDecision[], next: StrategyCopyReviewDecision): StrategyCopyReviewDecision[] {
  const idx = list.findIndex(d => d.block_id === next.block_id)
  if (idx === -1) return [...list, next]
  const clone = list.slice()
  clone[idx] = { ...list[idx], ...next }
  return clone
}

function filterComments(
  comments: StrategyCopyReviewComment[],
  decisions: StrategyCopyReviewDecision[],
  filter: FilterKey,
): StrategyCopyReviewComment[] {
  if (filter === 'all') return comments
  if (filter === 'unresolved') return comments.filter(c => !c.resolved)
  const decisionByBlock = new Map(decisions.map(d => [d.block_id, d.decision]))
  return comments.filter(c => decisionByBlock.get(c.block_id) === filter)
}

function pageCounts(
  page: ParsedCopyReviewPage,
  decisionByBlock: Map<string, StrategyCopyReviewDecision>,
  commentsByBlock: Map<string, StrategyCopyReviewComment[]>,
): { approved: number; edits: number; pending: number } {
  let approved = 0, edits = 0, pending = 0
  for (const s of page.sections) {
    for (const b of s.blocks) {
      const d = decisionByBlock.get(b.id)
      const unresolved = (commentsByBlock.get(b.id) ?? []).some(c => !c.resolved)
      if (d?.decision === 'approved' && !unresolved) approved++
      else if (d?.decision === 'edit_requested' || unresolved) edits++
      else pending++
    }
  }
  return { approved, edits, pending }
}

function countPending(
  pages: ParsedCopyReviewPage[],
  decisionByBlock: Map<string, StrategyCopyReviewDecision>,
  commentsByBlock: Map<string, StrategyCopyReviewComment[]>,
): number {
  let n = 0
  for (const p of pages) {
    for (const s of p.sections) {
      for (const b of s.blocks) {
        const d = decisionByBlock.get(b.id)
        const unresolved = (commentsByBlock.get(b.id) ?? []).some(c => !c.resolved)
        if (!(d?.decision === 'approved' && !unresolved)) n++
      }
    }
  }
  return n
}

// ── Re-upload modal (Replace all pages / Merge pages) ───────────────────────

function ReuploadModal({ existing, onClose, onApply }: {
  existing: ParsedCopyReview
  onClose: () => void
  onApply: (parsed: ParsedCopyReview, sourceHtml: string, mode: MergeMode) => Promise<void>
}) {
  const [html, setHtml] = useState('')
  const [mode, setMode] = useState<MergeMode>('merge')
  const [preview, setPreview] = useState<{ parsed: ParsedCopyReview; pageNames: string[]; dropped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const runPreview = () => {
    setError(null)
    setPreview(null)
    try {
      const parsed = parseCopyReviewHtml(html)
      if (parsed.pages.length === 0) {
        setError('No pages found. Make sure this is a Notion export containing toggle pages.')
        return
      }
      const resulting = mergeParsed(existing, parsed, mode)
      const dropped = countDroppedBlocks(existing, resulting)
      setPreview({ parsed, pageNames: parsed.pages.map(p => p.label), dropped })
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to parse HTML')
    }
  }

  // Re-run preview when mode flips (so "dropped blocks" estimate updates).
  useEffect(() => {
    if (!html.trim()) return
    try {
      const parsed = parseCopyReviewHtml(html)
      if (parsed.pages.length > 0) {
        const resulting = mergeParsed(existing, parsed, mode)
        const dropped = countDroppedBlocks(existing, resulting)
        setPreview({ parsed, pageNames: parsed.pages.map(p => p.label), dropped })
      }
    } catch { /* ignore — user is still typing */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const apply = async () => {
    if (!preview) return
    const confirmMsg = mode === 'replace'
      ? `Replace all ${existing.pages.length} existing page${existing.pages.length === 1 ? '' : 's'} with the ${preview.parsed.pages.length} page${preview.parsed.pages.length === 1 ? '' : 's'} from this upload?${preview.dropped > 0 ? ` ${preview.dropped} block${preview.dropped === 1 ? '' : 's'}' decisions/comments will be orphaned.` : ''}`
      : `Merge ${preview.parsed.pages.length} page${preview.parsed.pages.length === 1 ? '' : 's'} into the existing review? Pages with matching names will be replaced.${preview.dropped > 0 ? ` ${preview.dropped} block${preview.dropped === 1 ? '' : 's'}' decisions/comments in replaced pages will be orphaned.` : ''}`
    if (!window.confirm(confirmMsg)) return
    setBusy(true)
    await onApply(preview.parsed, html, mode)
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deep-plum/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-lavender shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-lavender bg-lavender-tint/40">
          <h3 className="text-sm font-bold text-deep-plum uppercase tracking-wider">Re-upload Copy Review</h3>
          <button type="button" onClick={onClose} className="text-purple-gray hover:text-deep-plum">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-deep-plum mb-2">What should happen to the existing pages?</label>
            <div className="space-y-2">
              <ModeOption
                checked={mode === 'merge'}
                onSelect={() => setMode('merge')}
                title="Merge pages"
                desc="Add pages that don't exist yet, and replace pages whose slug matches the new upload. Keeps unrelated pages untouched. Use this to add one new page or refresh a single page's copy."
              />
              <ModeOption
                checked={mode === 'replace'}
                onSelect={() => setMode('replace')}
                title="Replace all pages"
                desc="Wipe the existing tree and use only the newly uploaded pages. Use this when you've reshaped the doc or want to drop pages that are no longer needed."
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-deep-plum mb-1">New Notion HTML export</label>
            <textarea
              value={html}
              onChange={e => { setHtml(e.target.value); setPreview(null) }}
              placeholder="Paste the full HTML contents of the Notion export here…"
              rows={10}
              className="w-full rounded-lg border border-lavender px-3 py-2 text-xs text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 font-mono"
            />
          </div>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}

          {preview && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 space-y-1">
              <p><strong>{preview.parsed.pages.length}</strong> page{preview.parsed.pages.length === 1 ? '' : 's'} in upload: {preview.pageNames.join(', ')}</p>
              {preview.dropped > 0 && (
                <p className="text-amber-800">
                  ⚠ {preview.dropped} existing block{preview.dropped === 1 ? '' : 's'}' decisions/comments will be orphaned after apply.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={runPreview}
              disabled={!html.trim()}
              className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs font-medium text-deep-plum px-3 py-1.5 hover:bg-lavender-tint disabled:opacity-40"
            >
              Parse Preview
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="text-xs text-purple-gray hover:text-deep-plum px-3 py-1.5">
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!preview || busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : null}
                {mode === 'replace' ? 'Replace all pages' : 'Apply merge'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModeOption({ checked, onSelect, title, desc }: {
  checked: boolean
  onSelect: () => void
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
        checked
          ? 'border-primary-purple bg-primary-purple/5'
          : 'border-lavender bg-white hover:border-primary-purple/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${checked ? 'border-primary-purple bg-primary-purple' : 'border-lavender'}`}>
          {checked && <div className="h-full w-full rounded-full bg-white scale-[0.35]" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-deep-plum">{title}</p>
          <p className="text-xs text-purple-gray mt-0.5">{desc}</p>
        </div>
      </div>
    </button>
  )
}
