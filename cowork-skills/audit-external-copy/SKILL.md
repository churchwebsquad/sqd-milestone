---
name: audit-external-copy
description: |
  Replaces outline-page + draft-page + critique-page for projects
  where copywriting was already in progress externally (Notion
  database). Walks the partner's Notion DB via Notion MCP, BINDS each
  Notion section to a canonical Brixies template_key + maps content
  into cowork_writable_slots, resolves overflow (split / substitute /
  truncate), scores the bound copy on the 5 axes, and writes THREE
  artifacts per page: page_outlines.<slug> (template + slot binding),
  page_drafts.<slug> (slot values), page_critiques.<slug> (5-axis
  scoring + directives). The outline + draft are what the importer
  needs to insert pages into Brixies — without them the audit branch
  produces only feedback, not a shippable build.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '2.0.0'
references:
  - ../critique-page/references/audit-criteria.md
---

# Audit External Copy

You take copy the partner already wrote in Notion and turn it into a
Brixies-importable build: pick the right canonical template for each
section, map the Notion content into the template's slots, resolve
any overflow, and score what you produced. Three artifacts per page:
outline (template + slot binding), draft (slot values), critique
(5-axis scoring). The strategist sees a final report; the importer
ingests the outline+draft like any other branch.

This skill replaces the standard outline → draft → critique trio for
the audit branch — one autonomous pass over the whole sitemap rather
than three cowork sessions × N pages. You walk pages without prompting
the strategist; the report at the end surfaces everything for review.

## Why three artifacts (not just a critique)

Earlier versions of this skill wrote only `page_critiques.<slug>` —
that gave the strategist feedback but left the partner's Notion copy
unimportable, because the importer needs `page_outlines.<slug>`
(template + slot binding) and `page_drafts.<slug>` (slot values) to
insert pages into Brixies. The Brixies bind step in the standard
pipeline lives in draft-page; in the audit branch it has to live
here, or the audit produces feedback no one can ship.

The decisions you make for the formatting axis ARE the binding —
when you say "this section maps to feature_team but overflows the
2-item cap," you've already decided template_key + identified the
slot mismatch. Now persist that decision as `page_outlines.<slug>`
and write the slot values as `page_drafts.<slug>`.

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
    pickable_templates:     string[]                          // EMIT ONLY FROM THIS LIST
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

### 2. Bind each Notion section to a canonical template

Read the Notion body's structural shape. Split into sections — each
heading-2 (or heading-3 if no h2 exists in the page) starts a new
section that runs until the next heading at the same level.

For each section, decide three things — these BECOME the outline +
draft for the page:

**(a) Pick a `template_key`** from `canonical_templates.pickable_templates` (the bundle's allow-list of templates whose `uniform_to_brixies` mapping is grounded in real Brixies schemas). Emitting a `template_key` NOT in `pickable_templates` is a hard error — the handoff translator can't bind it. Match by section role + content shape:

  - Lead-in / opener at top of page → `hero_homepage` (home only) or `hero_inner` (every other page)
  - Card list / 3-item feature → `content_featured_a` (with palette) or `content_image_text_a`
  - 2-column content → `content_image_text_b`
  - Accordion-shaped FAQ → `accordion_faq`
  - Final CTA → `cta_simple` or `cta_callout`
  - Team / staff → `feature_team`
  - Testimonials → `testimonial_written` / `testimonial_video`
  - Timeline / story → `timeline_story`
  - Contact / address block → `contact_section`
  - Video content → `content_video`
  - Career listings → `career_section`
  - Generic prose with no card structure → `content_image_text_b`

**(b) Resolve overflow** — when the Notion content exceeds the
picked template's slot caps, RESOLVE it (don't just flag). Three
moves, in preference order:

  1. **SUBSTITUTE template** — if another `template_key` in the
     manifest fits the actual content count + shape, pick it.
     Example: 6 staff with `feature_team` (cap 2) → check if a
     `feature_team_grid` or similar exists. If so, use that.
  2. **SPLIT into N sections** — same `template_key`, repeated.
     6 staff → 3× `feature_team` sections (2 each), each with its
     own primary_heading ("Lead Pastors" / "Staff Pastors" /
     "Support Team" — derive groupings from titles when possible,
     otherwise just "Staff (1 of 3)" / "Staff (2 of 3)" / etc.).
     8 items → 2× sections of 4.

     **SPLIT marker contract — REQUIRED**: every section produced by
     a SPLIT MUST stamp two fields on its `_meta` so the handoff
     endpoint can group siblings without inference:
       - `split_from`: a stable string identifying the original
         Notion section (use the original heading text — e.g.
         `"Staff"` — verbatim from the Notion page).
       - `split_position`: 1-based index within the split group
         (1, 2, 3 for a 3-way split).
     Standalone (non-split) sections leave both fields absent.
     Example metadata on outline section #2 of a 3-way staff split:
     ```json
     "_meta": {
       "audit_source": "notion",
       "notion_page_id": "<id>",
       "notion_url":     "<url>",
       "split_from":     "Staff",
       "split_position": 2
     }
     ```
     The handoff endpoint mints ONE `split_group_id` UUID per unique
     `(notion_page_id, split_from)` pair and stamps it on every
     web_section in the group. Without the marker, the importer has
     no way to detect groupings + the audit-tab UI can't render
     "split 2 of 3 from one Notion section" — so the marker is the
     load-bearing contract.
  3. **TRUNCATE + defer** — only when SUBSTITUTE and SPLIT both
     fail (e.g. 12 FAQ items, `accordion_faq` cap 5, no other
     accordion variant). Keep the top N items by priority; surface
     the deferred ones in `deferred_atoms[]` on the draft AND as a
     directive on the critique so the strategist sees what was cut.

For body / heading / item-body overages: TRIM (paraphrase down to
the cap, preserving the partner's voice from `stage_1.voice_exemplars`)
or SPLIT (two short sections instead of one overflowing one).

**(c) Map content into slots**. Per the picked template's
`cowork_writable_slots`:
  - `tagline` (eyebrow) ← any short kicker line, if present
  - `primary_heading` ← the section heading (or partner-supplied h2)
  - `body` ← the section's descriptive prose (≤400 chars, trim if needed)
  - `accent_body` ← only on templates that have it (content_video etc.)
  - `items[]` ← each card / list item / staff member / etc., with
    `item_heading`, `item_body`, and optional `item_meta` (role,
    date, location, etc.) per the template's `item_subfields`.
  - `buttons[]` ← CTAs found in the section (label + url). Max
    per template's `buttons.max_items`. Map button URLs to fact
    rows in `facts_pool` when possible (e.g. /give → giving fact).

**Validate before continuing**: every slot with `required: true`
in the template's `cowork_writable_slots` MUST have a value. If a
required slot is empty after binding, either pull from another
section nearby, OR emit a `required_slot_unfilled` directive on
the critique and use a placeholder string the strategist can fix.

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

### 5. Write THREE artifacts per page

THREE Supabase MCP writes per page. Same `audit_source = 'notion'` on
every `_meta` block so synthesize-critique + the downstream importer
can tell where these artifacts came from.

**(a) `page_outlines.<slug>`** — the template + slot-binding plan.
Shape mirrors what outline-page would produce in the standard branch:

```json
{
  "page_slug": "<slug>",
  "page_type": "<inferred: home / plan_visit / about / ministry / serve / give / connect / belief / staff / practical / other>",
  "page_promise": "<one-sentence aggregate promise of the page>",
  "sections": [
    {
      "section_intent_id": "<short id, e.g. 's1-hero'>",
      "template_key": "<chosen template>",
      "flow_role": "<hook / orient / inform / reassure / invite / deepen>",
      "section_job": "<one-sentence what this section does>",
      "intended_verbatim_band": "<from strategic_goals copy_approach.derived.intended_verbatim_band>",
      "atom_assignments": [
        { "slot": "primary_heading", "source": "notion:<heading text>" },
        { "slot": "body",             "source": "notion:<paragraph>" },
        { "slot": "items",            "source": "notion:<card group>" }
      ],
      "voice_anchor": "<a stage_1.voice_exemplars phrase the section voice should align with>"
    }
  ],
  "_meta": {
    "audit_source": "notion",
    "notion_page_id": "<id>",
    "notion_url":     "<url>",
    "generated_at":   "<iso>"
  }
}
```

```sql
SELECT roadmap_state_set('<project_id>'::uuid, ARRAY['page_outlines', '<slug>'], '<outline_jsonb>'::jsonb);
```

**(b) `page_drafts.<slug>`** — the actual slot values, ready for the importer.

```json
{
  "page_slug": "<slug>",
  "sections": [
    {
      "section_intent_id": "s1-hero",
      "template_key":      "hero_inner",
      "slot_values": {
        "primary_heading": "Plan a Visit",
        "tagline":         "...",
        "body":            "...",
        "accent_body":     "...",
        "items":           [
          {
            "item_heading":   "...",
            "item_body":      "...",
            "item_meta":      "...",
            "item_cta_label": "...",   // optional — preserve per-item CTA label if Notion has one
            "item_cta_url":   "..."    // optional — preserve per-item CTA href if Notion has one
          }
        ],
        "buttons":         [
          {
            "label": "...",
            "url":   "...",
            "kind":  "primary"          // optional — 'primary' | 'secondary'
          }
        ]
      },
      "atoms_used":         [],
      "facts_used":         ["<fact_id>"],
      "crawl_topics_used":  [],
      "deferred_atoms":     [],
      "actual_verbatim_ratio": 0.85,
      "voice_notes":        "Lifted from Notion verbatim; matches stage_1 voice posture."
    }
  ],
  "_meta": {
    "audit_source": "notion",
    "notion_page_id": "<id>",
    "notion_url":     "<url>",
    "generated_at":   "<iso>"
  }
}
```

Source-tracking on the draft: every Notion lift counts as verbatim
when it matches an atom / fact / crawl-passage body. When the Notion
copy DOESN'T trace back to a source (partner wrote it fresh in
Notion), still include it — but report `actual_verbatim_ratio` based
on the share that DOES trace. Don't fabricate atom_ids.

### Capture rules — VERBATIM is the default

The audit's whole reason for existing is that the partner provided
copy. Lifting it 1:1 IS the win condition. The most common ways this
skill has hurt the strategist:

1. **Strategist-placed gap markers are not content — preserve
   verbatim.** Recognized marker shapes (treat the entire run as
   ONE atomic string):
   - `[NEEDS INPUT: ...]` — explicit placeholder for missing data.
     Often carries starter options ("react to: 'A.' / 'B.' / 'C.'")
     — those are prompts to the client, NOT picks. Never substitute
     one option as final copy.
   - `*pending: ...*` — italicized strategist note (e.g. `*pending:
     confirm email domain*`). Belongs in `item_meta` or appended to
     the slot it annotates.
   - `*photo: [NEEDS INPUT: ...]*`, `*image: [NEEDS INPUT: ...]*`
     — per-item asset placeholders for staff bios, cards, etc.
     Preserve in `item_meta`; do NOT route into the image slot
     (cowork never fills image slots — those stay
     Brixies-designer-bound).
   - `\[NEEDS INPUT\]` / `\[NEEDS INPUT: ...\]` — same as above
     when Notion has escaped the brackets in markdown.

   The handoff renderer recognizes these via `isNeedsInput()` in
   coworkToBrixies.ts: visible text shows the marker so the
   strategist sees the gap; URL slots blank the href so it doesn't
   become a broken literal-text link. NEVER substitute, paraphrase,
   or summarize a marker. NEVER drop it.

2. **Capture every CTA — primary, secondary, AND per-item.** Notion
   sections often have multiple CTAs:

   ```
   ## Final CTA Section
   - Primary CTA: **Plan a Visit** → `/plan-a-visit`
   - Secondary CTA: **Watch the Latest Message** → `/watch`
   ```

   This becomes `buttons: [{label, url, kind: "primary"}, {label,
   url, kind: "secondary"}]`. NOT a single button.

   When ITEMS have CTAs (cards grids, ministry spotlights, policy
   lists):

   ```
   **Card 1**
   - *Headline:* **Vineyard Kids**
   - *Body:* Secure check-in...
   - *CTA:* Learn About Vineyard Kids → `/kids`
   ```

   This becomes `items: [{item_heading, item_body, item_cta_label:
   "Learn About Vineyard Kids", item_cta_url: "/kids"}]`. Dropping
   the per-item CTA is a structural loss the importer cannot
   recover.

3. **Don't drop or merge Notion sections.** Every `##` heading in
   the Notion page body (except metadata blocks: Strategic Purpose,
   Personas, Phase, Slug, Part 1: Strategic Setup, Sources
   Referenced, Gaps Flagged) becomes ITS OWN section in the draft.
   Do not combine "Hero" + "Service Times" into one section. Do
   not skip "Newsletter Signup" because it feels small. Sub-section
   `###` headings inside a `##` MAY group as a single section if
   they're tightly coupled, but only with explicit reasoning in
   `voice_notes`.

4. **Respect template hints written into Notion section headings.**
   The strategist annotates the structural intent right in the
   heading. Match these to `pickable_templates`:

   | Notion hint contains | Pick template_key |
   |---|---|
   | "Hero" / "Hero Section" | hero_homepage (home) / hero_inner (inner pages) |
   | "Cards Grid" / "Spotlights" + per-card CTAs | `cards_with_cta` (feature-section-103) |
   | "Cards Grid" / "Spotlights" without per-card CTAs | `content_featured_a` |
   | "Quick-Info" / "Band" / "Service Times" | `cta_simple` |
   | "Newsletter" / "Signup" | `cta_simple` or `cta_callout` |
   | "Mission" + quote | `content_video` (gives a pull-quote treatment) |
   | "First-Visit" + paragraph | `content_image_text_b` |
   | "FAQ" / "Accordion" / "Statement of Faith" | `accordion_faq` |
   | "Team" / "Staff" / "Leadership" | `feature_team` |
   | "Testimony" / "Quote" | `testimonial_written` / `testimonial_video` |
   | "Timeline" / "Story" | `timeline_story` |
   | "Contact" / "Address" | `contact_section` |
   | "Final CTA" / "Page Visitor Actions" | `cta_callout` |

   If two templates could fit, pick the one with the closer slot
   shape match. A "Cards Grid" where the source has per-card CTAs
   MUST pick `cards_with_cta`, not `content_featured_a` — the
   latter cannot hold the CTA URLs and will silently drop them.

```sql
SELECT roadmap_state_set('<project_id>'::uuid, ARRAY['page_drafts', '<slug>'], '<draft_jsonb>'::jsonb);
```

**(c) `page_critiques.<slug>`** — 5-axis scoring + directives, same
shape as critique-page's standard output. `_meta.handoff_note`
≤1 screen: what was audited + bound, top 3 directives, overall_band,
any partner-input asks (sermon series name, contact info to
verify, etc.).

```sql
SELECT roadmap_state_set('<project_id>'::uuid, ARRAY['page_critiques', '<slug>'], '<critique_jsonb>'::jsonb);
```

Three writes per page in this order: outline → draft → critique
(outline references drive the draft; the draft drives the critique).
If a write fails, surface the error and STOP — don't continue to
the next page until the strategist clears it.

## Final report — surface to strategist after ALL pages

When all sitemap pages have been processed (audited OR placeholder-
written for gaps), produce ONE consolidated report in conversation:

```md
# Audit complete — <N> pages

## Summary
- **<X> audited + bound** (outline + draft + critique written for each) — <green count> green / <yellow count> yellow / <red count> red
- **<Y> gaps** (no Notion match) — supplemental-page-authoring will write copy for these:
  - <slug-1>
  - <slug-2>
  - ...

## Brixies binding summary
- Template distribution: <e.g. 19 hero_inner, 11 feature_team, 7 content_image_text_b, ...>
- Overflow resolutions: <N> SPLITs / <N> SUBSTITUTEs / <N> TRUNCATEs
- Pages with TRUNCATED content (deferred items the strategist should review):
  - <slug>: <which items got cut, where they're tracked>

## Top content issues (sorted by frequency)
- `body` trim required on <N> pages (avg <chars-over> chars over before trim)
- `items` count overflow handled on <N> pages (SPLIT/SUBSTITUTE applied)
- `required_slot_unfilled` on <N> pages (placeholder set, strategist must fill)
- Source / contact drift between Notion and `facts_pool` on <N> pages

## Partner-input asks (batch into one AM ping)
- <slug>: <what the partner needs to clarify, e.g. "current sermon series name">
- ...

## Verbatim-band misses
- <slug> — band=<approved>, observed=<measured> (drift=<delta>)
- ...

## Strategist next steps
1. Review the <yellow + red count> flagged pages in the workspace.
2. Send the partner-input asks to the AM as one batch.
3. Run **synthesize-critique** when satisfied — produces the project-level rollup. The importer can ingest the outlines + drafts after that.
```

Do not prompt for confirmation per page. Walk all pages, write all
three artifacts per page, surface the report once. The strategist
reads the report and decides whether to drill in.

## Hard rules

- THREE Supabase MCP writes per page (outline → draft → critique).
  Reads via Notion MCP are fine (that's how you walk the DB) — but
  don't fan out additional `roadmap_state_set` calls per section.
- Resolve overflow during binding (SPLIT / SUBSTITUTE / TRUNCATE).
  Don't ship an outline whose section would overflow its template's
  slot caps — the importer rejects those.
- Don't invent atom/fact ids in `atoms_used` / `facts_used`. Only
  reference rows that exist in the bundle's `atoms_pool.by_id` /
  `facts_pool.by_id`. Notion-original copy with no source lift
  gets reported in `actual_verbatim_ratio` but no fake source ids.
- If `notion_audit_branch` is null in the bundle, the project isn't
  on the audit branch — stop, surface to the strategist (they're
  probably running you on the wrong project).
- If Notion MCP returns a permission / access error on
  `query_database`, surface it verbatim. The strategist needs to
  share the database with the integration or fix the URL.
- Slugs are computed from Notion page titles (lowercase, non-alphas →
  dashes). If two pages slugify to the same key, append `-2`, `-3`
  in Notion's sort order and flag the collision in the final report.
