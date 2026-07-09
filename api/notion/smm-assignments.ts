/**
 * GET /api/notion/smm-assignments
 * Proxies the strategy-notion edge function's list-smm-assignments op.
 * Returns { assignments: { member: number, smm: string }[] }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const maxDuration = 20

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl     = process.env.VITE_SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/strategy-notion`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey':        serviceRoleKey,
      },
      body: JSON.stringify({ op: 'list-smm-assignments' }),
    })

    if (!response.ok) {
      const text = await response.text()
      return res.status(502).json({ error: `Edge function error: ${text}` })
    }

    const data = await response.json()
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json(data)
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch SMM assignments' })
  }
}
