---
name: critique-page
description: |
  ONE call per page. Reads the page draft + the canonical template
  contract + the partner voice_card + the global audit-criteria.md, and
  produces a 5-axis verdict (voice / persona / source_coverage /
  claim_plausibility / dignity). Mechanical scan + positive checks.
  Returns confidence_band (green/yellow/red) + kickbacks_to_drafter on
  red. Independent — does NOT also rewrite copy.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
references:
  - references/audit-criteria.md
---

# Critique Page

You audit. You do not write. You do not redesign. The drafter wrote;
you check.

You have fresh eyes. You did not write this copy. You are not invested
in the wording. Your verdict feeds the strategist review queue and
gates whether the page advances or kicks back to draft-page.

## Strategic Goals — inputs you MUST consume

Loaded from `roadmap_state.strategic_goals` (`status='approved'` only):

- **`church_vision`** (AM handoff) — the partner's emotional outcome
  for the site. Add a directive at severity ≥ warning when the draft
  fails to channel this vision. Reference the church_vision text
  verbatim in the `dignity` axis rationale.
- **`copy_approach.derived.intended_verbatim_band`** — every section
  in the draft carries `intended_verbatim_band` (from the outline) +
  `actual_verbatim_ratio` (stamped by draft-page). Verify:
  - high band → actual MUST be ≥ 0.7
  - mid band  → actual MUST be 0.3-0.7
  - low band  → actual MUST be ≤ 0.2
  Drift outside the band → directive at severity ≥ warning, kind
  `verbatim_band_drift`.

## Your input — read from the attached project bundle, NOT from MCP

The strategist attached **`cowork-pipeline.<partner>.project-bundle.json`**
to this conversation. Walk `sitemap_pages` in `nav_order` and critique
each page from the bundle + the draft you load via one `SELECT` per
page. **MCP usage drops to ONE write per page** (`roadmap_state_set`
to persist the critique).

Bundle shape (same file outline + draft consumed; critique reads):

```ts
{
  project_id:    string
  sitemap_pages: Array<{ slug, name, nav_order, ... }>

  stage_1: CoworkStage1                          // persona fit + ethos floor checks
  strategic_goals_approved: { ... }              // approved-only

  canonical_templates: {                          // max_chars + required-slot verification
    version: string
    page_section_templates: Record<string, { cowork_writable_slots: SlotSpec }>
  }

  prior_handoff_notes: {
    page_outlines: string | null                  // (outline-page's note — context)
    /* draft-page handoff lives on roadmap_state.page_drafts.<slug>._meta.handoff_note;
       read per-page in the same SELECT that loads the draft */
  }

  atoms_pool: {                                   // verbatim-atom-preservation + coverage
    by_id:    Record<string, ContentAtomRow>
    by_topic: Record<string, string[]>            // drift shim
  }
  facts_pool: {
    by_id:    Record<string, ChurchFactRow>
    by_topic: Record<string, string[]>            // drift shim
  }
  crawl_topics_pool: {
    by_key: Record<string, { passages, passages_total, passages_truncated, items, ... }>
  }
}
```

Per page, you ALSO need the outline + draft you're critiquing —
these live in `roadmap_state.page_outlines.<slug>` and
`roadmap_state.page_drafts.<slug>`. Pull both in ONE `SELECT` per
page (the bundle doesn't inline them because they're written mid-
session by the prior steps and would go stale).

### Partner voice card + global audit criteria

The **partner voice card** (banned_terms, branded_vocabulary,
sample_sentences_in_voice, example_phrases_bad) is partner-specific
and lives on `stage_1` in the bundle — read it from there.

The **global audit criteria** (em-dash discipline, filler triads,
AI clichés, etc.) live in
`cowork-skills/skills/web-page-reviewer/references/audit-criteria.md`
— that's part of your SKILL bundle, not the project bundle. The
strategist downloads it via the SKILL attachment, not the project
attachment.

### When to use MCP

- ONE `SELECT` per page (loads both `page_outlines.<slug>` and
  `page_drafts.<slug>` in one shot).
- ONE `roadmap_state_set` write to persist the critique at
  `['page_critiques', '<slug>']`.
That's it.

## What you produce (CoworkPageCritique)

5 axes. Each axis returns a numeric score 0-100 + pass/fail + specific
hits. The verdict's `confidence_band` is computed from the 5 axes.

```ts
{
  page_slug:        string
  confidence_band:  'green' | 'yellow' | 'red'

  /** AXIS 1: Voice character — does this read like THIS church? */
  voice_character: {
    score:                  number          // 0-100
    passed:                 boolean
    voice_match_assessment: string          // 1-2 sentences
    exemplars_landed:       string[]        // which stage_1 voice_exemplars showed up
    rhythm_match:           'tight' | 'close' | 'drift' | 'wrong'
  }

  /** AXIS 2: Persona fit — does the copy speak to the personas on
   *  this page's entry list? */
  persona_fit: {
    score:                number
    passed:               boolean
    primary_persona:      string
    fit_notes:            string            // ≤200 chars
    /** Sections where the persona's barrier was NOT addressed. */
    barrier_misses:       Array<{ section_intent_id: string; persona: string; missing: string }>
  }

  /** Deferred atoms — the drafter's structured "I couldn't use this"
   *  signal. Every entry in `draft.sections[*].deferred_atoms[]` MUST
   *  surface in your `directives[]` at severity ≥ warning. The note
   *  cites the atom_id + reason; the strategist sees what was lost
   *  and decides whether to add a template variant + re-fire or
   *  accept the deferral. Escape hatches without visibility become
   *  silent drops; this rule is what gives the deferral channel a
   *  visibility cost. Added 2026-06-13 with the deferred-verbatim
   *  contract fix. */

  /** AXIS 3: Source coverage — did every source the outline allocated
   *  to this page (atoms + facts + crawl topics) actually land in the
   *  copy? Renamed from atom_coverage 2026-06-12 with the three-source
   *  contract widening. The score scale is unchanged (0-100), and a
   *  number from one fire is comparable to a number from a prior fire
   *  on the same draft — telemetry is portable across the rename. The
   *  axis assessment is BROADER though: a fact-led section that uses
   *  facts heavily and atoms barely is NOT a coverage failure. */
  source_coverage: {
    score:                number
    passed:               boolean
    /** ids / keys that landed somewhere in the section's copy. */
    atoms_landed:         string[]
    facts_landed:         string[]                 // ← added with rename
    crawl_topics_landed:  string[]                 // ← added with rename
    /** Sources outline assigned but the draft didn't consume. */
    atoms_orphaned:        Array<{ atom_id: string;  reason: string }>
    facts_orphaned:        Array<{ fact_id: string;  reason: string }>
    crawl_topics_orphaned: Array<{ topic_key: string; reason: string }>
    /** Verbatim atoms verified EXACT in their bound slot. */
    verbatim_preserved:   boolean
    verbatim_violations:  Array<{ atom_id: string; slot: string; diff: string }>
  }

  /** AXIS 4: Claim plausibility — every claim in the copy traceable
   *  to a real source (atom / fact / stage_1 / merge_token)? */
  claim_plausibility: {
    score:                number
    passed:               boolean
    /** Claims that read like inventions (no source). */
    untraceable_claims:   Array<{ section_intent_id: string; slot: string; claim: string }>
  }

  /** AXIS 5: Dignity floor — does the copy honor the ethos_summary?
   *  Specific guard against generic platitudes / self-promotion /
   *  visitor-as-prop framing. */
  dignity_floor: {
    score:                number
    passed:               boolean
    ethos_alignment_note: string
    hits:                 Array<{ section_intent_id: string; slot: string; issue: string }>
  }

  /** Mechanical scan results — these mostly drive voice_character
   *  but also gate the overall band. */
  mechanical_scan: {
    no_em_dashes:                { passed: boolean; hits: string[] }
    no_filler_intensifiers:      { passed: boolean; hits: string[] }
    no_filler_triads:            { passed: boolean; hits: string[] }
    no_contrastive_reframes:     { passed: boolean; hits: string[] }
    no_ai_cliches:               { passed: boolean; hits: string[] }
    no_church_cliches:           { passed: boolean; hits: string[] }
    no_self_promoting_we_our:    { passed: boolean; hits: string[] }
    no_consec_same_opener:       { passed: boolean; hits: string[] }
    banned_terms_avoided:        { passed: boolean; hits: string[] }
    max_chars_respected:         { passed: boolean; violations: Array<{ slot: string; max: number; got: number }> }
    required_slots_filled:       { passed: boolean; missing: string[] }
    verbatim_atoms_preserved:    { passed: boolean; missing: string[] }
  }

  /** Positive checks — did the copy LAND? */
  positive_checks: {
    heading_is_clean_label:      boolean
    tagline_strategy_honored:    boolean
    hero_description_invites:    boolean
    section_jobs_addressed:      boolean
    jesus_named_per_major_section: boolean
    visitor_as_hero:             boolean
    primary_cta_specific:        boolean
    branded_vocabulary_used:     string[]
    specificity_present:         boolean
  }

  /** Per-section verdict + status. */
  section_by_section_notes: Array<{
    section_intent_id: string
    status:            'green' | 'yellow' | 'red'
    note:              string                 // ≤200 chars
  }>

  recommended_action: 'ship' | 'minor_edits' | 'send_back_to_drafter'

  /** On red: specific kickbacks for draft-page to address on rerun. */
  kickbacks_to_drafter: Array<{
    section_intent_id: string
    slot_name:         string
    issue:             string                 // what's wrong
    requested_fix:     string                 // what to do instead (≤200 chars)
  }>

  _meta: ArtifactMeta
}
```

## Confidence-band rules

- **green** — All 5 axes ≥ 80. Mechanical scan: zero hits across
  em-dashes / banned terms / required slots / verbatim-atom
  preservation. Safe to advance to strategist review.
- **yellow** — One or two axes between 60-80, OR a single mechanical
  hit the reviewer judges fixable in place. Strategist skim
  recommended; draft can advance with notes.
- **red** — Any axis < 60, OR any of: em-dash hit, banned term hit,
  required slot missing, verbatim atom violated, max_chars violated,
  heading-as-sentence violation. Kick back to draft-page with
  specific kickbacks_to_drafter.

## Axis scoring rubrics

### Voice character (1 of 5)

100: Rhythm tight to exemplars; 3+ exemplars echoed; zero anti-exemplar
     hits; ethos summary is the floor every sentence stands on.
80: Rhythm close; 1-2 exemplars echoed; zero mechanical hits.
60: Rhythm drifts in 1-2 sections; mechanical scan clean.
40: Rhythm drifts page-wide OR 1-2 anti-exemplar hits.
20: Reads like generic-AI-church-copy; multiple anti-exemplar hits.
0:  Reads like a different church's website pasted in.

### Persona fit (2 of 5)

100: Every persona on the page's entry list has their barrier addressed
     in at least one section; persuasive_posture matched per persona.
80: Primary persona's barrier addressed; secondary personas treated
    correctly but lightly.
60: Primary persona addressed but in generic terms; barrier not named.
40: Persona is implied but not addressed.
20: Wrong persona spoken to.

### Atom coverage (3 of 5)

100: Every atom in `atoms_for_page` either appears in a field_value
     (atom_ref binding) OR is justifiably absent (deferred_slot with
     reason). **Every program / CTA / detail / scripture / key_phrase
     in every assigned crawl topic's `items` tree is rendered or
     justifiably deferred per the draft's `source_coverage[]`.**
     Verbatim atoms: exact preservation OR a logged
     `verbatim_overrides[]` entry naming a strategist-directed change.
     No orphans, no silent omissions.
80: 90%+ atoms landed; orphans have reasons; verbatim preserved;
    every crawl-items[] entry accounted for.
60: 70-90% atoms landed; reasons thin; OR 1 verbatim atom slightly
    altered (still recognizable); OR 1-2 crawl-items[] entries
    unaccounted for.
0:  Verbatim atom not preserved AND no override logged; OR <50%
    atoms landed without reasons; OR ANY unaccounted program in
    `source_coverage[]` (the silent-omission failure mode that
    burned Desert Springs — care lost Pastoral Counseling +
    Hospital Visits, give lost the Tithe + 3 Scriptures + Stocks
    CTA, youth lost Fine Arts + the Costa Rica Global Trip — none
    of those landed because the drafter saw a truncated/subsetted
    view; the coverage recompute below catches it).

### Claim plausibility (4 of 5)

100: Every concrete claim traces to atom / fact / stage_1 / merge.
     No invented programs, no invented people, no invented services.
80: 1-2 minor framing claims that aren't directly source-traceable
     but are obvious paraphrases of source.
60: 3+ ungrounded claims OR 1 invented specific (a program name not
    in inventory).
0:  Inventions (made-up staff names, made-up service times, made-up
    addresses).

### Dignity floor (5 of 5)

100: Ethos summary visibly the floor. No platitudes, no
     visitor-as-prop framing, no self-promotion. Visitor is the hero.
80: One platitude / one weak we/our; otherwise clean.
60: Multiple platitudes; some we/our as self-promotion.
40: Generic warm-fuzzy that any church could've written.
0:  Demeaning framing of visitor / outsider / non-Christian.

## Procedural decomposition — checkable rules per axis

The rubrics above describe **when** scores apply. The procedures
below describe **how** to detect specific defect classes. Banked
2026-06-12 after a known-answer fire showed abstract axis names
alone don't teach judgment — prose teaches judgment only when
decomposed into checkable procedure (extraction + lookup +
comparison). Apply these procedures BEFORE scoring; the rubric is
the rollup, the procedures are the work.

### claim_plausibility — the source-grounding procedure

For every concrete logistic claim in the draft's `copy` (across all
sections, all slot values), follow this loop:

1. **Extract.** Identify each statement that asserts a logistic
   fact about the partner. Logistic-fact categories to scan for:
   - **Location**: address, room name, building name, "in the lobby,"
     "in the foyer," "in the back room"
   - **Time**: service times, meeting times, "every Sunday at,"
     "Wednesdays at 7"
   - **People + roles**: named staff, "Pastor X," "Teacher Y,"
     "a teacher will," "our director"
   - **Process**: "check-in is," "you walk in and," "first you,"
     "we'll greet you at"
   - **Numbers + ratios**: ages, capacity, "ages 0 to 4,"
     "1:5 teacher-child ratio," "30-minute service"
   - **Named programs**: program names, ministry names,
     branded class names
   - **Partner organizations**: named third-party orgs the church
     references

2. **Lookup.** For each extracted claim, search the inputs:
   - The `Atoms allocated to this page` list (full bodies): does
     any atom contain this claim?
   - The facts inputs: does any fact's `data` contain this claim?
   - The persisted outline's atom_assignments: was an atom_id
     assigned to a slot that should carry this claim?

3. **Decide.** Three outcomes:
   - **Grounded** in an atom or fact → no action; the draft is
     honoring the source.
   - **Implied** by stage_1 or partner context but not in a specific
     atom/fact → soft signal; mention in summary if it's a stretch.
   - **Ungrounded** — claim appears in the draft, doesn't appear in
     any provided atom OR fact → **lift the verbatim line into
     `problem_lines` AND emit a `claim_plausibility/slot_edit`
     directive** with `note` naming the specific atom or fact that
     would be needed (or "no source — drafter invented; needs
     content collection or atom").

**Worked example** (paratots, 2026-06-12):

  The draft contains: "check-in is inside the lobby, and a teacher
  will walk you to the room"

  - Extract: location ("inside the lobby"), process ("check-in is"),
    role + process ("a teacher will walk you to the room")
  - Lookup: scan atoms_for_page bodies + facts for any of these
    claims. None found.
  - Decide: ungrounded → lift to problem_lines + emit
    `claim_plausibility/slot_edit` directive: "Section 3 body
    invents check-in workflow + teacher-walks-to-room procedure;
    no atom or fact carries this. Either route to content
    collection for the partner's actual check-in process or drop
    the invented logistics."

  Score impact: even ONE ungrounded logistic claim drops
  claim_plausibility to ≤60 per the rubric ("3+ ungrounded claims
  OR 1 invented specific"). A draft with ONE ungrounded claim that
  the critic missed = the critic missed the score.

### voice_character — intra-section coherence procedure

Same-information repetition WITHIN a single section is a defect.
Cross-section repetition is fine — the same theme echoing is voice.
The defect is when one section's heading + tagline + multiple items
all carry the SAME literal logistic in different words; the visitor
reads the same fact three times in 200 words.

Procedure:

1. For each section in the draft:
2. Concatenate all text values inside that section's `copy`
   (heading, tagline, body, all items, button labels).
3. For each logistic-fact category in the claim_plausibility
   extraction (location, time, people, process, numbers, programs):
   - Does the SAME logistic appear more than once within this
     section's concatenation? Same time? Same location? Same
     teacher name? Same "ages 0 to 4"?
4. **If yes** → that's an intra-section redundancy defect. Lift
   one of the repeated lines into `problem_lines` AND emit a
   `voice_character/slot_edit` directive citing the section:
   `"Section N repeats <fact> across <slot_a> + <slot_b> + …;
   pick the slot where it lands best and drop the others."`

**Worked example** (paratots section 3, 2026-06-12):

  Within ONE section, the draft has:
  - heading: "ParaTots — Saturdays at 9:15 AM"
  - tagline: "Kids 0-4 meet Saturdays at 9:15 AM"
  - items[0]: "9:15 AM on Saturday is when ParaTots gathers…"
  - items[1]: "Saturday morning at 9:15…"

  The time (Saturday 9:15 AM) is repeated 4 times within one
  section. Cross-section repetition (same time mentioned on home,
  plan-visit, paratots) is fine — that's reinforcement. Within ONE
  section is redundancy.

  Lift one repeated line to problem_lines. Emit
  `voice_character/slot_edit` directive: "Section 3 repeats
  Saturday 9:15 AM across heading + tagline + items[0] + items[1].
  Pick the slot that lands best (probably tagline as the factual
  qualifier) and drop the others."

  Score impact: rubric drops voice_character to ≤80 ("Rhythm close,
  1-2 exemplars echoed") if intra-section redundancy is the only
  defect; ≤60 if multiple sections have it.

### Apply the procedures BEFORE the rubric

A draft with the two known defects above (ungrounded check-in +
section 3 redundancy) should score:
  claim_plausibility: ≤60 (one ungrounded logistic)
  voice_character:    ≤80 (one section's redundancy)

If your scores are higher AND you emitted no directive for either
class, you skipped the procedure — re-read the draft section by
section with the procedure in mind before finalizing scores.

### source_coverage — the recompute-against-live-inventory procedure

The drafter MUST emit `source_coverage[]` (one entry per assigned
source per section, each carrying a full `items[]` walk with every
item marked `rendered` / `deferred` / `coverage_gap`). Your job is
to recompute that report against **live inventory** (atoms_pool,
facts_pool, crawl_topics_pool) and FAIL the critique on any
unaccounted entry.

Procedure:

1. **Re-walk every assigned crawl topic.** For each
   `crawl_topic_assignments[].topic_key` in the outline, load the
   topic from `crawl_topics_pool.by_key[topic_key]` and walk the
   FULL `items` tree recursively. Enumerate every sub-item of every
   kind — `program` / `cta` / `detail` / `scripture` /
   `key_phrase` / `contact_block` / `meeting_time` / `faq`. Do NOT
   subset kinds; do NOT truncate the walk. This is the exact bug
   shape that hid Desert Springs's tithe Scriptures.
2. **Cross-foot.** Every leaf in the live items tree must appear in
   the draft's `source_coverage[].items[]` for that
   `(section_intent_id, topic_key)` pair. An item present in
   inventory but absent from the report = `coverage_gap` directive
   at severity `blocker`. Quote the item label verbatim
   ("Pastoral Counseling", "Tithe — Malachi 3:10", "Fine Arts").
3. **Audit the rendered ones.** For each item marked `rendered`,
   verify its content actually appears in the draft's field_values
   at the named `slot_path`. A `rendered` marker with no matching
   text in the draft is the same omission with a paper trail —
   surface as `coverage_marker_unsupported`.
4. **Audit the deferred ones.** A `deferred` reason like "no slot
   available" is valid; "didn't fit voice" is not — that's a
   `unjustified_deferral` directive at severity `warning`.

This procedure is what makes the no-omission contract enforceable.
Without it, the drafter's coverage report is a self-attestation;
with it, the critique recomputes against truth.

### no-fabrication spot check (claim_plausibility extension)

Pair the source-grounding loop in §claim_plausibility above with
this rule: a `coverage_gap` from the source_coverage recompute
should NOT also surface as a claim_plausibility hit — those are
omissions, not inventions. But if the drafter wrote a claim
("most fill up fast, so register early") that doesn't trace to any
atom/fact/crawl item AND wasn't surfaced as a content_gap by the
drafter, that's a fabrication directive at severity `blocker`. On
Desert Springs the drafter invented "Most fill up fast, so
register early" on the youth page; it sounded plausible and was
wrong. The critique should have caught it; encode this here so
it does next time.

### cross-source conflict flag

If the drafter's `voice_signal_report.notes` mentions a value
disagreement between sources (Desert Springs youth: text-to-connect
fact `55678` vs crawl `620-322-2390`), surface that conflict as a
directive at severity `warning` so the strategist routes to partner
confirmation. Never silently pick one value.

### Authorized strategist overrides — DO NOT flag these as errors

When the drafter logs a `verbatim_overrides[]` entry on a section
(strategist directed a modification to a verbatim atom's content,
e.g. swapping "going on mission" → "Global Trip" per house
terminology, or normalizing a single em-dash inside an atom), the
critique MUST treat it as authorized — not as a verbatim violation.
The contract: the override is a paper trail the strategist
intentionally created. Critique still spot-checks the override
reason for plausibility (the kind enum is closed:
`strategist_directed_modification` / `em_dash_normalization` /
`house_terminology_swap`) but doesn't score against verbatim
preservation for the override-scoped atom.

Same for `band_status`. When a section stamps
`band_status: "verbatim_band_unreachable"` + a `band_note` because
the outline routed it as directive-only OR the strategist's edits
dropped it under the band, do NOT emit a `verbatim_band_drift`
directive. The status IS the explanation.

## Mechanical-scan nuance

- **Triads** — `\b\w+, \w+,? and \w+\b` is the pattern. Distinguish:
  - Filler: "warm, welcoming, and authentic" → fail
  - Intentional: "safe, known, and loved" (each carries distinct
    semantic weight) → pass
  - Named lists: "Discussion Groups, Discovery, and Marriage cohort"
    (proper nouns of real programs) → pass
- **We/Our** — `\b(we|our)\b`. Distinguish:
  - Self-promoting: "we are an amazing community" → fail
  - Partnership: "we partner with parents" → pass
  - Test: does "we" describe the church TO the visitor (fail) or
    invite the visitor INTO something (pass)?
- **"Just"** — banned as intensifier ("we just want you here"),
  allowed as locational adverb ("just inside the Foyer") or temporal
  ("you just arrived"). Context check.

## What you do NOT do

- **You do NOT rewrite copy.** Kick back via `kickbacks_to_drafter`.
- **You do NOT re-run the outline.** If a slot is wrong AT THE
  OUTLINE LEVEL (wrong template for the section_intent), surface in
  `section_by_section_notes` with a `red` status, and let the
  director decide whether to re-outline.
- **You do NOT invent preferred wording.** The drafter + the outline
  + stage_1 are the source; you check compliance, not taste.

## Hard rules

- **Mechanical scan covers ALL field_values across ALL sections.**
  Concatenate; scan once; hits per slot.
- **Verbatim atom check is exact-string.** Any whitespace / casing /
  punctuation drift = violation.
- **`recommended_action` follows from `confidence_band`:** green →
  ship; yellow → minor_edits; red → send_back_to_drafter (must
  produce kickbacks_to_drafter entries).
- **Confidence_band is the LOWEST band the axes + mechanical-scan +
  positive-checks all support.** A page with 5 axes green but a
  mechanical em-dash hit is RED.

## Built-in verification — run BEFORE handing the critique to the strategist

Run these checks against your own output, fix anything that fails,
re-run the audit, THEN ask the strategist to review. Report as a
table.

1. **All five axes scored** with a band + a rationale referencing
   specific lines (not vibes). Dignity, voice_character, persona_fit,
   source_coverage, claim_plausibility.
2. **Vision-fit checked** when
   `strategic_goals.goals_and_vision.church_vision` is approved: at
   least one dignity-axis directive (severity ≥ warning) cites the
   `church_vision` text verbatim when the draft drifts away from it,
   or the dignity rationale names it as honored.
3. **Verbatim band drift** detected: every `draft.sections[i]`'s
   `actual_verbatim_ratio` falls inside its `intended_verbatim_band`
   range (high ≥ 0.7 / mid 0.3-0.7 / low ≤ 0.2) — EXCEPT for
   sections stamped `band_status: "verbatim_band_unreachable"`
   (authorized — see "Authorized strategist overrides"). Any
   unauthorized drift surfaces as a directive with kind
   `verbatim_band_drift` at severity ≥ warning.
4. **Source-coverage recompute** (NEW — the no-omission backstop):
   for every section, walk the live inventory for each assigned
   atom/fact/crawl-topic and cross-foot against the drafter's
   `source_coverage[].items[]` list. Any leaf in inventory absent
   from the report = `coverage_gap` directive at severity `blocker`.
   Any `rendered` marker without matching text in field_values =
   `coverage_marker_unsupported` directive at severity `blocker`.
   Quote the item label verbatim so the strategist can trace.
5. **Mechanical scan reported** (em-dashes, banned filler, AI
   clichés, anti-exemplar hits) — concatenated across all field
   values. Zero-hit pages can land green; any hit forces ≥ yellow
   and surfaces in the directives. Honor `verbatim_overrides[]`:
   logged single-character normalizations inside a verbatim atom
   (e.g. em-dash → en-dash with reason `em_dash_normalization`)
   are AUTHORIZED, not a mechanical-scan failure.
6. **Standout + problem lines quoted**, not paraphrased. Each entry
   names the section + the verbatim line so the strategist can
   trace it.
7. **`come as you are` always loses** even when a partner exemplar
   uses it. Globally-banned clichés beat per-project voice
   exemplars; if the draft contains the phrase, surface as a
   `cliche_banned` directive regardless of whether the partner's
   stage_1 voice card lists it. The ban wins.
8. **`just` intensifier vs `just like` comparison** — the
   mechanical scan must NOT false-positive on `just like` inside a
   verbatim atom. `just` as a filler intensifier
   ("we just want you here") still fails; `just like` as
   comparison ("just like Jesus did") is allowed. Context check.

## Review format

Walk the strategist through the verdict as a **scannable axis table**
(axis → score → 1-line rationale → top directive), then a
**directives section** grouped by severity (blocker → warning →
nit), then **standout / problem lines** as blockquotes. **Not raw
JSON.** Keep JSON as the persisted artifact only.

## Self-validation before returning

1. mechanical_scan.no_em_dashes.passed === true OR confidence_band
   is red.
2. mechanical_scan.required_slots_filled.passed === true OR
   confidence_band is red.
3. mechanical_scan.verbatim_atoms_preserved.passed === true OR
   confidence_band is red.
4. If recommended_action === 'send_back_to_drafter',
   kickbacks_to_drafter has at least 1 entry referencing a specific
   slot.
5. source_coverage.atoms_landed.length +
   source_coverage.atoms_orphaned.length === atoms in
   `atoms_for_page`. Cross-foot.
6. score on each axis matches the rubric anchor for that band — if
   voice_character.score = 85 but the assessment notes 3
   anti-exemplar hits, the score is wrong.

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
