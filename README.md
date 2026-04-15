# Milestone Communications App

Internal tool for Church Media Squad staff to submit partner milestone updates, send templated ClickUp chat messages, and track project progress across Brand, Web, and Social accounts.

## What it does

- **Submit milestones** — 7-step form: select partner → pick milestone → confirm sequence → select contact → draft message from template → attach assets → review and send
- **Send to ClickUp** — posts the rendered message to the partner's ClickUp chat channel via API v3
- **Template editor** — admin interface to create and edit message templates per milestone with merge field support
- **Account log** — internal view of all milestone submissions for a specific partner (`/account/:memberId`)
- **Bulk dashboard** — sortable, filterable table of all partners and their latest milestone status (`/dashboard`)
- **Client portal** — public partner-facing progress timeline at `/portal/:memberId` (no login required)

## Local setup

### 1. Clone and install

```bash
git clone <repo-url>
cd milestone-comms-app
npm install
```

### 2. Environment variables

Create a `.env.local` file in the project root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_CLICKUP_API_TOKEN=your-clickup-token
# Dev only — set to true to skip Supabase Auth during local development
VITE_DEV_BYPASS_AUTH=true
```

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API |
| `VITE_CLICKUP_API_TOKEN` | ClickUp → Settings → Apps → API Token |

> `.env` and `.env.*` are in `.gitignore`. Never commit secrets.

### 3. Supabase setup

Run the schema SQL in your Supabase project's SQL editor:

```
schema/milestone_comms_schema.sql
```

This creates 4 tables: `strategy_milestone_definitions`, `strategy_message_templates`, `strategy_milestone_submissions`, `strategy_submission_assets`.

Then add RLS policies so the app can read and write:

```sql
-- Milestone definitions (read)
CREATE POLICY "read milestone definitions" ON strategy_milestone_definitions
FOR SELECT TO anon, authenticated USING (true);

-- Message templates (read + write)
CREATE POLICY "read templates" ON strategy_message_templates
FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert templates" ON strategy_message_templates
FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update templates" ON strategy_message_templates
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Submissions (read + write)
CREATE POLICY "insert submissions" ON strategy_milestone_submissions
FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "read submissions" ON strategy_milestone_submissions
FOR SELECT TO anon, authenticated USING (true);

-- Assets (read + write)
CREATE POLICY "insert assets" ON strategy_submission_assets
FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "read assets" ON strategy_submission_assets
FOR SELECT TO anon, authenticated USING (true);
```

The app uses existing read-only tables (`strategy_account_progress`, `clickup_chat_channels`, `clickup_users`) — RLS policies for those are managed separately.

### 4. Run locally

```bash
npm run dev
```

App runs at `http://localhost:5173`. With `VITE_DEV_BYPASS_AUTH=true` you can use the full app without configuring Supabase Auth users.

## Deploying to Vercel

1. Push the repo to GitHub
2. Import the project at [vercel.com/new](https://vercel.com/new) — Vercel auto-detects Vite
3. Add environment variables in Vercel project Settings → Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_CLICKUP_API_TOKEN`
   - **Do not** add `VITE_DEV_BYPASS_AUTH` in production
4. Deploy

The `vercel.json` in the project root handles SPA client-side routing.

## Tech stack

- **React 18 + TypeScript + Vite** — frontend
- **Tailwind CSS** — styling
- **Supabase** — Postgres database + Auth
- **ClickUp API v3** — chat message delivery
- **Vercel** — hosting

## Project structure

```
src/
  components/submit/   # 7-step submission form components (Step1–Step7)
  contexts/            # Supabase Auth context (AuthContext.tsx)
  lib/                 # supabase client, ClickUp API, merge field resolver
  pages/               # Route-level pages
  types/               # TypeScript types matching Supabase schema
schema/                # SQL schema for Supabase table creation
public/brand/          # Church Media Squad SVG brand assets
vercel.json            # SPA routing rewrite rule
```
