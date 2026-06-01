---
name: web_content_map_builder
version: 1
model: anthropic/claude-haiku-4-5
reviewer_model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_outputs: |
  No direct Supabase writes in v1. Output JSON consumed by sitemap_builder
  (next step) and section_planner (downstream). In production v2, the final
  atom × page × role assignments will write to content_page_map AFTER
  section_planner runs — this step only produces the upstream content-density
  analysis that informs the strategic structural decisions.
references:
  - references/sitemap-strategy.md          # §4 density-driven nesting
  - cowork-skills/web-intake-normalizer.md  # Produces atoms + facts this skill consumes
  - cowork-skills/web-voice-card-compiler.md  # Voice card may hint at audience-density signals
description: |
  The first content-shape analysis in the pipeline. Groups atoms and
  facts by topic, scores density per group, proposes "natural pages"
  the content shape implies, and flags consolidation candidates per
  the standard rules in references/sitemap-strategy.md §4. Output is
  the structural-content layer that informs sitemap_builder's
  strategic decisions and section_planner's later atom assignments.

  This skill does NOT decide the final page set, does NOT propose nav,
  does NOT assign atom × page roles, does NOT pick brixies concepts.
  It surfaces what the CONTENT alone suggests — sitemap_builder
  applies strategic-spine rules on top to produce the locked structural
  decisions.
---

# Web Content Map Builder — Skill v1

The third skill in the autonomous pipeline, running BEFORE sitemap_builder. Its job is content-density analysis: read every atom and fact from normalize_intake, group by topic, score density, propose natural pages, flag consolidation candidates.

Without this step, sitemap_builder would do the density reasoning inline — which it can, but the reasoning gets buried. By making content_map its own step, the density analysis becomes a reviewable artifact, edge cases (high-density outreach, multi-campus structures, bilingual congregations, etc.) become explicit rather than implicit, and sitemap_builder's input is a structured natural_pages proposal rather than raw facts/atoms.

This is the cleaner architectural separation: **content_map = "what does the content shape suggest?" Sitemap = "what's the final page set given strategic rules?"**

This doc has two layers:

1. **The spec** (this section + density rules + workflow + example) — the human-readable contract.
2. **The system prompt** — at the bottom, in a single fenced block. Eventually seeded into `prompt_versions.system_prompt` for `agent_name='content_map_builder'`.

---

## What the content map IS

A content-density analysis with proposed natural pages and consolidation candidates. Pure content-shape reasoning — no strategic decisions, no nav, no Phase 1 vs Phase 2 assignments. Those are the next skill's job.

```json
{
  "topic_density": {
    "kids_ministry": { "atom_count": 3, "fact_count": 0, "total": 3, "density_score": "medium" },
    "care_ministry": { "atom_count": 5, "fact_count": 0, "total": 5, "density_score": "high" },
    "staff": { "atom_count": 0, "fact_count": 21, "total": 21, "density_score": "high" },
    ...
  },
  "natural_pages": [
    {
      "proposed_slug": "/kids",
      "proposed_name": "Kids at Riverwood",
      "topic_grouping": ["kids_ministry"],
      "density_score": "medium",
      "atom_count": 3,
      "fact_count": 0,
      "rationale": "Three named kids ministries (Open Arms Nursery, Preschool Classes, Elementary Classes) plus kids check-in process and Gospel Project curriculum. Distinct audience (parents with children). Standard church website page."
    },
    ...
  ],
  "consolidation_candidates": [
    {
      "type": "merge",
      "candidates": ["/local-outreach", "/global-outreach"],
      "into": "/outreach",
      "reason": "Standard outreach consolidation per sitemap-strategy.md §3. Both serve Make Him Known mission pillar. Combined density (15 atoms+facts) supports a single robust page with distinct local + global sections.",
      "rule_source": "sitemap-strategy §3"
    }
  ],
  "atom_to_topic_group": {
    "<atom_id>": "kids_ministry",
    "<atom_id>": "care_ministry"
  },
  "_confidence_log": {...},
  "_unfilled_with_reason": {...}
}
```

## What the content map IS NOT

- Not the final page set. Sitemap_builder consumes natural_pages and applies strategic-spine rules (mandatory 4, Phase 1 cap, voice-match, nav patterns) to decide what's actually in the site.
- Not the atom × page × role matrix. That's the section_planner's job, which runs AFTER sitemap locks the final pages.
- Not a partner-facing artifact. It's input-only to downstream skills.
- Not a brixies-aware step. Concept selection comes later (section_planner).

---

## The three hard rules

### Rule 1 — Density-driven, not strategy-driven

Propose natural pages based on what the content alone supports. Do NOT add Homepage, Plan a Visit, or other strategic-mandate pages — those are sitemap_builder's domain. Do NOT prefer specific groupings because the brief recommended them — `recommended_page` atoms are lifted by sitemap, not by this skill.

This skill's job is the question "if you only saw the content, what natural pages would the content suggest?" That answer is the input to sitemap's strategic-decision pass.

### Rule 2 — Apply the standard density thresholds

Per `references/sitemap-strategy.md` §4:

- **High density** (5+ atoms or facts in the topic group, or 1+ high-density anchor like a complete sermon series): page-worthy. Propose as a natural page.
- **Medium density** (2-4 atoms or facts): page-worthy but lighter. Propose as a natural page; section_planner will fill out with chrome (hero, CTA) since the content alone won't sustain 5+ sections.
- **Low density** (0-1 atoms or facts): should be absorbed into a parent page or dropped. Do NOT propose as a natural page; flag as a consolidation candidate (`type: absorb`).

These are guidelines, not hard rules. If a topic has 4 atoms but they're each rich high-density blocks (e.g., 4 verbose ministry blocks), treat as high. If a topic has 10 atoms but they're each one-liners (e.g., 10 staff names with no bios), treat as medium.

### Rule 3 — Apply the standard consolidation rules per sitemap-strategy.md §3

Flag the following standard consolidations as `consolidation_candidates`:

- Local + Global Outreach → /outreach (per §3 standard consolidation)
- Baptism (if standalone-density) → /discovery-membership (per §3 standard consolidation)
- Membership → /discovery-membership (per §3 standard consolidation)
- Men's + Women's (if separate but neither has high density) → /adults (per §3 standard consolidation)
- Care Support Groups (low density) → /adult-studies or /care depending on church's framing

Do NOT make the consolidation decision yourself — flag it as a candidate with rationale. Sitemap_builder applies strategic-spine rules to decide whether to consolidate.

---

## Inputs

### Test mode (v1) — Cowork session

```
1. cowork-skills/riverwood-normalizer-dry-run.json
   → atoms[] (filter to content-bearing topics; ignore strategic topics)
   → facts[]
2. cowork-skills/riverwood-voice-card-dry-run.json
   → voice_card object (for audience-density signals from persona snapshots)
3. references/sitemap-strategy.md
   → §3 (standard consolidations) + §4 (density-driven nesting)
```

### Production mode (v2) — Vercel worker

```sql
SELECT * FROM content_atoms
  WHERE web_project_id = $project_id
    AND archived = false
    AND superseded_at IS NULL;
SELECT * FROM church_facts
  WHERE web_project_id = $project_id
    AND archived = false
    AND superseded_at IS NULL;
SELECT * FROM church_voice_cards
  WHERE web_project_id = $project_id
    AND superseded_at IS NULL;
```

---

## Workflow — five steps

### Step 1 — Count atoms + facts by topic

For each atom: increment `topic_density[atom.topic].atom_count`.
For each fact: increment `topic_density[fact.topic].fact_count`. When the fact has a subtopic that semantically distinguishes content groupings (e.g., partnership.subtopic = 'local' vs 'global'), count under the combined key (`partnership_local`, `partnership_global`).

Compute `total = atom_count + fact_count` per topic group.

### Step 2 — Score density per group

Apply Rule 2 thresholds. Examples for Riverwood-like data:

- `staff: 21 facts → high`
- `belief: 8 facts → high`
- `partnership_global: 10 facts → high`
- `care_ministry: 5 atoms → high`
- `service_time: 4 facts → medium (sustains a section, not a page)`
- `kids_ministry: 3 atoms → medium`
- `partnership_local: 3 facts → medium`
- `ministry_local_outreach (Food Pantry only): 1 fact → low (absorb into local outreach grouping)`

Sit on the borderline (5 = high vs. medium) with judgment — prefer "page-worthy" when the content has variety (each atom covers a distinct sub-area) and "section-worthy" when the content is repetitive.

### Step 3 — Propose natural pages

For each high or medium density topic group, propose one natural page. Provide:

- `proposed_slug` — best-guess slug. Sitemap_builder will normalize if needed.
- `proposed_name` — visitor-facing name. Defer to standard church naming conventions (Kids, Care & Recovery, Local Outreach) — sitemap_builder will voice-match against the voice card later.
- `topic_grouping[]` — which topics this page consolidates from. Could be one topic (`["kids_ministry"]`) or several (`["small_group_*", "next_steps_pathway", "class_or_discipleship_ministry"]` → `/adult-studies`).
- `density_score` — high or medium
- `atom_count` + `fact_count`
- `rationale` — one sentence explaining what content density supports this page

DO NOT propose:

- Homepage (strategic-mandate page; sitemap adds it)
- Plan a Visit (chrome page composed of cross-topic facts like service_time + wayfinding + parking + service_experience — strategic-mandate)
- Watch (mandatory; sitemap adds it)
- Give (mandatory; sitemap adds it)
- Connect (routing hub, not content-density; sitemap may add as Be Known pillar surface)
- About / Story & Beliefs (a mix of mission/vision/values/milestones/staff; sitemap composes from multiple topics)

Sitemap_builder is responsible for these strategic-mandate pages.

### Step 4 — Flag consolidation candidates

Walk natural_pages with low/medium density and check against the standard rules. For each match, emit a `consolidation_candidate` entry with:

- `type`: `merge` (combine two natural pages into one), `absorb` (move atoms from one natural page into another's section), or `split` (rare — divide one natural page when density is too high for one)
- `candidates[]`: the natural_pages affected
- `into`: the target page (for merge/absorb)
- `reason`: one sentence explaining the rule + density justification
- `rule_source`: which §3 rule applies

Sitemap_builder makes the final consolidation call. This step only proposes.

### Step 5 — Tag confidence + absences

For each natural_page, tag `_confidence_log` with:
- `lifted_from_normalizer` — the page emerged from existing atoms/facts directly
- `inferred_from_topics` — the page is a composition of multiple topic groups (rare in content_map)

Flag absences in `_unfilled_with_reason`:
- "Expected kids_ministry density but found zero atoms" → flag the gap; sitemap may still add /kids per strategic spine but the content is missing.
- "No staff facts" → flag; /leadership can't ship without them.
- "Expected service_time facts but found zero" → flag; /visit page wouldn't have core info.

---

## Output schema

See "What the content map IS" example above. Required top-level fields: `topic_density{}`, `natural_pages[]`, `consolidation_candidates[]`, `atom_to_topic_group{}`, `_confidence_log{}`, `_unfilled_with_reason{}`.

Per natural_page required: `proposed_slug`, `proposed_name`, `topic_grouping[]`, `density_score`, `atom_count`, `fact_count`, `rationale`.

Per consolidation_candidate required: `type`, `candidates[]`, `reason`, `rule_source`. Optional: `into` (for merge/absorb).

---

## Worked example — Riverwood Chapel (3490-poc)

Expected natural pages from Riverwood's atoms + facts:

| Natural page | Topic grouping | Density | Notes |
|---|---|---|---|
| `/kids` | kids_ministry (3 atoms) | medium | 3 named ministries + curriculum + check-in |
| `/students-college` | student_ministry + small_group_* (medium) | medium | Distinct audience (Kent State persona) |
| `/care` | care_ministry (5 atoms) | high | 5 named programs (Celebrate Recovery, GriefShare, Overcome, Care 101, Cancer Care) |
| `/adult-studies` | adult_ministry + small_group_* + class_or_discipleship_ministry | medium-high | Life Groups + Bible Studies + Men's Huddle + Women to Women |
| `/local-outreach` | local_outreach_purpose + ministry/local_outreach (1) + partnership/local (3) | medium | 1 ministry (Food Pantry) + 3 partners |
| `/global-outreach` | global_outreach_purpose + partnership/global (10) | high | 10 missionary partnerships |
| `/leadership` | staff (21 facts) | high | 21 staff with roles + emails + bios |
| `/discovery-membership` | next_steps_pathway + baptism_* + class_or_discipleship_ministry | medium | Discovery class + Baptism flow + Membership |
| `/give` | give_rationale + give_method + give_verse_or_saying + give_note | medium | Note: mandatory per spine, but content_map flags content-density too |
| `/watch` | sermon_vocabulary + sermon_archive_url + livestream_url | low | Pass-through page; mostly external links |
| `/story-beliefs` | mission_statement + vision_statement + church_origin + belief (8 facts) + milestone (9 facts) + church_value (7) | high | Trust-building + theology + history |
| `/events` | events_display_preference (1) + facts cross-listed | low | Mostly Planning Center embed |

Consolidation candidates:

```json
[
  {
    "type": "merge",
    "candidates": ["/local-outreach", "/global-outreach"],
    "into": "/outreach",
    "reason": "Both serve the Make Him Known mission pillar. Combined density (15 atoms+facts) supports a single page with distinct local + global sections. Standard consolidation per sitemap-strategy.md §3.",
    "rule_source": "sitemap-strategy §3"
  },
  {
    "type": "absorb",
    "candidates": ["baptism_*"],
    "into": "/discovery-membership",
    "reason": "Baptism atoms (baptism_why, baptism_experience, baptism_signup, baptism_verse_or_saying) integrate naturally with the Discovery & Membership assimilation pathway. Standard consolidation.",
    "rule_source": "sitemap-strategy §3"
  },
  {
    "type": "absorb",
    "candidates": ["membership"],
    "into": "/discovery-membership",
    "reason": "Membership is the optional 5th-week add-on to the Discovery class per content_collection. Single assimilation pathway.",
    "rule_source": "sitemap-strategy §3"
  }
]
```

Sitemap_builder then takes natural_pages and consolidation_candidates and decides:

- Apply merge: /local-outreach + /global-outreach → /outreach
- Apply absorb: baptism atoms now live as section on /discovery-membership
- Add strategic-mandate pages: Homepage, Plan a Visit, Connect (routing hub)
- Decide Phase 1 vs Phase 2 per spine rules
- Build nav structure
- Set AEO/GEO per page

That's the handoff.

---

## Failure modes the reviewer should flag

The reviewer agent should reject + send-back when:

- `natural_pages[]` includes strategic-mandate pages (Homepage, /visit, /watch, /give, /connect) — those are sitemap_builder's domain, not this skill's.
- `natural_pages[]` includes a page with density_score `low` (low-density should be a consolidation_candidate, not a proposed page).
- `topic_density{}` is empty when atoms/facts were in the input.
- `atom_to_topic_group{}` is empty when atoms were in the input.
- Density score assignments are inconsistent (e.g., 5 atoms = `medium`, 3 atoms = `high` without rationale).
- Standard consolidation candidates (Local + Global Outreach, Baptism into Discovery, etc.) are missing when their constituent topics show density.

---

## The system prompt (loaded verbatim into the model)

Everything below this line is what gets passed to the model as the system prompt for `agent_name='content_map_builder'`.

```
You are the Web Content Map Builder for Church Media Squad's autonomous website pipeline.

YOUR JOB
Analyze the content shape from a project's normalized intake (atoms + facts) and produce a structured content-density map that informs the next step (sitemap_builder). Group atoms and facts by topic, score density, propose "natural pages" the content suggests, and flag standard consolidation candidates.

YOU DO NOT MAKE STRATEGIC DECISIONS
You do NOT decide the final page set, do NOT propose nav, do NOT add strategic-mandate pages (Homepage, Plan a Visit, Watch, Give, Connect). Those are sitemap_builder's domain. You propose what the CONTENT alone suggests; sitemap applies strategic-spine rules on top.

THE THREE HARD RULES

1. DENSITY-DRIVEN, NOT STRATEGY-DRIVEN. Propose natural pages based on what content supports. Do not add strategic-mandate pages. Do not lift recommended_page atoms — that's sitemap's job.

2. APPLY STANDARD DENSITY THRESHOLDS (sitemap-strategy.md §4):
   - High (5+ atoms or facts in topic group, or 1+ high-density anchor): page-worthy
   - Medium (2-4): page-worthy but lighter; section_planner fills with chrome
   - Low (0-1): should be absorbed; flag as consolidation_candidate

3. APPLY STANDARD CONSOLIDATION RULES (sitemap-strategy.md §3): flag (don't decide) standard consolidations:
   - Local + Global Outreach → /outreach
   - Baptism → /discovery-membership
   - Membership → /discovery-membership
   - Men's + Women's (low individual density) → /adults
   - Care Support Groups (low density) → /adult-studies or /care

INPUTS
1. content_atoms[] — filter to content-bearing topics (skip strategic atoms like persona, tone_descriptor, mission_statement, x_factor — those drive voice_card not pages)
2. church_facts[] — all facts
3. church_voice_cards row — for audience-density signals (persona snapshots may hint at content priorities)
4. references/sitemap-strategy.md — §3 + §4 for density and consolidation rules

OUTPUT
Return ONE JSON object:

{
  "topic_density": {
    "<topic_key>": {
      "atom_count": int,
      "fact_count": int,
      "total": int,
      "density_score": "high" | "medium" | "low"
    }
  },
  "natural_pages": [
    {
      "proposed_slug": string,
      "proposed_name": string,
      "topic_grouping": [string],
      "density_score": "high" | "medium",
      "atom_count": int,
      "fact_count": int,
      "rationale": string
    }
  ],
  "consolidation_candidates": [
    {
      "type": "merge" | "absorb" | "split",
      "candidates": [string],
      "into": string (optional),
      "reason": string,
      "rule_source": string
    }
  ],
  "atom_to_topic_group": {
    "<atom_id>": "<topic_group_label>"
  },
  "_confidence_log": {
    "<field>": "lifted_from_normalizer" | "inferred_from_topics"
  },
  "_unfilled_with_reason": {
    "<expected_topic>": string
  }
}

WHAT GOOD LOOKS LIKE
- Every high- or medium-density topic group becomes a natural_page
- No strategic-mandate pages in natural_pages
- Standard consolidation candidates flagged
- _confidence_log entries are mostly lifted_from_normalizer
- _unfilled_with_reason surfaces missing core content (no staff = /leadership can't ship)

WHAT BAD LOOKS LIKE (you will be rejected)
- natural_pages includes Homepage, /visit, /watch, /give, /connect
- natural_pages includes low-density pages (should be consolidation_candidates)
- Density score assignments inconsistent with the threshold rules
- Standard consolidations missing when constituent topics show density

Return only the JSON. Begin.
```
