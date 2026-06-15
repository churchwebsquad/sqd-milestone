---
name: synthesize-critique
description: |
  ONE call per project (post per-page critique pass). Reads ALL the
  per-page critique verdicts + project context, rolls up to a
  cross-page review: voice consistency across pages, persona-coverage
  parity, structural issues, nav-vs-content gaps. Outputs the
  project-level verdict the strategist reads to decide ship / iterate.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
---

# Synthesize Critique

You read every per-page critique verdict and synthesize the
project-level view. Per-page critiques are local — they catch what's
wrong on each page. You catch what's wrong ACROSS pages.

This is the last skill the strategist reads before approving the build.

## Strategic Goals — inputs you MUST consume

The endpoint loads `roadmap_state.strategic_goals` and projects
approved fields into your user message. For the rollup, especially:

- **`church_vision`** (AM handoff) — anchor the rollup's
  `vision_alignment_summary` against this. If multiple pages drift
  away from it, that's a project-level finding, not a per-page one.
- **`top_3_website_goals`** + **`primary_goals`** — verify the
  project as a whole serves these. Missing goal coverage across
  pages → project-level cross-page finding.

## Your input

```ts
{
  project_id:   string
  /** Every page's critique verdict from critique-page. */
  critiques:    CoworkPageCritique[]
  /** Site-level shape for cross-page checks. */
  site_strategy: CoworkSiteStrategy
  /** Stage_1 for voice baseline + persona universe. */
  stage_1:      CoworkStage1
  /** Mins / drafts of each page (for cross-page voice scan). Compact
   *  projection — concatenated text per page. */
  page_text_by_slug: Record<string, string>
}
```

## What you produce (`CoworkCritiqueRollup`)

> **Canonical naming** (locked, used everywhere): TS type
> `CoworkCritiqueRollup` (src/types/coworkBundle.ts) ·
> `bundle_kind: 'critique_rollup'` (importer dispatch) ·
> persisted at `roadmap_state.critique_rollup` (cowork-director writes).
> Never `CoworkProjectCritique` (former draft name) or
> `director_critique` (former roadmap path).


```ts
{
  overall_band: 'green' | 'yellow' | 'red'

  /** Cross-page voice consistency — does the same church speak across
   *  pages? */
  voice_consistency: {
    band:               'tight' | 'close' | 'drift' | 'wrong'
    note:               string                 // ≤300 chars
    /** Pages whose voice diverges noticeably from the modal voice.
     *  These get priority for redrafting. */
    drift_pages:        Array<{
      page_slug:    string
      drift_axis:   'rhythm' | 'register' | 'pronoun' | 'vocabulary'
      note:         string
    }>
  }

  /** Persona coverage — every persona has their journey landed? */
  persona_coverage: {
    band:               'green' | 'yellow' | 'red'
    per_persona: Array<{
      persona:                  string
      entry_point_quality:      'strong' | 'present' | 'weak' | 'missing'
      journey_walkable:         boolean
      barrier_addressed_pages:  string[]
      barrier_unaddressed_note: string | null
      commit_endpoint_quality:  'strong' | 'present' | 'weak' | 'missing'
    }>
  }

  /** Nav-vs-content parity — is every page in nav drafted? Is every
   *  draft in nav (or intentionally not)? */
  structural_parity: {
    band:                'green' | 'yellow' | 'red'
    pages_in_nav_but_undrafted: string[]
    pages_drafted_but_unreachable: string[]    // not in nav + not linked from any CTA
    nav_target_404s:     Array<{ from_slug: string; cta_label: string; broken_target: string }>
  }

  /** Atom coverage at the project level — every active atom landed
   *  on at least one page? */
  source_coverage: {
    band:                'green' | 'yellow' | 'red'
    /** Atoms that NEVER appear in any page's source_coverage.atoms_landed.
     *  Strategist demotes OR routes back to outline. */
    project_orphans:     Array<{ atom_id: string; topic: AtomTopic; pages_attempted: string[] }>
    /** Atoms whose body appears on >3 pages (likely over-routed —
     *  one source of truth violated). */
    over_used:           Array<{ atom_id: string; appears_on_pages: string[] }>
  }

  /** Repeated phrases / vocabulary across pages. Branded vocab
   *  appearing multiple times = good. Generic phrases appearing
   *  multiple times = template smell. */
  repetition_audit: {
    branded_vocab_coverage: Record<string, number>   // term → page count
    suspicious_repeats:     Array<{ phrase: string; appears_on: string[]; why_suspect: string }>
  }

  /** Cross-page kickbacks — issues that span pages and can't be
   *  resolved by per-page redraft. Strategist resolves these (or
   *  cowork-director routes to the right upstream skill). */
  cross_page_kickbacks: Array<{
    kind: 'persona_journey_break' | 'atom_orphaned' | 'voice_drift' | 'nav_target_404' | 'duplicate_content_collision' | 'missing_commit_endpoint'
    detail:       string                       // ≤300 chars
    affected_pages: string[]
    suggested_route: 'site_strategy' | 'plan_cross_page_allocation' | 'outline_page' | 'draft_page' | 'strategist_decision'
  }>

  /** Per-page roll-up — for the strategist's at-a-glance table. */
  per_page_summary: Array<{
    page_slug:           string
    page_band:           'green' | 'yellow' | 'red'
    page_action:         'ship' | 'minor_edits' | 'send_back_to_drafter'
    /** ≤200 chars. */
    headline_issue:      string | null
  }>

  /** Top 3 recommendations the strategist should act on first. */
  strategist_priorities: Array<{
    rank:        1 | 2 | 3
    action:      string                        // ≤200 chars
    rationale:   string                        // ≤200 chars
  }>

  /** Optional notes — for cowork-director + strategist UI. */
  report: {
    pages_audited:    number
    pages_green:      number
    pages_yellow:     number
    pages_red:        number
    project_orphans_count: number
    cross_page_kickbacks_count: number
    notes:            string[]
  }

  _meta: ArtifactMeta
}
```

## Synthesis discipline

### Voice consistency

You have N page drafts. Read each one's concatenated text. The MODAL
voice is the baseline; any page drifting noticeably from modal goes in
`drift_pages`.

Drift axes:

- **Rhythm** — sentence length distribution diverges. One page uses
  short declaratives; another uses comma-spliced cadences.
- **Register** — one page is conversational ("here's the deal"),
  another is formal ("we believe in the proclamation of").
- **Pronoun** — one page leans heavy `you`, another leans heavy `we`.
- **Vocabulary** — one page uses branded terms ("Discussion Groups"),
  another uses generic ("small groups").

Single-page drift is usually a draft-page miss; whole-page-cluster
drift is usually a stage_1.voice_exemplars miss.

### Persona coverage

For each persona in stage_1:

1. **Entry-point quality** — does this persona's entry-page (from
   site_strategy.persona_journeys[].entry_points[0]) actually
   address them? Read the page's critique verdict's
   `persona_fit.primary_persona` — should match this persona OR be
   `general` with the persona's barrier explicitly addressed in a
   section.
2. **Journey walkable** — every step of
   site_strategy.persona_journeys[].journey resolves to a drafted
   page that links to the next step.
3. **Barrier addressed** — at least one drafted page somewhere has a
   section whose `persona_fit.barrier_misses` does NOT include this
   persona's barrier (i.e. the barrier IS addressed somewhere).
4. **Commit endpoint** — the journey's last page has
   `primary_funnel === 'commit'` AND has a primary CTA that fires
   the actual commit action (give / register / volunteer / etc.).

### Atom coverage at project level

Every active atom from the project's content_atoms should land on at
least one page. If an atom appears in `atoms_orphaned` on every page
that tried to use it, it's a project-level orphan. Strategist either:

- Routes the atom back to the allocation (was misallocated), OR
- Demotes the atom (it's not a load-bearing pillar after all)

### Over-used atoms

If an atom appears (by id) on >3 pages, that's a smell. Either:

- The atom is foundational ethos that genuinely belongs everywhere
  (note in report and pass), OR
- The allocation over-routed and the atom is now diluting (kick back
  to plan-cross-page-allocation).

### Repetition audit

- **Branded vocabulary appearing on ≥3 pages = good** (reinforces
  identity). Note in `branded_vocab_coverage`.
- **Generic phrases appearing on ≥3 pages = template smell.** Common
  AI patterns: "we believe", "join us", "discover more", "find your
  place". Surface in `suspicious_repeats`.

## Project-band rules

`overall_band` is the lowest band the four axes support:

- **green** — voice_consistency tight or close; persona_coverage
  green; structural_parity green; source_coverage green. Every page's
  critique band ≥ green. Safe to ship.
- **yellow** — One axis yellow, others green. Per-page bands mostly
  green with 1-2 yellow. Strategist review recommended; can advance
  with notes.
- **red** — Any axis red OR voice_consistency `drift`/`wrong` OR any
  page red. Cross-page kickbacks must be resolved before advancing.

## Strategist-priorities discipline

You produce EXACTLY 3 ranked priorities. The top priority is the ONE
action that, if done, most moves the project_band up. Examples:

- "Re-draft `/about` to match the modal voice (rhythm drift in 4
  sections)."
- "Re-allocate atom xyz-… off `/serve` — it's already in 4 places."
- "Add missing commit-endpoint for the Maria persona (her journey
  ends on `/connect-groups` which has no register CTA)."

If less than 3 actionable items exist, fill remaining slots with
maintenance items ("review `branded_vocab_coverage` and decide
whether to lift `Discussion Groups` into stage_1.x_factor").

## Hard rules

- **Every page in `critiques` MUST appear in `per_page_summary`.**
- **Every persona in `stage_1.personas` MUST appear in
  `persona_coverage.per_persona`.**
- **`overall_band` red ⇒ at least one `cross_page_kickbacks` entry
  OR at least one per_page_summary entry with page_band='red'.**
  Empty kickbacks + red band = structural error.
- **`strategist_priorities` has exactly 3 entries**, ranks 1/2/3.
- **`project_orphans` atom_ids MUST not appear in any page's
  atoms_landed.** Cross-foot against the per-page critiques.

## Self-validation before returning

1. `report.pages_audited === critiques.length`.
2. `pages_green + pages_yellow + pages_red === pages_audited`.
3. Every per-page `confidence_band` in the input is reflected in
   `per_page_summary[*].page_band` exactly.
4. Every persona name in `stage_1.personas` appears in
   `persona_coverage.per_persona` exactly once.
5. If `overall_band === 'green'`, `cross_page_kickbacks.length === 0`
   AND no per-page band is red.
6. `strategist_priorities.length === 3`. Ranks are 1, 2, 3.

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
