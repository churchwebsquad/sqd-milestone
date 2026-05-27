/**
 * Assignee dropdown for feedback cards (and the AddFeedbackCard form).
 *
 * Loads staff once from `employees` (the HR table that backs every
 * other staff lookup in the app — same table `webReviews.resolveStaffName`
 * reads) and lets the strategist pick or clear an assignee. Onclick
 * calls back with `{ userId, name, email }` so the caller can persist
 * via `setCommentAssignee`.
 *
 * Search box on top filters as you type — important once the staff
 * list grows past 20+ entries.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { Avatar } from './Avatar'

interface Employee {
  id:    string
  name:  string
  email: string | null
}

export interface AssigneeValue {
  userId: string | null
  name:   string | null
  email:  string | null
}

export interface AssigneePickerProps {
  current: AssigneeValue | null
  /** Called with the new assignment (or null to clear). */
  onChange: (next: AssigneeValue | null) => void | Promise<void>
  disabled?: boolean
  /** Compact rendering for inside cards. */
  size?: 'sm' | 'md'
}

let cachedEmployees: Promise<Employee[]> | null = null
function loadEmployees(): Promise<Employee[]> {
  if (cachedEmployees) return cachedEmployees
  cachedEmployees = (async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, full_name, name, first_name, last_name, email')
      .eq('status', 'active')
      .order('full_name', { ascending: true })
    return ((data ?? []) as Array<{
      id: string; full_name: string | null; name: string | null
      first_name: string | null; last_name: string | null; email: string | null
    }>).map(r => ({
      id:    r.id,
      name:  r.full_name?.trim()
          || r.name?.trim()
          || [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
          || (r.email ?? 'Unknown'),
      email: r.email,
    }))
  })()
  return cachedEmployees
}

export function AssigneePicker({ current, onChange, disabled, size = 'md' }: AssigneePickerProps) {
  const [open, setOpen]   = useState(false)
  const [list, setList]   = useState<Employee[] | null>(null)
  const [query, setQuery] = useState('')
  const wrapperRef        = useRef<HTMLDivElement | null>(null)
  const searchRef         = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open || list !== null) return
    let cancelled = false
    void loadEmployees().then(rows => { if (!cancelled) setList(rows) })
    return () => { cancelled = true }
  }, [open, list])

  // Outside click + Escape close.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    // Auto-focus search input on open.
    setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!list) return []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(r =>
      r.name.toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q),
    )
  }, [list, query])

  const trigger = current?.name
    ? (
      <span className="inline-flex items-center gap-1.5">
        <Avatar name={current.name} size={size === 'sm' ? 'sm' : 'md'} />
        <span className={[
          'font-medium text-wm-text',
          size === 'sm' ? 'text-[11px]' : 'text-[12px]',
        ].join(' ')}>{current.name}</span>
      </span>
    )
    : (
      <span className="inline-flex items-center gap-1.5 text-wm-text-muted">
        <span className={[
          'inline-flex items-center justify-center rounded-full border border-dashed border-wm-border-strong',
          size === 'sm' ? 'w-[18px] h-[18px] text-[9px]' : 'w-[20px] h-[20px] text-[10px]',
        ].join(' ')}>?</span>
        <span className={size === 'sm' ? 'text-[11px]' : 'text-[12px]'}>Assign</span>
      </span>
    )

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center hover:bg-wm-bg-hover rounded px-1 py-0.5 transition-colors disabled:opacity-50"
      >
        {trigger}
      </button>
      {open && (
        <div className="absolute z-30 top-full mt-1 left-0 min-w-[220px] rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg">
          <div className="p-2 border-b border-wm-border">
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search staff…"
              className="w-full px-2 py-1 text-[12px] bg-wm-bg-hover rounded border border-transparent focus:bg-wm-bg-elevated focus:border-wm-border-focus focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {list === null && (
              <div className="px-3 py-2 text-[11px] text-wm-text-subtle inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Loading staff…
              </div>
            )}
            {list !== null && filtered.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-wm-text-subtle">No matches.</div>
            )}
            {list !== null && current && (
              <button
                type="button"
                onClick={async () => { setOpen(false); await onChange(null) }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-wm-text-muted hover:bg-wm-bg-hover"
              >
                Unassign
              </button>
            )}
            {filtered.map(e => {
              const selected = current?.userId === e.id
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={async () => {
                    setOpen(false)
                    await onChange({ userId: e.id, name: e.name, email: e.email })
                  }}
                  className={[
                    'w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover inline-flex items-center gap-2',
                    selected ? 'bg-wm-bg-selected text-wm-text font-semibold' : 'text-wm-text',
                  ].join(' ')}
                >
                  <Avatar name={e.name} size="sm" />
                  <span className="truncate">{e.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
