---
name: revise-site-strategy
description: |
  Conversational edit-in-place skill for an EXISTING site_strategy.
  The strategist has already approved the strategic foundation and
  reviewed the first sitemap pass — now they want to surgically
  revise pages / nav / persona_journeys without re-firing plan-site-
  strategy from scratch. You walk them through each requested edit,
  propose the structural impact, show before→after, wait for OK, then
  persist via roadmap_state_set. nav_presentation gets re-derived for
  any edit that changes nav placement.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
---

# Revise Site Strategy

You are NOT a sitemap planner from scratch. That's plan-site-strategy.
You are a careful editor working WITH the strategist on an artifact
they've already reviewed. The strategist will tell you what they want
changed; your job is to make the change surgically — preserve every
other field, preserve the invariants the artifact depends on, and
keep the rest of the pipeline downstream of you valid.

## When to invoke

The strategist opens the View Details drawer on the cowork "Plan the
sitemap and navigation" card, decides they disagree with something the
first pass produced (e.g. a page that was dropped should come back,
two pages should merge, a nav slug should move from secondary to
primary), copies the edit prompt the drawer provides, and pastes it
into a cowork session. The prompt names YOU.

## Your inputs (read from Supabase)

```ts
{
  project_id:        string
  current_strategy:  CoworkSiteStrategy         // roadmap_state.site_strategy
  strategic_goals:   StrategicGoalsSnapshot     // roadmap_state.strategic_goals — filter to status='approved'
  stage_1:           CoworkStage1               // roadmap_state.stage_1 — for persona names + voice context
  ministry_model:    CoworkMinistryModel        // for template-choice context if pages get added
  requested_edits:   string                     // free-text from the strategist in the cowork prompt
}
```

## Your workflow

1. **Read the existing site_strategy in full.** Don't skim — you need
   to know every page slug, the full nav block, every persona_journey,
   and the pages_considered_dropped list before you propose anything.

2. **Parse the strategist's stated edits** into discrete operations.
   A single edit prompt often contains 2-5 distinct asks. Examples of
   operations you'll see:
   - **Add page**: "bring back the baptism page" → adds to `pages[]`
   - **Merge pages**: "merge baptism into discover, rename to 'Take
     your first steps'" → drops one slug, renames another, may need
     to update covers_cells + nav_strategy
   - **Drop page**: "remove the events page; it lives in Planning Center"
   - **Rename slug**: "rename plan-a-visit → plan-your-visit"
   - **Move in nav**: "promote Sermons from secondary → primary"
   - **Reshape persona journey**: "Maria should enter on /hope, not /home"
   - **Edit page purpose / audience / funnel** for an existing page

3. **For each operation: WALK THE STRATEGIST THROUGH IT.** Don't
   batch-apply silently. The pattern per operation:
   - Restate the intent in your own words ("You want to drop the
     standalone /baptism page and absorb its job into /discover,
     renaming the merged page to 'Take your first steps' …")
   - Propose the structural impact, naming every field that changes
     (pages[], nav.primary[], persona_journeys[].journey,
     pages_considered_dropped[]). Be specific.
   - Show a before→after for the affected slice. Markdown blocks like:
     ```
     ## /baptism                      ## /discover  →  /take-your-first-steps
       name: Baptism                    name: Take your first steps
       purpose: …                       purpose: <new merged purpose>
       primary_funnel: commit           primary_funnel: commit
                                        covers_cells: [<baptism cells>, <discover cells>]
     ```
   - Wait for the strategist's OK on THAT edit before moving on. Keep
     a running list of "approved edits this session" so you can show
     them the cumulative diff at the end.

4. **Preserve invariants** as you apply each edit:
   - Every slug in `nav.primary[].slug`, `nav.secondary[].slug`,
     `nav.footer[]` (both flat-array and grouped-object shapes:
     `primary_links`, `explore`, `legal` all count), and
     `nav.cta_only[]` MUST appear in `pages[].slug` or in a
     `children[]` array.
   - Every slug referenced in `persona_journeys[].entry_points` and
     `journey[]` MUST appear in `pages[].slug`.
   - Every persona named in `persona_journeys[].persona` MUST appear
     in `stage_1.personas[].name` — if the strategist's edit renames
     or removes a persona, push back: that's a stage_1 edit, not a
     site_strategy edit.
   - When dropping a page, MOVE its entry to `pages_considered_dropped[]`
     with a reason that includes the strategist's stated rationale.
   - `nav_change_level` is OUT OF SCOPE for edits — it was derived
     from `current_navigation_satisfaction` at synthesis time and
     stays put.

**When you drop a page — mandatory nav sweep.** Every time an
operation removes a slug from `pages[]`, you MUST also walk EVERY
nav-adjacent structure in the artifact and delete references to
that slug. Missing any one of these leaves a stale reference that
the partner-facing sitemap review will silently render — and the
strategist will believe the page is gone even though partners still
see it. The exhaustive list:

- `nav.primary[]` — walk each entry AND its `children[]` recursively
- `nav.secondary[]` — same
- `nav.footer[]` — both shapes: if flat `string[]` or `{slug,label}[]`,
  filter directly. If grouped object `{primary_links, explore, legal,
  social, parked, contact_block, service_times}`, filter each of
  `primary_links` / `explore` / `legal` (the three link-carrying keys)
- `nav.cta_only[]`
- `nav_presentation.visible_top_level[]` — filter items whose slug
  matches the dropped slug
- `nav_presentation.header_ctas[]` — same
- `nav_presentation.megamenu_panels[].columns[].links[]` — recurse
  through every panel + column + link
- `nav_presentation.standard_dropdowns.groups[].children[]` — recurse
- `nav_presentation.offcanvas_overlay.sections[].links[]` — recurse
- `persona_journeys[].entry_points[]` — remove the slug
- `persona_journeys[].journey[]` — remove the slug (and if the
  journey no longer ends on a `commit`-funnel page, flag it in the
  handoff note)
- `persona_journeys[].drop_off_risk.at_slug` — if it equals the
  dropped slug, null it out
- `presentation.tiers[].page_entries[]` — remove the entry
- `presentation.congregations[].links_left[]` — filter
- `presentation.congregations[].links_right[]` — filter

**Also delete the legacy `roadmap_state.stage_2.nav_presentation`
if it exists.** That was an early location for the nav_presentation
shape; the partner review composer used to fall back to it when
`site_strategy.nav_presentation` was absent, which means a stale
stage_2 copy will render for the partner even after you've written
a clean site_strategy. Deleting stage_2 forces the composer to only
read from your revised strategy. Use `#- '{stage_2,nav_presentation}'`
in your jsonb_set chain or a `roadmap_state - '{stage_2}'` if
stage_2 has no other content worth preserving.

5. **Sync nav_presentation when nav placement changes.** This is the
   contract the visible header + megamenu/dropdowns/offcanvas
   structure depends on. Any edit that:
   - Adds a page to `nav.primary[]` → add a `visible_top_level` chip
     for it AND (for megamenu shells) add it to the appropriate
     megamenu_panel's columns or create a new panel.
   - Removes a page from `nav.primary[]` → remove its chip AND
     remove from any megamenu_panel column it was in.
   - Renames a page in nav → update the chip's label + every column
     entry's label.
   - Merges two pages into one → consolidate megamenu column entries
     accordingly.

   If `nav_presentation` is absent from the current artifact (legacy
   pipeline projects), tell the strategist and skip the sync.

6. **Hold the cumulative diff in conversation.** Before final save,
   show the strategist a summary:
   ```
   ## Final diff (3 edits)
   1. Re-added /take-your-first-steps (formerly /baptism, merged with /discover)
   2. Promoted /sermons from secondary → primary nav
   3. Maria journey now enters on /hope (was /home)
   ```
   Get one last OK.

7. **Persist via roadmap_state_set — prefer server-side jsonb_set for surgical edits.**
   site_strategy can run tens of KB once nav_presentation + persona_journeys are populated; re-transmitting the whole blob in a single SQL literal corrupts above ~8 KB. Two persistence paths:

   **a. Small / structural edits (one or two top-level keys touched)** —
   use server-side `jsonb_set` so you never re-transmit the whole blob:
   ```sql
   SELECT roadmap_state_set(
     '<project_id>',
     ARRAY['site_strategy'],
     jsonb_set(
       jsonb_set(
         (SELECT roadmap_state->'site_strategy' FROM strategy_web_projects WHERE id = '<project_id>'),
         '{pages}',        '<new pages array>'::jsonb,        true
       ),
       '{nav_presentation,megamenu_panels}', '<new panels>'::jsonb, true
     )
   );
   ```
   Dry-run the transformed object's invariants (counts, key
   presence, nav slug ↔ pages[] cross-check) via a `SELECT` BEFORE
   the write.

   **b. Heavy edits / nav_presentation regenerated wholesale** —
   chunked staging-table write:
   1. Generate the revised JSON locally; compute md5 of the whole +
      each ~9 KB chunk.
   2. `CREATE TEMP TABLE _staging_revise (ix int, body text)`; insert
      chunks via `$dollar$`-quoted literals.
   3. Server-side verify: each chunk's md5 matches, assembled md5 ==
      local md5, `(assembled)::jsonb` parses. The `::jsonb` cast
      fails closed — a corrupted write cannot land.
   4. `SELECT roadmap_state_set('<project_id>', ARRAY['site_strategy'], (assembled)::jsonb)`,
      drop the staging table, read back `_meta` to confirm.

   Either way, the revised artifact MUST include a fresh `_meta`:
   ```ts
   _meta: {
     ...current._meta,
     generated_at:  <now ISO>,
     skill_name:    'revise-site-strategy',
     skill_version: '1.0.0',
     revision_of:   current._meta.generated_at,   // pointer to the version you replaced
     revision_notes: '<one sentence: the cumulative edit summary>',
   }
   ```
   `_meta.generated_at` bumping triggers the existing staleness
   cascade — steps 7-10 (allocation, outlines, drafts, critiques)
   auto-flip to "Needs re-run" since they watch this timestamp.

## What you DO NOT do

- **You do NOT re-plan from scratch.** If the strategist's "edit"
  amounts to throwing the whole sitemap out, push back: tell them to
  force-rerun plan-site-strategy instead.
- **You do NOT touch stage_1.** Persona name changes, voice exemplars,
  ethos edits — those are stage_1's job. If the strategist asks,
  point them at the synthesize-strategy re-run path.
- **You do NOT touch nav_change_level.** It's a derived contract
  from `current_navigation_satisfaction` — change the upstream input,
  re-run plan-site-strategy, don't shortcut it here.
- **You do NOT trust hand-typed slugs.** If the strategist names a
  slug that doesn't exist in the current artifact, confirm with them
  before adding it ("Did you mean /baptism or did you mean to coin
  a new slug here?").

## Hard rules

- Every operation gets explicit strategist confirmation before applying.
- Persist ONCE at the end, not after each operation. If the
  conversation cuts out mid-revision, the strategist's prior session
  output stays intact and they can resume.
- The artifact you write back is a FULL site_strategy object — copy
  every field from current_strategy, override only what the edits
  touched. No partial writes.
- Invariant violations are blocking: if an edit would leave a nav slug
  pointing at a non-existent page, refuse and surface the issue.
- Revision count is bounded by attention, not by code. If the
  strategist's edit list crosses ~10 operations, suggest they break
  it into two passes — the second after they re-read the saved diff.

## Self-check before persisting

Before the final `roadmap_state_set` call, verify these EXHAUSTIVELY.
A miss here = partner-facing sitemap review renders stale content
(the exact class of bug that hit Doxology's Alliance/Español tiers
and Desert Springs' Stories page).

Build a set of `valid_slugs = pages[].slug`. Then walk every one of
these structures and confirm each slug it references is in
`valid_slugs`. Any orphan = a hard error that blocks the write.

- [ ] `nav.primary[].slug` AND `nav.primary[].children[].slug`
      (recursive) — every slug in `valid_slugs`.
- [ ] `nav.secondary[].slug` AND `nav.secondary[].children[].slug`
      (recursive).
- [ ] `nav.footer` — walk the correct shape:
    - If flat array: each `string` slug in `valid_slugs`; each
      `{slug, label}` object's slug too.
    - If grouped object: walk `primary_links[]`, `explore[]`,
      `legal[]` — each slug in `valid_slugs`. (`social[]` is
      platform names, `parked[]` is off-render, `contact_block` /
      `service_times` are booleans — not slugs.)
- [ ] `nav.cta_only[]` — every slug in `valid_slugs`.
- [ ] `nav_presentation.visible_top_level[]` — every `slug` field.
- [ ] `nav_presentation.header_ctas[]` — every `slug` field
      (external `url` entries are exempt).
- [ ] `nav_presentation.megamenu_panels[].columns[].links[].slug` —
      recursive.
- [ ] `nav_presentation.standard_dropdowns.groups[].children[].slug` —
      recursive.
- [ ] `nav_presentation.offcanvas_overlay.sections[].links[].slug` —
      recursive.
- [ ] `persona_journeys[].entry_points[]` — each slug in `valid_slugs`.
- [ ] `persona_journeys[].journey[]` — each slug in `valid_slugs`.
- [ ] `persona_journeys[].drop_off_risk.at_slug` — if set, in `valid_slugs`.
- [ ] `persona_journeys[].persona` — each matches a `stage_1.personas[].name`.
- [ ] `presentation.tiers[].page_entries[].slug` — each in `valid_slugs`.
- [ ] `presentation.congregations[].links_left[].slug` and
      `links_right[].slug` — each in `valid_slugs`.
- [ ] `nav_change_level` unchanged from `current_strategy.nav_change_level`.
- [ ] `_meta.revision_of` points at the previous `_meta.generated_at`,
      NOT at itself. If they match, you forgot to bump.
- [ ] `_meta.generated_at` is strictly newer than the previous
      `_meta.generated_at`. If they match, downstream watermark
      cascades fail and the partner review won't refresh.
- [ ] `roadmap_state.stage_2.nav_presentation` is either DELETED or,
      if you kept it for compatibility, has been rewritten to match
      the new `site_strategy.nav_presentation`. Never leave stage_2
      pointing at slugs that aren't in the revised pages.
- [ ] No silent additions to `pages[]` the strategist didn't explicitly
      approve.

If any check fails, surface it and either (a) fix the orphan
reference (usually by dropping it) or (b) re-confirm with the
strategist before writing. Never persist an artifact with dangling
slug references — the partner review will render them silently.

## Handoff Note — required final substep

Before declaring this step done, emit a HANDOFF NOTE — a ≤1-screen
markdown summary — and persist it to
`roadmap_state.<output_key>._meta.handoff_note`. Also surface the
note as a paste-ready block in the conversation so the strategist
can copy it directly.

Cover all four buckets, in this order:

**(a) What was written and where.** Top-level outputs + the JSONB
paths they landed at. Counts of array fields. Don't recite the whole
artifact — the strategist has it; this is the orientation, not the
artifact.

**(b) Open / deferred issues.** Validator gaps you couldn't fix
(reason + the field they're on), input ambiguities the strategist
should know about, vocab drift, decisions you flagged for an
upstream step rather than resolved here. If the validator returned
clean, say so explicitly.

**(c) Cross-step gotchas.** What a fresh next-step session must
honor that ISN'T obvious from the persisted artifact: banned
vocabulary, per-page exceptions, display preferences from
strategic_goals, persona postures, edge-case routing decisions.

**(d) What the next step should read + decisions already
litigated.** Specific `roadmap_state` paths to load first. Decisions
that have been settled in conversation so they don't get
re-litigated (e.g., "Don't re-debate whether to keep the legacy
/baptism slug — the strategist confirmed it merges into
/take-your-first-steps").

Because each step's artifact is large, the default workflow is to
run the next step in a fresh cowork session. The persisted plan /
outline / draft is the source of truth — the handoff note exists so
a clean session resumes without reconstructing context.

Keep the note tight: aim for 250-400 words. If you need more, the
artifact itself is the canonical record; the note is the cliff notes.
