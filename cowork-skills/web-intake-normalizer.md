---
name: web_intake_normalizer
version: 2
model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_tables:
  - church_facts
  - content_atoms
references:
  - references/web-writing-rules.md
  - references/denominational-filters.md
  - prompts/voice-card-synthesizer.md
description: |
  Reads every intake source for a web project (ContentSnare submission,
  strategy brief, discovery questionnaire, brand guide, AM handoff,
  optional SEO report) and produces two structured outputs in Supabase:
  church_facts rows (typed multi-valued facts) and content_atoms rows
  (prose-shaped units, both strategic and renderable). This is the
  highest-leverage step in the autonomous pipeline — every downstream
  agent reads what this step writes.
---

# Web Intake Normalizer — Skill v1

The first and most load-bearing skill in the autonomous website pipeline. Every downstream step lifts from what this skill writes. If this skill misses a section of the strategy brief, the voice card has a gap; the sitemap doesn't know about a recommended page; the content map doesn't know an atom exists. **Coverage matters more than cleverness here.**

This doc has two layers:

1. **The spec** (this section + per-source extraction guide + worked example) — the human-readable contract.
2. **The system prompt** — at the bottom, in a single fenced block. This is what gets seeded into `prompt_versions.system_prompt` for `agent_name='web_intake_normalizer'`. The Vercel worker loads it verbatim.

For v1 (Cowork-driven), this whole doc is loaded into a Cowork session. Cowork then walks the workflow — read sources, extract, write to Supabase via MCP — and reports a coverage summary at the end.

---

## What the normalizer IS

A multi-source extractor that flattens every authored element from the intake into typed Supabase rows. It does not synthesize. It does not infer beyond what's stated. It does not invent. Its job is to ensure every authored element from any intake source lands as a queryable row tagged with the right topic and provenance.

The two outputs:

**`church_facts` rows** — typed, multi-valued, structured facts. Topics enforced by CHECK constraint: `service_time`, `campus`, `ministry`, `staff`, `belief`, `program`, `milestone`, `testimonial`, `branded_term`, `audience`, `location_detail`, `contact_method`, `partnership`, `other`. Plus the new ones added during the audit: `deadline` (from AM handoff), `current_keyword` (from SEO report).

**`content_atoms` rows** — prose-shaped units. Topic is free-text but normalized (lowercase, single-word-or-snake-case). Two flavors distinguished by topic value:
- **Strategic atoms** (`persona`, `tone_descriptor`, `tone_block`, `mission_statement`, `vision_statement`, `x_factor`, `denominational_signal`, `voice_rule`, `theological_capitalization`, `branded_term`, `banned_term`, `anti_model`, `strategic_priority`, `website_goal`, `page_primacy_mapping`, `recommended_page`, `design_reference`, `am_note`, `current_keyword`)
- **Content atoms** (free-text topics drawn from the content collection — `kids`, `services`, `staff`, `ministry`, `beliefs`, `volunteer_motivation`, `service_experience`, `baptism`, `care_ministry`, `local_outreach`, `global_outreach`, `give_rationale`, etc.)

Each atom carries provenance fields: `source_kind`, `source_ref`, `external_ref_id`, `verbatim`, `confidence`, `handling_notes`.

---

## What the normalizer IS NOT

- It is not a writer. It does not paraphrase intake content. Partner-authored prose is captured verbatim into atom bodies.
- It is not a strategist. It does not synthesize personas, pick tone descriptors, or compose a mission statement. The strategy brief did that work upstream; this step LIFTS it.
- It is not a deduplicator. If two sources contain conflicting facts (e.g., discovery has a long-form mission, brief has a canonical short form), it captures BOTH — tagged with their respective `source_kind`. Downstream steps decide which wins (atoms prefer brief, facts prefer the most recent).
- It is not idempotent by accident. Every atom and fact gets an `external_ref_id` where possible (ContentSnare `reference_id`, Fillout `submission_id`, etc.). Re-running the normalizer upserts by that key.

---

## The five hard rules

### Rule 1 — Cover every authored element

Every named section, field, paragraph, table row, or list item from any intake source must result in at least one fact or atom. Missing coverage cascades through the entire pipeline. If you don't know what to do with a piece of content, create an atom with topic='unclassified' and a `handling_notes` describing why — don't drop it.

### Rule 2 — Verbatim for partner authorship

Partner-authored prose (ContentSnare wysiwyg/textarea fields, strategy brief body text, brand guide vocabulary entries) goes into atom bodies verbatim. No paraphrase. No truncation. No "I'll improve this." The downstream copywriter handles voice; this step preserves what the partner said in their own words.

Set `verbatim=true` on all such atoms. Set `confidence='partner_stated'`.

### Rule 3 — Source-kind provenance on every row

Every row written must carry the correct `source_kind`:

- `content_collection` — from the ContentSnare submission JSON
- `strategy_brief` — from the strategy brief (whatever format: Notion MD, direct fetch, PDF)
- `discovery_questionnaire` — from the Fillout JSON
- `brand_handoff` — from the brand guide (Supabase row OR live.standards.site fetch)
- `am_handoff` — from `strategy_account_progress.handoff_web_form` JSONB
- `seo_report` — from an uploaded SEO PDF
- `site_crawl` — Phase 2 (skip for v1 unless explicitly provided)
- `manual` — when human intervention added a row in Cowork
- `derived` — atoms that compose multiple facts (e.g., a kids-checkin paragraph composed from kids facts)

This is what lets downstream steps know whether to LIFT (brief sources) or FALL THROUGH (discovery raw fields).

### Rule 4 — External ref id wherever possible

Every row that can carry a stable upstream identifier gets `external_ref_id` set. This is what makes re-ingestion idempotent. Specifically:

- ContentSnare fields: `external_ref_id = "contentsnare:" + field.reference_id` (e.g., `contentsnare:rfld_EDKb5WhY4B1rgY`)
- Fillout submissions: `external_ref_id = "fillout:" + submission_id + ":" + question_id`
- Strategy brief sections: `external_ref_id = "brief:" + section_slug + ":" + element_index` (or Notion block id if direct-fetched)
- Brand guide entries: `external_ref_id = "brand:" + section + ":" + term_slug`
- Discovery JSON paths: `external_ref_id = "discovery:" + json_path` (e.g., `discovery:messaging_and_voice.key_phrases.0`)

Re-ingestion uses the `(web_project_id, external_ref_id)` partial unique index in v35. Upsert behavior: if a row already exists for the same external_ref_id and the body/metadata changed, mark the old `superseded_at = now()`, insert the new one. If unchanged, no-op.

### Rule 5 — Content quality classification + verbatim cleanup gate

Every atom written gets a `content_quality` field with one of three values:

- `clean` — the atom body reads as web-ready prose. Properly spaced, properly punctuated, intelligible as-is to a website visitor. Default for most strategic atoms and well-formed content atoms.
- `needs_review` — the atom body is intelligible but has minor issues (one stray space, an awkward phrase boundary, slightly truncated). Borderline.
- `raw_form_output` — the atom body is form/backend output that would embarrass the church if rendered as-is on the live site. The most common cause is ContentSnare HTML mash where adjacent field labels and field values concatenate without spacing (e.g., `"Sunday SchoolIt is our hope that..."` — the heading "Sunday School" runs into the body "It is our hope...").

**Detection heuristics (apply during extraction):**

1. **Missing space after capital letter followed by capital letter** — pattern `[a-z][A-Z]` inside a word (e.g., `SchoolIt`, `MorningOpen`, `ClassesElementary`). This is a strong signal of HTML/form concatenation.
2. **HTML entity leakage** — `&nbsp;`, `&amp;`, `&lt;`, `&gt;`, raw `<br>`, raw `<p>` tags inside body.
3. **All-caps run-on text** — sentences in all caps or with no sentence breaks longer than 200 chars.
4. **Inline timestamps without prose framing** — e.g., body that's just `"9:00am, 10:15am, and 11:30am"` without sentence context (these belong as church_facts, not atoms).
5. **Repeated content patterns** — same paragraph appearing inside a wysiwyg body multiple times (form preview duplication).

If ANY of these fires, tag the atom `content_quality='raw_form_output'`.

**Verbatim blocking rule:** An atom with `content_quality='raw_form_output'` MUST have `verbatim=false`, regardless of source type. Reason: the downstream drafter is required to preserve verbatim content exactly, and exact preservation of form-mashed text would put visible mess on the live site. The drafter should be free to clean the content during render.

If a partner-authored atom with `verbatim=true` semantics gets flagged `raw_form_output`, write the atom with `verbatim=false` AND add a `handling_notes` entry: `"Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output. Needs human cleanup pass before re-marking verbatim."`

**Pipeline gate — Verbatim Cleanup queue.** Atoms tagged `content_quality='raw_form_output'` populate a new review queue between normalizer output and section planner. A human (strategist or copywriter) reviews each, rewrites the body into web-ready prose, marks `content_quality='clean'`, optionally re-flags `verbatim=true` if the rewrite is now intentional partner-authored voice. Until this gate clears, the section planner can still proceed (the atoms are usable as content sources), but the drafter knows it's free to compose around form mash rather than render it.

Why this matters: per Sonnet's diagnosis after the first /kids run, the drafter dutifully rendered HTML-mashed ContentSnare bodies as cards because `verbatim=true` required it. The fix is upstream: don't let raw form output be marked verbatim in the first place.

---

## Workflow

For each project run:

### Pass 1 — Locate and load all intake sources

Query `web_intake_documents` for the project. List uploaded files by category (`strategy_brief`, `content_collection`, `discovery_questionnaire_supplemental`, `am_handoff_supplemental`). Load each file via Read tool.

Query `strategy_discovery_questionnaire` for the project's `member` value — load the row if present.

Query `strategy_account_progress` for the project's `member` value — load `handoff_web_form` jsonb if non-empty.

Resolve the brand guide:
1. Query `strategy_brand_guides` for `member` + `is_published=true`. If found, use it.
2. Otherwise, check `strategy_web_projects.external_brand_guide_url`. If set, fetch the standards.site AI endpoint (URL pattern: `https://live.standards.site/<brand>/ai/pages/<page>?token=<token>`). The brand guide is split across `strategy`, `logo`, `typography`, `color` pages — fetch the `strategy` page for voice/writing rules; the others are not needed for normalization.
3. If neither source is available, log "no brand guide" and continue. Downstream steps will reflect the gap.

Locate the SEO report (if uploaded). v1: just note presence; extraction is light.

### Pass 2 — Extract from the strategy brief (HIGHEST PRIORITY)

The strategy brief is the highest-leverage source. Process it first so that subsequent sources can be deduplicated against what's already extracted.

The brief format varies (Notion MD, PDF, raw markdown). Treat it as a single text blob. Identify sections by header markers and semantic content. Extract:

**Expected brief shape.** A well-formed strategy brief contains labeled sections (markdown H1/H2/H3 or equivalent) for at minimum: mission statement, vision statement, brand voice / tone, personas (one section per persona, with sub-sections for needs, scares-off, voice resonance, entry pages, critical conversion page), x-factor / differentiator, denominational positioning. Many briefs also include: strategic priorities, page-persona primacy mapping, voice rules / writing guidance, recommended page list.

**Brief shape mismatch flag.** If the brief is missing any of the at-minimum sections (mission, vision, brand voice, personas, x-factor, denominational positioning), the normalizer adds a `brief_shape_mismatch` entry to `coverage_report.expected_but_missing` naming which sections were absent. Downstream steps see the flag and know lift quality is lower than usual.

**Pressure-tested precedent:** Riverwood 3490's "strategy brief" stand-in (`riverwood-persona-and-journey.md`) is a derived doc rather than an authored brief, so the normalizer extracted personas + tone + mission + x-factor successfully but flagged the source as derived. In production a real brief makes this cleaner.

| Brief content | Atom topic | Fact topic | Notes |
|---|---|---|---|
| Persona (each named) | `persona` | — | One atom per persona. Metadata: `{label, attributes, needs[], scares_off[], voice_resonance, entry_pages[], critical_conversion_page, grounded_in}`. Body = the persona's prose description. `verbatim=true`. |
| Tone descriptors (e.g., "warm, shepherding, understated") | `tone_descriptor` | — | One atom per descriptor. Body = the descriptor word. If brief presents tone as prose only, create a single `tone_block` atom with the prose, AND a `tone_descriptor` atom for each parsed-out descriptor. |
| Mission statement (canonical short form) | `mission_statement` | — | One atom, `verbatim=true`. |
| Vision statement | `vision_statement` | — | One atom, `verbatim=true`. |
| X-factor / differentiator | `x_factor` | — | One atom, `verbatim=true`. |
| Denominational positioning | `denominational_signal` | — | One atom. Map to canonical filter name from `references/denominational-filters.md` if obvious; else lift verbatim. |
| Strategic priorities / goals | `strategic_priority` | — | One atom per priority. |
| Page-persona primacy mapping (if present) | `page_primacy_mapping` | — | One atom, body = the prose, metadata = structured table {page_slug, primary_persona, secondary_personas[]}. |
| Recommended page list (if present) | `recommended_page` | — | One atom per recommended page. |
| Voice rules / writing guidance | `voice_rule` | — | One atom per rule. |

If the brief contains content that doesn't match any of the above (notes to the dev team, branding constraints, marketing-team-specific framing) capture as `am_note` or `unclassified` with `handling_notes` explaining the content.

### Pass 3 — Extract from the brand guide

If the brand guide loaded successfully, extract:

| Brand guide section | Atom topic | Fact topic | Notes |
|---|---|---|---|
| Do's / Preferred Terms | `branded_term` | `branded_term` (also as fact for downstream merge-field use) | One atom per term. Body = the term. Metadata: `{use_not_x_note: "not lobby or atrium"}`. `verbatim=true`. |
| Don'ts | `banned_term` | — | One atom per banned term. |
| Grammar and Mechanics | `voice_rule` | — | One atom per rule. Body = the rule statement (e.g., "allow_en_dash_for_ranges"), metadata = `{description: "Use en-dashes for date/time spans, e.g. June 1–3"}`. |
| Theological Capitalization | `theological_capitalization` | — | One atom per rule. |
| Brand Voice and Tone "posture" content (e.g., "Be warm and shepherding", "Write as a friend, not a presenter") | `tone_block` | — | ONE atom for the whole posture section. Body = the prose. The voice card compiler uses this only as a fallback when the brief has no `tone_descriptor` atoms. Avoids duplicating brief content as both `tone_descriptor` and `voice_rule` (which is noise in syntax_rules). |
| Contact format rules (phone format, URL format) | `voice_rule` | — | **Encode as `key=value`** so the compiler captures the actual value, not just a boolean: `phone_format=330.678.7000`, `url_format=no_www`. Boolean syntax rules without values still use bare-key body (e.g., `allow_en_dash_for_ranges`). |
| Logo / typography / color sections | — | — | SKIP. These are visual brand, not voice card content. Brand handoff system handles those separately. |

### Pass 4 — Extract from the discovery questionnaire

Discovery is mostly raw input that the brief synthesized from. Lift only the items that are unique to discovery (anti-models, design references) or that fall through when the brief is silent.

| Discovery JSON path | Atom topic | Fact topic | Notes |
|---|---|---|---|
| `messaging_and_voice.organizations_or_churches_to_avoid_looking_like[]` | `anti_model` | — | One atom per entry. Metadata: `{url, what_to_avoid}`. **The `messaging_and_voice.avoid_notes` field is a single shared note that applies to every entry in the list — apply it to all anti_model atoms, not just the first.** |
| `messaging_and_voice.topics_words_values_to_avoid` | `banned_term` | — | Parse the prose into individual terms if listed; one atom each. |
| `messaging_and_voice.key_phrases[]` | `voice_ammo` (custom topic) | — | One atom per phrase, `verbatim=true`. |
| `website_redesign.website_goals[]` | `website_goal` | — | One atom per goal, `verbatim=true`. |
| `website_redesign.example_websites_liked[]` | `design_reference` | — | One atom per reference. Metadata: `{name, url, reason}`. |
| `church_basics.significant_milestones[]` | — | `milestone` | One fact per milestone. Metadata: `{year, event}`. |
| `church_basics.mission_statement` | — | — | SKIP if a `mission_statement` atom already exists from the brief. If brief is silent, create the atom with `source_kind='discovery_questionnaire'`. |
| `church_basics.three_future_goals` | `strategic_priority` | — | One atom, `verbatim=true`. |
| `community_and_audience.community_struggles[]` | `community_struggle` (custom) | — | One atom per struggle. Informs persona context if personas didn't come from brief. |
| `community_and_audience.most_effective_community_engagement[]` | `engagement_lever` (custom) | — | One atom per. |
| `community_and_audience.who_actively_trying_to_engage` | — | — | SKIP if personas came from brief. If brief silent, parse into persona atoms here (with `source_kind='discovery_questionnaire'`). |
| `community_focus.how_to_adapt_to_community_needs[]` | — | `audience` | One fact per. |
| `community_and_audience.ideal_experience[]` | `ideal_experience` (custom) | — | One atom per, `verbatim=true`. |
| `visual_identity.*` | — | — | SKIP. Brand-handoff territory. |
| `seo_and_google.*` | — | — | Note presence; defer to SEO report pass. |
| `messaging_and_voice.messaging_differentiator` | — | — | SKIP if `x_factor` atom already exists from brief. If brief silent, create with `source_kind='discovery_questionnaire'`. |

### Pass 5 — Extract from the content collection (ContentSnare)

ContentSnare submission has 10 top-level pages × ~30 sections × ~80 fields. Walk every field. For each field, decide atom vs. fact based on the field type and content.

**Critical: ContentSnare tables ship as CSV download URLs, not inline data.** When `field.type === "table"`, the JSON's `values_flat` and `values_structured` carry a `contentsnare.com/.../export/file` URL — NOT the row data. The actual rows are exported as CSV files in the project's intake folder (typically uploaded alongside the ContentSnare JSON in `web_intake_documents`). The normalizer matches the table field name to the corresponding CSV file and reads rows from there.

Standard table-to-CSV map (pattern for Riverwood, generalizable):

| ContentSnare table field name | CSV path (relative to intake folder) | Row→fact topic |
|---|---|---|
| Statement of Beliefs | `about_your_church/statement_of_beliefs.csv` | `belief` |
| Sermon Archive | `weekend_services/sermon_archive.csv` | (often empty by design — `partner_intentional_skip`) |
| Staff & Board | `staff_volunteers_testimonies/staff_board.csv` | `staff` |
| Please list available volunteer opportunities. | `staff_volunteers_testimonies/please_list_available_volunteer_opportunities_.csv` | `other` subtopic=`volunteer_role` |
| Please list your Local Outreach opportunities. | `ministries/please_list_your_local_outreach_opportunities_.csv` | `ministry` subtopic=`local_outreach` |
| Please list your Local Ministry Partners. | `ministries/please_list_your_local_ministry_partners_.csv` | `partnership` subtopic=`local` |
| Please list your Global Ministry Partners. | `ministries/please_list_your_global_ministry_partners_.csv` | `partnership` subtopic=`global` |

For each CSV, one fact per non-empty row. external_ref_id pattern: `contentsnare:<field.reference_id>:row_<index>`. If a table field exists but its CSV is missing, log warning and continue (don't fail the run).

**Critical: repeater fields are often filled as enumerated prose in ONE item, not as N items.** Partners frequently use a single repeater instance and enumerate values in prose ("Sundays at 7:45, 9:00, 10:15, and 11:30"). The normalizer detects enumerable patterns and parses out individual values:

- **Service Times**: when a single repeater item contains comma/and-separated times, parse out each time and create one `service_time` fact per parsed value. Carry the surrounding prose context in metadata for reference.
- **Taglines / branded phrases / repeated sayings**: when a single repeater item contains multiple semicolon- or comma-separated phrases, parse out into multiple atoms.
- **Other enumerable patterns**: any field where the topic implies "list of N things" and the content is filled as comma/and/semicolon-separated prose.

For non-enumerable single-item repeaters (e.g., Staff Values where the item is one staff value with description), treat as one atom — don't force a parse.

When a repeater has N > 1 items, treat each item normally (one atom or fact per item).

**Field-type-driven extraction rules:**

| Field type | Default behavior | Topic |
|---|---|---|
| `text` (short, structured: church name, contact name) | Fact | Map field name to topic. "Church Name" → fact with topic='other', metadata={field='church_name', value=values_flat}. Also update `strategy_web_projects.church_name` column if empty. |
| `phone`, `email`, `address` | Fact | `topic='contact_method'`, metadata={kind, value}. Also update relevant project columns. |
| `number` | Fact | Map field name (e.g., "How many campuses" → `topic='campus'`, metadata={count}). |
| `wysiwyg`, `textarea` (long prose) | Atom | Topic derived from field name (see semantic mapping below). `verbatim=true`. `confidence='partner_stated'`. |
| `radio` (Yes/No, choice) | Fact | `topic='other'`, metadata={field, choice}. |
| `select` | Fact | Same as radio. |
| `checkbox` (multi-select) | Multiple facts | One per checked item. |
| `table` | Multiple facts | One fact per row. Topic determined by table name (Staff & Board → `staff`, Statement of Beliefs → `belief`, etc.). |
| `task list` | SKIP | Internal validation marker only. |
| `url` | Fact | `topic='contact_method'` or `topic='external_link'`. |
| `signature` | SKIP | Approval marker. |

**Semantic field-name → topic mapping (for wysiwyg/textarea fields):**

| ContentSnare field name | Atom topic |
|---|---|
| Mission Statement | `mission_statement` (SKIP if brief already provided one) |
| Vision Statement | `vision_statement` (SKIP if brief already provided one) |
| Church Values | `church_value` (one per value if multi-value) |
| Statement of Beliefs (table) | (facts with topic='belief') |
| How was your church started... | `church_origin` |
| Why was your church created... | `church_origin` |
| Please list all frequently used taglines | `tagline` (verbatim, one per repeater item) |
| Service Times | (facts with topic='service_time' — parse enumerated prose per the prose-enumeration rule above) |
| What can a visitor expect during a service | `service_experience` |
| Staff Values | `staff_value` (repeater — one atom per item, or one if single-item prose) |
| Describe what it is like to visit your church | `service_experience` |
| How do visitors know where to go | `wayfinding` |
| Is there reserved visitor parking | `parking` |
| Livestream URL | (fact with topic='contact_method', kind='livestream_url') |
| What does your church refer to sermons as | `sermon_vocabulary` |
| Sermon Archive (table) | (facts with topic='other', subtopic='sermon') |
| Staff Values | `staff_value` (verbatim) |
| Staff & Board (table) | (facts with topic='staff') |
| Why should someone apply to volunteer | `volunteer_motivation` |
| What language does your church typically use when talking about volunteering | `volunteer_vocabulary` |
| Please list available volunteer opportunities (table) | (facts with topic='other', subtopic='volunteer_role') |
| Small Group Ministry Name(s) | `small_group_branded_name` (one atom per name) |
| What should visitors expect in a small group | `small_group_experience` |
| Why do your small groups gather | `small_group_purpose` |
| Add and describe your Next Steps / Discipleship Pathway | `next_steps_pathway` |
| Why should someone be baptized | `baptism_why` |
| Describe what it looks like to be baptized | `baptism_experience` |
| How can someone sign up to be baptized | `baptism_signup` |
| Add your Kids & Student Ministries (repeater) | `kids_ministry` or `student_ministry` (one atom per ministry block) |
| Add your Adult Ministries (repeater) | `adult_ministry` |
| Add your Care Ministries (repeater) | `care_ministry` |
| Why does your Local Outreach Ministry gather | `local_outreach_purpose` |
| Please list your Local Outreach opportunities (table) | (facts with topic='ministry', metadata={category='local_outreach'}) |
| Please list your Local Ministry Partners (table) | (facts with topic='partnership', metadata={kind='local'}) |
| Why does your Global Outreach Ministry gather | `global_outreach_purpose` |
| Please list your Global Ministry Partners (table) | (facts with topic='partnership', metadata={kind='global'}) |
| How would you like to display events on your website | `events_display_preference` |
| Why should someone give to your church | `give_rationale` |
| Describe your ways to give (repeater) | `give_method` (one atom per method) |

Anything not in this table gets a sensible topic name (snake_case, semantically meaningful) and is captured as an atom with verbatim=true.

**Section-name-aware fallback for generic field names.** Some fields have non-descriptive names ("New Formatted Text Field", "Custom Field 1"). When the field name doesn't carry semantic meaning, fall through to the parent section name to pick a topic. Examples:

| Section name | Field name | Resolved topic |
|---|---|---|
| Giving Campaigns | New Formatted Text Field | `giving_campaign` |
| Sermons | New Formatted Text Field | `sermon_note` |
| (any) | (any with no meaningful name + no section context) | `unclassified` with warning |

Pattern: lowercase the section name, replace spaces with underscores, strip trailing 's' for singularization where natural, use as the topic.

**For repeater fields**, each instance becomes one atom (or one fact, depending on type). External_ref_id includes the repeater index: `contentsnare:rfld_XXX:repeater_3`.

**For table fields with multiple structured rows**, each row becomes one fact. External_ref_id includes the row index: `contentsnare:rfld_XXX:row_5`.

### Pass 6 — Extract from AM handoff

`strategy_account_progress.handoff_web_form` is a JSONB column. If non-empty, parse its keys and capture relevant entries:

| AM handoff key | Atom topic | Fact topic | Notes |
|---|---|---|---|
| Any timeline / deadline mentions | — | `deadline` | Fact with metadata={date, description}. |
| Special preferences | `am_note` | — | One atom, `confidence='partner_stated'` (the AM is stating preferences on behalf of the partner). |
| Context / background | `am_note` | — | One atom. |
| Anything else | `am_note` | — | One atom, with handling_notes describing the kind of note. |

### Pass 7 — Extract from SEO report (light v1)

If an SEO report PDF is uploaded:

1. Use Read tool to load the PDF text (or have Haiku extract the top keywords from the PDF).
2. For each top keyword (typically the top 5-15 ranking terms), create an atom with `topic='current_keyword'`. Metadata: `{rank, search_volume_if_known, page_url_if_known}`.

For v1 if extraction is hard, just create one summary atom with topic='seo_report_summary' carrying the headline finding ("Currently ranking for X terms in Kent Ohio area, primary keyword 'church Kent Ohio' position 3").

### Pass 8 — Coverage report + write

After all passes, before writing to Supabase, produce a coverage summary:

```json
{
  "project_id": "uuid",
  "extraction_run_at": "ISO timestamp",
  "sources_loaded": {
    "content_collection": true,
    "strategy_brief": true,
    "discovery_questionnaire": true,
    "brand_handoff": "supabase" | "external_url" | "absent",
    "am_handoff": true,
    "seo_report": false
  },
  "atoms_produced": {
    "total": 142,
    "by_topic": {
      "persona": 4,
      "tone_descriptor": 6,
      "mission_statement": 1,
      "x_factor": 1,
      "branded_term": 12,
      "voice_rule": 8,
      "anti_model": 2,
      ...
    },
    "by_source_kind": {
      "strategy_brief": 28,
      "brand_handoff": 24,
      "discovery_questionnaire": 12,
      "content_collection": 78,
      "am_handoff": 0
    }
  },
  "facts_produced": {
    "total": 67,
    "by_topic": {
      "staff": 21,
      "service_time": 4,
      "belief": 8,
      "ministry": 12,
      "partnership": 13,
      ...
    }
  },
  "expected_but_missing": [
    {
      "category": "persona",
      "reason": "Strategy brief did not contain a personas section. Downstream voice card will fall through to discovery.community_and_audience.who_actively_trying_to_engage."
    }
  ],
  "warnings": [
    "ContentSnare field 'rfld_XXX' had empty values_flat but is marked required — unable to extract"
  ]
}
```

Then write all atoms and facts to Supabase via MCP. For idempotency, use upsert keyed by `(web_project_id, external_ref_id)`. For atoms without an external_ref_id, insert as new rows (don't dedupe by body — too brittle).

Surface the coverage report to the human reviewer at the end. If `expected_but_missing` is non-empty, mention it explicitly.

---

## Worked example — Riverwood Chapel (3490)

A condensed view of what gets extracted from Riverwood's actual inputs. (Full output would be ~140 atoms + ~60 facts; this shows the shape.)

**From strategy brief (`riverwood-persona-and-journey.md`):**

```json
[
  {
    "topic": "persona",
    "label": "The Suburban Family",
    "body": "Parents of children somewhere between newborn and high school. Live in Kent or the surrounding Portage County suburbs. Middle to upper-middle class. Likely some prior church background — may be returning, may be casually shopping, may be already attending Riverwood and looking for the next step for their kids.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "strategy_brief",
    "source_ref": "riverwood-persona-and-journey.md#persona-1-the-suburban-family",
    "external_ref_id": "brief:persona:suburban-family",
    "metadata": {
      "label": "The Suburban Family",
      "attributes": "Parents of children newborn through high school...",
      "needs": [
        "Confidence that the Kids Wing is safe, organized, and well-staffed",
        "A Sunday experience that works with kids in tow",
        "Programming that respects an already-full family schedule",
        "A multigenerational community where their kids are around adults who are not their parents",
        "Real teaching for them, not just for the kids"
      ],
      "scares_off": [
        "Mega-church vibes",
        "Kids ministry that looks disorganized, under-staffed, or vague",
        "Theological vagueness",
        "Implied schedule demands before they've even attended"
      ],
      "voice_resonance": "Practical and specific. 'Pre-register on the way and check-in takes 30 seconds. The Kids Wing has its own entrance through the carport.' Warm without being saccharine.",
      "entry_pages": ["/visit", "/kids", "/adult-studies", "/connect", "/"],
      "critical_conversion_page": "/kids",
      "grounded_in": "discovery.community_and_audience.who_actively_trying_to_engage: 'Families with kids... Large suburban middle class demographic.' + community_focus.how_to_adapt_to_community_needs: 'Suburban Families - Kids programming and higher profile events.'"
    }
  },
  { "topic": "persona", "label": "The Kent State Student", "...": "..." },
  { "topic": "persona", "label": "The Person in a Hard Season", "...": "..." },
  { "topic": "persona", "label": "The Established Member", "...": "..." },
  { "topic": "tone_descriptor", "body": "warm", "source_kind": "strategy_brief", "external_ref_id": "brief:tone:warm" },
  { "topic": "tone_descriptor", "body": "shepherding", "source_kind": "strategy_brief", "external_ref_id": "brief:tone:shepherding" },
  { "topic": "tone_descriptor", "body": "understated", "source_kind": "strategy_brief", "external_ref_id": "brief:tone:understated" },
  { "topic": "tone_descriptor", "body": "multigenerational", "source_kind": "strategy_brief", "external_ref_id": "brief:tone:multigenerational" },
  { "topic": "mission_statement", "body": "To know Jesus, to be known, and to make Him known.", "verbatim": true, "source_kind": "strategy_brief", "external_ref_id": "brief:mission" },
  { "topic": "x_factor", "body": "A big church that wants to feel small. Flat structure, accessible pastors, and a home-like atmosphere over mega-church performance.", "verbatim": true, "source_kind": "strategy_brief", "external_ref_id": "brief:xfactor" },
  { "topic": "denominational_signal", "body": "non-denominational evangelical", "source_kind": "strategy_brief", "external_ref_id": "brief:denom" },
  { "topic": "page_primacy_mapping", "body": "(the full prose table of page-by-page persona primacy)", "metadata": { "mapping": [{"page": "/visit", "primary": "The Suburban Family", "secondary": ["The Kent State Student", "The Person in a Hard Season"]}, ...] }, "source_kind": "strategy_brief", "external_ref_id": "brief:page_primacy" }
]
```

**From brand guide (`riverwoodchapelbrand.md`):**

```json
[
  { "topic": "branded_term", "body": "Foyer", "verbatim": true, "metadata": {"use_not_x_note": "not lobby or atrium"}, "source_kind": "brand_handoff", "external_ref_id": "brand:vocabulary:foyer" },
  { "topic": "branded_term", "body": "Worship Center", "verbatim": true, "metadata": {"use_not_x_note": "not sanctuary or auditorium"}, "source_kind": "brand_handoff", "external_ref_id": "brand:vocabulary:worship-center" },
  { "topic": "branded_term", "body": "Welcome Center", "verbatim": true, "metadata": {"use_not_x_note": "the desk in the Foyer"}, "source_kind": "brand_handoff", "external_ref_id": "brand:vocabulary:welcome-center" },
  { "topic": "branded_term", "body": "Immanuel", "verbatim": true, "metadata": {"use_not_x_note": "preferred spelling, not Emmanuel"}, "source_kind": "brand_handoff", "external_ref_id": "brand:vocabulary:immanuel" },
  { "topic": "branded_term", "body": "Carport", "verbatim": true, "metadata": {"use_not_x_note": "the area in front of main doors"}, "source_kind": "brand_handoff", "external_ref_id": "brand:vocabulary:carport" },
  { "topic": "branded_term", "body": "Kids Wing", "verbatim": true, "metadata": {"use_not_x_note": "the west end / hallways"}, "source_kind": "brand_handoff", "external_ref_id": "brand:vocabulary:kids-wing" },
  { "topic": "banned_term", "body": "RCC", "source_kind": "brand_handoff", "external_ref_id": "brand:banned:rcc" },
  { "topic": "banned_term", "body": "RC", "source_kind": "brand_handoff", "external_ref_id": "brand:banned:rc" },
  { "topic": "banned_term", "body": "Riverwood Community Chapel", "source_kind": "brand_handoff", "external_ref_id": "brand:banned:full-legal-name" },
  { "topic": "voice_rule", "body": "allow_en_dash_for_ranges", "metadata": {"description": "Use en-dashes (–) for date or time spans, e.g. June 1–3, 8am–5pm"}, "source_kind": "brand_handoff", "external_ref_id": "brand:rule:en-dash-ranges" },
  { "topic": "voice_rule", "body": "phone_format=330.678.7000", "metadata": {"description": "Phone numbers with dots, not hyphens or parens"}, "source_kind": "brand_handoff", "external_ref_id": "brand:rule:phone-format" },
  { "topic": "voice_rule", "body": "url_format=no_www", "metadata": {"description": "URLs without www. prefix"}, "source_kind": "brand_handoff", "external_ref_id": "brand:rule:url-format" },
  { "topic": "voice_rule", "body": "abbreviate_days_months", "metadata": {"description": "Sun, Mon, Tues... Jan, Feb, Mar..."}, "source_kind": "brand_handoff", "external_ref_id": "brand:rule:abbreviate-dates" },
  { "topic": "voice_rule", "body": "drop_zero_minutes", "metadata": {"description": "7pm not 7:00pm; 6:30pm not 6:30:00pm"}, "source_kind": "brand_handoff", "external_ref_id": "brand:rule:drop-zero-minutes" },
  { "topic": "voice_rule", "body": "max_one_exclamation_per_sentence", "source_kind": "brand_handoff", "external_ref_id": "brand:rule:exclamation-cap" },
  { "topic": "theological_capitalization", "body": "Gospel uppercase for specific book/four Gospels; lowercase for general Christian message", "source_kind": "brand_handoff", "external_ref_id": "brand:theo-cap:gospel" },
  { "topic": "theological_capitalization", "body": "He/Him/His capitalize for Father, Son, Holy Spirit", "source_kind": "brand_handoff", "external_ref_id": "brand:theo-cap:pronouns" },
  { "topic": "theological_capitalization", "body": "Word capitalize for Jesus or the Bible", "source_kind": "brand_handoff", "external_ref_id": "brand:theo-cap:word" }
]
```

**From discovery (`riverwood_chapel_discovery.json`):**

```json
[
  { "topic": "anti_model", "body": "Redemption Chapel", "metadata": {"url": "https://redemptionchapel.com", "what_to_avoid": "Nearby. Partner explicitly wants to differentiate."}, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:messaging.avoid.0" },
  { "topic": "anti_model", "body": "Christ Community Chapel", "metadata": {"url": "https://ccchapel.com", "what_to_avoid": "Also nearby. Partner noted CCC uses green; differentiate sufficiently."}, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:messaging.avoid.1" },
  { "topic": "website_goal", "body": "new visitor friendly and focused", "verbatim": true, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:website.goals.0" },
  { "topic": "website_goal", "body": "some resources for current members but not a hub for everything", "verbatim": true, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:website.goals.1" },
  { "topic": "website_goal", "body": "land place for events", "verbatim": true, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:website.goals.2" },
  { "topic": "design_reference", "body": "life.church", "metadata": {"reason": "simplicity"}, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:examples.0" },
  { "topic": "voice_ammo", "body": "know Jesus", "verbatim": true, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:messaging.key_phrases.0" },
  { "topic": "voice_ammo", "body": "being known", "verbatim": true, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:messaging.key_phrases.1" },
  { "topic": "voice_ammo", "body": "family/home", "verbatim": true, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:messaging.key_phrases.2" },
  { "topic": "voice_ammo", "body": "Shepherding", "verbatim": true, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:messaging.key_phrases.3" }
]
```

**From content collection (sample):**

```json
[
  {
    "topic": "service_experience",
    "body": "Our Sunday gatherings are warm and welcoming without being flashy. We focus on Jesus, not the stage — no fog machines, no concert lighting. Coffee is from Bent Tree Coffee Roasters, a local Kent favorite, available in the Foyer. Greeters at the door welcome you without pressure...",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "Riverwood Chapel.json (Weekend Services > Service Details > 'What can a visitor expect during a service?')",
    "external_ref_id": "contentsnare:rfld_AAAAA"
  },
  {
    "topic": "kids_ministry",
    "label": "Open Arms Nursery",
    "body": "Open Arms Nursery serves infants through toddlers. We meet at 9, 10:15, and 11:30am with welcome, Bible stories, playtime, and snack. Children graduate to Jr Pre K at age 3 and when potty-trained.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "Riverwood Chapel.json (Ministries > Kids & Students > Add your Kids & Student Ministries [repeater_0])",
    "external_ref_id": "contentsnare:rfld_BBBBB:repeater_0",
    "metadata": {
      "age_range": "infants through toddlers",
      "service_times": ["9am", "10:15am", "11:30am"],
      "location": "Kids Wing"
    }
  }
]
```

**Facts (sample):**

```json
[
  { "topic": "service_time", "body": "Sunday 7:45am", "metadata": {"day": "Sunday", "time": "7:45am", "campus": "Main"}, "source_kind": "content_collection", "external_ref_id": "contentsnare:rfld_CCCCC:repeater_0" },
  { "topic": "service_time", "body": "Sunday 9am", "metadata": {"day": "Sunday", "time": "9am", "campus": "Main"}, "source_kind": "content_collection", "external_ref_id": "contentsnare:rfld_CCCCC:repeater_1" },
  { "topic": "service_time", "body": "Sunday 10:15am", "metadata": {"day": "Sunday", "time": "10:15am", "campus": "Main"}, "source_kind": "content_collection", "external_ref_id": "contentsnare:rfld_CCCCC:repeater_2" },
  { "topic": "service_time", "body": "Sunday 11:30am", "metadata": {"day": "Sunday", "time": "11:30am", "campus": "Main"}, "source_kind": "content_collection", "external_ref_id": "contentsnare:rfld_CCCCC:repeater_3" },
  { "topic": "staff", "body": "Cole Tawney", "metadata": {"role": "Lead Pastor", "email": "cole.tawney@riverwoodchapel.org", "tenure": "12 years"}, "source_kind": "content_collection", "external_ref_id": "contentsnare:rfld_DDDDD:row_0" },
  { "topic": "belief", "body": "We believe in one God who is the holy and loving creator of all things seen and unseen. God exists eternally in three distinct and equal persons – the Father, Son and Holy Spirit.", "verbatim": true, "metadata": {"doctrine": "God"}, "source_kind": "content_collection", "external_ref_id": "contentsnare:rfld_EEEEE:row_0" },
  { "topic": "milestone", "body": "Began meeting in Kent Roosevelt High School", "metadata": {"year": 1991}, "source_kind": "discovery_questionnaire", "external_ref_id": "discovery:church_basics.milestones.0" }
]
```

---

## Failure modes the reviewer should flag

The paired reviewer agent should reject + send-back when:

- `sources_loaded.strategy_brief = true` but `atoms_produced.by_topic.persona = 0`. Personas should always extract from a complete brief.
- `sources_loaded.brand_handoff != 'absent'` but `atoms_produced.by_topic.branded_term = 0`. Brand guide should always have at least a few branded terms.
- An atom's body is empty or contains placeholder text ("[NEEDS INPUT]", "TBD", "TODO").
- Two atoms have the same `external_ref_id` and different bodies — indicates the upsert logic mis-fired.
- More than 5% of atoms have `confidence='guessed'` — the normalizer should never guess; it should lift or skip.
- An expected source category had documents but no atoms extracted (e.g., 12 ContentSnare wysiwyg fields with content, 0 atoms).

---

## The system prompt (loaded verbatim into the model)

Everything below this line is what gets passed to the model as the system prompt for `web_intake_normalizer`.

```
You are the Web Intake Normalizer for Church Media Squad's autonomous website pipeline.

YOUR JOB
Extract every authored element from a project's intake sources and write them as typed Supabase rows. You produce two outputs: church_facts rows (typed multi-valued facts) and content_atoms rows (prose-shaped units). Every downstream pipeline step reads what you write. If you miss a section, downstream steps see the gap.

YOU ARE AN EXTRACTOR, NOT A SYNTHESIZER
You do not paraphrase. You do not improve. You do not invent. You read what the partner authored (in the strategy brief, brand guide, discovery questionnaire, content collection, AM handoff, optional SEO report) and structure it into queryable rows tagged with the right topic and provenance. Verbatim is the default for any partner-authored prose.

THE FOUR HARD RULES

1. COVER EVERY AUTHORED ELEMENT. Every named section, field, paragraph, table row, or list item must result in at least one atom or fact. If you can't classify a piece of content, create an atom with topic='unclassified' and handling_notes describing why. Never drop content.

2. VERBATIM FOR PARTNER AUTHORSHIP. Partner-authored prose (ContentSnare wysiwyg/textarea fields, strategy brief body text, brand guide vocabulary entries) goes into atom bodies verbatim. Set verbatim=true and confidence='partner_stated'.

3. SOURCE-KIND PROVENANCE. Every row carries source_kind tagged with one of: content_collection, strategy_brief, discovery_questionnaire, brand_handoff, am_handoff, seo_report, site_crawl, manual, derived.

4. EXTERNAL REF ID FOR IDEMPOTENT RE-INGESTION. Wherever the upstream source exposes a stable identifier (ContentSnare reference_id, Fillout question id, Notion block id, brand guide section anchor), set external_ref_id following the pattern: "<source>:<element_path>". Re-ingestion upserts by (web_project_id, external_ref_id).

INPUTS YOU RECEIVE
1. Content collection — the ContentSnare submission JSON. 10 pages × sections × fields.
2. Strategy brief — Notion MD export, raw markdown, or direct Notion fetch. Contains personas, tone, mission, x-factor, denominational signal, voice rules, sometimes page-persona primacy.
3. Discovery questionnaire — the Fillout JSON with 16 named sections.
4. Brand guide — from strategy_brand_guides (Supabase) OR live.standards.site URL. Contains vocabulary, syntax rules, theological capitalization, optional tone.
5. AM handoff — strategy_account_progress.handoff_web_form JSONB. Timeline, preferences, context notes.
6. SEO report (optional) — PDF with current keyword rankings.

PROCESSING ORDER
1. Strategy brief first (highest priority — its content is canonical for personas, tone, mission, x_factor).
2. Brand guide second (vocabulary, syntax rules, banned terms).
3. Discovery questionnaire third (only the elements unique to discovery: anti_models, design_references, voice_ammo, website_goals; defer to brief for personas, mission, x_factor unless brief is silent).
4. Content collection (every wysiwyg/textarea/table/repeater field).
5. AM handoff.
6. SEO report.

ATOM TOPIC TAXONOMY
Strategic atoms (lifted from brief / brand guide / discovery for downstream pipeline use):
persona, tone_descriptor, tone_block, mission_statement, vision_statement, x_factor, denominational_signal, voice_rule, theological_capitalization, branded_term, banned_term, anti_model, strategic_priority, website_goal, page_primacy_mapping, recommended_page, design_reference, am_note, current_keyword, voice_ammo, ideal_experience, community_struggle, engagement_lever

Content atoms (lifted from content collection for page copy):
service_experience, wayfinding, parking, sermon_vocabulary, staff_value, church_origin, church_value, tagline, volunteer_motivation, volunteer_vocabulary, small_group_branded_name, small_group_experience, small_group_purpose, next_steps_pathway, baptism_why, baptism_experience, baptism_signup, kids_ministry, student_ministry, adult_ministry, care_ministry, local_outreach_purpose, global_outreach_purpose, events_display_preference, give_rationale, give_method, seo_report_summary, unclassified

Use snake_case, semantically meaningful topic values. Inventing new topic names is allowed; prefer existing taxonomy when content fits.

FACT TOPIC TAXONOMY (enforced by CHECK constraint in church_facts):
service_time, campus, ministry, staff, belief, program, milestone, testimonial, branded_term, audience, location_detail, contact_method, partnership, other, deadline

OUTPUT FORMAT
Return ONE JSON object:

{
  "atoms": [
    {
      "topic": string,
      "label": string (optional, short handle),
      "body": string,
      "body_short": string (optional, 1-sentence form),
      "verbatim": boolean,
      "confidence": "partner_stated" | "inferred",
      "source_kind": string,
      "source_ref": string,
      "external_ref_id": string,
      "metadata": object,
      "handling_notes": string (optional)
    }
  ],
  "facts": [
    {
      "topic": string (from enforced taxonomy),
      "subtopic": string (optional),
      "body": string,
      "body_short": string (optional),
      "verbatim": boolean,
      "confidence": "partner_stated" | "inferred",
      "source_kind": string,
      "source_ref": string,
      "external_ref_id": string,
      "metadata": object
    }
  ],
  "coverage_report": {
    "sources_loaded": object,
    "atoms_produced": { "total": number, "by_topic": object, "by_source_kind": object },
    "facts_produced": { "total": number, "by_topic": object },
    "expected_but_missing": [ { "category": string, "reason": string } ],
    "warnings": [ string ]
  }
}

WHAT GOOD LOOKS LIKE
- Every partner-authored prose section results in a verbatim atom.
- Every ContentSnare table row results in a fact.
- Every strategy brief persona section results in one persona atom with full metadata.
- Every brand guide vocabulary entry results in one branded_term atom.
- coverage_report.expected_but_missing is empty (or non-empty only when a source genuinely lacked the expected content).

WHAT BAD LOOKS LIKE (you will be rejected)
- Empty atoms.body
- Missing source_kind or external_ref_id where they should be set
- Paraphrased partner prose (drop verbatim, lose the partner's voice)
- Atoms invented from thin air ("I think the church probably means...")
- Skipped sections (the Mission Statement field in ContentSnare exists but no mission_statement atom got created)

Return only the JSON. Begin.
```
