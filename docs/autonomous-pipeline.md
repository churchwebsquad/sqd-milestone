# Autonomous Website Pipeline — Data Flow Contract

**Status:** v0.1, pre-build. Locks the data flow before schema and worker code land.
**Audience:** Anyone touching the Website Manager pipeline (humans, agents, future-Ashley, future-Claude).
**Companion:** `schema/v35_pipeline_foundation.sql` (the tables this doc describes).

---

## Why this doc exists

The old website workflow had a fatal shape: every handoff was a human re-reading a document and hand-authoring the next document. Strategy brief → handcrafted persona doc → handcrafted content catalog → handcrafted page briefs → copy. Things dropped between steps. Things drifted. Each artifact lived in a different folder in a different format, and none of them composed.

The autonomous pipeline replaces every document-shaped handoff with a structured-row handoff. Each step reads typed rows from Supabase, writes typed rows back, and triggers the next step. Humans appear only at five named gates. Between gates, no person is involved and no document is in the loop.

This doc is the contract: for every step, what tables it reads, what tables it writes, what fires it, and what it hands off to.

---

## Core principle 1: database rows are canonical; documents are renderings

The catalog, the persona doc, the site audit, the content strategy doc — none of these are maintained artifacts in the new system. They are *renderings* of the database. If a partner wants a content catalog PDF, the app generates one from `content_atoms` + `content_page_map` at the moment of request. If an AM wants to see the personas as prose, the app renders from `church_voice_cards.persona_snapshots`. The documents have no canonical persistence; the rows do.

**Practically, this means:**

- No markdown catalogs checked into project folders.
- No hand-typed persona docs maintained over time.
- If a step needs structured information, it reads it from a typed table. If a human needs a document, it's rendered on demand.

---

## Core principle 2: lift before generate

The strategy brief is human-authored intake that arrives *before* the website pipeline starts. It's prepared by the brand squad, AM, or external strategist. It already contains the strategic work — personas (named, described, grounded), brand voice tone and attributes, mission and vision, x-factor / differentiator, denominational positioning, often a page-persona primacy mapping.

The website pipeline does NOT regenerate any of this. It lifts.

**The cost of getting this wrong** — which v1 of this doc did get wrong — is the pipeline burning tokens to re-derive what's already authored, *and* risking the model inventing detail (especially in personas) even when the brief had it stated cleanly. The previous Riverwood project demonstrated this exact failure mode: a strategist invented "Matt and Lauren" / "Brian" / "Amina" persona names with fake biographies because the original analysis pretended to research personas rather than reading the ones the brief already specified.

**The rule:**

1. Every generation step starts by querying for upstream-authored content via `content_atoms` rows with strategy-brief-sourced topics.
2. If brief-sourced atoms exist for a field, the step LIFTS them — uses verbatim phrasing, preserves all detail.
3. The step only INFERS / GENERATES when the relevant atoms are absent.
4. The step never INFERS DETAIL beyond what an atom contains. If a persona atom names two needs, the step uses two needs; it doesn't extrapolate a third.
5. Lift provenance is captured. `_confidence_log` in any synthesized output tags each field as `lifted_from_brief`, `lifted_from_brand_guide`, `lifted_from_discovery`, `inferred`, or `guessed`.

**The architectural implication:** `normalize_intake` does much more work than the original v1 spec implied. Its job isn't just to extract facts from the content collection; it's to extract *every authored artifact* — personas from the strategy brief, tone descriptors from the brief, mission canonical-form, x-factor, voice rules from the brand guide, anti-models from discovery — as appropriately-tagged `content_atoms` rows. The downstream synthesis / generation steps then read these atoms as their primary source.

**The two atom flavors:**

`content_atoms` carries two semantically distinct kinds of rows, distinguished by topic:

- **Content atoms** (topic = `kids`, `services`, `staff`, `ministry`, `beliefs`, etc.): prose-shaped units that get rendered into page copy. These come primarily from the content collection.
- **Strategic atoms** (topic = `persona`, `tone_descriptor`, `mission_statement`, `x_factor`, `voice_rule`, `denominational_signal`, `strategic_priority`, `page_primacy_mapping`, `anti_model`): structured units that inform downstream generation. These come primarily from the strategy brief, brand guide, and discovery.

Same table, same shape, different consumers. The page drafter reads content atoms. The voice card synthesizer reads strategic atoms. The sitemap generator reads both. Topic filtering on read is the discriminator.

---

## The chain at a glance

```
                                              ┌── pipeline_jobs queue (Supabase)
                                              │   trigger advances dependents
                                              ▼
  Intake hard stops cleared
        │
        ▼
  1. normalize_intake                          (no gate — reviewer only)
        │
        ▼
  2. synthesize_voice_card → review_voice_card ┤ GATE 1: Voice Card
        │                                      │ Human approves the voice profile
        ▼
  3. generate_content_map (groups + density + natural pages + consolidation candidates)
        │                                          │ No gate — input to sitemap
        ▼
  4. generate_sitemap → review_sitemap            ┤ GATE 2: Sitemap (final pages + nav + AEO/GEO)
        │                                          │ Human approves strategic structural decisions
        ▼
  4.5 generate_section_plan                        ┤ Section list per page (concept-tagged) + atom × page × role
        │                                          │ Outputs sections_by_page and the atom assignments
        ▼
  4.7 generate_content_strategy → review_strategy ┤ GATE 3: Section plan + Strategy doc (combined gate)
        │                                          │ Human approves section structure + partner-facing prose
        ▼
  5. generate_roadmap                          (lightweight — partner-facing summary, surface-only gate)
        │
        ▼
  6. draft_page (parallel per page) + review_page ┤ GATE 4: Phase 1 Review Queue
        │                                          │ Human triages green/yellow/red bands
        ▼
  7. gate_partner_publish                      ┤ GATE 5: Partner Publish
                                               │ Human signs off, only then does it leave the org
```

Five gates total. Everything else is automatic.

---

## Source-of-truth tables

These are the rows the pipeline reads and writes. Schema in `v35_pipeline_foundation.sql`.

| Table | What it holds | Written by | Read by |
|---|---|---|---|
| `web_intake_documents` | Uploaded intake files (ContentSnare, Strategy Brief PDFs, supplemental) | Intake UI | normalize_intake |
| `strategy_account_progress` | AM handoff + account metadata | AM tools (existing) | normalize_intake |
| `strategy_discovery_questionnaire` | Fillout discovery submission | Discovery webhook (existing) | normalize_intake |
| `strategy_brand_guides` | Brand handoff (when stored in Supabase) | Brand Squad tool (existing) | normalize_intake |
| `church_facts` | Structured multi-valued facts (services, ministries, staff, beliefs, programs) | normalize_intake | synthesize_voice_card, generate_sitemap, generate_content_map, draft_page, review_page |
| `content_atoms` | Prose-shaped units composed from facts (kids-checkin paragraph, beliefs statement, etc.) | normalize_intake | generate_sitemap, generate_content_map, draft_page, review_page |
| `church_voice_cards` | Synthesized voice profile (tone, banned terms, branded vocab, personas, syntax rules) | synthesize_voice_card | every downstream LLM step |
| `web_pages` | Per-page row (slug, name, phase, content_status, primary_persona, keywords, brief, reviewer_band) | generate_sitemap, generate_content_strategy, draft_page, review_page | every downstream step |
| `web_sections` | Per-section row with field_values (the actual copy, keyed by Brixies slot) | draft_page | review_page, the editor UI |
| `content_page_map` | atom × page × role (canonical / reference / cta / context) | generate_content_map | draft_page, review_page |
| `strategy_web_projects` | Project root (current_voice_card_id, pipeline_current_job_id, nav_items, roadmap_*, etc.) | every step that updates project state | every step |
| `prompt_versions` | Versioned agent prompts (one active per agent) | manual / migration | every LLM-running step |
| `pipeline_jobs` | The queue + state machine | every step + dispatcher | the dispatcher tick |
| `pipeline_feedback` | Human approvals / send-backs at gates | gate UI | trigger advances the referenced job |

---

## Pipeline steps — the per-step contract

For each step: trigger, reads, writes, on-success handoff, model + reviewer, gate (if any).

### Step 1 — `normalize_intake`

**Trigger.** Intake hard stops transition from incomplete to complete (computed from `web_intake_documents` + `strategy_discovery_questionnaire`). A Supabase trigger inserts a `pipeline_jobs` row with `step='normalize_intake'`. The dispatcher picks it up on the next tick.

**Reads.**
- `web_intake_documents` rows (ContentSnare JSON, Strategy Brief, Content Collection, supplemental files).
- `strategy_account_progress` (AM handoff JSONB).
- `strategy_discovery_questionnaire` (Fillout submission).
- Brand guide — **dual-source flexibility**. If `strategy_brand_guides` row exists for this member with `is_published=true`, use it. Otherwise, if `strategy_web_projects.external_brand_guide_url` points at a `live.standards.site/<brand>` URL, fetch it (the standards site exposes an AI-readable JSON endpoint with the token query param). Either source is accepted. Future state migrates everything to Supabase; this step doesn't assume that's done.
- SEO report file (if uploaded) — keyword ranking data.

**Lifts from each source. This is the load-bearing step for the entire pipeline's lift-before-generate posture.**

*From the strategy brief (the highest-leverage source):*
- Each persona → one `content_atoms` row with `topic='persona'`, body = the persona's prose description, metadata = structured fields (label, needs, scares_off, voice_resonance, entry_pages, critical_conversion_page, attributes). `verbatim=true`.
- Brand voice tone descriptors → one atom per descriptor with `topic='tone_descriptor'`, OR one atom with `topic='tone_block'` carrying the whole tone description if the brief presents it as prose.
- Mission statement (canonical short form) → atom with `topic='mission_statement'`, `verbatim=true`.
- Vision statement → atom with `topic='vision_statement'`, `verbatim=true`.
- X-factor / differentiator → atom with `topic='x_factor'`, `verbatim=true`.
- Denominational positioning → atom with `topic='denominational_signal'`.
- Strategic priorities / goals → atoms with `topic='strategic_priority'`.
- Page-persona primacy mapping (if present) → atom with `topic='page_primacy_mapping'`, structured metadata.
- Recommended page list (if present) → atom with `topic='recommended_page'`.
- Voice rules / writing guidance specific to this brand → atoms with `topic='voice_rule'`.

*From the brand guide:*
- Vocabulary do's / preferred terms → atoms with `topic='branded_term'`, `verbatim=true`, metadata = {use_not_x note}.
- Vocabulary don'ts → atoms with `topic='banned_term'`.
- Grammar / mechanics rules → atoms with `topic='voice_rule'`.
- Theological capitalization rules → atom with `topic='theological_capitalization'`.

*From the discovery questionnaire:*
- Anti-models (organizations to avoid looking like) → atoms with `topic='anti_model'`.
- Topics/words/values to avoid → atoms with `topic='banned_term'`.
- Stated website goals → atoms with `topic='website_goal'`.
- Example websites liked → atoms with `topic='design_reference'`.

*From the content collection (ContentSnare):*
- Structured table fields (Staff & Board, Sermon Archive, ministry partners, volunteer opportunities) → `church_facts` rows with appropriate topics.
- Repeater fields (service times, taglines, ministries) → `church_facts` rows.
- WYSIWYG / textarea fields (mission, vision, why-give, why-volunteer, ministry descriptions) → `content_atoms` rows with the prose body, `verbatim=true` for partner-authored prose.

*From the AM handoff:*
- Timeline / deadlines → `church_facts` with `topic='deadline'`.
- Special partner preferences → atoms with `topic='am_note'`.

*From the SEO report:*
- Current ranking keywords → atoms with `topic='current_keyword'`.

**Writes.**
- `church_facts` rows — typed, multi-valued facts. Topics now include both content-collection-sourced (service_time, campus, ministry, staff, belief, program, milestone, testimonial, audience, location_detail, contact_method, partnership, deadline) AND strategy-brief-sourced (branded_term flagged via metadata).
- `content_atoms` rows — both content atoms (renderable prose) AND strategic atoms (lifted from strategy brief / brand guide / discovery for downstream generation steps). Topic value distinguishes which consumer reads them.
- `strategy_web_projects` global merge field columns (church_name, address, phone, etc.) — only writes if currently null or empty; never overwrites existing values.

**Net-new generation in this step.** None. This step extracts and structures; it does not synthesize. The only LLM use is light Haiku assist for splitting prose into atoms where the source is unstructured (e.g., a ContentSnare wysiwyg field that contains four implicit paragraphs that should become four atoms).

**On success.** Enqueues `synthesize_voice_card`. Updates `strategy_web_projects.roadmap_stage = 'extracting_strategy'`.

**Model + reviewer.** Mostly deterministic. Optional Haiku assist for prose decomposition. A reviewer pass is added: it checks that *every authored field* in the strategy brief landed as an atom. The check is structural — for each expected brief section (personas, mission, tone, x-factor), does at least one corresponding atom exist? If not, the brief either lacks that section or the extractor missed it; either way, surface as a verdict flag.

**Gate.** None. The next step depends on facts/atoms being present, not on a human signoff. But the extraction-coverage reviewer flag surfaces in the project view so the human knows if anything in the brief was missed.

---

### Step 2 — `synthesize_voice_card`

**Trigger.** Completion of `normalize_intake`.

**Reads.**
- `content_atoms` filtered to strategic topics: `persona`, `tone_descriptor`, `tone_block`, `mission_statement`, `vision_statement`, `x_factor`, `denominational_signal`, `voice_rule`, `theological_capitalization`, `branded_term`, `banned_term`, `anti_model`, `website_goal`, `strategic_priority`.
- `church_facts` (denomination, branded terms, supporting context).
- Optional fallback: raw discovery JSON if expected strategic atoms are absent.

**Lifts from strategic atoms. This step is now overwhelmingly LIFT, not SYNTHESIS.**

- Personas → atoms with `topic='persona'` map directly into `persona_snapshots[]`. Lift body + metadata verbatim. Do NOT add detail beyond what each atom contains.
- Tone descriptors → atoms with `topic='tone_descriptor'` map into `tone_descriptors[]`. If only a `topic='tone_block'` atom exists (prose form), parse out the descriptors from the prose.
- Mission statement → atom with `topic='mission_statement'` body becomes the `mission_statement` field verbatim.
- X-factor → atom with `topic='x_factor'` body becomes the `x_factor` field verbatim.
- Denominational filter → atom with `topic='denominational_signal'` maps to the canonical filter name.
- Banned terms → global cliché list (always) + atoms with `topic='banned_term'`.
- Branded vocabulary → atoms with `topic='branded_term'` map verbatim into the object.
- Syntax rules → global rules (defaults from `references/web-writing-rules.md`) + atoms with `topic='voice_rule'` and `topic='theological_capitalization'` overlay as overrides.
- Anti-models → atoms with `topic='anti_model'`.
- Example phrases good → atoms with `verbatim=true` and voice-tagged.

**Net-new generation in this step.** Only the assembly of these lifted pieces into the JSON shape. The model doesn't compose voice; it normalizes already-composed voice into a queryable structure. When an expected atom is genuinely absent (e.g., the strategy brief didn't include personas), the field is left empty with a `_unfilled_with_reason` entry. The synthesizer does NOT fall through to discovery raw fields unless explicitly instructed to.

**Writes.** One `church_voice_cards` row with structured columns AND full `payload` jsonb:

```json
{
  "tone_descriptors": ["warm", "shepherding", "understated", "multigenerational"],
  "banned_terms": ["delve", "tapestry", "elevate", "RCC", "Riverwood Community Chapel"],
  "branded_vocabulary": {
    "Foyer": "not lobby/atrium",
    "Worship Center": "not sanctuary/auditorium",
    "Kids Wing": "west end of building"
  },
  "denominational_filter": "non-denominational-evangelical",
  "mission_statement": "To know Jesus, to be known, and to make Him known.",
  "x_factor": "A big church that feels small.",
  "syntax_rules": {
    "no_em_dash": true,
    "no_triads": true,
    "you_your": true,
    "oxford_comma": true,
    "no_we_our_in_body_copy": true
  },
  "persona_snapshots": [
    {
      "label": "The Suburban Family",
      "grounded_in": "discovery.who_actively_trying_to_engage",
      "attributes": "Parents of children newborn through high school. Kent / Portage County suburbs.",
      "needs": ["Kids Wing reads safe/organized", "Pre-registration easy", "Multigenerational community"],
      "scares_off": ["Mega-church vibes", "Disorganized kids ministry", "Theological vagueness"],
      "voice_resonance": "Practical and specific. Warm without saccharine.",
      "entry_pages": ["/visit", "/kids"],
      "critical_conversion_page": "/kids"
    }
  ],
  "example_phrases_good": ["Know Jesus", "Be Known", "Make Him Known", "warm and welcoming without being flashy"],
  "example_phrases_bad": ["come as you are", "life-changing", "vibrant community", "spiritual journey"]
}
```

Sets `strategy_web_projects.current_voice_card_id` to the new row.

**On success.** Enqueues `review_voice_card`.

**Model + reviewer.** Haiku is now appropriate (it was Sonnet in v1 of this doc, downgraded because the work is normalization, not synthesis). Reviewer agent (Haiku, paired model) runs as `review_voice_card` job — checks: did the synthesizer LIFT correctly (every strategic atom that exists got reflected; no atom was paraphrased or augmented)? Did it INVENT detail beyond what an atom contained? Are personas labeled descriptively (not fabricated names)? Writes verdict to `pipeline_jobs.reviewer_verdict` and `confidence_band`.

**Gate 1 — Voice Card.** After reviewer, job flips to `awaiting_gate`. Notification fires to ClickUp. Human opens the Voice Card view in Content Manager, reads the structured profile + reviewer verdict, clicks Approve / Approve with edits / Send back. On approve, dependents advance.

---

### Step 3 — `generate_sitemap`

(`generate_content_strategy` moved downstream — see step 4.5 below. The structural decisions in this step are too high-stakes to share LLM attention with partner-facing prose writing. Splitting keeps focus on nav + AEO/GEO.)

**Trigger.** Voice Card gate approved.

**Reads.**
- `church_facts` (all topics — sitemap needs to know what pages the facts support).
- `content_atoms` (both content atoms and strategic atoms).
- `church_voice_cards` (current).
- Optional: site crawl output (if Phase 2 crawl is wired). For v1, partner-provided current-site URL audit is acceptable.
- `web_content_templates` registry — sitemap needs to know what Brixies families exist so it doesn't propose pages with no template support.

**Lifts from strategic atoms.**

- Recommended page list → atoms with `topic='recommended_page'`. If present, these are the proposed Phase 1 page set; the generator starts from this list and validates against caps + mandatory-set, only adding pages when the brief's list is incomplete.
- Page-persona primacy mapping → atom with `topic='page_primacy_mapping'`. Lift directly into each `web_pages.primary_persona` and `secondary_personas` field. Do NOT re-derive persona assignments when the brief specified them.
- Strategic priorities → atoms with `topic='strategic_priority'` inform page phasing decisions (priority work goes Phase 1).
- Website goals → atoms with `topic='website_goal'` shape the content strategy doc's executive summary.
- Mission alignment for the strategy doc → atom with `topic='mission_statement'` provides the anchor sentence.

**Net-new generation in this step.**

- Nav structure (when the brief doesn't pre-specify it).
- Phasing decisions for pages the brief didn't pre-phase.
- AEO/GEO keyword targets per page (generated against the keywords in `current_keyword` atoms + church location/denomination).
- The content strategy doc's connective tissue (the rationale paragraphs that explain why pages were grouped a certain way).
- The page-by-page outline summaries.

**Writes.**
- `web_pages` rows — one per proposed page. Sets `slug`, `name`, `phase` (1 / 2 / nav-only), `primary_persona`, `secondary_personas`, `keywords` (AEO/GEO), `sort_order`.
- `web_sections` rows — one per proposed section per page. Each section gets `sort_order`, `concept_id` (a curated_concepts id from the Brixies library), and an intent summary in `notes`. The section's `template_id` (the specific Brixies variant) is left null at this stage — that's the `bind_section_templates` step's job.
- `strategy_web_projects.nav_items` (jsonb) — the primary nav structure.

This step does NOT write `strategy_web_projects.roadmap_state.stage_2`. The partner-facing strategy document is written by `generate_content_strategy` (step 4.5) after the content map locks.

**Concept tagging.** Sitemap reads `cowork-skills/brixies-library.json` → `curated_concepts[]` (34 entries). For each section it proposes on a page, it picks the concept that best matches the section's intent. The library entry carries `family_filter[]`, `kind_filter[]`, `max_picks` per project, and an `includes[]` list of typical elements. Sitemap enforces `max_picks` (e.g., only one `hero_homepage` per project) and uses `includes[]` to validate that the concept can carry the content the section needs.

**On success.** Enqueues `review_sitemap`.

**Model + reviewer.** Sonnet, multi-turn (10-15 turns). Hard constraints in the prompt: 6-page Phase 1 cap (7 with bilingual override), mandatory Phase 1 set (Homepage, Plan a Visit, Sermons/Watch, Give, plus two strategic), 6 primary nav items, 20-page combined cap. Reviewer agent verifies rule compliance + checks that every proposed page has supporting atoms (no page proposed with zero canonical atoms) AND that the brief's `recommended_page` / `page_primacy_mapping` atoms were honored when present + that every section's `concept_id` resolves to a real entry in the curated library AND that `max_picks` per concept isn't exceeded.

**Gate 2 — Sitemap + Strategy.** Combined gate. Human reviews proposed pages, nav, phasing, and the strategy doc as one unit. Approve / send back routes the same way.

---

### Step 4 — `generate_content_map`

**Trigger.** Sitemap + Strategy gate approved.

**Reads.**
- `web_pages` (the locked sitemap).
- `content_atoms` filtered to content atoms (renderable prose; strategic atoms aren't mapped to pages).
- `church_voice_cards`.

**Lifts from atoms / earlier outputs.**

- Each content atom's `default_canonical_page_slug` (if set during normalize_intake) is the starting assignment for `role='canonical'`. The mapper accepts this default unless it conflicts with sitemap structure.
- Each content atom's `cross_reference_hints[]` (if set) seed `role='reference'` rows for those pages.
- The sitemap's `web_pages.primary_persona` determines persona-relevant atom prioritization per page.
- If the strategy brief contained `page_primacy_mapping` atoms, those constraints carry through here (an atom flagged as "canonical on /kids" in the brief is canonical on /kids in the map).

**Net-new generation in this step.** The full atom × page × role × treatment matrix where atoms don't have pre-set hints. Treatment notes ("service-time line + link only, not full age-range breakdown") are generated against page space + persona context.

**Writes.** `content_page_map` rows — atom × page × role + treatment. Roles:

- `canonical` — atom's main home. Full detail.
- `reference` — brief mention + link to canonical.
- `cta` — surface as button/callout pointing to canonical.
- `context` — informs framing but doesn't render as a section.

Absent rows = atom omitted from that page.

**On success.** Enqueues `review_content_map`.

**Model + reviewer.** Sonnet, multi-turn. Reviewer agent checks: every atom assigned at least one canonical home? Every page has at least one canonical atom? No orphan atoms? Page persona primacy matches sitemap output? Brief-sourced `page_primacy_mapping` constraints honored?

**Gate 3 — Content Map.** Human opens the matrix view (atoms down, pages across, role per cell with treatment notes). Click any cell to override. Approve when satisfied.

---

### Step 4.5 — `generate_content_strategy`

**Trigger.** Content Map gate approved.

**Reads.**
- The locked sitemap output (`web_pages` + `web_sections` + nav structure).
- The locked content map (`content_page_map` rows — atom × page × role).
- `church_voice_cards` (current voice profile for prose register).
- `church_facts` and `content_atoms` for grounding specific claims in the prose.

**Lifts from upstream.** This step is overwhelmingly LIFT-driven.

- Pages, nav structure, AEO/GEO keywords, persona primacy — all from the sitemap output. The doc PRESENTS these decisions to the partner; it doesn't re-make them.
- Content distribution (which atoms are canonical / reference / cta on which pages) — from the content map. Informs the page-by-page section of the doc.
- Mission, x_factor, voice tone — from the voice card. The doc's prose register matches.

**Net-new generation.** The connective prose that ties the structural decisions into a partner-readable narrative:

- **Executive Summary** — 2-3 paragraphs synthesizing the navigation philosophy, what the partner will experience, why these specific Phase 1 picks. Names Jesus explicitly per references/web-writing-rules.md StoryBrand frame.
- **Navigation Architecture** — the proposed primary nav + dropdowns + footer in plain language. For every structural decision that differs from the current site (when crawled), one sentence of rationale.
- **AEO/GEO Search Strategy** — partner-facing explanation of how the site is built to be found. Aggregates per-page keyword lists into the strategic narrative. Three things to cover: voice search / AI overviews, local search support, specific keyword targets for this church (primary + secondary + long-tail).
- **Phase Summary** — clean two-column table of Phase 1 vs Phase 2 pages, with one-line rationale for any consolidation or phasing call that might surprise the partner.

**Writes.** `strategy_web_projects.roadmap_state.stage_2` (jsonb with the four sections above). This is the partner-facing rationale doc; project-level jsonb because it's a single artifact per project.

**On success.** Enqueues `generate_roadmap` (step 5).

**Model + reviewer.** Sonnet 4.6. The writing is partner-facing prose with specific quality bars (You/Your language, no em-dashes, no triad lists, no banned AI words, Jesus named explicitly, friendly-expert tone). Reviewer agent checks the writing rules + that every page in the sitemap is named in the doc + that the doc doesn't contradict the locked structural decisions.

**Gate 3.5 — Content Strategy Doc.** After reviewer, job flips to `awaiting_gate`. The doc is partner-facing so the human's review is "would I be comfortable sending this to the partner?" Approve / Approve with edits / Send back. May get consolidated into Gate 3 (combined Content Map + Strategy Doc review) for operational simplicity — the doc's content is fully derived from the locked sitemap+content map, so reviewing them together may be more efficient than two separate gates.

**Why this is its own step.** The structural decisions in step 3 (`generate_sitemap`) are too high-stakes to share LLM attention with partner-facing prose writing. Splitting them lets the sitemap step focus entirely on getting nav and AEO/GEO right, and lets this step focus entirely on writing partner-readable prose that lifts from already-locked structural decisions. Practical effect: better nav, better keywords, better prose, all in cleaner-scoped passes.

---

### Step 5 — `generate_roadmap`

**Trigger.** Content Map gate approved.

**Reads.** `strategy_web_projects` (church name, primary contact, key dates), `church_voice_cards`, `content_atoms` (strategic atoms — primary goals, tone, x_factor, target audience, brand style tags), `web_pages` (phase summary for milestone overview).

**Lifts from strategic atoms.** This step is almost entirely a LIFT.

- Primary goals → atoms with `topic='website_goal'` or `topic='strategic_priority'` map to `roadmap_properties.primary_goals`.
- Tone characteristics → `church_voice_cards.tone_descriptors` map to `roadmap_properties.tone_characteristics`.
- Target audience → `church_voice_cards.persona_snapshots[].label` join into `roadmap_properties.target_audience`.
- Brand style tags → atoms with `topic='brand_style_tag'` if present, else derived from `church_voice_cards.tone_descriptors`.
- X-factor / top attribute → `church_voice_cards.x_factor` becomes `roadmap_properties.x_factor`.
- Engagement type → atom with `topic='engagement_type'` if present, else inferred from project kind on `strategy_web_projects`.

**Net-new generation in this step.** Only the opening paragraph that addresses the partner by name and synthesizes the lifted properties into a partner-facing greeting. The milestone overview is template-driven (the same five-milestone structure for every redesign project), populated with the project's specific page list.

**Writes.** `strategy_web_projects.roadmap_opening_paragraph` + `roadmap_properties` + `roadmap_milestone_overview` + `roadmap_internal_flags`. This is the lean partner-facing roadmap (the simplified version from the user's spec, not the over-engineered prior form).

**On success.** Enqueues `draft_page` for each Phase 1 page.

**Model + reviewer.** Haiku (lightweight synthesis). No formal reviewer pass — the roadmap is so constrained that voice card + facts produces a reliably correct output. Gate is implicit: humans see the roadmap in the Roadmap tab and can edit before Partner Publish.

---

### Step 5.5 — `bind_section_templates` (per page, parallel)

**Trigger.** Roadmap completion. Bind jobs fan out — one per page — before draft jobs.

**Reads.**
- The page's `web_sections` rows (concept-tagged from `generate_sitemap`).
- For each section's `concept_id`, the curated library entry (`family_filter[]`, `kind_filter[]`, `includes[]`, `default_template_id` if set).
- The full `templates[]` slice whose `family` is in the section's `family_filter`. This is the candidate pool the binder picks from.
- The project's curated library overrides — any site-specific picks the web designer made in the Global Elements workspace.
- The page's `content_page_map` slice — what atoms are canonical/reference/cta on this page. Informs structural fit.
- `strategy_web_projects.card_palette[]` — the project's chosen Card variants for palette groups.

**Lifts from project decisions.**
- If `default_template_id` is set on the concept or on the curated library override, the binder uses that template unless there's a structural reason to override.
- Card palette is lifted from `strategy_web_projects.card_palette` — selected by the web designer in the Global Elements workspace BEFORE the pipeline runs. The binder does not pick card variants; it uses what's already chosen.

**Net-new in this step.** Template selection per section. Specifically, picking which variant within the concept's `family_filter` best fits the section's content shape and quantity.

**Structural fit, not slot fit.** The binder's job is to match template STRUCTURE to content STRUCTURE — not to find the template with the most matching slots. Critical principle:

- **Card grids** must use a template whose `default_count` (and palette group capacity) accommodates the number of card atoms the content map assigned. Six ministry atoms canonical-on-this-page → bind a card grid template with default_count ≥ 6 or paged carousel behavior.
- **Tabbed sections** require content that naturally splits into discrete tabs (4 ministry phases, 3 service times by campus, etc.). Don't bind a `feature_tabbed` template when the content is monolithic prose.
- **Image-left/text-right** layouts require actual imagery to land alongside the text. Without confirmed image atoms, prefer a plain `content_section` variant.
- **Process sections** require ordered steps (1, 2, 3). Without a clear sequence in the content, prefer a card grid.

These are validation rules the binder applies. The reviewer agent double-checks.

**Reuses existing infrastructure.** This step wraps `api/web/agents/auto-bind-page.ts` (already implemented). The endpoint receives the section list + candidate templates + content context and returns `{section_id → template_id}` mappings. For v1 (Cowork) the binder skill replicates the same logic inline.

**Writes.**
- `web_sections.template_id` — the bound Brixies template id per section.
- `web_sections.notes` — optional rationale from the binder for the picked template.

**Programmatic validation (no LLM).** Before each write, assert: `template.family ∈ concept.family_filter`. If not, reject the binding and retry. This catches obvious misroutes (CTA concept getting a Blog Section template) deterministically.

**On success.** Enqueues `draft_page` for the same page.

**Model + reviewer.** Haiku 4.5 (binding is routing, not creative). Paired reviewer agent checks: every section has a `template_id`; each `template.family` validates against the concept's `family_filter`; structural fit looks reasonable for the content (card count, tab content split, image presence).

**No human gate at bind.** Binding mistakes are caught by the programmatic check or surfaced as yellow/red flags at the Phase 1 Review Queue gate downstream. Adding a gate here would create review friction for every page; not worth the cost.

---

### Step 6 — `draft_page` (per page, parallel) + `review_page` (per page)

**Trigger.** `bind_section_templates` complete for the page. Phase 1 pages fan out in parallel — one `draft_page` job per Phase 1 page, each runs independently.

**Reads (per page).**
- That page's row from `web_pages` (slug, name, persona, keywords).
- `content_page_map` rows where `web_page_id = this page` — the atom slice for this page with roles + treatments.
- The atoms themselves (joined from `content_atoms`).
- `church_voice_cards` (current).
- Bound `web_content_templates` for each section on this page — the Brixies field schema (slot list with `max_chars`, `required`, `heading_level`, `source`).
- The page's existing `web_sections` rows + `field_values` (in case of regeneration with correction hints).

**Lifts from atoms.** This step combines lifting with generation more than any prior step.

- Atom bodies tagged `verbatim=true` MUST appear in the copy exactly as in the atom — no paraphrase, no truncation. The drafter wraps them in section structure but never edits the verbatim text itself.
- Atom `handling_notes` (e.g., "first names only — security-sensitive") are passed through to the drafter and honored without restating.
- `church_voice_cards.example_phrases_good` are eligible for the drafter to deploy verbatim where they fit.
- `church_voice_cards.branded_vocabulary` is enforced — the drafter must use "Foyer" not "lobby" when those terms apply.
- The persona's `voice_resonance` sample from the voice card is lifted into the drafter's persona-context block as a register reference.

**Don't shoehorn — fit content to structure, not the reverse.** This is a load-bearing principle for the drafter.

Brixies templates carry many slots. Not all of them must be filled. The drafter writes only the slots that have authentic content to back them; optional slots without content stay empty and the renderer shows the placeholder (or skips the slot gracefully). The drafter does NOT invent a tagline to fill a tagline slot, manufacture a fifth card to pad a six-card grid, or compose a CTA for an optional button slot when no atom supports it.

Concrete rules:

- **`required: true` slots must be filled.** These are structural requirements (the section breaks without them — typically the heading). The drafter must produce content for every required slot, even if that means lifting atom body_short, summarizing a longer atom, or using the page's persona-resonance line.
- **Optional slots are content-driven.** The drafter fills them only when an atom or content_page_map row provides the substance. Optional taglines, secondary headings, extra paragraphs, additional CTAs, image alt text — all of these stay empty by default.
- **Groups can be partially filled.** If a card group's `default_count` is 6 and the page's content map provides only 4 card-worthy atoms, the drafter writes 4 items. It does NOT manufacture 2 filler cards to reach 6.
- **Image slots stay empty.** The drafter does not generate image URLs or alt text. The web designer fills imagery downstream.
- **CTA targets come from content_page_map.** A button slot gets filled when a `role='cta'` row in the content map names a target. Otherwise the slot is empty.

Empty optional slots are not failures. The reviewer agent does NOT flag missing optional content. It DOES flag missing required content.

**Net-new generation in this step.**

- Field-keyed JSON copy that fits the Brixies template's slot constraints (char limits, required slots, heading levels) — for slots that have content.
- Connective tissue between lifted atom content — section headings, transitions, button labels.
- CTAs targeting the right pages per `role='cta'` rows in the content map.

**Writes.**
- `web_sections.field_values` jsonb — copy keyed by Brixies slot name, validated against the schema's char limits and required slots before write.
- `web_pages.ai_drafted_at`, `ai_drafted_by_stage = 'draft_page'`, `edited_since_ai = false`.
- `web_pages.brief` jsonb — denormalized cache of "what the writer saw" (the assembled prompt context). For provenance and debugging only; not the source of truth for anything.

**Reviewer pass — `review_page`.** Haiku, runs per page after draft completes. Checks:

- Source integrity: every fact-bearing claim traces to a row in `content_atoms` or `church_facts` for this project.
- Constraint compliance: char limits, banned terms, syntax rules from voice card.
- Voice match: tone descriptors, branded vocab present where expected.
- Verbatim preserve list honored.
- Missing entities: any content_page_map atom with role=canonical that didn't make it into the draft.
- Required slot coverage: every section's `required: true` slots have content. (Optional slots with no content are NOT flagged — that's the don't-shoehorn principle in action.)
- Concept-template alignment: for each section, `template.family ∈ concept.family_filter`. This is also checked programmatically at bind time, but the reviewer surfaces any drift that slipped through.
- Structural fit: the drafted content makes sense in the bound template's shape (e.g., a card grid section has at least 2 cards drafted; a tabbed section has tabs that actually represent distinct content; a process section has ordered steps).

Writes structured verdict + sets `web_pages.reviewer_band` to green / yellow / red.

**On success.** When all Phase 1 page+review jobs are done, batch transition to `gate_phase1_pages` (`awaiting_gate`).

**Gate 4 — Phase 1 Review Queue.** Human opens the queue, sees pages sorted by band:
- **Green** = reviewer found no issues. Rubber-stamp approve, click through.
- **Yellow** = minor flags (edge-case char limit, weak source ground). Skim and confirm.
- **Red** = real problems (missing source, voice drift, suspected hallucination). Real review required.

Per-page approve / send-back-with-notes. Send-back inserts a new `draft_page` job with the human's notes as `input.correction_hint`.

---

### Step 7 — `gate_partner_publish`

**Trigger.** Phase 1 Review Queue gate approved.

**No worker.** This is a pure human gate. No AI work between approval and partner-facing publish.

**What happens at the gate.** Human reviews the rendered preview of the partner portal (the read-only partner-facing view of all approved pages). One final approve/cancel. On approve, the partner-portal token activates and the partner can see the work.

**This gate is irreducible.** No automation crosses this line. Every piece of work that reaches a partner has a named human approval behind it.

---

## Phase 2 / ongoing iteration

Phase 2 pages run on the same chain (steps 6 + gate_phase2_pages) when triggered manually or by sitemap conditional logic. Re-runs of any step are triggered by:

- Intake material change → re-run normalize_intake → cascade. The supersession pattern on `church_facts` and `content_atoms` means old rows aren't deleted; they're marked `superseded_at`, new rows are inserted, and downstream queries automatically pick up the new ones.
- Voice card edit → re-run downstream steps that consumed it. The orchestrator detects the edit and enqueues `regenerate_dependents` jobs.
- Page brief / atom edits → re-run `draft_page` for affected pages only.

---

## What humans see at each gate

**Voice Card gate.** A single page view of the synthesized voice card — structured columns rendered as labeled sections + reviewer verdict (confidence band + flagged concerns) + raw `payload` JSON visible behind a toggle. Three buttons: Approve, Approve with edits (opens a modal to edit columns inline before approval), Send back with notes (textarea, submitted as correction_hint for a new attempt).

**Sitemap + Strategy gate.** Sitemap tree view + nav structure + strategy doc rendered inline. Per-page edit affordances (rename, change phase, drop). Reviewer verdict panel. Same three buttons.

**Content Map gate.** A matrix view — atoms as rows (grouped by topic), pages as columns. Each cell shows the role (canonical / reference / cta / context / —). Click any cell to flip role or add treatment notes. Atoms with no canonical home are flagged at the top. Pages with no canonical atoms are flagged. Same three buttons.

**Phase 1 Review Queue.** List of Phase 1 pages with band-colored chips (green / yellow / red). Sort by band, by section type, or by reviewer score. Click a page → side-by-side view: rendered preview on the left, reviewer verdict + atom-coverage check on the right. Approve / send-back per page. Bulk approve all green available.

**Partner Publish gate.** Read-only preview of the partner portal as the partner will see it. One Approve button. One Cancel. No editing here — go back to the Phase 1 queue if you need to fix something.

---

## Notification side effects

Each `awaiting_gate` transition fires a notification to ClickUp (the team's primary channel — Slack is a future option). The notification carries:

- Project name + member number.
- Which gate is open.
- Reviewer verdict band + score.
- Number of items needing real review (red band count for Phase 1).
- Deep link to the gate page in the app.

No notification at automatic transitions. Notifications only at human-required gates.

---

## Brand guide handling (dual-source, today)

The brand guide is the only intake source with two possible homes during the migration:

1. **Supabase**: `strategy_brand_guides` row with `is_published=true`. Future state for all brands.
2. **External**: `live.standards.site/<brand>` with an AI-readable token endpoint. Some brands live here today and will migrate over.

`normalize_intake` and `synthesize_voice_card` both check Supabase first. If no published row, they fall back to `strategy_web_projects.external_brand_guide_url` and fetch the standards.site endpoint. The fetched content is cached on the brand_guide read for the duration of the pipeline run (so we don't re-fetch on every step).

Neither source is treated as "more authoritative" — whichever one is configured is the source for that project. This is intentionally flexible until the migration completes.

---

## What this contract explicitly does NOT include

A list of things that look like they should be in the pipeline but aren't, with the reason why:

- **A handcrafted content catalog markdown file.** Replaced by `content_atoms` + `content_page_map`. If needed for partner export, render on demand from the rows.
- **A handcrafted persona doc markdown file.** Replaced by `church_voice_cards.persona_snapshots`. Render on demand.
- **A handcrafted site audit markdown.** Replaced by the reviewer agent verdicts on each step's `pipeline_jobs` row. Render on demand if a human wants the doc form.
- **The strategist as a recurring step.** There is no strategist role in this pipeline. The reviewer agents + human gates replace the strategist's judgment-mid-stream work.
- **Page-by-page human-driven drafting.** The Phase 1 Review Queue is triage on already-drafted pages, not a draft session per page.
- **Section-by-section human-driven drafting.** Same reason. The drafter operates page-at-a-time as the atomic unit.
- **Manual prompt iteration during a run.** Prompts are versioned via `prompt_versions`. To iterate, you bump the active version, future runs use the new prompt. In-flight runs don't get a prompt swap.
- **Bulk regeneration across projects.** Future v2 capability. For v1, regeneration is per-project, triggered by intake change or a human at a gate.

---

## What this contract assumes from existing systems

- The Brixies catalog (`web_content_templates`) is populated and the families/schemas are stable. Pipeline reads but never modifies template rows.
- The intake hard-stop computation (in `src/lib/webIntake.ts`) is correct and continues to be the trigger for `normalize_intake`.
- ClickUp chat sending (`src/lib/clickup.ts`) is the notification channel; the worker that posts gate alerts uses it.
- Vercel AI Gateway is wired (`AI_GATEWAY_API_KEY` env). All LLM calls go through it.
- Vercel Background Functions can run up to 15 minutes per invocation on the current plan. Long steps (draft_page on a large page) must fit under that ceiling.

---

## v1 build sequence implied by this contract

1. `v35_pipeline_foundation.sql` — applied to Supabase. Schema is live.
2. `v36_pipeline_seed_prompts.sql` — initial `prompt_versions` row for each agent. Pipeline can't run any LLM step without an active version.
3. `src/lib/pipelineQueue.ts` — typed helpers for the orchestrator state transitions. Every worker uses these; nobody hand-writes Supabase calls for pipeline state.
4. `api/web/pipeline/tick.ts` — the dispatcher. pg_cron or Vercel cron hits it every minute. Pulls from `pipeline_jobs_ready`, marks `running`, fans out worker invocations.
5. First worker: `api/web/agents/synthesize-voice-card.ts`. Smallest creative step. Once it runs end-to-end with reviewer + gate, the pattern is established and every other agent is template work.
6. `api/web/pipeline/notify.ts` — the gate-alert poster (ClickUp first, Slack later).
7. Per-agent workers in order: `normalize-intake`, `review-voice-card`, `generate-sitemap`, `review-sitemap`, `generate-content-strategy`, `generate-content-map`, `review-content-map`, `generate-roadmap`, `draft-page`, `review-page`.
8. Gate UI components in `src/components/wm/gates/` — one per gate.

Schema patches that show up during build go in vNN migrations as needed. The contract above is the spec; the schema follows.

---

## How to amend this contract

If something in the chain doesn't work as described, this doc gets edited first, then the schema and code follow. The doc is the source of truth for the pipeline's shape, just like `church_voice_cards` is the source of truth for the voice profile.

When amending: keep the "what doesn't include" section honest — it's there to prevent the pipeline from accidentally absorbing the old document-shaped workflow's habits.
