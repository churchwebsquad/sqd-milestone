# Strategy App — Social Media Squad Extension + CXOS Absorption Plan

**Author:** Ashley Fox (with Claude)
**Date:** April 17, 2026
**Status:** Draft v2 — reframed after adding Strategy Division + Japheth/CXOS context
**Supersedes:** v1 "Squad HQ" standalone-app plan

---

## 0. What changed from v1

The first draft of this plan proposed a brand-new standalone app called "Squad HQ" for Social Media Squad's unified tooling. That framing was wrong, and v2 corrects it. Three pieces of context reshape the whole approach:

The Social Media Squad is one of three squads inside the **Strategy Division** (alongside Brand Squad and Web Squad), under the larger Church Media Squad org that also runs a Creative Division (Graphics, Video) and a Customer Experience department.

A **Strategy Milestone Communications App** (`sqd-milestone-main`) already exists. It serves Brand and Web squads today with a milestone submission flow, template editor, partner portal, and ClickUp chat handoff. It has a placeholder — "Social: TBD" — deliberately reserved for Social's pathway. A **Strategy Journey Dashboard** (`lovable-strategy-notes-app`) handles account-level notes, quick links, and tri-view client browsing, and shares that same Strategy population.

Japheth, our Customer Experience Director, has a published absorption plan ("CXOS strategy app absorpotion plan.rtf" in this folder) that reframes both Strategy apps as **M26 — Strategy Squad Experience** inside the Customer Experience OS (CXOS). His plan locks in a Tier 1 / Tier 2 / Tier 3 framework for what gets absorbed into CXOS's data spine, what gets ported as a shared CXOS primitive, and what stays Strategy-specific.

So the correct shape is:

- **Phase 1 (Ashley-owned, now–June):** Extend the existing milestone comms app to absorb Social's workflows — SRP generator, Church Intel, and an eventual Planner module — sitting alongside Brand and Web as a peer. Fill in "Social: TBD" for real. Make it feel like a shared home.
- **Phase 2 (Japheth-owned, summer onward):** The expanded Strategy app is absorbed into CXOS as M26, surfacing primitives (contractor auth, OTP, tri-view, queue manager, partner portal, merge-field engine, ClickUp chat send, brand/skin multi-domain) as CXOS-native components that M27-M32 inherit from.

The thesis hasn't changed — Church Intel + SRP Generator + Planner is still the powerhouse content OS for Social. The **container** is what changed: it's not a new standalone app, it's a first-class Social presence inside the Strategy app we already own.

---

## 1. North star (revised)

One Strategy Division app — the existing milestone comms app, expanded — where a Brand strategist, a Web director, and a Social designer can each walk in Monday morning and see the work that's theirs, with the tools that are theirs, without feeling like a guest in someone else's house. Social's presence inside it runs the full content pipeline: **Church Intel** at the top (the missing context layer), **SRP Generator** in the middle (the weekly deliverable assembly line), **Planner** looking 6 weeks out (Planning Center + Google Calendar + upcoming opportunities), and **Analytics** closing the loop.

The powerhouse isn't a bigger generator. It's context-rich content ops sitting inside a shared Strategy home — Brand Squad sees their milestones and brand guides, Web Squad sees redesign + audit pathways and site progress, Social sees SRPs in flight and this week's schedule, and everyone inherits the same auth, the same client list, the same partner portal, the same template editor. When CXOS absorption lands, every one of those shared primitives graduates out of our app and into the org's master platform, making M27-M32 materially cheaper to build.

---

## 2. What already exists (the real inventory)

Three production surfaces sit under Ashley today. Any Phase 1 plan has to respect them all.

**Strategy Milestone Communications App — `sqd-milestone-main`.** React 19 + Vite + Supabase + ClickUp API v3. This is the skeleton we're extending.

- 7 app surfaces already built: Login (Slack/email OTP + contractor passcode), Milestone Submission Form (7-step), On-Submit ClickUp chat handoff, Client Portal (token/member-ID addressable), Template Editor, Account Milestone Log, Bulk Dashboard.
- Supabase tables — reads from existing `strategy_account_progress` (keyed on `member`), `clickup_chat_channels`, `clickup_users`, `prf_brand_guides`. Writes to four new `strategy_*` tables it owns: `strategy_milestone_definitions`, `strategy_message_templates`, `strategy_milestone_submissions`, `strategy_submission_assets`.
- Milestone structure already defined: Brand New (5 steps), Brand Existing (3), Ministry Subbrand (3), Web Redesign (10), Web Audit (4), **Social: TBD** — the gap this plan fills.
- Merge-field engine: `{{church_name}}, {{first_name_of_primary}}, {{step_name}}, {{section_group}}, {{submitter_name}}, {{account_manager}}, {{partner_contact_name}}, {{asset_links}}, {{next_step_name}}`.
- Brand tokens exact: Primary Purple `#513DE5`, Deep Plum `#341756`, Lavender `#CFC9F8`, Lavender Tint `#EDE9FC`, Cream `#F9F5F1`, Purple Mid `#6B5CE7`, Purple Gray `#6B6180`.
- Hard rules already in force: never hardcode secrets; never modify existing tables (read-only); all new tables carry the `strategy_` prefix; public portal is tokenized.

**Strategy Journey Dashboard — `lovable-strategy-notes-app`.** React 18 + Vite + shadcn + Supabase.

- Pages: `Index.tsx` (the big SPA), `Login.tsx`, `NotFound.tsx`.
- Components include `ClientCard`, `ClientDetailModal` (~80KB — the deep flyout), `ClientJourney`, `DashboardFilters`, `JourneyCard`, `JourneyColumnHeader`, `QueueManagerDialog`, `QuickViewList`, `NotesSection`, plus per-squad task boards (`ActiveBrandingTasks`, `ActiveWebsiteTasks`, `CarouselTemplateTasks`, `SermonRecapTasks`, `SermonTasks`).
- Tri-view pattern: cards / journey / quickview.
- 20 custom hooks including `useClients`, `useJourneyMilestones`, `useQueueManager`, `useSocialMediaEmployees`, `useActiveBrandingTasks`, `useActiveWebsiteTasks`.

**SRP Generator — `srp-generator-app`.** Vite + React 18 + shadcn + Supabase + React Query, Lovable-scaffolded.

- Routes `/login`, `/` (Dashboard), `/workflow`, `/workflow/:sessionId`, `/settings/prompts`.
- Workflow steps: `account → deliverables → sermon → clips → reelCaptions → carousel → facebook → sundayInvite → photoRecap → approved`.
- 12 edge functions: one per generator (caption, carousel, clips, FB post, photo recap, Sunday invite) plus support (fetch-sermon-submissions, fetch-squad-data, fetch-youtube-transcript, save-brand-voice, save-session, transcribe-sermon-file).
- Supabase tables: `sms_srp_generation` (weekly session record) and `prompt_settings` (admin-only prompts).
- Dashboard exports **Vista Social CSV** verbatim (columns `message,type,link,time,comment1,comments_enabled,instagram_publish_as,facebook_publish_as,title`; publish-as values `REELS | CAROUSEL | VIDEO | IMAGE`).
- Analytics dashboard is currently broken.

**Church Intel — `church-intel-export/church-intel.jsx`.** Amber's Claude artifact, 1171 lines, standalone today.

- Browser-side fetch to `api.anthropic.com` with `claude-sonnet-4-20250514`, `mcp_servers` pointing at Notion MCP, `web_search_20250305` tool, homepage screenshot as base64.
- Produces structured JSON profile (brand voice, audience, design, per-deliverable strategy, CTA patterns, upcoming opportunities, week-1 tip) and writes/updates to the master church DB `1f2e83f7-31f6-80d8-a7ea-db623db57a58`.
- Two modes: `new` (full generation) and `update` (scoped refresh).

The migration target is not a new app — it's folding the SRP Generator and Church Intel into the milestone comms app as Social-specific surfaces, and borrowing the tri-view + ClientDetailModal + QueueManagerDialog patterns from the Journey Dashboard so Social sees the same client shape Brand and Web already see.

---

## 3. Japheth's CXOS absorption — the Phase 2 constraint

Japheth's plan is the north beyond our north. It promotes the Strategy app to **M26 — Strategy Squad Experience**, which bumps downstream milestones by one slot (M27 Creative Director, M28 Sales, M29 Marketing, M30 PSR Dashboard & Google Workspace, M31 CXOS Inbox, M32 Director Workbench).

The tier framework he's using:

- **Tier 1 — Absorbed into CXOS data spine.** `account_progress`, `call_notes`, `documents`, `accounts`, `contacts`, `employees`. Our Strategy app stops owning these; it reads from CXOS views.
- **Tier 2 — Ported as CXOS-native primitives.** Contractor passcode auth, Slack/email OTP, tri-view layout, Queue Manager, ClientDetailModal, batch milestone status, merge-field engine, ClickUp chat send, partner portal, brand/skin multi-domain. These graduate into shared CXOS infrastructure so M27-M32 inherit instead of reinventing.
- **Tier 3 — Strategy-scoped, stays local.** Milestone definitions per path, sermon recap workflow, carousel templates, brand guides, discovery forms. This is where Church Intel + SRP Generator naturally live.

His proposed M26 phases are sequenced so Tier 1 data cutover happens before UI moves, primitives generalize in parallel with Logic Engine (M21) completion, and the partner portal lands as the first external CXOS surface alongside M25 Chat Engine. The full AirTable phaseout (39 tables) lags at Phase 7, and the legacy app retirement is Phase 8.

**Two implications for our Phase 1 work:**

First, **don't build anything now that will fight CXOS later.** Every time we reach for auth, tri-view, queue manager, partner portal, merge fields, ClickUp chat send, or multi-domain branding, we're touching a Tier 2 primitive. We use what's already in the milestone comms app (most of these exist), we don't build a parallel version, and when we add Social surfaces we hook into those primitives rather than forking them.

Second, **everything Social adds is Tier 3 by nature.** Church Intel, SRP workflow, carousel templates, the Planner's sermon/event pitch engine — these are Strategy-specific and stay local through absorption. That's freedom: Social gets to iterate quickly without blocking on CXOS readiness.

---

## 4. Proposed Social milestone pathway (fills "Social: TBD")

Social's pathway behaves **identically** to Brand and Web pathways — three milestones, each with a template, each firing a ClickUp chat message to the church channel on submit. No custom workflow logic, no special-case routing, no extra functions. The only novel piece is a cross-pathway trigger on milestone 3 (Intel Refresh), and that's a thin listener, not a subsystem.

**Path: "Social Media Squad" (3 milestones)**

1. **Discovery + Church Intel Generation.** Submitter: Amber or Social director. Uses the standard milestone submission form. Has a template in the Template Editor that Amber authors (e.g., "We're learning about {{church_name}} — here's what you can expect from Social this season."). On submit: fires the ClickUp chat message per the existing milestone pattern. The actual intel generation happens inside the Intel Audit Tool (§5.4), not inside this milestone — the milestone just records that intel has been initiated for the church.

2. **Vista Social Invite.** Submitter: Amber. Template on the editor page (e.g., "Here's your Vista Social link — let's get started posting social media for you: {{vista_invite_link}}"). Social squad submits the milestone, one of the submission fields is the Vista invite URL, merge-field fills in, ClickUp chat message fires just like Brand/Web milestones do.

3. **Intel Refresh.** Submitter: Amber or Andrea. Standard template. The novel bit: this milestone gets a **cross-pathway trigger** — when a church's `brand_new`, `brand_existing`, or `web_redesign` pathway completes its final step, we flag the church as "Intel Refresh Suggested" on Amber's dashboard. **Ministry Subbrand does NOT trigger it.** Web Audit does not trigger it either. The flag is just UI signal — the refresh is a manual milestone submission whenever Amber decides to act on it, same as every other pathway milestone.

All three records go into `strategy_milestone_definitions` with the same shape as Brand/Web rows. All three get templates in `strategy_message_templates` authored through the existing Template Editor. The submission form, partner-pathway visibility toggle (the existing feature in the template editor), merge-field engine, and ClickUp chat send work unchanged.

The only schema addition for this is the **cross-pathway trigger** — a `trigger_type` enum on `strategy_milestone_definitions` (`manual | post_branding_completion | post_web_redesign_completion`), and a small `strategy_pending_intel_refresh` table that a listener writes to when the relevant branding/web-redesign pathway finishes. Social's milestone 3 definition carries `trigger_type = post_branding_completion OR post_web_redesign_completion`. Ministry Subbrand deliberately excluded (per Amber's call — subbrand work usually doesn't invalidate the parent church's intel, so a refresh prompt would be noise).

Social's pathway sits alongside Brand New / Brand Existing / Ministry Subbrand / Web Redesign / Web Audit in the pathway picker.

---

## 5. Left-panel navigation (Strategy-app-wide)

The existing milestone app organizes itself around Brand/Web workflows. The revised nav is **squad-aware** at the top level, so every squad sees a shared shell but can drop into its own workspace. Ashley's proposed structure, cleaned up and annotated:

```
── My Dashboard                    → role-aware homepage (§5.1)
── Churches Dashboard              → shared master view across all squads (§5.2)
│
── All In Journey Milestones       → shared — Brand, Web, Social use the same group
│   ── Pathway Viewer              → visualization of a church's journey (§5.3)
│   ── Submit Milestone            → existing 7-step form, pathway-aware
│   ── Milestone Submissions       → renamed from "Partner Dashboard"
│   ── Template Editor             → unchanged, visible to all staff; uses existing "disable from partner pathway" toggle
│
── Social Media                    → squad-scoped workspace
│   ── SRP Generator               → full workflow, ported from srp-generator-app
│   ── Intel Audit Tool            → Church Intel generate/refresh with dating + refresh prompts (§5.4)
│   ── Prompt Settings             → ashley@ / amber@ only, ported from SRP app
│   ── Planning Calendar           → SRP posts + community/event posts overlay (§5.5)
│
── Partner Analytics               → shared — time-between metrics + Social sub-views (§5.6)
```

Role gating works as follows. Brand Squad sees My Dashboard, Churches Dashboard, All In Journey Milestones (their pathways filtered in), Partner Analytics. Web Squad sees the same minus any Brand-specific views. Social sees everything above plus the Social Media group. Ashley sees everything (VP). Jordan (contractor) is gated to Social-only with reduced Partner Analytics access — reuses the existing contractor-passcode + role system Japheth will generalize to CXOS.

### 5.1 My Dashboard

Role-aware homepage — the first screen on login. Shape varies by role:

- **Brand / Web role**: current app's bulk dashboard (unchanged from today).
- **Social role**: a Social-tuned homepage showing this week's SRP jobs in flight, any Intel Refresh Suggested cards (triggered post-branding, §4 milestone 3), pending carousel/graphic requests from ClickUp, and a glance at next week's Planning Calendar.
- **VP (Ashley)**: a rollup view with quick-filtering to any squad's homepage.

Implementation note: one route, one page component, but the content modules are role-switched. This avoids duplicating shell code and matches the CXOS "one primitive, many skins" pattern Japheth is pushing.

### 5.2 Churches Dashboard

Inspired by the Strategy Journey Dashboard's account-progress card overview, but **modernized**. The current card view has stale panel items (Ashley to provide the cleanup list before buildout). The key upgrade: this view becomes the **master view**, surfacing data from everywhere the Strategy app now owns:

- Church name, member #, denomination, primary contact — from `strategy_account_progress` (read-only).
- Active milestone pathways + current step across Brand, Web, Social — from `strategy_milestone_submissions`.
- Church Intel freshness — date of last intel run, "needs refresh?" flag — from `strategy_church_intel`.
- Social pipeline state — SRPs this month, Vista invite shared? — from `strategy_srp_generation`.
- Brand guide link — from `prf_brand_guides` (read-only).

Tri-view pattern (cards / journey / quickview) ported from the Journey Dashboard's `ClientJourney` + `ClientCard` + `QuickViewList` components so Brand/Web designers see the same client-browse UX they already know. Detail view reuses the 80KB ClientDetailModal pattern (which will become a CXOS Tier 2 primitive in Japheth Phase 2).

### 5.3 All In Journey Milestones — Pathway Viewer

Mimics the all-in journey visualization in the Strategy Journey Dashboard. A per-church horizontal journey strip: each pathway (Brand, Web, Social) shown as a row with its steps as nodes, current step highlighted, completed steps checked, upcoming steps ghosted. One glance answers "where is this church across everything?" Clicking a node opens the submission detail. This becomes the shared view Brand Directors, Web Directors, Amber, Ashley, and the Account Managers all look at.

Implementation: reuses `JourneyColumnHeader` + `JourneyCard` components from `lovable-strategy-notes-app/src/components/`. Data from `strategy_milestone_submissions` + `strategy_milestone_definitions`.

### 5.4 Social Media — Intel Audit Tool

Replaces Amber's standalone artifact. Must support:

- **Generate new** — the church-signed-trial flow. Calls the `church-intel-generate` Edge Function server-side (Anthropic key never in browser).
- **Refresh (scoped)** — `church-intel-update` for voice, design, CTA patterns, or all-of-the-above.
- **Dating + refresh suggestion system** — every intel record stores `intel_updated_at`, `intel_version`, and `last_refresh_reason`. The tool calculates and displays staleness:
  - Green: updated < 60 days ago, no post-branding trigger pending.
  - Yellow: updated 60–120 days ago, or post-branding trigger fired and not yet acted on.
  - Red: updated > 120 days ago, or the church moved between major campaigns.
- **Hand-edit any field** — Amber can override any intel field manually; edits sync back to Notion and bump `intel_version`.
- **History** — every version stored in `strategy_church_intel_history`; show a diff-of-versions viewer so Amber can see what the refresh changed.

The refresh suggestion logic runs on a daily cron Edge Function that sets a `needs_refresh` flag — so the audit tool and the Social Dashboard's "Intel Refresh Suggested" card fire from the same source of truth.

### 5.5 Social Media — Planning Calendar

Multi-layer calendar view per church (or aggregate across the squad). Layers:

- **SRP posts (output layer)**: posts already approved and scheduled from `strategy_srp_generation` + Vista CSV export dates. Shown as solid pills on the calendar.
- **Community + event-oriented post suggestions (4–5 per week)**: derived from a suggestion pipeline that reads:
  - `upcoming_opportunities` field from the church's Church Intel profile
  - **Sermon livestream transcript announcements** — a new Edge Function scans the most recent sermon transcript (we already fetch transcripts in the SRP flow) for event announcements and generates candidate pitches
  - **Event graphic requests from our Supabase `tasks` table** (minimum viable signal — see Appendix D.3) — tags like `social-eventgraphic` on ClickUp-synced tasks indicate an event the church needs promoted
  - Calendar events via public iCal URL or shared Squad calendar (`admin.csquad@churchmediasquad.com` — see Appendix D)
  - Liturgical calendar milestones
  Shown as dashed outlines until a user promotes them to draft SRP jobs.

User actions: click a suggestion → one-click create a draft SRP job (routes into the SRP Generator with pre-filled context). Promote a SRP job to scheduled → adds to Vista export. This is where the meeting's "weave event promotions into captions" idea lives: the calendar's campaign-lens view shows "summer camp registration closes May 31 — these 4 upcoming posts should mention it."

### 5.6 Partner Analytics

Consolidates two things today's tools track separately.

**Shared metrics across all three squads (new):**
- **Time between milestones, grouped by department.** Calculated from `strategy_milestone_submissions.created_at` pairwise within each pathway. Answers "how long does Brand's step 3 → step 4 typically take?" and flags outliers.
- **Time between replies / resolution.** Will piggyback on the reply-triage webhook Japheth plans for M21 Logic Engine (Phase 5 of his plan). Until then, show a placeholder "awaiting M21" panel.
- **Milestone suggestions.** Cross-reference `strategy_milestone_submissions` + ClickUp task data to flag things like "this Brand pathway has been on step 3 for 14 days, suggest nudging" or "this Web audit hasn't moved in a week." Fairly expansive — ClickUp task metadata is rich. Start small (one heuristic: "no activity > N days"), layer heuristics as signal comes in.

**Social sub-page — replicates the existing analyticsapp:**

The analyticsapp folder (Vite + React + Recharts + shadcn + React Query + Supabase Edge Functions, ClickUp API v2 driven, tagged `sms-sermon-recap`) already implements:

- Key metric cards: Total Submissions, Active Churches, Avg Time to Due, Avg Completion Time
- Deliverable breakdown (bar chart by type)
- Submission timeline (daily counts, clickable for task details)
- Completion timeline (area chart, avg days to completion trend)
- Link source analysis (YouTube / Dropbox / Other classification)
- Per-church analysis cards (plan type, assignees, week range, deliverables)
- Date-range filter (default last month)

Port the components wholesale into `Partner Analytics → Social`. The two Edge Functions (`clickup-tasks` and `srp-uploads`) port into our Edge Functions directory. The external-Supabase `sf-srp-uploads` reference becomes a read of our own `strategy_srp_generation` table post-migration. No architectural rebuild — just move the code. See Appendix E for the detailed port checklist.

**Brand and Web sub-pages:** same shared metrics (time between milestones, reply resolution, suggestions) with their pathway filters pre-applied. No Social-specific charts.

Brand and Web experiences are untouched: their existing milestone pathways, bulk dashboard, template editor, and partner portal all keep working. The Churches Dashboard is new for them but strictly additive — a better client-browse view than they have today. The Social Media nav group doesn't apply to them and is role-gated out.

---

## 6. Data model additions (all `strategy_` prefix, all new)

The existing milestone app already owns four `strategy_*` tables. We add Social's context without touching any existing table.

```
strategy_church_intel                          → NEW, Social's intel profile
├── id (uuid, pk)
├── member (int, unique)                       → same key shape the existing app uses
├── notion_page_id (text, unique)              → master DB source of truth
├── notion_page_url (text)
├── intel_profile (jsonb)                      → Amber's full JSON shape, verbatim
├── intel_version (int)                         → bumped on every refresh
├── intel_updated_at (timestamptz)
├── intel_updated_by (text)                     → ashley@ / amber@ / ...
├── homepage_screenshot_path (text)             → Supabase Storage bucket
├── status (text: draft | live | needs_refresh)
└── created_at, updated_at

strategy_church_intel_history                  → NEW, audit log
├── id, church_intel_id (fk), version, intel_profile (jsonb)
└── author_email, reason (text), created_at

strategy_srp_generation                        → NEW, replaces sms_srp_generation on cutover
├── ... (identical column set to existing sms_srp_generation)
├── church_intel_id (uuid, fk → strategy_church_intel.id)   → the merge FK
└── milestone_submission_id (uuid, fk → strategy_milestone_submissions.id, nullable)

strategy_planner_items                         → NEW
├── id, member (int), event_date, source (pc | gcal | liturgical | manual | graphic_request)
├── title, description, suggested_deliverables (jsonb)
├── status (draft | pitched | scheduled | posted)
└── linked_srp_generation_id (fk, nullable)

strategy_post_performance                      → NEW, drives analytics
├── id, member (int), srp_generation_id (fk), deliverable_type
├── platform (ig | fb | yt), published_at
├── impressions, saves, shares, comments, clicks
└── designer_approved_on_v1 (bool), revision_count (int)

strategy_prompt_settings                       → NEW, migrated from prompt_settings
└── ... (identical structure; rename/move is the only change)

strategy_pending_intel_refresh                 → NEW, drives "Intel Refresh Suggested" card
├── id, member (int, unique), triggered_by (text: post_branding | stale_days | manual)
├── triggered_at (timestamptz), triggered_by_submission_id (fk, nullable)
├── acknowledged_at (timestamptz, nullable), acknowledged_by (text, nullable)
└── resolved_at (timestamptz, nullable), resolved_by_intel_version (int, nullable)
```

**Schema adjustment to support cross-pathway intel-refresh trigger:**

- Add a `trigger_type` enum column to `strategy_milestone_definitions` — `manual | post_branding_completion | post_web_redesign_completion`. Most rows (all Brand, Web, and Social milestones 1 + 2) stay `manual`. Social milestone 3 (Intel Refresh) uses `post_branding_completion` *and* `post_web_redesign_completion` (modeled as an array or two separate trigger rows, implementation choice). Ministry Subbrand and Web Audit do NOT trigger an intel refresh.
- A small server-side listener fires when a branding or web-redesign pathway reaches its final step and writes a `strategy_pending_intel_refresh` row for that church. The Social dashboard reads this table to render the "Intel Refresh Suggested" card. When Amber/Andrea submit the Intel Refresh milestone, the listener marks the refresh row resolved.

No `partner_facing` column is introduced. The existing Template Editor already supports disabling milestones from the partner pathway via its current toggle — that's the mechanism Amber uses if any specific Social milestone shouldn't be partner-visible for a given church.

**Why `strategy_srp_generation` as a new table (not extend `sms_srp_generation`):** the existing `sms_srp_generation` lives in the SRP app's Supabase project. When we port into the milestone comms app's Supabase project (the Strategy app is one project, not N), we create the new table there, backfill from the old one, and retire the old project when the port is complete. The column set stays identical plus the two new FKs.

**Why JSONB for `intel_profile`:** the Intel shape is rich and evolving. JSONB means we iterate via prompts, not migrations. The `strategy_church_intel_history` table gives us version safety.

**Keying on `member`:** the existing app keys everything on the numeric `member` (from `strategy_account_progress`), and we stay consistent. No `church_id` uuid primary key at the business level — uuid is internal PK, `member` is the business key.

**Tier 1 posture:** `strategy_account_progress`, `clickup_chat_channels`, `clickup_users`, `prf_brand_guides` remain read-only today and migrate to CXOS views in Japheth's Phase 1. We continue to read only; we never write. When CXOS cutover happens, we change one select statement per read to point at `cxos.view_dashboard_accounts` (or equivalent) and ship. The fact that we don't own these today means Japheth's absorption is mostly transparent to us.

---

## 7. Integrations (same cast, different home)

Every integration that lived in the standalone SRP / Church Intel lives in the Strategy app instead. Most route through Supabase Edge Functions (the pattern the milestone app already uses).

The integration surface — **Notion** for church profiles and docs (via MCP server-side, writing to master DB `1f2e83f7-31f6-80d8-a7ea-db623db57a58`); **Planning Center** for church calendars per Planner module (OAuth per church or squad-level app); **Google Calendar** for squad/church calendar overlays; **ClickUp API v3** for task pipeline, chat messages (`POST /api/v3/chat/{channel_id}/message` — already wired), and graphics-request webhooks; **Vista Social** via CSV export (keep the current byte-exact format); **Meta / IG Graph** for post performance; **YouTube** for sermon video + transcripts (port the existing edge function); **Anthropic API** for all LLM calls, server-side only; **Rippling** stays out-of-app (1:1s live there, not here).

The ClickUp chat send function the milestone app already uses is the same primitive we'll lean on for Social's pathway Step 3 (SRP delivery → partner chat). We reuse; we don't duplicate. When Japheth generalizes ClickUp chat send as a Tier 2 CXOS primitive, our Social pathway inherits the upgrade automatically.

---

## 8. Tech stack & repo structure

**Stack:** Claude Code, VS Code, GitHub, Vercel, **React + Vite** (matching the existing milestone app — we do *not* migrate the app to Next.js in Phase 1), Supabase (DB + Edge Functions + Auth + Storage), Notion.

**Migration note:** v1 of this plan proposed moving to Next.js App Router. v2 abandons that for Phase 1 because the existing milestone app is React 19 + Vite and works. Rewriting the shell as Next.js would mean re-porting Brand and Web's working pathways, which is out of scope and risky. Server Actions aren't required for moving Anthropic calls off the browser — Supabase Edge Functions do the same job, and the app already uses them. The Next.js question, if it matters at all, is a Japheth/CXOS question.

**Repo structure:** one repo, `sqd-milestone-main`, same as today. Social's additions are new directories and files; the shell is untouched.

```
sqd-milestone-main/
├── src/
│   ├── pages/
│   │   ├── (existing Brand/Web pages stay)
│   │   ├── churches/                   → NEW shared panel
│   │   ├── squads/social/
│   │   │   ├── Dashboard.tsx           → SRP dashboard, ported
│   │   │   ├── srp/                    → SRP workflow, step-by-step port
│   │   │   ├── planner/                → NEW
│   │   │   ├── analytics/              → rebuild
│   │   ├── settings/prompts/           → ported from SRP app
│   ├── components/
│   │   ├── (existing stay)
│   │   ├── intel/                      → Amber's profile UI, componentized
│   │   ├── srp/                        → existing SRP step components, ported
│   │   ├── planner/                    → NEW
│   ├── hooks/
│   │   ├── (existing stay)
│   │   ├── useChurchIntel.ts           → NEW
│   │   ├── useSrpGeneration.ts         → NEW
│   │   ├── usePlannerItems.ts          → NEW
│   ├── lib/
│       ├── (existing stay)
│       ├── anthropic/                  → thin wrapper, server-side only
│       ├── notion/                     → MCP + SDK
│       ├── planning-center/            → NEW
│       ├── generators/                 → one file per SRP generator, all intel-aware
├── supabase/
│   ├── migrations/
│   │   ├── (new strategy_church_intel, strategy_srp_generation, planner, performance)
│   ├── functions/                      → new edge functions ported/rewritten
│       ├── church-intel-generate/      → replaces browser call to Anthropic
│       ├── church-intel-update/        → scoped refresh
│       ├── srp-generate-caption/       → intel-aware
│       ├── srp-generate-carousel/      → intel-aware
│       ├── srp-generate-clips/
│       ├── srp-generate-facebook/
│       ├── srp-generate-photo-recap/
│       ├── srp-generate-sunday-invite/
│       ├── srp-fetch-transcript/
│       ├── srp-transcribe-file/
```

**Auth:** reuse existing Slack/email OTP + contractor passcode flow. We do not build a new auth system. Role-gating for Social surfaces uses the existing employee/role tables the app reads.

**Deploy:** same Vercel project as today, new env vars for Anthropic key + PC/GCal credentials (Supabase secrets, never committed).

**Brand tokens:** use the existing Purple/Plum/Lavender palette (`#513DE5, #341756, #CFC9F8, #EDE9FC, #F9F5F1, #6B5CE7, #6B6180`). Every new Social surface ships on-brand on day one.

---

## 9. Phase 1 sequence (Ashley-owned, ~6 weeks)

Same 6-week shape as v1, but the scaffolding already exists — so every week is additive, not from-scratch.

**Week 1 — Foundations inside the shell.** Stand up the new Supabase migrations (`strategy_church_intel`, `strategy_church_intel_history`, `strategy_srp_generation`, `strategy_planner_items`, `strategy_post_performance`, `strategy_prompt_settings`). Wire up the Churches panel at `/churches` as a read-only list backed by `strategy_account_progress` joined to `strategy_church_intel` — no intel generation yet, just surfaces what exists. Add the Social role gate.

**Week 2 — Church Intel moved server-side.** New Supabase Edge Functions `church-intel-generate` and `church-intel-update` that encapsulate Amber's artifact logic — Anthropic API call with web_search + screenshot base64 + Notion MCP. Output JSON identical to artifact. Notion write to master DB `1f2e83f7-31f6-80d8-a7ea-db623db57a58`. UI inside `/churches/[member]/intel` renders/edits/regenerates. **Deprecate the standalone artifact.** This is the "Anthropic key is no longer in the browser" milestone.

**Week 3 — SRP port, Part 1 (shell + dashboard + account step).** Port `src/pages/Dashboard.tsx`, the workflow entry, and the account step into `/squads/social` and `/squads/social/srp`. New `strategy_srp_generation` table backfilled from `sms_srp_generation`. Vista CSV export keeps its exact column/value format. Account step surfaces Church Intel profile with a confirm/override UI instead of the current brand-voice form.

**Week 4 — SRP port, Part 2 (generators, all intel-aware).** Port all 12 edge functions into the Strategy app's Supabase project. Every generator now accepts `church_intel_id` and fetches structured intel for prompt context. Wire each generator step (deliverables, sermon, clips, reelCaptions, carousel, facebook, sundayInvite, photoRecap, approved) into the workflow router. Prompt Settings page ports to `/settings/prompts`.

**Week 5 — Social milestone pathway + nav reorg.** Schema: add `trigger_type` column to `strategy_milestone_definitions`, create `strategy_pending_intel_refresh`. Seed the 3 Social milestone definitions — they behave exactly like Brand/Web milestones (template, ClickUp chat send, partner-pathway toggle via existing Template Editor). Amber authors the 3 templates. Build the cross-pathway trigger listener that writes `strategy_pending_intel_refresh` rows when `brand_new`, `brand_existing`, or `web_redesign` pathways complete (NOT `ministry_subbrand`, NOT `web_audit`). Reorganize the left-panel nav to the new 5-group structure. Port the Strategy Journey Dashboard's Pathway Viewer components (`JourneyColumnHeader`, `JourneyCard`, `ClientCard`) into the shared milestones group. Smoke-test one trial church through the 3 Social milestones end-to-end.

**Week 6 — Analytics port + Planner v0 + Churches Dashboard polish.** Analytics: port the analyticsapp components wholesale into `Partner Analytics → Social` (see Appendix E) — Recharts + React Query + shadcn move as-is, the two Edge Functions (`clickup-tasks`, `srp-uploads`) move as-is, the `sf-srp-uploads` reference rewrites to `strategy_srp_generation`. Shared metrics (time-between-milestones grouped by dept) ship as a new panel. Planner v0: iCal URL poller + shared Squad Google Calendar reader (`admin.csquad@churchmediasquad.com`) + event-graphic-request sync from our existing `tasks` table (see Appendix D) + sermon-transcript scan for announcement detection + manual pitch creation + draft SRP generation. Churches Dashboard gets the modernization pass Ashley's list will scope.

**Exit criteria for Phase 1:**
- Social pathway live in the milestone picker (all 3 milestones), behaving like Brand/Web — submit the milestone, ClickUp chat fires via template, end-to-end working for one trial church
- Cross-pathway trigger firing correctly — "Intel Refresh Suggested" card renders in Social Dashboard when a `brand_new`, `brand_existing`, or `web_redesign` pathway completes (Ministry Subbrand and Web Audit deliberately do not trigger)
- Church Intel standalone artifact turned off; all intel lives in the Strategy app + master Notion DB
- SRP Generator app retired; `sms_srp_generation` marked frozen
- analyticsapp retired; its functionality lives in `Partner Analytics → Social` inside the Strategy app
- Vista CSV export output identical to current production
- Brand and Web pathways unchanged, untouched, still working
- Prompt Settings access still restricted to ashley@ / amber@
- Left-panel nav reorganized to the 5-group structure (My Dashboard / Churches Dashboard / All In Journey Milestones / Social Media / Partner Analytics) with role gating working for Brand, Web, Social, Contractor, VP roles

Target exit: **June 1 stretch, July 1 realistic** — same target as v1, validated against the faster shell-already-exists reality.

---

## 10. Phase 2 — CXOS absorption alignment (Japheth-owned)

Phase 2 is Japheth's M26 sequence. Our job is to build Phase 1 in a way that doesn't slow his phases down and, where possible, accelerates them. Concrete alignments:

**Japheth Phase 1 (Data Foundation — point Strategy apps at CXOS data spine).** When `cxos.view_dashboard_accounts` lands, we change one `from` clause per read to cut over from `strategy_account_progress`. Call notes and documents migrate out of our app's responsibility. Our new `strategy_church_intel` table is Tier 3 and stays put through Phase 1.

**Japheth Phase 2 (Journey Dashboard in CXOS).** Tri-view + DashboardFilters + ClientDetailModal move to `/strategy/*` in CXOS. Our Churches panel was built so its client-detail experience reuses those same patterns, which means a port, not a redesign. Social's SRP and Planner surfaces stay where they are (Tier 3) and read from the CXOS-hosted detail modal when it lands.

**Japheth Phase 3 (Generalize primitives).** Contractor passcode auth, Slack/email OTP, queue manager, tri-view layout, brand/skin multi-domain graduate to CXOS. The `strategy.thesqd.com` landing drops early in this phase. Our Social surfaces inherit the new auth + skin system without code changes (we never built a parallel auth).

**Japheth Phase 4 (Milestone workflow native).** Milestone definitions, submissions, state machine, template editor move to CXOS. Our Social pathway definitions (`strategy_milestone_definitions` rows) port as data; our UI port is free because the generalized CXOS templates pick them up.

**Japheth Phase 5 (Automation + integrations).** ClickUp chat send becomes an Edge Function owned by CXOS (not us). Reply-triage webhook lands on M21 Logic Engine. Our SRP/Planner Slack notifications route through the CXOS primitive instead of calling ClickUp directly.

**Japheth Phase 6 (Partner portal).** First external CXOS surface. Our Social pathway's portal view (SRP preview, weekly schedule) rides the new CXOS partner portal instead of our current tokenized portal. Zero UI work on our side if we kept the portal data model aligned.

**Japheth Phase 7 (AirTable phaseout).** 39 tables, mostly not ours. Social has minimal AirTable exposure. Where we touch AirTable indirectly (e.g., All-In Discovery FillOut), we move to Supabase-native forms in this phase.

**Japheth Phase 8 (Retirement).** `lovable-strategy-notes-app` turns off. `sqd-milestone-main` turns off. All `strategy_*` tables drop from `public` schema, replaced by `cxos.*` equivalents. Social's Tier 3 surfaces (SRP, Church Intel, Planner, Carousel templates) live inside CXOS as `/strategy/social/*` routes or their CXOS equivalents.

**What we commit to during Phase 1 to make this clean:**

- Use the existing auth; don't build parallel.
- Keep every new `strategy_*` table queryable via `member` so CXOS views can stitch cleanly.
- Keep the ClickUp chat send pattern consistent with the existing Edge Function; don't invent a second one.
- Keep Church Intel output JSON byte-identical to Amber's artifact (Notion contract) so CXOS can ingest without transform.
- Keep Vista CSV export byte-identical to current production (Andrea's scheduling muscle memory is expensive).
- Keep brand tokens as hard-coded `#513DE5/...` — they survive the skin system because the skin is explicit design, not theme magic.

---

## 11. Ideas from the 4/17 meeting — where each one lives now

Captured directly from the transcript so none of it falls on the floor. In v1 these pointed at "Squad HQ" modules; in v2 each points at a specific surface inside the Strategy app.

**Prefill v1 captions using Church Intel** → Phase 1, Week 4 (every generator becomes intel-aware). **Connect Church Intel to Japheth's app** → Phase 2, Japheth Phase 1 (CXOS reads intel via our `strategy_church_intel` table). **Planning Center + Google Calendar integration** → Phase 1, Week 6 (Planner v0). **Event request graphics → suggested posts** → Phase 1, Week 6/7 (ClickUp webhook → planner item). **Weave event promotions into existing captions** → Phase 1, Week 6 (Planner "campaign lens" feeds into SRP generators). **Global 6-week content planning per church** → Phase 1, Week 6 Planner v0 + iterate. **Single Notion DB as source of truth for profiles** → Phase 1, Week 2 (server-side write to master DB `1f2e83f7-...`). **Automate ClickUp carousel request on trial sign-up** → Phase 1, Week 5 (Social pathway Step 1 trigger). **Repair SRP analytics** → Phase 1, Week 6. **Migrate SRP out of Lovable** → Phase 1, Weeks 3–4 (delete Lovable artifacts during port).

Nothing gets deferred. The shape of who-owns-what changes because the container changed.

---

## 12. Risks and open questions (revised)

**Anthropic API key exposure.** Non-negotiable v1 fix. Phase 1 Week 2 — Anthropic key moves to Supabase secrets, all calls through edge functions. No browser key.

**Notion MCP reliability.** MCP is maturing. Design the intel flow so Notion is source of truth but a failed Notion write doesn't block the generator run (queue + retry, not block). Same posture as v1.

**Prompt governance.** Prompt Settings stays ashley@ / amber@. When intel profiles ship to every generator, intel prompt edits cascade. Add a "preview before save" step on intel prompt changes so the blast radius is visible.

**RLS.** Existing `sms_srp_generation` migrations have RLS on with `USING (true)` — open to anyone authenticated. Fine for internal. On cutover to `strategy_srp_generation`, tighten RLS to per-squad + per-role before any external (partner portal) access.

**Data migration from `sms_srp_generation`.** Backfill script. Map `member` → `strategy_account_progress.member` verified, then `church_intel_id` populated where an intel profile exists (nullable where not). Dual-write period: one week of both tables being written; then cut reads to new table; then freeze old.

**Japheth app coupling.** His plan already assumes CXOS reads from our tables through views. Confirm the column shape of `strategy_church_intel` with him before Week 2 ships so his Phase 1 cutover doesn't need ceremony.

**Planning Center auth per church.** Some churches grant PC access; some won't. Planner needs graceful fallback to manual calendar entries — same risk as v1.

**Lovable disconnect.** `srp-generator-app` has `lovable-tagger` and Lovable files. Port deletes them; no Lovable dependency survives into the Strategy app.

**Two Supabase projects until cutover.** SRP app has its own Supabase project with `sms_srp_generation`. Strategy app has its own. Port means creating `strategy_srp_generation` in the Strategy project and backfilling. For one week we run parallel; then we cut the SRP project off. Worth budgeting cost (two projects) for that week.

**Role gating for Social surfaces.** Brand and Web users shouldn't see the SRP workflow clutter. Use the existing employee/role system — confirm the role shape exists for "Social" before Week 1 migration.

**Scope discipline on Tier 2 primitives.** Easy trap: adding "just one more" auth tweak, partner portal variant, or merge field that Japheth's plan will then have to refactor. Rule: every new primitive addition to the shell in Phase 1 gets a 24-hour "does Japheth know about this?" pause.

**Name for the app.** v1 called it "Squad HQ." v2 doesn't need a new name — the app is `sqd-milestone-main` and will be M26 Strategy Squad Experience in CXOS. If we want a cleaner internal name for the extended app, "Strategy" or "Strategy HQ" tracks with how Japheth is labeling it.

---

## 13. Next actions (Phase 1 kickoff)

Small, ordered, mostly Ashley-owned:

1. **Read this plan, decide if the reframing lands.** Push back on anything that's still off before we touch code.
2. **Confirm with Japheth** that (a) the Social pathway + `strategy_church_intel` table structure won't collide with his Phase 1 CXOS cutover, and (b) the Week 2 Anthropic-key server-side move is compatible with his auth pattern.
3. **Pull the `sqd-milestone-main` repo** into Claude Code / VS Code, audit existing Supabase migrations, confirm the four existing `strategy_*` tables and hard rules.
4. **Draft the Week 1 migrations** for `strategy_church_intel` + `strategy_church_intel_history` + (skeleton) `strategy_srp_generation`. No code writes yet — just the migration shape for review.
5. **Spec the Social pathway 5-step flow** with Amber — confirm the submitter/trigger/template language for each step matches her mental model.
6. **Dry-run the Church Intel edge function locally** — Anthropic + Notion MCP + screenshot base64 — end-to-end against one trial church. Validate parity with Amber's artifact before we ship Week 2.
7. **Align with Amber on prompt governance** — intel prompt preview-before-save mechanic.
8. **Loop Japheth in** on the Social pathway + intel DB shape. His Tier 1 cutover depends on the shape.
9. **Sketch Planner UX on paper** before Week 6 code. Biggest unknown; needs the most thinking time.
10. **Socialize the shell** with Brand and Web squads once the Churches panel is in place. Amber + Spencer + Emily confirm it feels like a home for all — the whole point of doing this inside the existing app instead of building parallel.

---

## Appendix A — Church Intel JSON shape (unchanged from v1)

The profile shape Amber's prompt produces, which becomes our `strategy_church_intel.intel_profile` JSONB column verbatim:

```
church_name, church_number, website, tagline_or_mission, pastor_name, denomination
audience: { primary, secondary, content_implication }
campus_locations
brand_voice: { tone_summary, attributes[], vocabulary[], avoid[] }
design: { primary_colors, accent_colors, visual_style, adobe_fonts[] }
sermon_recap_videos: { clip_selection_guidance, caption_style, cta{}, music_preference, cover_frame, hook_approach, worship_reels{} }
carousel_post: { tone, slide_structure, design_notes, cta{} }
photo_recap_post: { caption_tone, caption_example, what_to_highlight, cta{} }
sunday_invite_post: { tone, caption_pattern, caption_example, cta{} }
caption_cta_patterns: { observed_pattern, examples[], recommendation }
facebook_text_post: { style, engagement_approach, example, cta{} }
what_performs_well: { summary, themes[], avoid_content }
upcoming_opportunities
week1_tip
```

Every generator gets a specific slice — `srp-generate-caption` gets `brand_voice` + `sermon_recap_videos`; `srp-generate-carousel` gets `brand_voice` + `design` + `carousel_post`; and so on. One contract, many consumers. Byte-identical to Amber's artifact output so the Notion DB contract is preserved.

---

## Appendix B — Naming convention after v2

The v1 question "what do we call the app?" resolves: **we don't rename anything**. The Strategy app keeps its internal name (`sqd-milestone-main` repo, user-facing it's the Strategy app or, per Japheth, the Strategy Squad Experience / M26). The Church Intel and SRP surfaces are sub-modules inside it. When CXOS absorbs it, M26 becomes the label.

Internal shorthand in team chat: "Strategy app" is fine. "Squad HQ" retires along with the v1 plan.

---

## Appendix C — Strategy Division roster (for scope clarity)

From Japheth's CXOS plan, captured here so Phase 1 build doesn't forget who sits in it:

- **Strategy Division VP** — Ashley Fox (owns the division; Phase 1 driver).
- **Brand Squad** — Spencer Passwater (Director), Delaney Bergner (Designer).
- **Social Media Squad** — Amber Pankey (Director), Andrea Balogun (Coach / Designer), Jordan An (Contractor — the one contractor-passcode-auth user in the division).
- **Web Squad** — Emily Ament (Director), Joshua McNeel (WordPress Dev), Andrew Finch (Content Strategist).

"Feels like a home for all" means all ten humans here should open the Strategy app Monday morning and see exactly what's theirs with zero friction. Brand and Web stay frictionless because their pathways are already there; Social joins them in Phase 1.

---

## Appendix D — Church calendar + event signal sources (Phase 1 decisions)

Three signal sources feed the Planning Calendar in Phase 1. Two are church-provided calendar feeds; the third is already inside our own Supabase.

### D.1 Public iCal URL (confirmed Phase 1 support)

Churches (both Google Calendar and Planning Center) expose public iCal / `.ics` feeds. The church's admin copies the URL, we store it, a Supabase Edge Function polls it every 4–6 hours via pg_cron, parses with a library like `ical.js` or `node-ical`, and upserts events into `strategy_planner_items`. Zero OAuth, zero per-church consent screens, works regardless of which calendar platform the church uses.

Planning Center exposes public iCal feeds through its Publishing product. Google Calendar exposes `.ics` URLs when a calendar is made public (or shared via secret URL). Either source works with the same parser.

### D.2 Shared calendar with `admin.csquad@churchmediasquad.com` (confirmed Phase 1 support)

The low-tech, no-OAuth-needed upgrade path. Churches grant read access on their Google Calendar to `admin.csquad@churchmediasquad.com`. We run a single service account (or app-specific password / OAuth token on that one Squad gmail account) that reads `calendarList` + `events.list` via the Google Calendar API. Every calendar that shows up in that account's list gets synced into `strategy_planner_items`, tagged by which church owns it (matched by calendar name or an explicit `strategy_calendar_connections.google_calendar_id` mapping row).

Why this is better than OAuth-per-church for our Phase 1 reality: fewer churches need to complete a consent flow, we can onboard a church in minutes by asking their admin to share with one email, and a single credential serves the whole squad. Planning Center doesn't have a direct analogue — churches there still share via public iCal or the future OAuth-per-church path if/when we want it.

**Not pursuing in Phase 1:** full OAuth-per-church for Google or Planning Center, service-account domain-wide delegation, or Personal Access Tokens. Keep the door open for later if a specific church needs richer integration.

### D.3 Supabase `tasks` table — event graphic requests (confirmed, at a minimum)

The Strategy app's Supabase already has a ClickUp-synced task picture via these tables (used today by the lovable-strategy-notes-app):

```
clickup_lists
├── id (text, fk used by tasks.list_id)
└── account (int) — the member number this list belongs to

tasks
├── task_id (text, pk)
├── name (text)
├── list_id (text, fk → clickup_lists.id)
├── row_created (timestamptz)
└── task_archived (bool | null)

tag_history
├── task_id (text)
└── tag_after (text) — current tag on the task

status_history
├── task_id (text), status_after (text), changed_at (timestamptz)
```

Event graphic requests surface as tasks with a specific tag in `tag_history.tag_after` (the Strategy Notes app uses `social-sermoncarouseltemplate` for carousel-template tasks as precedent — Ashley to confirm the exact tag for event graphic requests, likely something like `social-eventgraphic` or `event-request`). The Planning Calendar Edge Function reads this chain at sync time:

1. `clickup_lists.account = member` → get the church's list IDs.
2. `tasks.list_id in (...)` with `row_created >= now() - interval '120 days'` and `task_archived != true` → get recent tasks.
3. Join against `tag_history.tag_after = '<event-graphic-request-tag>'` → filter to event-graphic requests.
4. Join against `status_history` (latest row per task_id) → pull current status.
5. Upsert into `strategy_planner_items` with `source = 'graphic_request'`.

This is a minimum-viable event-signal source we have today — no church cooperation, no calendar setup, zero dependency on church-side action. It's the backstop that makes the Planning Calendar useful for Day One churches before any iCal or shared-calendar work is done.

### D.4 Schema

One new table holds the calendar-feed configs (the graphic-request pull doesn't need config — it's inferred from existing `tasks` data):

```
strategy_calendar_connections                  → NEW
├── id, member (int), provider (google_ical | planning_center_ical | squad_shared_google)
├── config (jsonb)                             → { ical_url } or { google_calendar_id, calendar_name }
├── last_synced_at, last_sync_status, last_error
└── created_at, updated_at, created_by
```

### D.5 Where it runs

Claude Code accelerates *building* the Edge Functions — scaffolding the iCal parser, writing the upsert SQL, wiring Google Calendar API for the shared squad account — but every integration runs server-side in Supabase at runtime, not through Claude Code itself. Claude Code has access to Supabase via MCP for developer-assist, not as production runtime.

When CXOS absorbs (Japheth Phase 5 — Automation + integrations), `strategy_calendar_connections` graduates to a CXOS-wide primitive so Sales, Marketing, and others inherit the same plumbing.

---

## Appendix E — analyticsapp port checklist

The existing `analyticsapp` folder (added to project context 2026-04-17) is the "repair the analytics dashboard" work, half-done. It's a full Vite + React 18 + TypeScript + shadcn + Tailwind + Recharts + React Query app, ClickUp-driven (not Supabase-driven for source data — it pulls live from ClickUp API v2 tagged `sms-sermon-recap` and cross-references an external Supabase `sf-srp-uploads` table).

**What it already does (reusable wholesale):**

- Key Metrics cards: Total Submissions, Active Churches, Avg Time to Due, Avg Completion Time — `differenceInDays` math is correct, port as-is.
- `DeliverableBreakdown` component: bar chart + scrollable list by deliverable type.
- `SubmissionTimeline`: daily submission counts line chart, clickable for drill-down dialogs.
- `CompletionTimelineChart`: area chart of avg completion days over time.
- `LinkSourceAnalysis`: horizontal bar chart classifying URLs as YouTube / Dropbox / Other.
- `ChurchAnalysis`: scrollable cards per church with plan type, assignees, week range, deliverables.
- `FilterControls`: date range picker (defaults to last month).
- Two Edge Functions: `clickup-tasks` (getTasks / getTeamTasks / updateTask / getTask) and `srp-uploads` (reads external Supabase for upload cross-ref).

**What needs rewiring on port:**

- The external Supabase reference (`EXTERNAL_SUPABASE_URL` for `sf-srp-uploads`) should be rewritten to read from `strategy_srp_generation` once SRP is ported into the Strategy app's Supabase project. One-function change.
- The `sms-sermon-recap` ClickUp tag stays — it's the filter that scopes to SRP tasks. Confirm with Ashley whether the tag is stable or should be parameterized.
- The "no JWT verification" config on both Edge Functions needs a security pass. Move to JWT-required + a service role for legitimate calls, matching the milestone comms app's security posture.
- React Query queryKeys should namespace with `['social-analytics', ...]` to not collide with shared analytics queries.

**What's missing (new work on top of port):**

- Time-between-milestones metric, grouped by department — new calculation, pulls from `strategy_milestone_submissions`.
- Reply/resolution-time metric — depends on Japheth's M21 Logic Engine reply-triage webhook; stub a placeholder panel.
- Milestone suggestion engine (heuristic-based, ClickUp task activity) — start with one rule ("no activity > N days on current step").
- Meta/IG Graph API integration for true post-performance — not in analyticsapp, add later.

**Port location:** components move to `src/components/analytics/social/`; Edge Functions move to `supabase/functions/clickup-tasks/` and `supabase/functions/srp-uploads/` (renamed to `srp-uploads-legacy/` while we finish the data migration, then dropped). The FilterControls + header layout pattern becomes the shared chrome for all three squad analytics sub-pages.

**Effort estimate:** ~2 days for the wholesale port, ~2 days for the new shared metrics (time-between-milestones, suggestions heuristic), total within the Week 6 budget.

**Retirement:** once ported, the standalone analyticsapp folder + Vercel deploy can be retired. Edge Functions in the legacy Supabase project can be paused/deleted.
