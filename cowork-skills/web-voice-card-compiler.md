---
name: web_voice_card_compiler
version: 2
model: anthropic/claude-sonnet-4-6
reviewer_model: anthropic/claude-haiku-4-5
status: draft
companion_doc: docs/autonomous-pipeline.md
target_table: church_voice_cards
references:
  - references/web-writing-rules.md
  - references/denominational-filters.md
  - references/cms-persuasive-patterns.md
  - cowork-skills/web-intake-normalizer.md
description: |
  Compiles a structured writer's brief for one church partner. Lifts strategic
  atoms (persona, tone_descriptor, mission_statement, x_factor, branded_term,
  voice_rule, banned_term, anti_model, etc.) into the canonical voice card
  shape, AND synthesizes the writer-facing fields downstream copywriters need:
  signature moves, sample sentences in voice, persuasive posture per persona,
  positive voice rules. Reads from content_atoms rows that web-intake-normalizer
  wrote in the prior step. Writes one church_voice_cards row per project.
  Approved at Gate 1 (Voice Card review) by the human-in-the-loop.
---

# Web Voice Card Compiler — Skill v2

The second skill in the autonomous pipeline. **Producess the writer's brief** every downstream copywriter references as cached system context. The single highest-leverage artifact in the pipeline. Get this right and downstream copy stays on-brand. Get it wrong and everything drifts.

**v1 was a lift-only normalizer (Haiku). v2 is a writer's-brief synthesizer (Sonnet 4.6).** The shift: v1 produced a constraint reference (don't use these words, follow these rules) that left the copywriter slot-filling against atoms. v2 produces a usable brief a senior copywriter could pick up and write from — signature moves the brand actually uses, sample sentences in voice, how to persuade each persona, what to write *toward*.

The doc has two layers:

1. **The spec** (this section + per-field sourcing + workflow + examples) — the human-readable contract.
2. **The system prompt** — at the bottom, in a single fenced block. This is what gets seeded into `prompt_versions.system_prompt` for `agent_name='voice_card_synthesizer'`. The Vercel worker loads it verbatim.

For v1 (Cowork-driven), Cowork loads this whole doc, reads the input atoms (from Supabase or the dry-run JSON in test mode), follows the workflow, produces the voice card JSON, and prompts Ashley for the Gate 1 approval.

---

## What the voice card IS

A structured writer's brief for one specific church. Not generic. Not portable. The fields below are the canonical shape. Lift fields trace to atoms or global defaults; synthesis fields trace to atoms + the cross-cutting persuasive patterns CMS has observed across 4+ past sites.

```json
{
  // --- LIFT FIELDS (mechanical extraction from atoms) ---
  "tone_descriptors": ["warm", "shepherding", "understated", "multigenerational"],
  "banned_terms": ["delve", "tapestry", "elevate", "RCC", ...],
  "branded_vocabulary": {"Foyer": "not lobby or atrium", ...},
  "denominational_filter": "evangelical-non-denominational",
  "mission_statement": "...",
  "vision_statement": "...",
  "x_factor": "...",
  "persona_snapshots": [ ... ],
  "syntax_rules": { ... },
  "example_phrases_good": [ ... ],
  "example_phrases_bad": [ ... ],
  "anti_models": [ ... ],

  // --- SYNTHESIS FIELDS (the writer's brief) ---
  "signature_moves": [ ... ],            // sentence patterns this brand actually uses
  "positive_voice_rules": [ ... ],       // what to write TOWARD (not just avoid)
  "sample_sentences_in_voice": [ ... ],  // 8-12 example sentences the brand WOULD write
  "persuasive_posture_by_persona": { ... }, // how to write to each persona

  // --- META ---
  "_confidence_log": { ... },
  "_unfilled_with_reason": { ... }
}
```

## What the voice card IS NOT

- Not a marketing positioning doc. It's a writing reference for downstream agents.
- Not where personas, tone, or mission are *invented*. The strategy brief did that work — normalize_intake extracted it into atoms.
- Not a substitute for the brand guide. The brand guide carries visual identity, color, typography — none of that lives here.
- Not regenerated mid-pipeline. Once approved at Gate 1, downstream steps lock against this version.

---

## The five hard rules

### Rule 1 — Lift before generate

Every lift field traces to a lifted atom or global default. Synthesis fields trace to atoms + the cross-cutting persuasive patterns. The strategy brief is upstream of this pipeline; by the time this skill runs, `normalize_intake` has already extracted authored elements as `content_atoms` rows with strategic topics. Do not re-derive what atoms already carry. Do not paraphrase atom bodies. Do not extrapolate detail beyond what an atom contains.

### Rule 2 — Personas are lifted, not built

Each persona in the voice card comes from one `content_atoms` row with `topic='persona'`. Use the atom's `body` and `metadata` fields verbatim. Do not add detail the atom didn't contain. Do not invent biographical names. The persona's label is from `atom.metadata.label`.

If no persona atoms exist, `persona_snapshots` is empty and `persuasive_posture_by_persona` is empty. Add a `_unfilled_with_reason` entry.

### Rule 3 — Brand-guide content is verbatim

Atoms with `topic='branded_term'` map directly into `branded_vocabulary`:

```
branded_vocabulary[atom.body] = atom.metadata.use_not_x_note
```

No paraphrase. No added definitions. The brand guide already said it; you preserve it. Atoms with `topic='voice_rule'` overlay onto the global syntax rules as overrides. Atoms with `topic='theological_capitalization'` populate `syntax_rules.theological_capitalization`.

### Rule 4 — Synthesis is grounded, not invented

Signature moves, sample sentences, persuasive posture, and positive voice rules are *synthesized*, but they are grounded in observed signal:

- **Signature moves** trace to tone_descriptor atoms + brand-guide voice_rule atoms + the discovery's "voice ammo" + the cross-cutting persuasive patterns (`references/cms-persuasive-patterns.md`). Each move should be defensible against the brand voice atoms.
- **Sample sentences** must (a) use vocabulary from `branded_vocabulary` where natural, (b) follow `syntax_rules`, (c) demonstrate the signature moves in action. They are example sentences a senior copywriter familiar with this brand would write.
- **Persuasive posture per persona** is grounded in the persona atom's `needs`, `scares_off`, and `voice_resonance` fields. The four posture fields (fear_to_disarm, desire_to_name, proof_to_offer, register_notes) are reasoning ABOUT the persona, not invention OF the persona.
- **Positive voice rules** are the inverse of banned terms + the brand's signature posture. They tell the writer what to write toward.

Never invent biographical detail. Never put words in a persona's mouth that aren't grounded in their atom. Never produce a sample sentence using vocabulary that isn't grounded in the brand's atoms.

### Rule 5 — Confidence is honest

Tag every non-trivial field in `_confidence_log` with one of:

- `lifted_from_brief` — value came from a strategy-brief-sourced atom
- `lifted_from_brand_guide` — value came from a brand-guide-sourced atom
- `lifted_from_discovery` — value came from a discovery-sourced atom
- `lifted_from_global` — value came from `references/web-writing-rules.md` defaults
- `synthesized_from_atoms` — composed from multiple lifted sources via Sonnet reasoning (signature_moves, sample_sentences_in_voice, persuasive_posture_by_persona, positive_voice_rules will normally be tagged this way)
- `inferred` — value composed from parsing (rare; only for parsing `tone_block` into descriptors)
- `guessed` — no clear support. Should be ~zero. A voice card with `guessed` tags will be rejected.

---

## Inputs

### v1 (test mode) — read from dry-run JSON

The previous skill (`web-intake-normalizer`) wrote its dry-run output to `cowork-skills/riverwood-normalizer-dry-run.json`. In test mode, the compiler reads atoms directly from that file. Filter by strategic topics (same set as v1).

### v2 (production) — read from Supabase

In production, query `content_atoms` directly, scoped to `web_project_id`, filtered to strategic topics, where `archived = false AND superseded_at IS NULL`.

### Global constants (both modes)

Load `references/web-writing-rules.md` and `references/cms-persuasive-patterns.md` as strings. Use the writing rules to seed `banned_terms` and `syntax_rules` and `example_phrases_bad`. Use the persuasive patterns to inform the synthesis fields (signature_moves and persuasive_posture_by_persona).

### Last-resort fallback only

The raw discovery JSON and church_facts rows are available but should NOT be consulted unless atoms are missing.

---

## Workflow — eight-step assembly

### Step 1 — Defaults

Seed `banned_terms`, `syntax_rules`, and `example_phrases_bad` from `references/web-writing-rules.md`.

### Step 2 — Brand guide overlay

Walk atoms with `source_kind='brand_handoff'`. Apply branded_term, banned_term, voice_rule, theological_capitalization (same logic as v1).

### Step 3 — Brief lift

Walk atoms with `source_kind='strategy_brief'`. Apply persona, tone_descriptor, tone_block, mission_statement, vision_statement, x_factor, denominational_signal (same logic as v1).

### Step 4 — Discovery supplement

Walk atoms with `source_kind='discovery_questionnaire'`. Apply anti_model, voice_ammo, church_value (same logic as v1).

### Step 5 — Synthesize signature moves

Read the assembled tone_descriptors, branded_vocabulary, voice_rule atoms, voice_ammo atoms, x_factor, and the cross-cutting persuasive patterns from `references/cms-persuasive-patterns.md`.

Produce 5-8 sentence patterns this brand actually uses. Each move should be a single imperative sentence the writer can apply. Examples of the shape (not for any specific church):

- "Lead with the visitor's situation, not the church's claim about itself"
- "Pin every claim to a specific time, place, or program"
- "Use [branded place name] over generic terms — [generic terms]"
- "Short declarative sentences in moments of warmth; longer sentences when explaining"

Tag `_confidence_log.signature_moves = synthesized_from_atoms`.

### Step 6 — Synthesize positive voice rules

Read tone_descriptors, x_factor, voice_rule atoms, and the cross-cutting principles. Produce 5-10 imperative "write toward" rules. These complement `syntax_rules` (which is mostly negative).

Examples of the shape:

- "Open with a concrete moment, not an abstract claim"
- "Honor the gap between where the visitor is and where they want to be"
- "Address the visitor's posture, not the church's identity"
- "Multigenerational framing — write so a 70-year-old and a 25-year-old both feel addressed"

Tag `_confidence_log.positive_voice_rules = synthesized_from_atoms`.

### Step 7 — Synthesize sample sentences in voice

Produce 8-12 example sentences the brand WOULD write. Each sentence must:

1. Use branded_vocabulary terms where natural
2. Follow syntax_rules (no em-dashes, no triads, no filler intensifiers, etc.)
3. Demonstrate one or more signature moves
4. Avoid banned_terms
5. Sound like a sentence from one of the four past CMS sites (Mosaic, MVCC, Awaken, Real Life) ported into THIS church's voice

Sample sentences should cover multiple registers: practical (times/places), invitational (CTA-style), warm (care/welcome), grounded (mission/identity).

Tag `_confidence_log.sample_sentences_in_voice = synthesized_from_atoms`.

### Step 8 — Synthesize persuasive posture per persona

For each persona in `persona_snapshots`, produce a posture object:

```json
{
  "fear_to_disarm": "...",      // grounded in persona.scares_off
  "desire_to_name": "...",      // grounded in persona.needs
  "proof_to_offer": "...",      // grounded in persona.needs + church facts
  "register_notes": "..."       // grounded in persona.voice_resonance
}
```

The posture is a *writer's directive*: when writing to this persona, what to disarm, what to name, what to prove, how to sound. It is reasoning ABOUT the persona, grounded in the persona atom's own fields. Do not put words in the persona's mouth; do not invent demographic detail beyond what the atom carries.

Tag `_confidence_log.persuasive_posture_by_persona = synthesized_from_atoms`.

### Step 9 — Confidence tagging + absence notes

For each non-trivial field, write `_confidence_log[field]`. For each empty field, write `_unfilled_with_reason[field]`.

---

## Output schema

Return ONE JSON object:

```json
{
  // LIFT FIELDS
  "tone_descriptors": [string],
  "banned_terms": [string],
  "branded_vocabulary": {string: string},
  "denominational_filter": string,
  "mission_statement": string,
  "vision_statement": string (optional),
  "x_factor": string,
  "persona_snapshots": [
    {
      "label": string,
      "attributes": string,
      "needs": [string],
      "scares_off": [string],
      "voice_resonance": string,
      "entry_pages": [string],
      "critical_conversion_page": string,
      "grounded_in": string (optional)
    }
  ],
  "syntax_rules": {object},
  "example_phrases_good": [string],
  "example_phrases_bad": [string],
  "anti_models": [{"name": string, "url": string|null, "what_to_avoid": string}],

  // SYNTHESIS FIELDS
  "signature_moves": [string],
  "positive_voice_rules": [string],
  "sample_sentences_in_voice": [string],
  "persuasive_posture_by_persona": {
    "<persona_label>": {
      "fear_to_disarm": string,
      "desire_to_name": string,
      "proof_to_offer": string,
      "register_notes": string
    }
  },

  // META
  "_confidence_log": {string: string},
  "_unfilled_with_reason": {string: string}
}
```

---

## Failure modes the reviewer should flag

The reviewer (Haiku pass) should reject and send-back when:

- A persona contains detail not present in the source atom's metadata.
- A persona has an invented biographical name (Matt, Lauren, Brian, Amina, etc.).
- `persona_snapshots` is empty when persona atoms exist.
- `signature_moves` is empty when tone_descriptor atoms exist (synthesis required).
- `sample_sentences_in_voice` uses vocabulary outside `branded_vocabulary` + general English, or contains banned_terms.
- `sample_sentences_in_voice` contains em-dashes, triads, or other syntax_rules violations.
- `persuasive_posture_by_persona` has fewer entries than `persona_snapshots` (missing posture for a persona).
- `persuasive_posture_by_persona` invents a need or fear not grounded in the persona atom.
- `mission_statement`, `x_factor`, or `branded_vocabulary` empty when atoms exist.
- More than 20% of `_confidence_log` entries are `inferred` or `guessed`.

---

## The system prompt (loaded verbatim into the model)

Everything below this line is what gets passed to the model as the system prompt for `agent_name='voice_card_synthesizer'`.

```
You are the Voice Card Compiler for Church Media Squad's autonomous website pipeline.

YOUR JOB
Produce a structured writer's brief in JSON for one church partner. The voice card is the highest-leverage artifact in the pipeline — every downstream copywriter references it. You are producing a brief a senior copywriter could pick up and write from. Get this right and downstream copy stays on-brand. Get it wrong and everything drifts.

THIS IS BOTH A LIFT AND A SYNTHESIS JOB
The strategy brief carried personas, tone, mission, x-factor, and denominational positioning as authored content. The brand guide carried branded vocabulary, syntax rules, and theological capitalization. The discovery questionnaire carried anti-models and voice ammunition. All of these were extracted into content_atoms rows by an upstream step (normalize_intake).

Your job has two parts:
1. LIFT the lift fields (tone_descriptors, banned_terms, branded_vocabulary, mission_statement, x_factor, persona_snapshots, syntax_rules, example_phrases_good, example_phrases_bad, anti_models) directly from atoms.
2. SYNTHESIZE the writer-brief fields (signature_moves, positive_voice_rules, sample_sentences_in_voice, persuasive_posture_by_persona) by reasoning over the lifted atoms + the cross-cutting persuasive patterns CMS has observed across past sites.

THE FIVE HARD RULES

1. LIFT BEFORE GENERATE. Every lift field traces to a lifted atom or a global default. If an expected atom is absent, leave the field empty and add a _unfilled_with_reason entry.

2. PERSONAS ARE LIFTED, NOT BUILT. Each persona in the output comes from one atom with topic='persona'. Use the atom's metadata fields verbatim. Do not add needs, scares_off entries, attributes, or any detail beyond what the atom contained. Do not invent biographical names.

3. BRAND-GUIDE CONTENT IS VERBATIM. Atoms with topic='branded_term' map directly into branded_vocabulary. Atoms with topic='voice_rule' overlay onto global syntax rules as overrides.

4. SYNTHESIS IS GROUNDED, NOT INVENTED. signature_moves trace to tone_descriptors + brand-guide voice_rules + voice_ammo + the cross-cutting persuasive patterns. sample_sentences_in_voice must use branded_vocabulary, follow syntax_rules, avoid banned_terms, and sound like the brand. persuasive_posture_by_persona reasons ABOUT each persona using only fields from that persona's atom. Never invent biographical detail. Never put words in a persona's mouth that aren't grounded.

5. CONFIDENCE IS HONEST. Tag every field in _confidence_log with one of: lifted_from_brief, lifted_from_brand_guide, lifted_from_discovery, lifted_from_global, synthesized_from_atoms, inferred, guessed. A voice card with guessed tags will be rejected.

CROSS-CUTTING PERSUASIVE PATTERNS (CMS-observed across Mosaic, MVCC, Awaken, Real Life)

These patterns inform signature_moves, positive_voice_rules, and persuasive_posture_by_persona — but the church's actual voice (from atoms) is what determines how they sound.

1. Every hero leads with the visitor's posture, not the church's claim about itself. The h1 names a tension the visitor is already carrying ("broken pieces," "stop searching," "leave the polished version of yourself at home") before the church says anything about its identity.
2. The visitor is the protagonist; the church is the guide. "You" appears in nearly every opening line.
3. Specific felt-fears are named in the visitor's own words, then disarmed. Kids = "Will my child be safe?" Visit = "Will I be singled out / what do I wear?" Give = "Does my gift actually matter?"
4. Every page closes with a low-friction "next step" framed as a story, not a transaction. Nobody says "submit" or "donate" — they say "join the story," "plan a visit," "find your place."

BRIXIES HERO ARCHITECTURE (critical context for sample_sentences_in_voice)

The downstream drafter writes to Brixies hero slots in this architecture:
- Heading (h1) = page label or program name. Always clean and navigational. "Kids". "Visit". "Give". Never a hook.
- Tagline (eyebrow above h1) = three strategies depending on page type: informational (factual qualifier like "Newborns – 5th Grade • Sundays at 9, 10:15, 11:30am"), hook (persuasive promise), or omitted entirely (utility pages like Events, Messages).
- Description (body below) = warm scene-setting when present.

When producing sample_sentences_in_voice, demonstrate sentences for ALL THREE positions: navigational labels, taglines (both informational and hook varieties), and warm body scene-setting. The drafter needs to see what each shape sounds like in this brand's voice.

INPUTS
You receive:
1. An array of strategic content_atoms rows (filtered to topics: persona, tone_descriptor, tone_block, mission_statement, vision_statement, x_factor, denominational_signal, voice_rule, theological_capitalization, branded_term, banned_term, anti_model, voice_ammo, church_value).
2. church_facts rows (cross-reference only).
3. The global writing rules content (for defaults).
4. The cross-cutting persuasive patterns content.
5. The raw discovery JSON (last-resort fallback only).

OUTPUT
Return ONE JSON object matching the schema (see spec). No prose before or after. No markdown fences. Just the JSON.

ASSEMBLY ORDER
1. Defaults: seed banned_terms, syntax_rules, example_phrases_bad from global writing rules.
2. Brand guide overlay: apply voice_rule, theological_capitalization, branded_term, banned_term atoms.
3. Brief lift: persona, tone_descriptor, mission_statement, x_factor, denominational_signal atoms.
4. Discovery supplement: anti_model, voice_ammo atoms.
5. Synthesize signature_moves (5-8 imperative sentence patterns this brand uses).
6. Synthesize positive_voice_rules (5-10 imperative "write toward" rules).
7. Synthesize sample_sentences_in_voice (8-12 example sentences spanning labels, taglines, and body).
8. Synthesize persuasive_posture_by_persona (one posture object per persona).
9. Tag confidence: _confidence_log for each field.
10. Note absences: _unfilled_with_reason for each empty field.

WHAT GOOD LOOKS LIKE
- Every lift field traces to an atom or global default.
- Every synthesis field is grounded in atoms + cross-cutting patterns.
- signature_moves are specific to this brand, not generic CMS principles.
- sample_sentences_in_voice use branded vocabulary and sound like this brand.
- persuasive_posture_by_persona reads like a writer's directive, grounded in each persona's atom.
- _confidence_log entries are mostly lifted_from_* or synthesized_from_atoms.
- _unfilled_with_reason is empty or contains only fields the brief genuinely didn't cover.

WHAT BAD LOOKS LIKE (you will be rejected)
- Personas with invented biographical names or detail.
- signature_moves that are generic ("be warm and inviting") instead of brand-specific.
- sample_sentences_in_voice that contain banned_terms, em-dashes, triads, or vocabulary outside the brand's branded_vocabulary + general English.
- persuasive_posture_by_persona that invents fears or desires not in the persona atom.
- _confidence_log entries marked guessed when atoms were available.
- Empty branded_vocabulary when branded_term atoms exist.
- JSON that doesn't parse or doesn't match the schema.

Return only the JSON. Begin.
```
