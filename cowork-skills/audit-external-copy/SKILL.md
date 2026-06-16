---
name: audit-external-copy
description: |
  Replaces outline-page + draft-page + critique-page for projects
  where copywriting was already in progress externally (Notion
  database). Walks the sitemap autonomously, matches each page to
  a Notion page by slug, scores existing copy on the 5 axes
  (dignity / voice / persona / source_coverage / claim_plausibility),
  AND audits structure against canonical_templates' slot vocab
  (formatting axis). Pages with no Notion match get a placeholder
  critique flagged for supplemental-page-authoring.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
references:
  - ../critique-page/references/audit-criteria.md
---

# Audit External Copy

You audit copy the partner already wrote. You do not generate. You do
not redesign. You check what's there against the foundations + the
canonical templates, score it on the 5 axes, and flag pages that need
supplemental authoring because no Notion match exists.

This skill replaces the standard outline → draft → critique trio for
the audit branch — one autonomous pass over the whole sitemap rather
than three rounds × N pages. You walk pages without prompting the
strategist; the report at the end surfaces everything for review.

## Strategic Goals — inputs you MUST consume

From `strategic_goals_approved` (already filtered to status='approved'):

- **`goals_and_vision.church_vision`** — the partner's stated emotional
  outcome. Dignity axis rationale references this verbatim when applicable.
- **`voice_and_tone.one_key_message`** — the core message every page
  should echo somewhere. Persona-fit + voice axis check for it.
- **`voice_and_tone.recurring_message_theme`** — voice posture anchor.
- **`content_and_allocation.copy_approach.derived.intended_verbatim_band`**
  — every section's effective verbatim ratio (lines lifted from crawl
  source vs paraphrased vs fresh) should land in band (high ≥0.7,
  mid 0.3-0.7, low ≤0.2). For external copy, "verbatim" measures how
  closely the Notion copy mirrors the partner's pre-existing source
  language (crawl passages, intake docs, brand brief).
- **`content_and_allocation.ministries_to_grow`** — pages tied to
  named ministries get a coverage check: does the Notion copy
  surface these ministries early + with a clear CTA?

## Your input — bundle for foundations, Notion MCP for the pages

The strategist attached `cowork-pipeline.<partner>.project-bundle.json`.
Read the foundations from there (atoms, facts, stage_1, strategic
goals, canonical templates). **Walk the Notion database itself via
Claude Desktop's Notion MCP** — earlier versions of this skill
pre-fetched every page body server-side into `pages_by_slug`, but
that path was fragile (Notion's 3-req/s API limit + edge-function
execution budget) and the audit dead-ended whenever the pre-fetch
failed. Doing the walk via your own MCP is lazy, reliable, and lets
you reason about content while reading it.

**MCP usage pattern**:
- Notion MCP: `list_databases` / `query_database` / `retrieve_page` /
  `retrieve_block_children` — to walk the DB and read each page.
- Supabase MCP: ONE `roadmap_state_set` write per page (the critique).

Bundle keys you consume:

```ts
{
  stage_1:                    CoworkStage1                  // voice, personas, ethos
  ministry_model:             CoworkMinistryModel           // page-treatment context
  strategic_goals_approved:   { ... approved-only buckets }
  canonical_templates: {                                     // slot vocab
    page_section_templates: Record<string, { cowork_writable_slots }>
  }

  atoms_pool:        { by_id, by_topic }                    // for source-coverage axis
  facts_pool:        { by_id, by_topic }
  crawl_topics_pool: { by_key }                             // for verbatim-band measurement

  /** Audit-branch signal — tells you to walk Notion. */
  notion_audit_branch: {
    database_id:  string   // pass this to Notion MCP query_database
    database_url: string   // human-readable click-through
    // pages_by_slug INTENTIONALLY ABSENT — you walk Notion yourself.
  }
}
```

**Sitemap source.** In the audit branch, the partner's Notion DB IS
the sitemap — one Notion page = one sitemap entry. There is NO
`sitemap_pages` array in the bundle (it would just duplicate Notion).
Walk the DB in Notion's sort order via `query_database`; the page
titles slugify into your output keys (lowercase, non-alphanumerics
→ dashes, e.g. "Plan a Visit" → `plan-a-visit`).

**Allocation.** There is NO `allocations_by_page`. Notion copy IS
the allocation. Your audit measures the existing copy against the
foundations (atoms / facts / voice / ministry model) + the
canonical-template slot vocab — not against a separately-planned IA.

**Don't flag "missing" fields that are missing BY DESIGN.** The
audit-branch bundle is deliberately slim. Treat the following as
expected absence, not as bundle corruption:

| Field | Expected when audit branch is on |
|---|---|
| `sitemap_pages` | EMPTY — derive from Notion |
| `allocations_by_page` | ABSENT — Notion is the allocation |
| `build_directives_by_page` | EMPTY — no allocation step ran |
| `notion_audit_branch.pages_by_slug` | ABSENT — you walk Notion yourself |
| `prior_handoff_notes.*` | Mostly NULL — no outline/draft/critique steps run upstream |
| `crawl_topics_pool` | MAY be empty if the project skipped the crawl (e.g. partner uploaded Notion instead). Score source-coverage + verbatim-band against atoms_pool + facts_pool alone in that case — don't treat the empty crawl as a problem. |

Do NOT include "the bundle came through degraded" or similar
notes in the final report unless something you actually NEED is
missing (e.g. `notion_audit_branch.database_id` itself is null,
which would mean the project hasn't opted into the audit branch
and you shouldn't be running).

## Walk the sitemap autonomously

### 1. List the Notion DB pages

Call Notion MCP `query_database(database_id=notion_audit_branch.database_id)`
once at the top to get the full page list. Walk in Notion's returned
order (which is the partner's sort).

For each Notion page:
- Extract the title (the page's `properties.title` rich-text run).
- Slugify: lowercase, non-alphanumerics → dashes, collapse runs.
  ("Plan a Visit" → `plan-a-visit`, "About Us" → `about-us`).
- Fetch the body via `retrieve_block_children(page_id, recursive=true)`.

The slug is your `page_slug` for both the critique write key and the
strategist-facing report.

### 2. Audit body formatting against canonical_templates

Read the Notion body's structural shape. For each visible section
(typically a heading-2 or heading-3 starting a new block):

- Infer the most-likely `template_key` from `canonical_templates.page_section_templates`. Match by section role + content shape:
  - Lead-in / opener → `hero_homepage` (home) or `hero_inner` (every other)
  - Card list / 3-item feature → `content_featured_a` (with palette) or `content_image_text_a`
  - 2-column content → `content_image_text_b`
  - Accordion-shaped FAQ → `accordion_faq`
  - Final CTA → `cta_simple` or `cta_callout`
  - Team / staff → `feature_team`
  - Testimonials → `testimonial_written` / `testimonial_video`
  - Timeline / story → `timeline_story`
  - Contact / address block → `contact_section`
- Verify against the picked template's `cowork_writable_slots`:
  - `primary_heading.max_chars` (typically 100) — over? flag.
  - `body.max_chars` (typically 400) — over? flag.
  - `items[].max_items` — too many bullets / cards? flag.
  - `items[].item_subfields.item_heading.max_chars` / `item_body.max_chars` — same.
  - `buttons.max_items` (typically 2) — too many CTAs? flag.
  - `tagline.max_chars` (typically 60) — over? flag.

Capture each violation as a directive:

```json
{ "kind": "formatting_overage", "severity": "warning",
  "section": "<heading or slug>", "slot": "body",
  "detail": "412 chars vs 400 cap (12 over). Trim or split." }
```

If a section doesn't fit ANY template, surface that too:

```json
{ "kind": "formatting_unmatched_section", "severity": "warning",
  "section": "<heading>",
  "detail": "Section shape doesn't fit any canonical template. Either restructure or add to a content_image_text_b body." }
```

### 3. Score the 5 axes (use the standard rubrics)

Reference `references/audit-criteria.md` (loaded from the
critique-page skill bundle the strategist also has). Score each axis
0-100 with pass/fail:

- **dignity** — does the copy treat the audience with respect? does
  it match `church_vision`? Cite `church_vision` verbatim in the
  rationale when applicable.
- **voice_character** — does it match `stage_1.voice_exemplars`?
  hit `stage_1.voice_anti_exemplars`? Honor `recurring_message_theme`?
- **persona_fit** — does the copy speak to `primary_persona` from
  the sitemap entry?
- **source_coverage** — which atoms / facts / crawl_topics are
  referenced or paraphrased? Identify lifts from `atoms_pool.by_id`
  (or by_topic) bodies, `facts_pool.by_id` fields, `crawl_topics_pool.by_key`
  passages. Flag fabricated claims (specific names / numbers / dates
  not in any source).
- **claim_plausibility** — anything that looks like an invention
  (specific staff names without source, made-up service times,
  dollar amounts, denominational claims)?

### 4. Compute overall_band

Per the rubric in audit-criteria.md:
- All axes ≥75 with zero blocker directives → `green`
- Any axis 50-74 OR any warning directive → `yellow`
- Any axis <50 OR any blocker directive → `red`

### 5. Write the critique

ONE MCP call:

```sql
SELECT roadmap_state_set(
  '<project_id>'::uuid,
  ARRAY['page_critiques', '<page_slug>'],
  '<full_critique_jsonb>'::jsonb
);
```

The critique's shape mirrors the standard critique-page output, plus:
- `_meta.audit_source = 'notion'`
- `_meta.notion_page_id` + `_meta.notion_url`
- `_meta.handoff_note` (≤1 screen): what was audited, top 3 violations,
  overall band, any flag for the strategist (verbatim-band miss,
  vision-fit gap, missing key_message reflection).

## Final report — surface to strategist after ALL pages

When all sitemap pages have been processed (audited OR placeholder-
written for gaps), produce ONE consolidated report in conversation:

```md
# Audit complete — <N> pages

## Summary
- **<X> audited** (matched a Notion page) — <green count> green / <yellow count> yellow / <red count> red
- **<Y> gaps** (no Notion match) — supplemental-page-authoring will write copy for these:
  - <slug-1>
  - <slug-2>
  - ...

## Top formatting violations (most-frequent)
- `body` overage on <N> pages (avg <chars-over> chars over)
- `primary_heading` overage on <N> pages
- `items` count overage on <N> pages
- ...

## Verbatim-band misses
- <slug> — band=<approved>, observed=<measured> (drift=<delta>)
- ...

## Vision-fit gaps
- <slug> — `church_vision` not reflected; recommend revision.
- ...

## Strategist next steps
1. Review the <yellow + red count> flagged pages in the workspace.
2. Launch **supplemental-page-authoring** to fill the <Y> gap pages.
3. Run **synthesize-critique** when satisfied with the audit results.
```

Do not prompt for confirmation per page. Walk all pages, write all
critiques, surface the report once. The strategist reads the report
and decides whether to drill in.

## Hard rules

- ONE Supabase MCP write per page. Reads via Notion MCP are fine
  (that's how you walk the DB) — but don't run per-section
  `roadmap_state_set` calls.
- Do not invent missing slots — flag them, don't fill them.
- Do not rewrite copy. The audit is read-only against page_critiques.
- If `notion_audit_branch` is null in the bundle, the project isn't
  on the audit branch — stop, surface to the strategist (they're
  probably running you on the wrong project).
- If Notion MCP returns a permission / access error on
  `query_database`, surface it verbatim. The strategist needs to
  share the database with the integration or fix the URL.
- Slugs are computed from Notion page titles (lowercase, non-alphas →
  dashes). If two pages slugify to the same key, append `-2`, `-3`
  in Notion's sort order and flag the collision in the final report.
