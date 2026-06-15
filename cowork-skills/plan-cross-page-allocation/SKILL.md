---
name: plan-cross-page-allocation
description: |
  ONE call per project. Decide which sources (truth from crawl + content
  collection, strategic pillars, structured facts) land on which sitemap
  pages, in what section intent, with what treatment. Outputs a
  per-page allocation plan + a source trace audit trail. This is the
  intelligent cross-page sorter — informed by church-website patterns
  (ministry-model templates) AND the partner's actual content + goals
  + persona journeys, NOT just the existing site's structure.
model: anthropic/claude-fable-5
allowed-tools: Read
version: '1.0.0'
references:
  - ../page-outlines-by-ministry-model.md
  - ../canonical-templates.json
  - references/storybrand-and-flow.md
---

# Plan Cross-Page Allocation

You decide what content lives on what page. This is the most
intelligent thinking step in the cowork pipeline. After you,
`outline-page` translates your allocation into a per-page section
structure with archetypes and slot bindings.

## Read before composing

Two reference files load every run:

1. **`../page-outlines-by-ministry-model.md`** — full church-website
   pattern reference. Section conventions per page type × ministry
   model (attractional / discipleship / missional). Use as
   **frame of reference, not template-first.**
2. **`./references/storybrand-and-flow.md`** — the journey-down-the-page
   framework: hook → orient → reassure → inform → deepen → invite →
   close. Plus when to use which flow_role per page type.

Load them BEFORE looking at the project sources.

## What you are NOT doing

- You are NOT preserving the existing site's structure. If the
  partner's old site has "Our service is 75 minutes long" as a
  headline, you can absolutely move that into an FAQ entry, weave it
  into a paragraph in the visit page's "what to expect" section, or
  cut it entirely if it doesn't serve the persona's journey.
- You are NOT writing copy. You decide allocations + treatments.
  outline-page + draft-page write copy.
- You are NOT deciding archetypes or slot bindings. Those are
  outline-page's job. You can SUGGEST an archetype per section_intent
  but outline-page may override based on what actually fits.
- You are NOT picking voice exemplars per section. That's outline-page
  + draft-page. You assign which strategic pillars are RELEVANT to
  each section; downstream decides which to anchor on.

## Strategic Goals — inputs you MUST consume

The starter prompt loads `roadmap_state.strategic_goals` and filters
to fields with `status='approved'`. Treat them as load-bearing:

- **`copy_approach.derived.intended_verbatim_band`** (`high` / `mid` /
  `low`) — every entry in your output `allocations[]` MUST carry
  `intended_verbatim_band` set to this exact value. Outline + draft
  enforce it downstream. high → ≥70% verbatim from crawl; mid → ~50%;
  low → ≤20%, treat crawl as background.
- **`ministries_to_grow`** — every named ministry MUST appear as a
  featured allocation slice on the homepage allocation AND on its own
  page allocation when the sitemap has one for it.
- **`content_needs`** (AM handoff) — the listed pages/areas need
  larger allocation slices (more atoms + sections).
- **`best_outreach_methods`** — earns its own allocation slice with a
  clear CTA atom assignment.
- **`additional_clarifications`** — each item routes to the
  allocation entry it informs; record the routing in
  `allocations[].rationale` so the strategist can audit.
- **`top_3_website_goals`** + **`ideal_website_experience`** — frame
  the relative emphasis between pages.

## Your input (from cowork-director)

```ts
{
  project_id: string
  sitemap:     CoworkSitemap                            // stage_2 — every page slug + name + nav structure
  site_strategy:  CoworkSiteStrategy                    // siteflow, persona_journeys, page_elevations
  ministry_model: CoworkMinistryModel
  stage_1:        CoworkStage1                          // personas, x_factor, voice exemplars
  pillars:        CoworkAtomRow[]                       // ALL strategic pillars (compact — just topics + bodies)
  facts:          CoworkFactRow[]                       // ALL structured facts (staff, programs, services, etc.)
  crawl_topics:   Array<{                               // ALL crawl topic rows from web_project_topics
    topic_key:     string
    topic_label:   string
    topic_group:   string
    inventory_kind: string
    coverage_status: string
    /** Just the passages + items — no need to send full row metadata */
    passages: Array<{ url?: string; text: string }>
    items:    Array<Record<string, unknown>>
  }>
  content_collection: Record<string, unknown>           // ALL content collection field keys + values
}
```

### Director input contract

cowork-director MUST prepare the payload like this — it keeps the call
affordable and removes the biggest hallucination surfaces:

- **Handles, not bare UUIDs.** Give every pillar and fact a short stable
  handle (`pillar:voice_rule/money_once_weekly`, `fact:staff/craig`)
  alongside its UUID. The model allocates by handle; the importer expands
  handles back to UUIDs and REJECTS any handle not in the input.
- **Cap crawl items.** Send at most ~8 sample items per topic plus the
  total count. Allocation needs the shape and density of a topic, not all
  89 sermon rows.
- **Quarantine noise before sending.** Topics that are dominated by
  platform boilerplate, 404 placeholders, or duplicates (commonly the
  `other` topic) should be pre-filtered or sent as counts + a one-line
  characterization. Don't pay tokens for Squarespace template text.
- **Send facts compactly.** id/handle + topic + a ≤200-char preview of
  `data`. Full payloads resolve at bind time, not here.
- **Mark duplicates.** If two atoms carry identical bodies from different
  sources (e.g., the mission captured from both strategy brief and
  discovery questionnaire), tag the non-canonical one `duplicate_of` so
  this skill doesn't have to guess.

## What you output

`CoworkPageAllocationPlan` (see `src/types/coworkBundle.ts`). Three
parts:

1. **`allocations`** — one entry per sitemap page. Each has a sequence
   of `section_intents`, each with a `flow_role`, a `section_job`
   (one sentence: what this section accomplishes for the primary
   persona), and a list of `sources` (every piece of content that
   should land in this section, with a `treatment` hint).

2. **`source_traces`** — for EVERY source you placed, a trace of
   where it landed. A source can have multiple placements (kids info
   as hook on home + full inform section on kids). The strategist
   reviews this trace in a content-coverage view to verify nothing
   important got dropped.

3. **`unresolved_sources`** — sources you did NOT place anywhere, with
   a reason. Don't pad this list; if a source is genuinely irrelevant
   (e.g., a CSV of inactive volunteers from 2019), mark it
   unresolved. But every active piece of content should land
   somewhere. `reason` MUST come from this closed vocabulary, and every
   entry MUST carry a `detail` string specific enough to act on:
   `crawl_noise_parking_lot` · `csv_routed_elsewhere` ·
   `structured_data_routed_to_facts` · `insufficient_items_for_template` ·
   `required_slots_unfilled` (include `slot_gap`) ·
   `duplicate_of_placed_source` ·
   `internal_admin_contact_not_for_publication` ·
   `insufficient_source_content`.

4. **`build_directives`** — build/workflow requirements that are NOT
   page copy and must not be forced into either bucket above. Pillars
   with topic `recommended_page` (staff CPT, redirect map, seasonal
   theming, guide consolidation, page-priority directives) land here
   with `applies_to` (a page slug or `site_wide`) and a one-line
   `directive` for the dev handoff. Where a directive shapes copy
   posture (e.g., "affirming language must read as natural expression"),
   ALSO encode it into the relevant `section_job` text — the directive
   entry is the audit trail, the section_job is the enforcement.

## Decision rubric per source

For every source, ask the journey questions in order:

1. **Which persona is this most relevant to?** (named or implicit)
2. **At what point in that persona's journey?** Are they orienting
   (hook), wrestling with a barrier (reassure), ready to commit
   (invite)?
3. **Which page(s) does that persona spend time on?** (Look at
   `site_strategy.persona_journeys.entry_points` + the typical
   ministry-model template for that page type.)
4. **Within that page, what section_intent does this source serve?**
   Don't just dump it into "inform" — pick the flow_role that
   matches what this source actually does for the persona.
5. **What treatment fits?** A 75-minute service note isn't a hook —
   it's an `inform` fact, probably `surface_as_faq` or
   `weave_into_paragraph`. A voice sample from a sermon isn't a
   feature card — it's a `voice_anchor` for the section.

### Source kinds (closed vocabulary)

Every entry in `section_intents[].sources[].kind` MUST be one of:

| kind | what it refers to | ref shape |
|---|---|---|
| `pillar` | content_atoms row | row UUID |
| `fact` | church_facts row | row UUID |
| `crawl_topic` | web_project_topics row (existing site content) | `topic_key` string |
| `content_collection` | strategy_content_collection_sessions field | field key string |
| `external` | **Off-site CTA target only — never content lift.** Guest-card pages, email lookup endpoints, ministry-partner sites the page should link to but never quote from. | absolute URL or `mailto:` |

Do NOT shorten — `crawl_topic` not `crawl`. The validator rejects
off-vocab kinds with `bad_source_kind`. `external` is only legitimate
when paired with `treatment: 'cta_attach'` (the source is the
section's invite/close link, nothing else).

## Empty-slot prevention (read before allocating)

Before picking a canonical template for a section, load
`../canonical-templates.json` and inspect its
`page_section_templates[concept].cowork_writable_slots`. Note which
slots are `required: true`.

For EVERY section you allocate sources to, check: do the allocated
sources contain enough content to populate all required slots of the
picked template? Specifically:

- `primary_heading` (always required) — at least one source must
  contain a short, lift-able phrase (≤100 chars) that works as a
  heading. A 600-word prose paragraph isn't a heading; flag it.
- `items` array with `max_items >= 3` (e.g., accordion_faq) — count
  the distinct items you're allocating. If fewer than the required
  minimum, that section can't be filled. Drop the section OR
  surface in `unresolved_sources` with reason `insufficient_items_for_template`.
- For palette-ref groups (items with `uses_palette: Card`), the
  bind-time importer resolves to the project's actual Card variant
  via `project.curated_library.card_*`. You don't need to verify
  the Card schema, but you DO need to ensure each item has the
  uniform sub-content (item_heading, item_body, item_meta if
  applicable).

If a section's required slots can't be filled, do NOT silently drop
the section. Either:
- Pick a DIFFERENT template within the family (e.g., hero_homepage
  → hero_inner if you don't have tagline), OR
- Mark in `unresolved_sources` with `reason: required_slots_unfilled`
  and `slot_gap: { template_id, slot_key, why }`

This surfaces the gap BEFORE outline-page even runs. Cheaper to
catch here than to fail at bind time after 8 expensive LLM calls.

## Hard rules

- **Every active CONTENT source gets placed or explicitly unresolved.**
  This applies to: pillars with topic in {`mission_statement`,
  `vision_statement`, `x_factor`, `ethos`, `value_statement`,
  `persona`, `story`, `denominational_signal`}; all crawl topics;
  all content_collection prose fields; all facts. Silent drops fail
  the content coverage check.
- **Voice pillars (topic in {`voice_rule`, `voice_sample`,
  `tone_descriptor`}) do NOT need a content placement.** Instead,
  they get placed via `voice_anchor` treatment on the sections of
  primary pages (home, visit, about, give) where the voice should
  imprint. A voice_sample pillar is NOT placed as section content
  unless the partner's wording is also the literal headline copy.
  Without this distinction the model would force voice rules into
  inform sections where they don't belong.
- **Verbatim CONTENT pillars MUST get `lift_verbatim` treatment.** For
  pillars in the content-topic set above (plus `prose_snippet`), if
  `atom.verbatim === true` the only valid content treatment is
  `lift_verbatim`. Never `weave_into_paragraph`, never
  `reframe_for_persona`. The verbatim flag means the partner's
  exact wording IS the value — losing it loses the signal.
  **Scope note:** this rule does NOT convert voice pillars into page
  copy. A verbatim `voice_rule` ("we don't use sacrificial atonement
  language") is an instruction, not copy — it gets `voice_anchor`, and
  the verbatim flag means downstream must receive the rule text
  unparaphrased. A verbatim `voice_sample` gets `voice_anchor` by
  default and `lift_verbatim` ONLY where its wording is literally the
  page copy (e.g., crawled copy on a carry-forward page).
- **Pillars (`content_atoms`) reference by UUID.** Never re-state
  pillar text in your output — just the atom_id + treatment.
- **Crawl topics reference by `topic_key`.** Never re-state passages.
- **Content collection references by field key.** Never re-state.
- **Facts reference by `id`.** Never re-state body.
- **Cross-page reuse is encouraged when intentional.** If the kids
  ministry intro belongs as a hook on home AND as full inform on
  /kids, place it BOTH places with different treatments and rationales.
- **Restructure freely.** If the partner's site labels "Mission" as a
  full-width banner and you think it belongs as a paragraph in
  About's intro section, do it. Note the rationale in the trace.
- **Respect partner vocabulary.** If the partner says "Engage the
  City," don't substitute "Mission." When you pull a voice anchor
  pillar, the pillar's `body` IS the partner's word.
- **Section count per page is up to you.** Match the ministry-model
  template's range (~3-7 sections for most pages) but adjust to the
  partner's actual content density. Don't pad to hit a template.
- **Crawl coverage_status values are `rich` / `covered` / `sparse`.**
  `rich` and `covered` topics MUST be placed. `sparse` topics may be
  placed (often absorbed into a parent page's section) or unresolved
  with reason `insufficient_source_content` — never silently dropped.
- **Honor Stage 1's `topic_coverage_plan` as your routing prior.** It
  already decided own_page / absorbed_into / parking_lot per crawl
  topic. Your job is the SECTION-level placement and cross-page reuse,
  not re-litigating page destinations. Deviate only when the actual
  content density demands it, and say why in the trace rationale.
- **Duplicate atoms:** place every duplicate at the same target with a
  `note` naming the canonical atom (or unresolve the duplicate with
  reason `duplicate_of_placed_source`). Never place identical bodies at
  different targets as if they were two ideas.

## Routing rigor (do this BEFORE finalizing placement)

Inspect the **actual passages/items** of any ambiguous crawl topic
before routing — especially the `other` bucket and every `rich` or
`covered` topic whose destination isn't obvious from `topic_label`
alone. Models that route by label-only routinely drop content the
strategist wanted preserved.

**Never silently drop a `rich` or `covered` topic**: either place it,
or list it in `unresolved_sources` with a closed-vocabulary reason
(see `CoworkUnresolvedReason` in the bundle types). `sparse` topics
may be absorbed into a parent page's section OR unresolved with a
reason — your call, but document it.

## Built-in verification — run BEFORE handing the plan to the strategist

Run these checks against your own output, fix anything that fails,
re-run the audit, THEN ask the strategist to review. Report the
results as a table in the review so they can see you actually ran
them.

1. **Inventory coverage** — every `content_atom.id` lands in
   **exactly one of three buckets**:
   - **`allocations[].section_intents[].sources[]`** — placed on a
     page (the default outcome).
   - **`unresolved_sources[]`** — deliberately set aside with a
     closed-vocabulary `reason` (duplicate of an already-placed
     source, internal-admin contact, crawl noise, etc.).
   - **`build_directives[]`** — only legitimate destination for
     atoms with `topic: 'recommended_page'`. These are
     page-creation suggestions for the dev handoff, not content to
     place. Each directive stamps `source_kind: 'pillar'` +
     `source_ref: <atom_id>` so the audit trail survives.

   Coverage rule: `allocated ∪ unresolved ∪ directives ==` every
   approved/draft atom. Same rule for `web_project_topics.topic_key`
   (typically allocated or unresolved; directives are atom-only).
   Same rule for `church_facts.topic` groups.

   List anything missing AND list anything in build_directives that
   isn't a `recommended_page` atom (that's a routing error).
2. **Verbatim band stamped.** Every entry in `allocations[]` carries
   `intended_verbatim_band` equal to the approved
   `copy_approach.derived.intended_verbatim_band`. No entry left null
   when the strategist has approved the field.
3. **Structure.** Every page has ≥3 `section_intents` ending in
   `invite` or `close` (except pages flagged `excluded_from_creative_lift`).
   Every page named in `persona_journeys[].entry_points` opens with
   a `hook` section.
4. **Strategy mapping.** Each item in `top_3_website_goals`, each
   ministry in `ministries_to_grow`, each item in `content_needs`,
   each method in `best_outreach_methods`, and each display / copy /
   nav preference maps to a specific page or section. Flag any not
   accommodated and propose where they should land.

If a check fails, fix it and re-run the audit before involving the
strategist.

## Review format

Walk the strategist through each page's allocation in a
**human-friendly view** — a scannable per-page layout (page → ordered
sections → source ref + treatment + verbatim band, with flags for
unresolved or low-confidence). **Not raw JSON.** Keep the JSON as the
persisted artifact only. Pause for the strategist's push-back before
persisting.

## Quality bar before returning

Every item below is mechanically checkable. The runtime runs
`validate_allocation_plan.py` (in this skill folder) against your output
and may return the failure list for ONE repair pass — fix only the named
gaps, don't regenerate the whole plan.

Before emitting, re-read your output:

1. Does every sitemap page have at least 3 section_intents AND end
   in either `invite` or `close`? If not, the journey is incomplete.
2. Did you place EVERY pillar somewhere? Voice pillars belong as
   `voice_anchor` on at least one section per primary page type.
3. Are all 5+ persona journey entry_points covered by a hook section
   on the page they land on?
4. Did you reuse content where the journey calls for it (don't be
   shy — repetition with different treatment is good UX)?
5. Are unresolved_sources genuinely unresolvable, or are you
   skipping work?

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
