/**
 * Vercel Serverless Function — /api/webhook/reply-triage
 *
 * Proxies triage payloads from the browser to the n8n webhook server-side,
 * bypassing CORS restrictions that block direct browser-to-n8n calls.
 *
 * Required env var (server-side only, no VITE_ prefix):
 *   N8N_REPLY_TRIAGE_WEBHOOK_URL
 */

export default async function handler(
  req: { method: string; body: unknown },
  res: {
    status: (code: number) => {
      json: (body: unknown) => void
      end: () => void
    }
  },
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const n8nUrl = process.env.N8N_REPLY_TRIAGE_WEBHOOK_URL
  if (!n8nUrl) {
    return res.status(500).json({ error: 'Webhook URL not configured' })
  }

  const response = await fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body),
  })

  if (!response.ok) {
    return res.status(502).json({ error: `n8n responded with ${response.status}` })
  }

  return res.status(200).json({ ok: true })
}
