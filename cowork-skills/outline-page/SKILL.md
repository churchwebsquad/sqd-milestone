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

## Strategic Goals — inputs you MUST consume

Loaded from `roadmap_state.strategic_goals` (`status='approved'` only):

- **`copy_approach.derived.intended_verbatim_band`** — stamp it on
  every section that has at least one atom_assignment / fact_assignment /
  crawl_topic_assignment with verbatim-shaped content. Must match the
  allocation entry's band. high = ≥70% verbatim; mid ≈ 50%; low ≤ 20%.
  Downstream draft + critique enforce this.

  **DO NOT over-stamp `high` on directive-only sections.** A section
  with NO atom/fact/crawl-topic assignment (pure `directive` bindings
  for a CTA banner, an embed-only block, a sectioned form, etc.)
  CANNOT structurally reach a high verbatim band — there's no source
  body to lift from. Stamp the band that actually matches the
  routed sources, and on sections where no source body is routable
  AT ALL (the partner approved the project at `low` overall but
  some sections like a footer CTA carry no source), set the
  section's `intended_verbatim_band` to the project's approved
  band but DON'T over-claim. The drafter has a sibling escape
  hatch: when it can't hit a band, it stamps
  `band_status: "verbatim_band_unreachable"` + a `band_note`, and
  critique-page treats that as authorized (not as
  `verbatim_band_drift`). Don't paper over the gap at outline-time
  by stamping `high` on a section that has no source — that just
  forces the drafter to fake the ratio.
- **`one_key_message`** — every page outline MUST include at least
  one section whose `voice_anchor` references this message verbatim.
- **`recurring_message_theme`** — informs voice anchor selection
  across all sections; surface in the outline's `voice_notes`.
- **`ministries_to_grow`** — when outlining the homepage (or a page
  related to a named ministry), the ministry gets an early section
  with a clear progression CTA in its `cta` slot assignment.
- **`content_needs`** (AM handoff) — pages listed here need more
  sections than default; respect them.
- **`best_outreach_methods`** — when outlining a page tied to these
  programs, give them a section with prominent CTA placement.
- **`sermons_display_preference`** — only relevant when outlining a
  sermons/watch page. `embed_latest` → use a single
  `embed-latest-sermon` archetype with a small archive link; `archive`
  → use a list/grid archetype that surfaces the full archive.

## Walk the sitemap — do not ask which page

You have the full page list in the attached project bundle at
`sitemap_pages`. Walk it in `nav_order`. Don't prompt the strategist
for the next slug; just look up the next entry in-context.

## Your input — read from the attached project bundle, NOT from MCP

The strategist attached **`cowork-pipeline.<partner>.project-bundle.json`**
to this conversation. **Read EVERYTHING from that file.** Per-page
MCP fan-out (a 68KB RPC + byte-size checks + md5 + ::jsonb casting)
was eating ~20 min/page. The bundle is now the single source of
truth — MCP usage drops to ONE write per page (the `roadmap_state_set`
that persists your outline).

Bundle shape (open the JSON in conversation, treat keys as fields):

```ts
{
  project_id:    string
  generated_at:  string                        // ISO timestamp — flag if older than the project's _meta
  generated_for: 'all'                          // covers outline + draft + critique

  sitemap_pages: Array<{ slug, name, nav_order, nav_strategy, primary_persona }>
  stage_1:        CoworkStage1                  // voice, personas, ethos, key_message, vision_statement, project_goals
  ministry_model: CoworkMinistryModel

  /** Strategist-approved fields only — already filtered to status='approved'. */
  strategic_goals_approved: {
    goals_and_vision?:       Record<string, StrategicGoalField>
    voice_and_tone?:         Record<string, StrategicGoalField>
    content_and_allocation?: Record<string, StrategicGoalField>
    display_and_technical?:  Record<string, StrategicGoalField>
    inspiration_and_notes?:  Record<string, StrategicGoalField>
  }

  /** Closed template enum — slot specs only (no family/variant/
   *  design_handoff_image_count bloat). THIS IS YOUR TEMPLATE ENUM.
   *  Don't invent template_keys not in here; don't bind to
   *  slots outside each template's cowork_writable_slots. */
  canonical_templates: {
    version: string
    page_section_templates: Record<string, { cowork_writable_slots: SlotSpec }>
  }

  /** Handoff notes from prior steps. site_strategy is your direct
   *  upstream (read FIRST — carries the allocation strategist's
   *  decisions and cross-step gotchas). */
  prior_handoff_notes: {
    site_strategy:        string | null
    page_allocation_plan: string | null         // page_allocation_plan._meta.handoff_note
    page_outlines:        string | null         // (consumed by critique, not you)
  }

  /** Page-keyed lookups — for each page in sitemap_pages[].slug,
   *  look up its allocation slice + the build_directives that target it. */
  allocations_by_page:      Record<string, CoworkPageAllocation>
  build_directives_by_page: Record<string, BuildDirective[]>

  /** Shared content pools — load ONCE for the whole session, index
   *  into them when resolving each source's `ref` against your
   *  section_intents. The `by_topic` indexes shim around the live
   *  bug where allocation plans emit topic-based refs (e.g.
   *  kind='fact', ref='service_times') instead of UUIDs — look up
   *  by either form. */
  atoms_pool: {
    by_id:    Record<string, ContentAtomRow>
    by_topic: Record<string, string[]>          // topic → atom ids
  }
  facts_pool: {
    by_id:    Record<string, ChurchFactRow>
    by_topic: Record<string, string[]>          // <-- 'service_times' → [uuid, uuid]
  }
  crawl_topics_pool: {
    by_key: Record<string, {
      topic_label, topic_group, coverage_status,
      passages: (string | { text, ... })[],     // capped: 10 passages × 600 chars
      passages_total: number,
      passages_truncated: boolean,
      items: unknown[]
    }>
  }
}
```

### Source-ref resolution

Each `section_intents[].sources[]` has `{ kind, ref, treatment }`.
Resolve as:

- `kind='pillar'`: look up `atoms_pool.by_id[ref]`. If not found AND
  ref looks like a topic (lowercase_with_underscores), fall back to
  `atoms_pool.by_topic[ref]` and use the first match.
- `kind='fact'`: look up `facts_pool.by_id[ref]`. If not found AND
  ref looks like a topic, fall back to `facts_pool.by_topic[ref]`.
- `kind='crawl_topic'`: look up `crawl_topics_pool.by_key[ref]`.
  Mind `passages_truncated` — if true and the page genuinely needs
  more, that's the ONE valid case to fall back to a direct SELECT
  against `web_project_topics`.
- `kind='content_collection'`: ref is a session field key; the
  bundle doesn't currently inline this — read it via a direct SELECT
  against `strategy_content_collection_sessions` only when needed.
- `kind='external'`: don't lift content; treat the ref as a URL/CTA
  target only.

### When to use MCP

ONE write per page via the **column-free chunked-write pattern**
(see §Persist below — load-bearing). A naked
`SELECT roadmap_state_set(...)` returns the full ~370 KB
roadmap_state on success and blows the MCP output limit; an
inline-VALUES one-statement chunked write outgrows Claude's
output-token cap once outlines push past ~12 KB. Use the
scratchpad pattern: per-chunk UPDATE → assemble + write + IS NOT
NULL → cleanup.

**Do NOT run** `cowork_load_outline_context` or per-row SELECTs
as part of your routine flow — that's exactly the fan-out this
bundle eliminated. The legacy RPC stays in place as a safety net
for the rare "the bundle is missing X" case.

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

### Template selection rubric — STRATEGIST HOUSE RULE (load-bearing)

Pick the template by its **job**, using this map. Left =
strategist's section vocabulary; right = canonical key. The
drafter and the outliner BOTH obey this — if the strategist forces
a swap mid-draft, the swap round-trips to outline-page (re-fire).

| Section job | Canonical key | Notes |
|---|---|---|
| First section of EVERY interior page = a hero | `hero_inner` | Interior pages always open with the inner page hero. |
| The **Visit / I'm New** page hero specifically | `hero_featured` | Visit always uses the featured page hero, not the inner hero. |
| **Messages / Sermons** page hero | `content_video` | The "current series" section IS the Messages hero most of the time. |
| Standard content | `content_image_text_a` / `content_image_text_b` | The default content section = **image left / text right**. Use for prose like a pastor bio (long body is OK here — see §Persistence cap override). |
| Featured content | `content_featured_a` / `content_featured_b` | Sections with a small curated card set + bullet list, e.g. "What to Expect on a Sunday", "For Your Family". `content_featured_a` = 3 cards, `content_featured_b` = featured content + button. |
| Video / playlist | `content_video` | Single video or a playlist. |
| **Card grid (4+ items or dynamic/seasonal)** | `feature_card_carousel_proxy` | Use for ministry grids, next-steps, path choices, link-card rows — anything that reads as a uniform grid of cards. The DEFAULT for card sets > 4 items. Cards have no writable slots on the proxy itself, so AUTHOR them in `build_cards[]` (heading + body + cta label + url per card) and render them in the in-chat copy review. Every card gets its own CTA. **"We're missing the cards" is the drafter rendering a carousel shell without authoring the card content — that's a structural failure.** |
| Tabbed / nested content | `feature_tabbed` | ONLY for genuinely tabbed/nested content (e.g. serve/volunteer opportunities with nested sub-lists). 4 cards max; has `item_meta` slot usable for a per-card CTA label or eyebrow. **NOT a substitute for a card grid.** Drafter was over-routing short card sets here — STOP. |
| Series archive | (filter layout) | The sermon/series archive uses a filter layout, not a static section. |
| Timeline | `timeline_story` | ONLY a history timeline. Never reach for it just because content has steps/dates. **A pastor bio is NOT a timeline.** |
| CTA banner | `cta_simple` / `cta_callout` | A CTA banner is a SHORT, end-of-page call-out ("Got questions?", "Plan a Visit"). Use **once per page, at the end**. `cta_callout` = 1 button; `cta_simple` = primary + secondary. **DO NOT scatter `cta_callout`/`cta_simple` mid-page.** Mid-page content with a button belongs in `content_featured_b` (featured content + button) or a standard content section with a build-directive link. **The pastor bio does NOT belong in `cta_callout` — that's a content container failure mode the drafter has hit twice now.** |
| Quote / written testimony | `testimonial_written` | Quote + attribution. |
| Video testimony | `testimonial_video` | Quote + attribution + embedded video. |
| Staff / leadership | `feature_team` | 2-item layout. SPLIT into siblings when the staff list is larger. |
| Contact / address / map | `contact_section` | When the content has a map embed (`*[Map embed: <iframe…>]*`) or an address block, this template binds it cleanly. |
| FAQ / accordion | `accordion_faq` | ≥3 Q&A pairs. Split when the items exceed the visual rhythm. |

**Fixed-count card capacities (memorize):**

- `content_image_text_a` / `content_image_text_b` — up to 3 plain (non-Card) text blocks.
- `content_featured_a` — 3 cards.
- `feature_tabbed` — 4 cards.
- `feature_unique` / `feature_team` — 2 items.
- `feature_card_carousel_proxy` — N cards (no fixed cap; the layout renders from a listing/CPT).

Pick the FIXED template that matches the real card count;
escalate to `feature_card_carousel_proxy` only when the count
exceeds the largest fixed template (4) OR the set is
dynamic/seasonal. Forcing 8 ministries down to 3 cards drops
content the church gave us.

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

**The decision tree (banked 2026-06-13 strategist decision: long
partner-sacred lines belong in body/quote slots with a derived short
heading — DO NOT add long-heading template variants):**

1. Can the verbatim body fit a `body`, `quote`, or other long-cap
   slot on the chosen archetype? Look beyond `primary_heading` /
   `tagline` — those are SHORT slots by design.
   - YES → assign the verbatim atom there. Set the section's
     `voice_anchor` to a SHORT motif from the same atom's body (a
     2-5 word phrase the drafter can use as the heading). The
     drafter then DERIVES the heading from voice_anchor while keeping
     the full verbatim body in the long slot.
2. Can a DIFFERENT archetype on this section's flow_role hold it
   in a body/quote slot?
   - YES → switch archetype. The flow_role is the constraint;
     the archetype is the lever.
3. None of the above?
   - Declare in `unresolved_inputs[]` with what+where pair. Last
     resort.

**The derived-heading pattern.** When you route a long verbatim atom
to a body slot, the heading slot still needs SOMETHING — that's where
voice_anchor earns its keep. The atom's body might be a full sentence
("Where progressive thinking and Christian tradition meet, neither
one watered down" — 120 chars); the voice_anchor for the section is
a derived phrase ("Progressive thinking, Christian tradition" — 40
chars) the drafter uses as the heading. The full verbatim line still
appears, verbatim, in the body. Partner voice stays intact; cap
constraints stay honored; no template variants needed.

**The home failure of 2026-06-13 + the 2026-06-13 fix.** The outline
routed Paradox's verbatim x_factor and a 121-char prose_snippet to
`primary_heading` (max 100). The drafter had no legal way out. After
the validator + deferred_atoms channel + this decision-tree update:
the outline routes the verbatim atoms to body slots, sets voice_anchor
to derived phrases, and the drafter writes derived headings while
preserving the full verbatim text in body. No deferrals needed; no
template variants needed.

## Four source kinds, four assignment arrays — route by kind, never cross-route

The bundle exposes FOUR kinds of source: `kind: 'pillar'` (a
content_atoms row), `kind: 'fact'` (a church_facts row),
`kind: 'crawl_topic'` (a web_project_topics row), and
`kind: 'partner_added'` (an entry from
`partner_added_inventory[]` — the partner's "Add something we
missed" submissions from content collection). Each section's
output has FOUR parallel arrays — one per kind:

| Source kind     | Outline array              | Field on each item | What it is |
|---|---|---|---|
| `pillar`        | `atom_assignments`         | `atom_id` (UUID) | A normalized content snippet — header, paragraph, quote, statistic. |
| `fact`          | `fact_assignments`         | `fact_id` (UUID) | A structured-data row — staff member, service time, address, ministry block. Drafter weaves the row's `data` into the slot. |
| `crawl_topic`   | `crawl_topic_assignments`  | `topic_key` (string) | Existing site content already crawled — passages + items from the partner's current site. Drafter excerpts / rewrites / paraphrases. |
| `partner_added` | `partner_added_assignments`| `target_path` (string) | Partner-submitted "Add something we missed" entry from content collection. Name + rich description + attachments. **Every entry whose `bucket_key` maps to this page MUST be routed somewhere** — the no-omission contract that Arvada's loss made load-bearing (eight partner ministry entries silently dropped on Arvada's first pass). The drafter walks each routed entry the same way it walks a crawl `program` item. |

**Each source from the bundle lands in EXACTLY ONE array, based on
its kind.** Cross-routing is the failure mode: putting a `fact_id`
into `atom_assignments[].atom_id`, or a `target_path` into
`crawl_topic_assignments[].topic_key`, fails the validator with
`unknown_atom_ref` / `unknown_fact_ref` / `unknown_crawl_topic_ref` /
`unknown_partner_added_ref` (an id of one kind isn't in the other
kind's inventory).

**Bucket → page routing for `partner_added`.** When you outline a
page, scan `bundle.partner_added_inventory[]` for entries whose
`bucket_key` clearly belongs to this page (e.g. `ways_to_give` →
/give; `care` → /care; `kids` → /kids; `global_outreach` →
/local-global or /missions; `community_groups` → /groups). Route
each entry to a section as a `partner_added_assignments` entry.
Entries whose bucket doesn't map to any planned page surface as a
`directive`-type build flag in `report.notes` so the strategist
can decide (add a page, fold into an existing page, drop with
reason).

**Treatment vocabularies differ per kind** because what you do to a
source depends on its shape:

| Array | Treatment vocabulary |
|---|---|
| `atom_assignments`         | `use_as_is` / `lift_phrase` / `compress` / `expand` / `reorder` / `omit` (word-level rewrite of an existing phrase) |
| `fact_assignments`         | `card_per_row` (one card per fact row) / `embed_field` (one field of `fact.data` → one slot) / `list_items` (rows → bullet list) / `summarize` / `lift_verbatim` / `weave_into_paragraph` |
| `crawl_topic_assignments`  | `excerpt` (verbatim quote from the crawl) / `rewrite` (rewrite in brand voice) / `paraphrase` / `summarize` |
| `partner_added_assignments`| `card_per_entry` (one card per partner entry) / `embed_in_section` (entry's body content lives inside a larger section) / `list_item` (entry surfaces as one row in a bullet/card list). Partner-supplied text is rich (often pasted HTML); preserve verbatim where possible. |

**Section may emit empty arrays for kinds it doesn't consume.** A
hero section with one pillar atom and no facts/crawl topics/partner
adds: `atom_assignments: [{...}]`, `fact_assignments: []`,
`crawl_topic_assignments: []`, `partner_added_assignments: []`.
Empty array is fine; missing array trips schema validation.

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

## Built-in verification — run BEFORE handing the outline to the strategist

Run these checks against your own output, fix anything that fails,
re-run the audit, THEN ask the strategist to review. Report results
as a table.

1. **Allocation coverage**: every `section_intent` from the allocation
   page entry → either a `sections[]` entry or an `overflow_atoms`
   entry. Count match.
2. **Slot bindings**: for each section, every required slot in
   `canonical_templates[template_key].slots[required=true]` has a
   binding. List any unfilled.
3. **Ref resolution**: every `atom_ref` / `fact_ref` / `crawl_topic_key`
   resolves to a real id in `atoms_for_page` / `facts_for_page` /
   `crawl_topics_for_page`. No dangling refs.
4. **Verbatim discipline**: every \`verbatim: true\` atom is bound as
   `atom_ref` with `treatment: 'use_as_is'` OR placed in
   `overflow_atoms` with a structured reason. Never compressed.
5. **Verbatim band stamped**: every entry in `sections[]` carries
   `intended_verbatim_band` matching the parent allocation's band.
6. **Voice anchor present**: at least one section per outline carries
   a `voice_anchor` pointing at a `stage_1.voice_exemplars` phrase.
   When `strategic_goals.voice_and_tone.one_key_message` is approved,
   at least one section's voice anchors against it.
7. **CTA target valid**: `page_level_cta.primary.target_slug` is a
   real slug in `site_strategy.pages[].slug` (or in allocation's
   section_intent CTAs as a fallback).

## Review format

Walk the strategist through the outline **per section** — a scannable
layout (section archetype → voice anchor → sources bound to slots,
with treatment + verbatim band). **Not raw JSON.** Keep JSON as the
persisted artifact only. Pause for push-back before persisting.

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

## Persist — column-free chunked write (load-bearing — read carefully)

Avoid two distinct failure modes every time:

**(A) Output-limit failure** — `SELECT roadmap_state_set(...)`
returns the FULL roadmap_state on success (~370 KB). Selecting
that blows the Supabase MCP output limit. **Every
`roadmap_state_set` call MUST be wrapped in `IS NOT NULL`** so the
row returns just a boolean.

**(B) Input-size failure** — emitting a single execute_sql with
all chunks inline as `VALUES` exceeds Claude's output-token cap
(~8k tokens, ~32 KB SQL). The session improvises ad-hoc temp
tables, and one mid-stream socket disconnect leaves state
partial. Avoid by keeping every individual statement small.

**The reliable shape — every individual statement < 8 KB SQL.**

### Step 1 — clear any prior scratch for this page (idempotent)

```sql
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_outlines,<slug>}'
WHERE id = '<project_id>'::uuid;
```

### Step 2 — for EACH chunk i in 0..N-1, one tiny call

Base64-encode the outline JSON locally (only `[A-Za-z0-9+/=]`).
Split into chunks ≤6 KB each. Stage:

```sql
UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  COALESCE(roadmap_state, '{}'::jsonb),
  ARRAY['_chunks','page_outlines','<slug>','<INDEX>'],
  to_jsonb('<BASE64-CHUNK-TEXT>'::text)
)
WHERE id = '<project_id>'::uuid;
```

Each call: tiny, idempotent, returns no rows. Inspect staged
chunks (without pulling payload):

```sql
SELECT jsonb_object_keys(roadmap_state -> '_chunks' -> 'page_outlines' -> '<slug>')
FROM strategy_web_projects
WHERE id = '<project_id>'::uuid;
```

### Step 3 — assemble + verify + write + return BOOLEAN

```sql
WITH chunks AS (
  SELECT (e.key)::int AS ix, e.value AS b64
  FROM strategy_web_projects p,
       jsonb_each_text(p.roadmap_state -> '_chunks' -> 'page_outlines' -> '<slug>') AS e
  WHERE p.id = '<project_id>'::uuid
),
body_cte AS (
  SELECT convert_from(decode(string_agg(b64, '' ORDER BY ix), 'base64'), 'UTF8') AS body
  FROM chunks
)
SELECT
  CASE WHEN md5(body) = '<LOCAL-MD5>'
    THEN (roadmap_state_set('<project_id>'::uuid, ARRAY['page_outlines','<slug>'], body::jsonb) IS NOT NULL)
    ELSE false
  END AS ok
FROM body_cte;
```

Result `false` → some chunk mis-staged. Re-emit that chunk via
Step 2 and re-run Step 3. Never silently proceed.

### Step 4 — clear scratch for this page

```sql
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_outlines,<slug>}'
WHERE id = '<project_id>'::uuid;
```

For pages whose outline payload is small (under ~12 KB raw JSON
— rare for outlines but possible on a thin landing page), it's
ok to skip the chunk stage and go straight to a single
`roadmap_state_set(...) IS NOT NULL` call with the full JSON
inline. But the scratchpad path is always safe and is the
default.

## Handoff Note — required final substep

Before declaring this step done, emit a HANDOFF NOTE — a ≤1-screen
markdown summary — and persist it to
`roadmap_state.<output_key>._meta.handoff_note`. Also surface the
note as a paste-ready block in the conversation so the strategist
can copy it directly.

Cover all four buckets, in this order:

**(a) What was written and where.** Top-level outputs + the JSONB
paths they landed at. Counts of array fields. Don't recite the whole
artifact — the strategist has it; this is the orientation, not the
artifact.

**(b) Open / deferred issues.** Validator gaps you couldn't fix
(reason + the field they're on), input ambiguities the strategist
should know about, vocab drift, decisions you flagged for an
upstream step rather than resolved here. If the validator returned
clean, say so explicitly.

**(c) Cross-step gotchas.** What a fresh next-step session must
honor that ISN'T obvious from the persisted artifact: banned
vocabulary, per-page exceptions, display preferences from
strategic_goals, persona postures, edge-case routing decisions.

**(d) What the next step should read + decisions already
litigated.** Specific `roadmap_state` paths to load first. Decisions
that have been settled in conversation so they don't get
re-litigated (e.g., "Don't re-debate whether to keep the legacy
/baptism slug — the strategist confirmed it merges into
/take-your-first-steps").

Because each step's artifact is large, the default workflow is to
run the next step in a fresh cowork session. The persisted plan /
outline / draft is the source of truth — the handoff note exists so
a clean session resumes without reconstructing context.

Keep the note tight: aim for 250-400 words. If you need more, the
artifact itself is the canonical record; the note is the cliff notes.
