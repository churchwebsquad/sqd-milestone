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
  // Env override — set this once after checking the logs to bypass discovery
  const envOverride = Deno.env.get('CLICKUP_ANNOUNCEMENT_SUBTYPE_ID')
  if (envOverride) return envOverride

  if (cachedAnnouncementSubtypeId !== undefined) return cachedAnnouncementSubtypeId
  try {
    const url = `https://api.clickup.com/api/v3/workspaces/${teamId}/comments/types/post/subtypes`
    const res = await fetch(url, { headers: { Authorization: token } })
    const bodyText = await res.text()
    console.log('[getAnnouncementSubtypeId] status:', res.status)
    console.log('[getAnnouncementSubtypeId] body:', bodyText.slice(0, 500))

    if (!res.ok) {
      cachedAnnouncementSubtypeId = null
      return null
    }

    let parsed: unknown = null
    try { parsed = JSON.parse(bodyText) } catch { /* noop */ }

    // Try multiple response shapes: root array, { data }, { subtypes }
    const arr: Array<{ id: string; name: string }> = Array.isArray(parsed)
      ? parsed as Array<{ id: string; name: string }>
      : Array.isArray((parsed as { data?: unknown })?.data)
        ? (parsed as { data: Array<{ id: string; name: string }> }).data
        : Array.isArray((parsed as { subtypes?: unknown })?.subtypes)
          ? (parsed as { subtypes: Array<{ id: string; name: string }> }).subtypes
          : []

    console.log('[getAnnouncementSubtypeId] candidates:', arr.map(t => t.name).join(', '))
    const hit = arr.find(t => t.name?.toLowerCase() === 'announcement')
    cachedAnnouncementSubtypeId = hit?.id ?? null
    console.log('[getAnnouncementSubtypeId] resolved:', cachedAnnouncementSubtypeId)
  } catch (err) {
    console.error('[getAnnouncementSubtypeId] error:', err)
    cachedAnnouncementSubtypeId = null
  }
  return cachedAnnouncementSubtypeId
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const { channelId, comment, parentMessageId } = await req.json() as {
      channelId: string
      comment: CommentSegment[]
      parentMessageId?: string | null
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

    const isReply = Boolean(parentMessageId && teamId)

    // ── Build payload ─────────────────────────────────────────────────────────
    const payload: Record<string, unknown> = {
      comment,
      notify_all: true,
    }
    if (!isReply) {
      // Top-level post needs type=post + subtype for announcement formatting
      payload.type = 'post'
      if (subtypeId) payload.subtype_id = subtypeId
    }

    console.log('[send-clickup-message] channelId:', channelId)
    console.log('[send-clickup-message] parentMessageId:', parentMessageId ?? 'none (top-level)')
    console.log('[send-clickup-message] isReply:', isReply)
    console.log('[send-clickup-message] segments:', comment.length)

    // ── POST to ClickUp ───────────────────────────────────────────────────────
    // Top-level: v2 channel comment endpoint
    // Reply:     v3 workspaces/chat/messages/{id}/replies endpoint
    const clickupUrl = isReply
      ? `https://api.clickup.com/api/v3/workspaces/${teamId}/chat/messages/${parentMessageId}/replies`
      : `https://api.clickup.com/api/v2/view/${channelId}/comment`

    console.log('[send-clickup-message] POST →', clickupUrl)

    const clickupRes = await fetch(clickupUrl, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const body = await clickupRes.text()
    console.log('[send-clickup-message] ClickUp status:', clickupRes.status)
    console.log('[send-clickup-message] ClickUp body:', body)

    if (!clickupRes.ok) {
      return new Response(
        JSON.stringify({ error: `ClickUp API ${clickupRes.status}: ${body}` }),
        { status: clickupRes.status, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const data = JSON.parse(body) as { id?: string | number; data?: { id?: string | number } }
    // v2 returns { id }, v3 reply returns { data: { id } } — handle both
    const raw = data.id ?? data.data?.id
    const messageId = raw != null ? String(raw) : null

    // ── Build thread URL ──────────────────────────────────────────────────────
    // For a reply, the thread URL should still point at the ROOT message (parentMessageId)
    // so readers land in the same conversation. For a top-level post, it's the new messageId.
    let threadUrl: string | null = null
    if (teamId) {
      const threadId = isReply ? parentMessageId : messageId
      threadUrl = threadId
        ? `https://app.clickup.com/${teamId}/chat/r/${channelId}/t/${threadId}`
        : `https://app.clickup.com/${teamId}/chat/r/${channelId}`
    }

    console.log('[send-clickup-message] threadUrl:', threadUrl)

    return new Response(
      JSON.stringify({ id: messageId, threadUrl, isReply }),
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
