---
name: organize-acf
description: |
  ONE call per project. Reads stage_1 + the full pillar/fact inventory
  + crawl_topics, organizes the project's content along three axes —
  Audience × Content category × Funnel stage. The output is a routing
  matrix downstream skills (plan-site-strategy, plan-cross-page-allocation)
  use to decide which page each atom/fact belongs on AND how to sequence
  the visitor journey through them.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
---

# Organize ACF

You produce a single routing matrix that all downstream allocation
decisions consult.

**A = Audience** — which `stage_1.persona` does this serve?
**C = Content category** — what's its strategic domain?
**F = Funnel stage** — where in the visitor journey does it land?

The matrix lets `plan-site-strategy` answer "what pages do we need" (one
page per high-density cell or cluster of cells) and lets
`plan-cross-page-allocation` answer "which page does this specific atom
go on" (the cell it's tagged for) without re-discovering the same
structure twice.

## Your input

```ts
{
  project_id:     string
  stage_1:        CoworkStage1                  // includes personas[], ethos, voice
  ministry_model: CoworkMinistryModel           // includes dominant + secondary_blend
  /** Full pillar inventory — id + topic + body (≤300 char preview) +
   *  verbatim flag. */
  pillars:        Array<{ id: string; topic: AtomTopic; body: string; verbatim: boolean }>
  /** Full fact inventory — id + topic + preview. */
  facts:          Array<{ id: string; topic: string; preview: string }>
  /** Crawl topics + coverage_status. Used to detect where existing site
   *  is covering each cell vs. where there's nothing today. */
  crawl_topics:   Array<{ topic_key: string; coverage_status: string }>
}
```

## Closed enums

### C — Content categories (12)

| key | what it covers |
|---|---|
| `identity` | who-we-are: mission, vision, x_factor, founding story |
| `belief` | doctrinal statements, theological posture |
| `gathering` | the Sunday weekend service, locations, times, what-to-expect |
| `formation` | discipleship: groups, classes, cohorts, mentorship |
| `kids_family` | birth → 5th grade ministry, family-formation programs, parents-of-kids resources |
| `students` | middle + high school ministry, youth-specific programs |
| `care` | counseling, recovery, grief, support, prayer, hospital visits |
| `serve_in` | serving the body / inside the church (volunteering on Sunday teams, ministry teams) |
| `serve_out` | serving the city / partner orgs / missional engagement |
| `give` | financial generosity, giving mechanics, stewardship discipleship |
| `staff_org` | leadership, staff bios, governance, employment |
| `practical` | logistics, contact, parking, accessibility, FAQ |

If something doesn't fit cleanly, pick the closest single category — DO
NOT invent. Multiply-assigning to two categories is allowed but should
be the exception (≤10% of atoms/facts).

### F — Funnel stages (5)

| key | the visitor's posture |
|---|---|
| `discover` | doesn't know the church yet; lands from search / referral / drive-by |
| `consider` | knows the church exists; weighing whether to visit |
| `visit` | preparing for first physical/digital visit; logistics matter |
| `belong` | has visited, deciding whether to come back / get connected |
| `commit` | decided to commit; how-to-actually-do-the-thing (give / serve / lead / etc.) |

### A — Audience

Closed to whatever names are in `stage_1.personas[*].name` (3-5 entries)
PLUS one extra implicit audience: `'general'` (everyone). Don't invent
personas; use the names exactly as stage_1 emitted them.

## What you produce (CoworkAcfPlan)

```ts
{
  /** Every atom routed into the matrix. EVERY input pillar MUST appear
   *  here exactly once (no atom orphaned). */
  atom_routes: Array<{
    atom_id:         string
    primary_cell: {
      audience:    string           // persona name OR 'general'
      category:    ContentCategory  // closed enum above
      funnel:      FunnelStage       // closed enum above
    }
    /** Optional secondary routings — atom is relevant elsewhere too.
     *  Capped at 2. */
    secondary_cells?: Array<{ audience: string; category: ContentCategory; funnel: FunnelStage }>
    /** ≤120 chars. Why this cell. Strategist reads to agree/push back. */
    rationale:       string
  }>

  /** Every fact routed similarly. EVERY input fact MUST appear here. */
  fact_routes: Array<{
    fact_id:         string
    primary_cell:    { audience: string; category: ContentCategory; funnel: FunnelStage }
    secondary_cells?: Array<{ audience: string; category: ContentCategory; funnel: FunnelStage }>
    rationale:       string         // ≤120 chars
  }>

  /** Aggregated density per cell. Helps plan-site-strategy decide page
   *  consolidation: cells with high density are page candidates; cells
   *  with low density get folded onto adjacent pages. */
  cell_density: Array<{
    audience:       string
    category:       ContentCategory
    funnel:         FunnelStage
    atom_count:     number
    fact_count:     number
    /** True if this cell has BOTH atoms AND facts AND >2 of each.
     *  Likely page candidate. */
    page_candidate: boolean
    notes?:         string
  }>

  /** Gaps the matrix exposes: cells where ministry_model implies the
   *  church needs coverage but the inventory has nothing. Strategist
   *  surfaces these as content-collection gaps to fill before launch. */
  coverage_gaps: Array<{
    audience:       string
    category:       ContentCategory
    funnel:         FunnelStage
    severity:       'blocker' | 'warning'
    reason:         string                  // 1 sentence: why this gap matters for THIS ministry model
  }>

  /** Strategic notes for the strategist + cowork-director. */
  report: {
    atoms_routed:   number
    facts_routed:   number
    cells_filled:   number
    cells_empty:    number
    secondary_cells_used: number
    notes:          string[]
  }

  _meta: ArtifactMeta
}
```

## Routing discipline

1. **Primary cell is the ONE place this content most naturally fits.**
   If an atom about "Discussion Groups" pulls in both formation AND
   serve_in (because groups also serve the body), pick the stronger
   pull (`formation`) as primary; add `serve_in` as secondary if the
   atom genuinely belongs in both. Single-cell is default; multi-cell
   needs reason.
2. **Audience defaults to `general` unless the content is persona-
   specific.** A staff fact "Lead Pastor" is `general` (everyone needs
   to know). A pillar "Discussion Groups meet every Wednesday at 7pm
   for adults wanting to grow with others" is the `Maria` persona (if
   Maria's the formation-seeker) — because the body NAMES her desire.
3. **Funnel comes from the verb of the content.** Mission/vision
   pillars are `discover` (orienting outsiders). Service-time facts
   are `visit` (logistics for the about-to-attend). "Apply to lead a
   group" is `commit`. Use the visitor's POSTURE at that moment, not
   the church's intent.
4. **ministry_model shifts the funnel weights.** For an `attractional`
   church, `gathering` × `visit` is the densest cell. For
   `discipleship`, `formation` × `belong` AND `commit` are densest.
   For `missional`, `serve_out` × `commit` is densest. Use this as a
   sanity check on your cell_density output — if it doesn't match the
   ministry_model, surface a mismatch in `report.notes`.
5. **Coverage gaps reference ministry_model, not generic must-haves.**
   "No `commit` × `give` content for an attractional church" is a
   warning, not a blocker — small attractional churches often launch
   without a giving-discipleship pillar. "No `commit` × `serve_out`
   content for a missional church" IS a blocker — that's the
   missional church's center of gravity. Be specific.

## Hard rules

- **EVERY input pillar MUST appear in `atom_routes` exactly once.**
  Coverage invariant. cowork-director validates atom_routes.length
  matches input pillars.length.
- **EVERY input fact MUST appear in `fact_routes` exactly once.**
  Same invariant.
- **`secondary_cells.length ≤ 2`** per atom/fact. More than two means
  you didn't pick a primary; revise.
- **Audience names MUST exactly match stage_1.personas[*].name OR equal
  `'general'`.** Typos = structural error.
- **Category + funnel from closed enums only.** No invented values.
- **`cell_density` MUST list every non-empty cell.** Empty cells
  (atom_count=0 AND fact_count=0) MUST appear in `coverage_gaps` if
  ministry_model implies the church needs coverage there;
  otherwise they may be omitted.

## Self-validation before returning

1. Sum atom_routes.length === input pillars.length? If not, an atom is
   missing or duplicated — fix.
2. Sum fact_routes.length === input facts.length? Same check.
3. Every audience value in atom_routes/fact_routes is in
   `[...stage_1.personas.map(p=>p.name), 'general']`? Strike unknown
   audiences (route to general instead).
4. Cell_density sums match per-cell totals from the routes? Cross-foot.
5. ministry_model sanity: dominant_model = `discipleship` →
   cell_density's top 3 cells include `formation` × something? If not,
   note divergence in report.

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
