# Collaboration & Governance Gameplan

How the Branding Director and Social Media Director co-develop this app
alongside Ashley (VP) — without the ability to break shared foundations or
touch production directly. Modeled on the CXOS repo's governance pattern
(CODEOWNERS + branch protection + onboarding docs + per-area `CLAUDE.md`).

> **Decision (2026-06-08):** No in-app role hierarchy / special login.
> Governance lives at the **Claude Code layer** (behavioral) and the
> **GitHub layer** (enforced). Changelog is **both** dev-facing and in-app.

---

## 1. The model in one picture

Three enforcement layers. You want all three — each covers what the one
above it can't.

| Layer | Mechanism | Hardness | Catches |
|---|---|---|---|
| 1. Per-squad `CLAUDE.md` | Prose the director's Claude auto-loads | Soft (behavioral) | Day-to-day scope drift; trains the "check with Ashley first" habit |
| 2. `.claude` hooks | PreToolUse hooks that **block** tool calls | Hard (local machine) | `git push` to main, edits outside the squad's folders, table-creating SQL |
| 3. GitHub branch protection | Server-side rule on `main` | Hard (un-bypassable) | Anything merging to `main` without Ashley's review |

**Why all three:** a `CLAUDE.md` rule is guidance an agent *chooses* to follow
(a human can override it). Hooks make the block real on the director's machine.
Branch protection is the backstop that holds even if layers 1–2 are bypassed,
because it lives on GitHub's servers, not the director's laptop.

```
director's branch ──► PR ──► CI checks (schema guard, lint, build) ──► Ashley's review (CODEOWNERS) ──► merge to main ──► Vercel deploy
   (layers 1+2 keep this branch clean)                                   (layer 3: the hard gate)
```

---

## 2. Decisions locked

- **No special login.** App auth stays domain-gated (`@churchmediasquad.com`)
  with `isAdmin = verified staff`. We are *not* building vp/director/staff
  roles into `AuthContext`.
- **Governance is agent + GitHub, not in-app RBAC.**
- **Never push to `main`.** Directors branch → PR → Ashley reviews → merge.
- **Never create Supabase tables.** Directors may *request* a table (issue
  template) or add columns to existing tables via a reviewed migration file.
- **Changelog: both** a repo `CHANGELOG.md` (dev) and an in-app `/whats-new`
  page (staff), mirroring CXOS `src/lib/release-notes.ts`.
- **Directors own their *domain*, not just existing files.** Within their
  squad's tools and their squad's sections of the Churches Dashboard, they may
  **add and create freely where nothing exists yet** — new components, new
  features, even a brand-new tool. The only checkpoints: (a) wiring a new tool
  into shared scaffolding (a route in `App.tsx`, nav) is a light Ashley review
  via the normal PR, and (b) if the new tool needs a Supabase table, they open
  a "Request a table" issue. See §3.2.

### Supabase access — the two-path model
There are two separate ways to write to Supabase, and they need different rules.
The key insight: **gating structure does not lock directors out of using the app.**

- **Path A — runtime data (through the app).** When a director logs in and
  creates a brand guide, edits an SRP prompt, or logs a milestone, that write
  goes through the deployed app's Supabase client (publishable key + their
  auth session + RLS). This needs **no dashboard access** and is unaffected by
  any governance here. Directors keep every in-app power they have today.
- **Path B — structure / schema (migrations).** New column, new table, new
  policy. This is *development*, and it's the only thing we gate — through
  reviewed `/schema/*.sql` files. The "no new tables" rule is only enforceable
  if directors do **not** have Supabase **dashboard / SQL write access**;
  otherwise they could `CREATE TABLE` directly and nothing stops it.

**Recommendation:** directors get **no Supabase dashboard write access**
(read-only or none). All schema change flows through committed `/schema/*.sql`
files Ashley reviews. The one friction — testing a schema change mid-build —
is solved one of three ways, easiest first:
1. **Ashley-applies-on-request** (start here): for a simple `ADD COLUMN`,
   Ashley applies the reviewed migration same-day; the director pulls and
   builds against it. Lowest setup, fine for low volume.
2. **Supabase preview branches**: give directors a branch DB they can apply
   migrations to and test against; merging to production schema requires
   Ashley. Mirrors the git model exactly — the scale path.
3. **Shared dev/staging project** they can write schema to, Ashley promotes
   approved migrations to prod.

---

## 3. Phase 1 — GitHub governance (the hard backstop)

Mirrors `churchwebsquad/sqd-milestone` to the CXOS setup.

### 3.0 Onboarding the directors to GitHub (do this first)
Neither director has a GitHub account yet. Steps, in order:

1. **They create accounts.** Have each sign up at github.com using their
   work email and verify it:
   - Branding → `spencer@churchmediasquad.com`
   - Social → `amber@churchmediasquad.com`
   Ask them to send you their chosen **GitHub username** once created.
2. **Invite them to the repo with least privilege.** On
   `github.com/churchwebsquad/sqd-milestone` → **Settings → Collaborators and
   teams → Add people**. Invite by username (or the email above). Give the
   **Write** role — *not* Admin or Maintain. Write lets them push branches and
   open PRs but **cannot** change repo settings, branch protection, or bypass
   reviews. (Write is also the minimum a CODEOWNERS reviewer needs to be a
   required approver.)
3. **Fill in CODEOWNERS** with their real usernames once you have them
   (placeholders below). Until then, CODEOWNERS lines pointing at the
   placeholders will be inactive — set up branch protection so **Ashley is the
   required reviewer** in the interim, then swap in the directors as code
   owners after they accept.
4. **Confirm branch protection applies to them.** In branch-protection
   settings, do **not** add the directors to any bypass list. Keep yourself as
   the only admin who can merge to `main`.

> CODEOWNERS uses GitHub **usernames** (`@handle`), not emails. The
> placeholders below carry each person's email in a comment so you know which
> handle to drop in. (GitHub also accepts a verified `email@domain` in
> CODEOWNERS, but usernames are more reliable — prefer them.)

### 3.1 Branch model
- `main` — protected, auto-deploys to production via Vercel. No direct pushes.
- Feature branches, squad-prefixed and short-lived:
  - `brand/<task>` — Branding Director
  - `social/<task>` — Social Media Director
  - `ashley/<task>` — Ashley
- Branch from `main`, PR to `main`. (A `dev` integration branch like CXOS is
  optional — for a 3-person team it adds overhead; skip until it hurts.)

### 3.2 `.github/CODEOWNERS`
Maps **domains** (not just files) to reviewers. "Require review from Code
Owners" (below) means a PR touching an owned path **cannot merge without that
owner's approval** — this *is* your approval queue, native to GitHub, no custom
infra.

**Why folder globs = freedom to create.** A line like `/src/components/srp/`
owns *everything in that folder, including files that don't exist yet*. So a
director can add new components, new features, even scaffold a brand-new tool
inside their domain folders and it's all theirs — no special permission needed.
They only hit a checkpoint when a change reaches *outside* their domain (e.g.
registering a new route in `App.tsx`), which lands in your review queue
automatically, or when it needs a new table (issue request).

```
# ── Social Media Squad — @AMBER_GH (amber@churchmediasquad.com) ──
/src/components/srp/                       @AMBER_GH
/src/components/srp/**                      @AMBER_GH
/src/components/intel/                      @AMBER_GH
/src/pages/SrpDashboardPage.tsx             @AMBER_GH
/src/pages/SrpWorkflowPage.tsx              @AMBER_GH
/src/pages/SrpPromptSettingsPage.tsx        @AMBER_GH
/src/pages/IntelAuditToolPage.tsx           @AMBER_GH
/api/srp/                                   @AMBER_GH
/api/church-intel/                          @AMBER_GH
# Social section of the Churches Dashboard
/src/components/churches/SocialMediaSection.tsx   @AMBER_GH
# New social pages/tools live here and are auto-owned:
/src/pages/social/                          @AMBER_GH

# ── Branding Squad — @SPENCER_GH (spencer@churchmediasquad.com) ──
/src/components/brand/                       @SPENCER_GH
/src/components/brand/**                       @SPENCER_GH
/src/pages/BrandGuideEditorPage.tsx          @SPENCER_GH
/src/pages/BrandingIndexPage.tsx             @SPENCER_GH
/src/pages/BrandHandoffPage.tsx              @SPENCER_GH
/src/pages/BrandGuidePortalPage.tsx          @SPENCER_GH
/src/lib/brandGuide.ts                       @SPENCER_GH
/src/lib/brandHandoff.ts                     @SPENCER_GH
# Brand sections of the Churches Dashboard
/src/components/churches/BrandSquadSection.tsx    @SPENCER_GH
/src/components/churches/BrandVoiceSection.tsx    @SPENCER_GH
# New brand pages/tools live here and are auto-owned:
/src/pages/brand/                            @SPENCER_GH

# ── PROTECTED FOUNDATIONS — Ashley reviews everything here ──
/schema/                                     @churchwebsquad
/supabase/                                   @churchwebsquad
/.github/                                    @churchwebsquad
/src/contexts/AuthContext.tsx                @churchwebsquad
/src/lib/admin.ts                            @churchwebsquad
/src/lib/supabase.ts                         @churchwebsquad
/src/App.tsx                                 @churchwebsquad
/src/components/AppLayout.tsx                @churchwebsquad
/src/components/ProtectedRoute.tsx           @churchwebsquad
# Shared Churches Dashboard scaffolding (not a single squad's section)
/src/pages/ChurchesDashboardPage.tsx         @churchwebsquad
/src/pages/ChurchDetailPage.tsx              @churchwebsquad
/src/components/churches/ChurchInfoSection.tsx    @churchwebsquad
/src/components/churches/ChurchUI.tsx        @churchwebsquad
/src/components/churches/EditableField.tsx   @churchwebsquad
/CLAUDE.md                                   @churchwebsquad
/package.json                                @churchwebsquad

# ── Catch-all — Ashley owns anything not claimed above ──
*                                            @churchwebsquad
```
> **Placeholders:** `@AMBER_GH` = social (amber@churchmediasquad.com),
> `@SPENCER_GH` = branding (spencer@churchmediasquad.com). Swap in their real
> GitHub usernames once they accept the repo invite (see §3.0). Ashley =
> `@churchwebsquad`. The catch-all `*` line means: until the placeholders are
> real handles, anything they touch still requires Ashley's review — safe by
> default.
>
> **New-tool note:** the `/src/pages/social/` and `/src/pages/brand/` lines
> reserve a home for net-new tools so a director can scaffold one entirely
> within their domain. (These folders don't exist yet — create them when the
> first new tool lands.)

### 3.3 Branch protection on `main` (GitHub → Settings → Branches)
- Require a pull request before merging.
- Require approvals: 1.
- **Require review from Code Owners.** ← makes CODEOWNERS enforcing.
- Require status checks to pass (the CI jobs in 3.5).
- Do not allow bypassing the above (applies to admins too, or keep Ashley as
  the sole bypass).

### 3.4 `.github/pull_request_template.md` — verification checklist
```markdown
## What this PR does


## Squad
- [ ] Brand   - [ ] Social   - [ ] Shared (flagged Ashley)

## Verification checklist
- [ ] Changes stay within my squad's folders (CODEOWNERS).
      If they reach past it, I flagged Ashley *before* opening this PR.
- [ ] No new Supabase tables. (Need one? Open a "Request a table" issue.)
- [ ] Schema changes are ADD COLUMN only, in a new /schema/vNN_*.sql file.
- [ ] No credentials/tokens hardcoded — env vars only.
- [ ] No edits to AuthContext, admin.ts, supabase.ts, or .github/.
- [ ] Added a CHANGELOG.md entry and a /whats-new release note.
- [ ] Ran `npm run typecheck` and `npm run lint` clean.
```

### 3.5 CI workflow — `.github/workflows/ci.yml`
Jobs that must pass before merge:
- `typecheck` → `npm run typecheck`
- `lint` → `npm run lint`
- `build` → `npm run build`
- **`schema-guard`** → a script that diffs changed files under `/schema/` and
  **fails the check if any added line matches `CREATE TABLE`** (case-insensitive),
  while allowing `ALTER TABLE ... ADD COLUMN`. This is the automated "no new
  tables" gate. (See `scripts/schema-guard.mjs`, to be written.)

### 3.6 `.github/ISSUE_TEMPLATE/request-a-table.md`
The escape hatch for "I genuinely need a new table." Routes to Ashley:
fields for table name, columns, which squad, why an existing table won't do.

---

## 4. Phase 2 — Claude Code guardrails (the day-to-day layer)

This is the "train their Claude Code to fact-check with me" piece.

### 4.1 Root `CLAUDE.md` — shared rules (append a Governance section)
Add to the existing root `CLAUDE.md`:
- **Branch, never main.** Always create a `squad/<task>` branch. Never
  `git push` to `main`. Never merge your own PR.
- **Own your domain — create freely inside it.** Within your squad's folders
  (and your squad's sections of the Churches Dashboard), you may add new
  components, new features, and scaffold brand-new tools. Building where
  nothing exists yet is encouraged, as long as it stays in your domain.
- **Stop at the domain edge.** If a task requires touching shared files
  (`AuthContext.tsx`, `admin.ts`, `supabase.ts`, `App.tsx`, the shared
  Churches Dashboard scaffolding, `/schema/`, `/supabase/`, `/.github/`) — or
  another squad's folders — **STOP and ask Ashley before proceeding.** Surface
  it to the human; don't push through. (Registering a new tool's route in
  `App.tsx` is exactly this kind of checkpoint — it's a quick Ashley review,
  not a no.)
- **Never create database tables.** No `CREATE TABLE`, no `apply_migration`
  with new tables, no Supabase dashboard table creation. You write data
  *through the app* like any user (that's always fine); you do not change the
  database's *structure*. Column additions go in a new `/schema/vNN_*.sql` file
  for Ashley to review. New table needed for your new tool? Tell the human to
  open a "Request a table" issue — that's the green light, not a blocker.
- **Every change gets a changelog entry** (CHANGELOG.md + release note).

### 4.2 Per-squad `CLAUDE.md` files (nested)
Claude Code auto-loads a `CLAUDE.md` from any directory it's working in,
walking up to the repo root. Drop squad-specific files so the right rules load
automatically when a director's agent works in their area:
- `src/components/srp/CLAUDE.md` — Social squad: scope, data sources, the
  "check with Ashley if this touches X" triggers, links to social schema docs.
- `src/components/brand/CLAUDE.md` — Brand squad equivalent.
- (Optionally one per major brand/social *page* folder too.)

Each lists: **what you own**, **what you must never touch**, and **the exact
triggers that require checking with Ashley first** (auth, schema, shared libs,
routing, anything cross-squad).

### 4.3 `.claude/settings.json` hooks — the hard local block
PreToolUse hooks turn the prose into enforced blocks on the director's machine:
- **Block `git push` to `main`** — deny any Bash command matching
  `git push.*\bmain\b` (or push without a `squad/` branch).
- **Block edits outside the squad's folders** — deny Edit/Write whose path is
  outside an allowlist, forcing the agent to surface it to the human.
- **Block table-creating SQL** — deny Bash/MCP calls containing `CREATE TABLE`.

> These ship as **separate `.claude/settings.json` files per director's
> checkout** (or a shared committed one keyed to role). Use the
> `update-config` skill to author the hooks when we build this.

### 4.4 Onboarding docs (CXOS-style), in `docs/`
- `docs/contributor-onboarding.md` — setup, "your territory," first-PR
  walkthrough, the "don't do this" list.
- `docs/branching-and-pr-workflow.md` — branch naming, PR target, CI, merge
  rules. Same content as Phase 1, written for the directors.
- Update root `README.md` with a Code Ownership table and Branching Model
  diagram (copy the CXOS shape).

---

## 5. Phase 3 — Changelog (dev + in-app)

- **Dev-facing:** `CHANGELOG.md` at repo root (Keep a Changelog format). CI
  *encourages* an entry per PR (checklist item in 3.4; optionally a soft CI
  warning).
- **In-app:** mirror CXOS — a `src/lib/releaseNotes.ts` array rendered at a
  `/whats-new` route, gated to staff. Reuse the existing `AnnouncementProvider`
  ([src/components/announcements/](../src/components/announcements/)) to pop
  "new since your last visit," dept-tagged via the existing `Department` type
  so social staff see social changes highlighted.
- The existing `strategy_announcements` table already covers the popup; the
  `/whats-new` page can read the same source or a static `releaseNotes.ts`.

---

## 6. Phase 4 — Admin settings (descoped, optional)
With no role hierarchy, a heavy `/admin` surface is no longer needed. What's
worth consolidating later, gated by the existing email allowlist pattern
([admin.ts](../src/lib/admin.ts)):
- Changelog/release-note authoring UI (so you don't hand-edit `releaseNotes.ts`).
- The scattered settings that exist today (SRP prompt settings, `app_config`,
  template toggles) under one `/settings` page.

Low priority — only if hand-editing files gets annoying.

---

## 7. Suggested build order
1. **GitHub backstop first** (Phase 1) — CODEOWNERS, branch protection, PR
   template, CI schema-guard, issue template. This alone makes collaboration
   safe even before any Claude tuning.
2. **Onboarding + CLAUDE.md** (Phase 2.1, 2.2, 2.4) — write the rules and
   squad docs.
3. **Hooks** (Phase 2.3) — author with `update-config` once paths are settled.
4. **Changelog** (Phase 3) — `CHANGELOG.md` + `/whats-new`.
5. **Admin settings** (Phase 4) — only if needed.

## 8. Inputs needed from Ashley
- **GitHub usernames** for Spencer (branding) and Amber (social), once they
  sign up and accept the repo invite (§3.0). Until then, the catch-all keeps
  everything routed to Ashley's review — safe to build now.
- ~~Supabase access decision~~ — **resolved:** no dashboard write access;
  schema via reviewed migrations; in-app data writes (Path A) unaffected (§2).
- ~~Folder→owner map~~ — **resolved:** domain-ownership map in §3.2 confirmed,
  including per-squad Churches Dashboard sections and reserved `/pages/<squad>/`
  homes for net-new tools.
```
