import { useEffect, useState } from 'react'
import { User, X } from 'lucide-react'
import { listNotionUsers } from '../../../lib/strategyNotion'
import type { NotionUserOption } from '../../../types/strategy'
import { usePopoverDismiss } from './usePopover'

let usersCache: NotionUserOption[] | null = null

/** Click-to-edit person picker. Loads the workspace user list lazily on
 *  first open and caches it module-wide so other instances reuse it. */
export function EditablePerson({
  value,
  onSave,
  allowClear = true,
}: {
  /** Current Notion user (id + name + avatar). */
  value: { id: string; name: string | null; avatarUrl: string | null } | null
  onSave: (nextUserId: string | null) => Promise<void>
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<NotionUserOption[] | null>(usersCache)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const ref = usePopoverDismiss<HTMLDivElement>(open, () => setOpen(false))

  useEffect(() => {
    if (open && !usersCache) {
      listNotionUsers()
        .then(list => { usersCache = list; setUsers(list) })
        .catch(err => setLoadErr(err instanceof Error ? err.message : String(err)))
    }
  }, [open])

  const choose = async (next: string | null) => {
    if (next === (value?.id ?? null)) { setOpen(false); return }
    setPending(true)
    setError(null)
    try {
      await onSave(next)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const filtered = (users ?? []).filter(u => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded hover:bg-lavender-tint/40 transition-colors px-1 -mx-1 ${pending ? 'opacity-60' : ''}`}
      >
        {value ? (
          <>
            {value.avatarUrl
              ? <img src={value.avatarUrl} alt="" className="w-4 h-4 rounded-full" />
              : <User size={12} className="text-purple-gray" />}
            <span>{value.name ?? '(unnamed)'}</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-purple-gray/60 italic">
            <User size={11} />
            Set owner
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[240px] rounded-lg border border-lavender bg-white shadow-lg p-1">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            autoFocus
            className="w-full rounded border border-lavender px-2 py-1 text-xs outline-none focus:border-primary-purple"
          />
          <div className="max-h-56 overflow-y-auto mt-1">
            {loadErr && <p className="px-2 py-1.5 text-xs text-red-600">{loadErr}</p>}
            {!users && !loadErr && <p className="px-2 py-1.5 text-xs text-purple-gray italic">Loading…</p>}
            {users && filtered.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-purple-gray italic">No matches</p>
            )}
            {filtered.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => choose(u.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-deep-plum hover:bg-lavender-tint text-left rounded"
              >
                {u.avatarUrl
                  ? <img src={u.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                  : <span className="w-5 h-5 rounded-full bg-lavender flex items-center justify-center"><User size={10} className="text-purple-gray" /></span>}
                <span className="flex-1 truncate">
                  <span className="font-medium">{u.name ?? '(unnamed)'}</span>
                  {u.email && <span className="ml-1 text-purple-gray/70 text-[10px]">{u.email}</span>}
                </span>
              </button>
            ))}
          </div>
          {allowClear && value && (
            <>
              <div className="my-1 h-px bg-lavender" />
              <button
                type="button"
                onClick={() => choose(null)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-purple-gray hover:bg-lavender-tint rounded"
              >
                <X size={11} />
                Clear
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap">{error}</p>}
    </div>
  )
}
