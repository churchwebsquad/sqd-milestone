import { useState } from 'react'
import { ExternalLink, Maximize2, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Milestone, MilestoneStatus, MilestoneWritable } from '../../types/strategy'
import { archivePage, updateMilestone } from '../../lib/strategyNotion'
import { EditableText } from './editors/EditableText'
import { EditableSelect } from './editors/EditableSelect'
import { EditableDate } from './editors/EditableDate'
import { EditablePerson } from './editors/EditablePerson'

const STATUS_OPTIONS: ReadonlyArray<{ value: MilestoneStatus; label: string }> = [
  { value: 'proposed',    label: 'Proposed' },
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'complete',    label: 'Complete' },
  { value: 'skipped',     label: 'Skipped' },
]

/** Milestone row on the Initiative Detail. Status disc, name, date, and
 *  owner are all click-to-edit. Archive is in a hover-revealed icon. */
export function MilestoneItem({ milestone, onUpdated, onArchived }: {
  milestone: Milestone
  onUpdated: (next: Milestone) => void
  onArchived: (id: string) => void
}) {
  const done = milestone.status === 'complete'
  const blocked = milestone.status === 'blocked'
  const skipped = milestone.status === 'skipped'

  const save = (updates: MilestoneWritable) =>
    updateMilestone(milestone.id, updates).then(onUpdated)

  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const handleArchive = async () => {
    if (!confirm(`Delete the Action Item "${milestone.name}"? It'll be archived in Notion.`)) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await archivePage(milestone.id, 'milestone')
      onArchived(milestone.id)
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiving(false)
    }
  }

  const toggleComplete = async () => {
    // Click the checkbox: complete ⇄ not-started. Anything else (blocked,
    // skipped, in-progress) goes to complete on first click.
    const next: MilestoneStatus = milestone.status === 'complete' ? 'not-started' : 'complete'
    await save({ status: next })
  }

  return (
    <div className="group">
      <div
        className={[
          'flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-sm border-b border-[var(--color-lib-border)] last:border-b-0',
          done ? 'bg-[var(--color-verif-verified-bg)]/40' : '',
        ].join(' ')}
      >
        {/* Checkbox-style toggle: clicking the box flips complete ⇄ not-started.
            Right-clicking opens the full status menu (via EditableSelect). */}
        <CheckboxToggle
          status={milestone.status}
          onToggle={toggleComplete}
          statusOptions={STATUS_OPTIONS}
          onPickStatus={next => save({ status: next ?? 'not-started' })}
        />

        <div className="flex-1 min-w-0">
          <div
            className={[
              'text-sm leading-snug',
              done ? 'text-[var(--color-lib-text-muted)] line-through' : 'text-[var(--color-lib-text)]',
              skipped ? 'text-[var(--color-lib-text-subtle)] italic' : '',
            ].join(' ')}
          >
            <EditableText
              value={milestone.name}
              onSave={next => save({ name: next ?? milestone.name })}
              allowEmpty={false}
              emptyLabel="Add name…"
            />
          </div>
          <div className="text-xs text-[var(--color-lib-text-muted)] mt-0.5">
            <EditableText
              value={milestone.notes}
              onSave={next => save({ notes: next })}
              multiline
              emptyLabel="Add notes…"
              className="text-xs"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs">
            <EditableDate
              value={milestone.targetDate}
              onSave={next => save({ targetDate: next })}
              placeholder="Set date"
            />
          </div>
          <div className={`text-xs ${blocked ? 'text-[var(--color-status-blocked)]' : 'text-[var(--color-lib-text-muted)]'}`}>
            <EditablePerson
              value={milestone.owner}
              onSave={next => save({ ownerId: next })}
            />
          </div>
          <Link
            to={`/strategy/action-items/${milestone.id}`}
            className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] transition-colors"
            title="Open Action Item"
          >
            <Maximize2 size={12} />
          </Link>
          <a
            href={milestone.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] transition-colors"
            title="Open in Notion"
          >
            <ExternalLink size={12} />
          </a>
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            className="opacity-0 group-hover:opacity-100 text-[var(--color-lib-text-subtle)] hover:text-red-500 transition-opacity disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {archiveError && (
        <p className="text-[11px] text-red-600 px-2 pb-1.5">
          Couldn't delete: {archiveError}
        </p>
      )}
    </div>
  )
}

/** Checkbox-styled status toggle. Click the box: complete ⇄ not-started.
 *  Click the small chevron next to it: opens the full status select. The
 *  visual is a square checkbox so the row reads as a checklist. */
function CheckboxToggle({
  status, onToggle, statusOptions, onPickStatus,
}: {
  status: MilestoneStatus
  onToggle: () => void
  statusOptions: ReadonlyArray<{ value: MilestoneStatus; label: string }>
  onPickStatus: (next: MilestoneStatus | null) => Promise<void>
}) {
  const checked = status === 'complete'
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onToggle}
        className={[
          'w-4 h-4 rounded-sm border-2 grid place-items-center transition-colors shrink-0',
          checked
            ? 'bg-[var(--color-status-launched)] border-[var(--color-status-launched)] text-white'
            : status === 'in-progress'
              ? 'border-[var(--color-status-inprogress)] bg-white'
              : status === 'blocked'
                ? 'border-[var(--color-status-blocked)] bg-white'
                : status === 'proposed'
                  ? 'border-dashed border-[var(--color-status-proposed)] bg-white'
                  : status === 'skipped'
                    ? 'border-[var(--color-lib-border-strong)] bg-[var(--color-lib-bg)]'
                    : 'border-[var(--color-lib-border-strong)] bg-white hover:border-[var(--color-status-launched)]',
        ].join(' ')}
        aria-label="Toggle complete"
        title={checked ? 'Mark not started' : 'Mark complete'}
      >
        {checked && <span className="text-[10px] leading-none">✓</span>}
        {status === 'in-progress' && !checked && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-inprogress)]" />
        )}
      </button>
      <EditableSelect<MilestoneStatus>
        value={status}
        options={statusOptions}
        onSave={onPickStatus}
        allowClear={false}
      >
        <span className="text-[10px] text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)] cursor-pointer px-0.5">
          ⌄
        </span>
      </EditableSelect>
    </div>
  )
}

