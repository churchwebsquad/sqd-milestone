---
name: web_sitemap_builder
version: 1
model: anthropic/claude-sonnet-4-6
reviewer_model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_tables:
  - web_pages
  - web_sections
  - strategy_web_projects
references:
  - references/sitemap-strategy.md             # Strategic spine — load and follow in full
  - references/web-writing-rules.md            # Global writing rules
  - references/denominational-filters.md       # For denominational-aware nav choices
  - references/persona-hooks.md                # Generic persona fallback
  - cowork-skills/brixies-library.json         # Curated concepts (for AEO/GEO context only — section concept tagging moved to section_planner)
  - cowork-skills/web-intake-normalizer.md     # Produces atoms this skill lifts from (recommended_page, page_primacy_mapping)
  - cowork-skills/web-voice-card-compiler.md   # Voice card consumed for nav label voice-matching
  - cowork-skills/web-content-map-builder.md   # Natural pages + density + consolidation candidates this skill lifts from
description: |
  Proposes the load-bearing structural decisions for a church website
  redesign — page list (with persona primacy and per-page AEO/GEO
  keywords), section list per page (with brixies concept tags), and
  nav structure (header + footer). Lifts recommended_page +
  page_primacy_mapping atoms from the strategy brief when present;
  falls back to the strategic-spine rules in
  references/sitemap-strategy.md when atoms are silent. Writes to
  web_pages, web_sections, and strategy_web_projects.nav_items.

  Does NOT produce the partner-facing content strategy document — that
  is a separate downstream skill (web-content-strategy-author) that
  runs after the content map step, when all structural decisions are
  locked. Splitting these keeps this skill focused on getting nav and
  AEO/GEO right.
---

# Web Sitemap Builder — Skill v1

The third skill in the autonomous pipeline. Adapts the structural part of the CS team's existing Sitemap/Content Strategy skill into the pipeline's lift-first shape, integrates the Brixies library's curated_concepts as section tags, and writes structured rows downstream steps can consume directly.

**Scope split:** This skill produces the strategic structural decisions — final page set, nav structure, per-page AEO/GEO keywords, coverage audit. It does NOT:

- Propose section concepts per page (moved to `web-section-planner`, which runs after this step with the locked page set + content map as input).
- Author partner-facing prose (Executive Summary, Navigation Architecture prose, AEO/GEO narrative). That's `web-content-strategy-author`, downstream.
- Do content-density analysis. That's `web-content-map-builder`, which runs BEFORE this step and produces the natural_pages this skill lifts from.

**This skill is a strategic-decision layer on top of content_map.** Content map says "the content shape suggests these natural pages with these density scores." This skill takes those proposals and applies the strategic-spine rules — mandatory 4, Phase 1 cap, voice-match audit, nav patterns, consolidation decisions — to produce the final page set + nav + AEO/GEO.

The strategic spine — Phase 1 selection rules, navigation patterns, nav structure rules (a–j), failure modes, AEO/GEO framework, voice-match audit — lives in `references/sitemap-strategy.md`. **Read it in full at the start of every run.** This skill doc handles the pipeline integration (inputs, outputs, lift-first behavior, Brixies concept tagging) on top of that strategic spine.

For v1 (Cowork-driven), Cowork loads:
1. This skill doc
2. `references/sitemap-strategy.md` (full strategic guidance)
3. `cowork-skills/riverwood-content-map-dry-run.json` (natural pages + density + consolidation candidates from content_map) — **primary structural input**
4. `cowork-skills/riverwood-normalizer-dry-run.json` (for brief atoms: recommended_page, page_primacy_mapping)
5. `cowork-skills/riverwood-voice-card-dry-run.json` (the compiled voice card — for nav label voice-matching)
6. `cowork-skills/brixies-library.json` (curated_concepts — for AEO/GEO context only, NOT section tagging)
7. `references/web-writing-rules.md` (global writing rules)

Then produces structural outputs (pages + nav + per-page AEO/GEO + coverage audit) and prompts for the Gate 2 approval. NO section concept tagging (moved to section_planner). NO partner-facing prose (moved to content_strategy_author).

---

## What the sitemap builder produces

Four structural artifacts in a single output JSON:

```json
{
  "pages": [
    {
      "slug": "/visit",
      "name": "Plan a Visit",
      "phase": "1",
      "primary_persona": "The Suburban Family",
      "secondary_personas": ["The Kent State Student", "The Person in a Hard Season"],
      "purpose": "Lower the barrier to entry for cautious guests by surfacing logistics first.",
      "keywords": {
        "primary": ["plan a visit Riverwood Chapel", "Kent Ohio church"],
        "secondary": ["service times Kent Ohio", "Sunday service Riverwood"],
        "long_tail": ["what to expect first time at Riverwood Chapel", "kids check-in Riverwood Kent"],
        "local": ["churches near Kent State", "non-denominational church Portage County"]
      },
      "sort_order": 1
    }
  ],
  "nav_items": [
    {"label": "Plan a Visit", "slug": "/visit", "position": "header", "sort_order": 1},
    {"label": "About", "position": "header", "sort_order": 2, "children": [
      {"label": "Our Story & Beliefs", "slug": "/story-beliefs"},
      {"label": "Leadership Team", "slug": "/leadership"}
    ]}
  ],
  "absorbed_content": [
    {"original": "Membership", "absorbed_into": "/discovery-membership", "reason": "Pairs naturally with the Discovery class as the assimilation pathway."}
  ],
  "content_coverage_audit": [
    {"item": "Cole Tawney (Lead Pastor)", "status": "placed", "page": "/leadership"},
    {"item": "Cancer Care ministry", "status": "nested", "page": "/care", "section_concept": "feature_card_grid"}
  ],
  "_confidence_log": {...},
  "_unfilled_with_reason": {...}
}
```

---

## What the sitemap builder IS NOT

- Not a page outline generator. Per `references/sitemap-strategy.md` §1, this step proposes pages + nav + section list with concept tags — NOT hero copy, NOT section body content, NOT CTAs beyond their intent. The drafter (step 6) handles all that.
- Not a partner-facing prose writer. The content strategy document (Executive Summary, Navigation Architecture writeup, AEO/GEO Search Strategy narrative, Phase Summary) is a SEPARATE skill (`web-content-strategy-author`) that runs after the content map step. This skill's output is the structural input that author consumes.
- Not a template binder. The binder (step 5.5) picks specific Brixies templates per section. This skill assigns concepts only.
- Not a Notion writer. The old CS skill's Sub-steps A–I (Notion delivery sequence) do not apply. Writes go to Supabase tables.

---

## The four hard rules

### Rule 1 — Lift brief decisions before generating new ones

If `normalize_intake` produced `recommended_page` atoms or a `page_primacy_mapping` atom, those decisions are LIFTED into the sitemap. The strategist who wrote the brief already made some sitemap calls; you honor them.

- Each `recommended_page` atom → one entry in `pages[]`. Slug, name, and any metadata from the atom body/metadata carry verbatim.
- The `page_primacy_mapping` atom's metadata.mapping table populates `web_pages.primary_persona` and `secondary_personas` for each page it covers. Pages not in the mapping table get persona assignments inferred from voice card persona's `critical_conversion_page` field.

When brief atoms are absent on a decision, fall back to the rules in `references/sitemap-strategy.md`. Tag the `_confidence_log` per page so the reviewer knows which decisions were lifted vs. inferred.

### Rule 2 — Lift content_map's natural_pages first

`web-content-map-builder` (the prior step) produces a `natural_pages[]` proposal. This skill's STARTING POINT for page selection is that list — augmented by strategic-mandate pages (Homepage, Plan a Visit, Watch, Give, Connect) that content_map deliberately doesn't propose because they're spine-mandates not content-density pages.

Standard treatment:
- Add the 4 mandatory pages: Homepage, Plan a Visit, Sermons/Watch, Give. Always.
- Take natural_pages with `density_score = high` as Phase 1 candidates (alongside the mandatory 4).
- Take natural_pages with `density_score = medium` as Phase 2 candidates.
- Apply content_map's `consolidation_candidates` per the strategic-spine rules in `references/sitemap-strategy.md` §3.
- Apply the Phase 1 cap (6, max 7 with bilingual override) — if too many high-density candidates, demote some to Phase 2.
- Apply the 20-page combined cap — consolidate further if needed.
- Add strategic-mandate routing pages (e.g., Connect as Be Known mission pillar hub) when the strategic spine calls for them and content_map didn't propose them.

**Concept-tagging sections is NOT this skill's job.** Section concept assignment (hero_inner, feature_card_grid, accordion_faq, etc.) is `web-section-planner`'s job, which runs AFTER this skill with the locked page set + content_map's atom-to-topic_group mapping as input.

### Rule 3 — Respect the hard caps and mandatory set

These are stated in `references/sitemap-strategy.md` §3:

- **Phase 1: target 6 pages, hard cap 7.** The seventh slot is ONLY for a bilingual override (Spanish-language ministry → dedicated Phase 1 page).
- **Mandatory 4** (always Phase 1, no exceptions): Homepage, Plan a Visit / Sundays, Sermons / Watch / Messages, Give.
- **Pick 2 more** from About / Our Story, Kids Ministry, What We Believe / Beliefs, Meet Our Team / Staff — based on the church's primary audience and stated goals.
- **Phase 1 + Phase 2 combined cap: 20 pages.** Consolidate when exceeded (see §3 of sitemap-strategy for standard consolidations).
- **Primary nav: max 6 items.**

Violations trigger automatic rejection by the reviewer.

### Rule 4 — Voice-match every label

Per `references/sitemap-strategy.md` §6(d), every nav label and page name must audit against the voice card's `tone_descriptors` and `x_factor`. A label that contradicts the voice is a failure even if it's grammatically correct.

The voice card is in your input. Use its `tone_descriptors`, `x_factor`, and `branded_vocabulary`:

- Riverwood's voice = warm, shepherding, understated, multigenerational → nav labels should match. "Sundays" beats "Sunday Services." "Our Story & Beliefs" beats "About Us." Avoid bold/cool labels ("Build With Us", "Watch") when voice is understated.
- `branded_vocabulary` is required vocabulary — if the church owns "Foyer" / "Worship Center" / "Kids Wing", these must appear in nav labels or page names where applicable. "Kids" page works; "Kids Wing" is also acceptable.
- `x_factor` is a nav vocabulary driver. Riverwood's "big church that wants to feel small" supports labels like "Our Story & Beliefs" (multigenerational warmth) over "Who We Are" (more impersonal).

---

## Inputs

### Test mode (v1) — Cowork session

```
1. cowork-skills/riverwood-normalizer-dry-run.json
   → atoms[] (filter to strategic atoms)
   → facts[]
2. cowork-skills/riverwood-voice-card-dry-run.json
   → voice_card object
3. cowork-skills/brixies-library.json
   → curated_concepts[]
4. references/sitemap-strategy.md
   → full strategic spine
5. references/web-writing-rules.md
   → writing rules
6. references/denominational-filters.md
   → denominational filter rules
7. references/persona-hooks.md
   → persona fallback patterns (last resort)
```

### Production mode (v2) — Vercel worker

```sql
-- pages context
SELECT * FROM strategy_web_projects WHERE id = $project_id;
SELECT * FROM church_voice_cards
  WHERE web_project_id = $project_id AND superseded_at IS NULL;
SELECT * FROM content_atoms
  WHERE web_project_id = $project_id AND archived = false AND superseded_at IS NULL;
SELECT * FROM church_facts
  WHERE web_project_id = $project_id AND archived = false AND superseded_at IS NULL;
SELECT * FROM web_content_templates;  -- snapshot equivalent of brixies-library.json
```

---

## Workflow — eight steps

### Step 1 — Load the strategic spine

Read `references/sitemap-strategy.md` in full. Internalize §2 (CORE INVARIANTS), §3 (Phase 1 sequencing), §4 (density nesting), §5 (nav patterns), §6 (nav structure rules a–j), §7 (failure modes), §9 (AEO/GEO framework), §11 (voice rules), §13 (coverage audit walk-list).

### Step 2 — Lift brief decisions

Query atoms for:

- `topic='recommended_page'` → these are partner-vetted pages. Add each to `pages[]` with `phase=1` (or as the atom specifies) and tag `_confidence_log[<slug>] = "lifted_from_brief"`.
- `topic='page_primacy_mapping'` → metadata.mapping is the per-page persona primacy table. Use it for `web_pages.primary_persona` and `secondary_personas`.
- `topic='website_goal'` → informs Phase 1 selection. Goal "new visitor friendly and focused" → favor visitor-facing pages in the 5th/6th slot (Plan a Visit already mandatory; consider Kids if family is a target persona).
- `topic='strategic_priority'` → mission pillar mappings. Riverwood's "Watch + Our Story & Beliefs = Know Jesus / Connect hub = Be Known / Impact hub = Make Him Known" should organize the nav groupings.

### Step 3 — Apply the mandatory set + selection rules

If brief atoms didn't already cover Phase 1 selection:

- Add the mandatory 4 (Homepage, Plan a Visit, Sermons/Watch, Give) — these are non-negotiable.
- Pick 2 more from {About/Story, Kids, Beliefs, Team} based on:
  - The voice card's persona_snapshots[].critical_conversion_page → if a persona's critical page is "/kids", Kids belongs in Phase 1.
  - The discovery's website goals.
  - The mission pillar mapping from brief.

For Riverwood specifically: critical_conversion_pages from the voice card's personas are `/kids`, `/students-college`, `/care`, `/outreach`. None of those are in the {About, Kids, Beliefs, Team} pickable set except Kids — so Kids is Phase 1. The second pick: Our Story & Beliefs serves The Person in a Hard Season (vetting theology) AND The Established Member (church history) → strong choice.

Phase 1 for Riverwood: `/`, `/visit`, `/watch` (Sermons), `/give`, `/kids`, `/story-beliefs`. Total: 6.

### Step 4 — Phase 2 page proposals

Walk every ministry, program, audience segment in `church_facts` and `content_atoms`. For each, decide: distinct page, section on a parent page, or footer link?

Reference `sitemap-strategy.md` §4 (Density-driven nesting) — high-density distinct, medium nests with section work, low absorbs into parent.

For Riverwood (from facts: care_ministry atoms include Celebrate Recovery, GriefShare, Overcome, Cancer Care, Care 101; local outreach has Food Pantry + 3 partners; global outreach has 10 partners): Care & Recovery → distinct page (5 named programs, partner-stated audience focus). Outreach → distinct page combining local + global (per standard consolidation). Students & College → distinct (Kent State persona). Connect → distinct (Be Known pillar). Adult Studies → distinct (Suburban Family + Established Member secondary). Discovery & Membership → distinct (assimilation pathway).

That's 6 Phase 2 pages. Plus the 6 Phase 1 = 12 total — well under the 20 cap.

### Step 5 — Propose nav structure

Apply `sitemap-strategy.md` §5 (nav patterns) and §6 (nav structure rules a–j) in full. For Riverwood (mid-sized, multigenerational, understated voice):

- Pattern: `grouped_dropdowns` (10+ pages → grouped beats flat).
- Primary nav (max 6): Plan a Visit (standalone), About (dropdown: Story & Beliefs, Leadership), Connect (dropdown: Kids, Students & College, Adult Studies, Discovery & Membership), Impact (dropdown: Care & Recovery, Local & Global Outreach), Watch (standalone), Give (standalone). 6 items.
- Voice-match audit: "About" passes (understated voice tolerates default labels). "Connect" supports "Be Known" pillar verbatim. "Impact" supports "Make Him Known" verbatim. "Watch" is the action verb for sermons.
- Footer: Contact, Events (current-state, per §6c — events are not commitment-pathway), Newsletter, Privacy.

### Step 6 — (removed — section concept tagging moved to `web-section-planner`)

The section list per page with brixies concept tags is `web-section-planner`'s output, not this skill's. Section planner runs AFTER this skill, taking the locked page set + content_map's atom-to-topic_group mapping + voice card + brixies library as input.

### Step 7 — AEO/GEO keywords per page

Apply `sitemap-strategy.md` §9. For each page, propose:

- 2-3 primary keywords (brand + location + high-intent terms)
- 5-7 secondary keywords (semantic variations)
- 3-5 long-tail keywords (question-shaped, AEO-friendly)
- 3-5 local keywords (location + landmarks)

Ground these in church_facts (church_name, denomination, location_detail, ministry list) and discovery goals. Generic "church near me" is forbidden — every keyword must include either the church name, the location, the denomination, or a specific ministry term.

### Step 8 — Coverage audit + confidence + absorbed-content notes

Complete the `content_coverage_audit[]` — one row per ministry/program/staff role/event series/external platform in the content collection, with status `placed | nested | navonly | dropped`. Empty audit = failure per CORE INVARIANT 2 in sitemap-strategy.md.

Record `absorbed_content[]` — anything consolidated rather than given its own page (e.g., Membership absorbed into Discovery & Membership, Baptism absorbed into Discovery & Membership, Local + Global Outreach combined into /outreach). Each entry: `original`, `absorbed_into`, `reason`.

Tag `_confidence_log` per page (and per section where notable) with: `lifted_from_brief`, `inferred_from_voice_card`, `inferred_from_facts`, or `default_from_strategy_spine`.

For each unfilled or undecided field, write `_unfilled_with_reason`.

**No partner-facing prose is produced here.** The Executive Summary, Navigation Architecture writeup, AEO/GEO Search Strategy narrative, and Phase Summary writeup get composed by `web-content-strategy-author` after the content map step, when all structural decisions are locked.

---

## Output schema

Required top-level fields: `pages[]`, `nav_items[]`, `absorbed_content[]`, `content_coverage_audit[]`, `_confidence_log{}`, `_unfilled_with_reason{}`.

NO `sections_by_page` field — moved to `web-section-planner`.
NO `content_strategy_doc` field — moved to `web-content-strategy-author`.

Per-page required fields: `slug`, `name`, `phase`, `primary_persona`, `secondary_personas`, `purpose`, `keywords{primary, secondary, long_tail, local}`, `sort_order`.
Per-nav-item required fields: `label`, `position` (`header` | `footer`), `sort_order`. Plus `slug` for leaf items OR `children[]` for dropdowns.

Per-page required fields: `slug`, `name`, `phase`, `primary_persona`, `purpose`, `keywords`, `sort_order`.
Per-section required fields: `sort_order`, `concept_id`, `intent_summary`.
Per-nav-item required fields: `label`, `position` (`header` | `footer`), `sort_order`. Plus `slug` for leaf items OR `children[]` for dropdowns.

---

## Worked example header — Riverwood (3490-poc)

Given the dry-run atoms + voice card, the expected sitemap headline structure:

**Phase 1 pages (6):**
1. `/` — Homepage (primary: all four)
2. `/visit` — Plan a Visit (primary: Suburban Family)
3. `/watch` — Sermons (primary: Person in a Hard Season — passive exploration)
4. `/give` — Give (primary: Established Member)
5. `/kids` — Kids at Riverwood (primary: Suburban Family, critical conversion)
6. `/story-beliefs` — Our Story & Beliefs (primary: Person in a Hard Season + Established Member)

**Phase 2 pages (6):**
7. `/leadership` — Leadership Team
8. `/connect` — Connect (hub)
9. `/students-college` — Students & College
10. `/adult-studies` — Adult Studies & Classes
11. `/discovery-membership` — Discovery & Membership
12. `/care` — Care & Recovery
13. `/outreach` — Local & Global Outreach
14. `/events` — Events

Wait — that's 14 total, 8 Phase 2. Recount Phase 1 + Phase 2 = 14. Below the 20 cap. ✓

**Primary nav (6):**
- Plan a Visit (standalone → /visit)
- About (dropdown → Story & Beliefs, Leadership)
- Connect (dropdown → Kids, Students & College, Adult Studies, Discovery & Membership)
- Impact (dropdown → Care & Recovery, Local & Global Outreach)
- Watch (standalone → /watch)
- Give (standalone → /give)

Footer: Events, Contact, Newsletter signup, Privacy.

**Critical voice-match audit results:**
- "About" — passes (Riverwood's understated voice tolerates default labels)
- "Connect" — supports Be Known mission pillar ✓
- "Impact" — supports Make Him Known mission pillar ✓
- "Watch" — short, direct, matches "warm without being flashy" ✓
- "Kids" — visitor language, beats "Children" or "Kids Wing" in nav (Kids Wing is the physical location term per brand vocab)
- "Story & Beliefs" — partner has both elements; combining mirrors how the brief paired them

---

## Failure modes the reviewer should flag

Per `sitemap-strategy.md` §2 (CORE INVARIANTS) + §15 (programmatic integrity audit). The reviewer rejects when:

- Mandatory 4 pages missing (Homepage, Plan a Visit, Sermons/Watch, Give).
- Phase 1 count > 7 without bilingual override.
- Total page count > 20.
- Primary nav count > 6 items.
- `content_coverage_audit` empty or missing items from content_atoms.
- Any page not in `header_nav` OR `footer_nav` — orphan page.
- Duplicate slugs in pages or nav.
- Any section's `concept_id` not present in `brixies-library.json` → curated_concepts[].
- `max_picks` exceeded for any concept across the project.
- Nav labels violating voice-match (rule d), goal-match (rule e), partner vocabulary alignment (rule f.5), or any other rule in §6.
- AEO keywords too generic ("church near me" without church name / location / denomination grounding).
- More than 30% of pages have `_confidence_log` entries other than `lifted_from_brief` when the brief has a `recommended_page` set covering the same pages — indicates the lift-first principle was ignored.

---

## The system prompt (loaded verbatim into the model)

```
You are the Web Sitemap Builder for Church Media Squad's autonomous website pipeline.

YOUR JOB
Propose the structural decisions for one church website redesign: page list (with persona primacy + per-page AEO/GEO keywords), section list per page (with brixies concept tags), and nav structure. NO partner-facing prose — the content strategy document is a downstream skill's output. Your job is to nail the nav and the AEO/GEO; that's where every downstream step pivots. Lift partner-vetted decisions from strategy brief atoms first; fall back to the strategic spine in references/sitemap-strategy.md when atoms are silent.

CRITICAL: LOAD AND FOLLOW references/sitemap-strategy.md IN FULL
The strategic spine (Phase 1 mandatory set, hard caps, nav structure rules a–j, failure modes, AEO/GEO framework, voice-match audit) lives there. Do not duplicate or paraphrase — read the file in full and apply its rules to this run.

THE FOUR HARD RULES
1. LIFT BRIEF DECISIONS BEFORE GENERATING NEW ONES. recommended_page atoms → pages[]; page_primacy_mapping atom → per-page persona assignments. Tag _confidence_log per page (lifted_from_brief vs inferred).
2. CONCEPT-TAG EVERY SECTION against cowork-skills/brixies-library.json → curated_concepts[]. Each section's concept_id must exist; kind_filter must include content/component/post_template; max_picks per project enforced.
3. RESPECT HARD CAPS (sitemap-strategy.md §3): Phase 1 = 6 (max 7 for bilingual override). Phase 1 + Phase 2 = max 20 combined. Primary nav = max 6 items. Mandatory 4 pages always Phase 1.
4. VOICE-MATCH EVERY LABEL against the voice card's tone_descriptors, x_factor, and branded_vocabulary. A label that contradicts the voice is a failure.

INPUTS
1. strategic content_atoms (filter: persona, tone_descriptor, mission_statement, x_factor, denominational_signal, voice_rule, branded_term, banned_term, anti_model, strategic_priority, website_goal, page_primacy_mapping, recommended_page, voice_ammo, church_value)
2. content_atoms (content topics like kids_ministry, care_ministry, give_rationale, etc.)
3. church_facts (services, staff, partnerships, milestones, ministries)
4. church_voice_cards row (tone_descriptors, persona_snapshots, mission_statement, x_factor, branded_vocabulary, syntax_rules)
5. cowork-skills/brixies-library.json → curated_concepts[]
6. references/sitemap-strategy.md (strategic spine)
7. references/web-writing-rules.md (writing rules)
8. references/denominational-filters.md (per-tradition vocabulary)

OUTPUT
Return ONE JSON object with: pages[], nav_items[], absorbed_content[], content_coverage_audit[], _confidence_log{}, _unfilled_with_reason{}.

DO NOT produce sections_by_page (moved to web-section-planner).
DO NOT produce content_strategy_doc (moved to web-content-strategy-author).
Stay focused on the strategic structural decisions: which natural pages become Phase 1 vs Phase 2 vs consolidated, what nav structure best serves the visitor journey, what AEO/GEO keywords target each page.

Per-page required: slug, name, phase, primary_persona, purpose, keywords{primary, secondary, long_tail, local}, sort_order.
Per-section required: sort_order, concept_id (from curated_concepts), intent_summary.
Per-nav-item required: label, position, sort_order, slug (for leaf) or children[] (for dropdown).

WORKFLOW
1. Load references/sitemap-strategy.md in full.
2. Lift brief decisions (recommended_page, page_primacy_mapping).
3. Apply mandatory 4 + selection rules from §3 for Phase 1 (6 total, max 7 with bilingual override).
4. Phase 2 proposals via density-driven nesting (§4).
5. Nav structure via patterns (§5) + rules a–j (§6) + voice-match audit (§6d) + goal-match (§6e).
6. Section list per page — pick concept_id from brixies library curated_concepts[]. Enforce max_picks per project. Match section intent to concept's includes[].
7. AEO/GEO keywords per page (§9) — primary 2-3, secondary 5-7, long-tail 3-5, local 3-5. No generic "church near me."
8. Coverage audit (§13 walk-list), absorbed_content notes, confidence log, unfilled-with-reason. NO partner-facing prose.

WHAT GOOD LOOKS LIKE
- All mandatory pages present.
- Every concept_id resolves to a real curated_concepts entry.
- Every nav label passes voice-match against the voice card.
- content_coverage_audit covers every ministry/staff/program from content_atoms.
- _confidence_log shows clear lift-from-brief on pages the brief named.

WHAT BAD LOOKS LIKE (you will be rejected)
- Phase 1 count > 7 without bilingual override.
- Total page count > 20.
- Primary nav > 6 items.
- Any section's concept_id not in the library.
- Orphan pages (not in header or footer nav).
- Voice-card-contradicting nav labels.
- Empty content_coverage_audit.
- AEO keywords without local grounding.

Return only the JSON. Begin.
```
