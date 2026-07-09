/**
 * GET /api/clickup/church-tasks?member=1802
 * Returns sermon series + carousel template tasks for a church (last 120 days).
 *
 * Strategy:
 * 1. Look up the church's ClickUp folder by member # from space folder list (cached 10 min)
 * 2. Get lists inside that folder to find "Graphics & Video"
 * 3. Fetch tasks from that list, filter by tag + 120-day window
 * Total: 2-3 fast targeted API calls, no full-workspace pagination.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const maxDuration = 30

// All spaces that contain church account folders
const ACCOUNT_SPACES = ['1297774', '1301552', '1306092', '6310389']

let folderCache: Map<number, string> | null = null
let folderCacheTime = 0
const FOLDER_CACHE_TTL = 10 * 60 * 1000

async function getFolderIdForMember(member: number, token: string): Promise<string | null> {
  const now = Date.now()
  if (!folderCache || now - folderCacheTime > FOLDER_CACHE_TTL) {
    folderCache = new Map()
    await Promise.all(ACCOUNT_SPACES.map(async (spaceId) => {
      const r = await fetch(`https://api.clickup.com/api/v2/space/${spaceId}/folder?archived=false`, {
        headers: { Authorization: token },
      })
      if (!r.ok) return
      const data = await r.json()
      for (const f of (data.folders ?? []) as any[]) {
        const match = String(f.name ?? '').match(/^(\d+)\s*-/)
        if (match) folderCache!.set(parseInt(match[1], 10), f.id)
      }
    }))
    folderCacheTime = now
  }
  return folderCache.get(member) ?? null
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const member = parseInt(String(req.query.member ?? ''), 10)
  if (!member) return res.status(400).json({ error: 'Missing member query param' })

  const token = process.env.CLICKUP_API_TOKEN ?? process.env.CLICKUP_STRATEGY_MILESTONE_TOKEN
  if (!token) return res.status(500).json({ error: 'CLICKUP_API_TOKEN not set' })

  const since120Days = Date.now() - 120 * 24 * 60 * 60 * 1000

  try {
    // Step 1: find the church's folder
    const folderId = await getFolderIdForMember(member, token)
    if (!folderId) {
      return res.status(200).json({ sermonTasks: [], carouselTasks: [] })
    }

    // Step 2: get lists inside the folder, find "Graphics & Video"
    const listsRes = await fetch(`https://api.clickup.com/api/v2/folder/${folderId}/list`, {
      headers: { Authorization: token },
    })
    if (!listsRes.ok) throw new Error(`ClickUp lists ${listsRes.status}`)
    const listsData = await listsRes.json()
    const lists = (listsData.lists ?? []) as any[]
    const gvList = lists.find((l: any) =>
      String(l.name ?? '').toLowerCase().includes('graphic') ||
      String(l.name ?? '').toLowerCase().includes('video')
    )
    if (!gvList) {
      return res.status(200).json({ sermonTasks: [], carouselTasks: [] })
    }

    // Step 3: fetch tasks from that list — paginate if needed
    const allTasks: any[] = []
    for (let page = 0; page < 5; page++) {
      const r = await fetch(
        `https://api.clickup.com/api/v2/list/${gvList.id}/task?include_closed=true&order_by=updated&page=${page}&page_size=100`,
        { headers: { Authorization: token } }
      )
      if (!r.ok) break
      const data = await r.json()
      const tasks = (data.tasks ?? []) as any[]
      allTasks.push(...tasks)
      if (data.last_page || tasks.length === 0) break
    }

    function mapTask(t: any) {
      return {
        id:           t.id,
        name:         t.name,
        status:       t.status?.status ?? '',
        date_created: t.date_created ?? '',
        assignees:    (t.assignees ?? []).map((a: any) => a.username ?? a.email ?? ''),
        url:          t.url ?? '',
        updatedAt:    new Date(Number(t.date_updated ?? 0)).toISOString(),
      }
    }

    const hasTag = (t: any, tag: string) =>
      (t.tags ?? []).some((tg: any) => tg.name === tag)

    const inWindow = (t: any) => Number(t.date_updated ?? 0) >= since120Days

    const sermonTasks   = allTasks.filter(t => (hasTag(t, 'sermonseries') || hasTag(t, 'broadcastvideo')) && inWindow(t)).map(mapTask)
    const carouselTasks = allTasks.filter(t => hasTag(t, 'social-sermoncarouseltemplate') && inWindow(t)).map(mapTask)

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    return res.status(200).json({ sermonTasks, carouselTasks })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch ClickUp tasks' })
  }
}
