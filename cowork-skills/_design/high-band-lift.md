# High-band lift workflow — design doc

**Status:** approved 2026-06-19 (Ashley + agent), incremental build (Path A
with self-review gates between phases). **Test partner:** Arvada Vineyard
(`web_project_id = 2eac7eb8-269d-4584-84a4-3dc9fdd6fcde`).

## Problem in one sentence

When a partner picks "Keep most of our current content" (`high` band),
the pipeline today silently ignores their existing copy — atoms are
extracted/paraphrased from the crawl, never the verbatim live markdown,
so even at ≥70% verbatim-ratio the *specific* partner phrasing doesn't
make it to the right page. The verbatim band passes the math, fails the
spirit.

## Verbatim bands (the bar we're hitting)

From `src/lib/cowork/strategicGoalsContext.ts` ([`verbatimBandExplanation`](../../src/lib/cowork/strategicGoalsContext.ts)).

| Band | Triggered by partner answer | Target verbatim ratio | Stated outline/draft behavior |
|---|---|---|---|
| `high` | "keep most", "keep our current" | **≥ 70%** | Preserve crawled lines, only lightly edit for voice + dignity |
| `mid`  | "mix", "blend"                  | **30–70%** | Blend lifted lines with fresh prose strengthening strategy |
| `low`  | "start from scratch", "rewrite" | **≤ 20%** | Treat crawl as background context; write fresh prose |

Verbatim measurement: **token-level bag of words** (already in place).

## Reframe — not an orphan pool, an **allocation matrix**

Mental model: *every section of every crawled source page must land
somewhere on the new sitemap.* Either as primary content on its natural
target page, as supporting content elsewhere, or as an explicit
`intentionally_dropped` decision with a documented reason. **The
allocation step is accountable for placement, not just lifting.**

The drop-bucket is not an "orphan pool" you forget about — it's a
strategist nudge to find a natural home (e.g., women's-ministry mention
on the old homepage that doesn't fit the new homepage → route to
`/community` or `/groups`).

## Polish operations allowed at `high` band

In-band (no ratio hit, no strategist sign-off needed beyond the global
band approval):

- Grammar fixes (commas, possessives)
- Pronoun swaps (we → you, you → we) for audience clarity
- Sentence consolidation (3 sentences → 2)
- Reordering sentences within a section
- Replacing weak verbs / "discover" → "find"
- Voice alignment against `voice_and_tone`
- Adding transition sentences
- Reordering sections on a page
- Moving sections to new pages (cross-page lift)
- Adding sections to a page that pull content from elsewhere

**Brixies caps are advisory** for list/card grid layouts:
- `feature-section-2` (3-column grid), accordion FAQ, multi-tab feature
  → render N items, ignore `default_count`.
- Hero singletons and 2-up splits → caps remain enforced; planner must
  pick a different family if content exceeds.

**Word caps**: tolerate +2 words; flag at +100. (Brixies card text caps
are display-time guidelines, not editorial constraints.)

## Voice lock — strict no-voice-pass pages

Auto-detected via regex on the destination page slug AND title:

```
/about|history|who[- ]we[- ]are|beliefs|statement[- ]of[- ]faith|
what[- ]we[- ]believe|our[- ]convictions|denomination|our[- ]story/i
```

These pages stay strictly verbatim. The voice pass is skipped. Only
allowed operations are grammar/pronoun/consolidation/reorder + adding
structural CTAs at the bottom of the page. **Their theology stays true
even if it doesn't always match who they think they want to be.**

## FPC gold-standard template rubric

Mined from FPC's bound templates (`web_project_id = 435ccbf9…`). Encode
this in the section-planner as the canonical pattern lookup.

```
Page archetype       → opener         → middle pattern                         → closer
─────────────────────────────────────────────────────────────────────────────────────────
Homepage             → hero-102       → content-16 → feature-22 → feature-61   → cta-48 → cta-20
                                       → feature-2 (persona/ministry cards)
About / Identity     → hero-41        → content-16 → content-45/99 → faq-10    → cta-48 → cta-20
                                       → feature-2 (key concept cards)
Ministry topic       → hero-41        → content-16 → feature-2 (×N)            → cta-48 → cta-20
                                       → feature-66 (when longer copy paired w/ card)
Worship / dense      → hero-41        → feature-2 → content-89 (×N service)    → cta-1 or cta-20
Archive (Watch/News) → hero or cta-1  → content-25/16 → category-filter-4      → cta-20
                                       → feature-2 (featured items)
Staff / team         → hero-41        → content-16 → team-14                   → cta-20
Single-* (event/staff/sermon) → one-row template only (no opener/closer pattern)
```

Cards rule clarified:
- **Short copy, 3-column grid** (persona cards, ministry tiles, ways
  to give) → `feature-section-2`. Default for short-card layouts.
- **Long copy paired with card** (partner bios, serve opportunities) →
  `feature-section-66`.
- **2-up image-heavy split** (Join Us This Sunday) → `feature-section-22`.

## Architecture (6 phases)

Each phase is delivered with a self-critique (master dev + UX strategist)
+ revision pass before the next phase starts. Ashley reviews + confirms
between phases.

### Phase 1 — Crawl atomization automation (data foundation)

- New edge function `atomize-crawl-into-atoms(project_id)`: unions all
  completed crawl_jobs for the project, dedupes by URL (newest wins),
  upserts `content_atoms` rows with `source_kind='crawl'`,
  `source_ref=<page url>`, `body=<page markdown>`,
  `metadata={crawl_job_id, page_url, page_title, atom_role:'page_rubric'}`,
  `verbatim=true`, `status='approved'`. Idempotent on
  `(web_project_id, source_kind, source_ref)`.
- Hook into `fire-crawl-trigger`'s success path as a non-blocking
  fire-and-forget after `status='complete'`.
- Backfill: invoke the function once per project that has any
  completed crawl but no `source_kind='crawl'` atoms.
- **No new tables; no new columns.** Uses existing `content_atoms`.

### Phase 2 — New cowork skill: `allocate-source-to-destination`

- Skill file: `cowork-skills/allocate-source-to-destination/SKILL.md`.
- Slots in pipeline between sitemap-builder and plan-cross-page-allocation.
- AI decomposes each source page's markdown into source-sections; for
  each, picks a `destination_page_slug` (or marks `intentionally_dropped`
  with rationale). Voice-locked pages auto-route to their canonical
  destinations.
- Output: `roadmap_state.source_to_destination_allocations[]`
  (jsonb on `strategy_web_projects.roadmap_state` — existing column).
- Gate: every source-section must be placed or explicitly dropped.
  Unallocated sections surface in a project-level "needs allocation"
  bucket with a copy-paste-able cowork prompt (per Ashley's #26).
- **No new tables; no new columns.** Uses existing
  `strategy_web_projects.roadmap_state`.

### Phase 3 — Outline + draft skill rewrites (lift-first authoring)

- `cowork-skills/outline-page/SKILL.md`: reads
  `source_to_destination_allocations` filtered by current page slug.
  Picks Brixies templates from the FPC rubric. Stamps
  `_meta.allocation_refs[]` for critique verification.
- `cowork-skills/draft-page/SKILL.md`: copy-paste-then-polish flow:
  1. Copy markdown verbatim from primary source page's atom.
  2. Identify gaps from `strategic_goals_approved` (e.g., persona
     coverage missing).
  3. Identify removals (sections allocated elsewhere).
  4. Restructure for Brixies template choice; integrate cross-page
     lifts where allocation directs.
  5. Voice pass (skip if `voice_lock='strict'`; only touch
     voice-conflict atoms otherwise).
  6. Stamp each slot value with `source_excerpt_id` for verbatim audit.

### Phase 4 — Section planner + template rubric

- `cowork-skills/plan-cross-page-allocation/SKILL.md` (or wherever the
  section-planner lives): encode FPC rubric. Stop biasing template
  selection toward `default_count` fit for card-shaped layouts.
- Cards rule: short-copy → feature-2; long-copy paired → feature-66;
  2-up image → feature-22.

### Phase 5 — Renderer cap relaxation + critique tolerance

- Verify `webBrixiesRender.expandGroup()` respects `items.length` over
  `default_count` for card-shaped layouts (it does — needs a regression
  test on feature-section-2 with 5+ items).
- Update critique-page word-cap check: tolerate +2 words; flag at +100.

### Phase 6 — UI surfaces

- Cowork outline preview shows `source_to_destination_allocations` for
  the current page (placed + dropped + cross-lifted).
- Project-level "needs allocation" bucket above the page list with the
  copy-paste cowork prompt for unresolved items (per Ashley's #26).

## Test acceptance — Arvada Vineyard

1. **Hero verbatim**: homepage hero contains `"Transforming lives."` +
   `"Transforming everything."` token-for-token from `arvadavineyard.org/`.
2. **Persona-aware lower flow**: a "Wherever you are with faith" section
   with three audience cards (New to faith / Families / Longtime
   believers) → CTAs to `/grow`, `/kids`, `/grow-leadership`. Proves
   strategic restructure sits alongside verbatim lift.
3. **Service times + locations** lifted verbatim from `/sundays`.
4. **Beliefs page**: lift-only, no voice pass.
5. **Allocation completeness**: every source section from
   `arvadavineyard.org/` accounted for — placed or marked
   `intentionally_dropped`.
6. **Women's-ministry test**: source mentions land on `/community` or
   `/groups` (or nearest fit) if not retained on homepage.
7. **Cowork outline preview** surfaces the allocation table for
   strategist scan before draft fires.

## Preservation policy for Arvada during test

Preserved (do not regenerate):

- `web-hub.crawl_jobs` rows (the source crawl markdown)
- `content_atoms WHERE source_kind != 'crawl'` (content collection,
  strategy brief, etc. — strategist's curated inputs)
- `roadmap_state.sitemap` + `roadmap_state.navigation` (Ashley's
  intentional new sitemap)
- `web_intake_documents` (intake files)

Free to overwrite at test time:

- `roadmap_state.page_outlines`
- `roadmap_state.page_drafts`
- `roadmap_state.page_critiques`
- Any `web_sections` already bound from a prior pipeline run
  (the strategist will explicitly re-run the pipeline)

## Policy reminders

- **No new Supabase tables.** Add columns to existing tables when
  storage is needed. (Per CLAUDE.md.)
- **Audit before any DDL.** Even ADD COLUMN goes through the
  dependency audit (triggers / functions / views / matviews / FKs /
  RLS).
