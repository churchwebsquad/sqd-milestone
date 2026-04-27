import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, ExternalLink,
  Layers, Lightbulb, Pencil, Plus, Search, Trash2, X,
} from 'lucide-react'
import {
  appendDocBlock, archiveDocBlock, archivePage, getActionItem,
  getInitiativeDetail, listInitiatives, markActionItemComplete, suggestActionItem,
  updateDocBlock, updateMilestone,
} from '../../lib/strategyNotion'
import type { EditableBlockType } from '../../lib/strategyNotion'
import { EditableSelect } from '../../components/strategy/editors/EditableSelect'
import { EditablePerson } from '../../components/strategy/editors/EditablePerson'
import { EditableDate } from '../../components/strategy/editors/EditableDate'
import { EditableText } from '../../components/strategy/editors/EditableText'
import { usePopoverDismiss } from '../../components/strategy/editors/usePopover'
import { useStrategyFetch } from '../../hooks/useStrategyFetch'
import type {
  ActionItemContent, DocBlock, Initiative, InitiativeDetailBundle, Milestone, MilestoneStatus,
  ProgressEntry,
} from '../../types/strategy'
import { useStrategyMutate } from '../../hooks/useStrategyMutate'
import { StrategyShell } from '../../components/strategy/StrategyShell'
import {
  StrategyEmptyCard, StrategyLoadingCard,
} from '../../components/strategy/StrategyUI'
import { DocBlocks } from '../../components/library/DocBlockRender'
import { PostProgressForm } from '../../components/strategy/editors/PostProgressForm'
import { ProgressEntryItem } from '../../components/strategy/ProgressEntryItem'

/** Action Item detail — wiki-style two-column. Left rail lists sibling
 *  Action Items under the same Initiative; right column has the body
 *  rendered from Notion blocks, plus footer actions: Mark complete and
 *  Suggest next Action Item. */
export default function ActionItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, loading, error, refetch } = useStrategyFetch<ActionItemContent>(
    () => getActionItem(id!),
    [id],
  )

  /** Local copy of the body blocks so per-block edits update without
   *  refetching the entire page. */
  const [blocks, setBlocks] = useState<DocBlock[]>([])
  useEffect(() => { setBlocks(data?.blocks ?? []) }, [data])

  const [editMode, setEditMode] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  // Append-block UX (mirrors LibraryDocPage).
  const [appendOpen, setAppendOpen] = useState(false)
  const [appendType, setAppendType] = useState<EditableBlockType>('paragraph')
  const [appendText, setAppendText] = useState('')
  const [appending, setAppending] = useState(false)

  const handleEditBlock = async (blockId: string, type: EditableBlockType, text: string) => {
    if (!id) return
    const before = findBlock(blocks, blockId)
    setBlocks(prev => mutateTree(prev, blockId, b => ({ ...b, text })))
    try {
      // Action Items aren't subject to verification flips — pass
      // isDirector=true to skip the doc-only verification reset path.
      await updateDocBlock(id, blockId, type, text, undefined, true)
    } catch (err) {
      if (before) setBlocks(prev => mutateTree(prev, blockId, () => before))
      throw err
    }
  }

  const handleArchiveBlock = async (blockId: string) => {
    if (!id) return
    const before = blocks
    setBlocks(prev => removeBlock(prev, blockId))
    try {
      await archiveDocBlock(id, blockId)
    } catch (err) {
      setBlocks(before)
      throw err
    }
  }

  const handleAppendBlock = async () => {
    if (!id || !appendText.trim()) return
    setAppending(true)
    try {
      await appendDocBlock(id, appendType, appendText)
      // Refetch so the new block has its Notion id and can be edited
      // immediately.
      refetch()
      setAppendText('')
      setAppendOpen(false)
    } catch (err) {
      console.error(err)
    } finally {
      setAppending(false)
    }
  }

  const handleArchive = async () => {
    if (!id) return
    if (!confirm('Archive this Action Item? It\'s removed from the active list and the Initiative.')) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await archivePage(id, 'milestone')
      // Bounce back to the (primary) parent initiative so the user
      // lands on a useful page. Multi-initiative items pick the first.
      const back = data?.actionItem.initiativeIds[0] ?? null
      navigate(back ? `/strategy/initiatives/${back}` : '/strategy/initiatives')
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiving(false)
    }
  }

  // The Initiative bundle gives us the sibling list + the initiative name
  // for the breadcrumb. Loaded once we know the parent initiative ID.
  // Multi-initiative Action Items use their *first* parent for the
  // sibling rail and breadcrumb — switching the rail across multiple
  // parents would be more confusing than helpful for now.
  // Refetch helper exposed so post-progress + sibling-status changes can
  // refresh without remounting.
  const [bundle, setBundle] = useState<InitiativeDetailBundle | null>(null)
  const initiativeId = data?.actionItem.initiativeIds[0] ?? null
  const reloadBundle = () => {
    if (!initiativeId) return
    getInitiativeDetail(initiativeId).then(setBundle).catch(() => {/* silent */})
  }
  useEffect(() => {
    if (!initiativeId) { setBundle(null); return }
    let cancelled = false
    getInitiativeDetail(initiativeId)
      .then(b => { if (!cancelled) setBundle(b) })
      .catch(() => {/* sibling rail just stays empty */})
    return () => { cancelled = true }
  }, [initiativeId])

  /** Progress entries scoped to this Action Item — derived from the
   *  initiative bundle's progress feed, filtered by the relation. */
  const progressForActionItem = useMemo(
    () => bundle?.progress.filter(p => p.actionItemIds?.includes(data?.actionItem.id ?? '')) ?? [],
    [bundle, data?.actionItem.id],
  )

  // Local copy of the Action Item — lets Mark Complete update the chips
  // immediately without re-fetching.
  const [localActionItem, setLocalActionItem] = useState<Milestone | null>(null)
  useEffect(() => { setLocalActionItem(data?.actionItem ?? null) }, [data])

  const ai = localActionItem ?? data?.actionItem ?? null
  const initiativeName = bundle?.initiative.name ?? ai?.initiativeName ?? null
  const suggestedBy = useMemo(() => {
    if (!ai?.suggestedById || !bundle) return null
    return bundle.milestones.find(m => m.id === ai.suggestedById) ?? null
  }, [ai?.suggestedById, bundle])

  return (
    <StrategyShell>
      <Link
        to={initiativeId ? `/strategy/initiatives/${initiativeId}` : '/strategy/initiatives'}
        className="inline-flex items-center gap-1 text-xs text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-accent)] mb-3 transition-colors"
      >
        <ArrowLeft size={12} />
        {initiativeName ?? 'Back to initiative'}
      </Link>

      {loading && !data && <StrategyLoadingCard label="Loading Action Item…" />}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load: {error}
        </div>
      )}
      {!loading && !data && !error && (
        <StrategyEmptyCard>Action Item not found.</StrategyEmptyCard>
      )}

      {data && ai && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">
          <SiblingRail
            siblings={bundle?.milestones ?? []}
            currentId={ai.id}
          />

          <article className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-7">
            <MetadataBar
              item={ai}
              onUpdated={setLocalActionItem}
              suggestedBy={suggestedBy}
              editMode={editMode}
              onToggleEditMode={() => setEditMode(e => !e)}
              archiving={archiving}
              onArchive={handleArchive}
            />
            <h1 className="text-[28px] font-semibold tracking-[-0.022em] text-[var(--color-lib-text)] leading-tight mb-4">
              <EditableText
                value={ai.name}
                onSave={async next => {
                  const updated = await updateMilestone(ai.id, { name: next ?? ai.name })
                  setLocalActionItem(updated)
                }}
                allowEmpty={false}
                emptyLabel="Untitled Action Item"
              />
            </h1>

            {archiveError && (
              <p className="text-xs text-red-600 mb-3">
                Couldn't archive: {archiveError}
              </p>
            )}

            <div className="mb-5 text-sm text-[var(--color-lib-text-muted)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-lib-text-subtle)] mb-1 font-semibold">
                Notes
              </p>
              <EditableText
                value={ai.notes}
                onSave={async next => {
                  const updated = await updateMilestone(ai.id, { notes: next })
                  setLocalActionItem(updated)
                }}
                multiline
                emptyLabel="Quick context, sub-steps, or requirements…"
              />
            </div>

            {blocks.length === 0 && !editMode ? (
              <p className="text-sm text-[var(--color-lib-text-subtle)] italic mb-6">
                No long-form content yet. Click <em>Edit body</em> above to add research, decisions, or detailed write-ups inline — same editor as the Library.
              </p>
            ) : (
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

            <ActionItemProgress
              actionItemId={ai.id}
              initiativeId={initiativeId ?? null}
              initiativeName={bundle?.initiative.name ?? null}
              initiativeDepartment={bundle?.initiative.department ?? null}
              entries={progressForActionItem}
              onChanged={reloadBundle}
            />

            <FooterActions
              item={ai}
              onCompleted={next => {
                setLocalActionItem(next)
                // Re-pull sibling list so it reflects the new status.
                refetch()
                reloadBundle()
              }}
              onSuggested={reloadBundle}
            />
          </article>
        </div>
      )}
    </StrategyShell>
  )
}

// ── Sibling rail (Action Items in this Initiative) ─────────────────────────

function SiblingRail({ siblings, currentId }: {
  siblings: Milestone[]
  currentId: string
}) {
  // Split: active vs proposed vs done. Active expanded by default; others
  // collapsed.
  const active = siblings.filter(m =>
    m.status !== 'complete' && m.status !== 'skipped' && m.status !== 'proposed',
  ).slice().sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
  const proposed = siblings.filter(m => m.status === 'proposed')
  const done = siblings.filter(m => m.status === 'complete' || m.status === 'skipped')

  return (
    <aside className="sticky top-20 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-subtle)] mb-2 px-1 pb-2 border-b border-[var(--color-lib-border)]">
        Action Items
      </p>
      <RailGroup label="Active" items={active} currentId={currentId} defaultOpen />
      {proposed.length > 0 && (
        <RailGroup label="Proposed" items={proposed} currentId={currentId} defaultOpen={proposed.some(m => m.id === currentId)} />
      )}
      {done.length > 0 && (
        <RailGroup label="Done" items={done} currentId={currentId} defaultOpen={done.some(m => m.id === currentId)} />
      )}
    </aside>
  )
}

function RailGroup({ label, items, currentId, defaultOpen }: {
  label: string
  items: Milestone[]
  currentId: string
  defaultOpen: boolean
}) {
  if (items.length === 0) return null
  return (
    <details open={defaultOpen} className="group mt-1">
      <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-sm text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-subtle)] hover:bg-[var(--color-lib-bg)] list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown size={11} className="transition-transform group-open:rotate-0 -rotate-90" />
        <span className="flex-1">{label}</span>
        <span className="text-[10px]">{items.length}</span>
      </summary>
      <div className="ml-3 flex flex-col gap-0.5 border-l border-[var(--color-lib-border)] pl-1">
        {items.map(m => (
          <Link
            key={m.id}
            to={`/strategy/action-items/${m.id}`}
            className={`flex items-center gap-2 px-2 py-1 rounded-sm text-sm ${
              m.id === currentId
                ? 'bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] font-medium'
                : 'text-[var(--color-lib-text-muted)] hover:bg-[var(--color-lib-bg)] hover:text-[var(--color-lib-text)]'
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor(m.status)}`} />
            <span className="truncate">{m.name}</span>
          </Link>
        ))}
      </div>
    </details>
  )
}

function statusDotColor(s: MilestoneStatus): string {
  switch (s) {
    case 'complete':    return 'bg-[var(--color-status-launched)]'
    case 'in-progress': return 'bg-[var(--color-status-inprogress)]'
    case 'blocked':     return 'bg-[var(--color-status-blocked)]'
    case 'proposed':    return 'bg-[var(--color-status-proposed)]'
    case 'skipped':     return 'bg-[var(--color-lib-text-subtle)]'
    default:            return 'bg-[var(--color-lib-border-strong)]'
  }
}

// ── Metadata bar ──────────────────────────────────────────────────────────
//
// Status, Owner, and Target are click-to-edit. Completion Date is read-only
// (set automatically when status flips to Complete via Mark Complete). The
// Suggested By chain is read-only — set at creation time, lives forever.

const STATUS_OPTIONS: ReadonlyArray<{ value: MilestoneStatus; label: string }> = [
  { value: 'proposed',    label: 'Proposed' },
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'complete',    label: 'Complete' },
  { value: 'skipped',     label: 'Skipped' },
]

function MetadataBar({
  item, onUpdated, suggestedBy, editMode, onToggleEditMode, archiving, onArchive,
}: {
  item: Milestone
  onUpdated: (next: Milestone) => void
  suggestedBy: Milestone | null
  editMode: boolean
  onToggleEditMode: () => void
  archiving: boolean
  onArchive: () => void
}) {
  const save = async (updates: Parameters<typeof updateMilestone>[1]) => {
    const next = await updateMilestone(item.id, updates)
    onUpdated(next)
  }
  return (
    <div className="flex items-center gap-x-4 gap-y-2 mb-4 pb-3 border-b border-[var(--color-lib-border)] flex-wrap text-xs text-[var(--color-lib-text-muted)]">
      <span className="inline-flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor(item.status)}`} />
        <EditableSelect<MilestoneStatus>
          value={item.status}
          options={STATUS_OPTIONS}
          onSave={next => save({ status: next ?? 'not-started' })}
          allowClear={false}
        >
          <span>{labelStatus(item.status)}</span>
        </EditableSelect>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[var(--color-lib-text-subtle)]">Owner:</span>
        <EditablePerson
          value={item.owner}
          onSave={next => save({ ownerId: next })}
        />
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[var(--color-lib-text-subtle)]">Initiatives:</span>
        <InitiativeMultiPicker
          value={item.initiativeIds}
          fallbackName={item.initiativeName}
          onSave={next => save({ initiativeIds: next })}
        />
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[var(--color-lib-text-subtle)]">Target:</span>
        <EditableDate
          value={item.targetDate}
          onSave={next => save({ targetDate: next })}
          placeholder="Set date"
        />
      </span>
      {item.completionDate && (
        <span className="inline-flex items-center gap-1">
          <Check size={11} className="text-[var(--color-status-launched)]" />
          Completed {formatDate(item.completionDate)}
        </span>
      )}
      {suggestedBy && (
        <span className="inline-flex items-center gap-1 text-[var(--color-lib-accent)]">
          <Lightbulb size={11} />
          Suggested by:{' '}
          <Link to={`/strategy/action-items/${suggestedBy.id}`} className="underline">
            {suggestedBy.name}
          </Link>
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleEditMode}
          title={editMode ? 'Exit edit mode' : 'Edit body inline'}
          className={[
            'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm border',
            editMode
              ? 'bg-[var(--color-lib-accent)] text-white border-[var(--color-lib-accent)]'
              : 'border-[var(--color-lib-border)] text-[var(--color-lib-text-muted)] hover:border-[var(--color-lib-border-strong)]',
          ].join(' ')}
        >
          <Pencil size={11} />
          {editMode ? 'Done' : 'Edit body'}
        </button>
        <a
          href={item.notionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm border border-[var(--color-lib-border)] text-[var(--color-lib-text-muted)] hover:border-[var(--color-lib-border-strong)] hover:text-[var(--color-lib-text)]"
          title="Open in Notion"
        >
          <ExternalLink size={11} />
          Notion
        </a>
        <button
          type="button"
          onClick={onArchive}
          disabled={archiving}
          title="Archive Action Item"
          className="text-[var(--color-lib-text-subtle)] hover:text-red-500 disabled:opacity-50 p-1"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Local immutable helpers for editing the block tree ───────────────────

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

function labelStatus(s: MilestoneStatus): string {
  return {
    proposed: 'Proposed',
    'not-started': 'Not started',
    'in-progress': 'In progress',
    blocked: 'Blocked',
    complete: 'Complete',
    skipped: 'Skipped',
  }[s]
}

// ── Footer actions: Mark complete + Suggest next ─────────────────────────

function FooterActions({ item, onCompleted, onSuggested }: {
  item: Milestone
  onCompleted: (next: Milestone) => void
  onSuggested: () => void
}) {
  const completeMutate = useStrategyMutate(markActionItemComplete)
  const [suggesting, setSuggesting] = useState(false)

  const handleComplete = async () => {
    try {
      const next = await completeMutate.run(item.id)
      onCompleted(next)
    } catch {/* error already on the hook */}
  }

  return (
    <div className="mt-8 pt-5 border-t border-[var(--color-lib-border)] space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {item.status !== 'complete' && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={completeMutate.pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-status-launched)] text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
          >
            <Check size={13} />
            {completeMutate.pending ? 'Marking…' : 'Mark complete'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSuggesting(s => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] text-sm font-medium text-[var(--color-lib-text)] px-3 py-2 hover:border-[var(--color-lib-border-strong)]"
        >
          <Lightbulb size={13} />
          {suggesting ? 'Cancel suggestion' : 'Suggest next Action Item'}
        </button>
        {completeMutate.error && (
          <span className="text-xs text-red-600">{completeMutate.error}</span>
        )}
      </div>
      {suggesting && (
        <SuggestNextForm
          parentId={item.id}
          onCancel={() => setSuggesting(false)}
          onSuggested={() => { setSuggesting(false); onSuggested() }}
        />
      )}
    </div>
  )
}

function SuggestNextForm({ parentId, onCancel, onSuggested }: {
  parentId: string
  onCancel: () => void
  onSuggested: () => void
}) {
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [notes, setNotes] = useState('')
  const mutate = useStrategyMutate(suggestActionItem)

  const submit = async () => {
    if (!title.trim()) return
    try {
      await mutate.run({
        suggestedById: parentId,
        title: title.trim(),
        targetDate: targetDate || null,
        notes: notes.trim() || null,
      })
      onSuggested()
    } catch {/* error already on the hook */}
  }

  return (
    <div className="rounded-md border border-[var(--color-lib-accent)]/40 bg-[var(--color-lib-accent-soft)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-accent)]">
          Suggest the next Action Item
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        autoFocus
        placeholder="Title — what's the next step?"
        className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-lib-accent)]"
      />
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
        <input
          type="date"
          value={targetDate}
          onChange={e => setTargetDate(e.target.value)}
          className="rounded-md border border-[var(--color-lib-border)] bg-white px-2 py-2 text-sm"
        />
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional one-line note for the Initiative owner"
          className="rounded-md border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-lib-accent)]"
        />
      </div>
      {mutate.error && <p className="text-xs text-red-600">{mutate.error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={mutate.pending}
          className="rounded-md border border-[var(--color-lib-border)] bg-white text-sm text-[var(--color-lib-text)] px-3 py-1.5 hover:bg-[var(--color-lib-bg)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={mutate.pending || !title.trim()}
          className="rounded-md bg-[var(--color-lib-accent)] text-white text-sm font-medium px-3 py-1.5 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
        >
          {mutate.pending ? 'Sending…' : 'Send to Initiative owner'}
        </button>
      </div>
    </div>
  )
}


// ── Progress section (scoped to this Action Item) ──────────────────────
//
// Lists progress entries linked to this Action Item via the Notion
// `Action Items` relation, plus an inline form to post a new update
// pre-tagged to the current Action Item.
//
// Display strategy: we merge the bundle's filtered entries (matching
// via the Action Items relation) with a session-local list of entries
// just posted from this page. The local list is what fixes the
// "entry disappeared after posting" symptom — when a workspace doesn't
// have the `Action Items` relation property on the Progress DB, the
// server falls back to creating without it (so the entry exists and
// is linked to the Initiative, but doesn't pass the action-item
// filter on reload). Tracking the locally-posted ones means the user
// always sees their post immediately, regardless of whether the
// Notion side persisted the linkage.

function ActionItemProgress({
  actionItemId, initiativeId, initiativeName, initiativeDepartment,
  entries, onChanged,
}: {
  actionItemId: string
  initiativeId: string | null
  initiativeName: string | null
  initiativeDepartment: import('../../types/strategy').Department | null
  entries: ProgressEntry[]
  onChanged: () => void
}) {
  const [posting, setPosting] = useState(false)
  const [justPosted, setJustPosted] = useState<ProgressEntry[]>([])

  // Reset session-local posts when the underlying action item changes
  // (Prev/Next nav across siblings). Each action item gets its own
  // "just posted" list.
  useEffect(() => { setJustPosted([]) }, [actionItemId])

  // Merge: locally-posted entries first (newest at top), then bundle
  // entries that already match via the Action Items relation. Dedupe
  // on id so an entry that lands in both lists after a bundle reload
  // doesn't double-render.
  const merged = useMemo(() => {
    const seen = new Set<string>()
    const out: ProgressEntry[] = []
    for (const e of justPosted) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push(e) }
    }
    for (const e of entries) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push(e) }
    }
    return out
  }, [justPosted, entries])

  return (
    <div className="mt-7 pt-5 border-t border-[var(--color-lib-border)]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">
          Progress on this Action Item ({merged.length})
        </p>
        {initiativeId && !posting && (
          <button
            type="button"
            onClick={() => setPosting(true)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-lib-border)] bg-white text-xs font-medium text-[var(--color-lib-text)] px-2.5 py-1 hover:border-[var(--color-lib-border-strong)]"
          >
            <Plus size={11} />
            Post update
          </button>
        )}
      </div>

      {posting && initiativeId && (
        <div className="mb-3">
          <PostProgressForm
            initiativeId={initiativeId}
            initiativeName={initiativeName ?? undefined}
            initiativeDepartment={initiativeDepartment}
            presetActionItemId={actionItemId}
            onPosted={entry => {
              // Stamp the action-item id on the local copy even if the
              // server couldn't persist the relation (Progress DB
              // missing the property). This way the entry still shows
              // on this page and a subsequent navigation back keeps
              // the linkage in our session view.
              const stamped: ProgressEntry = {
                ...entry,
                actionItemIds: entry.actionItemIds && entry.actionItemIds.includes(actionItemId)
                  ? entry.actionItemIds
                  : [...(entry.actionItemIds ?? []), actionItemId],
              }
              setJustPosted(prev => [stamped, ...prev])
              setPosting(false)
              onChanged()
            }}
            onCancel={() => setPosting(false)}
          />
        </div>
      )}

      {merged.length === 0 ? (
        <p className="text-sm text-[var(--color-lib-text-subtle)] italic">
          No progress entries linked to this Action Item yet. Post one above to start a thread.
        </p>
      ) : (
        <div className="space-y-2">
          {merged.map(e => (
            <ProgressEntryItem
              key={e.id}
              entry={{ ...e, kind: 'progress-entry' }}
              showInitiative={false}
              onUpdated={next => {
                // Keep the local list in sync if the user edits a
                // just-posted entry before the bundle catches up.
                setJustPosted(prev => prev.map(p => p.id === next.id ? next : p))
                onChanged()
              }}
              onArchived={id => {
                setJustPosted(prev => prev.filter(p => p.id !== id))
                onChanged()
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Multi-initiative picker ────────────────────────────────────────────────
//
// Click-to-edit chip that lists every initiative this Action Item belongs
// to and opens a popover with checkbox-style multi-select. The
// initiative roster is fetched lazily on first open so the page doesn't
// pay for a list query when the picker is never used. Save fires once
// when the popover dismisses (click-outside) — toggling several
// initiatives in a row only sends one network request.

function InitiativeMultiPicker({ value, fallbackName, onSave }: {
  value: string[]
  /** Name to render when only one initiative is linked and we haven't
   *  loaded the full roster yet. Pulled from `item.initiativeName`
   *  (which the parser sets to the *primary* initiative's name). */
  fallbackName: string | null
  onSave: (next: string[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(value)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<Initiative[] | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [search, setSearch] = useState('')
  const ref = usePopoverDismiss<HTMLDivElement>(open, () => { void commit() })

  // Lazy-load the initiative list when the popover first opens.
  useEffect(() => {
    if (!open || options !== null || loadingOptions) return
    setLoadingOptions(true)
    listInitiatives()
      .then(setOptions)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingOptions(false))
  }, [open, options, loadingOptions])

  const optsById = useMemo(() => {
    const m = new Map<string, Initiative>()
    for (const o of options ?? []) m.set(o.id, o)
    return m
  }, [options])

  const filteredOptions = useMemo(() => {
    if (!options) return []
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.name.toLowerCase().includes(q))
  }, [options, search])

  const toggle = (id: string) =>
    setDraft(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const commit = async () => {
    if (sameSet(draft, value)) { setOpen(false); return }
    setPending(true)
    setError(null)
    try {
      await onSave(draft)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const display = (() => {
    if (value.length === 0) {
      return <span className="text-purple-gray/60 italic">Add initiative…</span>
    }
    if (value.length === 1) {
      const name = optsById.get(value[0])?.name ?? fallbackName ?? '(unknown)'
      return <span>{name}</span>
    }
    // 2+ — show first name + "+N more"
    const first = optsById.get(value[0])?.name ?? fallbackName ?? value[0]
    return (
      <span className="inline-flex items-center gap-1">
        <Layers size={10} className="text-[var(--color-lib-accent)]" />
        {first}
        <span className="text-[var(--color-lib-text-subtle)]">+{value.length - 1} more</span>
      </span>
    )
  })()

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => { setDraft(value); setOpen(true) }}
        disabled={pending}
        className={`rounded hover:bg-lavender-tint/40 transition-colors px-1 -mx-1 ${pending ? 'opacity-60' : ''}`}
      >
        {display}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[280px] rounded-lg border border-lavender bg-white shadow-lg p-1.5">
          <div className="relative mb-1">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-lib-text-subtle)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              placeholder="Search initiatives…"
              className="w-full pl-6 pr-2 py-1 text-xs rounded border border-[var(--color-lib-border)] outline-none focus:border-[var(--color-lib-accent)]"
            />
          </div>
          {loadingOptions && (
            <p className="px-3 py-2 text-[11px] italic text-[var(--color-lib-text-subtle)]">Loading…</p>
          )}
          {!loadingOptions && options && filteredOptions.length === 0 && (
            <p className="px-3 py-2 text-[11px] italic text-[var(--color-lib-text-subtle)]">No matches</p>
          )}
          <div className="max-h-64 overflow-y-auto">
            {filteredOptions.map(o => {
              const checked = draft.includes(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-deep-plum hover:bg-lavender-tint text-left rounded"
                >
                  <span className="truncate">{o.name}</span>
                  {checked && <Check size={11} className="text-primary-purple shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {error && <p className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap">{error}</p>}
    </div>
  )
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const v of b) if (!sa.has(v)) return false
  return true
}

// Re-export so the route file doesn't need to re-import — minor convenience.
export { ChevronRight }
