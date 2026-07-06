/**
 * GET /api/clickup/task-detail?taskId=abc123
 * Returns the full ClickUp task including description and custom fields.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const maxDuration = 15

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const taskId = String(req.query.taskId ?? '').trim()
  if (!taskId) return res.status(400).json({ error: 'Missing taskId' })

  const token = process.env.CLICKUP_API_TOKEN
  if (!token) return res.status(500).json({ error: 'CLICKUP_API_TOKEN not set' })

  try {
    const r = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      headers: { Authorization: token },
    })
    if (!r.ok) throw new Error(`ClickUp API error: ${r.status}`)
    const data = await r.json()
    res.setHeader('Cache-Control', 's-maxage=60')
    return res.status(200).json({
      id:          data.id,
      name:        data.name ?? '',
      description: data.description ?? '',
      status:      data.status?.status ?? '',
    })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch task' })
  }
}
