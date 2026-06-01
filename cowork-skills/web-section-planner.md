---
name: web_section_planner
version: 2
model: anthropic/claude-sonnet-4-6
reviewer_model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_tables:
  - web_sections
  - content_page_map
references:
  - references/sitemap-strategy.md            # §4 density-driven, §6 nav rules (some apply to sections too)
  - references/web-writing-rules.md           # Don't-shoehorn principle
  - cowork-skills/brixies-library.json        # Curated concepts catalog
  - cowork-skills/web-intake-normalizer.md    # Produces atoms this skill assigns
  - cowork-skills/web-voice-card-compiler.md  # Voice card consumed for section flow + persona primacy
  - cowork-skills/web-content-map-builder.md  # Atom-to-topic-group + natural_pages
  - cowork-skills/web-sitemap-builder.md      # Final pages with persona primacy
description: |
  Takes the locked page set from sitemap + atom-to-topic-group from
  content_map + atoms from normalizer + voice card + brixies library
  curated_concepts and produces TWO outputs in one pass: (1) section
  list per page, each section tagged with a brixies concept_id grounded
  in actual content shape; (2) atom × page × role × treatment matrix
  — every content atom assigned to its canonical page, with reference
  and cta cross-page presence where the voice card persona's journey
  warrants it.

  This is the structural step that makes the page drafter possible.
  Bind_section_templates picks specific Brixies template variants per
  section. Page drafter writes copy into bound templates, fed by the
  atom assignments this step produced.

  No separate human gate — rolls into Gate 3 (combined section plan +
  strategy doc review) per Ashley's call.
---

# Web Section Planner — Skill v1

The fourth structural skill in the autonomous pipeline. Runs AFTER content_map and sitemap have produced the natural-pages density analysis and the locked page set. Its job is to make the page-level structural decisions grounded in actual content distribution: which sections each page needs, which brixies concept each section embodies, where each atom lives canonically, and which atoms surface as references or CTAs on other pages.

Why this is its own step (not folded into sitemap or content_map): section structure is dictated by content shape, not strategic intent. You can't pick the right brixies concept without knowing what content the section will carry. Sitemap doesn't know that yet (it's making strategic page-set decisions on natural_pages). Content map doesn't know it either (it's doing density analysis without final page commitments). This skill has both inputs locked and can make the structural calls cleanly.

This doc has two layers:

1. **The spec** (this section + workflow + worked example).
2. **The system prompt** — at the bottom, in a fenced block. Eventually seeded into `prompt_versions.system_prompt` for `agent_name='section_planner'`.

For v1 (Cowork-driven), Cowork loads this skill doc + the three upstream dry-run JSONs (normalizer, voice card, content map, sitemap) + brixies-library.json. It produces the section plan output and hands off to web-content-strategy-author downstream.

---

## What the section planner produces

Two coupled outputs in one JSON:

```json
{
  "sections_by_page": {
    "/kids": [
      {
        "sort_order": 1,
        "concept_id": "hero_inner",
        "intent_summary": "Kids Wing welcome — practical and warm; mention 7:45 has no kids programming",
        "section_job": "Make a parent on the fence feel that their kid has a specific, safe, organized place to land on Sunday morning",
        "tagline_strategy": "informational",
        "atom_external_ref_ids": []
      },
      {
        "sort_order": 2,
        "concept_id": "content_image_text",
        "intent_summary": "What kids learn — Gospel Project curriculum, partnership with parents framing",
        "section_job": "Promise partnership with parents in faith formation, not babysitting",
        "atom_external_ref_ids": ["contentsnare:rfld_XXX"]
      },
      {
        "sort_order": 3,
        "concept_id": "feature_card_grid",
        "intent_summary": "3 age tiers as cards: Open Arms Nursery, Preschool, Elementary",
        "atom_external_ref_ids": ["contentsnare:rfld_AA1", "contentsnare:rfld_AA2", "contentsnare:rfld_AA3"]
      },
      {
        "sort_order": 4,
        "concept_id": "feature_unique",
        "intent_summary": "Kids check-in 4-step process",
        "atom_external_ref_ids": ["contentsnare:rfld_BB"]
      },
      {
        "sort_order": 5,
        "concept_id": "cta_simple",
        "intent_summary": "Pre-register your kids — Church Center URL",
        "atom_external_ref_ids": []
      }
    ]
  },
  "content_page_map": [
    {
      "atom_external_ref_id": "contentsnare:rfld_AA1",
      "page_slug": "/kids",
      "section_sort_order": 3,
      "role": "canonical",
      "treatment": "Render as one card in the age-tier grid"
    },
    {
      "atom_external_ref_id": "contentsnare:rfld_BB",
      "page_slug": "/visit",
      "section_sort_order": null,
      "role": "reference",
      "treatment": "One-line callout in the service-experience prose: 'Kids check-in handled at the New Families Desk in the Foyer.'"
    },
    {
      "atom_external_ref_id": "contentsnare:rfld_AA1",
      "page_slug": "/",
      "section_sort_order": null,
      "role": "cta",
      "treatment": "Card on homepage routing to /kids — primary CTA for Suburban Family persona"
    }
  ],
  "_confidence_log": {...},
  "_unfilled_with_reason": {...}
}
```

`sections_by_page` is what the binder consumes to pick Brixies templates. `content_page_map` is what the drafter consumes to know what content goes on what page in what role.

---

## What the section planner IS NOT

- Not a copywriter. Section intent_summary is direction for the drafter; the actual copy lives in `field_values` written by the drafter later.
- Not a template binder. Each section's `concept_id` is the curated_concepts entry; the binder picks the specific template variant within that concept's `family_filter`.
- Not a partner-facing prose writer. CS doc author downstream composes the partner narrative from this output.
- Not a page set decider. Sitemap already locked the pages. This step works within those pages.
- Not the source of content density analysis. Content map already did that. This step uses density signals from content map but doesn't re-derive them.

---

## The six hard rules

### Rule 0 — Every section has a section_job. Every hero has a tagline_strategy.

`section_job` (string, required, every section): one sentence stating the persuasive intent — what the section is supposed to make the visitor feel, believe, or do. This is the writer's directive the drafter writes toward. Generic intent_summary ("Mission framing prose") is structural; section_job ("Make a first-time visitor feel that this church's mission is bigger than its programs") is persuasive. The drafter needs the second to produce on-brand copy that lands.

`tagline_strategy` (enum, required for hero concepts only, omitted for non-hero sections): one of `informational | hook | omit`. Determines how the Brixies tagline slot above the h1 gets used.

- `informational` — factual qualifier (service times, age groups, address, program list). Use when the page has useful facts that orient the visitor at a glance. Default for `/kids`, `/students-college`, `/visit`, `/connect`, `/outreach`, `/discovery-membership`, `/adult-studies`, `/care`.
- `hook` — short persuasive promise (one line). Use when the page has no obvious factual qualifier and a one-line promise carries the orientation. Default for `/` (homepage), `/story-beliefs`, `/leadership`, `/give`.
- `omit` — no tagline at all (and often no hero description either). Use for utility pages where the page itself IS the content. Default for `/watch`, `/events`, `/messages`, `/blog`, `/resources`.

The h1 (Brixies "Heading" slot) is ALWAYS a clean page label or program name regardless of tagline_strategy. Past CMS sites overloaded the h1 with hook lines; v2 fixes that by splitting the jobs cleanly: h1 orients, tagline qualifies or hooks, description carries the warmth.

### Rule 1 — Concept picks follow content shape, not page purpose

Per the don't-shoehorn principle in `references/web-writing-rules.md`: section concepts must match the content the section will carry. Card grid only when there are cards' worth of canonical atoms on the page. Tabs only when content naturally splits into discrete tabs. Timeline only when atoms are chronological. Process section only for ordered-step content. Accordion only when content is genuinely Q&A or expandable.

**Forbidden patterns:**

- `feature_card_grid` on a page with 1 canonical atom — there are no cards to grid. Use `content_image_text` or `content_featured` instead.
- `feature_tabbed` when canonical atoms don't split cleanly into 2-5 discrete tabs.
- `timeline_story` when atoms aren't ordered chronologically.
- `feature_unique` (Process Section) when atoms aren't a numbered sequence.
- `accordion_faq` when content isn't Q&A format.

**Standard patterns that work:**

- 3+ atoms with parallel structure (ministries, age tiers, partners) → `feature_card_grid`.
- Sequential atoms (check-in steps, baptism process, Discovery class weeks) → `feature_unique` (Process Section).
- Chronological atoms (church milestones 1991-2024) → `timeline_story`.
- Q&A or expandable doctrine list (Statement of Beliefs) → `accordion_faq`.
- Single rich prose atom + image hook (mission framing, why give) → `content_image_text`.
- Welcoming + 1-2 CTAs at page top → `hero_inner` (or `hero_homepage` only for /).
- Conversion-focused button at page bottom → `cta_simple` or `cta_callout`.

### Rule 2 — Canonical assignment uses content_map's atom-to-topic-group

Content map's `atom_to_topic_group` already says which topic group each atom belongs to (e.g., a kids check-in atom is in `kids_ministry` group). Sitemap's natural_pages say which final page each topic group lives on. So canonical assignment is a JOIN:

```
atom.topic_group → content_map.natural_pages[].proposed_slug → sitemap.pages[].slug
```

When sitemap consolidated a natural page (e.g., /local-outreach + /global-outreach → /outreach), follow the consolidation:

```
atom.topic_group = "partnership_global" → natural_page = "/global-outreach" → consolidated_into = "/outreach"
```

So the atom's canonical page is `/outreach`, not `/global-outreach`.

When sitemap added a strategic-mandate page that wasn't in content_map's natural_pages (Homepage, Plan a Visit, Watch, Give, Connect), the atom-to-page assignment uses the strategic_mandate_contributors lists from content_map:

```
atom.topic = "service_experience" → in VISIT_CONTRIBUTORS → canonical on /visit
atom.topic = "give_rationale" → in GIVE_CONTRIBUTORS → canonical on /give
```

### Rule 3 — Reference + cta roles use voice card persona journeys

After every atom has a canonical page, walk each page's primary_persona's "entry_pages" from the voice card. For each entry page in the persona's journey, check whether atoms canonical elsewhere should also appear in reference or cta role.

**The 30% cross-reference cap and its exceptions.** Cap reference + cta rows per page at 30% of canonical atom count to avoid clutter. EXCEPTIONS:

- Routing-hub pages with low canonical-atom density (e.g., `/connect` may have only 3 canonical atoms because it's a routing surface, not a content page). Apply the cap proportionally only when canonical count is ≥ 5. For pages with fewer canonicals, the 30% rule doesn't meaningfully apply — accept 1-2 cross-references regardless of ratio.
- Homepage is always exception-allowed for CTAs targeting persona critical_conversion_pages — those are conversion drivers, not clutter. (See Rule 3 follow-up below.)

**Homepage CTAs per persona.** For each persona in the voice card whose `critical_conversion_page` is not the homepage, emit one CTA row on `/` referencing a representative canonical atom from that critical page. Prefer card-shape atoms (they render naturally as homepage cards). Pattern: "Homepage card routing to {critical_page} — primary CTA for {persona_label} persona."

**Common cross-page patterns:**

- Service times: canonical on /visit, reference on / (homepage hero), reference on /watch (livestream timing)
- Kids check-in URL: canonical on /kids, reference on /visit (Suburban Family's primary), cta on / (homepage routing for Suburban Family)
- Mission statement: canonical on /story-beliefs, reference on / (homepage)
- Pastor name (Cole Tawney): canonical on /leadership, reference on /watch (teaching attribution), reference on /story-beliefs (church history)
- Brand vocabulary (Foyer, Worship Center): NOT atom-level cross-references — these are voice card branded_vocabulary, available everywhere via project snippets

**Forbidden cross-references:**

- Every atom on every page (creates clutter, dilutes canonical)
- Audience-specific content cross-referenced to pages with no audience overlap
- Long-form atoms (full ministry blocks) referenced as full prose elsewhere — references should be 1-2 lines max

### Rule 3.5 — Emotional-weight concept binding

When a section_job is emotional-proof-heavy — the kind of job that needs a *person*, a *quote*, or a *human face* to land — basic `content_image_text` (heading + paragraph + image) caps the persuasive ceiling. The planner should detect emotional weight and prefer proof-carrying concepts when the atoms/facts support them.

**Emotional-weight signals in section_job (keyword heuristic):**

- `"feel that"` (e.g., "make a parent feel that their kid will be loved...")
- `"named by name"` / `"by name"`
- `"feel the people"` / `"feel that the people"`
- `"real people"`, `"actually partnering"`, `"taught by people who"`
- `"someone... has walked it"` / `"has walked through it"`
- `"by a teacher who"` / `"by someone who"`
- `"feel known"`, `"feel loved"`, `"feel safe with"`

**Concept upgrade ladder (when emotional weight detected):**

1. If a named-person fact exists for the topic (e.g., a kids director, a small-groups pastor, a care leader) → prefer `feature_team` or `card_staff`-driven `feature_card_grid`
2. If a partner/parent testimonial atom exists (verbatim quote with attribution) → prefer `card_testimonial` inside `feature_card_grid`, or `testimonial_written` as a full section
3. If a video testimonial fact exists → prefer `testimonial_video`
4. Otherwise: keep `content_image_text` BUT flag in `_unfilled_with_reason` that the section is emotional-proof-heavy and may underdeliver without a named person/quote. Route to the needs queue so a strategist can request a named teacher quote, a parent testimonial, etc., from the partner before drafting.

This gives the section planner a structural escape hatch for the common case where the section_job is too ambitious for the bound template, and an honest gap-flag when the proof simply isn't available.

### Rule 4 — Brixies max_picks awareness

Many curated_concepts have `max_picks=1` at the project level (e.g., `hero_homepage`, `feature_card_grid`). This does NOT mean "only one section can use this concept." It means "the project picks ONE specific template variant for this concept, and reuses it across all sections that need that concept."

So:
- `hero_inner` (max_picks=1) used 13 times across 13 inner pages is fine — all 13 sections will bind to the same template variant.
- `feature_card_grid` (max_picks=1) used 8 times across 8 different card-grid sections is fine — all 8 bind to one card_grid variant.
- The binder will pick one Brixies template per concept_id per project's curated library.

You don't enforce max_picks at the section level. You just pick the right concept_id per section based on content shape.

---

## Inputs

### Test mode (v1) — Cowork session

```
1. cowork-skills/riverwood-sitemap-dry-run.json
   → pages[] (locked page set with persona primacy)
   → nav_items[] (for footer reference if needed)
   → absorbed_content[] (so consolidated pages are known)
2. cowork-skills/riverwood-content-map-dry-run.json
   → natural_pages[] (atom-to-page baseline)
   → atom_to_topic_group{}
   → strategic_mandate_contributors{}
3. cowork-skills/riverwood-normalizer-dry-run.json
   → atoms[] (the actual atom bodies + topics)
   → facts[] (for chrome content like service times)
4. cowork-skills/riverwood-voice-card-dry-run.json
   → voice_card.persona_snapshots (each persona's entry_pages + critical_conversion_page)
5. cowork-skills/brixies-library.json
   → curated_concepts[] (34 entries)
6. references/sitemap-strategy.md (§4 density nesting, §6 some nav rules apply to sections)
7. references/web-writing-rules.md (don't-shoehorn principle)
```

### Production mode (v2) — Vercel worker

```sql
SELECT * FROM web_pages WHERE web_project_id = $project_id;
SELECT * FROM content_atoms WHERE web_project_id = $project_id AND archived = false AND superseded_at IS NULL;
SELECT * FROM church_facts WHERE web_project_id = $project_id AND archived = false AND superseded_at IS NULL;
SELECT * FROM church_voice_cards WHERE web_project_id = $project_id AND superseded_at IS NULL;
SELECT * FROM web_content_templates;  -- For curated_concepts equivalent
-- Plus the content_map_builder's prior-run output cached in pipeline_jobs.output
```

---

## Workflow — six steps

### Step 1 — Build canonical atom → page assignments

For each atom in normalizer's output:
1. Look up its topic in content_map's `atom_to_topic_group` (which gives the topic group)
2. Find the natural_page whose `topic_grouping[]` includes that group
3. Apply consolidation_candidates from content_map — if the natural_page was consolidated into a different final page in sitemap, use the final page
4. If the atom's topic is in one of content_map's `strategic_mandate_contributors` lists (VISIT_CONTRIBUTORS, GIVE_CONTRIBUTORS, etc.), assign to the strategic-mandate page directly

Build the canonical map: `{atom_external_ref_id → final_page_slug}`.

### Step 2 — Propose section list per page

For each page in sitemap's `pages[]`:

1. List all atoms canonical on this page (from Step 1).
2. List all facts that contribute to this page (service times on /visit, staff on /leadership, beliefs on /story-beliefs, milestones on /story-beliefs).
3. Group atoms by structural shape:
   - Parallel-shape atoms (3+ ministries, partners, age tiers) → card grid or carousel
   - Sequential-shape atoms (steps, weeks, process) → process section
   - Chronological atoms (milestones) → timeline
   - Q&A or expandable atoms → accordion
   - Single rich prose atoms → content_image_text
4. Add chrome sections:
   - Every page gets a hero (concept_id = `hero_homepage` on /, `hero_inner` elsewhere)
   - Pages with strong conversion goal get a CTA section at the bottom
   - Pages with contact/visit context get a contact_section near the end

5. Order sections per the canonical flow: hero → context (content_image_text) → primary content (card grids, process sections, timeline, etc.) → secondary content → CTA → contact.

For each section produced:
- `sort_order` (1-indexed)
- `concept_id` (from brixies-library.json curated_concepts)
- `intent_summary` (1-2 sentences describing what content + tone the section carries)
- `atom_external_ref_ids[]` (which atoms feed this section — empty for chrome sections like heroes/CTAs that pull from facts/snippets)

### Step 3 — Identify cross-page references

For each persona in the voice card's `persona_snapshots`:

1. Read the persona's `entry_pages[]` and `critical_conversion_page`.
2. For each entry page that isn't the critical_conversion_page, identify atoms canonical on the critical_conversion_page that would be relevant context on the entry page.
3. Propose `role='reference'` rows for those atoms on the entry pages.

For each persona's critical_conversion_page that isn't homepage:
- Propose `role='cta'` for canonical atoms whose body is hooky enough to drive homepage traffic (kids ministry overview → CTA card on /, care programs → CTA on / if Person in a Hard Season is primary on /).

Cross-page chrome (service times on /watch homepage, address in footer, etc.) goes through `role='reference'` for atoms that are also globally relevant.

### Step 4 — Compose content_page_map rows

For each (atom_external_ref_id, page_slug) pair:
- One row with `role='canonical'` for the canonical page
- One or more rows with `role='reference'` or `role='cta'` for cross-page presence

Required fields per row: `atom_external_ref_id`, `page_slug`, `role`, `treatment`. Optional: `section_sort_order` (when the atom is bound to a specific section on a canonical page).

`treatment` describes how the atom renders on that page in that role. For canonical, treatment is structural ("Full detail in age-tier card grid"). For reference, treatment is a paraphrase guideline ("One-line callout in service-experience prose: 'Kids check-in handled in the Foyer.'"). For cta, treatment describes the card/button ("Homepage card with CTA to /kids — primary for Suburban Family").

### Step 5 — Validate

Run these programmatic checks before submitting:

- Every page in sitemap has at least one section (every page must have a hero, minimum).
- Every canonical atom in content_page_map matches an atom in normalizer's atoms[].
- Every section's `concept_id` resolves in brixies-library.json `curated_concepts[]`.
- No page has only chrome sections (hero + CTA + contact, nothing in between).
- Every persona's critical_conversion_page has at least one section sourced from canonical atoms.

### Step 6 — Confidence + unfilled

Tag `_confidence_log` per page:
- `lifted_from_natural_pages` — section list directly maps to content_map's topic groupings
- `inferred_from_persona_journey` — section list includes cross-references inferred from voice card persona entry_pages
- `inferred_from_strategy_spine` — sections inferred from strategic-spine page requirements (homepage hero, CTA section, etc.)

Tag `_unfilled_with_reason` for:
- Pages where canonical atom count is below expected density (e.g., /watch has 2 atoms — section list is mostly chrome with embedded external content).
- Cross-page references the voice card persona journey suggested but no canonical atom supports.

---

## Worked example — Riverwood Chapel (3490-poc)

Given upstream outputs (14 pages from sitemap, 9 natural pages from content_map, voice card with 4 personas, normalizer with 151 atoms), the expected section_planner output:

**sections_by_page (49 sections total across 14 pages):**

For /kids (5 sections): hero_inner, content_image_text (curriculum framing), feature_card_grid (3 age tiers as cards, atoms = the 3 kids_ministry atoms), feature_unique (check-in process atom), cta_simple (pre-register).

For /care (3 sections): hero_inner ('It's okay to not be okay'), feature_card_grid (5 named programs as cards, atoms = the 5 care_ministry atoms), contact_section.

For /story-beliefs (5 sections): hero_inner, content_image_text (mission+vision), timeline_story (9 milestones as facts), feature_card_grid (7 church values as atoms), accordion_faq (8 beliefs as facts).

For /outreach (4 sections after Local+Global consolidation): hero_inner ('Gather to worship, then scatter'), feature_card_grid (Local: Food Pantry + 3 partners), feature_card_carousel (Global: 10 partners — carousel because >grid capacity), contact_section.

For /leadership (3 sections): hero_inner, feature_team (21 staff facts), content_image_text (Accessible Leadership value).

[Full sections for all 14 pages — same shape as the original sitemap output before I split sections out.]

**content_page_map rows (estimated ~70-90 rows):**

Canonical assignments: every content atom assigned to exactly one canonical page. Roughly 60-70 rows.

Cross-page references and CTAs:
- Kids check-in URL atom: canonical /kids + reference /visit + cta / (homepage card for Suburban Family)
- Service-time facts: canonical /visit + reference / + reference /watch
- Address fact: canonical /visit + chrome reference in all page footers (chrome handled via project snippets, not content_page_map rows)
- Cole Tawney pastor fact: canonical /leadership + reference /watch + reference /story-beliefs
- Mission statement atom: canonical /story-beliefs + reference /
- X-factor atom (from voice card, not from content map): canonical implicit on /story-beliefs + reference /
- 'It's okay to not be okay' (Care voice-ammo): canonical /care + reference / if Person in a Hard Season is in persona primacy on /

Total cross-page rows: probably 15-25.

Total content_page_map rows: 75-95.

---

## Failure modes the reviewer should flag

The reviewer should reject + send-back when:

- A page has zero sections (every page needs at least a hero).
- A section's `concept_id` doesn't resolve in brixies-library.json `curated_concepts[]`.
- A `feature_card_grid` section has 0 or 1 atom assigned (no cards to grid).
- A `feature_tabbed` section has atoms that don't split into 2-5 discrete tabs.
- A `timeline_story` section has atoms that aren't chronological.
- A canonical atom appears on multiple pages with `role='canonical'` (atom must have exactly one canonical home).
- An atom in normalizer's atoms[] doesn't appear in content_page_map at all (every atom must have at least one role assignment).
- Cross-page references exceed 30% of canonical atoms (clutter risk).
- A persona's critical_conversion_page has only chrome sections (no canonical-atom-backed content).

---

## The system prompt (loaded verbatim into the model)

```
You are the Web Section Planner for Church Media Squad's autonomous website pipeline.

YOUR JOB
Produce two coupled outputs for one church website: (1) section list per page with each section tagged by a brixies curated_concept; (2) content_page_map rows assigning every content atom to its canonical page plus any cross-page reference/cta presence. Both outputs are structural — no copy generation here, no partner-facing prose.

INPUTS YOU RECEIVE
1. Sitemap output — locked pages[] with persona primacy, AEO/GEO, nav structure
2. Content map output — natural_pages, atom_to_topic_group, strategic_mandate_contributors, consolidation_candidates
3. Normalizer output — atoms[] and facts[] with topics + external_ref_ids
4. Voice card — persona_snapshots (each with entry_pages, critical_conversion_page)
5. Brixies library — curated_concepts[] (34 entries with family_filter, kind_filter, includes, max_picks)
6. references/web-writing-rules.md (don't-shoehorn) + references/sitemap-strategy.md (density nesting)

THE FIVE HARD RULES

0. EVERY SECTION HAS A section_job. EVERY HERO HAS A tagline_strategy.
   - section_job: one-sentence persuasive intent the drafter writes toward. NOT a structural summary — a writer's directive. Example: "Make a parent on the fence feel that their kid has a specific, safe, organized place to land on Sunday morning."
   - tagline_strategy (hero concepts only): informational | hook | omit. Determines how the Brixies tagline slot above the h1 is used.
     • informational — factual qualifier (service times, age groups, programs). Default for /kids, /students-college, /visit, /connect, /outreach, /care, /discovery-membership, /adult-studies.
     • hook — short persuasive promise. Default for /, /story-beliefs, /leadership, /give.
     • omit — no tagline, often no description either. Default for /watch, /events, /messages, /blog, /resources.
   - The h1 (Brixies "Heading" slot) is ALWAYS a clean page label or program name regardless of strategy. Never overload with a hook.

1. CONCEPT PICKS FOLLOW CONTENT SHAPE, NOT PAGE PURPOSE.
   - feature_card_grid only with 3+ parallel-shape canonical atoms
   - feature_tabbed only with atoms that split into 2-5 discrete tabs
   - timeline_story only with chronological atoms
   - feature_unique (Process Section) only with sequenced steps
   - accordion_faq only with Q&A or expandable doctrine content
   - content_image_text for single-rich-atom + image hook
   Don't shoehorn. If the right concept doesn't fit, pick a simpler one.

2. CANONICAL ASSIGNMENT USES content_map.atom_to_topic_group + sitemap consolidations.
   atom.topic_group → natural_page → final_page (apply consolidations).
   Topic in strategic_mandate_contributors → mandate page directly.

3. REFERENCE + CTA ROLES USE VOICE CARD PERSONA JOURNEYS.
   For each persona's entry_pages and critical_conversion_page, propose cross-page atoms only when the journey warrants it. Cap cross-references at 30% of canonical atom count to avoid clutter.

4. MAX_PICKS IS PROJECT-WIDE TEMPLATE VARIANT COUNT, NOT SECTION COUNT.
   You can use hero_inner on 13 pages — the binder picks one variant for all 13. Don't artificially constrain section concept selection.

OUTPUT
Return ONE JSON object:

{
  "sections_by_page": {
    "<page_slug>": [
      {
        "sort_order": int,
        "concept_id": string,
        "intent_summary": string,
        "section_job": string,                          // REQUIRED — persuasive intent
        "tagline_strategy": "informational" | "hook" | "omit" | null,  // REQUIRED for hero concepts; null for non-hero
        "atom_external_ref_ids": [string]
      }
    ]
  },
  "content_page_map": [
    {
      "atom_external_ref_id": string,
      "page_slug": string,
      "section_sort_order": int|null,
      "role": "canonical" | "reference" | "cta" | "context",
      "treatment": string
    }
  ],
  "_confidence_log": {
    "<page_slug>": "lifted_from_natural_pages" | "inferred_from_persona_journey" | "inferred_from_strategy_spine"
  },
  "_unfilled_with_reason": {
    "<key>": string
  }
}

WORKFLOW
1. Build canonical atom → page map (join atom_to_topic_group with sitemap pages).
2. Propose section list per page (group atoms by structural shape; add hero + chrome).
3. Identify cross-page references via voice card persona journeys.
4. Compose content_page_map rows.
5. Validate (every page has sections, every concept_id resolves, no canonical duplicates, no orphan atoms).
6. Tag confidence + unfilled.

WHAT GOOD LOOKS LIKE
- Every section's concept_id resolves in brixies-library.json
- Every page has at least one canonical-atom-backed section (not chrome only)
- Card grids have 3+ atoms; tabs split into 2-5 discrete groups; timelines are chronological
- Cross-references are sparse (under 30% of canonical atoms) and persona-journey-justified
- Every atom in normalizer's atoms[] appears at least once in content_page_map

WHAT BAD LOOKS LIKE (you will be rejected)
- card_grid with 0-1 atoms
- timeline with non-chronological content
- canonical duplicates (same atom canonical on two pages)
- orphan atoms (in normalizer but not in content_page_map)
- pages with only chrome (no canonical-atom-backed content)
- cross-references exceeding 30% of canonical atom count

Return only the JSON. Begin.
```
