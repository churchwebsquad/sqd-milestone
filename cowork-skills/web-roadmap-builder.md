---
name: web_roadmap_builder
version: 1
model: anthropic/claude-haiku-4-5
reviewer_model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_writes:
  - strategy_web_projects.roadmap_opening_paragraph
  - strategy_web_projects.roadmap_properties
  - strategy_web_projects.roadmap_milestone_overview
references:
  - references/web-writing-rules.md           # Global writing rules — opening paragraph honors all
  - cowork-skills/web-intake-normalizer.md    # Atoms this skill lifts from
  - cowork-skills/web-voice-card-compiler.md  # Voice card supplies most properties
  - cowork-skills/web-sitemap-builder.md      # Sitemap phase info for milestone overview
description: |
  Composes the lean partner-facing roadmap deliverable. Mostly LIFT —
  every strategy property pulls from voice card or strategic atoms.
  Only the opening paragraph is generated, and even that is constrained
  by voice card tone + the mission/x_factor lifts. The milestone overview
  is template-driven (every CMS redesign follows the same three-phase
  journey).

  This is the simplest of the partner-facing skills. It's also the most
  forgiving — the partner reads this once at Gate 4 and again at partner
  publish, but they primarily engage with the page drafts. The roadmap
  sets expectations, not stakes.

  Replaces the previous Web Roadmap skill (which was over-engineered with
  Notion delivery sequences and dual partner-internal artifacts). This
  version writes only the partner-facing fields to
  strategy_web_projects.roadmap_*.
---

# Web Roadmap Builder — Skill v1

The sixth structural skill in the autonomous pipeline. Composes the partner-facing roadmap — the deliverable that sets expectations for what's coming after Gate 3. This is the simplest of the partner-facing skills because almost every output field is a direct lift from upstream artifacts.

The previous Web Roadmap Skill from the CS team carried two separate Notion delivery flows (one partner-facing, one internal-only flags) plus a content-template duplication sequence. None of that applies here. The new pipeline puts internal flags into the gate-notification path (ClickUp tasks per stage) and writes partner-facing content directly to Supabase columns. This skill stays focused on the partner artifact.

This doc has two layers:

1. **The spec** (this section + workflow + worked example).
2. **The system prompt** — at the bottom, in a fenced block.

---

## What the roadmap produces

Three artifacts written to `strategy_web_projects` columns:

```json
{
  "roadmap_opening_paragraph": "3-5 sentence partner-addressed welcome. Names mission, names x_factor, sets expectations for what's coming. You/Your language throughout. Voice-matched.",
  "roadmap_properties": {
    "primary_goals": "string (one-sentence lift from strategic atoms)",
    "tone_characteristics": ["string"] (lifted from voice card tone_descriptors),
    "target_audience": ["string"] (lifted from voice card persona_snapshots[].label),
    "brand_style_tags": ["string"] (lifted from brand handoff style tags or inferred from voice card),
    "x_factor": "string (verbatim from voice card)",
    "engagement_type": "string (lifted from strategy_web_projects.kind)"
  },
  "roadmap_milestone_overview": "template prose (per references/sitemap-strategy + the existing CMS standard 3-phase journey). Customized only by the partner's first name and the phase 1 page set count."
}
```

## What the roadmap is NOT

- Not the partner's primary engagement surface. The Content Strategy doc (Skill 5) is what the partner reads at Gate 3 to understand the strategy. The roadmap sets timing expectations.
- Not a project-management artifact. No deadlines, no assignee tags, no internal status. Those live in ClickUp tasks routed via the gate-notification path.
- Not editable inline by the partner. Partner can request changes via the gate; the skill regenerates.

---

## The four hard rules

### Rule 1 — Lift everything except the opening paragraph

Five of the six `roadmap_properties` fields are pure lifts:

- `tone_characteristics[]` ← voice card `tone_descriptors[]`
- `target_audience[]` ← voice card `persona_snapshots[].label` (descriptive labels, not invented names)
- `x_factor` ← voice card `x_factor` verbatim
- `engagement_type` ← `strategy_web_projects.kind` (`redesign`, `audit`, `microsite`, etc.)
- `brand_style_tags[]` ← if brand handoff atoms with `topic='brand_style_tag'` exist, lift those. Otherwise, infer 3-5 tags from voice card tone_descriptors + x_factor (mark `inferred` in confidence log).

`primary_goals` is composed from atoms with `topic='website_goal'` and/or `topic='strategic_priority'`. One sentence. Lift partner's stated language where possible.

### Rule 2 — Opening paragraph is the ONLY creative work

3-5 sentences. Partner-addressed (uses "You/Your" language). Names the mission verbatim. Names the x_factor in some form (verbatim if it fits, paraphrase if not). Sets expectations for what the partner will see next (Phase 1 pages + Gate 4 + page review). Tone-matched to voice card.

The previous Web Roadmap Skill's rules apply:
- 3 to 5 sentences. Concise and confident.
- Always You/Your. Never We/Our.
- Cover: main website goals, primary target audience, preferred tone (one of each in passing — don't list).
- Avoid churchy language. No "spiritual journey," "life-changing," "vibrant community."
- No em-dashes. Limit triad constructions.

Lift the partner's first name (from `strategy_web_projects` or the AM handoff atom) and use it once in the paragraph if natural.

### Rule 3 — Milestone overview is template, not generation

The 3-phase CMS journey is identical for every partner project (with light per-project parameter substitution). The skill outputs the standard prose with two parameters substituted:

- `{phase_1_page_count}` — number of pages launching at go-live (typically 6)
- `{partner_first_name}` — if naturally fits in a sentence

The prose itself is fixed per `references/sitemap-strategy.md` and the CMS team's standard milestone framing:

```
Milestone 1: Strategy
- Content Collection: Your journey begins by submitting your existing digital assets through ContentSnare.
- Web Strategy (Review 1): Your sitemap and page outlines are developed to create intuitive navigation.
  You'll review and approve this structural roadmap on Notion before copy begins.

Milestone 2: Copy & Design
- Message and Design: Your {phase_1_page_count} Phase 1 pages are written and designed in parallel.
- Combined Review (Review 2): You'll review the written copy alongside the visual page designs.
  Once approved, the technical build begins on schedule.

Milestone 3: Development
- The Build: Your approved designs are developed into a fully functional staging site.
- Final Quality Check (Review 3): You'll explore the staging link for a final walkthrough.
- Site Launch: Your website is officially launched.
- Alternative Option: If you're facing a strict deadline, core essential pages can be prioritized
  for a rapid initial launch with remaining pages completed in the background.
```

The skill does NOT regenerate this prose. It substitutes parameters and outputs.

### Rule 4 — Drop everything internal-only

No internal flags array. No CS Flags. No dev-team notes. No technical questions. Those route via:

- ClickUp task creation in the gate notification layer (Phase B+ work)
- The CS Flags page (separate internal artifact, downstream of section_planner if blocking items emerge)

The roadmap is partner-facing only. If you find yourself wanting to add an internal-only field, that's a sign it belongs elsewhere.

---

## Inputs

### Test mode (v1) — Cowork session

```
1. cowork-skills/riverwood-voice-card-dry-run.json
   → voice_card.tone_descriptors, persona_snapshots, x_factor, mission_statement
2. cowork-skills/riverwood-normalizer-dry-run.json
   → atoms[] filtered to: website_goal, strategic_priority, brand_style_tag
3. cowork-skills/riverwood-sitemap-dry-run.json
   → pages[] for Phase 1 page count
4. Project metadata: strategy_web_projects row for kind + partner contact name
   (For Riverwood test: kind='redesign', primary contact = Nate Walker)
5. references/web-writing-rules.md (opening paragraph rules)
```

### Production mode (v2) — Vercel worker

```sql
SELECT * FROM strategy_web_projects WHERE id = $project_id;
SELECT * FROM church_voice_cards WHERE web_project_id = $project_id AND superseded_at IS NULL;
SELECT * FROM content_atoms WHERE web_project_id = $project_id
  AND topic IN ('website_goal', 'strategic_priority', 'brand_style_tag')
  AND archived = false AND superseded_at IS NULL;
SELECT COUNT(*) AS phase_1_count FROM web_pages
  WHERE web_project_id = $project_id AND phase = '1';
```

---

## Workflow — four steps

### Step 1 — Lift the five lift-only properties

```
roadmap_properties.tone_characteristics = voice_card.tone_descriptors[]
roadmap_properties.target_audience = [p.label for p in voice_card.persona_snapshots]
roadmap_properties.x_factor = voice_card.x_factor (verbatim)
roadmap_properties.engagement_type = strategy_web_projects.kind
roadmap_properties.brand_style_tags = lift if brand_style_tag atoms exist, else infer
```

### Step 2 — Compose primary_goals

Walk atoms with `topic='website_goal'` and `topic='strategic_priority'`. Compose one sentence summarizing what the site is for, using the partner's own phrasing where possible.

For Riverwood (3 website_goal atoms): "Your new site is built to be new visitor friendly and focused, hold some resources for current members without becoming a hub for everything, and serve as the landing place for your events."

If only one website_goal atom exists, lift it verbatim and add light framing. If none exist, infer from voice card mission_statement.

### Step 3 — Compose opening paragraph

3-5 sentences. Constraints from Rule 2. Template:

- Sentence 1: address partner by name (if available), name what's being delivered (their website roadmap).
- Sentence 2: name the mission or x_factor.
- Sentence 3: characterize the audiences (use 1-2 persona labels naturally).
- Sentence 4: set expectations (Phase 1 page count + next gate).
- Sentence 5 (optional): warmth close.

Example for Riverwood: "Hi Nate. Here is the website roadmap for Riverwood Chapel — your strategic outline for the next chapter of riverwoodchapel.org. The site is built around your mission to know Jesus, to be known, and to make Him known, and around the audiences you've named: The Suburban Family, The Kent State Student, The Person in a Hard Season, and The Established Member. You'll see 6 Phase 1 pages drafted next, with a review queue waiting for your approval before anything publishes. Your voice on every page is the goal."

Voice-check: no em-dashes, no banned terms, no triad lists, Jesus named (or named in the mission lift). Friendly Expert tone.

### Step 4 — Substitute milestone overview parameters

Take the standard 3-milestone template (Rule 3). Substitute `{phase_1_page_count}` with the actual Phase 1 page count from sitemap. Substitute `{partner_first_name}` if used (it's not in the standard template by default).

---

## Output schema

Return ONE JSON object:

```json
{
  "roadmap_opening_paragraph": string,
  "roadmap_properties": {
    "primary_goals": string,
    "tone_characteristics": [string],
    "target_audience": [string],
    "brand_style_tags": [string],
    "x_factor": string,
    "engagement_type": string
  },
  "roadmap_milestone_overview": string,
  "_confidence_log": {
    "<field>": "lifted_from_voice_card" | "lifted_from_atoms" | "lifted_from_project_metadata" | "composed_from_lifts" | "inferred"
  },
  "_voice_match_self_check": {
    "no_em_dashes": boolean,
    "banned_terms_avoided": boolean,
    "no_triad_lists": boolean,
    "you_your_language": boolean,
    "mission_or_xfactor_named": boolean,
    "no_we_our_in_body": boolean
  }
}
```

---

## Worked example — Riverwood Chapel (3490-poc)

Expected output:

```json
{
  "roadmap_opening_paragraph": "Hi Nate. Here is your website roadmap for Riverwood Chapel, the strategic outline for the next chapter of riverwoodchapel.org. The site is built around your mission to know Jesus, to be known, and to make Him known, and around the audiences you've named — The Suburban Family, The Kent State Student, The Person in a Hard Season, and The Established Member. You'll see 6 Phase 1 pages drafted next, with a review queue waiting for your approval before anything publishes. Your voice on every page is the goal.",
  "roadmap_properties": {
    "primary_goals": "Your new site is built to be new visitor friendly and focused, hold some resources for current members without becoming a hub for everything, and serve as the landing place for your events.",
    "tone_characteristics": ["warm", "shepherding", "understated", "multigenerational", "authentic", "steady"],
    "target_audience": ["The Suburban Family", "The Kent State Student", "The Person in a Hard Season", "The Established Member"],
    "brand_style_tags": ["earthy", "understated", "multigenerational", "warm", "minimal"],
    "x_factor": "A big church that wants to feel small. Flat structure, accessible pastors, and a home-like atmosphere over mega-church performance.",
    "engagement_type": "redesign"
  },
  "roadmap_milestone_overview": "Milestone 1: Strategy\n- Content Collection: Your journey begins by submitting your existing digital assets through ContentSnare.\n- Web Strategy (Review 1): Your sitemap and page outlines are developed to create intuitive navigation. You'll review and approve this structural roadmap on Notion before copy begins.\n\nMilestone 2: Copy & Design\n- Message and Design: Your 6 Phase 1 pages are written and designed in parallel.\n- Combined Review (Review 2): You'll review the written copy alongside the visual page designs. Once approved, the technical build begins on schedule.\n\nMilestone 3: Development\n- The Build: Your approved designs are developed into a fully functional staging site.\n- Final Quality Check (Review 3): You'll explore the staging link for a final walkthrough.\n- Site Launch: Your website is officially launched.\n- Alternative Option: If you're facing a strict deadline, core essential pages can be prioritized for a rapid initial launch with remaining pages completed in the background.",
  "_confidence_log": {
    "roadmap_opening_paragraph": "composed_from_lifts",
    "primary_goals": "lifted_from_atoms",
    "tone_characteristics": "lifted_from_voice_card",
    "target_audience": "lifted_from_voice_card",
    "brand_style_tags": "inferred",
    "x_factor": "lifted_from_voice_card",
    "engagement_type": "lifted_from_project_metadata",
    "roadmap_milestone_overview": "lifted_from_template"
  },
  "_voice_match_self_check": {
    "no_em_dashes": true,
    "banned_terms_avoided": true,
    "no_triad_lists": true,
    "you_your_language": true,
    "mission_or_xfactor_named": true,
    "no_we_our_in_body": true
  }
}
```

Note: `brand_style_tags` lifted from inference because Riverwood's brand guide didn't yield explicit `brand_style_tag` atoms in the normalizer (the brand guide's visual identity section is rich but the words "earthy/understated/etc." weren't tagged as `brand_style_tag` topic). The skill infers from voice card tone + visual identity description. Inferred entries get tagged in `_confidence_log`.

---

## Failure modes the reviewer should flag

The reviewer should reject + send-back when:

- Opening paragraph contains any banned_term from voice card.
- Opening paragraph contains em-dashes.
- Opening paragraph uses We/Our framing.
- Opening paragraph exceeds 5 sentences or undershoots at 1-2 sentences.
- Mission and x_factor neither appear in the opening paragraph (one must).
- `target_audience[]` doesn't match voice card `persona_snapshots[].label` exactly.
- `tone_characteristics[]` doesn't match voice card `tone_descriptors[]` exactly.
- `x_factor` isn't verbatim from voice card.
- `primary_goals` lacks grounding in `website_goal` or `strategic_priority` atoms.
- `_voice_match_self_check` fields contain any `false` value.
- The milestone overview prose deviates from the standard template (the only allowed variation is parameter substitution).
- The output JSON doesn't parse or doesn't match the schema.

---

## The system prompt (loaded verbatim into the model)

```
You are the Web Roadmap Builder for Church Media Squad's autonomous website pipeline.

YOUR JOB
Compose the partner-facing roadmap deliverable. Mostly LIFT from upstream artifacts — voice card, strategic atoms, project metadata. Only the opening paragraph requires creative composition (3-5 sentences, voice-matched, You/Your language). The milestone overview is template-substitution only.

YOU ARE A LIFT-FIRST COMPOSER
Every roadmap_property field except primary_goals is a direct lift from voice card or project metadata. primary_goals is composed from website_goal and strategic_priority atoms. The opening paragraph is the only place creative writing happens, and even there you're lifting mission + x_factor + persona labels verbatim.

THE FOUR HARD RULES

1. LIFT EVERYTHING EXCEPT THE OPENING PARAGRAPH. Tone, target audience, x_factor, engagement type all lift directly. Brand style tags lift from brand_style_tag atoms if present, otherwise infer from voice card and mark _confidence_log as inferred.

2. OPENING PARAGRAPH IS THE ONLY CREATIVE WORK. 3-5 sentences. You/Your language. Names mission or x_factor verbatim. Names persona labels from voice card. References Phase 1 page count. No em-dashes, no banned terms, no triad adjective lists. Friendly Expert tone.

3. MILESTONE OVERVIEW IS TEMPLATE, NOT GENERATION. Use the standard 3-milestone CMS prose. Substitute {phase_1_page_count} only. Do not rewrite, paraphrase, or add new milestones.

4. NO INTERNAL CONTENT. The roadmap is partner-facing only. No CS Flags, no internal-only notes, no dev questions. Those route via gate notifications.

INPUTS
1. voice_card row (tone_descriptors, persona_snapshots, x_factor, mission_statement, banned_terms)
2. content_atoms filtered to: website_goal, strategic_priority, brand_style_tag
3. strategy_web_projects row (kind, primary contact name)
4. sitemap output (Phase 1 page count from pages[])
5. references/web-writing-rules.md (opening paragraph rules)

OUTPUT
Return ONE JSON object:

{
  "roadmap_opening_paragraph": string (3-5 sentences),
  "roadmap_properties": {
    "primary_goals": string (one sentence composed from website_goal atoms),
    "tone_characteristics": [string] (verbatim from voice_card.tone_descriptors),
    "target_audience": [string] (verbatim from voice_card.persona_snapshots[].label),
    "brand_style_tags": [string] (lifted from brand_style_tag atoms or inferred),
    "x_factor": string (verbatim from voice_card.x_factor),
    "engagement_type": string (verbatim from strategy_web_projects.kind)
  },
  "roadmap_milestone_overview": string (standard 3-milestone template with phase_1_page_count substituted),
  "_confidence_log": {
    "<field>": "lifted_from_voice_card" | "lifted_from_atoms" | "lifted_from_project_metadata" | "composed_from_lifts" | "lifted_from_template" | "inferred"
  },
  "_voice_match_self_check": {
    "no_em_dashes": boolean,
    "banned_terms_avoided": boolean,
    "no_triad_lists": boolean,
    "you_your_language": boolean,
    "mission_or_xfactor_named": boolean,
    "no_we_our_in_body": boolean
  }
}

WORKFLOW
1. Lift the 5 lift-only properties (tone, target_audience, x_factor, engagement_type, brand_style_tags).
2. Compose primary_goals from website_goal atoms (one sentence, lift partner language where possible).
3. Compose opening paragraph (3-5 sentences, voice-matched, names mission, names 1-2 personas, mentions Phase 1 count).
4. Substitute milestone overview template parameters.
5. Self-check voice match.
6. Tag _confidence_log per field.

WHAT GOOD LOOKS LIKE
- Every lift-only field matches voice card / atoms / project_metadata verbatim
- Opening paragraph names mission or x_factor at least once
- Opening paragraph honors You/Your language throughout
- Self-check passes all booleans
- Milestone overview matches the standard template exactly

WHAT BAD LOOKS LIKE (you will be rejected)
- Opening paragraph with em-dashes or banned_terms
- Opening paragraph rewriting "We/Our" framing
- Mission and x_factor both absent from opening paragraph
- tone_characteristics or target_audience that don't match voice card verbatim
- Milestone overview rewritten or paraphrased (template substitution only)
- Internal-only content in roadmap fields
- JSON that doesn't parse or doesn't match schema

Return only the JSON. Begin.
```
