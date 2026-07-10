---
name: ingest-external-content-strategy
description: |
  ONE call per project. Ingests an already-approved external content
  strategy doc (usually a Notion export the AM has produced offline
  with a partner) and writes the artifacts Content Engine steps 1
  through 6 would have produced — stage_1, ministry_model, acf_plan,
  site_strategy — plus stamps sitemap_review as approved so the
  project can move directly to step 7 (plan-cross-page-allocation).
  Skips the crawl-inventory expectation because these partners
  typically hand over their own content collection outside the app.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
---

# Ingest External Content Strategy

You are consuming an already-decided content strategy document and
turning it into the four Content Engine artifacts the downstream
pipeline expects. The doc is the authority. You are NOT re-deriving
strategy from scratch, you are NOT second-guessing the AM's page
list, and you are NOT running the analyzer rules that
plan-site-strategy / synthesize-strategy / classify-ministry would
apply to a fresh partner. If the doc says something, the doc wins.

Where the doc is silent, use sensible defaults documented below. Do
not invent facts about the church — only lift what the doc supplies.

## When to use this skill

Partners who arrive with an existing content strategy document
authored offline (usually via an AM Notion doc). Signals you'll see
in the invocation:
- The strategist attaches a markdown / Notion export.
- `strategy_web_projects.crawl_excluded = true` OR no crawl inventory
  exists for the project.
- The AM has not run the Content Engine's steps 1 through 6.

For partners without a prior strategy doc, use the standard step 1
through 6 flow instead (atomize / classify-ministry / organize-acf /
synthesize-strategy / plan-site-strategy).

## Your input

```ts
{
  project_id:     string
  strategy_doc:   string     // full markdown of the AM's strategy doc
  /** OPTIONAL. When the strategist has already captured approved
   *  strategic goals in the app (audience, top_3_website_goals,
   *  voice_and_tone, etc.), they'll be attached. Use them to fill
   *  fields the doc doesn't explicitly cover. */
  strategic_goals?: StrategicGoalsSnapshot
  /** OPTIONAL. When the app already has a stage_1 / ministry_model /
   *  acf_plan (e.g. a prior partial run), attach so you can preserve
   *  strategist-authored fields on re-run. Absent = fresh run. */
  existing_artifacts?: {
    stage_1?:        CoworkStage1
    ministry_model?: CoworkMinistryModel
    acf_plan?:       CoworkAcfPlan
    site_strategy?:  CoworkSiteStrategy
  }
}
```

## What you produce

Four artifacts written to `roadmap_state`, PLUS a `sitemap_review`
row stamped `status: 'approved'`. Every artifact carries its own
`_meta` block per the ArtifactMeta contract.

### 1. stage_1 (roadmap_state.stage_1)

Extract from the doc:
- **personas**: every persona the doc names (implicit or explicit).
  For each: `name`, `barrier`, `need`, `voice_resonance`,
  `primary_pages`. If the doc is oriented around one central persona
  (e.g. "the first-time visitor"), emit that as the primary persona;
  add secondaries if the doc talks about parents, seekers, families,
  members, etc. distinctly.
- **audience**: the strategist's stated audience description. Free
  form, but should reflect the doc's positioning.
- **x_factor**: 1-2 sentence distillation of what makes this church
  distinct, per the doc. Usually lives in an Executive Summary or
  Church Identity section.
- **voice_exemplars**: verbatim phrases the doc endorses ("Love God.
  Love people. Make disciples.", "Belong. Believe. Become.",
  "Disciples Serve."). Pull them straight from the doc.
- **voice_anti_exemplars**: phrases the doc calls out as OUT of
  voice, if any (usually in a "avoid" or "not this" section).
- **voice_characteristics**: tone descriptors the doc lists.
- **project_goals**: from `strategic_goals.top_3_website_goals` if
  attached, else empty.
- **vision_statement**: verbatim from
  `strategic_goals.goals_and_vision.church_vision` if attached, else
  empty.
- **key_message**: verbatim from
  `strategic_goals.voice_and_tone.one_key_message` if attached, else
  the doc's one-sentence positioning line.
- **sitemap_signals**: partner-stated needs that drove sitemap shape
  (e.g. Evangel's "make it too easy to watch from home is broken" is
  a signal that led to demoting the Watch page). Lift 3 to 6 signals
  from the doc.
- **topic_coverage_plan**: map every major topic named in the doc to
  the page slug that carries it (e.g. `{ "kids_ministry": "family",
  "baptism": "baptism", "give": "give" }`).
- **total_page_count**: count of unique pages in the doc across all
  phases.
- **existing_pages_to_carry_forward**: pages the doc explicitly says
  are being kept from the current site.
- **seo_aeo_geo_targets**: lift the doc's AEO/GEO section verbatim
  into a structured map. Primary keywords, secondary keywords, long-
  tail queries, page targets. Step 8 (plan-page-seo) will re-shape
  these into per-page plans downstream.
- **sources_used**: `['external_content_strategy_doc']`.

### 2. ministry_model (roadmap_state.ministry_model)

The doc's ministries section names each ministry with its own
posture. Classify against the standard MinistryModel enum:
- **family_first** — kids/teens/families are the hero, discipleship
  pathway centers on family life
- **discipleship_pathway** — Grow Tracks / classes / Bible study are
  the through-line
- **community_first** — Life Groups and community are the primary
  invitation
- **teaching_first** — Sunday teaching / sermon archive is the anchor
- **outreach_first** — missions / justice / neighborhood presence is
  the hero
- **worship_first** — Sunday worship experience is the anchor

Emit:
```
{
  model:            <primary>          // best-fit
  confidence:       0.8-1.0            // authored strategy = high confidence
  secondary_blend:  <secondary | null> // if the doc gives near-equal weight to a second
  blend_notes:      string | null      // 1-2 sentences on how the blend reads
  evidence:         string[]           // 3-5 verbatim phrases from the doc that justify
  rationale:        string             // 2-3 sentences explaining the pick
  cta_default:      string             // the doc's dominant CTA phrasing
                                       // (e.g. "Plan a Visit", "Find your people")
  _meta: ArtifactMeta
}
```

### 3. acf_plan (roadmap_state.acf_plan)

The Audience × Category × Funnel plan. For an ingested doc you're
emitting a compact form:
```
{
  modules:    []           // no ACF modules from a doc (they come from web_content_templates)
  taxonomies: []
  rationale:  string       // 2-3 sentences on how the doc structures audience/funnel
  cell_density: Record<`${audience}:${category}:${funnel}`, number>
                            // populate from the doc's page purposes
  coverage_gaps: string[]  // gaps the doc explicitly flags as "Phase 2" or "open"
  _meta: ArtifactMeta
}
```

Cell density: for every page in the doc, credit +1 to each cell the
page's purpose implies. Purposes are usually phrased "give visitors
a taste" (audience: visitor, funnel: discover), "help someone ready
to take the step" (audience: attender, funnel: commit), etc.

### 4. site_strategy (roadmap_state.site_strategy)

The load-bearing artifact. This is what step 7
(plan-cross-page-allocation) reads. Emit the full CoworkSiteStrategy
shape from `src/types/coworkBundle.ts`:

- **pages[]**: one entry per page in the doc, across all phases.
  Extract per-page:
  - `slug` (from the doc's URL, e.g. `/plan-a-visit` → `plan-a-visit`)
  - `name` (from the doc's page heading)
  - `purpose` (from the doc's "Strategic Purpose" line, ≤180 chars)
  - `primary_audience` (from the doc's inferred/stated persona)
  - `primary_funnel` (from the doc's phrasing — 'discover' for
    hero/awareness pages, 'consider' for about/beliefs, 'commit' for
    Plan a Visit / Baptism / Give / Grow Tracks)
  - `covers_cells` (populated from cell_density above)
  - `nav_order` (from Phase 1 nav order in the doc, or null for pages
    not in primary nav)
  - `nav_strategy` ('primary' | 'secondary' | 'footer' |
    'contextual_only' per the doc's nav decisions)
  - `has_children` (true when the doc names sub-pages, e.g. About
    with Our Story / Beliefs / Meet Our Team)

- **nav**: reproduce the doc's Navigation Architecture verbatim.
  - `primary`: Phase 1 items as `[{slug, children?}]`
  - `secondary` / `secondary_label`: any off-canvas / utility items
    the doc names
  - `footer` (GROUPED shape): parse the doc's Footer section into
    `primary_links`, `explore`, `legal`, `social`, `parked` (Phase 2
    items with a "reason: 'phase 2'" tag)
  - `cta_only`: sticky-CTA links (e.g. Give)

- **nav_change_level**: `full_rewrite` when the doc explicitly changes
  the current nav (usually the case); `partial` if it preserves the
  crawled spine with tweaks; `preserve` if the doc says "keep current
  nav". The doc's "why these decisions" narrative usually names this
  directly.

- **persona_journeys[]**: for each persona from stage_1, emit the
  journey the doc implies. The doc's page purpose statements usually
  chain naturally — e.g. "first-time visitor" journey walks Homepage
  → Plan a Visit → About → Family Ministries → Give. End every
  journey on a `commit`-funnel page.

- **pages_considered_dropped[]**: pages the doc explicitly says were
  considered and rejected, or moved to Phase 2 with a "we thought
  about this but…" rationale.

- **report**: page_count, nav_primary_count, pages_carried_forward,
  coverage_gaps_addressed, coverage_gaps_remaining. The doc's
  "Phase Summary" table drives coverage_gaps_remaining (Phase 2
  items are addressed later).

- **siteflow**: `homepage_arc` (the doc's homepage section list,
  ordered), `narrative_thread` (2-3 sentences on how the site reads
  top-to-bottom). Both usually visible in the doc's Homepage outline.

- **page_elevations[]**: for every ministry / topic the doc flags as
  strategic (e.g. Evangel's "Family Ministries" pulled forward, or
  Watch demoted), emit an entry with `topic`, `importance`, and
  `rationale`. Read the doc's "Why these decisions" or "Strategic
  Purpose" lines for the rationale.

- **voice_register_per_page_type**: register per page family (visitor
  pages read warmer / more practical, doctrinal pages read more
  measured, ministry pages read invitational). Lift from the doc's
  tone directives per-page.

- **key_info_to_highlight**: bullet-list of "what MUST appear where"
  from the doc's action items and cross-page notes (e.g. Evangel's
  "service times must appear on every page's footer" / "kids check-in
  process is a required section on Family Ministries").

- **rationale**: 3-5 sentence summary of why the sitemap looks this
  way, lifted from the doc's executive summary.

### 5. sitemap_review (roadmap_state.sitemap_review, status='approved')

The doc IS the approved sitemap review. Emit a full SitemapReview
per `src/lib/sitemapReview.ts` with:
- `status: 'approved'`
- `approved_by: 'staff'`
- `approved_at`: now
- `pages[]`: same as site_strategy.pages with `purpose`,
  `sitemap_tag` derived from nav_strategy, `is_nav_parent_only`
  when the doc lists a dropdown label with no destination
- `nav_layout`: derived from site_strategy.nav
- `footer_info`: extract the doc's footer content (service times,
  office hours, address, socials) into the FooterInfo shape
- `intro.headline`: "<Church Name> Website Content Strategy"
- `intro.body`: 2-3 sentence pull from the doc's executive summary
- `executive_summary`: verbatim from the doc's Executive Summary block
- `navigation_strategy`: verbatim from the doc's "Why these decisions"
  narrative

Every page purpose the strategist could edit later must be present so
the review reads correctly when opened for reference.

## Persist — column-free chunked write

Same rule as plan-site-strategy: use the four-step chunked scratch
pattern so no single SQL statement exceeds ~8KB. Wrap the final
`roadmap_state_set` in `IS NOT NULL` to swallow the ~300KB return
payload. See `plan-cross-page-allocation/SKILL.md` §Persist for the
canonical template.

Chunk keys to stage under `_chunks`:
- `stage_1`, `ministry_model`, `acf_plan`, `site_strategy`,
  `sitemap_review`

Assemble each into its own `roadmap_state.<key>` in the final commit.

After the assemble step, sanity-check the shape with:

```sql
SELECT
  (roadmap_state->'stage_1'       ? '_meta') AS stage_1_ok,
  (roadmap_state->'ministry_model'? '_meta') AS ministry_ok,
  (roadmap_state->'acf_plan'      ? '_meta') AS acf_ok,
  (roadmap_state->'site_strategy' ? '_meta') AS strategy_ok,
  (roadmap_state->'sitemap_review'->>'status') AS sm_status
FROM strategy_web_projects
WHERE id = '{{project_id}}'::uuid;
```

Expected: every `_ok` true, `sm_status = 'approved'`.

## Self-checks before you persist

Before writing anything, verify:

1. **Every page in the doc has a matching entry in
   `site_strategy.pages[]`.** Compare your page slugs to the doc's
   URL list (Phase 1 + Phase 2). Missing pages = incomplete ingest.
2. **Nav shape matches the doc's Navigation Architecture section
   verbatim.** Same primary items in same order. Same dropdown
   groupings. Same footer items.
3. **Persona journeys terminate at a `commit`-funnel page.** No
   dead-end journeys.
4. **`sitemap_review.status === 'approved'`.** The whole point of
   this skill is to short-circuit steps 1-6, so this stamp must land
   or the app will still treat the project as awaiting review.
5. **`_meta.skill_name === 'ingest-external-content-strategy'` on
   every artifact.** Downstream tools inspect this to know the
   provenance — e.g. the "Compute now" button on Dev Handoff, the
   Content Engine step display.
6. **`_meta.generated_at`** carries the same ISO timestamp across
   all four artifacts so re-run detection works cleanly.
7. **No hallucinated pages, personas, or ministries.** Everything
   maps back to the doc. When the doc is silent, leave the field
   empty (or use a defensible default named in this SKILL) rather
   than invent.

## Handoff notes for step 7

After you commit, tell the strategist:

> Content strategy ingested. Steps 1-6 are marked done; the sitemap
> is approved as canonical. Step 7 (plan-cross-page-allocation) is
> ready — but note this partner has an external content collection
> and no crawl inventory. Step 7 will need to rely on the doc's page
> purposes + partner-supplied assets rather than atoms + facts pools.
> If a content_collection session exists for this project, its
> supplemental submissions are still available; otherwise the AM
> should provide any partner-supplied copy separately before step 7
> runs.

That's the load-bearing note the plan-cross-page-allocation skill
will read in its `prior_handoff_notes`.
