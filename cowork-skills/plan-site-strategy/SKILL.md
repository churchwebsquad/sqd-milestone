---
name: plan-site-strategy
description: |
  ONE call per project. Reads stage_1 + ministry_model + acf_plan, and
  outputs the site_strategy block: the proposed page list (slug + name +
  purpose), the persona journey paths through the site (each persona's
  entry → consideration → commitment trajectory), and the nav structure.
  Precursor to plan-cross-page-allocation — answers "what pages does this
  church need" before allocation answers "what goes on each page."
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
references:
  - ../page-outlines-by-ministry-model.md
---

# Plan Site Strategy

You answer one structural question: given this church's strategy +
ministry model + organized content matrix, **what is the right set of
pages and how do the visitors move through them**?

You are NOT picking templates (that's outline-page).
You are NOT writing copy (that's draft-page).
You are NOT routing atoms to pages (that's plan-cross-page-allocation).
You ARE deciding the sitemap shape, the nav structure, and the
persona-journey overlay on top of it.

## Your input

```ts
{
  project_id:     string
  stage_1:        CoworkStage1
  ministry_model: CoworkMinistryModel
  acf_plan:       CoworkAcfPlan       // includes cell_density + coverage_gaps
  /** OPTIONAL — partner has indicated a strict page count (e.g.
   *  "we want 10 pages, not more"). If unset, you pick. */
  page_count_hint?: number
  /** OPTIONAL — pages the partner explicitly wants kept from current
   *  site (carryover_slug list). */
  pages_to_carry_forward?: string[]
}
```

## What you produce (CoworkSiteStrategy)

```ts
{
  pages: Array<{
    slug:         string                  // kebab-case; e.g. 'plan-your-visit'
    name:         string                  // display name in nav
    purpose:      string                  // ≤180 chars: what this page exists to do
    primary_audience: string              // persona name OR 'general'
    primary_funnel:   FunnelStage         // closed enum from acf_plan
    /** Which acf_plan cells this page covers. Allocation skill uses
     *  this to route atoms+facts. */
    covers_cells: Array<{
      audience: string
      category: ContentCategory
      funnel:   FunnelStage
    }>
    /** Sort order in primary nav. Pages omitted from nav have null. */
    nav_order:    number | null
    /** Pages NOT in primary nav but linked from contextual CTAs. */
    nav_strategy: 'primary' | 'secondary' | 'footer' | 'contextual_only'
    /** Whether this is a single-page or has children. */
    has_children: boolean
  }>

  nav: {
    primary:   Array<{ slug: string; children?: string[] }>      // primary nav
    footer:    string[]                                          // footer-only links
    cta_only:  string[]                                          // sticky-CTA links (e.g. Give)
  }

  /** One journey per stage_1.persona. Each journey walks the persona
   *  from `discover` → `commit` via specific page slugs. */
  persona_journeys: Array<{
    persona:       string                  // exact name from stage_1
    entry_points:  string[]                // 1-3 slugs they're most likely to land on
    /** Ordered slugs they walk through. Must end on a `commit`-funnel page. */
    journey:       string[]
    /** Where this persona is most likely to drop off + what fixes it. */
    drop_off_risk: { at_slug: string; reason: string; mitigation: string }
  }>

  /** Pages the strategist might be tempted to add but shouldn't.
   *  Captures the "we considered X but decided not to" reasoning so
   *  strategist push-back is informed. */
  pages_considered_dropped: Array<{
    slug:      string
    reason:    string                      // 1 sentence: why we excluded
  }>

  report: {
    page_count:      number
    nav_primary_count: number
    pages_carried_forward: string[]       // intersect of pages_to_carry_forward + final list
    coverage_gaps_addressed: string[]    // gap descriptions covered by new pages
    coverage_gaps_remaining: string[]    // gaps still uncovered (need content collection)
    ministry_model_alignment_note: string
  }

  _meta: ArtifactMeta
}
```

## Page-count discipline

Default page-count target:

| ministry_model | typical range | density tell |
|---|---|---|
| attractional | 8-14 pages | strong gathering+visit cells; thinner formation/serve_out |
| discipleship | 12-18 pages | dense formation/belong/commit cells across multiple audiences |
| missional | 10-16 pages | strong serve_out+commit cells; partnership directories |

Respect `page_count_hint` if provided. If hint forces aggressive
consolidation, surface in `report.ministry_model_alignment_note` what
got compromised.

## Page-shape heuristics

1. **Every persona MUST have at least one entry_point.** A persona with
   no entry is a persona the site can't reach — fail the build.
2. **Every persona's journey MUST end on a `commit`-funnel page.**
   Without a commit endpoint, the journey doesn't land. If no commit
   page exists for this persona, ADD ONE (it's the obvious gap).
3. **Primary nav: 5-8 items max.** Mobile-friendly cap. Anything beyond
   is `footer` or `contextual_only`.
4. **`gathering` × `visit` cells get their own page** for attractional
   churches (almost always called Plan a Visit / Sundays / etc.).
   Allocation depends on this being a single landing destination.
5. **`give` page is almost always `contextual_only` + sticky CTA** —
   not in primary nav (visitors don't navigate TO Give; they're
   prompted to it from commit pages).
6. **Homepage is always slug `home`** with primary_funnel = `discover`,
   covers the highest-density `discover` × * cells.
7. **Page-per-persona is anti-pattern** — pages serve cells, not
   personas directly. A persona may have a "their landing page" but
   that page must serve a general audience secondary too. Don't
   silo content.

## Journey discipline

For each persona's journey:

- **3-6 pages**. Shorter is finer (focused journey). 7+ = the persona
  isn't actually committing on the site; they bounce.
- **Each step has a clear next-step CTA** to the next slug in the
  journey. Allocation will allocate the CTA atom to the correct
  section_intent later — but the journey here MUST be walkable.
- **Drop-off-risk identification.** For each journey, find the ONE
  page where this persona is most likely to stop. Usually it's the
  transition from `consider` → `visit` (information overwhelm) OR
  `belong` → `commit` (commitment friction).

## Coverage-gap handling

`acf_plan.coverage_gaps` flows through to YOUR output:

- **Blocker gaps** that you can resolve by adding a page → add the page
  + note in `report.coverage_gaps_addressed`.
- **Blocker gaps** that need new content (not a new page) → keep in
  `report.coverage_gaps_remaining`; strategist routes back to content
  collection.
- **Warning gaps** → mention in report; don't necessarily add pages
  unless density justifies.

## Hard rules

- **slugs MUST be kebab-case + URL-safe.** `/plan-a-visit` ok;
  `/Plan A Visit` not.
- **primary nav: 5-8 items.** Outside range = structural error.
- **Every persona name appears in `persona_journeys`.** Stage_1
  personas drop = structural error.
- **`covers_cells` MUST reference cells from `acf_plan.cell_density`.**
  Inventing a cell = structural error.
- **pages_considered_dropped MUST cite the cells the dropped page
  would have covered + where that content went instead.** Otherwise
  the consideration isn't an actual consideration.
- **EVERY non-empty `acf_plan.cell_density` cell must be `covers_cells`
  for at least one page.** If a cell has atoms/facts but no page
  covers it, those atoms orphan downstream. Surface as a structural
  error before returning.

## Self-validation before returning

1. Pages count ≥ persona-coverage minimum (1 entry per persona +
   at least 1 commit per persona — usually 6+ pages min).
2. Every persona's journey ends on a page whose `primary_funnel` is
   `commit`.
3. Every non-empty acf_plan cell is in at least one page's
   `covers_cells`. List orphans explicitly in
   `report.coverage_gaps_remaining` if intentional.
4. Primary nav array length 5-8.
5. `home` slug exists exactly once + has `nav_order` = 0.
6. `pages_to_carry_forward` (input) entries either appear in `pages`
   output OR appear in `pages_considered_dropped` with reason. No
   silent drops.
