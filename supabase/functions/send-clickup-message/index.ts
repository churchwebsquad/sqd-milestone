const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── ClickUp segment types (mirrored from src/lib/clickupComment.ts) ───────────
interface TextSegment { text: string; attributes?: Record<string, unknown> }
interface TagSegment  { type: 'tag'; user: { id: number } }
type CommentSegment = TextSegment | TagSegment

// ── Module-level cache (warm across invocations on the same instance) ─────────
let cachedTeamId: string | null = null
let cachedAnnouncementSubtypeId: string | null | undefined = undefined
// undefined = not yet attempted; null = attempted but unavailable

async function getTeamId(token: string): Promise<string | null> {
  if (cachedTeamId !== null) return cachedTeamId
  try {
    const res = await fetch('https://api.clickup.com/api/v2/team', {
      headers: { Authorization: token },
    })
    if (res.ok) {
      const body = await res.json() as { teams?: Array<{ id: string }> }
      cachedTeamId = body.teams?.[0]?.id ?? null
    }
  } catch {
    // best-effort — null means "unknown"
  }
  return cachedTeamId
}

async function getAnnouncementSubtypeId(token: string, teamId: string): Promise<string | null> {
  if (cachedAnnouncementSubtypeId !== undefined) return cachedAnnouncementSubtypeId
  try {
    const res = await fetch(
      `https://api.clickup.com/api/v3/workspaces/${teamId}/comments/types/post/subtypes`,
      { headers: { Authorization: token } },
    )
    if (res.ok) {
      const body = await res.json() as Array<{ id: string; name: string }>
      const hit = Array.isArray(body)
        ? body.find(t => t.name?.toLowerCase() === 'announcement')
        : null
      cachedAnnouncementSubtypeId = hit?.id ?? null
    } else {
      cachedAnnouncementSubtypeId = null
    }
  } catch {
    cachedAnnouncementSubtypeId = null
  }
  return cachedAnnouncementSubtypeId
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const { channelId, comment } = await req.json() as {
      channelId: string
      comment: CommentSegment[]
    }

    if (!channelId || !Array.isArray(comment) || comment.length === 0) {
      return new Response(
        JSON.stringify({ error: 'channelId and a non-empty comment array are required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const token = Deno.env.get('CLICKUP_STRATEGY_MILESTONE_TOKEN')
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'CLICKUP_STRATEGY_MILESTONE_TOKEN secret is not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // ── Fetch team ID + announcement subtype (both cached after first call) ──
    const teamId = await getTeamId(token)
    const subtypeId = teamId ? await getAnnouncementSubtypeId(token, teamId) : null

    // ── Build payload ─────────────────────────────────────────────────────────
    const payload: Record<string, unknown> = {
      comment,
      notify_all: true,
      type: 'post',
    }
    if (subtypeId) {
      payload.subtype_id = subtypeId
    }

    console.log('[send-clickup-message] channelId:', channelId)
    console.log('[send-clickup-message] subtypeId:', subtypeId ?? 'none')
    console.log('[send-clickup-message] segments:', comment.length)
    console.log('[send-clickup-message] comment:', JSON.stringify(comment, null, 2))

    // ── POST to ClickUp ───────────────────────────────────────────────────────
    const clickupRes = await fetch(
      `https://api.clickup.com/api/v2/view/${channelId}/comment`,
      {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    )

    const body = await clickupRes.text()
    console.log('[send-clickup-message] ClickUp status:', clickupRes.status)
    console.log('[send-clickup-message] ClickUp body:', body)

    if (!clickupRes.ok) {
      return new Response(
        JSON.stringify({ error: `ClickUp API ${clickupRes.status}: ${body}` }),
        { status: clickupRes.status, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const data = JSON.parse(body) as { id?: string | number }
    const messageId = data.id != null ? String(data.id) : null

    // ── Build thread URL (teamId already fetched above) ───────────────────────
    let threadUrl: string | null = null
    if (teamId) {
      threadUrl = messageId
        ? `https://app.clickup.com/${teamId}/chat/r/${channelId}/t/${messageId}`
        : `https://app.clickup.com/${teamId}/chat/r/${channelId}`
    }

    console.log('[send-clickup-message] threadUrl:', threadUrl)

    return new Response(
      JSON.stringify({ id: messageId, threadUrl }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[send-clickup-message] error:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
