# Milestone Communications App — CLAUDE.md

## Project Overview
This is an internal tool for Church Media Squad (CMS) that allows staff to submit partner milestones, send templated ClickUp chat messages, log assets, and provide a partner-facing progress portal. It replaces manual communication workflows for the Brand, Web, and Social squads.

## Tech Stack
- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Backend/Database:** Supabase (Postgres + Auth + Edge Functions)
- **Hosting:** Vercel (free tier)
- **External API:** ClickUp API v3 (for sending chat messages)

## Supabase Context
The app connects to an existing Supabase project that already has these tables:
- `strategy_account_progress` — partner data, keyed on `member` (numeric). `css_rep` field = account manager name.
- `clickup_chat_channels` — ClickUp channel IDs, keyed on `id` (text), `memberid` maps to partner member number.
- `clickup_users` — staff and partner contacts. `clickup_id` (bigint), `email`, `username`, `account_id` links contacts to partner accounts, `employee` field (not null = staff).
- `prf_brand_guides` — brand guides per account.

The app creates 4 new tables (all prefixed `strategy_`):
- `strategy_milestone_definitions` — master milestone reference per squad/pathway/step
- `strategy_message_templates` — admin-editable templates tied to milestones
- `strategy_milestone_submissions` — transaction log of every milestone submitted
- `strategy_submission_assets` — tagged asset links per submission

Schema SQL is in `/schema/milestone_comms_schema.sql`.

## App Surfaces (7 views)
1. **Login** — Supabase Auth, staff only (clickup_users where employee IS NOT NULL)
2. **Milestone Submission Form** — the core workflow (select partner → select milestone → draft message → attach assets → submit)
3. **On Submit** — sends ClickUp chat message via API, logs everything to Supabase
4. **Client Portal** — partner-facing timeline with "you are here" marker (read-only, accessed via shareable link)
5. **Template Editor** — admin backend for editing message templates per milestone
6. **Account Milestone Log** — internal view of all submissions for a specific partner
7. **Bulk Dashboard** — bird's-eye view of all partners and their milestone status

## Milestone Structure
- Brand (New Brand): 5 steps — Mood Boards → Identity Design & Presentation → Brand Guide → Deliverables → Handoff
- Brand (Existing Brand): 3 steps — Brand Guide → Deliverables → Handoff
- Brand (Ministry Subbrand): 3 steps
- Web (Redesign): 10 steps — Onboard & Content Collection → Strategy Phase → Review: Website Strategy → Copywriting Phase → Review: Copywriting → Design Phase → Review: Website Design → Build Phase → Review: Final Website → Site Launch
- Web (Audit): 4 steps
- Social: TBD

## Message Template Merge Fields
Templates support these merge fields:
- `{{church_name}}` — from strategy_account_progress.church_name
- `{{first_name_of_primary}}` — from strategy_account_progress.first_name_of_primary
- `{{step_name}}` — from strategy_milestone_definitions.step_name
- `{{section_group}}` — from strategy_milestone_definitions.section_group
- `{{submitter_name}}` — from the logged-in staff member
- `{{account_manager}}` — from strategy_account_progress.css_rep
- `{{partner_contact_name}}` — the contact @'d in the message
- `{{asset_links}}` — auto-generated from submission_assets
- `{{next_step_name}}` — from the confirmed "next up" milestone

All messages should include a standard footer:
"If you have questions or additional feedback, feel free to tag {{submitter_name}} or your account manager {{account_manager}}."

## V1 Message Delivery
Messages send from the workspace-authenticated ClickUp connection (not per-user). The submitter and AM are referenced by name in the message body, not as the sender.

## ClickUp API
- Send messages: POST to `/api/v3/chat/{channel_id}/message` with `content` (markdown supported)
- Channel lookup: query `clickup_chat_channels` WHERE `memberid` = partner member number
- Contact lookup: query `clickup_users` WHERE `account_id` = partner member number

## Visual Design Direction

The app must follow the Church Media Squad brand system. Brand assets (SVG logos) are in `/public/brand/`.

### Logo Files
- `Style=Primary.svg` — primary horizontal wordmark, use in sidebar header and login page
- `Style=Circle Badge Filled.svg` — circle badge, use as favicon and compact logo
- `Style=Creative Badge.svg` — creative badge variant, optional accent use

### Color Palette (exact values, do not approximate)
| Token | Hex | Usage |
|-------|-----|-------|
| Primary Purple | `#513DE5` | Accent color — active nav items, progress indicators, eyebrow labels, links |
| Deep Plum | `#341756` | Headlines, body text, sidebar background, primary buttons |
| Lavender | `#CFC9F8` | Card borders, hover states, subtle fills, light accent |
| Lavender Tint | `#EDE9FC` | Callout backgrounds, selected states, hover fills |
| Cream | `#F9F5F1` | Page background — the default canvas (NOT white) |
| White | `#FFFFFF` | Card surfaces, elevated elements above Cream canvas |
| Purple Mid | `#6B5CE7` | Button hover states on Primary Purple elements |
| Purple Gray | `#6B6180` | Muted/secondary text (never use raw grays) |

**Never use pure black (#000000).** Always Deep Plum for text.
**Never use raw grays.** Tint all grays toward purple.
**Cream is the default page background**, not white. White is for cards/elevated elements.

### Dark Hero Gradient (login page, portal header)
```css
background: linear-gradient(135deg, #341756 0%, #513DE5 100%);
```

### Light Wash Gradient (section backgrounds)
```css
background: linear-gradient(135deg, #CFC9F8 0%, #F9F5F1 50%, #FFF5EE 100%);
```

### Typography
- **Headlines:** Georgia or serif with italic emphasis on emotional words (brand signature)
- **Body / UI:** Inter, 'Segoe UI', Arial, sans-serif
- **Eyebrow labels:** Uppercase, letter-spacing 0.08-0.12em, colored Primary Purple
- **Body text:** Always Deep Plum, never black
- **No light/thin font weights** (300 or below) — brand voice is confident

### Components
- **Buttons:** Always pill-shaped (border-radius: 999px), never squared. Primary = Deep Plum fill. Include arrow icon (→) on CTAs.
- **Cards:** White background, Lavender border (1-2px), rounded corners (12-16px), subtle shadow
- **Active/selected states:** Lavender Tint background with Primary Purple left border or text
- **Progress indicators/timeline:** Primary Purple for completed, Lavender for upcoming, Deep Plum for current "you are here"

### Responsive Design
- All layouts must be fully responsive (mobile-first with Tailwind breakpoints)
- Sidebar collapses to a top nav or hamburger on mobile
- Submission form stacks vertically on small screens
- Client portal must look excellent on mobile (partners will view on phones)
- Dashboard table becomes a card layout on mobile

## Code Style
- Use functional React components with hooks
- Use TypeScript strict mode
- Keep components small and focused (one file per component)
- Use Supabase client library (@supabase/supabase-js) for all DB operations
- Environment variables for Supabase URL, anon key, and ClickUp API token
- No inline styles — use Tailwind classes only
- Error handling on all API calls with user-friendly messages

## File Structure
```
src/
  components/     # Reusable UI components
  pages/          # Route-level page components (Login, SubmitForm, ClientPortal, TemplateEditor, AccountLog, Dashboard)
  hooks/          # Custom React hooks (usePartner, useMilestones, useTemplates, useSubmit)
  lib/            # Supabase client, ClickUp API client, merge field resolver
  types/          # TypeScript type definitions matching Supabase table schemas
schema/           # SQL files for Supabase table creation
```

## Important Rules
- NEVER hardcode Supabase credentials or ClickUp API tokens. Use .env files.
- NEVER modify existing Supabase tables (strategy_account_progress, clickup_chat_channels, clickup_users, prf_brand_guides). Only READ from them.
- **Before creating a NEW table, first respond with an analysis of whether existing tables could be extended via new columns.** New tables ARE permitted, but the schema has grown large enough that net-new tables need deliberation, not assumption. Format: name the table you'd create + its purpose, then name 1-2 existing tables that could absorb the data via ADD COLUMN, with the trade-offs. Wait for explicit approval before applying CREATE TABLE.
- All new tables use the `strategy_` prefix.
- Follow existing Supabase patterns: uuid PKs, created_at/updated_at timestamps, is_active soft deletes.
- The client portal must be accessible without staff login (public shareable link with a token/member ID).
- Asset URLs must be validated as public-facing/sharable links.

## Director Access Levels (differentiated — read this before gating on Ashley)

The Important Rules above are the DEFAULT posture. Per-director access is not
uniform; each director has a different level of autonomy and Claude sessions
should adjust accordingly.

### Amber (Social Media Director, @amberpankey, amber@churchmediasquad.com)
Full-stack access as of 2026-07-09. Supabase admin, GitHub write with
self-merge to `main` after CI passes, Vercel access, `.env` values.
**The "before creating a new table" and "before altering a table" rules
above do NOT gate her work.** She uses her judgment, follows the
schema-guard CI check that runs on every PR, and ships. When a Claude
session is helping Amber:
- Don't tell her to "wait for Ashley's approval" on tables, migrations, or
  foundational changes.
- Don't route her through the "Request a table" issue template.
- Don't require her to file a change proposal before altering schema.
- She authors, she reviews her own PR, she merges. Ashley reviews later
  if she wants context; not a merge gate.
- The dependency-audit-before-table-changes guidance still applies as
  good practice (skim `information_schema` for dependents, fix them in
  the same PR) — but nothing external gates the PR.

### Spencer (Branding Director, @cms-spencer, spencer@churchmediasquad.com)
Works under the default Important Rules above. Newer to AI-collab dev; the
default guardrails serve him well while he ramps. When a Claude session is
helping Spencer:
- Follow the "before creating a new table" cadence — propose in PR
  description, tag Ashley (or Amber during Ashley's absence) for a look
  before merging.
- Cross-domain changes (routes in `App.tsx`, shared scaffolding under
  `/schema/`, `/supabase/`, `/.github/`, `/scripts/`) get a normal PR review
  before merge.
- Sanity-check with Ashley or Amber before schema alterations.
- No self-merging PRs on foundational changes during his first few builds.

### Ashley (VP, @churchwebsquad, ashley@churchmediasquad.com)
Repo owner, unrestricted. On medical leave; Amber's expanded access covers
during her absence. Bennett is the human escalation for anything neither
director can resolve.

Downstream: whichever director's session is running, read the Important
Rules through the lens of THIS section. If unclear which director you're
helping, ask — the answer changes the guardrails.
