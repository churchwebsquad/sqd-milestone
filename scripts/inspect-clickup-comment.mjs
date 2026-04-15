/**
 * Diagnostic: dumps the raw structure of the first few comments
 * in the channel for the most recent active submission.
 *
 * Run with:  node scripts/inspect-clickup-comment.mjs
 *
 * Look at the output to identify what field links a reply back
 * to its parent message (parent, parent_id, thread_id, etc.)
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  } catch { }
}
loadEnv('.env.local')
loadEnv('.env')

const supabaseUrl  = process.env.VITE_SUPABASE_URL
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
const clickupToken = process.env.CLICKUP_MILESTONE_API_TOKEN

if (!supabaseUrl || !serviceKey || !clickupToken) {
  console.error('Missing env vars — check .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

// Grab the most recent submission that has a ClickUp message ID
const { data } = await supabase
  .from('strategy_milestone_submissions')
  .select('id, clickup_channel_id, clickup_message_id, submitted_at')
  .not('clickup_message_id', 'is', null)
  .order('submitted_at', { ascending: false })
  .limit(1)

const sub = data?.[0]
if (!sub) { console.error('No submissions with a ClickUp message ID found.'); process.exit(1) }

console.log('Submission:', sub.id)
console.log('Channel:   ', sub.clickup_channel_id)
console.log('Message ID:', sub.clickup_message_id)
console.log()

// ── Approach 1: v2 view comments (what we've been using) ─────────────────────
console.log('══ v2 GET /api/v2/view/{channelId}/comment ══')
const v2Res = await fetch(
  `https://api.clickup.com/api/v2/view/${sub.clickup_channel_id}/comment`,
  { headers: { Authorization: clickupToken } }
)
if (!v2Res.ok) {
  console.log('Status:', v2Res.status, await v2Res.text())
} else {
  const v2Body = await v2Res.json()
  const comments = v2Body.comments ?? []
  console.log(`Total comments in channel: ${comments.length}`)
  console.log('\nFirst 3 comments — ALL FIELDS:\n')
  for (const c of comments.slice(0, 3)) {
    console.log(JSON.stringify(c, null, 2))
    console.log('---')
  }
}

// ── Approach 2: v3 workspace-scoped message replies ───────────────────────────
console.log('\n══ Fetching team ID ══')
const teamRes = await fetch('https://api.clickup.com/api/v2/team', { headers: { Authorization: clickupToken } })
const teamBody = await teamRes.json()
const teamId = teamBody.teams?.[0]?.id
console.log('Team ID:', teamId)

if (teamId) {
  // Try the workspace-scoped v3 replies endpoint
  const v3Url = `https://api.clickup.com/api/v3/workspaces/${teamId}/chat/messages/${sub.clickup_message_id}/replies`
  console.log(`\n══ v3 GET ${v3Url} ══`)
  const v3Res = await fetch(v3Url, { headers: { Authorization: clickupToken } })
  console.log('Status:', v3Res.status)
  if (v3Res.ok) {
    const v3Body = await v3Res.json()
    console.log(JSON.stringify(v3Body, null, 2))
  } else {
    console.log(await v3Res.text())
  }

  // Also try the channel messages listing
  const v3ChanUrl = `https://api.clickup.com/api/v3/workspaces/${teamId}/chat/channels/${sub.clickup_channel_id}/messages`
  console.log(`\n══ v3 GET ${v3ChanUrl} ══`)
  const v3ChanRes = await fetch(v3ChanUrl, { headers: { Authorization: clickupToken } })
  console.log('Status:', v3ChanRes.status)
  if (v3ChanRes.ok) {
    const v3ChanBody = await v3ChanRes.json()
    // Just show the first message's fields to see structure
    const msgs = v3ChanBody.messages ?? v3ChanBody.data ?? v3ChanBody
    const first = Array.isArray(msgs) ? msgs[0] : null
    if (first) {
      console.log('First message structure:')
      console.log(JSON.stringify(first, null, 2))
    } else {
      console.log(JSON.stringify(v3ChanBody, null, 2))
    }
  } else {
    console.log(await v3ChanRes.text())
  }
}
