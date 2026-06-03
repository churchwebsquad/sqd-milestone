/**
 * Compact ClickUp task summary for the project side panel.
 *
 * Pulls open tasks from the ONE list whose:
 *   • space = 90171129510  (Website squad space)
 *   • name ILIKE '%website%'
 *   • folder.name LIKE '<memberId> -%'
 *
 * Shows: count of active tasks + status breakdown bars + a few
 * highlighted rows. Renders a "Open in ClickUp" link when the list
 * carries one.
 *
 * Read-only — clicking a row links out to ClickUp via the task's
 * own URL stored on the tasks row when present.
 */
import { useEffect, useState } from 'react'
import { Loader2, ExternalLink, ListChecks } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

const WEBSITE_SPACE_ID = 90171129510

const ACTIVE_STATUSES = new Set([
  'in progress', 'received', 'ready to start',
  'sqd review', 'needs an update', 'waiting feedback',
])

interface TaskRow {
  task_id: string
  name: string
  url: string | null
  status: string | null
  due_date: string | null
}

interface Props {
  member: number
}

export function ClickUpTasksSummary({ member }: Props) {
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [listId, setListId]     = useState<number | null>(null)
  const [listName, setListName] = useState<string | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [tasks, setTasks]       = useState<TaskRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setError(null)
      try {
        // 1) Find the Website list for this member's folder. The
        //    folder name follows the convention "<memberId> - …".
        const { data: folders, error: folderErr } = await supabase
          .from('clickup_folders')
          .select('id, name')
          .eq('space_id', WEBSITE_SPACE_ID)
          .ilike('name', `${member} -%`)
          .limit(1)
        if (folderErr) throw folderErr
        const folder = folders?.[0]
        if (!folder) {
          if (!cancelled) { setLoading(false); }
          return
        }
        if (!cancelled) setFolderName(folder.name)

        const { data: lists, error: listErr } = await supabase
          .from('clickup_lists')
          .select('id, name')
          .eq('space', WEBSITE_SPACE_ID)
          .eq('folder', folder.id)
          .ilike('name', '%website%')
          .limit(1)
        if (listErr) throw listErr
        const list = lists?.[0]
        if (!list) {
          if (!cancelled) { setLoading(false); }
          return
        }
        if (cancelled) return
        setListId(list.id)
        setListName(list.name)

        // 2) Fetch tasks for that list (mirrors ClickUpTasksSection's
        //    pattern: tasks + latest status + filter out deletions).
        const { data: rawTasks } = await supabase
          .from('tasks')
          .select('task_id, name, url')
          .eq('list_id', list.id)
          .or('task_archived.is.null,task_archived.eq.false')
        const all = (rawTasks ?? []) as Array<{ task_id: string; name: string; url: string | null }>
        if (all.length === 0) {
          if (!cancelled) { setTasks([]); setLoading(false); }
          return
        }
        const taskIds = all.map(t => t.task_id)
        const [statusRes, deletionsRes, dueRes] = await Promise.all([
          supabase.from('status_history')
            .select('task_id, status_after, changed_at')
            .in('task_id', taskIds)
            .order('changed_at', { ascending: false }),
          supabase.from('task_deletions').select('task_id').in('task_id', taskIds),
          supabase.from('view_latest_due_dates' as 'tasks')
            .select('task_id, due_date_after')
            .in('task_id', taskIds),
        ])
        const deleted = new Set((deletionsRes.data ?? []).map((d: { task_id: string }) => d.task_id))
        const latestStatus = new Map<string, string>()
        for (const r of (statusRes.data ?? []) as Array<{ task_id: string; status_after: string }>) {
          if (!latestStatus.has(r.task_id)) latestStatus.set(r.task_id, r.status_after)
        }
        const latestDue = new Map<string, string | null>()
        for (const r of (dueRes.data ?? []) as Array<{ task_id: string; due_date_after: string | null }>) {
          latestDue.set(r.task_id, r.due_date_after)
        }
        const compiled: TaskRow[] = all
          .filter(t => !deleted.has(t.task_id))
          .map(t => ({
            task_id: t.task_id,
            name: t.name,
            url: t.url,
            status: latestStatus.get(t.task_id) ?? null,
            due_date: latestDue.get(t.task_id) ?? null,
          }))
        if (!cancelled) setTasks(compiled)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [member])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-wm-text-muted">
        <Loader2 size={11} className="animate-spin" />
        Loading ClickUp tasks…
      </div>
    )
  }
  if (error) {
    return <p className="text-[11px] text-wm-danger">ClickUp lookup failed: {error}</p>
  }
  if (!listId) {
    return (
      <p className="text-[11px] text-wm-text-muted italic">
        No matching ClickUp Website list found in space {WEBSITE_SPACE_ID} for member {member}.
      </p>
    )
  }

  // Bucket statuses for the breakdown bar.
  const buckets: Record<string, TaskRow[]> = {}
  for (const t of tasks) {
    const k = (t.status ?? 'unset').toLowerCase()
    if (!buckets[k]) buckets[k] = []
    buckets[k].push(t)
  }
  const total = tasks.length
  const active = tasks.filter(t => ACTIVE_STATUSES.has((t.status ?? '').toLowerCase())).length
  const closed = total - active

  // Highlight up to 5 most-recently-updated active tasks.
  const highlight = tasks
    .filter(t => ACTIVE_STATUSES.has((t.status ?? '').toLowerCase()))
    .slice(0, 5)

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ListChecks size={12} className="text-wm-accent" />
          <span className="text-[12px] font-semibold text-wm-text truncate">
            {folderName ?? `Member ${member}`} — {listName}
          </span>
        </div>
        <a
          href={`https://app.clickup.com/${WEBSITE_SPACE_ID.toString().slice(0, 7)}/v/li/${listId}`}
          target="_blank"
          rel="noreferrer"
          title="Open list in ClickUp"
          className="inline-flex items-center gap-1 text-[11px] text-wm-accent-strong hover:underline"
        >
          Open <ExternalLink size={10} />
        </a>
      </div>

      <div className="flex items-center gap-3 text-[11px] mb-2">
        <span className="font-mono tabular-nums text-wm-text">
          {active} <span className="text-wm-text-muted font-normal">active</span>
        </span>
        <span className="font-mono tabular-nums text-wm-text-muted">
          {closed} <span className="font-normal">closed</span>
        </span>
        <span className="font-mono tabular-nums text-wm-text-muted">
          {total} <span className="font-normal">total</span>
        </span>
      </div>

      {Object.keys(buckets).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {Object.entries(buckets)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([status, list]) => (
              <span
                key={status}
                className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg px-2 py-0.5 text-[10px] font-semibold text-wm-text-muted"
              >
                {status}
                <span className="font-mono tabular-nums text-wm-text-subtle">{list.length}</span>
              </span>
            ))}
        </div>
      )}

      {highlight.length > 0 && (
        <ul className="space-y-1 mt-1">
          {highlight.map(t => (
            <li key={t.task_id}>
              <a
                href={t.url ?? `https://app.clickup.com/t/${t.task_id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 text-[11px] py-0.5 group"
              >
                <span className="truncate text-wm-text group-hover:text-wm-accent-strong">
                  {t.name}
                </span>
                <span className="text-[10px] text-wm-text-muted shrink-0">
                  {t.status ?? '—'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
