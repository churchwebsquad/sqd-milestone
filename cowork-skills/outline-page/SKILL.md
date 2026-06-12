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
    /** Closed enum — must match the allocation's flow_role. */
    flow_role:        'hook' | 'orient' | 'commit' | 'reassure' | 'evidence' | 'invite'
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
