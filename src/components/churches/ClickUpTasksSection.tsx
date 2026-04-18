import { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { ClickupFolder, ClickupList } from '../../types/database'

interface Props {
  memberId: number
  clickupLists: ClickupList[]
  clickupFolder: ClickupFolder | null
}

type Department = 'Website' | 'Branding' | 'Social Media'

const ACTIVE_STATUSES = [
  'in progress', 'received', 'ready to start',
  'sqd review', 'needs an update', 'waiting feedback',
]

interface TaskRow {
  task_id: string
  name: string
  status: string | null
  assignee_name: string | null
  due_date: string | null
}

function classifyList(name: string): Department | null {
  const n = name.toLowerCase()
  if (n.includes('website') || n.includes('web')) return 'Website'
  if (n.includes('brand')) return 'Branding'
  if (n.includes('social')) return 'Social Media'
  return null
}

export default function ClickUpTasksSection({ memberId, clickupLists, clickupFolder }: Props) {
  const [activeDept, setActiveDept] = useState<Department>('Website')
  const [tasks, setTasks] = useState<Record<Department, TaskRow[]>>({ Website: [], Branding: [], 'Social Media': [] })
  const [loading, setLoading] = useState(true)

  // Group lists by department
  const listsByDept: Record<Department, number[]> = { Website: [], Branding: [], 'Social Media': [] }
  for (const list of clickupLists) {
    const dept = list.department ? classifyDeptType(list.department) : classifyList(list.name)
    if (dept) listsByDept[dept].push(list.id)
  }

  useEffect(() => {
    if (clickupLists.length === 0) { setLoading(false); return }

    const load = async () => {
      try {
        const allListIds = clickupLists.map(l => l.id)

        // Fetch tasks for all this church's lists
        const { data: taskData } = await supabase
          .from('tasks')
          .select('task_id, name, list_id')
          .in('list_id', allListIds)
          .or('task_archived.is.null,task_archived.eq.false')

        if (!taskData?.length) { setLoading(false); return }

        const taskIds = taskData.map(t => t.task_id)

        // Exclude deleted tasks
        const { data: deletions } = await supabase
          .from('task_deletions')
          .select('task_id')
          .in('task_id', taskIds)
        const deletedSet = new Set((deletions ?? []).map(d => d.task_id))

        const liveTasks = (taskData as { task_id: string; name: string; list_id: number }[])
          .filter(t => !deletedSet.has(t.task_id))

        const liveIds = liveTasks.map(t => t.task_id)
        if (liveIds.length === 0) { setLoading(false); return }

        // Fetch latest status, assignee, and due date in parallel
        const [statusRes, assigneeRes, dueRes] = await Promise.all([
          supabase.from('status_history').select('task_id, status_after, changed_at').in('task_id', liveIds).order('changed_at', { ascending: false }),
          supabase.from('assignee_history').select('task_id, assignee, change_type, changed_at').in('task_id', liveIds).order('changed_at', { ascending: false }),
          supabase.from('view_latest_due_dates' as 'tasks').select('task_id, due_date_after').in('task_id', liveIds),
        ])

        // Latest status per task
        const statusMap = new Map<string, string>()
        for (const row of (statusRes.data ?? []) as { task_id: string; status_after: string }[]) {
          if (!statusMap.has(row.task_id)) statusMap.set(row.task_id, row.status_after)
        }

        // Current assignees per task (multi-assignee, respects add/rem)
        // Walk rows newest-first. For each (task_id, assignee) pair, only process the
        // first occurrence. If that occurrence is 'assignee_add', the user is current.
        // If 'assignee_rem', they've been removed — skip.
        const assigneeMap = new Map<string, number[]>()
        const processedPairs = new Set<string>()
        for (const row of (assigneeRes.data ?? []) as { task_id: string; assignee: number; change_type: string }[]) {
          const pairKey = `${row.task_id}:${row.assignee}`
          if (processedPairs.has(pairKey)) continue
          processedPairs.add(pairKey)
          if (row.change_type === 'assignee_add') {
            const list = assigneeMap.get(row.task_id) ?? []
            list.push(row.assignee)
            assigneeMap.set(row.task_id, list)
          }
        }

        // Resolve assignee IDs to usernames
        const allAssigneeIds = [...new Set([...assigneeMap.values()].flat())]
        const userMap = new Map<number, string>()
        if (allAssigneeIds.length > 0) {
          const { data: users } = await supabase
            .from('clickup_users')
            .select('clickup_id, username')
            .in('clickup_id', allAssigneeIds)
          for (const u of (users ?? []) as { clickup_id: number; username: string | null }[]) {
            userMap.set(u.clickup_id, u.username ?? String(u.clickup_id))
          }
        }

        // Due dates
        const dueMap = new Map<string, string>()
        for (const row of (dueRes.data ?? []) as { task_id: string; due_date_after: string }[]) {
          dueMap.set(row.task_id, row.due_date_after)
        }

        // Build list_id→dept map
        const listDeptMap = new Map<number, Department>()
        for (const [dept, ids] of Object.entries(listsByDept) as [Department, number[]][]) {
          for (const id of ids) listDeptMap.set(id, dept)
        }

        // Assemble task rows grouped by department
        const result: Record<Department, TaskRow[]> = { Website: [], Branding: [], 'Social Media': [] }

        for (const t of liveTasks) {
          const status = statusMap.get(t.task_id)?.toLowerCase() ?? null
          if (!status || !ACTIVE_STATUSES.includes(status)) continue

          const dept = listDeptMap.get(t.list_id)
          if (!dept) continue

          const ids = assigneeMap.get(t.task_id) ?? []
          const names = ids.map(id => userMap.get(id) ?? String(id)).join(', ')
          result[dept].push({
            task_id: t.task_id,
            name: t.name,
            status: statusMap.get(t.task_id) ?? null,
            assignee_name: names || null,
            due_date: dueMap.get(t.task_id) ?? null,
          })
        }

        // Limit to 6 per department
        for (const dept of Object.keys(result) as Department[]) {
          result[dept] = result[dept].slice(0, 6)
        }

        setTasks(result)
      } catch (err) {
        console.error('[ClickUpTasks] load error:', err)
      } finally {
        setLoading(false)
      }
    }

    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, clickupLists.length])

  const deptTabs: Department[] = ['Website', 'Branding', 'Social Media']
  const currentTasks = tasks[activeDept]
  const folderUrl = clickupFolder
    ? `https://app.clickup.com/90171129510/v/li/${clickupFolder.id}`
    : null

  return (
    <section id="clickup-tasks" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">ClickUp Tasks</h2>
        {folderUrl && (
          <a
            href={folderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple transition-colors"
          >
            View in ClickUp <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* Department tabs */}
      <div className="flex gap-2 mb-4">
        {deptTabs.map(dept => (
          <button
            key={dept}
            type="button"
            onClick={() => setActiveDept(dept)}
            className={[
              'rounded-full text-xs font-semibold px-3 py-1.5 transition-colors border',
              activeDept === dept
                ? 'bg-primary-purple border-primary-purple text-white'
                : 'border-lavender text-purple-gray hover:border-primary-purple hover:text-primary-purple',
            ].join(' ')}
          >
            {dept}
            {tasks[dept].length > 0 && (
              <span className="ml-1.5 text-[10px] opacity-70">({tasks[dept].length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-10 bg-lavender-tint/40 rounded-lg animate-pulse" />)}
        </div>
      ) : currentTasks.length === 0 ? (
        <p className="text-xs text-purple-gray/50 italic py-4 text-center">No active {activeDept.toLowerCase()} tasks.</p>
      ) : (
        <div className="divide-y divide-lavender/50">
          {currentTasks.map(t => (
            <div key={t.task_id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-deep-plum truncate">{t.name}</p>
                <p className="text-xs text-purple-gray">
                  {t.assignee_name ?? 'Unassigned'}
                  {t.due_date && ` · Due ${new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                </p>
              </div>
              {t.status && (
                <span className="shrink-0 text-[10px] font-semibold rounded-full bg-lavender/40 text-purple-gray px-2 py-0.5">
                  {t.status}
                </span>
              )}
              <a
                href={`https://app.clickup.com/t/${t.task_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-purple-gray hover:text-primary-purple transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink size={13} />
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function classifyDeptType(department: string): Department | null {
  const d = department.toLowerCase()
  if (d.includes('web')) return 'Website'
  if (d.includes('brand')) return 'Branding'
  if (d.includes('social')) return 'Social Media'
  return null
}
