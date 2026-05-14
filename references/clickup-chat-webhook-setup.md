# ClickUp Chat Webhook — setup guide

Replaces the daily cron polling for new replies with a real-time push
from ClickUp. ClickUp's v2 webhook API doesn't cover v3 Chat, so we
use their Chat Automation Builder instead. Setup is per-channel.

## What this does

1. ClickUp fires when any message is posted in a configured channel
2. POSTs to `https://strategy-milestone-comms.vercel.app/api/webhook/clickup-chat-message?comment_id=...&channel_id=...`
3. Our endpoint verifies the Authorization header
4. Looks up active submissions in that channel
5. Runs a targeted scrub (reuses the same logic as the cron and the
   manual "Refresh replies" button — same dedupe, same status updates)

The daily cron at `/api/cron/scrub-replies` stays as a backstop —
catches anything the webhook misses.

## One-time prep

### 1. Generate a webhook secret

Pick any random string. 32+ chars, no quotes or backslashes. Example:

```
clickup_chat_wh_8f3a9c2b1e4d6f7g0h2i4j6k8l0m2n4o6p
```

**Important:** ClickUp says "Once they're saved, you can't view the
header values to edit them." Save this somewhere durable before
moving on. If you lose it, recreate the webhook in ClickUp.

### 2. Add the secret to Vercel

Project → Settings → Environment Variables → Add:

- Key: `CLICKUP_WEBHOOK_SECRET`
- Value: (the secret you generated)
- Environments: Production, Preview (skip Development unless testing
  locally via vercel dev)

Save. Vercel will trigger a redeploy.

## Per-channel setup in ClickUp

Repeat this for every partner channel you want push-tracked.

### 1. Open the channel

Click the partner's milestone Chat channel in ClickUp.

### 2. Open the Automation builder

- Upper-right corner of the channel → **Automate** button (or the
  lightning bolt icon)
- Click **Create Automation**

### 3. Configure the Trigger

- **When:** Message is posted

(That's the only Chat trigger ClickUp exposes.)

### 4. Configure the Action

- **Action:** Call webhook
- **Select webhook:** Create webhook (first time) OR pick the existing
  one if you already made it on a previous channel

#### First time only — create the webhook

- **Name:** `Milestone Replies Push` (anything you'll recognize)
- **Description:** (optional) "Pushes chat messages to the milestone
  comms app for reply ingestion."
- **URL:** `https://strategy-milestone-comms.vercel.app/api/webhook/clickup-chat-message`
- **Dynamic fields to include in URL:**
  - ✅ Comment ID
  - ✅ Channel ID
  - (URL becomes `.../api/webhook/clickup-chat-message?comment_id={comment_id}&channel_id={channel_id}` — ClickUp adds the values at fire time)
- **Custom headers:**
  - Click **Add**
  - **Key:** `Authorization`
  - **Value:** (the secret you generated in step 1 above)
- **Custom URL parameters:** none needed (the dynamic fields cover it)
- Click **Create webhook**

#### Subsequent channels

After the webhook is created on the first channel, you can pick it
from the dropdown on every subsequent channel — no need to re-enter
the URL or header.

### 5. Test the webhook

- In the Automation modal, click the caret in the upper-left
- Click **Test**
- Expected result: "Success" message in ClickUp + a log entry in
  Vercel function logs (`[clickup-chat-message] received: channel=...
  comment=...`)

If the test fails, check:
- The endpoint URL is exact (typo will fail)
- The Authorization value matches what's in Vercel env
- Vercel deploy is current (the function exists)

### 6. Activate the Automation

- Back in the Automation modal, click the **Manage** tab
- Click **Add Automation**
- Trigger: Message is posted
- Action: Call webhook → pick `Milestone Replies Push`
- Click **Create**

Done — the channel is now push-tracked.

## Verifying it works end-to-end

1. Send a milestone message to the partner via the milestone comms app
   (one of the normal flow buttons)
2. Have someone reply in the ClickUp channel thread (use a test
   account if you don't want to bother the partner)
3. Within ~5 seconds, the reply should appear in
   `strategy_milestone_replies` and the submission's `milestone_status`
   flips to `partner_replied` (if the replier is a partner)
4. Check Vercel function logs for `[clickup-chat-message] done` with
   the summary object — `replies_inserted: 1` confirms the path

If nothing happens, check:
- Vercel function logs for any 401 / 500 errors
- ClickUp Automations → Activity tab for the webhook call status
  (ClickUp retries for 1h15m if our endpoint returns non-2xx)

## Coexistence with the cron

The daily cron stays running at 3pm ET. Its dedupe-by-`clickup_reply_id`
guarantees the webhook + cron won't double-insert. As webhook coverage
expands and proves reliable, the cron can drop to weekly (or weekend-
only) for reconciliation.

## Rolling out

Suggested order:

1. Set up on one test channel (you, a CMS staff channel, or a partner
   you've coordinated with). Verify end-to-end.
2. Roll out to 5–10 channels of active partners. Watch for a week.
3. Roll out to all remaining active channels.
4. Drop cron frequency from daily to weekly.

If you want to automate channel rollout, ClickUp's v2 API has an
automation-creation endpoint — worth checking the docs to see if it
supports Chat Automations specifically. Manual setup is fine for the
first dozen.

## What the endpoint does (for reference)

`/api/webhook/clickup-chat-message`:
- Method: POST (also accepts GET for test compatibility)
- Auth: Authorization header equal to `CLICKUP_WEBHOOK_SECRET`
- Query params: `comment_id`, `channel_id`
- Response: 200 with summary object on success; 401 on auth fail;
  500 on env/DB error
- Idempotent — duplicate calls won't double-insert (dedupe by
  `clickup_reply_id`)
- Logs everything to Vercel function logs for debugging
