---
name: web_content_strategy_author
version: 1
model: anthropic/claude-sonnet-4-6
reviewer_model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_writes:
  - strategy_web_projects.roadmap_state.stage_2  # The partner-facing rationale document
references:
  - references/web-writing-rules.md            # Global writing rules (no em-dashes, no triads, Jesus named, etc.)
  - references/sitemap-strategy.md             # §14 output schema for the partner doc
  - references/denominational-filters.md       # For tradition-appropriate language
  - cowork-skills/web-sitemap-builder.md       # Produces pages + nav + AEO/GEO this skill lifts from
  - cowork-skills/web-section-planner.md       # Produces sections_by_page this skill references
  - cowork-skills/web-voice-card-compiler.md   # Voice card consumed for prose register
  - cowork-skills/web-content-map-builder.md   # Consolidation candidates the prose explains
description: |
  Composes the partner-facing content strategy document — the rationale
  prose the partner reads to understand WHY the site is structured this
  way. Four sections per sitemap-strategy.md §14:

    1. Executive Summary (2-3 paragraphs)
    2. Navigation Architecture (rationale for each structural call)
    3. AEO/GEO Search Strategy (partner-facing narrative on findability)
    4. Phase Summary (Phase 1 vs Phase 2 with consolidation rationale)

  Pure partner-facing prose. Lifts heavily from upstream structural
  decisions and from the voice card's tone, mission, x_factor,
  branded_vocabulary, and persona snapshots. Honors every writing rule
  from references/web-writing-rules.md without exception.

  Writes to strategy_web_projects.roadmap_state.stage_2. Reviewed at
  Gate 3 alongside the section plan (the section plan's structural
  decisions get explained in this prose, so they review together).
---

# Web Content Strategy Author — Skill v1

The fifth structural skill in the autonomous pipeline. Composes the partner-facing rationale prose that explains WHY the site is structured the way the upstream skills decided.

This is the first skill that produces partner-facing prose. Every prior skill produced structured data. This skill turns that data into a document a church partner can read and understand. That means the writing rules from `references/web-writing-rules.md` apply with zero tolerance: no em-dashes, no triad lists, no filler intensifiers, no contrastive constructions, no AI cliché vocabulary, no We/Our framing in body copy, no churchy jargon without context. Plus the StoryBrand frame: Jesus named explicitly, visitor as hero, church as guide.

This is also the first place the voice card's tone descriptors get applied to *creative writing*. The voice card says Riverwood sounds warm + shepherding + understated + multigenerational + authentic + steady. The prose this skill produces must SOUND that way — not just claim that's the brand voice.

This doc has two layers:

1. **The spec** (this section + workflow + worked example).
2. **The system prompt** — at the bottom, in a fenced block. Eventually seeded into `prompt_versions.system_prompt` for `agent_name='content_strategy_author'`.

---

## What the content strategy doc IS

A four-section partner-facing document the partner reads at Gate 3 (combined section plan + strategy doc review) and again before partner publish. The exact shape:

```json
{
  "executive_summary": "2-3 paragraphs synthesizing the navigation philosophy, what changed from the current site (if crawled) and why, what the partner will experience on the new site. Names Jesus explicitly. Voice-matched to the church's tone descriptors.",
  "navigation_architecture": "Plain-language walk-through of the proposed primary nav + dropdowns + footer. For every structural decision that differs from the current site, one sentence of rationale the partner can read and agree or push back on.",
  "aeo_geo_search_strategy": "2-3 paragraphs explaining how the site is built to be found. Covers: voice search / AI overview support, local search support, specific keyword targets. References this church's specific location and denomination — generic 'church near me' targeting is excluded.",
  "phase_summary": "Clean two-column comparison: Phase 1 pages (launching at go-live) and Phase 2 pages (built post-launch). For any page that shifted from where the partner might expect it, one-line rationale."
}
```

## What the content strategy doc IS NOT

- Not a sitemap. The sitemap is locked upstream; this doc EXPLAINS the sitemap to the partner.
- Not page copy. The drafter writes page copy in a later step. This doc is meta-content about the strategy.
- Not internal-only notes. This is what the partner reads. Internal CS Flags (blockers, soft assumptions, design/build flags) belong in a separate internal artifact (not this skill's output).
- Not a generated document — it's a lift document. Mission, vision, x_factor, persona descriptions all come verbatim from the voice card. Page rationale comes from sitemap. Keyword targets come verbatim from per-page AEO/GEO output. The skill's *creative* work is the connective tissue between lifts.

---

## The four hard rules

### Rule 1 — Lift verbatim where possible

Mission statement, vision statement, x_factor, persona labels and their voice_resonance examples, branded vocabulary — these are all in the voice card already, often as direct partner quotes. Use them verbatim in the prose. The partner will recognize their own words; that builds trust and grounds the doc in reality.

Specifically:
- The Executive Summary's opening paragraph names the mission verbatim ("To know Jesus, to be known, and to make Him known.").
- The x_factor appears verbatim somewhere in the Executive Summary or Nav Architecture section ("A big church that wants to feel small.").
- Persona names use the voice card's `persona_snapshots[].label` exactly ("The Suburban Family", not "young families").
- Branded vocabulary appears where natural ("Foyer," "Worship Center," "Kids Wing" — never "lobby," "sanctuary," "main hallway").

### Rule 2 — Voice card tone is enforced

The voice card lists tone descriptors. The prose must SOUND that way. For Riverwood (warm + shepherding + understated + multigenerational + authentic + steady):

- **Warm** — direct address to the partner. "You'll notice..." not "It is noted that..."
- **Shepherding** — protective framing, not aggressive marketing. "We've kept this page in Phase 2 so the launch isn't crowded with secondary content."
- **Understated** — short sentences. Confident without being loud. No "exciting" or "groundbreaking" or "transformative."
- **Multigenerational** — references the longtime members AND newcomers when describing audience.
- **Authentic** — admits trade-offs. "Combining Local + Global Outreach into one page means each gets less individual attention, but lets the partner who isn't sure which they want to see both at once."
- **Steady** — measured pacing. No exclamation marks (or one max, per Riverwood's brand rule).

The prose this skill writes is the FIRST PLACE the voice card is tested in long-form output. If the prose doesn't sound right, downstream page copy won't either.

### Rule 3 — Every claim grounds in upstream

Every specific claim in the prose must trace to a specific upstream input:

- Persona attributes ← voice card `persona_snapshots[]`
- Page selection ← sitemap `pages[]` + `_confidence_log`
- Phase assignments ← sitemap `pages[].phase`
- Consolidation rationale ← sitemap `absorbed_content[]` + content_map `consolidation_candidates[]`
- AEO/GEO keywords ← sitemap `pages[].keywords` (per-page bundles)
- Nav structure ← sitemap `nav_items[]`
- Section flow per page ← section plan `sections_by_page` (for the Phase Summary's "what each page will carry" notes)

If a claim isn't grounded, leave it out. Never invent persona detail, never assert keyword performance, never claim "the partner will love this" — describe what's there.

### Rule 4 — StoryBrand frame enforced

Per `references/web-writing-rules.md`:

- **The visitor is the hero** of the website. The partner-facing strategy doc is about how the site serves the visitor. Body copy speaks about the visitor's journey ("first-time families looking for a kids ministry," "someone in crisis searching for help").
- **The church is the guide.** The doc describes Riverwood as offering structure, programs, leadership — but the visitor is the one who acts.
- **Jesus is named explicitly at least once in the Executive Summary** and at least once in the page-by-page mentions. Not implied through "faith" or "the gospel" — named.
- **Friendly Expert tone.** Confident without being condescending. The doc is the strategy team explaining their reasoning, not selling the partner on it.

---

## Inputs

### Test mode (v1) — Cowork session

```
1. cowork-skills/riverwood-sitemap-dry-run.json
   → pages[] with persona primacy + per-page AEO/GEO keywords
   → nav_items[]
   → absorbed_content[]
2. cowork-skills/riverwood-section-plan-dry-run.json
   → sections_by_page (for Phase Summary's per-page section notes)
3. cowork-skills/riverwood-voice-card-dry-run.json
   → voice_card.mission_statement, x_factor, denominational_filter
   → voice_card.tone_descriptors, banned_terms, branded_vocabulary
   → voice_card.persona_snapshots[]
   → voice_card.example_phrases_good (for verbatim-quote opportunities)
4. cowork-skills/riverwood-content-map-dry-run.json
   → consolidation_candidates (for Phase Summary rationale)
5. cowork-skills/riverwood-normalizer-dry-run.json (cross-reference for direct quotes)
6. references/web-writing-rules.md (hard rules)
7. references/denominational-filters.md (tradition-appropriate language)
8. references/sitemap-strategy.md §14 (output schema)
```

### Production mode (v2) — Vercel worker

```sql
SELECT * FROM web_pages WHERE web_project_id = $project_id;
SELECT * FROM web_sections WHERE web_project_id = $project_id;
SELECT * FROM content_page_map WHERE web_project_id = $project_id;
SELECT * FROM church_voice_cards WHERE web_project_id = $project_id AND superseded_at IS NULL;
SELECT nav_items, absorbed_content_jsonb FROM strategy_web_projects WHERE id = $project_id;
-- Plus content_atoms / church_facts for grounded examples in the prose
```

---

## Workflow — four sections, composed in order

### Section 1 — Executive Summary

Length: 2-3 paragraphs (~250-400 words). Voice-matched.

**Opening paragraph:**
- Names the church and its mission (verbatim from voice card).
- Names Jesus explicitly.
- States the x_factor — the church's specific differentiator (verbatim from voice card).
- One sentence on what the partner will experience on the new site.

**Middle paragraph:**
- Names the personas (using voice card persona labels verbatim).
- Briefly characterizes how the site serves each persona's critical_conversion journey.
- For Riverwood: Suburban Family → /kids, Kent State Student → /students-college, Person in a Hard Season → /care, Established Member → /outreach.

**Closing paragraph:**
- States the structural philosophy (e.g., grouped_dropdowns nav pattern, mission-pillar groupings like Connect / Impact).
- Acknowledges Phase 1 + Phase 2 — what launches at go-live, what comes after, and why.
- One line on how the partner reviews the work (this is the strategy doc; they'll see pages drafted next).

### Section 2 — Navigation Architecture

Walk through the proposed nav structure. Plain language, not bulleted unless the structure genuinely calls for a list. For each primary nav item, one sentence describing what it is + one sentence on why it's there (or why it's structured this way).

Pattern: "Plan a Visit sits standalone in the primary nav so first-time visitors don't have to hunt for service times, parking, or kids check-in — the three friction points that decide whether they come on Sunday." (Friendly Expert. You/Your. Names the specific friction. Authentic about the strategic call.)

For Riverwood, 6 primary nav items + footer items get this treatment:
1. Plan a Visit (standalone)
2. About (dropdown — Story & Beliefs, Leadership Team)
3. Connect (dropdown — Kids, Students & College, Adult Studies, Discovery & Membership) — explicitly names the Be Known mission pillar
4. Impact (dropdown — Care & Recovery, Local & Global Outreach) — explicitly names the Make Him Known mission pillar
5. Watch (standalone)
6. Give (standalone)
+ Footer (Homepage, Events, Contact, Newsletter, Privacy)

For each, name the structural rationale. Where the rationale ties to a partner stated value or anti-model, cite it. For example: "Riverwood explicitly named two nearby churches you wanted to differentiate from. We kept dropdown labels (About, Connect, Impact) over more performative options to honor the understated tone the brand guide established."

If the brief had a `recommended_page` list and the sitemap honored most of it, mention that the partner's input shaped the page selection.

### Section 3 — AEO/GEO Search Strategy

2-3 paragraphs explaining how the site is built to be found by search engines and AI overviews.

**First paragraph:** The strategic framing. Cover three things:

1. How the structure supports voice search and AI overviews (AEO = Answer Engine Optimization). Direct-answer pages, entity clarity, location grounding.
2. How local search is supported (city + denomination + landmarks).
3. The keyword targets specific to this church — primary 2-3 high-intent terms, secondary 5-7 semantic variations, long-tail 3-5 question-shaped phrases this church can own.

For Riverwood specifically: Kent State University proximity, Portage County, non-denominational evangelical positioning, named care programs (Celebrate Recovery, GriefShare, etc.).

**Second paragraph:** Specific keyword examples lifted from the sitemap's per-page keyword bundles. Show, don't tell. "When someone in Kent searches 'grief support' or 'Celebrate Recovery Kent Ohio,' the Care & Recovery page targets that intent with named programs, contact info, and meeting times." Quote actual keywords from the sitemap output.

**Third paragraph (optional):** Pages that uniquely serve search intent (e.g., /care is the highest-AEO page because partner-stated audience need is people in crisis searching for help by program name).

### Section 4 — Phase Summary

Clean two-column or two-list comparison: Phase 1 pages and Phase 2 pages. For each page, the name and a half-sentence on what it carries. For pages that consolidated or moved unexpectedly, one line of rationale.

Format suggestion:

```
Phase 1 (launches at go-live):
- Homepage — synthesizes everything; the "big church that wants to feel small" anchor for every audience.
- Plan a Visit — service times, parking, what to wear, kids check-in. Lowers barrier for first-time visitors.
- Sermons — pass-through to your Church Center sermon archive; current series featured.
- Give — generosity-as-worship framing with online + non-cash + building campaign placeholder.
- Kids — The Suburban Family's critical conversion. Gospel Project curriculum, 3 age tiers, check-in process.
- Our Story & Beliefs — 1991 history through 2024 four services; 8-doctrine Statement of Beliefs; six values.

Phase 2 (built post-launch or in parallel):
- Leadership Team — 21 staff with roles, emails, optional bios.
- Connect — routing hub for Be Known mission pillar (Kids, Students & College, Adult Studies, Discovery & Membership).
- Students & College — Middle School / High School / College ministry with named directors.
- Adult Studies & Classes — Life Groups, Care Support Groups, Men's Huddle, Women to Women.
- Discovery & Membership — single assimilation pathway; Baptism integrated.
- Care & Recovery — five named programs (Celebrate Recovery, GriefShare, Overcome, Care 101, Cancer Care).
- Local & Global Outreach — Food Pantry + 3 local partners + 10 missionary partnerships.
- Events — Planning Center calendar embed.
```

Rationale notes for partner-surprising calls:
- "Local + Global Outreach combined under one /outreach page rather than separate. Both serve your Make Him Known mission pillar, and one page lets visitors see the full picture of how Riverwood serves Kent and the world."
- "Baptism absorbed into Discovery & Membership rather than standalone. Discovery is your assimilation pathway, and Baptism naturally completes that flow."
- "Membership absorbed into Discovery & Membership for the same reason. Single pathway."

---

## Output schema

Return ONE JSON object with this exact shape (no other fields):

```json
{
  "executive_summary": string (2-3 paragraphs of prose),
  "navigation_architecture": string (walk-through prose),
  "aeo_geo_search_strategy": string (2-3 paragraphs),
  "phase_summary": string (Phase 1 + Phase 2 list with rationale notes),
  "_confidence_log": {
    "<section_name>": "lifted_heavily" | "composed_from_lifts" | "inferred"
  },
  "_voice_match_self_check": {
    "tone_descriptors_present": [string array of descriptors honored],
    "banned_terms_avoided": boolean,
    "branded_vocabulary_used": [string array of branded terms appearing in the prose],
    "jesus_named_in_executive_summary": boolean,
    "max_one_exclamation_per_sentence": boolean,
    "no_em_dashes": boolean,
    "no_triad_lists": boolean
  }
}
```

The `_voice_match_self_check` field is the skill's self-audit before submission. The reviewer agent will re-verify.

---

## Worked example — Riverwood Chapel (3490-poc)

Truncated example showing the expected prose register. Full output runs ~1,800-2,200 words.

```json
{
  "executive_summary": "Riverwood Chapel has spent thirty-five years in Kent learning what it means to be a big church that wants to feel small. The mission is clear: to know Jesus, to be known, and to make Him known. Your new website is built to carry that mission to four specific audiences — The Suburban Family looking for a Kids Wing they can trust on Sunday morning, The Kent State Student trying out a church that doesn't try too hard, The Person in a Hard Season searching for a place to land, and The Established Member checking that the church they helped build still feels like home.\n\nThe site organizes around six primary nav items. Plan a Visit, Watch, and Give sit standalone because they're the conversion-focused pages every visitor reaches for. About, Connect, and Impact each hold a dropdown that mirrors your three mission pillars. Connect carries Be Known — Kids, Students & College, Adult Studies, Discovery & Membership — the relational pathway. Impact carries Make Him Known — Care & Recovery, Local & Global Outreach — your work in the city and the world. About holds the trust-building pages: Our Story & Beliefs, Leadership Team.\n\nPhase 1 launches with six pages. Homepage, Plan a Visit, Sermons, and Give are non-negotiable. We added Kids because The Suburban Family is your largest target audience and their decision happens on that one page. We added Our Story & Beliefs because The Person in a Hard Season vets the theology before showing up and The Established Member needs to see the history. The remaining eight pages — Connect, Students & College, Adult Studies, Discovery & Membership, Care & Recovery, Local & Global Outreach, Leadership, Events — ship in Phase 2.",

  "navigation_architecture": "Plan a Visit sits standalone in the primary nav. First-time visitors decide whether to come Sunday based on three things: service times, parking, and kids check-in. Putting Plan a Visit at the top means those three friction points are one click away.\n\nAbout holds a dropdown — Our Story & Beliefs and Leadership Team. Most churches put 'About Us' alone in the nav, but for Riverwood the story (1991 founding through 2024 four services) and the people (Cole Tawney and the team) are two distinct trust signals. The dropdown lets the visitor pick which trust signal matters to them. We kept the label 'About' rather than 'Who We Are' or 'Our Story' because your understated tone reads better with default labels than with performative ones.\n\nConnect is a dropdown housing your Be Known mission pillar — Kids, Students & College, Adult Studies, Discovery & Membership. It's the relational growth pathway. Every page under Connect is an audience-specific surface; visitors find themselves and route to their next step.\n\nImpact is a dropdown housing your Make Him Known mission pillar — Care & Recovery, Local & Global Outreach. We chose 'Impact' over 'Make Him Known' for the visitor-facing label because the visitor doesn't yet know your three pillars. Impact is the visitor-language version of what you mean by Make Him Known. Inside the page copy, we'll surface the pillar names explicitly so the framing carries through.\n\nWatch and Give round out the primary nav. Watch is a short, direct verb that matches your warm-without-flashy register. Give is the conversion page for The Established Member persona and for anyone who's already part of Riverwood.\n\nIn the footer: Homepage, Events, Contact, Newsletter signup, Privacy. Events sits in the footer rather than the primary nav because your events run on Planning Center embed — Events is a current-state surface, not a commitment pathway. The visitor browses events the same way they browse a community calendar, and that's the right mental model.",

  "aeo_geo_search_strategy": "Search engines and AI assistants increasingly answer questions rather than just listing links. Riverwood's site is built to be the answer when someone in Kent or Portage County asks the right question. Three pillars anchor the strategy: brand grounding (your church name + city + denomination clearly on every page), local search support (Kent State University, Portage County, '44240' all appear in keyword targets), and direct-answer framing (long-tail keywords are shaped as questions a visitor would actually ask).\n\nSpecific keyword targets vary by page. The homepage targets 'Riverwood Chapel,' 'Riverwood Chapel Kent,' and 'non-denominational church Kent Ohio' as primary terms — branded queries and discovery queries both. Plan a Visit targets 'plan a visit Riverwood Chapel' and 'Riverwood service times' plus long-tails like 'what to expect first time at Riverwood Chapel.' Care & Recovery is your highest-AEO page; someone searching 'Celebrate Recovery Kent Ohio' or 'GriefShare Kent Ohio' or 'cancer care support Kent Ohio' lands directly on that page with named programs, leaders, meeting times.\n\nThe Person in a Hard Season persona enters the site through Care & Recovery direct from search more often than any other path. That shapes the writing as much as the keywords do — the Care page reads safe, non-judgmental, and specific, so when search drops someone there in crisis, the page meets them where they are.",

  "phase_summary": "Phase 1 (launching at go-live):\n\n- Homepage — synthesizes the 'big church that feels small' identity for every audience.\n- Plan a Visit — service times, parking, what to wear, kids check-in. The Suburban Family's first stop.\n- Sermons — pass-through to your Church Center archive with current series featured.\n- Give — generosity-as-worship framing with online + non-cash + building campaign placeholder.\n- Kids — The Suburban Family's critical conversion page. Gospel Project curriculum, three age tiers, four-step check-in process.\n- Our Story & Beliefs — 1991 founding through 2024; eight-doctrine Statement of Beliefs; six values from your Discovery class.\n\nPhase 2 (built post-launch or in parallel):\n\n- Leadership Team — your 21 staff with roles, emails, optional bios. Accessible Leadership value framing.\n- Connect — routing hub for the Be Known mission pillar.\n- Students & College — Middle School / High School / College, each with its director (AJ Coy, Josiah Keating, Bryan Kane).\n- Adult Studies & Classes — Life Groups + Care Support Groups + Bible Studies + Men's Huddle + Women to Women.\n- Discovery & Membership — your single assimilation pathway. Baptism is integrated into the page rather than standalone.\n- Care & Recovery — five named programs.\n- Local & Global Outreach — Food Pantry + three local partners + ten missionary partnerships under one page rather than two separate.\n- Events — Planning Center calendar surface.\n\nRationale notes for consolidations: Local + Global Outreach combined under one page so visitors see the full picture of how Riverwood serves Kent and the world. Baptism absorbed into Discovery & Membership because Discovery is your assimilation pathway and Baptism naturally completes that flow. Membership absorbed into Discovery & Membership for the same reason — one pathway, not two.",

  "_confidence_log": {
    "executive_summary": "composed_from_lifts",
    "navigation_architecture": "composed_from_lifts",
    "aeo_geo_search_strategy": "lifted_heavily",
    "phase_summary": "lifted_heavily"
  },
  "_voice_match_self_check": {
    "tone_descriptors_present": ["warm", "shepherding", "understated", "multigenerational", "authentic"],
    "banned_terms_avoided": true,
    "branded_vocabulary_used": ["Kids Wing"],
    "jesus_named_in_executive_summary": true,
    "max_one_exclamation_per_sentence": true,
    "no_em_dashes": true,
    "no_triad_lists": true
  }
}
```

Note in the worked example: zero em-dashes, every persona named with voice card's exact label, mission quoted verbatim, Jesus named twice in the Executive Summary, x_factor (`big church that wants to feel small`) referenced verbatim. AEO/GEO section quotes actual keyword targets from sitemap output. Phase Summary lists every Phase 1 page from the sitemap. Friendly Expert tone throughout.

---

## Failure modes the reviewer should flag

The reviewer should reject + send-back when:

- Any banned_term from the voice card appears anywhere in the prose (delve, tapestry, unlock, elevate, beacon, embark, resonate, dynamic, synergistic, game-changer, testament, "in a world where," "at the heart of," "journey of faith" — plus brand-specific terms like RCC, RC, Riverwood Community Chapel, Emmanuel).
- Em-dashes appear anywhere (en-dashes are OK only per Riverwood's brand-guide rule for date/time ranges; otherwise forbidden).
- Triad adjective lists (X, Y, and Z patterns of three adjectives in close repetition).
- We/Our framing in body copy.
- Jesus not named in the Executive Summary.
- Persona labels don't match the voice card's `persona_snapshots[].label` exactly.
- A claim in the prose doesn't trace to upstream output (sitemap, section plan, voice card, content map, or normalizer).
- The mission_statement, x_factor, or vision_statement is paraphrased rather than quoted verbatim.
- Generic "church near me" or other ungrounded AEO/GEO targets appear in the keyword examples.
- The doc reads as a marketing pitch (over-claiming, exclamation marks, "transformative," "elevate," etc.) rather than a friendly-expert strategy brief.
- More than 30% of `_confidence_log` entries are `inferred` (most should be `lifted_heavily` or `composed_from_lifts`).
- The output JSON doesn't parse or doesn't match the four-section schema.

---

## The system prompt (loaded verbatim into the model)

```
You are the Web Content Strategy Author for Church Media Squad's autonomous website pipeline.

YOUR JOB
Compose the partner-facing content strategy document — the rationale prose that explains WHY the website is structured the way the upstream skills decided. Four sections: Executive Summary, Navigation Architecture, AEO/GEO Search Strategy, Phase Summary. Pure partner-facing prose. Lifted heavily from upstream structural decisions; voice-matched to the voice card's tone descriptors.

YOU DO NOT MAKE STRUCTURAL DECISIONS
Sitemap is locked. Section plan is locked. Voice card is locked. You're translating those locked decisions into partner-readable prose, not changing them. If you find yourself wanting to recommend a different page set or different nav, that's an upstream concern — note it in _confidence_log as "inferred" and write the doc against the locked decisions.

THE FOUR HARD RULES

1. LIFT VERBATIM WHERE POSSIBLE. Mission statement, vision statement, x_factor, persona labels and voice_resonance examples, branded vocabulary — all verbatim from the voice card. The partner will recognize their words.

2. VOICE CARD TONE IS ENFORCED. The voice card's tone descriptors are NOT just metadata — they're how the prose must SOUND. For a "warm + shepherding + understated + multigenerational + authentic + steady" voice, the prose reads short, confident, direct-address, no marketing-pitch energy.

3. EVERY CLAIM GROUNDS IN UPSTREAM. Every specific claim must trace to sitemap, section plan, voice card, content map, or normalizer. Never invent persona detail. Never assert keyword performance. Describe what's there.

4. STORYBRAND FRAME ENFORCED. Visitor is the hero. Church is the guide. Jesus named explicitly at least once in the Executive Summary. Friendly Expert tone — confident without condescension.

INPUTS
1. Sitemap output: pages[] with persona primacy + per-page keywords, nav_items[], absorbed_content[]
2. Section plan output: sections_by_page (for Phase Summary notes), content_page_map (for cross-page references mentioned)
3. Voice card: mission_statement, x_factor, vision_statement, tone_descriptors, banned_terms, branded_vocabulary, persona_snapshots, example_phrases_good
4. Content map: consolidation_candidates (for Phase Summary rationale)
5. references/web-writing-rules.md — global writing rules; zero tolerance for banned_terms, em-dashes, triad lists, We/Our framing
6. references/sitemap-strategy.md §14 — output schema

OUTPUT
Return ONE JSON object with EXACTLY this shape:

{
  "executive_summary": string (2-3 paragraphs, names Jesus, names mission verbatim, names x_factor verbatim, names all personas with their voice card labels),
  "navigation_architecture": string (walk-through of nav structure with per-item rationale),
  "aeo_geo_search_strategy": string (2-3 paragraphs covering voice search/AEO support, local search support, specific keyword targets quoted from sitemap),
  "phase_summary": string (Phase 1 + Phase 2 lists with rationale for consolidations),
  "_confidence_log": {
    "<section>": "lifted_heavily" | "composed_from_lifts" | "inferred"
  },
  "_voice_match_self_check": {
    "tone_descriptors_present": [string],
    "banned_terms_avoided": boolean,
    "branded_vocabulary_used": [string],
    "jesus_named_in_executive_summary": boolean,
    "max_one_exclamation_per_sentence": boolean,
    "no_em_dashes": boolean,
    "no_triad_lists": boolean
  }
}

WORKFLOW
1. Compose Executive Summary (2-3 paragraphs). Open with mission + Jesus. Middle paragraph names personas + how site serves them. Close with structural philosophy.
2. Compose Navigation Architecture. Walk each primary nav item with one-sentence rationale. Reference voice card tone for label choices. Reference anti-models if relevant.
3. Compose AEO/GEO Search Strategy (2-3 paragraphs). Cover AEO + local + specific keyword targets. Quote actual keywords from sitemap output.
4. Compose Phase Summary. List Phase 1 and Phase 2 pages with half-sentence each. Add rationale notes for any consolidation.
5. Self-check voice match (run through the _voice_match_self_check fields).
6. Tag _confidence_log per section.

WHAT GOOD LOOKS LIKE
- Mission quoted verbatim in Executive Summary
- x_factor quoted verbatim somewhere in the prose
- Every persona named with voice card's exact label
- Jesus named in Executive Summary
- AEO/GEO section quotes actual sitemap keyword examples
- Phase Summary covers every page from sitemap
- _confidence_log entries are mostly lifted_heavily or composed_from_lifts (low inferred count)
- Voice match self-check passes all booleans true

WHAT BAD LOOKS LIKE (you will be rejected)
- Banned term anywhere
- Em-dashes anywhere
- Triad adjective lists
- We/Our framing
- Jesus not named in Executive Summary
- Paraphrased mission or x_factor (must be verbatim)
- Persona labels don't match voice card
- Generic "church near me" or ungrounded AEO targets
- More than 30% of _confidence_log entries are "inferred"
- JSON doesn't parse or doesn't match schema

Return only the JSON. Begin.
```
