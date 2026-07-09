/**
 * One-time setup script — registers the ClickUp webhook for sms-sermon-recap.
 * Run once after deploying to production:
 *
 *   CLICKUP_MILESTONE_API_TOKEN=... APP_URL=https://your-app.vercel.app npx ts-node scripts/register-clickup-webhook.ts
 *
 * What it does:
 *   Tells ClickUp to POST to /api/webhooks/clickup-srp whenever a task
 *   gets the sms-sermon-recap tag. Only needs to run once — ClickUp
 *   persists the webhook until explicitly deleted.
 */

const TEAM_ID     = '1235435'
const token       = process.env.CLICKUP_MILESTONE_API_TOKEN
const appUrl      = process.env.APP_URL
const secret      = process.env.CLICKUP_SRP_WEBHOOK_SECRET

if (!token)  { console.error('Missing CLICKUP_MILESTONE_API_TOKEN'); process.exit(1) }
if (!appUrl) { console.error('Missing APP_URL (e.g. https://your-app.vercel.app)'); process.exit(1) }

async function main() {
  const endpoint = `${appUrl}/api/webhooks/clickup-srp`

  console.log(`Registering ClickUp webhook → ${endpoint}`)

  const res = await fetch(`https://api.clickup.com/api/v2/team/${TEAM_ID}/webhook`, {
    method: 'POST',
    headers: {
      Authorization: token!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      endpoint,
      events: ['taskTagUpdated', 'taskCommentPosted'],
      ...(secret ? { secret } : {}),
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('ClickUp API error:', JSON.stringify(data, null, 2))
    process.exit(1)
  }

  console.log('✓ Webhook registered successfully')
  console.log('  Webhook ID:', data.webhook?.id)
  console.log('  Endpoint:  ', endpoint)
  console.log('  Events:    ', data.webhook?.events?.join(', '))
  console.log()
  console.log('Save the Webhook ID — you will need it if you ever want to delete or update the webhook.')
}

main().catch(e => { console.error(e); process.exit(1) })
