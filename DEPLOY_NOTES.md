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

## 3. Then merge the PR

Once the secrets and functions are deployed, merge `amber/social-intel` → `main` and Vercel will auto-deploy the frontend.

---

## What this branch adds

- `/social` — Social Dashboard: all churches in a searchable grid with Intel + SRP status badges
- `/social/:memberId` — Social Church Hub: Intel, SRP Generator, and Calendar (coming soon) tabs per church
- **AI Update** — describe a change in plain English and Claude surgically updates only the relevant fields in the intel profile
- Inline profile editing before/after save
- Saved profiles list with version history and audit trail
