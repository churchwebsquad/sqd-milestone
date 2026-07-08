# Brand Manager Workspace — Starter Prompt for Spencer

> **For Spencer's Claude Code session.** Spencer will paste this into a fresh Claude Code chat inside his local clone of `sqd-milestone`. Everything Spencer's Claude needs to hand-hold him through his first AI-collab build lives in this file. Do not assume prior context.

---

## Table of contents

Numbered sections are searchable by prefix (e.g. `## 3c.iv`). Read section 1, then 14 (your first moves), then 4 (local setup), then jump around as needed.

- **1. Who is Spencer and what are you doing here** — role, ground rules for the collaboration
- **2. Spencer's zone in the repo** — CODEOWNERS + three-phase roadmap
- **3. What you're building (Phase 1 scope)**
  - 3a. Master brand list
  - 3b. Per-church view with tabs
  - 3c. Logo Presentation editor — the main new feature
    - 3c.i.   Mental model — concepts reference existing brand guide assets
    - 3c.ii.  Existing brand guide tables you'll read (do NOT duplicate)
    - 3c.iii. New table `strategy_brand_concepts` + full JSONB shape
    - 3c.iv.  Editor UI — two-pane pattern
    - 3c.v.   Canvas layout — dimensions + module positions (Variant A vs B)
    - 3c.vi.  Concept lifecycle — state machine + SQL
    - 3c.vii. Auto-publish flow on approval — 8 concrete steps
    - 3c.viii.Partner-facing brand review portal — build spec
    - 3c.ix.  Build slices in order (9 slices, smallest first)
    - 3c.x.   Interview questions Spencer must answer for this feature
  - 3d. Partner-facing brand review portal → see 3c.viii
- **4. First-time local setup** — Step 0 (GitHub access + auth) then Prerequisites + Setup steps
- **5. Development flow** — Spencer local, Ashley pushes
- **6. Model on the web team's patterns** — read before writing code
- **7. Gaps to close with Spencer** — the 8 general interview questions
- **8. Supabase tables** — schemas you'll read, tables you'll propose
- **9. ClickUp integration** — how to send chat messages
- **10. Squad API** — creating ClickUp tasks
- **11. Registering new routes in App.tsx** — Ashley's zone, ask first
- **12. Visual design** — palette, typography, components
- **13. Guardrails** — the non-negotiables
- **14. Your first four moves** — start here
- **15. Escalation + support** — Ashley primary, Bennett fallback
- **16. Reference cheat sheet** — file paths, commands, docs

---

## 1. Who is Spencer and what are you doing here

You are **Claude Code** helping **Spencer**, the Branding Director at Church Media Squad (CMS).

- Email: spencer@churchmediasquad.com
- GitHub: `@cms-spencer`
- Repo: `churchwebsquad/sqd-milestone` (also referred to as the "milestone-comms-app" or "strategy app")
- Live URL: strategy.thesqd.com (auto-deployed from `main` via Vercel)

**This is Spencer's first project building alongside a Claude Code session.** He is new to AI-assisted dev and might feel overwhelmed by open-ended "what do you want?" questions. Your job is to make this an easy win — high confidence, small slices, visible progress in the browser at every step.

**Ground rules for the collaboration:**

- **Build in small, visible slices.** Ship one working thing (a static Brand Manager master list showing real churches from Supabase) before moving to editors or reviews.
- **Show him the browser after every change.** Never accumulate 200 lines of code before testing. If you're not sure it renders, refresh together.
- **When you're stuck on ambiguity, propose a default and ask him to confirm — don't leave it open.** "I'm going to render concepts in a 2-column grid unless you'd rather stack them" is easier than "how do you want concepts displayed?"
- **Celebrate wins out loud.** When the first master list renders with real data, say so.
- **Never write in an intimidating voice.** No jargon dumps. If you're using a term he might not know (e.g. "JSONB blob"), define it in one sentence.
- **When something breaks, don't panic.** Show `git status`, show the terminal output, read the actual error together. Assume he doesn't know how to read stack traces yet.

---

## 2. Spencer's zone in the repo

Spencer owns the branding domain. From `.github/CODEOWNERS`:

- `/src/components/brand/`
- `/src/components/churches/BrandSquadSection.tsx`
- `/src/components/churches/BrandVoiceSection.tsx`
- `/src/pages/BrandGuideEditorPage.tsx`
- `/src/pages/BrandingIndexPage.tsx`
- `/src/pages/BrandHandoffPage.tsx`
- `/src/pages/BrandGuidePortalPage.tsx`
- `/src/pages/brand/`
- `/src/lib/brandGuide.ts`
- `/src/lib/brandHandoff.ts`

Any change outside these paths requires a reviewer from `@churchwebsquad` (Ashley). Stay in your lane. Ashley will handle cross-domain scaffolding when needed. If a feature you're building requires touching, say, `src/lib/supabase.ts` or `src/App.tsx` (route registration), pause and ask Ashley — she'll make that specific edit for you or approve you making it.

**The three-phase roadmap Ashley set:**

1. **Phase 1 (this build).** Brand Manager workspace shell + Logo Presentation editor + partner-facing brand review portal. Spencer drives.
2. **Phase 2.** Brand data tracking tab with three OKR metrics. Ashley drives; not Spencer's problem this round.
3. **Phase 3.** Style Finder integration (pulling Spencer's Lovable prototype into the app). Spencer drives with more support once Phase 1 lands.

For Phase 1, the Style Finder tab in the per-church view is a **placeholder that says "Coming soon."** Do not build it now.

---

## 3. What you're building (Phase 1 scope)

Three linked features, all inside a new **Brand Manager workspace**. Route: `/brand-manager` (new — you'll register it in `src/App.tsx` pre-approved by Ashley).

### 3a. Master brand list

- A read-only spreadsheet of every active brand partner.
- One row per partner. Columns: church name, member number, account manager, current brand milestone, days-in-stage, quick link into per-church view.
- Sorted by current brand milestone position (partners further along at bottom or top — ask Spencer his preference in the gap section below).
- Include a search bar at the top to search by member name or church number
- Data source: join `strategy_account_progress` with `strategy_milestone_submissions` filtered to `squad = 'brand'`, showing the most recent submission per member.
- Model on `src/components/wm/workspaces/PagesWorkspace.tsx` — same spreadsheet pattern.

### 3b. Per-church view with tabs

- Click a row in the master list → per-church view.
- Route: `/brand-manager/:memberId`
- Three tabs (in this order): **Style Finder** | **Logo Presentation** | **Brand Guide**
- Style Finder = "Coming soon" placeholder for Phase 1.
- Brand Guide = link out to existing `/churches/:memberId/brand` (that page already exists, don't rebuild it).
- Logo Presentation = new editor, spec below.

Also: link the Brand Manager workspace into `src/components/churches/BrandSquadSection.tsx` on the church dashboard so it's discoverable from the church record.

### 3c. Logo Presentation editor (the main new feature)

This section is the deepest part of Phase 1 and where Spencer needs the most hand-holding. Read it carefully before you propose anything.

#### 3c.i. The mental model

A "logo presentation" is a **fixed-canvas layout** that lays out a church's existing brand assets (logos + colors + optional tagline) in a preset grid, for a partner to review and pick from. Each partner sees N concepts (default 2, editor supports more). The partner picks one, and that pick drives the brand guide going live.

**Critical: the presentation does NOT store new assets.** Everything in a concept — every logo, every color, every tagline — is a REFERENCE to something that already lives in the church's brand guide (`strategy_brand_guides` + its child tables). Spencer uploads a wordmark once via the existing `BrandGuideEditorPage`; the presentation editor just picks which of the church's logos goes in which slot on which color background.

This means:

- The Logo Presentation editor is a **layout editor over an existing asset library**.
- Approving a concept is not about writing new assets — it's about flipping the brand guide to `is_published = true` and (optionally) marking which logo + palette ordering is "the winner."
- You do NOT need a `strategy_brand_guide_publications` table. Ignore my earlier suggestion.

Prerequisite (already exists, do NOT rebuild): the church has a brand guide in `strategy_brand_guides` (or Spencer will create one via the existing editor at `/churches/:memberId/brand`). It has logos, colors, and typography populated. If it doesn't, the Logo Presentation editor prompts Spencer to go populate the brand guide first.

#### 3c.ii. Existing brand guide assets you'll read (do NOT duplicate)

Full schema is in section 8 of this document. Key tables + their real column names:

**`strategy_brand_guides`** (one row per church main brand + one per ministry subbrand)

```typescript
{
  id: string; // uuid — this is what concepts FK to
  member: number; // church member number
  parent_id: string | null; // set for ministry subbrands
  slug: string; // e.g., "tx/lakeway" or "tx/lakeway/kids-ministry"
  display_name: string; // partner-facing name
  is_published: boolean; // toggles the /brand/<slug> portal live
  // ... plus assets_zip_url, animations_url, style_tags, handoff_notes, etc.
}
```

**`strategy_brand_logos`** (child of a brand guide)

```typescript
{
  id: string;
  brand_guide_id: string;
  kind: "primary" | "secondary" | "badge" | "icon"; // ← the enum, only 4 values
  label: string | null; // free-text like "Wordmark", "Mark", "Stacked Lockup", "Monogram"
  preview_url: string; // Supabase Storage URL — the still image
  download_url: string | null; // external Dropbox/Drive link for full-res pack
  animation_url: string | null; // motion version (mp4/webm/Lottie JSON)
  background_color: string | null; // preferred display background hex (e.g., "#1e2a44")
  clear_space_note: string | null; // usage guidance
  sort_order: number;
}
```

The MARKETING TERMS Spencer uses (wordmark / mark / lockup / stacked / badge / monogram) live in `label`, not `kind`. The `kind` enum is structural (primary = main lockup, secondary = alternate lockup, badge = circle/emblem, icon = mark-only). Don't confuse the two.

**`strategy_brand_colors`** (child of a brand guide)

```typescript
{
  id: string;
  brand_guide_id: string;
  name: string | null; // e.g., "Deep Plum"
  tier: "primary" | "secondary" | "accent" | "light" | "dark";
  interface_role: "background" | "text" | null; // staff-only, for portal theming
  hex: string; // "#341756"
  cmyk: string | null; // "C M Y K" (space-separated)
  rgb: string | null; // "R G B" (space-separated)
  pms: string | null; // Pantone code
  proportion_pct: number | null; // % of usage in palette hierarchy bar
  on_color_logo_url: string | null; // ← IMPORTANT: pre-rendered logo on THIS color
  on_color_logo_scale_pct: number | null; // scale 10-200
  sort_order: number;
}
```

**Note the `on_color_logo_url` field.** Each color can already have a hand-picked logo rendered against it — Spencer uploads this in the existing editor's "OnColorExamplesEditor" section. When you render a logo-on-color slot in the Presentation editor, prefer `on_color_logo_url` if set (Spencer has intentionally paired that logo with that color); fall back to overlaying `logo.preview_url` on a `background-color: <hex>` div otherwise.

**`strategy_brand_typography`** (child of a brand guide)

```typescript
{
  id: string;
  brand_guide_id: string;
  tier: "primary" | "subheading" | "secondary" | "accent";
  family_name: string; // "Neue Haas Grotesk"
  weight: string | null; // technical: "400, 700"
  weight_label: string | null; // client-friendly: "Bold"
  suggested_use: string | null;
  letter_case: string | null; // e.g., "UPPERCASE"
  font_url: string | null; // Google Fonts URL or uploaded webfont
  web_font_family: string | null; // CSS family
  // ... plus custom_font_purchase_url, free_alt_*, sort_order
}
```

**Load helper** (already exists in `src/lib/brandGuide.ts`):

```typescript
import { loadMainGuideByMember } from "../lib/brandGuide";

const bundle = await loadMainGuideByMember(memberId);
// bundle: BrandGuideBundle | null
// bundle.guide, bundle.logos, bundle.colors, bundle.colorCombinations,
// bundle.typography, bundle.elements, bundle.voiceAttributes,
// bundle.voiceGuidelines, bundle.attributes, bundle.customSections
```

One call, everything you need. Use this in the Logo Presentation editor — do not write your own queries.

For ministry subbrands: `loadSubbrandsFor(parentGuideId)` returns `StrategyBrandGuide[]`, then `loadGuideBySlug(subbrandSlug)` for a full subbrand bundle. Phase 1 focus is the main guide; ministry subbrand presentations are a Phase 1.5 concern — get the main-brand flow working first.

#### 3c.iii. New table: `strategy_brand_concepts` (needs Ashley's approval first)

A concept is a layout config. It stores IDs pointing into the brand guide, not asset content.

```sql
create table strategy_brand_concepts (
  id                        uuid primary key default gen_random_uuid(),
  brand_guide_id            uuid not null references strategy_brand_guides(id) on delete cascade,
  concept_number            int not null,     -- ordering (1, 2, 3...) unique per brand_guide_id
  concept_label             text,             -- optional custom name like "Modern Direction"
  status                    text not null default 'draft'
    check (status in ('draft','published','approved','archived')),
  partner_token             uuid unique,      -- v4 UUID; generated on publish; the public URL credential
  layout                    jsonb not null default '{}'::jsonb,  -- see schema below
  published_at              timestamptz,
  approved_at               timestamptz,
  approved_by_partner_email text,
  approved_by_partner_name  text,
  created_by                text,             -- staff email
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (brand_guide_id, concept_number) where (is_active)
);
create index on strategy_brand_concepts (brand_guide_id) where is_active;
create index on strategy_brand_concepts (status) where is_active;
create index on strategy_brand_concepts (partner_token) where partner_token is not null;
```

**`layout` JSONB shape** (this is the whole spec — copy verbatim into a TS type):

```typescript
interface ConceptLayout {
  // Header module — auto content unless overridden
  header?: {
    concept_label_override?: string; // display instead of "Concept N"
    concept_number_override?: string; // display instead of "001"
  };

  // Color palette bar — ordered list of color IDs (references strategy_brand_colors.id)
  palette_bar?: {
    color_ids: string[]; // 3-8 colors; renders swatches with hex labels
    show_names?: boolean; // default true — show Name (Hex) label under swatch
  };

  // Feature card — hero module with a big logo on a color
  feature_card?: {
    logo_id: string; // references strategy_brand_logos.id
    bg_color_id: string; // references strategy_brand_colors.id
    tagline?: string; // optional overlay text; empty = no tagline
  };

  // Logo variant grid — N slots, each = one logo on one color bg
  logo_variant_grid?: Array<{
    logo_id: string;
    bg_color_id: string;
    scale_pct?: number; // default 100; range 40-140
  }>;

  // Detail closeup — optional right-column full-height module
  detail_closeup?: {
    logo_id: string;
    bg_color_id: string;
    // No crop coords for v1 — CSS object-fit handles it. Add later if needed.
  };

  // Tagline module — optional standalone card
  tagline_module?: {
    text: string;
    text_color_id: string; // color for the text (references strategy_brand_colors.id)
    bg_color_id: string; // background color
  };

  // Footer is auto: concept_number bottom-left, "Church Media Squad" bottom-right
}
```

**`strategy_brand_reviews`** (needs Ashley's approval too — see section 8 for the sketched shape). Feedback JSONB shape specific to this feature:

```typescript
interface BrandReviewFeedback {
  overall_decision: "approve" | "request_changes" | "no_decision";
  picked_logo_id?: string | null; // partner's single favorite variant across the grid
  palette_feedback?: {
    flagged_color_ids?: string[]; // colors the partner wants changed
    notes?: string; // freeform
  };
  logo_variant_notes?: Array<{
    // per-slot notes if the partner leaves any
    logo_id: string;
    reaction: "love" | "like" | "meh" | "no";
    note?: string;
  }>;
  tagline_feedback?: string;
  general_notes?: string;
}
```

Both tables need Ashley's approval before you run `CREATE TABLE`. In the approval message, cover: (a) why the shape can't be an `ADD COLUMN` on an existing table, (b) the trade-offs of JSONB vs discrete columns for `layout` and `feedback`.

#### 3c.iv. Editor UI — two-pane pattern

Model the editor on `BrandGuideEditorPage.tsx` and `SitemapReviewEditor.tsx`. Two panes:

- **Left pane: canvas preview.** Renders the concept exactly as the partner will see it, in a fixed-aspect frame (see 3c.v for canvas dimensions). This is the WYSIWYG side. Reads `layout` JSONB + brand guide bundle, renders the modules.
- **Right pane: form controls.** Grouped by module. Each module has:
  - A header (module name + optional toggle "include in presentation")
  - Slot controls (dropdowns for `logo_id` selection, color swatches for `bg_color_id`, sliders for `scale_pct`, text inputs for overrides)
  - Add/remove buttons for the `logo_variant_grid` array

Additional editor UI elements:

- **Concept switcher tab strip at the top:** "Concept 1 · Concept 2 · + Add Concept". Default max in UI = 5, but the data model allows more.
- **Status pill** next to the concept name: Draft (gray) / Published (purple) / Approved (green) / Archived (muted).
- **Action buttons** in the header area:
  - "Publish to partner" (draft → published, generates `partner_token`, sends ClickUp invite)
  - "Copy partner link" (once published)
  - "Duplicate concept" (creates a new draft cloning this concept's layout)
  - "Archive concept" (soft-delete; only visible if status = 'draft' or 'published' — approved concepts can't be archived)
- **"View as partner" button:** opens `/portal/brand-review/:token` in a new tab so Spencer can QA before sending.

If the brand guide has no logos or no colors, the editor shows a blocking empty state with a link to `/churches/:memberId/brand` to populate the guide first. Do not let Spencer create concepts against an empty guide — he'll just get frustrated.

#### 3c.v. Canvas layout — fixed dimensions + module positions

**Canvas aspect: 16:9** (matches presentation-style delivery Spencer's used to). Concrete pixel size: **1600 × 900** at 100% zoom in the editor. Downscale responsively for smaller viewports (`max-width: 100%`, preserve aspect ratio via `aspect-ratio: 16/9`).

**Two layout variants** (pick default via gap question — see 3c.ix):

**Variant A — Lighthouse-style (polished follow-up, matches `lighthouse.png`):**

Dark canvas background derived from the color with `interface_role = 'background'` (fallback: darkest color, or `#341756` Deep Plum if no color qualifies). Module cards float on the dark bg with rounded 16px corners.

Grid (12-column, 8-row):

```
┌──────────────────┬────────┬──────────────┬────────┐
│                  │ feature│  feature     │ detail │
│  wordmark card   │ mark   │  lockup      │ closeup│
│                  │        │  on color    │        │
│                  ├────────┤              │        │
│                  │palette │              │        │
│                  │  bar   │              │        │
├──────────────────┼────────┼──────────────┤        │
│                  │        │              │        │
│ tagline card     │ mark   │ stacked      │        │
│                  │  alt   │ wordmark     │        │
│                  │        │              │        │
└──────────────────┴────────┴──────────────┴────────┘
```

Approximate cell math (in a 12-col × 8-row grid):

- Wordmark card (col 1-5, row 1-4)
- Feature card (col 6-9, row 1-6) — the hero
- Detail closeup (col 10-12, row 1-8) — full-height right column
- Palette bar (col 6-9, row 4-5)
- Logo variant grid tiles (row 5-8 in remaining cells)
- Tagline card (col 1-5, row 5-8)

Header: 60px band at top with church name (left) + concept label (right).
Footer: 40px band at bottom with concept number (left) + "Church Media Squad" (right).

**Variant B — Christ Community-style (recommended default, ship-first MVP, matches `christ-community.png`):**

Cream canvas background (`#F9F5F1`). No rounded module cards; direct tiles butted against each other.

Row 1: five color swatches + one big brand statement card
Row 2-3: 2×3 grid of logo variants on brand colors
Optional right column: detail closeup

Simpler to build; less "designed" feel. Good MVP.

**Recommendation for Spencer:** build Variant B first (simpler, ships faster), design Variant A as a follow-up polish pass. Spencer can toggle between variants via a `layout_variant: 'compact' | 'polished'` field in the JSONB (add this to the `ConceptLayout` type when you get there).

#### 3c.vi. Concept lifecycle — state machine

```
draft ──publish──> published ──partner_approves──> approved
  │                    │                              │
  │                    ├──partner_requests_changes──> draft (bounces back)
  │                    │
  │                    └──spencer_archives──> archived
  │
  └──spencer_archives──> archived
```

**Transitions:**

- **Create concept.** Spencer clicks "+ Add Concept" in the tab strip. Row inserted with `status='draft'`, next `concept_number`, empty `layout: {}`, no `partner_token`.
- **Edit draft.** Every form change patches the `layout` JSONB. Autosave with 500ms debounce (model on how `BrandGuideEditor` handles saves — it uses explicit "Save section" buttons; you can do that OR autosave, ask Spencer's preference).
- **Publish (draft → published).** Spencer clicks "Publish to partner." Behavior:
  1. Generate `partner_token = crypto.randomUUID()` (or Postgres `gen_random_uuid()`).
  2. Set `status='published'`, `published_at=now()`.
  3. Look up the partner's ClickUp channel via `clickup_chat_channels.memberid = member`.
  4. Send a ClickUp chat message via `sendClickUpMessage()` with the review link. Copy comes from a `strategy_message_templates` row Spencer edits in the Template Editor (create a new template variant, e.g., `template_variant='brand_logo_presentation_invite'`).
  5. UI updates the concept tab to status='published' + surfaces the shareable link.
- **Partner approves.** Runs the auto-publish flow (see 3c.vii below).
- **Partner requests changes.** Sets `status='draft'` (bounces back to Spencer). Feedback row created in `strategy_brand_reviews`. Spencer sees a "Changes requested" banner + a link to the review feedback.
- **Archive.** Spencer clicks "Archive." Sets `is_active=false`. Never delete rows — always soft-delete for audit trail.

**Rule: only one concept can be `approved` per `brand_guide_id`.** When an approve happens, the flow (below) sets every other concept for that guide to `status='archived'`.

#### 3c.vii. Auto-publish flow on approval (concrete steps)

When a partner submits with `overall_decision='approve'` on a concept, run this sequence in a Supabase Edge Function (safer than doing it client-side). New function: `supabase/functions/brand-concept-approve/index.ts`.

1. **Mark the approved concept.**
   ```sql
   update strategy_brand_concepts
     set status='approved',
         approved_at=now(),
         approved_by_partner_email=$partner_email,
         approved_by_partner_name=$partner_name
     where id=$concept_id;
   ```
2. **Archive all other concepts for this brand guide.**
   ```sql
   update strategy_brand_concepts
     set status='archived', updated_at=now()
     where brand_guide_id=$brand_guide_id
       and id != $concept_id
       and status in ('draft','published')
       and is_active=true;
   ```
3. **Reorder the brand guide's colors + logos to prioritize the approved concept.**
   - For each color in `layout.palette_bar.color_ids` in order, set `strategy_brand_colors.sort_order = <index>`.
   - For the logo in `layout.feature_card.logo_id`, set `strategy_brand_logos.sort_order = 0` (first).
   - Other logos keep their existing order.
4. **Publish the brand guide portal.**
   ```sql
   update strategy_brand_guides
     set is_published=true, last_updated_at=now()
     where id=$brand_guide_id;
   ```
   The public portal at `/brand/<slug>` now serves live.
5. **Advance the ClickUp task chain.** Look up the "Logo Presentation" milestone task for this partner in ClickUp. Mark it complete. Auto-mark "Brand Guide Publication" complete (since we just did it above). Advance to "Deliverables Handoff" and assign it to Spencer via the Squad API.
6. **Send celebratory ClickUp chat message.** Look up the channel via `clickup_chat_channels.memberid`. Call `sendClickUpMessage()` with a top-level post (not a thread reply) using the template Spencer draft-writes in gap question #5. The message includes the brand guide portal URL (`https://strategy.thesqd.com/brand/<slug>` — actually served at brand.thesqd.com or wherever the portal lives; verify with Ashley).
7. **Post an internal Slack notification.** If `.env` has `VITE_N8N_TRIAGE_WEBHOOK_URL` or similar configured, POST a payload to the n8n webhook. Otherwise skip.
8. **Return success to the partner review portal**, which then shows a celebration screen ("Thanks — your brand is on its way!").

Wrap steps 1-4 in a single Postgres transaction if possible so a mid-flight failure doesn't leave the DB in a half-approved state. Steps 5-7 are best-effort (log failures, don't fail the whole approval).

#### 3c.viii. Partner-facing brand review portal — the concrete build

URL: `/portal/brand-review/:token` (Ashley registers the route in `App.tsx`).

**Page structure** (model on `PortalReviewPage.tsx`):

1. **Header band.** Church logo top-left (from the brand guide's primary logo), "Review your new brand" welcome text, name-capture on first visit.
2. **Concept tabs.** One tab per published concept for this brand guide. Default active = concept 1. If only one concept is published, no tab strip — just the single concept.
3. **Concept canvas.** The exact layout as rendered in Spencer's editor (variant A or B). Full 16:9 canvas, responsive scaling on mobile.
4. **Per-module feedback slide-outs.** Clicking any module opens a drawer with feedback controls specific to that module type:
   - **Palette bar drawer:** Checkboxes per color ("Change this color" toggle) + freeform notes textarea. Writes to `feedback.palette_feedback`.
   - **Logo variant tile drawer:** Reaction picker (love / like / meh / no) + optional note. Writes to `feedback.logo_variant_notes[]`.
   - **Feature card drawer:** Overall reaction + note.
   - **Tagline drawer:** Freeform text: "Prefer this wording:" input.
5. **Overall decision bar at the bottom** (sticky):
   - Big pill button: **Approve concept 1** (primary Deep Plum with → arrow)
   - Secondary link: **Request changes** (opens a general feedback modal, then submits with `overall_decision='request_changes'`)
6. **Submit flow.**
   - Serialize the accumulated feedback state into `BrandReviewFeedback`.
   - `INSERT` into `strategy_brand_reviews` with `partner_token`, `concept_id`, feedback JSONB.
   - If `overall_decision='approve'`: invoke the `brand-concept-approve` Edge Function.
   - If `overall_decision='request_changes'`: create a ClickUp task in the partner's brand list with the feedback summary + post a chat reply in the milestone thread. Send Spencer a Slack ping if configured.
   - Show partner a celebration or "we'll get back to you soon" confirmation screen.

Reuse from `PortalReviewPage.tsx`: name capture (localStorage keyed by `partner_review_${token}_name`), the closed/expired review handling, the general partner-facing header polish.

#### 3c.ix. First slices for the Logo Presentation build (do NOT try to build it all at once)

After the master list (which is section 14 move #4 — Phase 1's first slice), tackle this editor in these micro-slices, IN ORDER. Test in the browser after each. Message Ashley for review after each. Merge to main between slices.

**Slice 2: Empty concept editor shell.** Route `/brand-manager/:memberId` with a placeholder for Style Finder + Brand Guide tabs and the Logo Presentation tab loading a brand guide bundle via `loadMainGuideByMember(memberId)`. Display "No brand guide yet — populate one here first" if the load returns null. If a bundle loads, display a "+ Add Concept" button and a placeholder canvas. No form yet. No storage yet.

**Slice 3: Concept CRUD (no rendering yet).** After Ashley approves the new tables, wire up: add concept, delete/archive concept, edit basic concept fields (concept_label). Concepts persist to `strategy_brand_concepts`. Concept switcher tab strip works. Still no canvas rendering — just names and status pills.

**Slice 4: Palette bar module.** First real module. Right pane shows a color-picker interface pulling from the brand guide's colors. Spencer picks 4-6 colors in order. Left pane renders the swatches with hex labels. This is the smallest slice that exercises the "reference existing brand guide asset by ID → render on canvas" pattern.

**Slice 5: Feature card + logo variant grid.** Add the logo-picker (dropdown listing all logos with `kind` + `label` + tiny preview), the color-bg-picker (same as palette module), and the scale slider. Render the logo over the color-bg on the canvas. When a color has `on_color_logo_url` set, prefer it; otherwise overlay `preview_url` on `background-color: <hex>`.

**Slice 6: Detail closeup + tagline module.** Same pattern.

**Slice 7: Publish flow (partner_token generation + ClickUp invite).** No approval flow yet — just the ability to publish a draft, get a shareable link, and paste it into a browser to see the partner view. The partner view at this slice can be read-only (no feedback controls yet).

**Slice 8: Partner review portal — module feedback drawers + submit.** Feedback writes to `strategy_brand_reviews`. `request_changes` submits work end-to-end. `approve` submits are stubbed (no Edge Function yet — just mark the row).

**Slice 9: `brand-concept-approve` Edge Function** — full auto-publish flow (steps 1-8 from 3c.vii). This is the biggest slice; expect it to take a whole session.

**Slice 10: Layout Variant A (polished dark canvas)** — pass over the rendering to add the polished variant Spencer picks between via `layout_variant` field. Only tackle after everything else works.

Slices 2-4 are safe territory for Spencer's first commits. Slice 5 is where the rendering gets tricky — pair-program that one carefully. Slice 9 is where a mistake could send a wrong ClickUp message to a real partner, so require Ashley's review before deploying that slice.

#### 3c.x. Interview questions Spencer specifically needs to answer for THIS feature

In addition to the 8 general gaps in section 7, ask Spencer these Logo Presentation-specific questions during the interview:

1. **Layout variant preference.** Which layout should be default — the compact Christ Community style (Variant B) or the polished Lighthouse style (Variant A)? Recommendation: default Variant B (simpler, ships faster), add Variant A later.
2. **Tagline stability.** Is the church's tagline stable per church, or do you sometimes propose different taglines per concept? (Determines whether tagline lives on the brand guide as one field or on each concept.)
3. **Logo variant grid size.** How many logo-on-color tiles do you usually show — 4? 6? 8? Should the number be fixed or does it vary per concept?
4. **Autosave vs Save button.** Do you want the editor to autosave (like Google Docs) or have explicit "Save section" buttons like the existing `BrandGuideEditor` uses? Autosave is safer, save buttons feel more deliberate.
5. **Partner's granularity of feedback.** When partners give feedback on a concept, is it usually one overall thumbs-up/down, or do they weigh in per-module (love the palette, hate the wordmark)? Determines whether the drawer-per-module UX is worth the build.
6. **Partial approvals.** Do partners ever say "I want the wordmark from concept 1 but the palette from concept 2"? If yes, we need a "mix" mode. If no (they always pick one whole concept), we keep it simple.
7. **Approval side effects.** When a partner clicks Approve today, what happens next for you? Do you always publish the brand guide immediately, or is there a review step? (Determines whether "approve" auto-publishes or just flags it for Spencer to confirm before publishing.)
8. **Existing pdfs / decks.** How do you present concepts today — Figma? PDF? Keynote? Attach an example so Spencer's Claude can eyeball the visual density and modules you already have muscle memory for.

Restate each answer back to Spencer before moving on. Do NOT proceed to slice 3 (real CRUD) until these are locked.

**Reference the layouts Ashley shared** (committed in this repo — open them in VSCode or via GitHub to view):

- Compact style, matches Variant B: `handoffs/logo-presentation-references/christ-community.png`
- Polished style, matches Variant A: `handoffs/logo-presentation-references/lighthouse.png`

Read both with your Read tool before designing the canvas layout so you can eyeball the actual visual density and module proportions instead of imagining them.

### 3d. Partner-facing brand review portal

The full spec for this lives in **section 3c.viii** (partner review portal is the surface the Logo Presentation editor publishes into). URL pattern: `/portal/brand-review/:token`. Model on `src/pages/PortalReviewPage.tsx`. Everything you need — feedback shape, module drawers, submit routing to the Edge Function — is in 3c.viii.

---

## 4. First-time local setup (walk Spencer through this, block off an hour or two)

This is the biggest hurdle. Do NOT move past the final step until the local app is running with real data and hot reload works. If setup takes 90 minutes or more, that's normal — that's your first win. Spencer has never done a local clone before, so start from the very beginning even if the steps feel obvious.

### Step 0: GitHub access + how the local flow actually works

Spencer is already a collaborator on the GitHub repo (`churchwebsquad/sqd-milestone`), but he may not have accepted the invite yet, and he's never authenticated Git on his laptop. Get him to a place where he can actually clone before doing anything else.

**1. Confirm GitHub account access.**

- Open https://github.com in a browser.
- Log in. Ashley invited him under his primary GitHub username (he'd have received an email; if he doesn't have a GitHub account yet, this is the moment to make one at https://github.com/join with his churchmediasquad.com email).
- Check for a pending invitation — the notification bell (top-right) or https://github.com/churchwebsquad/sqd-milestone/invitations. Accept it.
- Once accepted, visit https://github.com/churchwebsquad/sqd-milestone. He should see the repo file tree. If he sees a 404, Ashley needs to re-invite — ping her.

**2. Explain the local dev flow to him — in one paragraph.**

> "The code we're going to change lives on GitHub. GitHub is the master copy. Right now, the `main` branch is what runs at strategy.thesqd.com. We're going to make a copy of the code on your laptop, create a new branch (like a scratch pad), edit it locally, test it in a browser running on your laptop, and when it's ready, Ashley will merge our branch into `main` and Vercel automatically deploys it. You'll never touch `main` directly."

Confirm he can name the three places code lives: his laptop (local), GitHub (remote), and strategy.thesqd.com (deployed). If any of those are hazy, re-explain.

**3. Get GitHub authentication working (via VSCode).**

Git needs a stored credential to prove Spencer is Spencer when he runs `git clone` or `git push`. The simplest way to get one in 2026 — no SSH keys, no personal access tokens, no CLI fiddling — is to sign in through VSCode after it's installed. VSCode handles the OAuth flow with GitHub, saves the credential to the operating system's keychain (macOS Keychain on Mac, Credential Manager on Windows), and Git picks it up automatically from that point on.

Spencer will do this in **step 4** below (right after installing VSCode). The one-line explanation to give him:

> "When you first open VSCode, look for a 'Sign in to GitHub' prompt in the bottom-left status bar, or open the Command Palette (Cmd+Shift+P on Mac, Ctrl+Shift+P on Windows), type 'GitHub: Sign in', and follow the browser prompt. That's your Git auth. You won't ever have to type a password again."

Do NOT walk him through SSH keys or personal access tokens unless VSCode's sign-in fails for some reason. Those exist as fallbacks documented at https://docs.github.com/en/authentication if we ever need them.

If Spencer prefers a terminal-only workflow later, he can install the GitHub CLI (`brew install gh` on Mac, `winget install GitHub.cli` on Windows) and run `gh auth login`. Both `gh` and VSCode write to the same OS keychain, so they don't conflict. But VSCode sign-in alone is enough for everything in this build.

**4. Install VSCode as his code editor.**

Spencer is using **Claude Code Desktop** (the Anthropic desktop app) to talk to you — that's his AI-collab interface. He still needs a separate **code editor** to actually see + edit files, run a terminal, and view the browser. **VSCode is the recommendation** — free, well-documented, huge community, works identically on Mac + Windows.

- Install from https://code.visualstudio.com/download. Pick the installer for his OS. Run it, accept defaults.
- Open VSCode once it's installed to confirm it launches.
- After he clones the repo (later in this section), he'll open the cloned folder in VSCode via `File > Open Folder` and pick the `sqd-milestone` directory.

**How Claude Code Desktop and VSCode work together:**

- **VSCode** = where Spencer sees the code, edits files (though usually you'll edit them via tools), and runs terminal commands.
- **Claude Code Desktop** = where he talks to you and where you run tools. You can edit files, run commands, and read code across the whole repo; he sees the results reflected in VSCode.
- Keep both open, side by side. When you make a change, tell Spencer to look at the file in VSCode to see it.

**5. Where he'll type terminal commands.**

- **Preferred: VSCode's built-in terminal.** Once VSCode is open on the cloned repo, press Ctrl+backtick (Windows) or Cmd+backtick (Mac). A terminal opens at the bottom of the window, already scoped to the repo directory. This is the cleanest option — he sees files + terminal in one window.
- **Fallback: Terminal app** (Mac: Cmd+Space, type "Terminal") or Git Bash (Windows: installed alongside Git).
- If you (Claude) run commands via your own tools, they execute in the same repo context. Spencer doesn't have to type most commands himself — you'll run them and he'll see the output.

Don't advance to Prerequisites until steps 1-5 are done. If accepting the invite fails, VSCode's GitHub sign-in errors, or VSCode won't install, screenshot and ping Ashley.

### Prerequisites

Check with Spencer whether he has these. If not, help him install:

- **Git** — check by opening VSCode's terminal and running `git --version`. If missing: install from https://git-scm.com/download (Windows) or run `brew install git` (Mac; installs [Homebrew](https://brew.sh) first if needed).
- **Node.js 20+** — check with `node --version`. If missing: install the LTS version from https://nodejs.org (Windows or Mac) or run `brew install node` (Mac).
- **VSCode + GitHub sign-in** — done in Step 0 above.

### Setup steps

1. **Clone the repo (HTTPS — VSCode's stored credential handles auth):**

   ```
   git clone https://github.com/churchwebsquad/sqd-milestone.git
   cd sqd-milestone
   ```

   If Git prompts for a username and password, the VSCode sign-in from Step 0 didn't take. Ping Ashley — do NOT type a password (GitHub deprecated password auth years ago; whatever Spencer types will fail). The fix is usually to re-run "GitHub: Sign in" from VSCode's Command Palette.

2. **Install Node dependencies:**

   ```
   npm install
   ```

   This takes 2-3 minutes the first time.

3. **Set up environment variables:**

   ```
   cp .env.example .env
   ```

   **For local dev you only need the three `VITE_`-prefixed keys** — everything else in `.env.example` is used by server-side runtimes (Supabase Edge Functions, Vercel API routes) that already have their own copies. Leave the server-only keys as their placeholder values in `.env`; they won't be read by the Vite dev server.

   The three keys you need filled in:
   - `VITE_SUPABASE_URL` — Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — Supabase anon key (public-facing, shipped in the browser bundle)
   - `VITE_CLICKUP_API_TOKEN` — ClickUp API token (browser scope)

   **How to get the values — pick ONE, do NOT ask over Slack DM:**
   - **Option A (recommended): 1Password.** Ashley will share a "sqd-milestone dev env" item in a CMS shared vault. Copy the three values from 1Password into your `.env`. Never paste API keys or tokens into Slack, even in a DM — Slack messages are searchable by workspace admins and get exported in retention dumps.
   - **Option B: `vercel env pull`.** If you have Vercel access to the `sqd-milestone` project, this is the cleanest path:
     ```
     npm install -g vercel        # if you don't have the CLI yet
     vercel login                 # authenticate with your churchmediasquad.com account
     vercel link                  # link your local clone to the Vercel project
     vercel env pull .env.local   # pulls the current env into .env.local
     ```
     Vite reads `.env.local` in addition to `.env`, so this Just Works.
   - **Option C (last resort): screen-share with Ashley** so she can paste the values directly into your `.env` on your machine. Nothing gets logged anywhere. Only use this if 1Password + Vercel are both unavailable.

   **Never commit `.env` or `.env.local`.** Both are in `.gitignore` — double-check with `git status` before every commit. If you ever accidentally stage one, `git restore --staged .env` unstages it.

   **What all the other env vars in `.env.example` are for** (context only — you do NOT need real values for these locally):
   - `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS, used only by Supabase Edge Functions
   - `CRON_SECRET` — auth for scheduled jobs
   - `CLICKUP_MILESTONE_API_TOKEN` — server-side ClickUp token used by Edge Functions
   - `VITE_N8N_TRIAGE_WEBHOOK_URL`, `N8N_REPLY_TRIAGE_WEBHOOK_URL` — n8n webhooks (used by triage flows)
   - `SRP_N8N_*` — Sermon Reel Pipeline webhooks (Social squad, not brand)

   If a feature you're building later needs one of the server-only keys (unlikely for Phase 1), ask Ashley — she'll add it to Vercel + Supabase directly rather than sending you the value.

4. **Start the local dev server:**

   ```
   npm run dev
   ```

   Vite will print a URL, usually http://localhost:5173.

5. **Open http://localhost:5173 in your browser.** You should see the login page.

6. **Log in with your churchmediasquad.com email.** Supabase Auth already recognizes CMS staff. If login fails, screenshot the error and ping Ashley.

7. **Confirm hot reload works.** Make a tiny visible change (e.g., change a heading text in `src/pages/BrandingIndexPage.tsx`), save the file, watch the browser update without a manual refresh. Then undo the change. This confirms your dev loop is working.

If step 6 or 7 fails, STOP. Screenshot the terminal output and the browser, paste into Slack, wait for Ashley. Do not try to fix env issues by editing `src/lib/supabase.ts` — the problem is almost always in `.env`.

### Other useful commands

- `npm run typecheck` — TypeScript check across the whole project. Run before asking for a merge.
- `npm run lint` — ESLint. Run before asking for a merge.
- `npm run build` — production build (Vite). Only needed if you want to verify the prod bundle builds.

---

## 5. Development flow — Spencer local, Ashley pushes

**Spencer works entirely locally at http://localhost:5173.** Ashley (or another `@churchwebsquad` reviewer) merges branches into `main`. Vercel auto-deploys from `main` — that's how strategy.thesqd.com updates.

Spencer does NOT have permission to push to `main` directly. Attempting to will be rejected by GitHub. Pushing his own branch to origin is safe.

### Working on the feature

1. **Create your branch:**
   ```
   git checkout -b brand-manager-workspace
   ```
2. **Make changes.** Save files. Vite hot-reloads at http://localhost:5173. Check the browser after every change.
3. **Commit often, locally:**
   ```
   git add .
   git commit -m "brand manager: master list renders churches from supabase"
   ```
   Local commits stay on your machine until you push your branch. Commit whenever a small piece works — you'll thank yourself when something breaks and you want to roll back to a working state.
4. **If something breaks:**
   - `git status` shows what's changed.
   - `git diff` shows the exact changes.
   - `git checkout -- <file>` reverts unstaged changes to a specific file (careful — deletes unsaved work).
   - `git stash` saves current changes and reverts to clean, `git stash pop` restores them.
5. **No em-dashes** in code or copy. This is a hard rule. Double-check before every commit. Use commas, periods, or parentheses instead.

### When you're ready for Ashley to review + merge

Don't rush this step. Only message Ashley when you're actually happy with what you've built locally.

1. **Test one final time in the browser.** Every feature works? Real data renders? No console errors? Screenshot the working state.
2. **See what you've done:**
   ```
   git log --oneline main..brand-manager-workspace
   ```
   Lists every commit on your branch since it diverged from main.
3. **Push your branch to origin** (safe, does NOT touch `main`):
   ```
   git push -u origin brand-manager-workspace
   ```
   First push, Git might prompt for auth. If SSH is set up you're fine. If not, use a personal access token (see https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
4. **Draft a Slack message to Ashley.** Template:

   ```
   Hey Ashley — brand manager first slice is ready for review.

   Branch: brand-manager-workspace
   What's in it:
   - [feature 1 in one line]
   - [feature 2 in one line]

   Tested locally:
   - [ ] Master list renders with real Supabase data
   - [ ] Sort by milestone works
   - [ ] Click-through to per-church view shows placeholder tabs
   - [ ] No console errors

   Screenshots: [attach]

   Open questions: [anything you're unsure about]

   Ready when you are to review + merge.
   ```

5. **Ashley pulls the branch, reviews the code, runs it locally on her machine, then merges into `main`.** Vercel auto-deploys to strategy.thesqd.com from there. She'll DM you when it's live.

**Do NOT try to push to `main` directly.** `git push origin main` will be rejected by GitHub branch protection. `git push origin brand-manager-workspace` is fine.

**If you get lost in git state, don't panic.** Ask Spencer to paste `git status` and `git log --oneline -5` output into Slack — Ashley can read it and unblock him together.

---

## 6. Model on the web team's patterns (review before writing code)

The web team has already built the patterns you'll reuse. Do NOT reinvent — extend, adapt, copy.

**Read these files end-to-end first (30-45 minutes, no code):**

- `src/pages/PortalReviewPage.tsx` — **the pattern for the partner-facing brand review portal.** Partner-facing, no login, structured feedback fields, submit → ClickUp task. Note: partner name is captured on first visit via `localStorage` keyed by token. The route is `/portal/review/:token`, wired in `src/App.tsx` line 114.
- `src/components/wm/workspaces/PagesWorkspace.tsx` — **the pattern for the Brand Manager master list.** Read the file header comment for the two-pane authoring surface pattern. Your master list is the "left pane" equivalent; the per-church view is the "right pane."
- `src/components/wm/workspaces/DevHandoffWorkspace.tsx` — multi-panel workspace pattern with collapsible sub-panels. Useful for the per-church view.
- `src/components/wm/sitemapReview/SitemapReviewEditor.tsx` — **section-band editor pattern.** Useful for the Logo Presentation editor (each module = a section band with its own editable fields).
- `src/pages/BrandGuideEditorPage.tsx` — Spencer already knows this one. It has the logo upload, logo-on-color background rendering, color palette storage. You'll reuse these components in the Logo Presentation editor.
- `src/pages/SubmitFormPage.tsx` + `src/lib/clickup.ts` — how a form submission triggers a ClickUp chat message. You'll reuse this pattern.

**Do NOT read these — they're too deep for this build:**

- Anything under `src/lib/cowork/` (that's the AI content pipeline, separate from brand work)
- Anything under `src/lib/acfFormationPlan/` (dev handoff plan for WordPress, separate)
- `src/lib/webBrixiesRender.ts` (Brixies rendering pipeline, web-specific)

---

## 7. Gaps to close with Spencer BEFORE writing code

Ashley + you already have most of the direction (this whole document). What we DON'T know — ask Spencer, one question at a time, restate his answer back in your own words for confirmation, then move on:

1. **Concept naming convention.** Do you call the logo presentation options "Concept 1 / Concept 2" or use directional names like "Modern Direction" / "Traditional Direction"? Should the editor default to numbering the concepts with an optional custom label field?
2. **Max concepts in practice.** We're supporting N, but what's the realistic max you've done for one partner — 3? 5? (So we know how to lay out the tab strip and pagination.)
3. **Module order in the presentation.** When you present today, do you show color palette first or logo variants first? Is there a signature sequence you always follow? (Locks the default order for the editor template.)
4. **Per-module partner feedback shape.** For each module type, what feedback would actually help you? Concretely — on the logo variant grid: is it a single-select "which variant do you prefer" or ranked ordering or freeform notes per variant? On the color palette: pick individual colors to flag, or overall vibe?
5. **Approval message copy.** When a partner approves a concept and the celebratory ClickUp message auto-sends, what should it say verbatim? Draft the exact wording — I'll wire it up as a message template row in `strategy_message_templates`.
6. **Mood board integration.** Mood boards are Step 1 of the Brand pathway per CLAUDE.md. Does the partner review portal need a mood board review flow (partners approve moods before logo concepts), or does that happen elsewhere today? If mood board review is needed, is it a first tab in the per-church view or a step within the review portal itself?
7. **Deliverables tab.** Should the per-church view have a 4th tab for "Deliverables" checklist (handoff assets), or is that its own thing later? OK to ship with 3 tabs and add later.
8. **Style Finder output shape.** Just briefly — what does the Lovable tool output today (list of images? style keywords? both? a mood board image?), so I know what shape to plan for in Phase 3.

**Do NOT proceed to code until Spencer has answered all 8.** These answers shape the data model.

---

## 8. Supabase — tables you'll read, tables you might create

### CRITICAL RULES (from CLAUDE.md — NON-NEGOTIABLE)

- **Never modify existing tables.** `strategy_account_progress`, `clickup_chat_channels`, `clickup_users`, `prf_brand_guides` are READ-ONLY. Never write to them, never alter their schema.
- **Before creating any NEW table**, respond to Ashley in Slack with a written analysis: name the table you'd create + its purpose, then name 1-2 existing tables that could absorb the data via `ADD COLUMN` instead, with trade-offs. Wait for her explicit approval before applying CREATE TABLE.
- **Before altering or dropping ANY table** (drop table, drop/rename column, type change, constraint change, etc.), audit every database object that depends on it — triggers, functions, views, materialized views, foreign keys, RLS policies — and report findings to Ashley BEFORE applying. See CLAUDE.md's "Dependency Audit Before Supabase Table Changes Rules" for the exact SQL to run.
- **All new tables use the `strategy_` prefix.** New tables should be added to the Strategy schema not the Public shcema.
- **All new tables follow existing patterns:** uuid primary keys (`id uuid primary key default gen_random_uuid()`), `created_at` + `updated_at` timestamps (`timestamptz default now()`), `is_active boolean default true` for soft deletes.

### Existing tables you'll READ

**`strategy_account_progress`** — the partner list. Keyed on `member` (numeric).

Columns you'll need (from `src/types/database.ts` line 127):

```typescript
{
  member: number; // primary key
  church_name: string | null;
  first_name_of_primary: string | null;
  css_rep: string | null; // account manager name
  portal_token: string | null; // used for public review links
  plan: string | null; // "Light" / "Pro" / etc.
  cohort: string | null;
  website: string | null;
  handoff_brand_form: Record<string, unknown> | null; // partner brand intake answers
  // ... and web-specific fields you can ignore for brand work
}
```

**`strategy_milestone_submissions`** — every milestone message sent, timestamped. This drives the "current milestone" for the master list sort.

Columns (from `src/types/database.ts` line 426):

```typescript
{
  id: string;
  member: number; // FK to strategy_account_progress.member
  milestone_id: string; // FK to strategy_milestone_definitions.id
  template_id: string | null;
  is_continuation: boolean;
  track_name: string | null; // e.g. "Kids Ministry" subbrand track
  current_milestone_id: string; // current milestone at time of submission
  next_milestone_id: string | null; // what's next after this
  rendered_message: string; // the actual message text sent
  clickup_channel_id: string | null;
  clickup_message_id: string | null;
  clickup_thread_url: string | null;
  partner_contact_name: string | null;
  partner_contact_clickup_id: number | null;
  submitted_by_email: string;
  submitted_by_name: string | null;
  submitted_at: string; // ISO timestamp
  updated_at: string;
  status: "draft" | "sent" | "failed";
  milestone_status: MilestoneStatus; // workflow status enum
  is_active: boolean; // soft-delete flag
}
```

**Query for master list current milestone per partner** (starting sketch — refine with Spencer):

```sql
select distinct on (m.member)
  m.member,
  m.current_milestone_id,
  m.submitted_at,
  d.step_name,
  d.step_number,
  d.pathway
from strategy_milestone_submissions m
join strategy_milestone_definitions d on d.id = m.current_milestone_id
where d.squad = 'brand'
  and m.is_active = true
order by m.member, m.submitted_at desc;
```

**`strategy_milestone_definitions`** — reference of pathway steps.

Columns (from `src/types/database.ts` line 394):

```typescript
{
  id: string;
  squad: "brand" | "web" | "social";
  pathway: string; // e.g. "New Brand", "Existing Brand"
  step_number: number;
  step_name: string;
  section_group: string | null;
  is_partner_facing: boolean;
  description: string | null;
  is_active: boolean;
}
```

**Brand pathways (from CLAUDE.md):**

- Brand — New Brand: 5 steps (Mood Boards → Identity Design & Presentation → Brand Guide → Deliverables → Handoff)
- Brand — Existing Brand: 3 steps (Brand Guide → Deliverables → Handoff)
- Brand — Ministry Subbrand: 3 steps

**`strategy_message_templates`** — admin-editable message templates.

Columns (from `src/types/database.ts` line 409):

```typescript
{
  id: string;
  milestone_id: string; // FK to strategy_milestone_definitions.id
  template_variant: string;
  subject_line: string | null;
  template_body: string; // uses {{merge_fields}} — see CLAUDE.md
  is_active: boolean;
  include_footer: boolean; // toggle default for standard footer
  include_recap: boolean;
  last_edited_by: string | null;
}
```

**Available merge fields** (from CLAUDE.md):

- `{{church_name}}`, `{{first_name_of_primary}}`, `{{step_name}}`, `{{section_group}}`, `{{submitter_name}}`, `{{account_manager}}`, `{{partner_contact_name}}`, `{{asset_links}}`, `{{next_step_name}}`

**`clickup_chat_channels`** — the ClickUp channel per partner.

Columns:

```typescript
{
  id: string; // ClickUp channel ID (text)
  memberid: string | null; // maps to strategy_account_progress.member
}
```

**`clickup_users`** — staff + partner contacts.

Columns:

```typescript
{
  clickup_id: number;
  email: string | null;
  username: string | null;
  account_id: number | null; // links contacts to partner accounts
  employee: string | null; // null = partner contact, not null = staff
}
```

**`prf_brand_guides`** — brand guide assets. **READ ONLY.**

Columns:

```typescript
{
  account: number | null; // FK to strategy_account_progress.member
  // ... many other columns not typed strictly; use [key: string]: unknown
}
```

### New tables you'll likely need (get Ashley's approval FIRST)

**`strategy_brand_concepts`** and **`strategy_brand_reviews`** — the two tables that back the Logo Presentation editor and partner review portal. The canonical schemas + JSONB shapes live in **section 3c.iii** — do NOT invent your own here.

Key notes when writing the approval message:

- **`strategy_brand_concepts`** FKs to `strategy_brand_guides.id`, NOT to `strategy_account_progress.member`. A church can have multiple brand guides (main + ministry subbrands); concepts belong to a specific guide, not a whole church.
- **`strategy_brand_reviews`** FKs to `strategy_brand_concepts.id` (which resolves back to the guide + church). It does not need its own `member` column — join through the concept.
- The `layout` JSONB (concepts) and `feedback` JSONB (reviews) store IDs pointing into brand guide child tables (logos, colors), not asset content. See section 3c.iii for the full TypeScript shapes.

Ashley's approval message from you should cover:

- What each table stores + the FK relationships (per above)
- Why the data can't fit as `ADD COLUMN` on an existing table (concepts are 1-to-many under a brand guide with independent lifecycle; reviews are 1-to-many under a concept and public-token-addressable — neither fits cleanly as a JSONB column on `strategy_brand_guides`)
- The `unique (brand_guide_id, concept_number)` partial index for `is_active` rows (prevents duplicate concept numbers per guide)

---

## 9. ClickUp integration — how to send chat messages

Do NOT call the ClickUp API directly from the browser (CORS blocked, plus tokens can't be exposed).

**Use `sendClickUpMessage` in `src/lib/clickup.ts`.** It proxies through the `send-clickup-message` Supabase Edge Function. Full signature:

```typescript
export async function sendClickUpMessage(
  channelId: string,
  comment: ClickUpCommentSegment[],
  parentMessageId?: string | null, // for thread replies
  title?: string | null, // for top-level post title
): Promise<ClickUpSendResult>;

interface ClickUpSendResult {
  id: string; // message ID
  threadUrl: string | null; // link to the thread
}
```

**`ClickUpCommentSegment[]`** is a rich-text segment array so `@`-tags fire real notifications:

```typescript
// Plain text
[{ text: "Hey team, ..." }][
  // With @-tag
  ({ text: "Hey " },
  { text: "@spencer", attributes: { user: { id: 123456 } } }, // clickup_users.clickup_id
  { text: ", brand review is in!" })
];
```

**To send an auto-reply in a thread** (e.g., after a partner submits brand review feedback):

1. Look up the channel: `select id from clickup_chat_channels where memberid = <member>`
2. Look up the original milestone message: `select clickup_message_id from strategy_milestone_submissions where member = <member> and current_milestone_id = <logo_presentation_milestone_id> and status='sent' order by submitted_at desc limit 1`
3. Call `sendClickUpMessage(channelId, comment, parentMessageId=that_message_id)`

**To send a top-level celebratory message** (e.g., on brand guide auto-publish):

1. Look up the channel same as above.
2. Call `sendClickUpMessage(channelId, comment, null, "Your brand guide is ready!")`.

---

## 10. Squad API — creating ClickUp tasks

For auto-creating a ClickUp task in the partner's brand list (e.g., when a partner submits brand review feedback):

- Docs: https://sdk.thesqd.com/openapi.json
- Registry / components: https://sdk-components.thesqd.com/llms.txt
- The Squad API token lives in `.env`. Check with Ashley for the exact env var name — she'll DM the current value.

**To find the partner's brand ClickUp list:** the partner has a folder in the "All-In" space in ClickUp; inside that folder is a "Brand" list. Look up the folder ID via `clickup_folders.account = <member>`, then the list within that folder. See `src/types/database.ts` for `ClickupFolder` and `ClickupList` schemas.

**All API calls to Squad API should go through `src/api/` proxy routes** (per CLAUDE.md organization instructions). Do NOT call the Squad API directly from the browser. If there's no existing proxy for the endpoint you need, ask Ashley to help you scaffold one at `api/brand/create-review-task.ts` or similar.

---

## 11. Registering new routes in App.tsx

Route registration happens in `src/App.tsx`. Existing brand routes (line reference approximate):

```tsx
<Route path="/branding" element={<BrandingIndexPage />} />
<Route path="/branding/:token" element={<BrandHandoffPage />} />
<Route path="/churches/:memberId/brand" element={<BrandGuideEditorPage />} />
<Route path="/churches/:memberId/brand/:subSlug" element={<BrandGuideEditorPage />} />
```

**New routes you'll add for Phase 1:**

```tsx
// Inside the authenticated staff area (same block as /branding)
<Route path="/brand-manager" element={<BrandManagerPage />} />
<Route path="/brand-manager/:memberId" element={<BrandManagerChurchDetailPage />} />

// Inside the public portal area (same block as /portal/review/:token, around line 114)
<Route path="/portal/brand-review/:token" element={<BrandReviewPortalPage />} />
```

**Since `src/App.tsx` is outside Spencer's CODEOWNERS zone**, ask Ashley to register these routes. Do NOT edit `App.tsx` yourself. Ashley will either make the edits for you or approve you doing it.

---

## 12. Visual design — palette, typography, components

From CLAUDE.md (non-negotiable):

**Color palette (use exact hex codes, do not approximate):**

| Token          | Hex       | Usage                                                                      |
| -------------- | --------- | -------------------------------------------------------------------------- |
| Primary Purple | `#513DE5` | Accent color, active nav items, progress indicators, eyebrow labels, links |
| Deep Plum      | `#341756` | Headlines, body text, sidebar background, primary buttons                  |
| Lavender       | `#CFC9F8` | Card borders, hover states, subtle fills                                   |
| Lavender Tint  | `#EDE9FC` | Callout backgrounds, selected states, hover fills                          |
| Cream          | `#F9F5F1` | Page background (NOT white)                                                |
| White          | `#FFFFFF` | Card surfaces, elevated elements above Cream canvas                        |
| Purple Mid     | `#6B5CE7` | Button hover states on Primary Purple elements                             |
| Purple Gray    | `#6B6180` | Muted/secondary text (never use raw grays)                                 |

- **Never use pure black (`#000000`).** Always Deep Plum for text.
- **Never use raw grays.** Tint all grays toward purple.
- **Cream is the default page background.** White is for cards/elevated elements.

**Tailwind classes (project uses arbitrary values):**

- Page background: `bg-[#F9F5F1]`
- Card surface: `bg-white`
- Text: `text-[#341756]` (body), `text-[#513DE5]` (accent), `text-[#6B6180]` (muted)
- Border: `border-[#CFC9F8]`

**Gradients:**

- Dark hero (login page, portal header): `background: linear-gradient(135deg, #341756 0%, #513DE5 100%);`
- Light wash (section backgrounds): `background: linear-gradient(135deg, #CFC9F8 0%, #F9F5F1 50%, #FFF5EE 100%);`

**Typography:**

- Headlines: Georgia or serif with italic emphasis on emotional words
- Body / UI: Inter, 'Segoe UI', Arial, sans-serif
- Eyebrow labels: Uppercase, letter-spacing 0.08-0.12em, colored Primary Purple
- Body text: Always Deep Plum, never black
- No light/thin font weights (300 or below)

**Components:**

- **Buttons:** Pill-shaped (`border-radius: 999px` or Tailwind `rounded-full`). Never squared. Primary = Deep Plum fill. Include `→` arrow icon on CTAs.
- **Cards:** White background, Lavender border (1-2px), rounded corners (12-16px), subtle shadow.
- **Active/selected states:** Lavender Tint background with Primary Purple left border or text.
- **Progress indicators/timeline:** Primary Purple for completed, Lavender for upcoming, Deep Plum for current "you are here."

**Responsive:**

- All layouts must be fully responsive (mobile-first with Tailwind breakpoints).
- Client-facing brand review portal must look excellent on mobile (partners view on phones).
- Tables become card layouts on mobile.

---

## 13. Guardrails (repeat, because they matter)

- **No em-dashes anywhere.** In code, comments, UI copy, generated content, commit messages, partner-facing messages. Use commas, periods, or parentheses.
- **No hardcoded credentials.** `.env` only.
- **Never modify existing tables** (`strategy_account_progress`, `clickup_chat_channels`, `clickup_users`, `prf_brand_guides`).
- **New tables need Ashley's approval first.** See section 8.
- **No inline styles.** Tailwind classes only.
- **Deploy cadence:** finish full batches before asking for a merge. Ashley pushes; each push auto-deploys via Vercel.
- **No functional components with logic in the return.** Use hooks + typed state. TypeScript strict mode is on.
- **Environment variables for credentials.** Never commit `.env`.
- **Public shareable links use v4 UUID tokens.** Not member IDs directly.
- **Asset URLs must be validated as public-facing/sharable.** See existing `attachmentUpload` for the pattern.

---

## 14. Your first four moves (in order)

1. **Set up local preview with Spencer.** Walk through section 4 above. Do NOT move past step 7 until the local app is running with real data and hot reload works. If it takes 90 minutes, that's normal. This IS the first win.
2. **Skim the web team's patterns** (section 6, ~30 minutes). No code yet.
3. **Close the 8 gaps with Spencer** (section 7). One question at a time, restate his answer back, then move on.
4. **Ship the first slice locally: the Brand Manager master list.**
   - Just a read-only spreadsheet of active brand partners at `/brand-manager`.
   - Sorted by current brand milestone.
   - Real Supabase data from the query in section 8.
   - No editor, no review portal, no per-church detail yet — those come next.
   - Test it in Spencer's browser together. Screenshot the working state. Celebrate out loud.

Then Spencer messages Ashley to review + merge (section 5). Ashley merges → Vercel deploys → Spencer sees his own feature live at strategy.thesqd.com. That's the momentum win.

**After the first slice is live**, come back to Ashley with:

- Spencer's 8 answers from section 7.
- Screenshot of the master list live at strategy.thesqd.com.
- Proposed data model for the concepts + reviews tables (from section 8).
- What you propose to build next: per-church view shell + Logo Presentation editor first slice.

Ashley reviews the proposal. Then you build.

---

## 15. Escalation + support

- **Ashley Fox (VP Strategy)** — ashley@churchmediasquad.com. Primary reviewer. Approves table changes. Merges branches.
- **Bennett** — escalation when Ashley is out (she has surgery coming up, availability may be uneven).
- **Route:**
  - Architecture / cross-domain questions → Ashley
  - Workflow questions ("how do you do X today?") → Spencer answers, not you
  - Account-specific questions → the account manager (`css_rep` field on `strategy_account_progress`)
  - Git or setup errors → Slack Ashley with screenshots

---

## 16. Reference cheat sheet

**Repo:** `churchwebsquad/sqd-milestone`
**Live URL:** strategy.thesqd.com
**Local URL:** http://localhost:5173
**Main branch:** `main` (protected, Ashley merges)
**Spencer's branch pattern:** `brand-manager-<slug>` (e.g., `brand-manager-workspace`, `brand-manager-logo-editor`)

**Spencer's tools:**
- **Claude Code Desktop** (Anthropic desktop app) — AI collaboration surface
- **VSCode** (https://code.visualstudio.com) — code editor, terminal, file view
- **GitHub CLI (`gh`)** — optional, only if he wants a terminal-only workflow later. VSCode sign-in covers all Git auth needs.
- **Browser** — Chrome or Safari for the local preview at http://localhost:5173

**Key file paths:**

- Routes: `src/App.tsx`
- Supabase client: `src/lib/supabase.ts`
- ClickUp send: `src/lib/clickup.ts`
- DB types: `src/types/database.ts`
- Attachment upload: `src/lib/attachmentUpload.ts` (use `bucket: 'brand-assets', pathPrefix: '<memberId>/logos'` per the JSDoc example)
- Brand guide: `src/lib/brandGuide.ts`, `src/pages/BrandGuideEditorPage.tsx`
- Pattern models: `src/pages/PortalReviewPage.tsx`, `src/components/wm/workspaces/PagesWorkspace.tsx`

**Common commands:**

- `npm run dev` — start local dev
- `npm run typecheck` — verify types
- `npm run lint` — verify lint
- `git status` — see changed files
- `git log --oneline main..<branch>` — see your commits since branching
- `git push -u origin <branch>` — push YOUR branch (not main)

**External docs:**

- Squad API: https://sdk.thesqd.com/openapi.json
- Squad SDK components: https://sdk-components.thesqd.com/llms.txt
- Supabase: https://supabase.com/docs
- ClickUp API v3: https://developer.clickup.com/reference

---

**Now begin.** Start with section 14 move #1 — walking Spencer through local setup. Take your time. Make it easy.
