import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, ChevronDown, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  archivePage, archiveDocBlock, appendDocBlock, flagDocOutdated, getDocContent,
  listDocComments, updateDocBlock, verifyDoc,
} from '../../../lib/strategyNotion'
import type { DocCommentSummary, EditableBlockType } from '../../../lib/strategyNotion'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, DocTypeIcon, DeptPill, VerifBadge, PriorityFlag,
} from '../../../components/library/LibraryShell'
import { DocBlocks } from '../../../components/library/DocBlockRender'
import { StrategyEmptyCard, StrategyLoadingCard } from '../../../components/strategy/StrategyUI'
import {
  groupMilestones, loadMilestones, type SquadGroup,
} from '../../../lib/milestoneCatalog'
import type { Department, DocBlock, DocContent, DocHubEntry } from '../../../types/strategy'

const DEPT_ORDER: Department[] = ['all-in', 'web', 'branding', 'social']
const DEPT_LABEL: Record<Department, string> = {
  'all-in': 'All In', web: 'Web', branding: 'Branding', social: 'Social',
}

/** Doc detail — wiki-style two-column. Left: sibling docs in the same
 *  Document Group. Right: the doc body, rendered from a DocBlock tree. */
export default function LibraryDocPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { docs, myReads, markRead, me, applyDocArchived, applyDocUpdate } = useLibraryData()
  /** When `?review=1` is in the URL and the viewer is director-or-VP, the
   *  page renders a sticky review bar at the top with Verify + Request
   *  Changes actions in addition to the body. Reaches here from the
   *  Review Queue's "Open review" link. */
  const reviewMode = params.get('review') === '1' && me.isDirector

  const [content, setContent] = useState<DocContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState<DocCommentSummary[]>([])

  useEffect(() => {
    let cancelled = false
    if (!id) return
    setLoading(true)
    setError(null)
    setComments([])
    getDocContent(id)
      .then(c => { if (!cancelled) setContent(c) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    // Comments fetch in parallel — slower than the page load, surfaces
    // when ready; the doc body renders even if comments fail.
    listDocComments(id)
      .then(cs => { if (!cancelled) setComments(cs) })
      .catch(() => {/* silent — page works without comments */})
    return () => { cancelled = true }
  }, [id])

  const doc = content?.doc
  const groupLabel = doc?.groups[0] ?? 'Documents'
  const siblings = useMemo(() => {
    if (!doc) return []
    return docs.filter(d => d.groups.some(g => doc.groups.includes(g)))
  }, [docs, doc])

  /** When the current doc has a parent in the Doc Hub, show a "sub-page of"
   *  bread-crumb-style indicator near the top of the page. The parent
   *  may not be loaded if we landed on this doc directly (e.g., from a
   *  Notion link) — in that case `parent` stays null and we fall back to
   *  a generic "Sub-page" badge. */
  const parentDoc = useMemo(
    () => doc?.parentDocId ? docs.find(d => d.id === doc.parentDocId) ?? null : null,
    [doc?.parentDocId, docs],
  )

  /** Direct children of the current doc — surfaced as a callout below the
   *  body so readers can drill into nested SOPs without hunting in the
   *  sibling rail. */
  const childDocs = useMemo(() => {
    if (!doc) return []
    return docs
      .filter(d => d.parentDocId === doc.id)
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [doc, docs])

  /** Docs that share the same parent as the current doc — "related"
   *  pages, like the related-articles widget on a wiki. Excludes the
   *  current doc itself. Only shown when the current doc has a parent. */
  const relatedDocs = useMemo(() => {
    if (!doc?.parentDocId) return []
    return docs
      .filter(d => d.parentDocId === doc.parentDocId && d.id !== doc.id)
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [doc, docs])

  // Tree: Dept → Type → Docs (default for non-Process docs). For Process &
  // Workflows docs we render a Squad → Pathway → Step tree instead so the
  // sidebar mirrors the primary Process page's organization.
  const tree = useMemo(() => buildTree(siblings), [siblings])
  const isProcessDoc = !!doc?.groups.includes('Process & Workflows')

  const [milestoneGroups, setMilestoneGroups] = useState<SquadGroup[]>([])
  useEffect(() => {
    if (!isProcessDoc) return
    loadMilestones()
      .then(d => setMilestoneGroups(groupMilestones(d)))
      .catch(() => {/* fall back to dept tree */})
  }, [isProcessDoc])

  const unread = doc ? !myReads.has(doc.id) : false
  const [marking, setMarking] = useState(false)
  const handleMark = async () => {
    if (!doc) return
    setMarking(true)
    try { await markRead(doc.id) } finally { setMarking(false) }
  }

  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  /** Edit mode toggles inline pencil/trash overlays on text blocks +
   *  reveals the "+ Add paragraph" footer. Director-or-VP only. */
  const [editMode, setEditMode] = useState(false)

  /** Mutate one block in local state — drives optimistic UI for
   *  per-block edits. We update the cached `content.blocks` tree so the
   *  next render shows the new text without waiting for a re-fetch. */
  const updateLocalBlock = (blockId: string, updater: (b: DocBlock) => DocBlock) => {
    setContent(c => {
      if (!c) return c
      return { ...c, blocks: mutateTree(c.blocks, blockId, updater) }
    })
  }

  const handleEditBlock = async (blockId: string, type: EditableBlockType, text: string) => {
    if (!doc) return
    const before = findBlock(content?.blocks ?? [], blockId)
    updateLocalBlock(blockId, b => ({ ...b, text }))
    try {
      const result = await updateDocBlock(doc.id, blockId, type, text, undefined, me.isDirector)
      // Non-director edits flip verification back to "needs-verification".
      // Reflect that locally so the badge updates without a refetch.
      if (result.flippedToNeedsVerification) {
        const next: DocHubEntry = {
          ...doc,
          verificationStatus: 'needs-verification',
          verifiedBy: null,
          verifiedOn: null,
        }
        applyDocUpdate(next)
        setContent(c => c ? { ...c, doc: next } : c)
      }
    } catch (err) {
      // Revert on failure.
      if (before) updateLocalBlock(blockId, () => before)
      throw err
    }
  }

  const handleArchiveBlock = async (blockId: string) => {
    if (!doc) return
    const before = content?.blocks ?? []
    setContent(c => c ? { ...c, blocks: removeBlock(c.blocks, blockId) } : c)
    try {
      await archiveDocBlock(doc.id, blockId)
    } catch (err) {
      setContent(c => c ? { ...c, blocks: before } : c)
      throw err
    }
  }

  const [appendOpen, setAppendOpen] = useState(false)
  const [appendType, setAppendType] = useState<EditableBlockType>('paragraph')
  const [appendText, setAppendText] = useState('')
  const [appending, setAppending] = useState(false)
  const [appendError, setAppendError] = useState<string | null>(null)

  const [flagOpen, setFlagOpen] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const [flagging, setFlagging] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)
  const [flagSuccess, setFlagSuccess] = useState(false)
  const handleFlag = async () => {
    if (!doc || !flagReason.trim()) return
    setFlagging(true)
    setFlagError(null)
    try {
      const next = await flagDocOutdated(doc.id, me.fullName || 'Reader', flagReason.trim())
      applyDocUpdate(next)
      setContent(c => c ? { ...c, doc: next } : c)
      setFlagSuccess(true)
      setFlagReason('')
      setFlagOpen(false)
      // Auto-clear success notice after a few seconds.
      setTimeout(() => setFlagSuccess(false), 4000)
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : String(err))
    } finally {
      setFlagging(false)
    }
  }

  const handleAppend = async () => {
    if (!doc || !appendText.trim()) return
    setAppending(true)
    setAppendError(null)
    try {
      await appendDocBlock(doc.id, appendType, appendText)
      // Refresh content to pick up the new block (with its Notion ID) so
      // it's editable immediately without a full page reload.
      const fresh = await getDocContent(doc.id)
      setContent(fresh)
      setAppendText('')
      setAppendOpen(false)
    } catch (err) {
      setAppendError(err instanceof Error ? err.message : String(err))
    } finally {
      setAppending(false)
    }
  }
  const handleArchive = async () => {
    if (!doc) return
    if (!confirm(`Archive "${doc.title}"? It'll be hidden from the Library and marked archived in Notion.`)) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await archivePage(doc.id, 'doc')
      applyDocArchived(doc.id)
      navigate('/strategy/library')
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: groupLabel, to: groupSlugFor(groupLabel) },
          { label: doc?.title ?? 'Loading…' },
        ]}
      />

      {loading && !content && <StrategyLoadingCard label="Loading doc…" />}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load doc: {error}
        </div>
      )}
      {!loading && !content && !error && (
        <StrategyEmptyCard>Doc not found.</StrategyEmptyCard>
      )}

      {content && doc && reviewMode && (
        <ReviewBar
          doc={doc}
          onVerified={next => applyDocUpdate(next)}
          onArchived={id => applyDocArchived(id)}
        />
      )}

      {content && doc && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
          <aside className="sticky top-20 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-subtle)] mb-2 px-1 pb-2 border-b border-[var(--color-lib-border)]">
              {groupLabel}
            </p>
            {isProcessDoc && milestoneGroups.length > 0 ? (
              <ProcessSiblingTree
                siblings={siblings}
                milestoneGroups={milestoneGroups}
                currentDoc={doc}
              />
            ) : (
              <SiblingTree tree={tree} currentDoc={doc} />
            )}
          </aside>

          <div>
          <StartHereProgressBlock currentDoc={doc} />
          <article className="rounded-lg border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-8">
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[var(--color-lib-border)] flex-wrap">
              <span className="text-sm text-[var(--color-lib-text-muted)]">
                Last updated{' '}
                <strong className="text-[var(--color-lib-text)]">
                  {doc.lastEditedTime ? formatLong(doc.lastEditedTime) : '—'}
                </strong>
                {doc.verifiedBy?.name && <> by <strong className="text-[var(--color-lib-text)]">{doc.verifiedBy.name}</strong></>}
              </span>
              <div className="flex gap-1.5 items-center ml-auto">
                <DeptPill dept={doc.department} />
                <VerifBadge status={doc.verificationStatus} />
                {doc.priorityDoc && <PriorityFlag />}
                <a
                  href={doc.notionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in Notion"
                  className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] ml-2"
                >
                  <ExternalLink size={14} />
                </a>
                {me.isDirector && (
                  <button
                    type="button"
                    onClick={() => setEditMode(e => !e)}
                    title={editMode ? 'Exit edit mode' : 'Edit body'}
                    className={[
                      'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm border',
                      editMode
                        ? 'bg-[var(--color-lib-accent)] text-white border-[var(--color-lib-accent)]'
                        : 'border-[var(--color-lib-border)] text-[var(--color-lib-text-muted)] hover:border-[var(--color-lib-border-strong)]',
                    ].join(' ')}
                  >
                    <Pencil size={11} />
                    {editMode ? 'Done' : 'Edit'}
                  </button>
                )}
                {me.isDirector && (
                  <button
                    type="button"
                    onClick={handleArchive}
                    disabled={archiving}
                    title="Archive doc"
                    className="text-[var(--color-lib-text-subtle)] hover:text-red-500 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {archiveError && (
              <p className="text-xs text-red-600 mb-3">
                Couldn't archive: {archiveError}
              </p>
            )}

            {doc.parentDocId && (
              <div className="inline-flex items-center gap-1.5 mb-3 px-2 py-1 rounded-full bg-[var(--color-lib-accent-soft)] text-[11px] font-medium text-[var(--color-lib-accent)]">
                <span className="text-[10px] uppercase tracking-widest font-semibold">
                  Sub-page of
                </span>
                {parentDoc ? (
                  <Link
                    to={`/strategy/library/doc/${parentDoc.id}`}
                    className="hover:underline"
                  >
                    {parentDoc.title}
                  </Link>
                ) : (
                  <span className="italic">parent doc</span>
                )}
              </div>
            )}

            {doc.groups.includes('Draft') && (
              <div className="mb-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--color-lib-accent)] text-white text-[11px] font-semibold uppercase tracking-widest">
                ✨ Suggested doc · awaiting first draft
              </div>
            )}

            {comments.length > 0 && (
              <CommentsBox comments={comments} suggested={doc.groups.includes('Draft')} />
            )}

            <h1 className="text-3xl font-bold tracking-tight mb-3 leading-tight text-[var(--color-lib-text)]">
              {doc.title}
            </h1>

            <p className="text-base text-[var(--color-lib-text-muted)] leading-relaxed mb-6">
              {summaryFor(doc)}
            </p>

            {content.blocks.length === 0 && !editMode ? (
              <p className="text-sm text-[var(--color-lib-text-subtle)] italic">
                No body content. Click <em>Edit</em> above to add some, or open the doc in Notion.
              </p>
            ) : (
              <DocBlocks
                blocks={content.blocks}
                editable={editMode}
                onEdit={handleEditBlock}
                onArchive={handleArchiveBlock}
              />
            )}

            {relatedDocs.length > 0 && (
              <div className="mt-8 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ChevronDown
                    size={14}
                    className="text-[var(--color-lib-text-muted)] -rotate-90"
                  />
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-muted)]">
                    Related docs · {relatedDocs.length}
                  </p>
                  {parentDoc && (
                    <span className="text-[11px] text-[var(--color-lib-text-subtle)]">
                      Other sub-pages of <Link to={`/strategy/library/doc/${parentDoc.id}`} className="hover:underline">{parentDoc.title}</Link>
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {relatedDocs.map(r => (
                    <Link
                      key={r.id}
                      to={`/strategy/library/doc/${r.id}`}
                      className="flex items-center gap-2 rounded-sm bg-white border border-[var(--color-lib-border)] px-3 py-2 text-sm hover:border-[var(--color-lib-accent)]"
                    >
                      <DocTypeIcon type={r.types[0]} size={13} />
                      <span className="flex-1 truncate text-[var(--color-lib-text)]">{r.title}</span>
                      {!myReads.has(r.id) && (
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-muted)]">
                          Unread
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {childDocs.length > 0 && (
              <div className="mt-8 rounded-md border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ChevronDown
                    size={14}
                    className="text-[var(--color-lib-accent)] -rotate-90"
                  />
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-accent)]">
                    Sub-pages of this doc · {childDocs.length}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {childDocs.map(c => (
                    <Link
                      key={c.id}
                      to={`/strategy/library/doc/${c.id}`}
                      className="flex items-center gap-2 rounded-sm bg-white border border-[var(--color-lib-border)] px-3 py-2 text-sm hover:border-[var(--color-lib-accent)] hover:bg-white"
                    >
                      <DocTypeIcon type={c.types[0]} size={13} />
                      <span className="flex-1 truncate text-[var(--color-lib-text)]">{c.title}</span>
                      {!myReads.has(c.id) && (
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-accent)]">
                          New
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
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
                        onClick={() => { setAppendOpen(false); setAppendText(''); setAppendError(null) }}
                        disabled={appending}
                        className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAppend}
                        disabled={appending || !appendText.trim()}
                        className="rounded-sm bg-[var(--color-lib-accent)] text-white text-xs font-medium px-2.5 py-1 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
                      >
                        {appending ? 'Adding…' : 'Add block'}
                      </button>
                    </div>
                    {appendError && <p className="text-[11px] text-red-600">{appendError}</p>}
                  </div>
                )}
              </div>
            )}

            <div className="mt-12 pt-5 border-t border-[var(--color-lib-border)] flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-[var(--color-lib-text-muted)]">
                {unread
                  ? "Confirm you've read this doc to mark it complete in your reading list."
                  : "You've marked this as read."}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFlagOpen(o => !o)}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text-muted)] text-xs px-2.5 py-1.5 hover:border-[#F59E0B] hover:text-[var(--color-priority-medium)]"
                  title="Flag this doc as outdated"
                >
                  <AlertTriangle size={12} />
                  {flagOpen ? 'Cancel' : 'Flag as outdated'}
                </button>
                {unread ? (
                  <button
                    type="button"
                    onClick={handleMark}
                    disabled={marking}
                    className="rounded-sm border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] text-sm font-medium px-4 py-2 hover:bg-[#E0D8F5] disabled:opacity-50"
                  >
                    {marking ? 'Marking…' : 'Mark as read'}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] text-[var(--color-lib-text-muted)] text-sm px-4 py-2">
                    <Check size={13} />
                    Read
                  </span>
                )}
              </div>
            </div>

            {flagSuccess && (
              <div className="mt-3 rounded-sm border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] text-xs text-[var(--color-lib-text)] px-3 py-2">
                Thanks — feedback posted to Notion and the doc is back in the review queue for the verifier to confirm.
              </div>
            )}
            {flagOpen && (
              <div className="mt-4 rounded-md border border-[#F59E0B] bg-[#FEF3C7] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-[var(--color-priority-medium)]" />
                  <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-priority-medium)]">
                    Flag as outdated
                  </p>
                </div>
                <p className="text-xs text-[var(--color-lib-text-muted)]">
                  Verification status drops back to <em>Needs Verification</em> and your note posts as a Notion comment so the verifier sees what to fix.
                </p>
                <textarea
                  value={flagReason}
                  onChange={e => setFlagReason(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="What's outdated? (e.g., the Brand Guide URL changed, the workflow now skips step 3, etc.)"
                  disabled={flagging}
                  className="w-full rounded-sm border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-priority-medium)]"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setFlagOpen(false); setFlagReason(''); setFlagError(null) }}
                    disabled={flagging}
                    className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleFlag}
                    disabled={flagging || !flagReason.trim()}
                    className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-priority-medium)] text-white text-xs font-medium px-2.5 py-1 hover:opacity-90 disabled:opacity-50"
                  >
                    {flagging ? 'Flagging…' : 'Flag as outdated'}
                  </button>
                </div>
                {flagError && <p className="text-[11px] text-red-600">{flagError}</p>}
              </div>
            )}
          </article>
          </div>
        </div>
      )}
    </>
  )
}

// ── Start Here progress block ────────────────────────────────────────────
//
// When the current doc is part of the priority/Start Here flow (Priority
// Doc + Internal: Team Onboarding), surface the full reading list above
// the doc body so the reader can see where they are in the sequence.
function StartHereProgressBlock({ currentDoc }: { currentDoc: DocHubEntry }) {
  const { docs, myReads } = useLibraryData()
  const isPartOfFlow =
    currentDoc.priorityDoc &&
    currentDoc.workflowSteps.some(s => s.startsWith('Internal: Team Onboarding'))
  if (!isPartOfFlow) return null

  const onboarding = docs.filter(d =>
    d.priorityDoc &&
    d.workflowSteps.some(s => s.startsWith('Internal: Team Onboarding')),
  )
  if (onboarding.length === 0) return null

  const readCount = onboarding.filter(d => myReads.has(d.id)).length
  const pct = Math.round((readCount / onboarding.length) * 100)

  return (
    <div className="rounded-lg border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] p-4 mb-4">
      <div className="flex items-center justify-between mb-2 gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-accent)]">
            Start Here · Onboarding flow
          </p>
          <p className="text-xs text-[var(--color-lib-text)] mt-0.5">
            This doc is part of the priority reading list for new hires.
          </p>
        </div>
        <Link
          to="/strategy/library/start-here"
          className="text-[11px] font-semibold text-[var(--color-lib-accent)] hover:underline whitespace-nowrap"
        >
          Open checklist →
        </Link>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-1.5 rounded-full bg-white overflow-hidden max-w-md">
          <div className="h-full rounded-full bg-[var(--color-lib-accent)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] font-semibold text-[var(--color-lib-accent)] whitespace-nowrap">
          {readCount} of {onboarding.length} read · {pct}%
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {onboarding.map(d => {
          const read = myReads.has(d.id)
          const isCurrent = d.id === currentDoc.id
          return (
            <Link
              key={d.id}
              to={`/strategy/library/doc/${d.id}`}
              className={[
                'flex items-center gap-2 px-2 py-1 rounded-sm text-xs',
                isCurrent ? 'bg-white/70 text-[var(--color-lib-accent)] font-medium' : 'text-[var(--color-lib-text)] hover:bg-white/50',
              ].join(' ')}
            >
              <span className={[
                'w-3.5 h-3.5 rounded-sm border grid place-items-center shrink-0',
                read
                  ? 'bg-[var(--color-status-launched)] border-[var(--color-status-launched)] text-white'
                  : 'border-[var(--color-lib-border-strong)] bg-white',
              ].join(' ')}>
                {read && <span className="text-[8px] leading-none">✓</span>}
              </span>
              <span className={`flex-1 truncate ${read && !isCurrent ? 'line-through opacity-60' : ''}`}>
                {d.title}
              </span>
              {isCurrent && (
                <span className="text-[9px] uppercase tracking-widest font-semibold text-[var(--color-lib-accent)]">
                  Reading now
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function summaryFor(doc: { types: string[]; department: string | null; workflowSteps: string[]; verificationStatus: string | null; verifiedBy: { name: string | null } | null }): string {
  const parts: string[] = []
  if (doc.types[0]) parts.push(doc.types[0])
  if (doc.department) parts.push(`for the ${doc.department} Squad`)
  if (doc.workflowSteps[0]) parts.push(`during ${doc.workflowSteps[0]}`)
  const lead = parts.length ? parts.join(', ') + '.' : ''
  if (doc.verificationStatus === 'verified' && doc.verifiedBy?.name) {
    return `${lead} Last verified by ${doc.verifiedBy.name}.`.trim()
  }
  return lead || 'Doc Hub entry from Notion.'
}

function formatLong(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function groupSlugFor(group: string): string {
  if (group === 'Process & Workflows') return '/strategy/library/process'
  if (group === 'Culture & Policies')  return '/strategy/library/category/culture'
  if (group === 'Resources & Tools')   return '/strategy/library/category/resources'
  if (group === 'Strategy & Planning') return '/strategy/library/category/strategy'
  return '/strategy/library'
}

// ── Sibling tree (Dept → Type → Docs accordions) ─────────────────────────

interface DeptNode {
  dept: Department | 'unassigned'
  label: string
  types: TypeNode[]
}
interface TypeNode {
  type: string
  /** Top-level docs (no parent within this Type); each may have nested
   *  children for the parent/child sub-page hierarchy from Notion. */
  roots: DocTreeNode[]
}
interface DocTreeNode {
  doc: DocHubEntry
  children: DocTreeNode[]
}

/** Group siblings by department → type → parent/child. Notion's
 *  `Parent Document` relation gives us the nesting; docs whose parent is
 *  outside this Type subset are surfaced as roots so they aren't hidden. */
function buildTree(siblings: DocHubEntry[]): DeptNode[] {
  const byDept = new Map<Department | 'unassigned', Map<string, DocHubEntry[]>>()
  for (const d of siblings) {
    const dept: Department | 'unassigned' = d.department ?? 'unassigned'
    const type = d.types[0] ?? 'Untyped'
    if (!byDept.has(dept)) byDept.set(dept, new Map())
    const types = byDept.get(dept)!
    if (!types.has(type)) types.set(type, [])
    types.get(type)!.push(d)
  }
  const order: (Department | 'unassigned')[] = [...DEPT_ORDER, 'unassigned']
  return order
    .filter(d => byDept.has(d))
    .map<DeptNode>(dept => ({
      dept,
      label: dept === 'unassigned' ? 'Unassigned' : DEPT_LABEL[dept],
      types: [...byDept.get(dept)!.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, docs]) => ({
          type,
          roots: nestByParent(docs),
        })),
    }))
}

/** Build a parent/child forest from a flat list. Docs whose parent isn't
 *  in the list (parent in another type or no parent at all) become roots. */
function nestByParent(docs: DocHubEntry[]): DocTreeNode[] {
  const byId = new Map(docs.map(d => [d.id, d]))
  const childrenOf = new Map<string, DocHubEntry[]>()
  const roots: DocHubEntry[] = []
  for (const d of docs) {
    if (d.parentDocId && byId.has(d.parentDocId)) {
      if (!childrenOf.has(d.parentDocId)) childrenOf.set(d.parentDocId, [])
      childrenOf.get(d.parentDocId)!.push(d)
    } else {
      roots.push(d)
    }
  }
  const build = (d: DocHubEntry): DocTreeNode => ({
    doc: d,
    children: (childrenOf.get(d.id) ?? [])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(build),
  })
  return roots.slice().sort((a, b) => a.title.localeCompare(b.title)).map(build)
}

function SiblingTree({ tree, currentDoc }: { tree: DeptNode[]; currentDoc: DocHubEntry }) {
  return (
    <div className="flex flex-col gap-0.5">
      {tree.map(deptNode => {
        const containsCurrent = deptNode.types.some(t => treeContains(t.roots, currentDoc.id))
        return (
          <DeptAccordion
            key={deptNode.dept}
            node={deptNode}
            currentDoc={currentDoc}
            defaultOpen={containsCurrent}
          />
        )
      })}
    </div>
  )
}

function DeptAccordion({ node, currentDoc, defaultOpen }: {
  node: DeptNode
  currentDoc: DocHubEntry
  defaultOpen: boolean
}) {
  const totalDocs = node.types.reduce((n, t) => n + countDocs(t.roots), 0)
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-sm text-sm font-semibold text-[var(--color-lib-text)] hover:bg-[var(--color-lib-bg)] list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown size={12} className="text-[var(--color-lib-text-subtle)] transition-transform group-open:rotate-0 -rotate-90" />
        <span className="flex-1">{node.label}</span>
        <span className="text-[11px] text-[var(--color-lib-text-subtle)]">{totalDocs}</span>
      </summary>
      <div className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-[var(--color-lib-border)] pl-1">
        {node.types.map(typeNode => {
          const containsCurrent = treeContains(typeNode.roots, currentDoc.id)
          return (
            <TypeAccordion
              key={typeNode.type}
              node={typeNode}
              currentDoc={currentDoc}
              defaultOpen={containsCurrent}
            />
          )
        })}
      </div>
    </details>
  )
}

function TypeAccordion({ node, currentDoc, defaultOpen }: {
  node: TypeNode
  currentDoc: DocHubEntry
  defaultOpen: boolean
}) {
  const totalDocs = countDocs(node.roots)
  return (
    <details open={defaultOpen} className="group/type">
      <summary className="flex items-center gap-2 px-2 py-1 cursor-pointer rounded-sm text-[12px] font-medium text-[var(--color-lib-text-muted)] hover:bg-[var(--color-lib-bg)] list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown size={10} className="text-[var(--color-lib-text-subtle)] transition-transform group-open/type:rotate-0 -rotate-90" />
        <span className="flex-1">{node.type}</span>
        <span className="text-[10px] text-[var(--color-lib-text-subtle)]">{totalDocs}</span>
      </summary>
      <div className="ml-3 flex flex-col gap-0.5 border-l border-[var(--color-lib-border)] pl-1">
        {node.roots.map(n => <DocNode key={n.doc.id} node={n} currentDoc={currentDoc} />)}
      </div>
    </details>
  )
}

/** Single doc row in the sibling rail. If the doc has children (sub-pages
 *  in Notion), wraps in a `<details>` so the children can collapse. */
function DocNode({ node, currentDoc }: { node: DocTreeNode; currentDoc: DocHubEntry }) {
  const d = node.doc
  const isCurrent = d.id === currentDoc.id
  const linkClass = `flex items-center gap-1.5 px-2 py-1 rounded-sm text-[12px] ${
    isCurrent
      ? 'bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] font-medium'
      : 'text-[var(--color-lib-text-muted)] hover:bg-[var(--color-lib-bg)] hover:text-[var(--color-lib-text)]'
  }`

  if (node.children.length === 0) {
    return (
      <Link to={`/strategy/library/doc/${d.id}`} className={linkClass}>
        <DocTypeIcon type={d.types[0]} size={12} />
        <span className="truncate">{d.title}</span>
      </Link>
    )
  }

  // Auto-open if the current doc is anywhere inside this branch.
  const containsCurrent = treeContains([node], currentDoc.id)
  return (
    <details open={containsCurrent} className="group/sub">
      <summary className="flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
        <span className="cursor-pointer pl-0.5 pr-1 py-1 text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]">
          <ChevronDown size={9} className="transition-transform group-open/sub:rotate-0 -rotate-90" />
        </span>
        <Link
          to={`/strategy/library/doc/${d.id}`}
          className={`${linkClass} flex-1`}
          onClick={e => e.stopPropagation()}
        >
          <DocTypeIcon type={d.types[0]} size={12} />
          <span className="truncate">{d.title}</span>
          <span className="text-[10px] text-[var(--color-lib-text-subtle)] ml-auto">
            {countDocs([node]) - 1}
          </span>
        </Link>
      </summary>
      <div className="ml-3 flex flex-col gap-0.5 border-l border-[var(--color-lib-border)] pl-1">
        {node.children.map(c => <DocNode key={c.doc.id} node={c} currentDoc={currentDoc} />)}
      </div>
    </details>
  )
}

function countDocs(nodes: DocTreeNode[]): number {
  let n = 0
  for (const node of nodes) n += 1 + countDocs(node.children)
  return n
}
function treeContains(nodes: DocTreeNode[], id: string): boolean {
  for (const n of nodes) {
    if (n.doc.id === id) return true
    if (treeContains(n.children, id)) return true
  }
  return false
}

// ── Process-doc sibling tree (Squad → Pathway → Step → Docs) ─────────────
//
// Mirrors the primary Process & Workflows page so a director navigating
// SOPs from a doc detail sees the same hierarchy they're used to. Falls
// back to the dept/type tree for non-Process docs.

function ProcessSiblingTree({ siblings, milestoneGroups, currentDoc }: {
  siblings: DocHubEntry[]
  milestoneGroups: SquadGroup[]
  currentDoc: DocHubEntry
}) {
  // Index docs by step_name → bucket; anything that doesn't match a known
  // milestone step lands in "Other tags" so nothing's hidden.
  const knownStepNames = useMemo(() => {
    const s = new Set<string>()
    for (const g of milestoneGroups) for (const p of g.pathways) for (const st of p.steps) s.add(st.step_name)
    return s
  }, [milestoneGroups])

  const otherDocs = useMemo(() => {
    return siblings.filter(d => !d.workflowSteps.some(w => knownStepNames.has(w)))
  }, [siblings, knownStepNames])

  return (
    <div className="flex flex-col gap-0.5">
      {milestoneGroups.map(squad => {
        const pathwaysWithDocs = squad.pathways
          .map(p => ({
            ...p,
            steps: p.steps.map(s => ({
              ...s,
              docs: siblings.filter(d => d.workflowSteps.includes(s.step_name)),
            })),
          }))
          .map(p => ({ ...p, steps: p.steps.filter(s => s.docs.length > 0) }))
          .filter(p => p.steps.length > 0)
        if (pathwaysWithDocs.length === 0) return null
        const containsCurrent = pathwaysWithDocs.some(p =>
          p.steps.some(s => s.docs.some(d => d.id === currentDoc.id)),
        )
        const totalDocs = pathwaysWithDocs.reduce(
          (n, p) => n + p.steps.reduce((m, s) => m + s.docs.length, 0),
          0,
        )
        return (
          <details key={squad.squad} open={containsCurrent} className="group">
            <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-sm text-sm font-semibold text-[var(--color-lib-text)] hover:bg-[var(--color-lib-bg)] list-none [&::-webkit-details-marker]:hidden">
              <ChevronDown size={12} className="text-[var(--color-lib-text-subtle)] transition-transform group-open:rotate-0 -rotate-90" />
              <span className="flex-1">{squad.squadLabel}</span>
              <span className="text-[11px] text-[var(--color-lib-text-subtle)]">{totalDocs}</span>
            </summary>
            <div className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-[var(--color-lib-border)] pl-1">
              {pathwaysWithDocs.map(path => {
                const containsCurrent = path.steps.some(s =>
                  s.docs.some(d => d.id === currentDoc.id),
                )
                const pathwayCount = path.steps.reduce((n, s) => n + s.docs.length, 0)
                return (
                  <details key={path.pathway} open={containsCurrent} className="group/path">
                    <summary className="flex items-center gap-2 px-2 py-1 cursor-pointer rounded-sm text-[12px] font-medium text-[var(--color-lib-text-muted)] hover:bg-[var(--color-lib-bg)] list-none [&::-webkit-details-marker]:hidden">
                      <ChevronDown size={10} className="text-[var(--color-lib-text-subtle)] transition-transform group-open/path:rotate-0 -rotate-90" />
                      <span className="flex-1">{path.pathwayLabel}</span>
                      <span className="text-[10px] text-[var(--color-lib-text-subtle)]">{pathwayCount}</span>
                    </summary>
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-[var(--color-lib-border)] pl-1">
                      {path.steps.map(step => {
                        const containsCurrent = step.docs.some(d => d.id === currentDoc.id)
                        return (
                          <details key={step.id} open={containsCurrent} className="group/step">
                            <summary className="flex items-center gap-2 px-2 py-1 cursor-pointer rounded-sm text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] hover:bg-[var(--color-lib-bg)] list-none [&::-webkit-details-marker]:hidden">
                              <ChevronDown size={9} className="transition-transform group-open/step:rotate-0 -rotate-90" />
                              <span className="flex-1">
                                {step.step_number}. {step.step_name}
                              </span>
                              <span className="text-[10px] text-[var(--color-lib-text-subtle)]">{step.docs.length}</span>
                            </summary>
                            <div className="ml-3 flex flex-col gap-0.5">
                              {step.docs
                                .slice()
                                .sort((a, b) => a.title.localeCompare(b.title))
                                .map(d => <ProcessDocLink key={d.id} doc={d} currentDocId={currentDoc.id} />)
                              }
                            </div>
                          </details>
                        )
                      })}
                    </div>
                  </details>
                )
              })}
            </div>
          </details>
        )
      })}

      {otherDocs.length > 0 && (
        <details
          className="group"
          open={otherDocs.some(d => d.id === currentDoc.id)}
        >
          <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-sm text-sm font-semibold text-[var(--color-lib-text-muted)] hover:bg-[var(--color-lib-bg)] list-none [&::-webkit-details-marker]:hidden">
            <ChevronDown size={12} className="text-[var(--color-lib-text-subtle)] transition-transform group-open:rotate-0 -rotate-90" />
            <span className="flex-1">Other tags</span>
            <span className="text-[11px] text-[var(--color-lib-text-subtle)]">{otherDocs.length}</span>
          </summary>
          <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--color-lib-border)] pl-1">
            {otherDocs
              .slice()
              .sort((a, b) => a.title.localeCompare(b.title))
              .map(d => <ProcessDocLink key={d.id} doc={d} currentDocId={currentDoc.id} />)
            }
          </div>
        </details>
      )}
    </div>
  )
}

/** Notion-comments box rendered above the doc title. Two flavors:
 *   - `suggested`: the *first* comment is the VP's note prompting the
 *     doc; show it prominently as the framing the director should read.
 *   - default: a thread of reviewer feedback / outdated flags — scrolls
 *     newest-first inside a soft container. */
function CommentsBox({ comments, suggested }: {
  comments: DocCommentSummary[]
  suggested: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? comments : comments.slice(0, suggested ? 1 : 3)
  const remaining = comments.length - visible.length

  return (
    <div
      className={[
        'rounded-md border p-3 mb-4',
        suggested
          ? 'border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)]'
          : 'border-[#F59E0B]/40 bg-[#FEF3C7]',
      ].join(' ')}
    >
      <p
        className={[
          'text-[10px] uppercase tracking-widest font-semibold mb-2',
          suggested ? 'text-[var(--color-lib-accent)]' : 'text-[var(--color-priority-medium)]',
        ].join(' ')}
      >
        {suggested ? 'Note from the VP' : `Comments · ${comments.length}`}
      </p>
      <div className="space-y-2">
        {visible.map(c => {
          const date = c.createdAt
            ? new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : ''
          return (
            <div key={c.id} className="rounded-sm bg-white border border-[var(--color-lib-border)] px-3 py-2 text-sm text-[var(--color-lib-text)]">
              <div className="flex items-center gap-2 text-[11px] text-[var(--color-lib-text-subtle)] mb-1">
                <span className="font-medium text-[var(--color-lib-text-muted)]">
                  {c.authorName ?? 'Reviewer'}
                </span>
                <span>·</span>
                <span>{date}</span>
              </div>
              <p className="whitespace-pre-wrap">{c.text}</p>
            </div>
          )
        })}
      </div>
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-[11px] font-semibold text-[var(--color-lib-accent)] hover:underline"
        >
          Show {remaining} more
        </button>
      )}
    </div>
  )
}

function ProcessDocLink({ doc, currentDocId }: { doc: DocHubEntry; currentDocId: string }) {
  const isCurrent = doc.id === currentDocId
  return (
    <Link
      to={`/strategy/library/doc/${doc.id}`}
      className={[
        'flex items-center gap-1.5 px-2 py-1 rounded-sm text-[12px]',
        isCurrent
          ? 'bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] font-medium'
          : 'text-[var(--color-lib-text-muted)] hover:bg-[var(--color-lib-bg)] hover:text-[var(--color-lib-text)]',
      ].join(' ')}
    >
      <DocTypeIcon type={doc.types[0]} size={12} />
      <span className="truncate">{doc.title}</span>
    </Link>
  )
}


// ── DocBlock tree mutations (optimistic edits) ───────────────────────────

/** Walk a DocBlock tree and apply `updater` to the block whose id matches.
 *  Returns a new tree (immutable update). Used for optimistic per-block
 *  text updates so the UI reflects the edit before Notion confirms. */
function mutateTree(blocks: DocBlock[], id: string, updater: (b: DocBlock) => DocBlock): DocBlock[] {
  return blocks.map(b => {
    if (b.id === id) return updater(b)
    if (b.children && b.children.length > 0) {
      return { ...b, children: mutateTree(b.children, id, updater) }
    }
    return b
  })
}

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

// ── Review-mode bar ──────────────────────────────────────────────────────
//
// Sticky banner shown at the top of the doc when ?review=1 is in the URL
// and the viewer is director-or-VP. Houses Verify + Archive + Open in
// Notion in one place so a director can read the full doc and act on it
// without bouncing back to the queue. Request Changes is intentionally
// missing — the directors own the docs they review and edit them
// directly (in-app pencil or Notion) instead of asking themselves to.

function ReviewBar({ doc, onVerified, onArchived }: {
  doc: DocHubEntry
  onVerified: (next: DocHubEntry) => void
  onArchived: (id: string) => void
}) {
  const navigate = useNavigate()
  const [acting, setActing] = useState<'verify' | 'archive' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const alreadyVerified = doc.verificationStatus === 'verified'

  const handleVerify = async () => {
    setActing('verify')
    setError(null)
    try {
      const next = await verifyDoc(doc.id)
      onVerified(next)
      // Drop the ?review=1 flag once verified — the doc is done.
      navigate(`/strategy/library/doc/${doc.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActing(null)
    }
  }

  const handleArchive = async () => {
    if (!confirm(`Archive "${doc.title}"? It'll be hidden from the Library and marked archived in Notion.`)) return
    setActing('archive')
    setError(null)
    try {
      await archivePage(doc.id, 'doc')
      onArchived(doc.id)
      navigate('/strategy/library/queue')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setActing(null)
    }
  }

  return (
    <div className="sticky top-16 z-20 mb-4 rounded-md border border-[#F59E0B] bg-[#FEF3C7] px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-priority-medium)]">
          Review mode
        </span>
        <span className="text-sm text-[var(--color-lib-text)] flex-1">
          {alreadyVerified
            ? 'This doc has already been verified.'
            : "Review the content below, then verify it — or archive if it's not worth keeping. Edit inline with the pencil button if changes are needed."}
        </span>
        <div className="flex gap-2">
          <a
            href={doc.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-xs text-[var(--color-lib-text)] px-2.5 py-1 hover:border-[var(--color-lib-border-strong)]"
          >
            <ExternalLink size={11} />
            Open in Notion
          </a>
          {!alreadyVerified && (
            <button
              type="button"
              onClick={handleArchive}
              disabled={!!acting}
              className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-xs text-[var(--color-lib-text)] px-2.5 py-1 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 size={11} />
              {acting === 'archive' ? 'Archiving…' : 'Archive'}
            </button>
          )}
          {!alreadyVerified && (
            <button
              type="button"
              onClick={handleVerify}
              disabled={!!acting}
              className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-status-launched)] text-white text-xs font-medium px-2.5 py-1 hover:bg-[#065F46] disabled:opacity-50"
            >
              <Check size={11} />
              {acting === 'verify' ? 'Verifying…' : 'Verify'}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}

