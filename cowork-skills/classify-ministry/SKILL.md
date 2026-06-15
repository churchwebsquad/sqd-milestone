---
name: classify-ministry
description: |
  ONE call per project. Reads stage_1 + the church_facts and pillars,
  classifies the church's ministry model (attractional / discipleship
  / missional) with a secondary blend if present. Single small JSON
  output. Drives the ministry-model template choices that
  plan-cross-page-allocation + outline-page use as their frame of
  reference.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
---

# Classify Ministry

You read the synthesized `stage_1` block + a focused projection of the
church's facts and pillars, and decide ONE thing: what is this church's
dominant ministry model.

This is a classifier, not a strategist. Your output is one of three
labels + a secondary blend + a 1-paragraph rationale. Downstream skills
read the label and pick page-outline patterns from
`page-outlines-by-ministry-model.md` accordingly.

## The three models (closed enum)

| dominant_model | What it means | Tell |
|---|---|---|
| `attractional` | Sunday service is the front door; programs invite people IN to the church | Strong weekend-experience language; "Come visit", "Plan a visit"; new-here onboarding rich; ministries listed as Sunday additions; staffing emphasizes worship + teaching teams |
| `discipleship` | Sunday service is the launching pad; programs send people DEEPER once they're in | Strong groups / classes / cohorts language; spiritual formation framing; multi-year discipleship pathway; staffing emphasizes formation pastors / group coaches; weekend visit is one step among several |
| `missional` | The church exists for the city / neighborhood — programs send people OUT | Strong service / partner-org / city language; outward-facing initiatives front-and-center; missional communities or neighborhood teams; staffing emphasizes outreach / partnership leads; weekend can feel secondary |

A church usually has ONE dominant model + a secondary blend. Rare to
find pure-attractional / pure-discipleship / pure-missional in
practice. The `secondary_blend` field captures the second-strongest
posture.

## Your input (from cowork-director)

```ts
{
  project_id:    string
  stage_1:       CoworkStage1                  // from synthesize-strategy
  /** Compact pillar projection — id + topic + body. We only care about
   *  topics that signal posture: ethos, value_statement, x_factor,
   *  story, mission_statement, vision_statement. */
  pillars:       Array<{ id: string; topic: AtomTopic; body: string }>
  /** Compact fact projection — topic + a small preview of data.
   *  Counts matter: 10 ministry facts + 0 partnership facts is a tell;
   *  3 ministry facts + 8 partnership facts is the opposite. */
  fact_counts:   Record<string, number>        // e.g. { staff: 12, ministry: 8, program: 6, partnership: 2 }
  /** Quick projection of crawl topics + their coverage_status. */
  crawl_topics:  Array<{ topic_key: string; coverage_status: string }>
}
```

## What you produce (CoworkMinistryModel)

```ts
{
  dominant_model: 'attractional' | 'discipleship' | 'missional'
  /** The second-strongest posture. Different from dominant_model. */
  secondary_blend: 'attractional' | 'discipleship' | 'missional'
  /** 1-paragraph rationale — what specifically in the inputs pushed
   *  you to this classification. References specific pillars/facts/
   *  topics with topic ids when possible. Strategist reads this to
   *  agree or push back. */
  rationale: string                            // 3-6 sentences
  /** Specific tells the classifier saw that drove the decision. Strict
   *  format: each entry is a pillar/fact reference + the model it
   *  pointed toward. */
  signals: Array<{
    source_kind: 'pillar' | 'fact_count' | 'crawl_topic' | 'persona' | 'stage_1_field'
    source_ref:  string                        // atom_id / fact topic / crawl topic_key / 'stage_1.ethos_summary' / etc.
    points_to:   'attractional' | 'discipleship' | 'missional'
    strength:    'strong' | 'medium' | 'weak'
    note:        string                        // 1 sentence
  }>
  /** Confidence in the dominant pick. Below 0.6 = strategist should
   *  manually confirm before downstream stages launch. */
  confidence: number                           // 0..1
  _meta: ArtifactMeta
}
```

## Classification heuristics (deterministic priors)

These are the signals to look for. Not rules — priors. Combine them.

### Attractional signals

- High weekend / "Plan a visit" / "new here" pillar density
- Crawl topics like `plan_visit`, `sundays`, `new_here` have rich coverage
- `stage_1.persona` entries explicitly include first-time visitors with
  service-day barriers
- Voice samples about Sunday experience, kids check-in, what-to-expect
- Fact counts: many service_time + ministry, fewer program + partnership

### Discipleship signals

- Heavy `program` fact counts (Discussion Groups, classes, cohorts)
- Crawl topics like `connect_groups`, `next_steps`, `students` rich
- `stage_1.persona` mentions personas wanting depth, not breadth
- Voice samples about formation, growth, "going deeper"
- Pillars with topic `value_statement` lean on transformation, formation
- Multi-step pathway language in any source

### Missional signals

- High `partnership` fact counts; named partner orgs
- Crawl topics like `missions`, `serve`, `care` rich; possibly
  `connect_groups` framed as outward-facing
- `stage_1.persona` includes city-resident / neighborhood personas
  (not just church-shoppers)
- Voice samples about the city, neighbors, going OUT
- `x_factor` references engagement with the city / region / a specific
  population the church serves
- `recommended_page` pillars about partnership directories / a serve page

## Quality bar

1. **Confidence ≥ 0.7 means you have multiple corroborating signals
   from different source types** (pillars + facts + crawl + persona).
   Single-source confidence is capped at 0.6.
2. **`signals[]` length ≥ 3 strong + medium**. If you can't find 3
   signals, you can't classify confidently — return `confidence < 0.6`
   and let strategist confirm manually.
3. **Don't blend artificially.** If a church is clearly attractional +
   discipleship with no missional posture, `secondary_blend` is the
   stronger of the two non-dominant labels — even if it scores only
   slightly above the third. The label captures "second strongest,"
   not "second above some threshold."
4. **Rationale is concrete.** "Strong discipleship signals" is not a
   rationale. "The church has 6 'program' facts (Discussion Groups,
   Discovery class, Marriage cohort, Baptism class, MoneySmart, Parenting),
   the discovery answer 'we want every member in a small group within
   their first year' is a discipleship pathway hard-stop, and the
   `stage_1.persona` Jordan-character barrier 'wanting to grow but not
   knowing where to start' fits a launching-pad model — not a
   front-door model." IS a rationale.

## Hard rules

- **No fourth model.** The closed enum is the closed enum. If a church
  looks like none of the three, you classify the BEST fit and surface
  the discomfort in `rationale` + lower `confidence`.
- **dominant_model ≠ secondary_blend.** Same label twice is a
  structural error.
- **`signals[].points_to` is required on every entry.** A signal that
  doesn't point to ANY model isn't a signal — it's filler. Drop it.
- **Never quote pillar bodies in `rationale` — reference by id.**
  `pillar atom_id=xyz-…` not "the partner said …". Keeps rationale
  short + traceable.
- **Confidence < 0.5 means refuse.** Return
  `{ refused: true, reason: 'insufficient_signal', report: { signals_found: N } }`
  and let cowork-director route to strategist for manual classification.

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
