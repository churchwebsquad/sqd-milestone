# Deploy Notes — Social Intel Update (amber/social-intel branch)

Before merging this branch, Ashley needs to complete the following Supabase steps.

---

## 1. Add the Anthropic API Key secret

The new `social-intel-update` edge function calls Claude directly and requires this secret:

```
npx supabase secrets set ANTHROPIC_API_KEY=<the key> --project-ref wttgwoxlezqoyzmesekt
```

The key is in 1Password under **"Anthropic API Key — Milestone App"** (or ask Amber).

---

## 2. Deploy both edge functions

```bash
npx supabase functions deploy social-intel-generate --project-ref wttgwoxlezqoyzmesekt
npx supabase functions deploy social-intel-update --project-ref wttgwoxlezqoyzmesekt
```

Both function files are already in the repo at:
- `supabase/functions/social-intel-generate/index.ts`
- `supabase/functions/social-intel-update/index.ts`

---

## 3. Run the database migration

```bash
npx supabase db push --project-ref wttgwoxlezqoyzmesekt
```

Or run `schema/v82_srp_auto_jobs.sql` manually in the Supabase SQL editor.

---

## 4. Add the ClickUp SRP webhook secret (optional but recommended)

Generate any random string and set it as a Vercel environment variable:

```
CLICKUP_SRP_WEBHOOK_SECRET=<random string>
```

This lets the webhook receiver verify requests actually come from ClickUp.

---

## 5. Register the ClickUp webhook (one-time, run after Vercel deploy is live)

```bash
CLICKUP_MILESTONE_API_TOKEN=<token> \
APP_URL=https://<your-vercel-url> \
CLICKUP_SRP_WEBHOOK_SECRET=<same secret from step 4> \
npx ts-node scripts/register-clickup-webhook.ts
```

**Save the Webhook ID** printed in the output — needed if you ever want to remove it.

From this point on, every time a church gets the `sms-sermon-recap` tag in ClickUp, the app automatically finds the sermon video and starts transcription in the background.

---

## 6. Then merge the PR

Once the secrets and functions are deployed, merge `amber/social-intel` → `main` and Vercel will auto-deploy the frontend.

---

## What this branch adds

- `/social` — Social Dashboard: all churches in a searchable grid with Intel + SRP status badges
- `/social/:memberId` — Social Church Hub: Intel, SRP Generator, and Calendar (coming soon) tabs per church
- **AI Update** — describe a change in plain English and Claude surgically updates only the relevant fields in the intel profile
- Inline profile editing before/after save
- Saved profiles list with version history and audit trail
