---
name: outline-page
description: |
  ONE call per page. Reads the page's slice from page_allocation_plan +
  canonical-templates.json + the ministry-model outline templates +
  stage_1, picks the right canonical template per section, maps allocated
  atoms/facts to slots, and emits a CoworkPageOutline ready for draft-page
  to write copy into. PRE-COPY — your output names which slot gets which
  atom by reference, but does NOT write prose.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
references:
  - ../canonical-templates.json
  - ../page-outlines-by-ministry-model.md
---

# Outline Page

You design ONE page. The plan-cross-page-allocation skill already
decided what content goes on this page. Your job is the next layer
down: **for each section_intent in the allocation, pick a canonical
template + map the allocated atoms/facts into the template's slots.**

You are NOT picking from raw Brixies. You are picking from
`canonical-templates.json` — the template manifest that hides Brixies
naming + only exposes the slots the cowork pipeline cares about. That
manifest is the source of truth; if a template isn't in it, you
can't use it.

## Your input

```ts
{
  project_id:     string
  page_slug:      string                  // 'plan-a-visit'
  /** This page's slice of page_allocation_plan.allocations[]. */
  allocation:     CoworkPageAllocation    // section_intents[] + page-level metadata
  /** Subset of stage_1 needed for outline decisions:
   *  - ethos_summary (loads into every system prompt)
   *  - personas (so persona-fit checks work)
   *  - voice_anti_exemplars (banned terms / forbidden moves) */
  stage_1_brief:  {
    ethos_summary:        string
    personas:             CoworkStage1['personas']
    voice_anti_exemplars: CoworkStage1['voice_anti_exemplars']
  }
  /** ministry_model dominant_model + secondary_blend. Drives which
   *  outline templates we reach for. */
  ministry_model: CoworkMinistryModel
  /** Loaded from cowork-skills/references/canonical-templates.json.
   *  This IS the closed enum — no other templates exist. */
  canonical_templates: CanonicalTemplateLibrary
  /** Loaded from references/page-outlines-by-ministry-model.md. Maps
   *  (page_type, ministry_model) → suggested section sequences. */
  outline_patterns:    PageOutlinePatternLibrary
  /** Compact atom projection — JUST the atoms allocated to this page.
   *  id + topic + body + verbatim + content_quality. */
  atoms_for_page: Array<{
    id:               string
    topic:            AtomTopic
    body:             string
    verbatim:         boolean
    content_quality:  'clean' | 'noisy' | 'unknown'
  }>
  /** Compact fact projection — JUST the facts allocated to this page. */
  facts_for_page: Array<{
    id:       string
    topic:    string
    data:     Record<string, unknown>
  }>
}
```

## What you produce (CoworkPageOutline)

```ts
{
  page_slug:        string
  page_type:        'home' | 'plan_visit' | 'about' | 'ministry' | 'serve' | 'give' | 'connect' | 'belief' | 'staff' | 'practical' | 'other'
  /** Aggregated promise of the page — what the visitor leaves having
   *  felt/understood. Single sentence. Feeds into critique-page's
   *  section_jobs_addressed check. */
  page_promise:     string

  sections: Array<{
    /** From the allocation's section_intent. Preserve verbatim. */
    section_intent_id: string
    /** Closed enum — must match the allocation's flow_role. Sourced
     *  from FLOW_ROLES in src/types/coworkBundle.ts: 'hook' | 'orient' |
     *  'reassure' | 'inform' | 'deepen' | 'invite' | 'close'. */
    flow_role:        'hook' | 'orient' | 'reassure' | 'inform' | 'deepen' | 'invite' | 'close'
    /** Canonical template KEY from canonical_templates. NEVER a raw
     *  Brixies slug. */
    template_key:     string
    /** Why this template (≤120 chars): what about the section_intent
     *  + the template's shape made this the right pick. */
    template_pick_rationale: string

    /** Per-slot mapping. EVERY required slot of the chosen template
     *  MUST be filled (or have a deferred reason).
     *  Slot names come from canonical_templates[template_key].slots. */
    slot_bindings: Array<{
      slot_name:   string                  // canonical slot key
      /** EXACTLY ONE of these is populated. */
      binding: 
        | { kind: 'atom_ref';   atom_id: string }
        | { kind: 'fact_ref';   fact_id: string }
        | { kind: 'directive';  directive: string }  // ≤200 char: tells draft-page what to write
        | { kind: 'merge_token'; token: string }     // e.g. '{{church_name}}'
        | { kind: 'deferred';   reason: 'awaiting_content_collection' | 'partner_provides' }
      /** Atom-level treatment from the allocation. Preserve. */
      treatment?:  'use_as_is' | 'lift_phrase' | 'compress' | 'expand' | 'reorder'
      /** Optional ≤80-char hint to draft-page. */
      drafter_hint?: string
    }>

    /** What this section needs to accomplish — distilled from the
     *  section_intent. Feeds critique-page's section_jobs_addressed. */
    section_job: string                  // ≤140 chars

    /** Atoms that the allocation routed to this section but you
     *  couldn't fit into the chosen template. Surface to allocation
     *  for re-routing OR strategist for atom demotion. */
    overflow_atoms?: Array<{
      atom_id: string
      reason:  string                    // e.g. 'template has no body slot long enough'
    }>
  }>

  /** Page-level CTAs (not section CTAs). Driven by allocation +
   *  persona_journeys' next-step intent. */
  page_level_cta: {
    primary:   { label: string; target_slug: string }
    secondary?: { label: string; target_slug: string }
  }

  /** Optional notes for draft-page. Keep short. */
  drafter_briefing: {
    voice_anchor_phrases:   string[]      // 2-5 verbatim from stage_1.voice_exemplars to imitate
    avoid_phrases:          string[]      // pulled from stage_1.voice_anti_exemplars + reviewer's mechanical scan list
    persona_lens:           string        // primary persona this page serves + their barrier
  }

  /** Validation findings produced by self-validation pass. */
  report: {
    sections_count:         number
    required_slots_filled:  number
    required_slots_deferred: number
    overflow_atoms_count:   number
    template_picks:         Array<{ section_intent_id: string; template_key: string }>
    notes:                  string[]
  }

  _meta: ArtifactMeta
}
```

## Template-pick discipline

1. **Source of truth: `canonical_templates`.** Never refer to a
   Brixies-specific slug or component name. The canonical key (e.g.
   `'hero_inner'`, `'content_video'`, `'cards_split'`) is what you
   emit. The importer translates downstream.
2. **outline_patterns is a STARTING POINT, not a script.** For each
   page_type × ministry_model pair, the patterns library has 1-3
   suggested section sequences. Use one as a frame, then deviate when
   the allocation demands it. Note deviations in
   `report.notes`.
3. **Required slots are non-negotiable.** If you pick `cards_split` (3
   cards, each requires title + body), but the allocation only has 2
   atoms suitable for cards on this page, pick a DIFFERENT template
   (or surface the gap to drafter via a `directive` binding for the
   3rd card). Never bind a required slot to nothing.
4. **One template per section.** If allocation gives you a section with
   8 atoms and no canonical template holds 8 atoms, the allocation
   was wrong — surface to overflow_atoms + flag in `report.notes`.
   Don't try to chain templates.
5. **flow_role drives template family:**
   - `hook` → `hero_*` family (header, big claim, primary CTA)
   - `orient` → `content_*` family or `cards_*` (informational)
   - `commit` → `cta_*` family or `cards_with_cta_*`
   - `reassure` → `testimonial_*` or `faq_*`
   - `evidence` → `stats_*`, `logo_grid_*`, `cards_with_stat_*`
   - `invite` → `cta_split` / `cta_with_image`

## Slot-binding discipline

For each required slot:

| binding kind | when to use |
|---|---|
| `atom_ref` | An allocated atom whose body fits this slot's shape + max_chars. The atom's `treatment` from the allocation tells draft-page to use_as_is / lift_phrase / compress / etc. |
| `fact_ref` | A fact row (staff name + role for a staff card, service time for a hero stat, address for a card body). Drafter wraps the fact's `data` into the slot's required text. |
| `directive` | No atom/fact fits but the slot needs to exist. Tell drafter what to write in ≤200 chars (e.g. "Write a 60-char accent body about why the visitor should bring their kids, drawing from kids_pastor's email signature line"). |
| `merge_token` | The slot wants a known runtime token: `{{church_name}}`, `{{address}}`, `{{phone}}`, etc. Bind the token, not the value. |
| `deferred` | Slot exists in template, content doesn't exist yet, partner hasn't provided. Strategist sees this and routes back to content collection. Use sparingly — > 10% deferred is a structural smell. |

**Verbatim atoms (`verbatim: true`) MUST be bound `use_as_is`.** The
allocation passes the atom's treatment through; preserve.

## Voice atoms route to voice_anchor, NEVER atom_assignments

Atoms with `topic` in `{voice_rule, voice_sample, tone_descriptor}`
are **stylistic guidance** the drafter IMITATES. They are not slot
content. Putting them in `atom_assignments` drives them into the
draft's `atoms_used` + the verbatim-substring check, which then fails
when the drafter (correctly) imitates style instead of pasting the
rule text into a primary_heading.

**The user message separates these atoms into TWO buckets** —
"Content atoms allocated to this page" and "Voice atoms allocated to
this page" — so the routing decision is structural in your input.
The two lists never overlap. Treat them like two source kinds:
content atoms → `atom_assignments[]`, voice atoms → `voice_anchor`.
A voice_sample atom's body can read like a great hero line; that's
*because* it IS the partner's intentional voice. Don't paste it into
a slot — point at it via `voice_anchor` so the drafter imitates the
move with copy that fits the slot.

**The routing rule:**

- A voice-topic atom appearing in the allocation's `section_intents
  [].sources[]` with `treatment: 'voice_anchor'` is the allocation's
  signal to YOU. It does NOT become an `atom_assignment`.
- Instead, lift the voice-topic atom's body verbatim into the
  section's **`voice_anchor`** field (the per-section string that
  tells draft-page which exemplar to imitate).
- A single section's `voice_anchor` is ONE exemplar phrase. If the
  allocation provides multiple voice atoms for a section, pick the
  one closest to the section_intent's job and put it there; mention
  others (with their atom_ids) in `report.notes`.

**The validator enforces this.** Any `atom_assignments[].atom_id`
whose topic is in `VOICE_TOPICS_NOT_FOR_ASSIGNMENTS` trips the
`voice_atom_in_assignments` check. The pattern is parallel to
`unknown_atom_ref`: a structural rule that ends in a failure list,
not a judgment call.

**When voice-atom removal leaves a slot gap, that gap is an
`unresolved_inputs` entry — never an invention.** If a voice-topic
atom was originally going to fill a required slot and now can't
(because it must route to `voice_anchor` instead), the slot is
genuinely uncovered. Name it in `unresolved_inputs` with the gap and
the section/slot. Do not synthesize a UUID, do not copy from the
voice atom's body, do not borrow an atom_id from another section.
The failure mode is the home-page repair pass: voice atoms got
correctly removed from atom_assignments and the model invented UUIDs
to keep the slot filled. Always: removed voice atom → unresolved_input
naming the slot.

**Worked example.** Allocation gives section 2 these sources:

```json
[
  {"kind": "pillar", "ref": "be43f59d-…", "treatment": "voice_anchor", "topic": "voice_rule"},
  {"kind": "pillar", "ref": "94df26ac-…", "treatment": "lift_verbatim", "topic": "prose_snippet"},
  {"kind": "fact",   "ref": "service_time-fact-…"}
]
```

CORRECT outline output for section 2:
- `voice_anchor`: "Don't write 'walk with God' — write 'walk
  alongside'" (the body of be43f59d, lifted)
- `atom_assignments`: ONE entry for 94df26ac (the prose_snippet) +
  ZERO entries for be43f59d.

INCORRECT outline output (will trip `voice_atom_in_assignments`):
- `atom_assignments` includes `{atom_id: 'be43f59d-…',
  slot_hint: 'primary_heading'}` — voice atom in assignments = fail.

## Verbatim atoms — pick a slot that can hold the body, or surface it

Verbatim atoms (`verbatim: true`) MUST be routed to a slot whose
`max_chars` can hold the body length. The validator checks
`atom.body.length <= slot.max_chars` at outline time and fails
`verbatim_atom_exceeds_slot_cap` on any binding where the verbatim
body wouldn't fit. This regresses a rule the allocation SKILL already
states ("a heading source must be a short, lift-able phrase — flag
if not"): the outline layer is where the rule has to be enforced as
code because outline is where slot-binding happens.

**The decision tree:**

1. Can ANY slot on the chosen archetype hold the verbatim body?
   - YES → assign it there. Don't squeeze it into a slot whose
     max_chars is too small in the hope the drafter can compress —
     verbatim means verbatim, the drafter can't.
2. Can a DIFFERENT archetype on this section's flow_role hold it?
   - YES → switch archetype. The flow_role is the constraint;
     the archetype is the lever.
3. None of the above?
   - Declare in `unresolved_inputs[]` with `what: "verbatim atom
     <id> body (N chars) won't fit any slot on archetype <X> — needs
     a long-heading template variant OR route to body/quote slot
     with a derived short heading", where: "sections[ix] slot
     <slot_name>"`. The strategist sees this and decides between
     adding a template variant + re-firing, OR splitting the verbatim
     into a derived short heading + the full body in a quote slot.

**The home failure of 2026-06-13.** The outline routed Paradox's
verbatim x_factor and a 121-char prose_snippet to `primary_heading`
(max 100). The drafter had no legal way out — verbatim discipline
forbids compression, and the contract didn't yet have a
`deferred_atoms` channel. So the model paraphrased + confessed in
voice_notes. The validator caught the paraphrase. Fixing the assignment
at outline time prevents this whole class of downstream lie.

## Three source kinds, three assignment arrays — route by kind, never cross-route

The allocation routes three kinds of source to each section:
`kind: 'pillar'` (a content_atoms row), `kind: 'fact'` (a church_facts
row), `kind: 'crawl_topic'` (a web_project_topics row). Each section's
output has THREE parallel arrays — one per kind:

| Allocation `source.kind` | Outline array | Field on each item | What it is |
|---|---|---|---|
| `pillar`      | `atom_assignments`         | `atom_id` (UUID) | A normalized content snippet — header, paragraph, quote, statistic. |
| `fact`        | `fact_assignments`         | `fact_id` (UUID) | A structured-data row — staff member, service time, address, ministry block. Drafter weaves the row's `data` into the slot. |
| `crawl_topic` | `crawl_topic_assignments`  | `topic_key` (string) | Existing site content already crawled — passages + items from the partner's current site. Drafter excerpts / rewrites / paraphrases. |

**Each source from the allocation lands in EXACTLY ONE array, based on
its `kind`.** Cross-routing is the failure mode: putting a `fact_id`
into `atom_assignments[].atom_id`, or a `topic_key` into
`fact_assignments[].fact_id`, fails the validator with
`unknown_atom_ref` / `unknown_fact_ref` / `unknown_crawl_topic_ref`
(an id of one kind isn't in the other kind's inventory).

**Treatment vocabularies differ per kind** because what you do to a
source depends on its shape:

| Array | Treatment vocabulary |
|---|---|
| `atom_assignments`        | `use_as_is` / `lift_phrase` / `compress` / `expand` / `reorder` / `omit` (word-level rewrite of an existing phrase) |
| `fact_assignments`        | `card_per_row` (one card per fact row) / `embed_field` (one field of `fact.data` → one slot) / `list_items` (rows → bullet list) / `summarize` / `lift_verbatim` / `weave_into_paragraph` |
| `crawl_topic_assignments` | `excerpt` (verbatim quote from the crawl) / `rewrite` (rewrite in brand voice) / `paraphrase` / `summarize` |

**Section may emit empty arrays for kinds it doesn't consume.** A
hero section with one pillar atom and no facts/crawl topics:
`atom_assignments: [{...}]`, `fact_assignments: []`,
`crawl_topic_assignments: []`. Empty array is fine; missing array
trips schema validation.

**Slot coverage is summed across all three arrays.** A section
archetype that requires slot `items` is COVERED if any of the three
arrays has a `slot_hint` pointing at `items[N].<subfield>` — atom OR
fact OR crawl topic, the slot is filled.

**Worked example.** Allocation gives section 4 (`flow_role: inform`,
archetype `content_featured_a`) these sources:
```json
[
  {"kind": "pillar", "ref": "0d4d9d…", "treatment": "summarize",     "topic": "kids_ministry_pitch"},
  {"kind": "fact",   "ref": "21097c1d-…", "treatment": "card_per_row"},   // ParaTots ministry row
  {"kind": "fact",   "ref": "b6dc9d7d-…", "treatment": "card_per_row"},   // Paradox Kids ministry row
  {"kind": "fact",   "ref": "d9cc0d1b-…", "treatment": "card_per_row"}    // Paradox Youth ministry row
]
```

The `content_featured_a` archetype has slots `eyebrow`, `heading`,
`body`, `items[].item_heading`, `items[].item_body`.

CORRECT outline output for section 4:
- `atom_assignments`: one entry for the pillar `0d4d9d…` with
  `slot_hint: 'body'` and `treatment: 'compress'` (the kids-ministry
  pitch becomes the section body).
- `fact_assignments`: three entries, one per ministry fact:
  `{fact_id: '21097c1d-…', treatment: 'card_per_row', slot_hint: 'items[0].item_heading'}`,
  `{fact_id: 'b6dc9d7d-…', treatment: 'card_per_row', slot_hint: 'items[1].item_heading'}`,
  `{fact_id: 'd9cc0d1b-…', treatment: 'card_per_row', slot_hint: 'items[2].item_heading'}`.
  Drafter will pull the fact's `data.name` field into each item heading
  + lay out the rest.
- `crawl_topic_assignments`: `[]` — no crawl topics for this section.

INCORRECT (this is exactly the home-page failure on 2026-06-11 that
forced this contract: model put fact UUIDs into atom_assignments
because that was the only field with a slot_hint):
- `atom_assignments` includes the three fact UUIDs as `atom_id` values.
  Trips `unknown_atom_ref` — those UUIDs aren't in content_atoms.

## slot_hint format — the literal shape that lands

Every `atom_assignments[].slot_hint` is a string keyed against
`canonical_templates.page_section_templates[<archetype>].cowork_writable_slots`.
Two shapes only:

| Form | When | Literal examples |
|---|---|---|
| `'<slot_name>'` | Top-level scalar slot on the archetype | `'primary_heading'`, `'body'`, `'tagline'`, `'accent_body'` |
| `'<slot_name>[N].<sub_field>'` | One element of an array-shaped slot (`items`, `buttons`, etc.). N is 0-indexed. | `'items[0].item_heading'`, `'items[2].item_body'`, `'buttons[0].label'`, `'buttons[1].url'` |

**The validator strips `[N].<sub_field>` and checks the remaining
top-level slot exists on the archetype.** So `'items[7].item_body'`
validates against the archetype's `items` slot — the `[7]` index is
where draft-page reads from later (it doesn't bind cardinality here;
that's bound by the archetype's `max_items`).

**Concrete walk-through.** Archetype `hero_homepage` declares
`cowork_writable_slots: { tagline, primary_heading, body, buttons }`.
Valid `slot_hint` values for it: `'tagline'`, `'primary_heading'`,
`'body'`, `'buttons[0].label'`, `'buttons[0].url'`,
`'buttons[1].label'`, `'buttons[1].url'`. **Invalid (the validator
will trip `bad_slot_hint`):** `'hero_tagline'` (no such slot),
`'heading'` (no such slot — the slot is `primary_heading`),
`'cta_label'` (wrong vocabulary — buttons live in `buttons[N].label`),
`'tagline.eyebrow'` (tagline is scalar, no sub-field).

The vocabulary is whatever the archetype's `cowork_writable_slots`
dictionary literally names. Never invent slot names; never reuse a
slot name from a different archetype. The canonical-templates manifest
is concatenated into this skill's system prompt — read it.

## Unresolved inputs — the escape hatch when no atom fits

If a required slot has NO allocated atom that fits + no fact + no
merge token + no directive you can write honestly, declare the gap in
`unresolved_inputs[]` and move on. **Never invent content. Never leave
a required slot silently empty.** The validator honors this escape
hatch: a required slot uncovered by `atom_assignments` AND named
clearly in `unresolved_inputs` is accepted (the strategist sees the
gap and decides whether to route back to content collection, lower
the archetype's required-slot count, or accept it).

Format:

```json
"unresolved_inputs": [
  {
    "what":  "no atom fits primary_heading for section 'hero' — allocation gave only descriptive prose, no headline-length phrase",
    "where": "sections[0] (hero, hero_homepage) — slot 'primary_heading'"
  },
  {
    "what":  "no service-time fact for the 'sundays' section's items[0]",
    "where": "sections[2] (sundays, content_image_text_a) — slot 'items[0].item_body'"
  }
]
```

**Both fields required.** `what` names the GAP (what's missing and
why); `where` names the section + archetype + slot the gap is in.
Always include the slot name in `where` — the validator does a
substring match on the slot name to verify the gap is named, not just
hand-waved.

**Use sparingly.** > 1 unresolved per section is a structural smell;
the allocation probably wasn't tight enough. Surface in
`report.notes` if you find yourself declaring 2+ unresolved on the
same section.

## Source-id discipline — never invent

Every `atom_id`, `fact_id`, and `topic_key` in an assignment array
MUST be a verbatim copy of an id from the user message's
corresponding list:

- `atom_assignments[].atom_id` → must be in **"Atoms allocated to
  this page"** (UUIDs).
- `fact_assignments[].fact_id` → must be in **"Facts allocated to
  this page"** (UUIDs).
- `crawl_topic_assignments[].topic_key` → must be in **"Crawl topics
  allocated to this page"** (string keys, not UUIDs).

The validator does an exact-string lookup against the project's
live tables (`content_atoms`, `church_facts`, `web_project_topics`).
A miss in any kind trips its own check (`unknown_atom_ref`,
`unknown_fact_ref`, `unknown_crawl_topic_ref`).

**The rules (apply to all three kinds):**

- Copy each id **character-for-character** from the user message. Do
  not abbreviate. Do not synthesize. Do not generate a UUID that
  "looks right." Do not write `null` or a placeholder.
- If you want to reference content that isn't in the user message's
  three lists, declare the gap in `unresolved_inputs` instead.
- If you find yourself starting to write an id you can't literally
  see in the user message, stop. That's the moment to add an
  `unresolved_inputs` entry, not invent.
- **Don't cross-route an id between arrays.** A fact UUID looks like
  an atom UUID; the only thing distinguishing them is which list it
  appeared in upstream. The allocation's `source.kind` is the
  authoritative routing signal — preserve it. A fact_id placed in
  `atom_assignments[].atom_id` will trip `unknown_atom_ref` because
  fact UUIDs aren't in content_atoms.

**Why this matters at the metric layer:** the validator rejects
each kind's array independently. If you guess, the validator catches
it AND the repair loop has to re-call you to fix it — extra latency,
extra tokens. The first-pass `unknown_atom_ref` / `unknown_fact_ref`
/ `unknown_crawl_topic_ref` counts in `_meta.first_pass_failures.by_check`
are the telemetry. **Target: 0 every fire on all three.**

**Worked example.** User message includes:
```json
// Atoms allocated to this page
[
  {"id": "7c1a82ee-9f33-4b1c-a3fd-1ed2b9c5740a", "topic": "value_statement", ...},
  {"id": "b8e44210-c0d9-4e57-9281-7ad4f0b69e8b", "topic": "ministry",        ...}
]
// Facts allocated to this page
[
  {"id": "21097c1d-c909-457b-9fb3-b89351eb33c6", "topic": "ministry", "data": {...}}
]
// Crawl topics allocated to this page
[
  {"topic_key": "service_times_passage", "passages": [...]}
]
```

Valid:
- `atom_assignments[]`: only `7c1a82ee-…` or `b8e44210-…`.
- `fact_assignments[]`: only `21097c1d-…`.
- `crawl_topic_assignments[]`: only `service_times_passage`.

Invalid (trip the matching `unknown_*_ref` check):
- `atom_assignments[].atom_id = '21097c1d-…'` — that UUID is in the
  facts list, not the atoms list (the home-page bug exactly).
- `fact_assignments[].fact_id = '7c1a82ee-…'` — atom UUID in fact array.
- `crawl_topic_assignments[].topic_key = 'sundays'` — not in the
  crawl topics list.

## Per-page section count

Recommended: 5-10 sections per page. Specific limits:

| page_type | min | max | notes |
|---|---|---|---|
| `home` | 6 | 10 | needs to serve every persona's discover → consider transition |
| `plan_visit` | 5 | 8 | logistics-heavy; one section per logistics block |
| `about` | 4 | 7 | story-heavy; longer-form sections (`content_video`-shaped) |
| `ministry` | 4 | 8 | depends on persona depth |
| `commit-funnel pages` | 3 | 6 | tighter; conversion-oriented |

Outside these ranges = surface in `report.notes`. The allocation may
have over- or under-allocated; outline-page is the layer that catches
that.

## Hard rules

- **Every section_intent from the allocation MUST appear as a section
  in your output OR appear in `overflow_atoms` (with an atom that
  couldn't be placed).** No silent drops.
- **`template_key` MUST exist in canonical_templates.** Validator will
  reject otherwise.
- **Every REQUIRED slot of the chosen template MUST have a binding
  (any kind including `deferred`).** Missing bindings = structural
  error.
- **No slot binds to MORE than one atom/fact.** If you want to
  combine, use a `directive` that references both atom_ids.
- **`drafter_briefing.voice_anchor_phrases` MUST be from
  `stage_1_brief.voice_exemplars`** (which the cowork-director passes
  through compact projection). No invented phrases.
- **`avoid_phrases` MUST be union of
  `stage_1_brief.voice_anti_exemplars[].phrase` + the standard global
  bans (em-dashes, "delve", "tapestry", etc.).** Drafter scans this
  before writing.

## Self-validation before returning

1. Every section_intent from `allocation` → either a `sections[]` entry
   or an `overflow_atoms` entry. Count match.
2. For each section: every required slot in
   `canonical_templates[template_key].slots[required=true]` has a
   binding. Cross-check.
3. Every `atom_ref` / `fact_ref` resolves to an id in
   `atoms_for_page` / `facts_for_page`. No dangling refs.
4. Every verbatim atom (verbatim=true in atoms_for_page) is either
   bound as `atom_ref` with `treatment: 'use_as_is'` OR is in an
   `overflow_atoms` entry. Verbatim atoms cannot be compressed/
   reordered.
5. `report.required_slots_filled + required_slots_deferred` matches
   total required-slot count across all sections.
6. `page_level_cta.primary.target_slug` is a real slug (matches
   site_strategy's pages list — outline-page is downstream of that;
   if you don't have site_strategy as input, fall back to the
   target_slug from allocation's section_intent CTAs).
