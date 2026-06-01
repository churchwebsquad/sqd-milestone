---
name: voice_card_synthesizer
version: 2
model: anthropic/claude-haiku-4-5
reviewer_model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_table: church_voice_cards
references:
  - references/web-writing-rules.md
  - references/denominational-filters.md
  - references/persona-hooks.md
changelog: |
  v2: Reframed as a lift-first compiler, not a synthesizer. Personas, mission,
  tone, x_factor, and denominational filter are LIFTED from strategy-brief-
  sourced atoms that normalize_intake already extracted. The model only
  inferred when atoms are absent. Discovery raw fields are last-resort
  fallback. Downgraded model from Sonnet → Haiku because the work is now
  normalization, not synthesis.
---

# Voice Card Compiler — Prompt v2

This step *compiles* a structured voice card from already-extracted strategic atoms. It does NOT synthesize a voice from raw discovery signals. The strategy brief carried personas, tone, mission, and x-factor as authored content; `normalize_intake` already extracted those as `content_atoms` rows with appropriate strategic topics. This step's job is to assemble them into the canonical `church_voice_cards` JSON shape.

The doc keeps the filename `voice-card-synthesizer.md` (and the `agent_name='voice_card_synthesizer'`) for stable references in the architecture doc, but the *behavior* is compilation. v1 of this prompt — which had the model re-derive personas from `discovery.community_and_audience.who_actively_trying_to_engage` — is deprecated. See changelog above.

This doc has two layers:

1. **The spec** (this section + per-field sourcing + examples) — the human-readable contract.
2. **The system prompt** — at the bottom, in a single fenced block. This is what eventually lands as `prompt_versions.system_prompt` for `agent_name='voice_card_synthesizer'`. The worker passes it verbatim to the model.

---

## What the voice card IS

A structured profile of how one specific church sounds in writing. Not generic. Not portable to another church. The fields below are the canonical shape. Every value should trace either to a lifted atom or to a global default — never to a model guess.

```json
{
  "tone_descriptors": ["warm", "shepherding", "understated", "multigenerational"],
  "banned_terms": ["delve", "tapestry", "elevate", "RCC", "Riverwood Community Chapel", ...],
  "branded_vocabulary": {
    "Foyer": "not lobby or atrium",
    "Worship Center": "not sanctuary or auditorium",
    "Kids Wing": "the west end / hallways"
  },
  "denominational_filter": "evangelical-non-denominational",
  "mission_statement": "To know Jesus, to be known, and to make Him known.",
  "x_factor": "A big church that wants to feel small. Flat structure, accessible pastors, home-like atmosphere.",
  "persona_snapshots": [ ... see schema below ... ],
  "syntax_rules": {
    "no_em_dash": true,
    "allow_en_dash_for_ranges": true,
    "no_triads": true,
    "you_your_in_body": true,
    "oxford_comma": true,
    "no_we_our_in_body": true,
    "phone_format": "330.678.7000",
    "url_format": "no_www",
    "abbreviate_days_months": true
  },
  "example_phrases_good": ["Know Jesus", "Be Known", "Make Him Known", ...],
  "example_phrases_bad": ["come as you are", "life-changing", ...],
  "anti_models": [
    { "name": "Redemption Chapel", "url": "https://redemptionchapel.com", "what_to_avoid": "..." }
  ],
  "_confidence_log": {
    "tone_descriptors": "lifted_from_brief",
    "persona_snapshots": "lifted_from_brief",
    "x_factor": "lifted_from_brief"
  },
  "_unfilled_with_reason": {}
}
```

## What the voice card IS NOT

- It is not a marketing positioning doc. It's a writing reference for downstream agents.
- It is not the place where personas, tone, or mission are *invented*. The strategy brief did that work. This step normalizes what's there.
- It is not a substitute for the brand guide. The brand guide carries visual identity, color, typography — none of that lives here.
- It is not regenerated mid-pipeline. Once approved at Gate 1, downstream steps lock against this version.

---

## The four hard rules

### Rule 1 — Lift before generate

The strategy brief is upstream of this pipeline. By the time this step runs, `normalize_intake` has already extracted every authored element from the brief as `content_atoms` rows with strategic topics: `persona`, `tone_descriptor`, `tone_block`, `mission_statement`, `x_factor`, `denominational_signal`, `voice_rule`, `theological_capitalization`, `branded_term`, `banned_term`, `anti_model`, `strategic_priority`.

Your job is to read those atoms and assemble them into the voice card JSON shape. You do not re-derive what the atoms already carry. You do not paraphrase atom bodies. You do not extrapolate detail beyond what an atom contains.

If an expected atom is absent — for example, the brief had no x_factor section, so there's no atom with `topic='x_factor'` — you leave the field empty and add a `_unfilled_with_reason` entry explaining the absence. You do NOT fall through to raw discovery fields to invent a value.

### Rule 2 — Personas are lifted, not built

Each persona in the voice card comes from one `content_atoms` row with `topic='persona'`. Use the atom's body verbatim or near-verbatim. Use the atom's metadata fields (label, needs, scares_off, voice_resonance, entry_pages, critical_conversion_page) verbatim.

You do NOT:
- Add detail to a persona that the atom didn't contain.
- Invent biographical names (Matt, Lauren, Brian, Amina). Persona labels are descriptive segment names ("The Suburban Family") that came from the atom.
- Add invented ages, jobs, neighborhoods, or hobbies.
- Add a `needs` item the atom didn't list.

If the brief had no personas — no atoms with `topic='persona'` — the `persona_snapshots` array is empty. You add a `_unfilled_with_reason` entry. You do NOT compose personas from discovery's `who_actively_trying_to_engage` field. That's strictly a normalize_intake responsibility and it didn't happen here, so personas are absent.

### Rule 3 — Brand-guide content is captured verbatim

Atoms with `topic='branded_term'` map directly into `branded_vocabulary` with the use-not-X note attached. Atoms with `topic='voice_rule'` overlay onto the global syntax rules as overrides. Atoms with `topic='theological_capitalization'` map into `syntax_rules.theological_capitalization`.

No paraphrase. No added definitions. The brand guide already said it; you preserve it.

### Rule 4 — Confidence is honest

Tag every non-trivial field in `_confidence_log` with one of:

- `lifted_from_brief` — value came from a strategy-brief-sourced atom.
- `lifted_from_brand_guide` — value came from a brand-guide-sourced atom.
- `lifted_from_discovery` — value came from a discovery-sourced atom (e.g., `anti_model`).
- `lifted_from_global` — value came from `references/web-writing-rules.md` defaults.
- `inferred` — value composed from multiple lifted sources (rare; only for fields like `tone_descriptors` when you parsed a `tone_block` atom into individual descriptors).
- `guessed` — no clear support. Should be rare to zero. A voice card with `guessed` tags will be rejected by the reviewer agent.

---

## Inputs

The worker provides three structured inputs. (For the Cowork-driven v1, Cowork assembles these from Supabase MCP queries before invoking the prompt.)

### Input 1 — Strategic atoms (PRIMARY SOURCE)

`content_atoms` rows filtered to strategic topics. This is what you read first and most.

```json
[
  {
    "id": "uuid",
    "topic": "persona | tone_descriptor | tone_block | mission_statement | vision_statement | x_factor | denominational_signal | voice_rule | theological_capitalization | branded_term | banned_term | anti_model | strategic_priority | website_goal | page_primacy_mapping",
    "body": "the authored content",
    "verbatim": true | false,
    "confidence": "partner_stated | inferred",
    "metadata": { ... structured fields for typed atoms like personas },
    "source_kind": "strategy_brief | brand_handoff | discovery_questionnaire"
  },
  ...
]
```

**Read order:**

1. Atoms with `source_kind='strategy_brief'` — these are the highest-trust sources. Lift them.
2. Atoms with `source_kind='brand_handoff'` — for vocabulary, syntax rules, theological cap.
3. Atoms with `source_kind='discovery_questionnaire'` — for anti-models and supplemental banned terms.

### Input 2 — Content facts (CROSS-REFERENCE)

`church_facts` rows. Mostly not relevant to the voice card directly, but used to confirm:
- Denomination (cross-check against `denominational_signal` atom).
- Mission cross-reference (the discovery's `church_basics.mission_statement` is in facts; brief's canonical form is in atoms — atoms win).

### Input 3 — Global writing rules (DEFAULTS)

The contents of `references/web-writing-rules.md` are passed in as constants. Use them to:
- Seed `banned_terms` with the global cliché list (delve, tapestry, unlock, elevate, beacon, embark, resonate, dynamic, synergistic, game-changer, testament, "in a world where," "at the heart of," "journey of faith").
- Seed `syntax_rules` with defaults (no_em_dash, no_triads, no_filler_intensifiers, you_your_in_body, no_we_our_in_body, oxford_comma, etc.).
- Seed `example_phrases_bad` with the church cliché list (come as you are, life-changing, vibrant community, spiritual journey, walk with God).

### Input 4 — Raw discovery (LAST-RESORT FALLBACK ONLY)

The parsed discovery JSON is provided for one purpose only: when an expected strategic atom is ABSENT and the field would otherwise be empty, the compiler MAY consult discovery raw fields. But only when the absence is unexpected (e.g., every standard brief has personas; this one's missing them — fall back to extracting from `discovery.community_and_audience.who_actively_trying_to_engage`). In that case, the field's `_confidence_log` is `lifted_from_discovery` and the `_unfilled_with_reason` notes the brief gap.

**Default behavior is to NOT fall back.** Leave fields empty when atoms are missing; the reviewer agent will flag the gap.

---

## Per-field sourcing guide

### `persona_snapshots` (array)

**Source order:**
1. Atoms with `topic='persona'` and `source_kind='strategy_brief'`. Lift each atom's metadata directly into the persona object: `label`, `needs`, `scares_off`, `voice_resonance`, `entry_pages`, `critical_conversion_page`. Atom body becomes the `attributes` field if metadata.attributes is absent.
2. (Fallback only if absent) Atoms with `topic='persona'` and any source_kind.
3. (Last-resort fallback if no persona atoms exist anywhere) `discovery.community_and_audience.who_actively_trying_to_engage` decomposed into segment labels. Each lifted-from-discovery persona has `lifted_from_discovery` in `_confidence_log` and the persona's `attributes` field is restricted to demographic descriptors actually in the discovery — no invented bio detail.

**Do NOT:**
- Add detail beyond what the atom contained.
- Invent biographical names. Use descriptive segment labels from the atom's metadata.label.
- Merge or split personas — preserve the atom set as-is.

### `tone_descriptors` (array)

**Source order:**
1. Atoms with `topic='tone_descriptor'`. Each becomes one entry.
2. Atom with `topic='tone_block'` (single prose description) — parse into individual descriptors. Mark `inferred` in confidence log because parsing was involved.
3. (Last-resort) Composed from `discovery.messaging_and_voice.messaging_tone` text.

### `mission_statement` (string)

**Source order:**
1. Atom with `topic='mission_statement'` and `source_kind='strategy_brief'` body verbatim.
2. (Fallback) Atom with `topic='mission_statement'` any source.
3. (Last-resort) `discovery.church_basics.mission_statement` — but watch for long-form prose; brief's canonical short form is preferred.

### `x_factor` (string)

**Source order:**
1. Atom with `topic='x_factor'` body verbatim.
2. (Last-resort) `discovery.messaging_and_voice.messaging_differentiator` — only if no atom exists. Flag as `lifted_from_discovery`.

### `denominational_filter` (string)

**Source order:**
1. Atom with `topic='denominational_signal'` mapped to canonical filter name from `references/denominational-filters.md`.
2. (Fallback) `discovery.church_basics.denomination` if present.
3. Default: `evangelical-non-denominational` per `references/denominational-filters.md`, with `_confidence_log` set to `guessed` and `_unfilled_with_reason` noting the default.

### `branded_vocabulary` (object)

**Source order:**
1. Atoms with `topic='branded_term'` mapped to `{atom.body: atom.metadata.use_not_x_note}`. Verbatim.

If no `branded_term` atoms exist, the brand guide either had no vocabulary section or the extractor missed it. Leave empty; reviewer flags it.

### `banned_terms` (array)

**Source order (UNION of all):**
1. Global cliché list from `references/web-writing-rules.md` — always included.
2. Atoms with `topic='banned_term'` from any source.
3. Atoms with `topic='branded_term'` where the metadata indicates the use-not-X note carries an avoidance (e.g., "Foyer (not lobby or atrium)" yields banned: lobby, atrium).

### `syntax_rules` (object)

**Source order:**
1. Global defaults from `references/web-writing-rules.md`.
2. Atoms with `topic='voice_rule'` overlay as overrides. (E.g., Riverwood's brand guide includes "allow en-dash for date/time ranges" — that's a `voice_rule` atom that overlays.)
3. Atoms with `topic='theological_capitalization'` populate `syntax_rules.theological_capitalization`.

### `example_phrases_good` (array)

**Source order:**
1. Atoms with `verbatim=true` and any voice-tagged topic (`tone_descriptor`, branded phrases).
2. Atoms from the content collection with `verbatim=true` (partner-blessed phrases like "Know Jesus", "Be Known").
3. Brand guide voice ammunition section if extracted as atoms.

### `example_phrases_bad` (array)

**Source order:**
1. Global cliché list from `references/web-writing-rules.md`.
2. Atoms with `topic='banned_term'` that are phrases (vs. single words).

### `anti_models` (array)

**Source order:**
1. Atoms with `topic='anti_model'` — each becomes one object with `name`, `url`, `what_to_avoid`.

---

## Worked example — Riverwood Chapel (3490)

Assume `normalize_intake` has run and produced the following relevant strategic atoms (showing only the fields needed for this example):

```json
[
  {
    "topic": "persona",
    "body": "Parents of children newborn through high school. Live in Kent or surrounding Portage County suburbs. Middle to upper-middle class. Likely some prior church background.",
    "verbatim": true,
    "source_kind": "strategy_brief",
    "metadata": {
      "label": "The Suburban Family",
      "needs": ["Kids Wing reads safe/organized", "Pre-registration easy", "Multigenerational community", "Real teaching for adults, not just kids"],
      "scares_off": ["Mega-church vibes", "Disorganized kids ministry", "Theological vagueness", "Implied schedule demands before they've attended"],
      "voice_resonance": "Practical and specific. 'Pre-register on the way and check-in takes 30 seconds. The Kids Wing has its own entrance through the carport.' Warm without being saccharine.",
      "entry_pages": ["/visit", "/kids"],
      "critical_conversion_page": "/kids"
    }
  },
  { "topic": "persona", "body": "...", "metadata": { "label": "The Kent State Student", ... } },
  { "topic": "persona", "body": "...", "metadata": { "label": "The Person in a Hard Season", ... } },
  { "topic": "persona", "body": "...", "metadata": { "label": "The Established Member", ... } },
  { "topic": "tone_descriptor", "body": "warm", "source_kind": "strategy_brief" },
  { "topic": "tone_descriptor", "body": "shepherding", "source_kind": "strategy_brief" },
  { "topic": "tone_descriptor", "body": "understated", "source_kind": "strategy_brief" },
  { "topic": "tone_descriptor", "body": "multigenerational", "source_kind": "strategy_brief" },
  { "topic": "mission_statement", "body": "To know Jesus, to be known, and to make Him known.", "verbatim": true, "source_kind": "strategy_brief" },
  { "topic": "x_factor", "body": "A big church that wants to feel small. Flat structure, accessible pastors, and a home-like atmosphere over mega-church performance.", "verbatim": true, "source_kind": "strategy_brief" },
  { "topic": "denominational_signal", "body": "non-denominational evangelical", "source_kind": "strategy_brief" },
  { "topic": "branded_term", "body": "Foyer", "verbatim": true, "source_kind": "brand_handoff", "metadata": { "use_not_x_note": "not lobby or atrium" } },
  { "topic": "branded_term", "body": "Worship Center", "verbatim": true, "source_kind": "brand_handoff", "metadata": { "use_not_x_note": "not sanctuary or auditorium" } },
  { "topic": "branded_term", "body": "Welcome Center", "verbatim": true, "source_kind": "brand_handoff", "metadata": { "use_not_x_note": "the desk in the Foyer" } },
  { "topic": "branded_term", "body": "Kids Wing", "verbatim": true, "source_kind": "brand_handoff", "metadata": { "use_not_x_note": "the west end / hallways" } },
  { "topic": "branded_term", "body": "Carport", "verbatim": true, "source_kind": "brand_handoff", "metadata": { "use_not_x_note": "the area in front of main doors" } },
  { "topic": "branded_term", "body": "Immanuel", "verbatim": true, "source_kind": "brand_handoff", "metadata": { "use_not_x_note": "preferred spelling, not Emmanuel" } },
  { "topic": "banned_term", "body": "RCC", "source_kind": "brand_handoff" },
  { "topic": "banned_term", "body": "RC", "source_kind": "brand_handoff" },
  { "topic": "banned_term", "body": "Riverwood Community Chapel", "source_kind": "brand_handoff" },
  { "topic": "voice_rule", "body": "allow_en_dash_for_ranges", "source_kind": "brand_handoff" },
  { "topic": "voice_rule", "body": "phone_format=330.678.7000", "source_kind": "brand_handoff" },
  { "topic": "voice_rule", "body": "url_format=no_www", "source_kind": "brand_handoff" },
  { "topic": "voice_rule", "body": "abbreviate_days_months", "source_kind": "brand_handoff" },
  { "topic": "voice_rule", "body": "drop_zero_minutes", "source_kind": "brand_handoff" },
  { "topic": "voice_rule", "body": "am_pm_at_end_of_range", "source_kind": "brand_handoff" },
  { "topic": "voice_rule", "body": "max_one_exclamation_per_sentence", "source_kind": "brand_handoff" },
  { "topic": "theological_capitalization", "body": "Gospel uppercase for specific book/four Gospels; lowercase general", "source_kind": "brand_handoff" },
  { "topic": "theological_capitalization", "body": "He/Him/His capitalized for Father, Son, Holy Spirit", "source_kind": "brand_handoff" },
  { "topic": "theological_capitalization", "body": "Word capitalized for Jesus or Bible", "source_kind": "brand_handoff" },
  { "topic": "anti_model", "body": "Redemption Chapel", "source_kind": "discovery_questionnaire", "metadata": { "url": "https://redemptionchapel.com", "what_to_avoid": "Nearby church the partner explicitly named as wanting to differentiate from." } },
  { "topic": "anti_model", "body": "Christ Community Chapel", "source_kind": "discovery_questionnaire", "metadata": { "url": "https://ccchapel.com", "what_to_avoid": "Also nearby. Partner noted CCC also uses green; differentiate sufficiently." } }
]
```

**Expected voice card output (the compiler LIFTS these into the JSON shape):**

```json
{
  "tone_descriptors": ["warm", "shepherding", "understated", "multigenerational"],
  "banned_terms": [
    "delve", "tapestry", "unlock", "unleash", "elevate", "beacon", "embark", "resonate", "dynamic", "synergistic", "game-changer", "testament", "in a world where", "at the heart of", "journey of faith",
    "RCC", "RC", "Riverwood Community Chapel",
    "lobby", "atrium", "sanctuary", "auditorium", "Emmanuel"
  ],
  "branded_vocabulary": {
    "Foyer": "not lobby or atrium",
    "Worship Center": "not sanctuary or auditorium",
    "Welcome Center": "the desk in the Foyer",
    "Kids Wing": "the west end / hallways",
    "Carport": "the area in front of main doors",
    "Immanuel": "preferred spelling, not Emmanuel"
  },
  "denominational_filter": "evangelical-non-denominational",
  "mission_statement": "To know Jesus, to be known, and to make Him known.",
  "x_factor": "A big church that wants to feel small. Flat structure, accessible pastors, and a home-like atmosphere over mega-church performance.",
  "persona_snapshots": [
    {
      "label": "The Suburban Family",
      "attributes": "Parents of children newborn through high school. Live in Kent or surrounding Portage County suburbs. Middle to upper-middle class. Likely some prior church background.",
      "needs": ["Kids Wing reads safe/organized", "Pre-registration easy", "Multigenerational community", "Real teaching for adults, not just kids"],
      "scares_off": ["Mega-church vibes", "Disorganized kids ministry", "Theological vagueness", "Implied schedule demands before they've attended"],
      "voice_resonance": "Practical and specific. 'Pre-register on the way and check-in takes 30 seconds. The Kids Wing has its own entrance through the carport.' Warm without being saccharine.",
      "entry_pages": ["/visit", "/kids"],
      "critical_conversion_page": "/kids"
    },
    { "label": "The Kent State Student", "...": "..." },
    { "label": "The Person in a Hard Season", "...": "..." },
    { "label": "The Established Member", "...": "..." }
  ],
  "syntax_rules": {
    "no_em_dash": true,
    "allow_en_dash_for_ranges": true,
    "no_triads": true,
    "you_your_in_body": true,
    "oxford_comma": true,
    "no_we_our_in_body": true,
    "no_filler_intensifiers": true,
    "no_contrastive_constructions": true,
    "phone_format": "330.678.7000",
    "url_format": "no_www",
    "abbreviate_days_months": true,
    "drop_zero_minutes": true,
    "am_pm_at_end_of_range": true,
    "max_one_exclamation_per_sentence": true,
    "theological_capitalization": {
      "Gospel": "uppercase for specific book/four Gospels; lowercase general",
      "He_Him_His": "capitalize for Father, Son, Holy Spirit",
      "Word": "capitalize for Jesus or Bible"
    }
  },
  "example_phrases_good": [
    "To know Jesus, to be known, and to make Him known.",
    "Foyer", "Worship Center", "Welcome Center", "Kids Wing"
  ],
  "example_phrases_bad": [
    "come as you are", "life-changing", "vibrant community", "spiritual journey", "walk with God",
    "delve into", "elevate your faith", "embark on a journey",
    "lobby", "atrium", "sanctuary", "auditorium", "Emmanuel"
  ],
  "anti_models": [
    {
      "name": "Redemption Chapel",
      "url": "https://redemptionchapel.com",
      "what_to_avoid": "Nearby church the partner explicitly named as wanting to differentiate from."
    },
    {
      "name": "Christ Community Chapel",
      "url": "https://ccchapel.com",
      "what_to_avoid": "Also nearby. Partner noted CCC also uses green; differentiate sufficiently."
    }
  ],
  "_confidence_log": {
    "tone_descriptors": "lifted_from_brief",
    "mission_statement": "lifted_from_brief",
    "x_factor": "lifted_from_brief",
    "denominational_filter": "lifted_from_brief",
    "persona_snapshots": "lifted_from_brief",
    "branded_vocabulary": "lifted_from_brand_guide",
    "banned_terms": "lifted_from_global + lifted_from_brand_guide",
    "syntax_rules": "lifted_from_global + lifted_from_brand_guide",
    "example_phrases_good": "lifted_from_brief + lifted_from_brand_guide",
    "example_phrases_bad": "lifted_from_global + lifted_from_brand_guide",
    "anti_models": "lifted_from_discovery"
  },
  "_unfilled_with_reason": {}
}
```

Note how every field traces to a lifted source. Nothing is `inferred` or `guessed`. The compiler did NOT compose, did NOT add detail, did NOT invent. It read atoms and assembled them into shape.

---

## Failure modes the reviewer should flag

The reviewer agent (Haiku pass after this compiler's output) should reject + send-back when:

- A persona contains detail (needs, attributes, scares_off entries) not present in the source `persona` atom's metadata.
- A persona has an invented biographical name (Matt, Lauren, Brian, Amina, Sharon, etc.) instead of a descriptive segment label.
- `persona_snapshots` is empty when persona atoms exist in the input.
- `mission_statement` is empty when a `mission_statement` atom exists.
- `x_factor` is empty when an `x_factor` atom exists.
- `branded_vocabulary` is empty when `branded_term` atoms exist.
- The compiler fell through to discovery raw fields when atoms were present (any `_confidence_log` entry should be `lifted_from_*`; only fall to `lifted_from_discovery` when no atom exists).
- More than 20% of `_confidence_log` entries are `inferred` or `guessed`.
- The output JSON doesn't parse, doesn't match the schema, or is missing required fields.

The reviewer's verdict goes into `pipeline_jobs.reviewer_verdict` with `{score, rerun, type, hint, missing_entities}`. The human gate sees the verdict alongside the voice card.

---

## The system prompt (loaded verbatim into the model)

Everything below this line is what gets passed to the model as the system prompt.

```
You are the Voice Card Compiler for Church Media Squad's autonomous website pipeline.

YOUR JOB
Assemble a structured JSON voice card for one church partner. The voice card is the highest-leverage artifact in the pipeline — every downstream copywriter references it. Get this right and downstream copy stays on-brand. Get it wrong and everything drifts.

YOU ARE A COMPILER, NOT A SYNTHESIZER
The strategy brief carried personas, tone, mission, x-factor, and denominational positioning as authored content. The brand guide carried branded vocabulary, syntax rules, and theological capitalization. The discovery questionnaire carried anti-models. All of these were extracted into content_atoms rows by an upstream step (normalize_intake). Your job is to LIFT those atoms into the voice card JSON shape.

You do NOT re-derive personas from raw discovery fields. You do NOT compose mission from the partner's long-form prose. You do NOT extract tone from brand_personality_scales. The atoms are the inputs; you read them and assemble the JSON output.

THE FOUR HARD RULES

1. LIFT BEFORE GENERATE. Every field traces to a lifted atom or a global default. If an expected atom is absent, leave the field empty and add a _unfilled_with_reason entry. Do not fall through to raw discovery fields unless explicitly instructed (and tag those entries as lifted_from_discovery so the reviewer knows).

2. PERSONAS ARE LIFTED, NOT BUILT. Each persona in the output comes from one atom with topic='persona'. Use the atom's metadata fields verbatim. Do not add needs, scares_off entries, attributes, or any detail beyond what the atom contained. Do not invent biographical names. The persona's label is from atom.metadata.label.

3. BRAND-GUIDE CONTENT IS VERBATIM. Atoms with topic='branded_term' map directly into branded_vocabulary as {atom.body: atom.metadata.use_not_x_note}. No paraphrase. Atoms with topic='voice_rule' overlay onto global syntax rules as overrides.

4. CONFIDENCE IS HONEST. Tag every field in _confidence_log with one of: lifted_from_brief, lifted_from_brand_guide, lifted_from_discovery, lifted_from_global, inferred, guessed. A voice card with guessed tags will be rejected.

INPUTS
You receive:
1. An array of strategic content_atoms rows (filtered to topics: persona, tone_descriptor, tone_block, mission_statement, vision_statement, x_factor, denominational_signal, voice_rule, theological_capitalization, branded_term, banned_term, anti_model, strategic_priority).
2. church_facts rows (cross-reference only).
3. The global writing rules content (for defaults).
4. The raw discovery JSON (last-resort fallback only).

Read atoms first. Atoms with source_kind='strategy_brief' are highest trust.

OUTPUT
Return ONE JSON object matching the schema below. No prose before or after. No markdown fences. Just the JSON.

{
  "tone_descriptors": [string],
  "banned_terms": [string],
  "branded_vocabulary": {string: string},
  "denominational_filter": string,
  "mission_statement": string,
  "x_factor": string,
  "persona_snapshots": [
    {
      "label": string,
      "attributes": string,
      "needs": [string],
      "scares_off": [string],
      "voice_resonance": string,
      "entry_pages": [string],
      "critical_conversion_page": string
    }
  ],
  "syntax_rules": {
    "no_em_dash": boolean,
    "allow_en_dash_for_ranges": boolean,
    "no_triads": boolean,
    "you_your_in_body": boolean,
    "oxford_comma": boolean,
    "no_we_our_in_body": boolean,
    "no_filler_intensifiers": boolean,
    "no_contrastive_constructions": boolean,
    "phone_format": string,
    "url_format": string,
    "abbreviate_days_months": boolean,
    ... (any brand-specific rules from voice_rule atoms)
    "theological_capitalization": {string: string}
  },
  "example_phrases_good": [string],
  "example_phrases_bad": [string],
  "anti_models": [
    { "name": string, "url": string|null, "what_to_avoid": string }
  ],
  "_confidence_log": {
    "<field_name>": "lifted_from_brief" | "lifted_from_brand_guide" | "lifted_from_discovery" | "lifted_from_global" | "inferred" | "guessed",
    ...
  },
  "_unfilled_with_reason": {
    "<field_name>": string,
    ...
  }
}

ASSEMBLY ORDER
1. Defaults: seed banned_terms and syntax_rules from the global writing rules.
2. Brand guide overlay: apply voice_rule and theological_capitalization atoms as overrides on syntax_rules. Add branded_term atoms to branded_vocabulary. Add brand-guide banned_term atoms to banned_terms.
3. Brief lift: read persona, tone_descriptor, tone_block, mission_statement, x_factor, denominational_signal atoms. Lift into corresponding fields.
4. Discovery supplement: lift anti_model atoms into anti_models.
5. Tag confidence: for each non-trivial field, write _confidence_log.
6. Note absences: for each empty field where an atom was expected but missing, write _unfilled_with_reason.

WHAT GOOD LOOKS LIKE
- Every field traces to a lifted atom or global default.
- _confidence_log entries are mostly lifted_from_*.
- _unfilled_with_reason is empty (or contains only fields the brief genuinely didn't cover, explained).
- Persona snapshots match input atoms one-to-one with no added detail.

WHAT BAD LOOKS LIKE (you will be rejected)
- Personas with invented biographical names or detail.
- _confidence_log entries marked guessed when atoms were available.
- Fall-through to discovery raw when atoms existed.
- Empty branded_vocabulary when branded_term atoms exist.
- JSON that doesn't parse or doesn't match the schema.

Return only the JSON. Begin.
```
