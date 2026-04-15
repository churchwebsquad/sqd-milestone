/**
 * One-shot manual scrub — mirrors api/cron/scrub-replies.ts logic.
 * Run with:  node scripts/test-scrub.mjs
 *
 * Uses GET /api/v3/workspaces/{teamId}/chat/messages/{messageId}/replies
 * to fetch only thread replies to each specific milestone message.
 * Author identity resolved via the clickup_users Supabase table.
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Load env ──────────────────────────────────────────────────────────────────

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
  const missing = [
    !supabaseUrl  && 'VITE_SUPABASE_URL',
    !serviceKey   && 'SUPABASE_SERVICE_ROLE_KEY',
    !clickupToken && 'CLICKUP_MILESTONE_API_TOKEN',
  ].filter(Boolean)
  console.error('❌  Missing env vars:', missing.join(', '))
  process.exit(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise(r => setTimeout(r, ms))

async function fetchAllReplies(teamId, messageId) {
  const all = []
  let cursor = ''
  do {
    const url = new URL(`https://api.clickup.com/api/v3/workspaces/${teamId}/chat/messages/${messageId}/replies`)
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url.toString(), { headers: { Authorization: clickupToken } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ClickUp ${res.status}: ${text}`)
    }
    const body = await res.json()
    all.push(...(body.data ?? []))
    cursor = body.next_cursor ?? ''
  } while (cursor)
  return all
}

// ── Main ──────────────────────────────────────────────────────────────────────

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

// Fetch team ID
const teamRes = await fetch('https://api.clickup.com/api/v2/team', { headers: { Authorization: clickupToken } })
const teamBody = await teamRes.json()
const teamId = teamBody.teams?.[0]?.id
if (!teamId) { console.error('❌  Could not resolve ClickUp team ID'); process.exit(1) }
console.log(`🏢  Team ID: ${teamId}`)

// Fetch active submissions
console.log('🔍  Fetching active submissions (sent / waiting_on_partner)…\n')
const { data: subData, error: fetchErr } = await supabase
  .from('strategy_milestone_submissions')
  .select('id, clickup_channel_id, clickup_message_id, milestone_status')
  .in('milestone_status', ['sent', 'waiting_on_partner'])
  .not('clickup_channel_id', 'is', null)
  .not('clickup_message_id', 'is', null)

if (fetchErr) { console.error('❌  Supabase error:', fetchErr.message); process.exit(1) }

const active = subData ?? []
console.log(`📋  ${active.length} active submission(s)\n`)

let repliesInserted = 0
let statusesUpdated = 0
let errors = 0

for (const sub of active) {
  console.log(`─── ${sub.id.slice(0, 8)}…  status=${sub.milestone_status}`)
  console.log(`    channel=${sub.clickup_channel_id}  msg=${sub.clickup_message_id}`)

  try {
    const replies = await fetchAllReplies(teamId, sub.clickup_message_id)
    console.log(`    💬  ${replies.length} thread reply/replies`)

    if (replies.length === 0) { await delay(200); continue }

    // Resolve author details from clickup_users
    const userIds = [...new Set(replies.map(r => Number(r.user_id)).filter(Boolean))]
    const { data: userRows } = await supabase
      .from('clickup_users')
      .select('clickup_id, username, email, employee')
      .in('clickup_id', userIds)

    const userMap = new Map()
    for (const u of userRows ?? []) userMap.set(u.clickup_id, u)

    // Load existing IDs to skip duplicates
    const { data: existingRows } = await supabase
      .from('strategy_milestone_replies')
      .select('clickup_reply_id')
      .eq('submission_id', sub.id)
      .not('clickup_reply_id', 'is', null)

    const existingIds = new Set((existingRows ?? []).map(r => r.clickup_reply_id).filter(Boolean))

    let hasNewPartnerReply = false

    for (const reply of replies) {
      const replyId = String(reply.id)
      if (existingIds.has(replyId)) {
        console.log(`    ↩️  Already stored: ${replyId}`)
        continue
      }

      const userId    = Number(reply.user_id)
      const userData  = userMap.get(userId)
      const authorName  = userData?.username ?? `User ${userId}`
      const authorEmail = userData?.email ?? null
      // Staff if: employee field is set OR email contains @churchmediasquad.com
      const isPartner   = !userData?.employee &&
        !userData?.email?.toLowerCase().includes('@churchmediasquad.com')

      const ts = reply.date ?? reply.date_assigned
      const detectedAt = ts ? new Date(ts).toISOString() : new Date().toISOString()

      console.log(`    ➕  [${isPartner ? 'PARTNER' : 'staff  '}] ${authorName}: "${(reply.content ?? '').slice(0, 80)}"`)

      const { error: insertErr } = await supabase
        .from('strategy_milestone_replies')
        .insert({
          submission_id:      sub.id,
          reply_text:         reply.content ?? '',
          reply_author_name:  authorName,
          reply_author_email: authorEmail,
          is_partner_reply:   isPartner,
          triage_category:    null,
          source:             'clickup_thread',
          detected_at:        detectedAt,
          clickup_reply_id:   replyId,
        })

      if (insertErr) {
        console.warn(`    ❌  Insert failed: ${insertErr.message}`)
      } else {
        repliesInserted++
        if (isPartner) hasNewPartnerReply = true
      }
    }

    if (hasNewPartnerReply) {
      const { error: updateErr } = await supabase
        .from('strategy_milestone_submissions')
        .update({ milestone_status: 'partner_replied' })
        .eq('id', sub.id)
        .in('milestone_status', ['sent', 'waiting_on_partner'])

      if (updateErr) {
        console.warn(`    ❌  Status update failed: ${updateErr.message}`)
      } else {
        statusesUpdated++
        console.log(`    ✅  milestone_status → partner_replied`)
      }
    }
  } catch (err) {
    console.error(`    ❌  ${err.message}`)
    errors++
  }

  console.log()
  await delay(200)
}

console.log('══════════════════════════════')
console.log(`✅  Done`)
console.log(`    Submissions processed : ${active.length}`)
console.log(`    Replies inserted      : ${repliesInserted}`)
console.log(`    Statuses updated      : ${statusesUpdated}`)
console.log(`    Errors                : ${errors}`)
