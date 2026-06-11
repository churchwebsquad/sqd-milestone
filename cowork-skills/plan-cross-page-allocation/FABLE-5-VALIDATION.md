# Fable 5 Validation Test — plan-cross-page-allocation

Use this to validate whether `claude-fable-5` produces a usable
`CoworkPageAllocationPlan` for a real project, before committing the rest of
the pipeline to it. Run in claude.ai Console or anthropic-claude UI with model
set to `claude-fable-5`.

## Pre-flight: Verify org settings

Fable 5 returns `400 invalid_request_error` on every request if the Anthropic
org's data-retention setting is below 30 days (ZDR or shorter). Confirm
retention in the Console under Settings → Privacy before running. If you hit a
400 with a clean payload, this is almost certainly the cause.

## Step 1 — Assemble the system prompt

Concatenate these FOUR files, in this order, as your single system prompt:

1. `cowork-skills/plan-cross-page-allocation/SKILL.md` (everything below the
   YAML frontmatter)
2. `cowork-skills/page-outlines-by-ministry-model.md` (full file)
3. `cowork-skills/plan-cross-page-allocation/references/storybrand-and-flow.md`
   (full file)
4. `cowork-skills/canonical-templates.json` (full file — the SKILL.md's
   empty-slot prevention section REQUIRES inspecting
   `page_section_templates[*].cowork_writable_slots`; without this file the
   model cannot run that check)

This mirrors what the cowork runtime would pass — the skill instructions plus
the reference docs it tells the model to load before composing.

## Step 2 — Build the input payload

Pull from a real project — recommend **Paradox Church (TEST), member 99005**
(`web_project_id 15394f01-b371-415e-9bae-5d6e7d50c58a`), because
canonical-templates.json was modeled from it. NOTE: member 3005 is the
PRODUCTION Paradox Redlands row and its `roadmap_state` is not populated with
stage_1/stage_2/site_strategy/ministry_model — don't use it.

Schema notes (verified against squad-data 2026-06-11):
- `roadmap_state->'stage_2'` IS the sitemap object (pages, header_nav,
  footer_nav, nav_pattern, …). There is no nested `->'sitemap'` key.
- Atoms/facts on the TEST project carry `status = 'draft'`, not `'active'`.
- `public.church_facts` has a `data` jsonb column — there is no `body` or
  `metadata`. (A different `knowledge.church_facts` table also exists;
  always schema-qualify.)
- `strategy_content_collection_sessions` is FLAT columns — there is no
  `page_one_payload` / `page_two_payload`. Select the row and use the
  non-null columns as the `content_collection` object.

Run these SQL queries via Supabase MCP:

```sql
-- A. Project meta + sitemap + site_strategy + ministry_model + stage_1
SELECT
  id,
  member,
  roadmap_state->'stage_2'                   AS sitemap,
  roadmap_state->'site_strategy'             AS site_strategy,
  roadmap_state->'ministry_model'            AS ministry_model,
  roadmap_state->'stage_1'                   AS stage_1
FROM strategy_web_projects
WHERE member = 99005;

-- B. All strategic pillars (content_atoms) — TEST project rows are 'draft'
SELECT id, topic, body, source_kind, source_ref, verbatim, confidence
FROM content_atoms
WHERE web_project_id = '<project_uuid_from_A>'
  AND status IN ('active','draft')
ORDER BY topic, created_at;

-- C. All structured facts (church_facts)
SELECT id, topic, data, source_kind, source_ref
FROM public.church_facts
WHERE web_project_id = '<project_uuid_from_A>'
  AND status IN ('active','draft');

-- D. All crawl topics with passages + items
SELECT
  topic_key,
  topic_label,
  topic_group,
  inventory_kind,
  coverage_status,
  passages,
  items
FROM web_project_topics
WHERE web_project_id = '<project_uuid_from_A>'
ORDER BY topic_group, topic_key;

-- E. Latest content collection (flat columns; no page payloads exist)
SELECT *
FROM strategy_content_collection_sessions
WHERE web_project_id = '<project_uuid_from_A>'
ORDER BY submitted_at DESC NULLS LAST
LIMIT 1;
```

Then shape into the input the skill expects:

```json
{
  "project_id": "<project uuid>",
  "sitemap": <from A.sitemap>,
  "site_strategy": <from A.site_strategy>,
  "ministry_model": <from A.ministry_model>,
  "stage_1": <from A.stage_1>,
  "pillars": <array from B — keep id, topic, body, source_kind, source_ref, verbatim, confidence>,
  "facts": <array from C>,
  "crawl_topics": [
    {
      "topic_key": "<from D.topic_key>",
      "topic_label": "<from D.topic_label>",
      "topic_group": "<from D.topic_group>",
      "inventory_kind": "<from D.inventory_kind>",
      "coverage_status": "<from D.coverage_status>",
      "passages": <from D.passages>,
      "items": <from D.items>
    }
  ],
  "content_collection": <the non-null columns of E as a single flat object>
}
```

Per the SKILL.md "Director input contract": cap crawl items at ~8 samples +
count per topic, quarantine boilerplate-noise topics (e.g. `other`), send
facts as id + topic + ≤200-char preview, and tag duplicate atoms.

## Step 3 — User message

Paste this as the user message after the system prompt:

> Produce the `CoworkPageAllocationPlan` for this project as specified by your
> skill. Output ONLY the JSON object — no preamble, no markdown fence, no
> commentary. Match the shape from `src/types/coworkBundle.ts`
> (`CoworkPageAllocationPlan` type). Validate against the empty-slot
> prevention rules in your skill before returning.
>
> Input:
> ```json
> { ...the payload from Step 2... }
> ```

## Step 4 — Evaluate the output

The output is **acceptable** if all of these hold:

- [ ] **Coverage** — every active content pillar (topic in
      `mission_statement` / `vision_statement` / `x_factor` / `ethos` /
      `value_statement` / `persona` / `story` / `denominational_signal`)
      appears in `source_traces` OR `unresolved_sources`. No silent drops.
- [ ] **Voice routing** — every active voice pillar (topic in `voice_rule` /
      `voice_sample` / `tone_descriptor`) appears with treatment
      `voice_anchor` on at least one primary page (home / visit / about /
      give), not as inform section content.
- [ ] **Verbatim respected** — every CONTENT pillar with `verbatim: true`
      (content topics above + `prose_snippet`) is placed only with treatment
      `lift_verbatim`. No `weave_into_paragraph` or `reframe_for_persona` on
      verbatim content pillars. Voice pillars (`voice_rule` / `voice_sample` /
      `tone_descriptor`) are exempt: verbatim there means the text passes
      downstream unparaphrased via `voice_anchor`; a verbatim `voice_sample`
      gets `lift_verbatim` only where it is literal page copy.
- [ ] **Crawl coverage** — every crawl topic with `coverage_status` of
      `rich` or `covered` placed; `sparse` topics placed OR explicitly
      unresolved with a reason. (There is no 'present' status.)
- [ ] **Journey shape** — every sitemap page has at least 3 `section_intents`
      AND ends in either `invite` or `close` flow_role.
- [ ] **Hook first** — every page's first section_intent has flow_role `hook`.
- [ ] **One primary invite** — every page has exactly ONE section_intent with
      flow_role `invite`. Multiple sub-CTAs in inform sections are fine, but
      the primary invite is singular.
- [ ] **Persona entry points** — every named persona in
      `site_strategy.persona_journeys` has at least one hook section on a page
      it lands on.
- [ ] **No invented content** — the output references pillars by `atom_id`,
      crawl topics by `topic_key`, content_collection by field key, facts by
      `id`. It does NOT re-state pillar bodies or crawl passages.
- [ ] **Empty-slot prevention engaged** — `unresolved_sources` either is
      empty, or each entry has a `reason` from the closed enum in SKILL.md /
      `CoworkUnresolvedReason` plus a `detail` string (and `slot_gap` when
      reason is `required_slots_unfilled`) specific enough to act on.
- [ ] **Build directives routed** — atoms with topic `recommended_page` land
      in `build_directives` (not placements, not unresolved), each with
      `applies_to` and a 1-line `directive`.

Mechanical shortcut: run `validate_allocation_plan.py` (this folder) against
the output + a sources manifest instead of hand-checking the boxes above.

The output is **NOT acceptable** if any of these:

- Plain-prose "what this page should say" content in the output (that's
  outline-page's job, not yours)
- Pillars referenced by re-stating their body instead of by `atom_id`
- Section archetypes BOUND as decisions (a `suggested_archetype` hint is
  explicitly allowed by the skill and the type; binding template_ids/slots
  is outline-page's job)
- Halting partway with an apology or asking for clarification
- `stop_reason: "refusal"` from the classifier (note category for diagnosis)

## Step 5 — If the test passes

Tell me "Fable 5 validation passed for plan-cross-page-allocation" and I'll
roll the same model into draft-page when I write it.

## Step 6 — If the test fails

Tell me the specific failure mode (which evaluation checkbox failed, or paste
the bad output snippet). I'll either:

- Revert plan-cross-page-allocation to `claude-opus-4-7` (the safe rollback),
  OR
- Iterate on the SKILL.md prompting to address the failure mode, then re-test.

Either way, draft-page stays Opus 4.7 until plan-cross-page-allocation is
green on Fable 5.
