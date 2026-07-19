/**
 * GET /api/clickup/srp-tasks
 * Returns the most recent sms-sermon-recap ClickUp task per member number.
 * Member # is parsed from the task name format: "{member} - {title}"
 *
 * Warm instances return from a 5-minute in-memory cache to avoid the
 * ~10-30s ClickUp tag-search round-trip on every page load.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const maxDuration = 30

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let memCache: { payload: any; expiresAt: number } | null = null

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Serve from in-memory cache if still fresh
  if (memCache && Date.now() < memCache.expiresAt) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    res.setHeader('X-Cache', 'HIT')
    return res.status(200).json(memCache.payload)
  }

  const token  = process.env.CLICKUP_API_TOKEN
  const teamId = '1235435'

  if (!token) return res.status(500).json({ error: 'CLICKUP_API_TOKEN not set' })

  try {
    // Fetch up to 100 most recent sms-sermon-recap tasks
    const url = `https://api.clickup.com/api/v2/team/${teamId}/task?tags[]=sms-sermon-recap&page=0&order_by=updated&page_size=100&include_closed=true`
    const response = await fetch(url, {
      headers: { Authorization: token },
    })
    if (!response.ok) throw new Error(`ClickUp API error: ${response.status}`)
    const data = await response.json()

    // Parse member number from task name — format: "{member} - {rest}"
    const allTasks: { member: number; id: string; name: string; status: string; date_created: string; due_date: string | null; assignees: string[]; url: string; updatedAt: string }[] = []

    for (const task of (data.tasks ?? []) as any[]) {
      const match = String(task.name ?? '').match(/^(\d+)\s*-/)
      if (!match) continue
      const member = parseInt(match[1], 10)
      allTasks.push({
        member,
        id:           task.id,
        name:         task.name,
        status:       task.status?.status ?? '',
        date_created: task.date_created ?? '',
        due_date:     task.due_date ? new Date(Number(task.due_date)).toISOString() : null,
        assignees:    (task.assignees ?? []).map((a: any) => a.username ?? a.email ?? ''),
        url:          task.url ?? '',
        updatedAt:    new Date(Number(task.date_updated ?? 0)).toISOString(),
      })
    }

    // Also build the per-member summary (most recent) for the dashboard
    const byMember = new Map<number, typeof allTasks[0]>()
    for (const t of allTasks) {
      const existing = byMember.get(t.member)
      if (!existing || t.updatedAt > existing.updatedAt) byMember.set(t.member, t)
    }

    const result = Array.from(byMember.entries()).map(([member, t]) => ({
      member,
      taskId:    t.id,
      taskName:  t.name,
      status:    t.status,
      dueDate:   t.due_date,
      createdAt: new Date(Number(t.date_created || 0)).toISOString(),
      updatedAt: t.updatedAt,
    }))

    const payload = { tasks: result, allTasks }
    memCache = { payload, expiresAt: Date.now() + CACHE_TTL }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    res.setHeader('X-Cache', 'MISS')
    return res.status(200).json(payload)
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch ClickUp tasks' })
  }
}
