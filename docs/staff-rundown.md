# Strategy App — Staff Rundown

A plain-English tour of what the app does, where each feature lives, and what data
it's pulling from. For the technical roadmap see [unified-app-game-plan.md](./unified-app-game-plan.md).

---

## 1. What this app is for

The Strategy App is the internal tool Church Media Squad uses to **communicate
milestone progress with partner churches** across Brand, Web, and Social squads.
Before this existed, staff manually wrote ClickUp chat messages, tracked project
status in spreadsheets, and juggled partner info across several tools.

This app gives us **one home** for:

- Sending milestone updates to partners (via ClickUp chat)
- Tracking where every partner is in their Brand / Web / Social journey
- Editing the message templates that staff use
- Storing Church Intel profiles (the content strategy brain for Social)
- A public portal for partners to see their project progress

The output of every milestone submission is a real ClickUp announcement sent to
the partner's chat channel, plus a durable record in our database so we can
report on progress later.

---

## 2. Who uses it

All staff in the **Strategy Division** (Brand, Web, Social squads + account
managers) have access. Role gating is driven by `employees.department`:

- **Brand / Web squad members** → see My Dashboard, Churches Dashboard, All In
  Journey Milestones (Submit, Milestone Submissions, Template Editor), Partner
  Analytics
- **Social Media squad** → everything above plus the Social Media nav group
  (SRP Generator, Intel Audit Tool, Prompt Settings, Planning Calendar)
- **VP (Ashley)** → sees everything, role-switchable

Auth is Supabase email OTP. Contractors use a passcode flow.

---

## 3. Navigation map

Left sidebar has five groups:

1. **My Dashboard** — your personalized homepage (triage + recent submissions)
2. **Churches Dashboard** — master grid of all partner accounts
3. **All In Journey Milestones** (group)
   - Pathway Viewer *(coming soon)*
   - Submit Milestone
   - Milestone Submissions
   - Template Editor
4. **Social Media** (group)
   - SRP Generator *(coming soon)*
   - Intel Audit Tool
   - Prompt Settings *(coming soon)*
   - Planning Calendar *(coming soon)*

---

## 4. Page-by-page walkthrough

### My Dashboard (`/`)

Your personalized homepage. Shows:

- **Needs Triage** — any untriaged partner replies on submissions *you* sent.
  Triaging a reply (Quick Fix, Larger Revision, Start Over, No Action Needed)
  fires an n8n webhook that can create a ClickUp task for you to act on.
- **Recently Submitted** — your latest milestone submissions, clickable to the
  single-partner Account Log.
- Empty state: "Send your first milestone →" button if you're new.

### Churches Dashboard (`/churches`)

Grid of every partner church in the system. Columns: Church name, Member #,
Account Status, Plan, Cohort, Account Manager, Social icons, Web Pathway,
Brand Pathway, Web Milestone, Brand Milestone.

- **Sorting**: default is account_status priority (Trial first, Cancelled last)
- **Filtering**: search (church name or member #), status, plan, cohort, AM
- **Include cancelled toggle**: cancelled accounts are hidden by default for
  performance — flip the toggle to include them
- **Account manager filter** matches any church where the selected person is
  the first-listed AM (so "Ariel Guptill" also matches "Ariel Guptill + Lynsey")
- **Plan normalization** — anything with "All In" shows as "All In";
  anything with "Video" shows as "Video"; "Unlimited" → "Graphics"

Clicking a row opens the single-church detail view.

### Single Church Detail (`/churches/:memberId`)

Eight sections with a sticky side-nav that scrolls with you. Edit toggle in the
sidebar makes info fields editable.

1. **Church Information** — name, member #, website, primary contact, cohort,
   plan, account manager, time zone. Editable (except locked fields like church
   name and member #).
2. **Assets** — Photos, Discovery Questionnaire, Strategy Brief, Notion
   Dashboard, Custom GPT (from `strategy_account_progress`) + all milestone
   submission assets rolled up.
3. **Account Manager Handoff** — "Fill out handoff form" button (external tool)
   + collapsible accordions showing brand + web handoff form content.
4. **Brand Squad** — brand pathway, milestone rollup (most recent expanded),
   brand guide links from `prf_brand_guides`.
5. **Brand Voice** — editable brand voice guidelines (scrollable), Bible
   translation, brand scheduling notes.
6. **Website Squad** — web pathway, milestone rollup, tools (Web Support
   Evaluation, Fix Website, ContentSnare), hosting details, ContentSnare status,
   Web Support Audit results (rendered as pill labels), and **Launch Details**
   (website launched toggle with celebratory treatment, desired launch date,
   likelihood, reason, notes).
7. **Social Media** — church links, Church Intel summary (brand voice tone,
   audience, vocabulary, pastor, denomination, freshness badge), platforms,
   Bible translation, carousel task/Dropbox, Vista Social + Viddrop tools.
8. **ClickUp Tasks** — dept tabs (Website / Branding / Social), 6 tasks per
   dept, showing title, assignee(s), due date, status, link. "View in ClickUp"
   button jumps to the partner's folder.

**Share Portal** button at the top copies the partner-facing portal URL to your
clipboard.

### Submit Milestone (`/submit`) — the 7-step workflow

This is the core flow. Each step is a card; Continue button at the bottom.

**Step 1 — Partner.** Pick the partner by member #. This loads their ClickUp
channel, contacts, and relevant context.

**Step 2 — Milestone.** Pick which milestone you're submitting.
- If the partner already has a submission for this milestone, a prompt asks
  whether it's a **Continuation** (Round 2+) or a new submission.
- If continuation, a sub-prompt asks whether to **reply in the original thread**
  (recommended — keeps all rounds in one conversation) or **post as a new
  channel message**.
- **Ministry Subbrand** pathway shows a "Which subbrand?" picker: pick an
  existing named subbrand (e.g. "Kids Ministry", "Youth") or start a new named
  track. Each subbrand gets its own timeline on the partner portal.

**Step 3 — Sequence.** Confirm the current and next-up milestone. This powers
the "You are here" marker on the partner portal.

**Step 4 — Contact.** Pick one or more partner contacts to tag in the message.
- Available contacts (from `clickup_users` for this partner) show as
  click-to-add pills
- Selected contacts appear as chips above (purple = real @tag, amber = plain
  text)
- **Add custom contact** — if the person isn't in our DB yet, type their name
  + optional email. If the email matches any ClickUp user workspace-wide, they
  get a real @tag; otherwise they render as plain text.
- Multiple contacts join with proper English grammar: "@alice and @bob" or
  "@alice, @bob and @carol".

**Step 5 — Message.** Pick a template (auto-applied based on continuation
status) or write from scratch. Rich text toolbar supports bold, italic, inline
code, bullet list, numbered list, dividers. Per-message toggles for Standard
Footer and All-In Updates Recap — defaults come from the template but can be
overridden here.

**Step 6 — Assets.** Attach asset links (Loom, Figma, Dropbox, Markup, Style
Guide, Mood Board, ContentSnare, Website, Document, Vista Social, Form,
Other). Each has a type + URL + optional label.

**Step 7 — Review.** Final preview showing partner, milestone, sequence,
contacts, assets, and the fully-rendered message with recap and footer
displayed exactly as the partner will see it.

**On Submit:**
- Posts the message to the partner's ClickUp channel as an **announcement
  post** (styled, titled with the milestone name)
- Continuation + thread reply → walks the continuation chain to find the root
  message and replies there instead
- Writes a `strategy_milestone_submissions` row + asset rows
- Auto-approves any earlier-step submissions for the same partner + pathway +
  track (so sending "Logo Design" implicitly marks "Mood Boards" as approved)
- Success screen shows the ClickUp message ID and thread URL

### Milestone Submissions (`/dashboard`)

Sortable/filterable table of every milestone submission across all partners.
Shows member, church, squad, pathway, current milestone, submitter, date, and
workflow status (Sent / Waiting / Partner Replied / In Revision / Approved /
Escalated). "Needs Attention" banner appears when there are untriaged partner
replies.

### Account Log (`/account/:memberId`)

Deep dive on a single partner's milestone history. Every submission shown as a
collapsible card with:

- Status dropdown (manually change workflow status)
- Continuation badge + track name badge where applicable
- Assets, ClickUp channel ID, message ID, thread URL
- **Replies section** — partner replies pulled by the scrub-replies cron,
  groupable by submission, each with a triage dropdown (Quick Fix, Larger
  Revision, Start Over, No Action Needed). Triaging fires a webhook that can
  create a ClickUp task with the reply content.
- Rendered message preview

Squad filter pills at the top let you focus on Brand / Web / Social
submissions only.

### Template Editor (`/templates`)

Admin backend for editing message templates per milestone.

- Left sidebar: every milestone, grouped by squad + pathway, with partner-facing
  toggle per milestone
- Right side: the templates for the selected milestone
- Each template has:
  - Variant name (e.g. "default", "continuation")
  - Subject line (optional)
  - Body with merge field support
  - Active toggle
  - **Default toggles** for Standard Footer and All-In Updates Recap — when
    staff picks this template in Step 5, these are the starting positions
- **Global Text Settings** panel at the top — edits the Standard Footer text
  and All-In Recap labels (applies to every template)
- Merge fields supported in templates:
  `{{church_name}}`, `{{first_name_of_primary}}`, `{{step_name}}`,
  `{{section_group}}`, `{{submitter_name}}`, `{{account_manager}}`,
  `{{partner_contact_name}}`, `{{next_step_name}}`, `{{asset_links}}`

### Intel Audit Tool (`/social/intel`)

The Social squad's Church Intelligence generator. Originally a standalone
Claude artifact, now fully inside the app.

**New profile flow:**
1. Pick a church (list is pre-loaded from our DB; search works by name or
   member #)
2. Confirm/edit the pre-filled church details (website, Instagram, Facebook,
   YouTube, Twitter, LinkedIn)
3. Set denomination, platforms, past work notes, focus notes
4. Upload a homepage screenshot (**required** — used for accurate color
   detection)
5. Optionally upload past work / brand guides / reference files
6. Click Generate — Claude researches the church via web search and builds a
   structured profile (30–60 sec)
7. Review and save to the `strategy_church_intel` table

**Update flow (when the church already has a profile):**
- Existing profile renders inline above the form so you can reference it
- Describe what the church said or what the team learned
- Pick which sections to refresh (Tone, Performance, Design, or Full)
- Click Regenerate — Claude updates only the scoped sections
- Each save bumps `intel_version` and writes a history row

**View saved profile:**
- Deeplink from the Churches Dashboard → `/social/intel?member=123` auto-loads
  the saved profile
- Version history panel shows the last 10 edits with author + reason

The profile JSON structure includes: audience, brand voice (tone summary +
attributes with "write with this in mind" guidance, vocabulary, avoid list),
design (colors, fonts, visual style), per-deliverable guidance (sermon recap
videos, carousel, photo recap, Sunday invite, FB post), CTA patterns, what
performs well, upcoming opportunities, week 1 tip.

### Partner Portal (`/portal/:token`) — public

The only public page. Partners open this via a link our staff copies to them.
Shows their progress as a vertical timeline per pathway (Brand, Web, Social).
Each milestone node shows:

- Completion state (completed / current / upcoming)
- Date of last update
- Attached assets (clickable pills)
- "Open message thread" link to the ClickUp post
- For multi-round milestones: each round as its own labeled block (Round 1,
  Round 2, etc.) with its own date, assets, and thread link
- For Ministry Subbrand: **one timeline per named subbrand track** (e.g. "Kids
  Ministry" shows its own 3-step journey separate from "Youth")

Partners see only partner-facing milestones (admin-toggleable per milestone in
the Template Editor).

---

## 5. Core workflows at a glance

### Sending a normal milestone update
1. `/submit` → pick partner → pick milestone → confirm sequence → pick
   contact(s) → draft message → attach assets → review → send
2. Partner gets a ClickUp announcement
3. Previous-step submissions auto-approve

### Sending a Round 2 / continuation
1. Same flow, but Step 2 prompts with "Previous submission detected"
2. Choose "Continuation" + "Reply inside the original thread" (default)
3. Message posts as a reply in the Round 1 thread
4. Portal shows both rounds under the same milestone, labeled Round 1 / Round 2

### Starting a new Ministry Subbrand track
1. Same flow, Step 2 shows the "Which subbrand?" picker
2. Pick "+ New subbrand" and name it (e.g. "Kids Ministry")
3. Subsequent submissions for this subbrand pick "Kids Ministry" from the
   existing tracks list; continuation detection is scoped per track
4. Portal shows one timeline per named subbrand

### Handling a partner reply
1. Scrub-replies cron detects the reply and flips submission status to
   "Partner Replied"
2. My Dashboard shows it under "Needs Triage"
3. Click the triage dropdown, pick a category (Quick Fix / Larger Revision /
   Start Over / No Action Needed)
4. Webhook fires → ClickUp task created → task URL populated on the reply
5. You can jump straight into that task to handle the edits

### Generating Church Intel
1. `/social/intel` → pick a church → confirm details → upload homepage
   screenshot → generate → review → save
2. Intel now shows on that church's Social Media section of the Churches
   Dashboard
3. Refresh anytime via "Refresh Intel" — scoped or full

---

## 6. What data powers this (simple view)

**Read-only tables** (managed by other systems, we don't write to them — see
CLAUDE.md for a slight exception on `strategy_account_progress`):

- `strategy_account_progress` — the master partner record. Church name, member
  #, contact info, AM, handoff forms, hosting details, brand voice guidelines,
  launch details, and dozens of other partner fields.
- `accounts` — account-level metadata (status, plan, dropbox folder, etc).
- `clickup_chat_channels` — maps member # to the ClickUp channel ID used for
  sending messages.
- `clickup_users` — every ClickUp user in the workspace. Used to resolve @tags
  and look up staff for AM/submitter mentions.
- `employees` — staff directory. Drives login auth, role gating, mentions.
- `prf_brand_guides` — active brand guide links per account.
- `clickup_folders`, `clickup_lists`, `tasks` — ClickUp data mirrored into
  Supabase. Used for the ClickUp Tasks section + task activity analytics.
- `website_support_audit` — Web Support Evaluation results.

**Our tables** (all `strategy_` prefix — we own and write to these):

- `strategy_milestone_definitions` — the canonical list of every milestone
  across all pathways (Brand New, Brand Existing, Ministry Subbrand, Web
  Redesign, Web Audit, Social). Defines step_number, step_name, squad,
  pathway, is_partner_facing.
- `strategy_message_templates` — admin-edited templates tied to milestones.
  Includes variant, subject, body, is_active, include_footer, include_recap.
- `strategy_milestone_submissions` — the log of every milestone submission.
  The source of truth for project progress.
- `strategy_submission_assets` — asset links attached to each submission.
- `strategy_milestone_replies` — partner replies detected by the cron,
  classified with triage categories.
- `strategy_app_config` — single-row table with the editable Standard Footer
  text and All-In Recap labels.
- `strategy_church_intel` + `strategy_church_intel_history` — Church
  Intelligence profiles and version history per church.

---

## 7. Tips and gotchas

- **Always preview Step 7 before sending.** The rendered message is the
  authoritative version — what you see is what the partner sees.
- **@tags fire notifications.** Real @tags are linked by ClickUp user ID;
  plain-text names don't notify anyone. If a contact's name renders in amber
  in Step 6, they'll come through as plain text (no notification). Add their
  email or ask an admin to link them in `clickup_users`.
- **Thread replies require the root message to still exist in ClickUp.** If
  ClickUp has purged an old message, the reply attempt will 404. Fall back by
  choosing "Post as new channel message" in Step 2.
- **Footer toggles in Step 5 override the template defaults.** Template
  defaults are just the starting position — staff can always override per
  message.
- **Intel generation burns Anthropic tokens.** It's a real API call. Don't hit
  "Refresh Intel" idly — use it when there's real new context.
- **Partner portal URLs use a UUID token**, not the member #. Use the "Share
  Portal" button in the Churches Dashboard or Account Log — don't guess the
  URL.
- **Auto-approve of prior steps happens silently.** If you send Step 3 of a
  pathway, Step 1 and Step 2 submissions are marked Approved automatically
  (unless they were already Approved or Escalated). Escalations survive
  auto-approval by design.
- **Ministry Subbrand tracks are isolated.** Sending "Brand Guide" for "Kids
  Ministry" won't approve "Brand Guide" for "Youth" — each subbrand is its
  own journey.

---

## 8. Where to go for help

- **Bugs / feature requests** → ping Ashley
- **Technical deep-dive** → [unified-app-game-plan.md](./unified-app-game-plan.md)
- **Repo** → `sqd-milestone` on GitHub (`churchwebsquad/sqd-milestone`)
- **Hosting** → Vercel project (app) + Supabase (database + edge functions)
