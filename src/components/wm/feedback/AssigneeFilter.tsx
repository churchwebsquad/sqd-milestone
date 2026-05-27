/**
 * Multi-select assignee filter. Used at the top of both the rail and
 * the kanban view. Single source of truth: the parent owns the
 * selected set and re-derives the visible cards.
 *
 * Reads its option list from `ProjectFeedbackBoards.assignees` — the
 * loader already computes the unique assignee list across every
 * card, so this component does no fetching of its own.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Avatar } from './Avatar'
import type { FeedbackAssignee } from '../../../lib/webReviews'

export interface AssigneeFilterProps {
  available: FeedbackAssignee[]
  /** Selected assignee ids (empty = no filter, show all). */
  selectedIds: Set<string>
  onChange: (next: Set<string>) => void
}

export function AssigneeFilter({ available, selectedIds, onChange }: AssigneeFilterProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  const label = selectedIds.size === 0
    ? 'Assignee'
    : `${selectedIds.size} assignee${selectedIds.size === 1 ? '' : 's'}`

  // Show up to 3 avatars on the trigger.
  const preview = available
    .filter(a => selectedIds.size === 0 || selectedIds.has(a.id))
    .slice(0, 3)

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-wm-text border border-wm-border-strong rounded-md bg-wm-bg-elevated hover:bg-wm-bg-hover transition-colors"
      >
        {preview.length > 0 && (
          <span className="inline-flex">
            {preview.map((a, i) => (
              <span key={a.id} className={i === 0 ? '' : '-ml-1.5'}>
                <Avatar name={a.name} size="sm" />
              </span>
            ))}
          </span>
        )}
        <span>{label}</span>
        <ChevronDown size={11} className="opacity-70" />
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-1 left-0 min-w-[220px] rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg py-1 max-h-72 overflow-y-auto">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => { onChange(new Set()); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-wm-text-muted hover:bg-wm-bg-hover border-b border-wm-border"
            >
              Clear filter
            </button>
          )}
          {available.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-wm-text-subtle">No assignees yet.</div>
          )}
          {available.map(a => {
            const checked = selectedIds.has(a.id)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover inline-flex items-center gap-2"
              >
                <span className="w-3 inline-flex items-center justify-center">
                  {checked && <Check size={11} className="text-wm-accent-strong" />}
                </span>
                <Avatar name={a.name} size="sm" />
                <span className="truncate flex-1">{a.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
