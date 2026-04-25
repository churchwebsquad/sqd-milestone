/**
 * Unified doc-detail flyout. Replaces the separate DocDetailPanel +
 * ReviewFlyout that lived inside the Doc Manager and the Review Queue
 * page. Same component for every bucket — Needs Verification, Suggested,
 * Library — so directors see one consistent experience:
 *
 *   - Editable body (DocBlocks editable mode + Add block)
 *   - Editable properties (Department, Group, Type, Workflow Step,
 *     Verification) using a draft + Save pattern
 *   - Audience toggles (Onboarding, Required reading)
 *   - Comments thread
 *   - Verify, Archive, Open in Notion
 *   - Prev / Next walking the current bucket
 *
 * Mode-specific affordances:
 *   - `mode='suggested'` — pins the VP note prominently at the top, swaps
 *     "Verify" → "Mark complete" since the action means "the prompt has
 *     been fulfilled and the doc is verified."
 *   - `mode='review'` and `mode='library'` — same shell, same actions.
 *     Library-mode docs may already be verified; the Verify button
 *     becomes "Already verified" disabled.
 *
 * Request Changes is intentionally absent. Directors own these docs and
 * can edit body or properties directly — request-changes was a vestige
 * of the asymmetric review flow before this consolidation.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, Loader2,
  Pencil, Plus, Sparkles, Trash2, X,
} from 'lucide-react'
import {
  appendDocBlock, archiveDocBlock, archivePage, flagDocOutdated, getDocContent,
  listDocComments, updateDoc, updateDocBlock, verifyDoc,
} from '../../lib/strategyNotion'
import type {
  DocCommentSummary, EditableBlockType, UpdateDocBlockResult,
} from '../../lib/strategyNotion'
import {
  groupMilestones, type SquadGroup,
} from '../../lib/milestoneCatalog'
import { listAllMilestoneDefinitions } from '../../lib/library'
import { useLibraryData } from './LibraryDataContext'
import {
  DocTypeIcon, DeptPill, VerifBadge, OnboardingPill,
} from './LibraryShell'
import { DocBlocks } from './DocBlockRender'
import type {
  Department, DocBlock, DocContent, DocHubEntry, VerificationStatus,
} from '../../types/strategy'

export type DocFlyoutMode = 'review' | 'suggested' | 'library'

const DOC_GROUPS = ['Process & Workflows', 'Resources & Tools', 'Culture & Policies', 'Strategy & Planning', 'Draft']
const DOC_TYPES = ['SOP', 'Guide', 'Template', 'Onboarding & Offboarding', 'Partner-facing', 'Suggested Document']

const VERIF_LABEL: Record<VerificationStatus, string> = {
  'needs-verification': 'Needs Verification',
  'in-progress':        'In Progress',
  'verified':           'Verified',
  'outdated':           'Outdated',
}

interface DocFlyoutProps {
  docId: string
  /** Ordered docs in the current bucket — drives Prev / Next. Pass
   *  `[doc]` if there's only one (e.g. opening from a search result). */
  queueDocs: DocHubEntry[]
  mode: DocFlyoutMode
  onClose: () => void
  onUpdated: (next: DocHubEntry) => void
  onArchived: (id: string) => void
  /** Switch to a different doc in the queue (Prev/Next, or post-action
   *  auto-advance). Implementations typically `setOpenDoc(...)`. */
  onNavigate: (id: string) => void
}

export function DocFlyout({
  docId, queueDocs, mode, onClose, onUpdated, onArchived, onNavigate,
}: DocFlyoutProps) {
  const { docs, me, requiredReading, setRequired } = useLibraryData()

  // ── Source doc + body load ────────────────────────────────────────────
  const idx = queueDocs.findIndex(d => d.id === docId)
  const total = queueDocs.length
  const prevDoc = idx > 0 ? queueDocs[idx - 1] : null
  const nextDoc = idx >= 0 && idx < total - 1 ? queueDocs[idx + 1] : null
  // Always prefer the live entry from the Library context — it holds the
  // latest property updates after a save.
  const liveDoc = docs.find(d => d.id === docId) ?? queueDocs[idx] ?? null

  const [content, setContent] = useState<DocContent | null>(null)
  const [loadingBody, setLoadingBody] = useState(true)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [comments, setComments] = useState<DocCommentSummary[]>([])
  const [milestoneGroups, setMilestoneGroups] = useState<SquadGroup[]>([])

  // Reload body + comments when the doc changes (Prev / Next).
  useEffect(() => {
    let cancelled = false
    setLoadingBody(true)
    setBodyError(null)
    setContent(null)
    setComments([])
    getDocContent(docId)
      .then(c => { if (!cancelled) setContent(c) })
      .catch(err => { if (!cancelled) setBodyError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoadingBody(false) })
    listDocComments(docId)
      .then(c => { if (!cancelled) setComments(c) })
      .catch(() => {/* silent */})
    return () => { cancelled = true }
  }, [docId])

  useEffect(() => {
    listAllMilestoneDefinitions()
      .then(rows => setMilestoneGroups(groupMilestones(rows.filter(r => r.is_active))))
      .catch(() => {/* fallback to free-text only */})
  }, [])

  // ── Local block tree for optimistic per-block edits ───────────────────
  const [blocks, setBlocks] = useState<DocBlock[]>([])
  useEffect(() => { setBlocks(content?.blocks ?? []) }, [content])

  // ── Property draft + dirty state ──────────────────────────────────────
  const initialDraft = useMemo(() => {
    if (!liveDoc) return null
    return {
      department: liveDoc.department,
      group: liveDoc.groups[0] ?? '',
      type: liveDoc.types[0] ?? '',
      verificationStatus: liveDoc.verificationStatus ?? 'needs-verification',
      workflowStep: liveDoc.workflowSteps[0] ?? '',
      isOnboarding: liveDoc.priorityDoc && liveDoc.workflowSteps.includes('Internal: Team Onboarding'),
      isRequired: requiredReading.has(liveDoc.id),
    }
  }, [liveDoc, requiredReading])
  const [draft, setDraft] = useState(initialDraft)
  useEffect(() => { setDraft(initialDraft) }, [initialDraft])

  const dirty = useMemo(() => {
    if (!draft || !initialDraft) return false
    return (
      draft.department !== initialDraft.department ||
      draft.group !== initialDraft.group ||
      draft.type !== initialDraft.type ||
      draft.verificationStatus !== initialDraft.verificationStatus ||
      draft.workflowStep !== initialDraft.workflowStep ||
      draft.isOnboarding !== initialDraft.isOnboarding ||
      draft.isRequired !== initialDraft.isRequired
    )
  }, [draft, initialDraft])

  // ── Action state ──────────────────────────────────────────────────────
  const [acting, setActing] = useState<'verify' | 'archive' | 'save' | 'flag' | null>(null)
  const [flagOpen, setFlagOpen] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  // Title draft. Mirrors the doc's title while edit mode is on, then
  // commits on blur/Enter via updateDoc. Reset whenever a new doc loads
  // (Prev/Next nav) so the input doesn't show a stale value.
  const [titleDraft, setTitleDraft] = useState<string>(liveDoc?.title ?? '')
  const [titleSaving, setTitleSaving] = useState(false)
  useEffect(() => {
    setTitleDraft(liveDoc?.title ?? '')
  }, [liveDoc?.id, liveDoc?.title])

  const commitTitle = async () => {
    if (!liveDoc) return
    const next = titleDraft.trim()
    if (!next || next === liveDoc.title) {
      // Empty title would orphan the page in Notion; revert silently.
      setTitleDraft(liveDoc.title)
      return
    }
    setTitleSaving(true)
    setError(null)
    try {
      const updated = await updateDoc(liveDoc.id, { title: next })
      onUpdated(updated)
    } catch (err) {
      setError(toErrorMessage(err))
      setTitleDraft(liveDoc.title)
    } finally {
      setTitleSaving(false)
    }
  }

  // ── Body editor handlers ─────────────────────────────────────────────
  const [appendOpen, setAppendOpen] = useState(false)
  const [appendType, setAppendType] = useState<EditableBlockType>('paragraph')
  const [appendText, setAppendText] = useState('')
  const [appending, setAppending] = useState(false)

  const handleEditBlock = async (blockId: string, type: EditableBlockType, text: string) => {
    if (!liveDoc) return
    const before = findBlock(blocks, blockId)
    setBlocks(prev => mutateTree(prev, blockId, b => ({ ...b, text })))
    try {
      const result: UpdateDocBlockResult = await updateDocBlock(liveDoc.id, blockId, type, text, undefined, me.isDirector)
      if (result.flippedToNeedsVerification) {
        const next: DocHubEntry = {
          ...liveDoc,
          verificationStatus: 'needs-verification',
          verifiedBy: null,
          verifiedOn: null,
        }
        onUpdated(next)
      }
    } catch (err) {
      if (before) setBlocks(prev => mutateTree(prev, blockId, () => before))
      throw err
    }
  }

  const handleArchiveBlock = async (blockId: string) => {
    if (!liveDoc) return
    const before = blocks
    setBlocks(prev => removeBlock(prev, blockId))
    try {
      await archiveDocBlock(liveDoc.id, blockId)
    } catch (err) {
      setBlocks(before)
      throw err
    }
  }

  const handleAppendBlock = async () => {
    if (!liveDoc || !appendText.trim()) return
    setAppending(true)
    try {
      await appendDocBlock(liveDoc.id, appendType, appendText)
      // Refetch so the new block has its Notion id and is editable.
      const fresh = await getDocContent(liveDoc.id)
      setContent(fresh)
      setAppendText('')
      setAppendOpen(false)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setAppending(false)
    }
  }

  // ── Quick-action handlers ────────────────────────────────────────────
  const wrap = async (label: typeof acting, fn: () => Promise<void>) => {
    setActing(label)
    setError(null)
    try { await fn() }
    catch (err) { setError(toErrorMessage(err)) }
    finally { setActing(null) }
  }

  const handleVerify = () => wrap('verify', async () => {
    if (!liveDoc) return
    const next = await verifyDoc(liveDoc.id)
    onUpdated(next)
    if (nextDoc) onNavigate(nextDoc.id)
    else onClose()
  })

  const handleArchive = () => wrap('archive', async () => {
    if (!liveDoc) return
    if (!confirm(`Archive "${liveDoc.title}"?`)) return
    await archivePage(liveDoc.id, 'doc')
    onArchived(liveDoc.id)
    if (nextDoc) onNavigate(nextDoc.id)
    else onClose()
  })

  const handleFlagOutdated = () => wrap('flag', async () => {
    if (!liveDoc || !flagReason.trim()) return
    const next = await flagDocOutdated(liveDoc.id, me.fullName || 'Reviewer', flagReason.trim())
    onUpdated(next)
    setFlagOpen(false)
    setFlagReason('')
  })

  const handleSaveProperties = () => wrap('save', async () => {
    if (!liveDoc || !draft) return

    const wf = new Set<string>()
    if (draft.workflowStep) wf.add(draft.workflowStep)
    if (draft.isOnboarding) wf.add('Internal: Team Onboarding')

    const patch: Parameters<typeof updateDoc>[1] = {
      department: (draft.department || null) as Department | null,
      groups: draft.group ? [draft.group] : [],
      types: draft.type ? [draft.type] : [],
      verificationStatus: draft.verificationStatus as VerificationStatus,
      workflowSteps: [...wf],
      priorityDoc: draft.isOnboarding,
    }

    const next = await updateDoc(liveDoc.id, patch)
    onUpdated(next)
    if (initialDraft && draft.isRequired !== initialDraft.isRequired) {
      if (!me.employeeId) throw new Error('Not signed in')
      await setRequired(liveDoc.id, draft.isRequired)
    }
  })

  // ── Suggested-mode framing ───────────────────────────────────────────
  // The first comment is the VP's prompt. Pin it at the top of the body
  // area so the director sees the framing immediately.
  const vpNoteComment = mode === 'suggested' && comments.length > 0 ? comments[0] : null

  if (!liveDoc || !draft) return null

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <aside
        className="w-full max-w-3xl h-full overflow-y-auto bg-white shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[var(--color-lib-border)] px-5 py-3 flex items-start gap-3 z-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <DocTypeIcon type={liveDoc.types[0]} size={14} />
              {editMode ? (
                <input
                  type="text"
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => void commitTitle()}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      ;(e.target as HTMLInputElement).blur()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setTitleDraft(liveDoc.title)
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                  disabled={titleSaving}
                  placeholder="Untitled doc"
                  className="flex-1 min-w-0 text-base font-semibold text-[var(--color-lib-text)] bg-transparent outline-none border-b border-[var(--color-lib-accent)] py-0.5 disabled:opacity-60"
                />
              ) : (
                <h2 className="text-base font-semibold text-[var(--color-lib-text)] truncate">
                  {liveDoc.title}
                </h2>
              )}
              {mode === 'suggested' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-lib-accent)] text-white text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 shrink-0">
                  <Sparkles size={10} />
                  Suggested
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <DeptPill dept={liveDoc.department} />
              <VerifBadge status={liveDoc.verificationStatus} />
              {liveDoc.priorityDoc && <OnboardingPill />}
              {total > 1 && (
                <span className="text-[11px] text-[var(--color-lib-text-subtle)]">
                  {idx + 1} of {total}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Action bar */}
        <div className="border-b border-[var(--color-lib-border)] px-5 py-2.5 bg-[var(--color-lib-bg)] flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleVerify}
            disabled={!!acting || liveDoc.verificationStatus === 'verified'}
            className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-status-launched)] text-white text-xs font-medium px-3 py-1.5 hover:bg-[#065F46] disabled:opacity-50"
          >
            {acting === 'verify' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            {acting === 'verify'
              ? (mode === 'suggested' ? 'Marking…' : 'Verifying…')
              : liveDoc.verificationStatus === 'verified'
                ? 'Already verified'
                : (mode === 'suggested' ? 'Mark complete' : 'Verify')}
          </button>
          <button
            type="button"
            onClick={() => setEditMode(e => !e)}
            className={[
              'inline-flex items-center gap-1 rounded-sm border text-xs font-medium px-3 py-1.5',
              editMode
                ? 'bg-[var(--color-lib-accent)] text-white border-[var(--color-lib-accent)]'
                : 'border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]',
            ].join(' ')}
          >
            <Pencil size={11} />
            {editMode ? 'Done editing' : 'Edit body'}
          </button>
          <button
            type="button"
            onClick={() => setFlagOpen(o => !o)}
            disabled={!!acting}
            className={[
              'inline-flex items-center gap-1 rounded-sm border text-xs font-medium px-3 py-1.5 disabled:opacity-50',
              flagOpen
                ? 'bg-[#FEE2E2] border-[var(--color-priority-high)] text-[var(--color-priority-high)]'
                : 'border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text-muted)] hover:border-[var(--color-priority-high)] hover:text-[var(--color-priority-high)]',
            ].join(' ')}
            title="Flag this doc as outdated — sets status to Outdated and posts a Notion comment with your reason"
          >
            <AlertTriangle size={11} />
            {flagOpen ? 'Cancel' : 'Flag outdated'}
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={!!acting}
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text-muted)] text-xs font-medium px-3 py-1.5 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 size={11} />
            Archive
          </button>
          <a
            href={liveDoc.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text)] text-xs font-medium px-3 py-1.5 hover:border-[var(--color-lib-border-strong)]"
          >
            <ExternalLink size={11} />
            Notion
          </a>
          <span className="flex-1" />
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => prevDoc && onNavigate(prevDoc.id)}
                disabled={!prevDoc || !!acting}
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text)] text-xs font-medium px-2 py-1.5 disabled:opacity-50"
              >
                <ArrowLeft size={11} />
                Prev
              </button>
              <button
                type="button"
                onClick={() => nextDoc && onNavigate(nextDoc.id)}
                disabled={!nextDoc || !!acting}
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text)] text-xs font-medium px-2 py-1.5 disabled:opacity-50"
              >
                Next
                <ArrowRight size={11} />
              </button>
            </>
          )}
        </div>

        {/* Flag-as-outdated reason panel — opens below the action bar
            when the user clicks Flag outdated. Posts a Notion comment
            with the reason + flips Verification Status to Outdated. */}
        {flagOpen && (
          <div className="border-b border-[var(--color-lib-border)] px-5 py-3 bg-[#FEE2E2] space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-[var(--color-priority-high)]" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-priority-high)]">
                Flag as outdated
              </p>
            </div>
            <p className="text-xs text-[var(--color-lib-text-muted)] leading-relaxed">
              Sets Verification Status to <strong>Outdated</strong> and posts a Notion comment with your reason. The doc stays readable; directors triage outdated rows in Needs Verification with a distinct red badge so they're easy to spot.
            </p>
            <textarea
              value={flagReason}
              onChange={e => setFlagReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="What's outdated? (e.g., the workflow now skips step 3, the Brand Guide URL changed, etc.)"
              disabled={acting === 'flag'}
              className="w-full rounded-sm border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-priority-high)]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setFlagOpen(false); setFlagReason('') }}
                disabled={acting === 'flag'}
                className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFlagOutdated}
                disabled={acting === 'flag' || !flagReason.trim()}
                className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-priority-high)] text-white text-xs font-medium px-2.5 py-1 hover:opacity-90 disabled:opacity-50"
              >
                {acting === 'flag' && <Loader2 size={11} className="animate-spin" />}
                {acting === 'flag' ? 'Flagging…' : 'Flag as outdated'}
              </button>
            </div>
          </div>
        )}

        {/* Body container */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">
            {/* VP note prompt — Suggested mode only */}
            {vpNoteComment && (
              <div className="rounded-md border border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] px-4 py-3">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-accent)] mb-1.5">
                  Note from {vpNoteComment.authorName ?? 'VP'}
                  {vpNoteComment.createdAt && (
                    <> · {new Date(vpNoteComment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</>
                  )}
                </p>
                <p className="text-sm text-[var(--color-lib-text)] leading-relaxed whitespace-pre-wrap">
                  {vpNoteComment.text}
                </p>
              </div>
            )}

            {/* Properties — collapsed by default to keep the body the
                primary focus, but always visible since editing properties
                is core to the review experience. */}
            <PropertiesSection
              draft={draft}
              setDraft={setDraft}
              allDocs={docs}
              milestoneGroups={milestoneGroups}
            />

            {/* Audience */}
            <AudienceSection draft={draft} setDraft={setDraft} />

            {/* Body */}
            <div>
              <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-2">
                Body
              </p>
              {loadingBody && <p className="text-sm text-[var(--color-lib-text-subtle)] italic">Loading body…</p>}
              {bodyError && (
                <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  Couldn't load doc body: {bodyError}
                </div>
              )}
              {content && blocks.length === 0 && !editMode && (
                <p className="text-sm text-[var(--color-lib-text-subtle)] italic">
                  No body content yet. Click <em>Edit body</em> above to write inline.
                </p>
              )}
              {content && (blocks.length > 0 || editMode) && (
                <DocBlocks
                  blocks={blocks}
                  editable={editMode}
                  onEdit={handleEditBlock}
                  onArchive={handleArchiveBlock}
                />
              )}

              {editMode && (
                <div className="mt-4 pt-4 border-t border-dashed border-[var(--color-lib-border)]">
                  {!appendOpen ? (
                    <button
                      type="button"
                      onClick={() => setAppendOpen(true)}
                      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-lib-accent)] hover:text-[var(--color-lib-accent-hover)] font-medium"
                    >
                      <Plus size={14} />
                      Add a block
                    </button>
                  ) : (
                    <div className="rounded-md border border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-accent)]">
                          Type
                        </label>
                        <select
                          value={appendType}
                          onChange={e => setAppendType(e.target.value as EditableBlockType)}
                          disabled={appending}
                          className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none"
                        >
                          <option value="paragraph">Paragraph</option>
                          <option value="heading_1">Heading 1</option>
                          <option value="heading_2">Heading 2</option>
                          <option value="heading_3">Heading 3</option>
                          <option value="bulleted_list_item">Bullet</option>
                          <option value="numbered_list_item">Numbered</option>
                          <option value="to_do">To-do</option>
                          <option value="quote">Quote</option>
                          <option value="callout">Callout</option>
                        </select>
                      </div>
                      <textarea
                        value={appendText}
                        onChange={e => setAppendText(e.target.value)}
                        disabled={appending}
                        rows={3}
                        autoFocus
                        placeholder="Type the new block's text…"
                        className="w-full rounded-sm border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-lib-accent)]"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setAppendOpen(false); setAppendText('') }}
                          disabled={appending}
                          className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleAppendBlock}
                          disabled={appending || !appendText.trim()}
                          className="rounded-sm bg-[var(--color-lib-accent)] text-white text-xs font-medium px-2.5 py-1 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
                        >
                          {appending ? 'Adding…' : 'Add block'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Comments — minus the VP note in Suggested mode (already
                rendered up top). */}
            {(() => {
              const visibleComments = mode === 'suggested' ? comments.slice(1) : comments
              if (visibleComments.length === 0) return null
              return (
                <div>
                  <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-2">
                    Comments ({visibleComments.length})
                  </p>
                  <div className="space-y-2">
                    {visibleComments.map(c => {
                      const date = c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : ''
                      return (
                        <div key={c.id} className="rounded-sm border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] px-3 py-2 text-xs">
                          <p className="text-[10px] text-[var(--color-lib-text-subtle)] mb-1">
                            <span className="font-medium text-[var(--color-lib-text-muted)]">{c.authorName ?? 'Reviewer'}</span> · {date}
                          </p>
                          <p className="whitespace-pre-wrap">{c.text}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {error && <p className="text-[11px] text-red-600">{error}</p>}
          </div>
        </div>

        {/* Sticky save bar — appears only when properties are dirty */}
        {dirty && (
          <div className="sticky bottom-0 bg-white border-t border-[var(--color-lib-border)] px-5 py-3 flex items-center justify-end gap-2">
            <span className="text-[11px] text-[var(--color-priority-medium)] font-medium mr-auto">
              Unsaved property changes
            </span>
            <button
              type="button"
              onClick={() => initialDraft && setDraft(initialDraft)}
              disabled={!!acting}
              className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs font-medium text-[var(--color-lib-text-muted)] px-3 py-1.5 disabled:opacity-50"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleSaveProperties}
              disabled={!!acting}
              className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-lib-accent)] text-white text-xs font-medium px-3 py-1.5 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
            >
              {acting === 'save' && <Loader2 size={11} className="animate-spin" />}
              {acting === 'save' ? 'Saving…' : 'Save properties'}
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}

// ── Properties section ──────────────────────────────────────────────────

interface DocFlyoutDraft {
  department: Department | null
  group: string
  type: string
  verificationStatus: VerificationStatus
  workflowStep: string
  isOnboarding: boolean
  isRequired: boolean
}

function PropertiesSection({
  draft, setDraft, allDocs, milestoneGroups,
}: {
  draft: DocFlyoutDraft
  setDraft: React.Dispatch<React.SetStateAction<DocFlyoutDraft | null>>
  allDocs: DocHubEntry[]
  milestoneGroups: SquadGroup[]
}) {
  const knownTypes = useMemo(() => {
    const set = new Set<string>(DOC_TYPES)
    for (const d of allDocs) for (const t of d.types) set.add(t)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [allDocs])

  const update = (patch: Partial<DocFlyoutDraft>) =>
    setDraft(d => d ? { ...d, ...patch } : d)

  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">
        Properties
      </p>
      <FieldRow label="Department">
        <select
          value={draft.department ?? ''}
          onChange={e => update({ department: (e.target.value || null) as Department | null })}
          className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
        >
          <option value="">— None —</option>
          <option value="all-in">All In</option>
          <option value="web">Web</option>
          <option value="branding">Branding</option>
          <option value="social">Social</option>
        </select>
      </FieldRow>
      <FieldRow label="Group">
        <select
          value={draft.group}
          onChange={e => {
            const nextGroup = e.target.value
            // Workflow Step only renders for the Process & Workflows
            // group; clear any stale step value when the user picks a
            // different group so the save round-trip doesn't persist
            // a tag the form is no longer showing.
            update(nextGroup === 'Process & Workflows'
              ? { group: nextGroup }
              : { group: nextGroup, workflowStep: '' })
          }}
          className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
        >
          <option value="">— None —</option>
          {DOC_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Type">
        <ComboBox
          value={draft.type}
          options={knownTypes}
          placeholder="Type a new type to create…"
          onChange={v => update({ type: v })}
        />
      </FieldRow>
      <FieldRow label="Verification">
        <select
          value={draft.verificationStatus}
          onChange={e => update({ verificationStatus: e.target.value as VerificationStatus })}
          className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
        >
          <option value="needs-verification">{VERIF_LABEL['needs-verification']}</option>
          <option value="in-progress">{VERIF_LABEL['in-progress']}</option>
          <option value="verified">{VERIF_LABEL['verified']}</option>
          <option value="outdated">{VERIF_LABEL['outdated']}</option>
        </select>
      </FieldRow>
      {/* Workflow Step is only meaningful for docs in the
          Process & Workflows taxonomy — that's the only group
          rendered as a milestone-pathway tree on the partner-facing
          views. Hide the picker for other groups so the form doesn't
          imply pathway-tagging that won't show anywhere. */}
      {draft.group === 'Process & Workflows' && (
        <FieldRow label="Workflow Step">
          <select
            value={draft.workflowStep}
            onChange={e => update({ workflowStep: e.target.value })}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
          >
            <option value="">— None —</option>
            {milestoneGroups.flatMap(squad =>
              squad.pathways.flatMap(p => p.steps.map(st => (
                <option key={st.id} value={st.step_name}>
                  {squad.squadLabel} · {p.pathwayLabel} · {st.step_number}. {st.step_name}
                </option>
              ))),
            )}
            <option value="Internal: Partner Onboarding">Internal: Partner Onboarding</option>
            <option value="Internal: Offboarding">Internal: Offboarding</option>
          </select>
        </FieldRow>
      )}
    </div>
  )
}

function AudienceSection({
  draft, setDraft,
}: {
  draft: DocFlyoutDraft
  setDraft: React.Dispatch<React.SetStateAction<DocFlyoutDraft | null>>
}) {
  const handleOnboardingToggle = () => {
    setDraft(d => {
      if (!d) return d
      const next = !d.isOnboarding
      // When turning Onboarding off, also clear the Internal: Team
      // Onboarding workflow step from the draft so the save round-trip
      // doesn't reapply onboarding via the workflow tag.
      const workflowStep = !next && d.workflowStep === 'Internal: Team Onboarding'
        ? ''
        : d.workflowStep
      return { ...d, isOnboarding: next, workflowStep }
    })
  }
  const handleRequiredToggle = () =>
    setDraft(d => d ? { ...d, isRequired: !d.isRequired } : d)
  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] p-3 space-y-3">
      <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">
        Audience
      </p>
      <ToggleRow
        checked={draft.isOnboarding}
        onChange={handleOnboardingToggle}
        label="Onboarding doc"
        description="Adds this doc to the Start Here onboarding flow for every new hire in the doc's department. Tags it with Priority + Internal: Team Onboarding."
      />
      <ToggleRow
        checked={draft.isRequired}
        onChange={handleRequiredToggle}
        label="Required reading"
        description="Forces this doc to appear in Recent Updates by default for everyone in the doc's department."
      />
      <p className="text-[10px] text-[var(--color-lib-text-muted)] leading-relaxed pt-1 border-t border-[var(--color-lib-border)]">
        These flags affect <strong>every staff member in the doc's department</strong>. To curate a specific person's onboarding or reading list, head to <strong>Manage Squad</strong>.
      </p>
    </div>
  )
}

function ToggleRow({ checked, onChange, label, description }: {
  checked: boolean
  onChange: () => void
  label: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={onChange}
        className={[
          'relative inline-flex w-10 h-5 rounded-full transition-colors mt-0.5 shrink-0',
          checked ? 'bg-[var(--color-lib-accent)]' : 'bg-[var(--color-lib-border)]',
        ].join(' ')}
        aria-pressed={checked}
      >
        <span
          className={[
            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-lib-text)]">{label}</p>
        <p className="text-[11px] text-[var(--color-lib-text-muted)] leading-relaxed mt-0.5">
          {description}
        </p>
      </div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function ComboBox({ value, options, placeholder, onChange }: {
  value: string
  options: string[]
  placeholder?: string
  onChange: (v: string) => void
}) {
  const datalistId = useMemo(() => `combo-${Math.random().toString(36).slice(2, 9)}`, [])
  return (
    <>
      <input
        list={datalistId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none"
      />
      <datalist id={datalistId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </>
  )
}

// ── Block tree helpers ──────────────────────────────────────────────────

function findBlock(blocks: DocBlock[], id: string): DocBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b
    if (b.children) {
      const hit = findBlock(b.children, id)
      if (hit) return hit
    }
  }
  return null
}

function mutateTree(blocks: DocBlock[], id: string, updater: (b: DocBlock) => DocBlock): DocBlock[] {
  return blocks.map(b => {
    if (b.id === id) return updater(b)
    if (b.children && b.children.length > 0) {
      return { ...b, children: mutateTree(b.children, id, updater) }
    }
    return b
  })
}

function removeBlock(blocks: DocBlock[], id: string): DocBlock[] {
  const out: DocBlock[] = []
  for (const b of blocks) {
    if (b.id === id) continue
    if (b.children && b.children.length > 0) {
      out.push({ ...b, children: removeBlock(b.children, id) })
    } else {
      out.push(b)
    }
  }
  return out
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const maybe = err as { message?: unknown }
    if (typeof maybe.message === 'string') return maybe.message
    try { return JSON.stringify(err) } catch { /* fall through */ }
  }
  return String(err)
}
