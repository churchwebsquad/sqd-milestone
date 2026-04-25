import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ChevronDown, ExternalLink, FileText, Pencil, Plus, Send,
  Target, Activity, CheckCircle2, Trash2, MoreHorizontal,
} from 'lucide-react'
import {
  appendDocBlock, archiveDocBlock, archivePage, getInitiativeDetail,
  promoteActionItem, updateDocBlock, updateInitiative,
} from '../../lib/strategyNotion'
import type { EditableBlockType } from '../../lib/strategyNotion'
import { useAuth } from '../../contexts/AuthContext'
import { isVPByEmail } from '../../lib/library'
import { useStrategyFetch } from '../../hooks/useStrategyFetch'
import { detailFeed } from '../../lib/strategyFeed'
import type {
  Department, DateConfidence, DocBlock, Initiative, InitiativeDetailBundle,
  InitiativeStatus, InitiativeWritable, Milestone, Priority, ProgressEntry,
  ProgressFeedEntry,
} from '../../types/strategy'
import { MilestoneItem } from '../../components/strategy/MilestoneItem'
import { ProgressEntryItem } from '../../components/strategy/ProgressEntryItem'
import { DocBlocks } from '../../components/library/DocBlockRender'
import { CheckInPanel } from '../../components/strategy/CheckInPanel'
import { StrategyShell } from '../../components/strategy/StrategyShell'
import {
  StrategyNotionSetupBanner,
  StrategyLoadingCard,
  StrategyEmptyCard,
  DepartmentBadge,
  StatusDot,
  PriorityMark,
} from '../../components/strategy/StrategyUI'
import { EditableText } from '../../components/strategy/editors/EditableText'
import { EditableSelect } from '../../components/strategy/editors/EditableSelect'
import { EditableMultiSelect } from '../../components/strategy/editors/EditableMultiSelect'
import { EditableDate } from '../../components/strategy/editors/EditableDate'
import { EditablePerson } from '../../components/strategy/editors/EditablePerson'
import { PostProgressForm } from '../../components/strategy/editors/PostProgressForm'
import { AddMilestoneRow } from '../../components/strategy/editors/AddMilestoneRow'
import { usePopoverDismiss } from '../../components/strategy/editors/usePopover'

const DEPT_OPTIONS = [
  { value: 'all-in',   label: 'All In' },
  { value: 'social',   label: 'Social' },
  { value: 'branding', label: 'Branding' },
  { value: 'web',      label: 'Web' },
] as const

const STATUS_OPTIONS = [
  { value: 'proposed',     label: 'Proposed' },
  { value: 'scoping',      label: 'Scoping' },
  { value: 'in-progress',  label: 'In progress' },
  { value: 'testing',      label: 'Testing' },
  { value: 'blocked',      label: 'Blocked' },
  { value: 'in-review',    label: 'In review' },
  { value: 'launched',     label: 'Launched' },
  { value: 'paused',       label: 'Paused' },
  { value: 'archived',     label: 'Archived' },
] as const

const PRIORITY_OPTIONS = [
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
] as const

const QUARTER_OPTIONS = [
  { value: 'Q1 2026', label: 'Q1 2026' },
  { value: 'Q2 2026', label: 'Q2 2026' },
  { value: 'Q3 2026', label: 'Q3 2026' },
  { value: 'Q4 2026', label: 'Q4 2026' },
  { value: 'Q1 2027', label: 'Q1 2027' },
  { value: 'Q2 2027', label: 'Q2 2027' },
  { value: 'Q3 2027', label: 'Q3 2027' },
  { value: 'Q4 2027', label: 'Q4 2027' },
  { value: 'Ongoing', label: 'Ongoing' },
] as const

const DATE_CONF_OPTIONS = [
  { value: 'hard-deadline', label: 'Hard deadline' },
  { value: 'soft-target',   label: 'Soft target' },
  { value: 'exploratory',   label: 'Exploratory' },
  { value: 'tbd',           label: 'TBD' },
] as const

const CADENCE_OPTIONS = [
  { value: 'Weekly',   label: 'Weekly' },
  { value: 'Biweekly', label: 'Biweekly' },
  { value: 'Monthly',  label: 'Monthly' },
  { value: 'Ad-hoc',   label: 'Ad-hoc' },
] as const

const TYPE_OPTIONS = [
  { value: 'New Product / Offering',     label: 'New Product / Offering' },
  { value: 'Internal Tool',              label: 'Internal Tool' },
  { value: 'Process Improvement',        label: 'Process Improvement' },
  { value: 'Brand Initiative',           label: 'Brand Initiative' },
  { value: 'Campaign',                   label: 'Campaign' },
  { value: 'Partnership',                label: 'Partnership' },
  { value: 'AI / Skill Build',           label: 'AI / Skill Build' },
  { value: 'Infrastructure / Platform',  label: 'Infrastructure / Platform' },
  { value: 'Other',                      label: 'Other' },
] as const

export default function InitiativeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, loading, setupError, error } = useStrategyFetch<InitiativeDetailBundle>(
    () => getInitiativeDetail(id!),
    [id],
  )

  // Local mutable copy of the bundle. Initialized from the fetch and kept
  // in sync with mutations so edits feel instant. The fetch result is the
  // source of truth on first load and on `id` change.
  const [bundle, setBundle] = useState<InitiativeDetailBundle | null>(null)
  useEffect(() => { setBundle(data) }, [data])

  const feed = useMemo(() => (bundle ? detailFeed(bundle) : []), [bundle])

  const [posting, setPosting] = useState(false)

  // Local copy of the initiative body blocks. Mirrors the bundle on
  // load so optimistic per-block edits update without re-fetching.
  // Reset whenever the underlying initiative id changes (Prev/Next
  // nav), even though that's not currently a path on this page —
  // matches the same pattern the Action Item detail uses.
  const [blocks, setBlocks] = useState<DocBlock[]>([])
  useEffect(() => { setBlocks(bundle?.blocks ?? []) }, [bundle?.blocks, bundle?.initiative.id])
  const [bodyEditMode, setBodyEditMode] = useState(false)
  const [appendOpen, setAppendOpen] = useState(false)
  const [appendType, setAppendType] = useState<EditableBlockType>('paragraph')
  const [appendText, setAppendText] = useState('')
  const [appending, setAppending] = useState(false)

  // ── Mutation handlers (all update local state then return) ──────────────
  const onInitiativeUpdated = (next: Initiative) =>
    setBundle(b => b ? { ...b, initiative: { ...b.initiative, ...next } } : b)

  const saveInitiative = async (updates: InitiativeWritable) => {
    if (!bundle) return
    const next = await updateInitiative(bundle.initiative.id, updates)
    onInitiativeUpdated(next)
  }

  const onMilestoneUpdated = (next: Milestone) =>
    setBundle(b => b ? { ...b, milestones: b.milestones.map(m => m.id === next.id ? next : m) } : b)

  const onMilestoneArchived = (msId: string) =>
    setBundle(b => b ? { ...b, milestones: b.milestones.filter(m => m.id !== msId) } : b)

  const onMilestoneCreated = (m: Milestone) =>
    setBundle(b => b ? { ...b, milestones: [...b.milestones, m] } : b)

  const onProgressPosted = (entry: ProgressEntry) => {
    setBundle(b => b ? { ...b, progress: [entry, ...b.progress] } : b)
    setPosting(false)
  }

  const onProgressUpdated = (next: ProgressEntry) =>
    setBundle(b => b ? { ...b, progress: b.progress.map(p => p.id === next.id ? next : p) } : b)

  const onProgressArchived = (entryId: string) =>
    setBundle(b => b ? { ...b, progress: b.progress.filter(p => p.id !== entryId) } : b)

  // Body edit handlers — mirror the Doc Manager / Action Item detail
  // patterns. Director treatment isn't relevant on initiative pages
  // (no verification status to flip), so we pass `isDirector=true` to
  // updateDocBlock to skip the doc-only verification reset path.
  const handleEditBlock = async (blockId: string, type: EditableBlockType, text: string) => {
    if (!bundle) return
    const before = findBlock(blocks, blockId)
    setBlocks(prev => mutateTree(prev, blockId, b => ({ ...b, text })))
    try {
      await updateDocBlock(bundle.initiative.id, blockId, type, text, undefined, true)
    } catch (err) {
      if (before) setBlocks(prev => mutateTree(prev, blockId, () => before))
      throw err
    }
  }
  const handleArchiveBlock = async (blockId: string) => {
    if (!bundle) return
    const before = blocks
    setBlocks(prev => removeBlock(prev, blockId))
    try {
      await archiveDocBlock(bundle.initiative.id, blockId)
    } catch (err) {
      setBlocks(before)
      throw err
    }
  }
  const handleAppendBlock = async () => {
    if (!bundle || !appendText.trim()) return
    setAppending(true)
    try {
      await appendDocBlock(bundle.initiative.id, appendType, appendText)
      // Re-pull the bundle so the new block has its Notion id and is
      // editable. Cheap — same fetch the page used on initial load.
      const fresh = await getInitiativeDetail(bundle.initiative.id)
      setBundle(fresh)
      setAppendText('')
      setAppendOpen(false)
    } finally {
      setAppending(false)
    }
  }

  const handleArchiveInitiative = async () => {
    if (!bundle) return
    if (!confirm(`Archive initiative "${bundle.initiative.name}"? This hides it from all lists.`)) return
    await archivePage(bundle.initiative.id, 'initiative')
    navigate('/strategy/initiatives', { replace: true })
  }

  const nextMilestoneOrder = bundle
    ? Math.max(0, ...bundle.milestones.map(m => m.order ?? 0)) + 1
    : 1

  return (
    <StrategyShell>
      <Link
        to="/strategy/initiatives"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-accent)] mb-3 transition-colors"
      >
        <ArrowLeft size={12} />
        All initiatives
      </Link>

      {setupError && <StrategyNotionSetupBanner error={setupError} />}
      {error && !setupError && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load initiative: {error}
        </div>
      )}
      {loading && !bundle && <StrategyLoadingCard label="Loading initiative…" />}

      {bundle && (
        <>
          <header className="mb-6 pb-5 border-b border-[var(--color-lib-border)]">
            <div className="flex items-start justify-between gap-4 mb-3">
              <h1 className="text-[28px] font-semibold tracking-[-0.022em] text-[var(--color-lib-text)] leading-tight flex-1">
                <EditableText
                  value={bundle.initiative.name}
                  onSave={next => saveInitiative({ name: next ?? bundle.initiative.name })}
                  allowEmpty={false}
                  emptyLabel="Untitled"
                />
              </h1>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={bundle.initiative.notionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-accent)] transition-colors"
                >
                  Open in Notion
                  <ExternalLink size={11} />
                </a>
                <ArchiveMenu onArchive={handleArchiveInitiative} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <EditableSelect<Department>
                value={bundle.initiative.department}
                options={DEPT_OPTIONS}
                onSave={next => saveInitiative({ department: next })}
              >
                <DepartmentBadge department={bundle.initiative.department} />
              </EditableSelect>
              <EditableSelect<InitiativeStatus>
                value={bundle.initiative.status}
                options={STATUS_OPTIONS}
                onSave={next => saveInitiative({ status: next })}
              >
                <StatusDot status={bundle.initiative.status} />
              </EditableSelect>
              <EditableSelect<Priority>
                value={bundle.initiative.priority}
                options={PRIORITY_OPTIONS}
                onSave={next => saveInitiative({ priority: next })}
              >
                <PriorityMark priority={bundle.initiative.priority} />
              </EditableSelect>
              <span className="text-xs text-[var(--color-lib-text-muted)] inline-flex items-center gap-1">
                · Quarter:
                <EditableSelect<string>
                  value={bundle.initiative.targetQuarter}
                  options={QUARTER_OPTIONS}
                  onSave={next => saveInitiative({ targetQuarter: next })}
                  placeholder="Set quarter"
                />
              </span>
              <span className="text-xs text-[var(--color-lib-text-muted)] inline-flex items-center gap-1">
                · Date:
                <EditableDate
                  value={bundle.initiative.targetDate}
                  onSave={next => saveInitiative({ targetDate: next })}
                />
              </span>
              <span className="text-xs text-[var(--color-lib-text-muted)] inline-flex items-center gap-1">
                ·
                <EditableSelect<DateConfidence>
                  value={bundle.initiative.dateConfidence}
                  options={DATE_CONF_OPTIONS}
                  onSave={next => saveInitiative({ dateConfidence: next })}
                  placeholder="Set confidence"
                />
              </span>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
            <div className="space-y-6">
              <Section icon={Target} title="Summary">
                <div className="text-sm text-[var(--color-lib-text)] leading-relaxed">
                  <EditableText
                    value={bundle.initiative.summary}
                    onSave={next => saveInitiative({ summary: next })}
                    multiline
                    emptyLabel="Add a 1–3 sentence summary…"
                  />
                </div>
              </Section>

              <Section icon={Target} title="Goal">
                <div className="text-sm text-[var(--color-lib-text)] leading-relaxed whitespace-pre-line">
                  <EditableText
                    value={bundle.initiative.goal}
                    onSave={next => saveInitiative({ goal: next })}
                    multiline
                    emptyLabel="What does success look like?"
                  />
                </div>
              </Section>

              {/* Additional Info — Notion page body for the initiative.
                  Editable via the same DocBlocks editor the library and
                  action item pages use. The "Edit body" toggle reveals
                  per-block pencil/trash + an Add-block prompter at the
                  bottom; otherwise the body reads as a static doc. */}
              <Section
                icon={FileText}
                title="Additional Info"
                action={
                  <button
                    type="button"
                    onClick={() => setBodyEditMode(e => !e)}
                    className={[
                      'inline-flex items-center gap-1 rounded-full text-[11px] font-semibold px-3 py-1',
                      bodyEditMode
                        ? 'bg-primary-purple text-white'
                        : 'border border-[var(--color-lib-border)] text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]',
                    ].join(' ')}
                  >
                    <Pencil size={10} />
                    {bodyEditMode ? 'Done' : 'Edit body'}
                  </button>
                }
              >
                {blocks.length === 0 && !bodyEditMode ? (
                  <p className="text-sm text-[var(--color-lib-text-subtle)] italic">
                    No additional info yet. Click <em>Edit body</em> to add research, decisions, or context inline.
                  </p>
                ) : (
                  <DocBlocks
                    blocks={blocks}
                    editable={bodyEditMode}
                    onEdit={handleEditBlock}
                    onArchive={handleArchiveBlock}
                  />
                )}
                {bodyEditMode && (
                  <div className="mt-4 pt-4 border-t border-dashed border-[var(--color-lib-border)]">
                    {!appendOpen ? (
                      <button
                        type="button"
                        onClick={() => setAppendOpen(true)}
                        className="inline-flex items-center gap-1.5 text-sm text-primary-purple hover:text-deep-plum font-medium"
                      >
                        <Plus size={14} />
                        Add a block
                      </button>
                    ) : (
                      <div className="rounded-md border border-primary-purple bg-[var(--color-lib-accent-soft)] p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] uppercase tracking-widest font-semibold text-primary-purple">
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
                          className="w-full rounded-sm border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-primary-purple"
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
                            className="rounded-sm bg-primary-purple text-white text-xs font-medium px-2.5 py-1 hover:bg-deep-plum disabled:opacity-50"
                          >
                            {appending ? 'Adding…' : 'Add block'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              <Section icon={CheckCircle2} title="Action Items">
                <div>
                  {bundle.milestones
                    .slice()
                    .filter(m => m.status !== 'proposed')
                    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
                    .map(m => (
                      <MilestoneItem
                        key={m.id}
                        milestone={m}
                        onUpdated={onMilestoneUpdated}
                        onArchived={onMilestoneArchived}
                      />
                    ))}
                  <AddMilestoneRow
                    initiativeId={bundle.initiative.id}
                    nextOrder={nextMilestoneOrder}
                    onCreated={onMilestoneCreated}
                  />
                </div>
              </Section>

              <ProposedSection
                bundle={bundle}
                onPromoted={onMilestoneUpdated}
                onArchived={onMilestoneArchived}
              />
            </div>

            <aside className="space-y-4">
              <CheckInPanel initiative={bundle.initiative} onUpdated={onInitiativeUpdated} />

              <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-4 space-y-3 text-xs">
                <div>
                  <p className="text-[var(--color-lib-text-subtle)] uppercase tracking-widest text-[10px] font-semibold mb-1">Owner</p>
                  <div className="text-[var(--color-lib-text)]">
                    <EditablePerson
                      value={bundle.initiative.owner}
                      onSave={next => saveInitiative({ ownerId: next })}
                    />
                  </div>
                </div>

                <div>
                  <p className="text-[var(--color-lib-text-subtle)] uppercase tracking-widest text-[10px] font-semibold mb-1">Cadence</p>
                  <div className="text-[var(--color-lib-text)]">
                    <EditableSelect<string>
                      value={bundle.initiative.checkInCadence}
                      options={CADENCE_OPTIONS}
                      onSave={next => saveInitiative({ checkInCadence: next })}
                      placeholder="Set cadence"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-[var(--color-lib-text-subtle)] uppercase tracking-widest text-[10px] font-semibold mb-1">Touchpoints</p>
                  <div className="text-[var(--color-lib-text)]">
                    <EditableText
                      value={bundle.initiative.touchpoints}
                      onSave={next => saveInitiative({ touchpoints: next })}
                      multiline
                      emptyLabel="Who to loop in?"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-[var(--color-lib-text-subtle)] uppercase tracking-widest text-[10px] font-semibold mb-1">Type</p>
                  <div className="text-[var(--color-lib-text)]">
                    <EditableMultiSelect<string>
                      value={bundle.initiative.initiativeType}
                      options={TYPE_OPTIONS}
                      onSave={next => saveInitiative({ initiativeType: next })}
                    >
                      <span className="flex flex-wrap gap-1">
                        {bundle.initiative.initiativeType.map(t => (
                          <span key={t} className="text-[10px] text-[var(--color-lib-text)] bg-[var(--color-lib-accent-soft)] rounded px-1.5 py-0.5">
                            {t}
                          </span>
                        ))}
                      </span>
                    </EditableMultiSelect>
                  </div>
                </div>
              </div>

              {/* Compact Progress feed — moved out of the main column so
                  the body content + action items get the spotlight.
                  Each row shows title + author + date inline; click to
                  expand the full body. Posting opens the same form
                  used elsewhere; the entry slots into the local feed. */}
              <ProgressFeedAside
                feed={feed}
                initiativeId={bundle.initiative.id}
                posting={posting}
                onStartPost={() => setPosting(true)}
                onCancelPost={() => setPosting(false)}
                onPosted={onProgressPosted}
                onUpdated={onProgressUpdated}
                onArchived={onProgressArchived}
              />
            </aside>
          </div>
        </>
      )}

      {!loading && !bundle && !setupError && !error && (
        <StrategyEmptyCard>Initiative not found.</StrategyEmptyCard>
      )}
    </StrategyShell>
  )
}

// ── Compact Progress feed (right aside) ─────────────────────────────────
//
// One row per progress entry: title + author + date. Click a row to
// expand the full ProgressEntryItem (with body, edit/archive
// affordances). Milestone-complete events render as a single line
// each — no expansion since they have no body. Posting opens the
// form inline above the feed.

function ProgressFeedAside({
  feed, initiativeId, posting, onStartPost, onCancelPost,
  onPosted, onUpdated, onArchived,
}: {
  feed: ReturnType<typeof detailFeed>
  initiativeId: string
  posting: boolean
  onStartPost: () => void
  onCancelPost: () => void
  onPosted: (entry: ProgressEntry) => void
  onUpdated: (next: ProgressEntry) => void
  onArchived: (id: string) => void
}) {
  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-[var(--color-lib-accent)]" />
          <h2 className="text-[11px] font-semibold text-[var(--color-lib-text-subtle)] uppercase tracking-widest">
            Progress ({feed.length})
          </h2>
        </div>
        {!posting && (
          <button
            type="button"
            onClick={onStartPost}
            className="inline-flex items-center gap-1 rounded-full bg-primary-purple text-white text-[11px] font-semibold px-2.5 py-0.5 hover:bg-deep-plum"
          >
            <Send size={9} />
            Post
          </button>
        )}
      </div>

      {posting && (
        <div className="mb-3">
          <PostProgressForm
            initiativeId={initiativeId}
            onPosted={onPosted}
            onCancel={onCancelPost}
          />
        </div>
      )}

      {feed.length === 0 ? (
        <p className="text-xs text-[var(--color-lib-text-muted)] italic">
          No progress posted yet.
        </p>
      ) : (
        <div className="space-y-1">
          {feed.map(item =>
            item.kind === 'progress-entry'
              ? <CompactProgressRow
                  key={item.id}
                  entry={item}
                  onUpdated={onUpdated}
                  onArchived={onArchived}
                />
              : <CompactMilestoneEventRow key={item.id} event={item} />
          )}
        </div>
      )}
    </div>
  )
}

/** Single-row progress card — title + meta only. Clicking expands a
 *  panel below it that contains the full ProgressEntryItem (body,
 *  category pills, edit / archive affordances). Collapsed by default
 *  so a long feed stays browsable. */
function CompactProgressRow({ entry, onUpdated, onArchived }: {
  entry: ProgressFeedEntry
  onUpdated: (next: ProgressEntry) => void
  onArchived: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-sm border border-transparent hover:border-[var(--color-lib-border)] transition-colors">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--color-lib-bg)]/40 rounded-sm"
      >
        <ChevronDown
          size={11}
          className={[
            'shrink-0 text-[var(--color-lib-text-subtle)] transition-transform',
            open ? '' : '-rotate-90',
          ].join(' ')}
        />
        <span className="flex-1 min-w-0 text-xs font-medium text-[var(--color-lib-text)] truncate">
          {entry.title}
        </span>
        <span className="text-[10px] text-[var(--color-lib-text-subtle)] shrink-0 whitespace-nowrap">
          {entry.author?.name?.split(' ')[0] ?? ''}
          {entry.datePosted && (
            <> · {formatShort(entry.datePosted)}</>
          )}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2 -mt-1">
          <ProgressEntryItem
            entry={entry}
            showInitiative={false}
            onUpdated={onUpdated}
            onArchived={onArchived}
          />
        </div>
      )}
    </div>
  )
}

function CompactMilestoneEventRow({ event }: {
  event: Extract<ReturnType<typeof detailFeed>[number], { kind: 'milestone-event' }>
}) {
  return (
    <div className="px-2 py-1.5 flex items-center gap-2 text-xs text-[var(--color-lib-text-muted)]">
      <CheckCircle2 size={11} className="text-[var(--color-status-launched)] shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        Completed: <span className="text-[var(--color-lib-text)] font-medium">{event.milestoneName}</span>
      </span>
      {event.completedAt && (
        <span className="text-[10px] text-[var(--color-lib-text-subtle)] shrink-0">
          {formatShort(event.completedAt)}
        </span>
      )}
    </div>
  )
}

function formatShort(iso: string): string {
  const parts = iso.slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return iso
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Block-tree helpers (mirror ActionItemDetailPage) ────────────────────

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

function ArchiveMenu({ onArchive }: { onArchive: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = usePopoverDismiss<HTMLDivElement>(open, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]"
        aria-label="More"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-lavender bg-white shadow-lg py-1">
          <button
            type="button"
            onClick={() => { setOpen(false); onArchive() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left"
          >
            <Trash2 size={11} />
            Archive initiative
          </button>
        </div>
      )}
    </div>
  )
}

function Section({ icon: Icon, title, action, children }: {
  icon: typeof Target
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-[var(--color-lib-accent)]" />
          <h2 className="text-[11px] font-semibold text-[var(--color-lib-text-subtle)] uppercase tracking-widest">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

// ── Proposed (for your review) subsection ─────────────────────────────────
//
// Shown below the active Action Items list when there are Proposed items
// AND the viewer is the Initiative owner OR the VP. Each row shows the
// suggesting Action Item and offers Promote / Edit / Delete actions.

function ProposedSection({ bundle, onPromoted, onArchived }: {
  bundle: InitiativeDetailBundle
  onPromoted: (next: Milestone) => void
  onArchived: (id: string) => void
}) {
  const { staffProfile } = useAuth()
  const proposed = bundle.milestones.filter(m => m.status === 'proposed')

  // Permission: the Initiative owner (matched by email) OR the VP. If
  // staffProfile.email matches the initiative.owner.email we treat the
  // signed-in user as the owner — same identity bridge the Squad Progress
  // widget uses.
  const isVP = isVPByEmail(staffProfile?.email ?? null)
  const myEmail = (staffProfile?.email ?? '').toLowerCase().trim()
  const ownerEmail = (bundle.initiative.owner?.email ?? '').toLowerCase().trim()
  const isOwner = !!myEmail && myEmail === ownerEmail
  const canSeeProposed = isVP || isOwner

  if (proposed.length === 0 || !canSeeProposed) return null

  return (
    <section className="rounded-md border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[11px] font-semibold text-[var(--color-lib-accent)] uppercase tracking-widest">
          Proposed (for your review)
        </h2>
        <span className="text-[11px] text-[var(--color-lib-text-muted)]">
          {proposed.length} suggestion{proposed.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-2">
        {proposed.map(m => (
          <ProposedRow
            key={m.id}
            item={m}
            suggestedBy={
              m.suggestedById
                ? bundle.milestones.find(x => x.id === m.suggestedById) ?? null
                : null
            }
            allMilestones={bundle.milestones}
            onPromoted={onPromoted}
            onArchived={onArchived}
          />
        ))}
      </div>
    </section>
  )
}

function ProposedRow({ item, suggestedBy, allMilestones, onPromoted, onArchived }: {
  item: Milestone
  suggestedBy: Milestone | null
  allMilestones: Milestone[]
  onPromoted: (next: Milestone) => void
  onArchived: (id: string) => void
}) {
  const [acting, setActing] = useState<'promote' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePromote = async () => {
    setActing('promote')
    setError(null)
    try {
      // Place the promoted item at the bottom of the active sequence so
      // it doesn't disrupt established ordering.
      const nextOrder = Math.max(0, ...allMilestones
        .filter(m => m.status !== 'proposed')
        .map(m => m.order ?? 0)) + 1
      const next = await promoteActionItem(item.id, nextOrder)
      onPromoted(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActing(null)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete the proposal "${item.name}"?`)) return
    setActing('delete')
    setError(null)
    try {
      await archivePage(item.id, 'milestone')
      onArchived(item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <Link
            to={`/strategy/action-items/${item.id}`}
            className="text-sm font-semibold text-[var(--color-lib-text)] hover:text-[var(--color-lib-accent)]"
          >
            {item.name}
          </Link>
          <div className="text-[11px] text-[var(--color-lib-text-muted)] mt-0.5 flex items-center gap-2 flex-wrap">
            {suggestedBy && (
              <>
                <span>Suggested by:</span>
                <Link
                  to={`/strategy/action-items/${suggestedBy.id}`}
                  className="text-[var(--color-lib-accent)] hover:underline"
                >
                  {suggestedBy.name}
                </Link>
                {suggestedBy.owner?.name && <span>· {suggestedBy.owner.name}</span>}
              </>
            )}
            {!suggestedBy && <span className="italic">Suggested in Notion</span>}
            {item.targetDate && <span>· Target: {formatDate(item.targetDate)}</span>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            to={`/strategy/action-items/${item.id}`}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs text-[var(--color-lib-text)] px-2.5 py-1 hover:border-[var(--color-lib-border-strong)]"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={handlePromote}
            disabled={!!acting}
            className="rounded-sm bg-[var(--color-status-launched)] text-white text-xs font-medium px-2.5 py-1 hover:opacity-90 disabled:opacity-50"
          >
            {acting === 'promote' ? 'Promoting…' : 'Promote'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!!acting}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs text-[var(--color-lib-text-muted)] px-2.5 py-1 hover:text-red-600 hover:border-red-300 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
