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
- Notion MCP: `query_database` / `notion-fetch` (page_id) /
  `retrieve_block_children` — to walk the DB and read each page.
- Supabase MCP: up to FOUR `roadmap_state_set` writes per page —
  outline, draft, critique, and `cowork_page_meta` (when the page
  has a `# SEO` block and/or `## GAPS FLAGGED` block). Plus ONE
  project-level `global_footer` write (when a Type=Footer row or
  `## GLOBAL FOOTER` block is present).

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

### 1. List the Notion DB pages, filter by Type, derive slug map

Call Notion MCP `query_database(database_id=notion_audit_branch.database_id)`
once at the top to get the full page list. The partner's copywriter
filed each row with a `Type` property — read it and BRANCH:

| `Type` | What to do |
|---|---|
| `Page` / `Nav+Page` | Walk body → outline + draft + critique (Steps 2-4). |
| `Footer` | Walk body → write to `roadmap_state.global_footer` (one per project). No outline/draft/critique. |
| `Nav Item` / `Link` | **Skip entirely.** Sitemap-only nodes; no page body to bind. |
| (anything else, or template rows like "New Page" / "New Nav Item" / "Add Footer") | Skip — those are Notion's template scaffolds, not real pages. |

`Type` is the ONLY Notion-property the SKILL reads. Slug, Categories:
Style Guide, designer-notes columns — all IGNORED. Everything else
comes from parsing the partner's body markdown.

**Slug derivation — footer pre-pass.** Before processing pages, walk
the Footer row's body (if Type=Footer exists) OR the Homepage's
`## GLOBAL FOOTER` block, and extract a `title → /slug` map from its
"Quick Navigation" bulleted list:

```
- I'm New → /new
- Worship → /worship
- Children & Youth → /children-youth
```

builds `{ "I'm New": "/new", "Worship": "/worship", … }`.

For each subsequent page row:
- Extract the page title (`properties.title`).
- `slug = slug_map[title] ?? (title.toLowerCase() in {"home","homepage","index"} ? "/" : kebab(title))`
  where `kebab(title)` = lowercase + non-alphanumerics → dashes,
  collapse runs ("Plan a Visit" → `plan-a-visit`). This honors the
  partner's URL plan without consuming the Notion `Slug` column.
- Fetch the body via `retrieve_block_children(page_id, recursive=true)`
  OR `notion-fetch(page_id)` — the latter returns enhanced markdown
  which is easier to parse and includes inline marker formatting.

The slug is your `page_slug` for the roadmap_state write keys.

### 2. Parse the page body into sections + slot bindings (VERBATIM)

The partner's body is structured prose with explicit slot labels they
wrote themselves (`**H1:**`, `**Tagline:**`, `**CTA 1:**`, italic
`*[Image: …]*` / `*[Map embed: …]*` markers, per-item Buttons, a
page-final `## GAPS FLAGGED` block). Your job is to read it
top-to-bottom and emit a verbatim-preserved structure — never
paraphrasing, never truncating, never dropping an italic note. The
char caps Brixies templates declare are **advisory only** in this
branch: render every character. If the layout stretches, the
strategist resolves it in the workspace via the variant picker.

**(a) Page-top `# SEO` block.** Capture as `cowork_page_meta.seo`:

```json
{
  "raw_block":         "<verbatim markdown of the entire # SEO H1 block>",
  "primary_keywords":  ["...", "..."],
  "secondary_keywords":["...", "..."],
  "local_keywords":    ["...", "..."],
  "meta_title":        "First Presbyterian Church of Charlotte | Uptown, NC",
  "meta_description":  "First Presbyterian Church of Charlotte is …",
  "aeo_snippet":       "First Presbyterian Church of Charlotte is a Presbyterian Church (USA) …"
}
```

Parse each `**PRIMARY KEYWORDS:**`, `**SECONDARY KEYWORDS:**`,
`**LOCAL KEYWORDS:**`, `**METADATA TITLE:**`, `**METADATA
DESCRIPTION:**`, `**AEO SMART SNIPPET:**` block — extract the value
after each label. Trailing parenthetical notes like
`*(57 characters)*` are partner annotations, drop from the field
value but preserve the raw block intact. The `raw_block` is the
audit traceability source — write it verbatim. This page-level
write is what `web_pages.seo_metadata` will hold after handoff.

**(b) Page-final `## GAPS FLAGGED` block.** Capture as
`cowork_page_meta.gaps_flagged` — every bullet becomes an entry
verbatim:

```json
[
  { "note": "Say Grace podcast link: Podcast URL and embed player not yet live …", "kind": "partner_flagged" },
  { "note": "Featured events section: Dynamic vs. manual management to be determined by developer.", "kind": "partner_flagged" }
]
```

This block is the partner's OWN flagged gaps — distinct from the
SKILL-generated critique directives. Preserve every word, every
sub-bullet. Both land alongside each other in the workspace.

**(c) Section delimiters.** H2 (`## …`) starts a new section that
runs until the next H2 (or end-of-body). The H2 text becomes the
section's **display name only** — render it as part of the
section's heading slot when applicable, but never use it as a
routing signal for which Brixies layout to pick (Step 3 makes that
call by content shape alone).

Skip-list — these H2 blocks are page-level metadata, not body
sections (they get captured at the page level or are pure handoff
checks):

- `## GLOBAL FOOTER` → captured to `roadmap_state.global_footer`
  (one per project; see (g) below)
- `## GAPS FLAGGED` → captured to `cowork_page_meta.gaps_flagged`
  (see (b))
- `## Page Visitor Actions` — handoff/QA consistency check. Validate:
  hero primary/secondary CTAs match Page Visitor Actions; flag
  `cta_mismatch` if they diverge. Do not create a draft section.
- Strategic Purpose, Personas, Phase, Slug, Part 1: Strategic Setup,
  Sources Referenced — strategist scaffolding, skip from draft.

Everything else IS a body section.

**(d) Per-section inline slot markers** — recognize these verbatim
patterns inside a section body and route to the listed slots. The
full run after the colon (including punctuation, line breaks,
markdown links, and emphasis) is preserved character-for-character:

| Pattern | Routes to |
|---|---|
| `**H1:** …` | `primary_heading` (hero context) |
| `**Heading:** …` / `**H2:** …` (inline, NOT the section H2) | `primary_heading` |
| `**Tagline:** …` | `tagline` |
| `**CTA 1:** Label (link to /path)` | `buttons[0] = { label, url, kind: "primary" }` |
| `**CTA 2:** Label (link to /path)` | `buttons[1] = { label, url, kind: "secondary" }` (preserve even when the picked template caps at 1 button) |
| `**CTA:** Label (…)` | `buttons[…]` — kind unspecified; the layout decides primary positioning |
| `**Button:** Label (link to /path)` / `*Button: Label (annotation)*` | `buttons[…]`. Any trailing parenthetical annotation is preserved into `cowork_section_meta.button_annotations[i]` |
| `*[Image: …]*` / `*[Image or video: …]*` | `cowork_section_meta.image_direction` (verbatim, including the partner's stated visual intent) |
| `*[Map embed: <iframe…>]*` | `cowork_section_meta.embed_directive` (verbatim, **iframe markup and all** — DO NOT escape, decode, or rewrite it) |
| `*[This section features … events …]*` / `*[Visual links into N pathways:]*` / `*[asset…]*` / any other italic-bracketed designer directive | `cowork_section_meta.dynamic_directive` (or append to `inline_annotations[]` if there's already a dynamic_directive set) |
| `*Preservation: source-verbatim …*` / `*preservation: …*` | `cowork_section_meta.preservation = "source-verbatim"` |
| Any other italic-bracketed note `*[…]*` not matched above | append to `cowork_section_meta.inline_annotations[]` as `{ note, near_slot? }` (near_slot = the most recent slot label the note appeared after) |

**(e) Item lists.** When a section's body contains a list of
`**<Item Heading>** + body paragraph + optional Button:` blocks
(canonical example from 3249's `## SERVICE TIMES`: `**Contemplative
Service**` then a multi-line body then two `*Button: …*` lines),
each entry becomes one `items[i]`:

```json
{
  "item_heading":   "Contemplative Service",
  "item_body":      "Sundays, 9 a.m. | Chapel | September through May …",
  "item_meta":      "<any annotation that didn't fit elsewhere>",
  "item_cta_label": "View Bulletin",
  "item_cta_url":   "https://firstpres-charlotte.org/.../May-3-2026-Contemplative-Bulletin.pdf"
}
```

When the item has multiple Buttons (the SERVICE TIMES example has
TWO per service — View Bulletin + Watch the Livestream), emit one
item with the FIRST per-item button as `item_cta_label`/`item_cta_url`
and the rest into `item_meta` as a verbatim `"Also: <label> → <url>"`
appended block. The strategist sees both in the Rich Companion;
the layout shows the primary per-card CTA.

Per-item button annotations (the partner's trailing `(right now it
is set up as an upload to their site, can we replicate this or
improve…)`) go into `cowork_section_meta.button_annotations` AND
the item's `item_meta` so they ride with the item.

**(f) Verbatim body slot.** Any text in the section that wasn't
captured by (d) or (e) lands in `body` (or `accent_body` if the
section has both a primary descriptive prose block and a follow-up
emphasis block, e.g. content_video). **No char cap. No paraphrase.
No truncation.** Preserve:

- Line breaks (paragraph breaks become `\n\n`; single breaks → `\n`)
- Bulleted lists (as `- …\n- …`)
- Inline markdown links (`[Label](https://…)`) — the renderer's
  `styleHyperlinks` pass handles anchor styling at render time
- Inline emphasis (`**bold**`, `*italic*`)
- Embedded markdown formatting

The Brixies template's body slot type is `richtext` (the renderer
treats it as HTML); the handoff translator's `ensureHtml()` will
wrap plain markdown in `<p>` tags. Do not pre-render to HTML — pass
the markdown as-is; the translator normalizes it.

**(g) Global footer.** If this is a Type=Footer row OR the page
contains a top-level `## GLOBAL FOOTER` block (the Homepage in
3249 has both — they should match; if not, the Footer row wins),
write the verbatim block to `roadmap_state.global_footer` (one per
project, shape per `CoworkGlobalFooter` in
`src/types/database.ts`). Parse the column structure (`### Footer
Column 1 — <Heading>`, `### Footer Column 2 — <Heading>`, etc.),
the `### Footer Bottom Bar` row, and the trailing `**FOOTER NOTES
FOR DEVELOPER:**` bullets. Preserve every link verbatim — the
footer drives the site-wide nav and one missing URL is a regression
the partner will notice immediately.

**(h) Capture rules — already-defined markers.** The Capture rules
section below (NEEDS INPUT / `*pending:*` / `*photo:*` /
`*Embed (video):*` / suggested-value extraction / hash-anchor CTAs
/ Labeled sub-bullets) STILL APPLIES verbatim. Do not paraphrase
the rule book; layer the new markers from (d) on top.

**Validate before continuing.** Every slot with `required: true`
in the picked template's `cowork_writable_slots` SHOULD have a
value. If a required slot is empty after binding:
- Look at the section's inline_annotations / image_direction /
  dynamic_directive — sometimes the missing piece is captured
  there and just needs reassigning.
- If still empty, emit a `required_slot_unfilled` directive on the
  critique. Do NOT invent a placeholder; leave the slot empty and
  let the strategist fix it.

**No paraphrase rule.** Delete from your behavior: any temptation
to "TRIM body to 400 chars" or "shorten this paragraph to fit." The
audit branch's contract with the partner is verbatim. Char caps
declared in `cowork_writable_slots` are the visual designer's
guidance — they do not authorize content destruction. If the body
exceeds a template's intended visual rhythm, Step 3 picks a more
spacious layout OR splits the section into siblings; never trims.

### 3. Pick a Brixies layout for each section by CONTENT SHAPE

Section labels (`## HERO SECTION`, `## SERVICE TIMES`,
`## MISSION SNAPSHOT`, etc.) are display text rendered as the
section's heading — **never a routing signal**. The pipeline picks
the Brixies layout family by the structural shape extracted in
Step 2: cards vs prose vs accordion vs map embed vs CTA vs video
vs staff list.

Always pick from `canonical_templates.pickable_templates[]` (the
allow-list of verified templates the handoff translator can bind).
Emitting a `template_key` not in `pickable_templates` is a hard
error — the importer rejects it.

**Routing table (deterministic, content-driven):**

| Structural shape extracted in Step 2 | Brixies layout |
|---|---|
| First section on a page + has `**H1:**` + `**Tagline:**` + ≥1 CTA + image direction | `hero_homepage` (slug === "/") OR `hero_inner` (every other page) |
| Hero shape + has `*[Visual links into N pathways:]*` + N bullet links | `hero_inner` with `items[]` built from the bullet list (each `- Label (link to /path)` → `{ item_heading: Label, item_cta_url: /path }`) |
| Heading + body + N item entries each with heading+body+per-item CTA | `feature_unique` (3 items or fewer) OR `cards_with_cta` (4+ items) |
| Heading + body + N item entries each with heading+body, **no** per-item CTA | `content_featured_a` |
| Heading + body + map embed directive (iframe in `embed_directive`) | `contact_section` (content-section-96) |
| Heading + body + exactly 1 CTA, no items | `cta_callout` (cta-section-52) |
| Heading + body + exactly 2 CTAs (primary + secondary), no items | `cta_simple` (cta-section-20) |
| Heading + body + ≥3 paired Q→A blocks | `accordion_faq` |
| Heading + body + video embed / video CTA + descriptive prose | `content_video` |
| Heading + chronological items (years, dates, "Step 1"/"Step 2", "Phase 1"/etc.) | `timeline_story` |
| Heading + N entries each shaped like `**Name**` + role line + bio | `feature_team` |
| Heading + ≥1 entries shaped like `> quote` + `— Attribution` (text only) | `testimonial_written` |
| Same as above but with video URL/embed | `testimonial_video` |
| Heading + ≥1 entries shaped like job posting (title + location + body + apply CTA) | `career_section` |
| Long prose only — no item structure, no embed, no CTAs (or 1 trailing CTA absorbed into the layout) | `content_image_text_b` |

**Overflow handling (no paraphrase).** When the partner-written
content's count or volume exceeds a template's natural visual
rhythm, resolve in this preference order:

1. **SUBSTITUTE template** — pick a template in the same family
   with more spacious slots. Example: 6 staff entries with
   `feature_team` (visual cap 2) → currently no `feature_team_grid`
   variant exists; jump to step 2.
2. **SPLIT into N sibling sections** — same `template_key`,
   repeated. 6 staff → 3× `feature_team` sections (2 each). 12 FAQ
   items → 3× `accordion_faq` sections (4 each). Each split sibling
   gets its own primary_heading derived from the source content
   ("Lead Pastors" / "Staff Pastors" / "Support Team" if groupings
   are evident, otherwise `"<Original Heading> (1 of N)"`).

   **SPLIT marker contract — REQUIRED**: every split sibling stamps
   two fields on its `_meta`:
     - `split_from`: a stable string identifying the original
       Notion section (the original H2 text verbatim).
     - `split_position`: 1-based index within the split group.
   Standalone sections leave both fields absent. The handoff
   endpoint mints ONE `split_group_id` UUID per unique
   `(notion_page_id, split_from)` pair and stamps it on every
   web_section in the group — without the marker, the importer
   has no way to detect the grouping.
3. **RENDER LONG (fallback)** — if SUBSTITUTE and SPLIT both fail,
   bind the section with `content_image_text_b` and let the body
   render at full length. Emit a `layout_no_match` directive on the
   critique so the strategist can resolve via the workspace variant
   picker. **NEVER paraphrase.**

If no shape match exists at all (e.g. a section that's pure embed
markup with no heading), fall back to `content_image_text_b` with
the embed routed to `embed_directive` and the audit critique notes
the shape mismatch.

### 4. Score the 5 axes (use the standard rubrics)

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

### 5. Compute overall_band

Per the rubric in audit-criteria.md:
- All axes ≥75 with zero blocker directives → `green`
- Any axis 50-74 OR any warning directive → `yellow`
- Any axis <50 OR any blocker directive → `red`

### 6. Write artifacts per page (verbatim preservation guarantees)

Per-page writes via Supabase MCP. Same `audit_source = 'notion'` on
every `_meta` block so synthesize-critique + the downstream importer
can tell where these artifacts came from.

Every audit-branch outline section MUST carry these new `_meta`
fields (in addition to the long-standing ones) so the handoff
endpoint can persist what the partner wrote:

- `source_block` — the verbatim raw markdown for THIS section as
  pulled from Notion (the substring between this section's H2 and
  the next H2, untouched). Used for audit diffing ("what was in
  Notion?" vs "what landed in cowork_slot_values?") and re-
  extraction if the parser evolves.
- `preservation` — `"source-verbatim"` when the partner used a
  `*Preservation: …*` marker on the section, else null.
- `image_direction` — verbatim run from a `*[Image: …]*` marker, or null.
- `embed_directive` — verbatim run (including raw iframe) from a
  `*[Map embed: …]*` marker, or null.
- `dynamic_directive` — verbatim run from a `*[This section features
  …]*` or `*[Visual links into N pathways:]*` marker, or null.
- `inline_annotations` — array of `{ note, near_slot? }` for any
  italic-bracketed designer note not matched to a specific directive.
- `button_annotations` — array of strings (or nulls), length matches
  `buttons[]` in cowork_slot_values, capturing trailing-parenthetical
  notes from per-CTA markers like `*Button: View Bulletin (right now
  it is set up as an upload to their site…)*`.

**(a) `page_outlines.<slug>`** — the template + slot-binding plan:

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
      "voice_anchor": "<a stage_1.voice_exemplars phrase the section voice should align with>",
      "_meta": {
        "audit_source":       "notion",
        "notion_page_id":     "<id>",
        "notion_url":         "<url>",
        "source_block":       "<verbatim markdown for this section, character-for-character>",
        "preservation":       "source-verbatim" | null,
        "image_direction":    "<verbatim from *[Image: …]*>" | null,
        "embed_directive":    "<verbatim including iframe markup>" | null,
        "dynamic_directive":  "<verbatim from *[This section …]*>" | null,
        "inline_annotations": [{ "note": "<verbatim>", "near_slot": "primary_heading" }],
        "button_annotations": ["<verbatim trailing paren on buttons[0]>", null],
        "split_from":         "<original H2>" | null,
        "split_position":     1
      }
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
   ONE atomic string unless an exception below applies):
   - `[NEEDS INPUT: ...]` — explicit placeholder for missing data.
     Often carries starter options ("react to: 'A.' / 'B.' / 'C.'")
     — those are prompts to the client, NOT picks. Never substitute
     one option as final copy.
   - `*pending: ...*` / `*Pending Partner Input: ...*` — italicized
     strategist note (case-insensitive). Belongs in `item_meta` or
     appended to the slot it annotates. If the note names an owner
     ("Ben Folman to confirm…") preserve the name verbatim.
   - `*photo: [NEEDS INPUT: ...]*`, `*image: [NEEDS INPUT: ...]*`
     — per-item asset placeholders for staff bios, cards, etc.
     Preserve in `item_meta`; do NOT route into the image slot
     (cowork never fills image slots — those stay
     Brixies-designer-bound).
   - `*Embed (video): [NEEDS INPUT: ...]*` + `*Fallback: <url>*`
     — video block markers. Capture the fallback URL as the
     working `video_url`; log the [NEEDS INPUT] as a
     `pending_permanent_video_url` gap on the section. Section
     ships with the fallback playing.
   - `*Status: pending_partner_input*` — per-item machine status
     tag on a cards-grid item. Item ships with whatever fields
     are populated; audit flags `item_pending_partner_input`.
   - `*Preservation: source-verbatim ...*` / `*preservation: ...*`
     — block-level or per-item flag locking the text against
     paraphrase. Pass to `cowork_section_meta.preservation:
     'source-verbatim'` so downstream editors respect it.
   - `\[NEEDS INPUT\]` / `\[NEEDS INPUT: ...\]` — escaped-bracket
     variants (Notion markdown sometimes escapes the brackets).

   **EXCEPTION — suggested-value variant:**
   `[NEEDS INPUT — suggested: "..."]` carries a strategist-supplied
   working value. EXTRACT the quoted value as the slot's content
   (ship-now) and log a `pending_partner_approval` gap (info
   severity, NOT a blocker). Example:
   ```
   **METADATA TITLE:** [NEEDS INPUT — suggested: "Justice | Arvada Vineyard"]
   ```
   Ships `Justice | Arvada Vineyard` as the title; audit notes
   that partner approval is still pending. The handoff translator
   does this extraction automatically via `extractSuggestedValue()`
   in coworkToBrixies.ts — but the SKILL should do it too so the
   `slot_values` in the draft contains the resolved text rather
   than the raw marker.

   The handoff renderer recognizes the blocking shapes via
   `isNeedsInput()` in coworkToBrixies.ts: visible text shows the
   marker so the strategist sees the gap; URL slots blank the
   href so it doesn't become a broken literal-text link. NEVER
   substitute, paraphrase, or summarize a marker. NEVER drop it.

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
   Referenced, Gaps Flagged, **Page Visitor Actions**) becomes ITS
   OWN section in the draft. Do not combine "Hero" + "Service
   Times" into one section. Do not skip "Newsletter Signup"
   because it feels small. Sub-section `###` headings inside a
   `##` MAY group as a single section if they're tightly coupled,
   but only with explicit reasoning in `voice_notes`.

   `## Page Visitor Actions` is a metadata block — it restates the
   hero's primary + secondary CTAs as a handoff/QA consistency
   check. Skip it from the draft (do NOT create a draft section
   for it), but DO validate: hero primary/secondary must match
   Page Visitor Actions primary/secondary. Flag a `cta_mismatch`
   directive if they diverge.

3a. **Labeled sub-bullets inside items.** When a Notion bullet has
   nested `Label: value` rows, treat each label as a structured
   item field rather than nested content. Recognized labels:

   | Label | Routes to |
   |---|---|
   | `URL:` | `item_cta_url` (label implicit: "Read More" / contextual) |
   | `Form:` | `item_cta_url` + `item_cta_label: "Sign Up"` |
   | `Contact:` | `item_contact_name` (people name, NOT a URL) |
   | `Email:` | `item_contact_email` or `item_cta_url: mailto:…` |
   | `Phone:` | `item_contact_phone` |

   Example — Serve page Sign-up Forms:
   ```
   - **Hospitality (Greeting, Cafe)**
     - Contact: Ben Folman
     - Form: <https://docs.google.com/forms/...>
   ```
   Becomes:
   ```json
   { "item_heading": "Hospitality (Greeting, Cafe)",
     "item_contact_name": "Ben Folman",
     "item_cta_label": "Sign Up",
     "item_cta_url": "https://docs.google.com/forms/..." }
   ```

3b. **Hash-anchor CTAs (`#partners`, `#serve-teams`)** are in-page
   jumps to another section on the same page. Preserve as-is in
   the button url. Validate: the target anchor MUST match a
   slugified section heading in the same draft (e.g. `#partners`
   targets `## Local Partners`). If no match found, flag a
   `broken_anchor_link` directive — strategist needs to either
   rename a section or fix the anchor.

4. **Layout pick happens in Step 3 — content shape only, never
   section-label keyword matching.** The earlier "Notion hint
   keyword → template_key" table is REMOVED from this branch. The
   partner's section labels (`## HERO SECTION`, `## SERVICE TIMES`,
   `## MISSION SNAPSHOT`) are display text and become the section's
   rendered heading; they are NOT a routing signal. Step 3's
   structural-shape routing table is the only authority on which
   Brixies layout binds. This avoids the misfires that happen when
   a partner names a section "## Spotlights" but the content shape
   is actually a 2-button CTA, or names a section "## Mission" but
   the content shape is a 5-item testimonials grid.

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

**(d) `cowork_page_meta.<slug>`** — page-level partner-written
metadata that lives at the PAGE level (not per-section). Holds the
verbatim `# SEO` block + page-final `## GAPS FLAGGED` bullets:

```json
{
  "seo": {
    "raw_block": "<verbatim markdown of the # SEO H1 block>",
    "primary_keywords":   ["..."],
    "secondary_keywords": ["..."],
    "local_keywords":     ["..."],
    "meta_title":         "...",
    "meta_description":   "...",
    "aeo_snippet":        "..."
  },
  "gaps_flagged": [
    { "note": "<verbatim bullet from ## GAPS FLAGGED>", "kind": "partner_flagged" }
  ],
  "_meta": {
    "audit_source": "notion",
    "notion_page_id": "<id>",
    "notion_url":     "<url>"
  }
}
```

```sql
SELECT roadmap_state_set('<project_id>'::uuid, ARRAY['cowork_page_meta', '<slug>'], '<page_meta_jsonb>'::jsonb);
```

Omit fields that the partner didn't write (no `# SEO` block → omit
`seo`; no `## GAPS FLAGGED` → omit `gaps_flagged`). Skip the write
entirely if neither is present. The handoff endpoint reads this
key and writes `web_pages.seo_metadata` + `web_pages.partner_gaps_flagged`.

**(e) `global_footer` (one per project, not per page)** — when a
Type=Footer row exists OR when a page body contains a top-level
`## GLOBAL FOOTER` block. Written ONCE across the whole sitemap
walk (last write wins if multiple sources exist; the Type=Footer
row should be authoritative):

```json
{
  "raw_block": "<verbatim markdown for the entire footer block>",
  "columns": [
    {
      "heading": "Church Identity",
      "blocks": [
        { "kind": "identity", "lines": ["First Presbyterian Church of Charlotte", "200 West Trade Street", "..."] }
      ]
    },
    {
      "heading": "Quick Navigation",
      "blocks": [
        { "kind": "links", "label": "Explore",
          "items": [
            { "label": "I'm New", "url": "/new" },
            { "label": "Worship", "url": "/worship" }
          ] }
      ]
    }
  ],
  "bottom_bar": "© First Presbyterian Church of Charlotte | …",
  "footer_notes": [
    "The Counseling Center footer link (/care#counseling-center) is a permanent anchor link …",
    "Bulletin Links URL must be preserved exactly. It is used on printed QR codes …"
  ]
}
```

```sql
SELECT roadmap_state_set('<project_id>'::uuid, ARRAY['global_footer'], '<footer_jsonb>'::jsonb);
```

Up to FIVE writes per page (outline → draft → critique → page_meta →
optionally global_footer once across the whole walk). Order:
outline → draft → critique → page_meta. The global_footer write
happens once (the Footer row itself OR the first Homepage section
pass that emits it). If a write fails, surface the error and STOP —
don't continue to the next page until the strategist clears it.

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

- Up to FOUR Supabase MCP writes per page: outline → draft →
  critique → `cowork_page_meta` (when the page has a `# SEO` block
  and/or `## GAPS FLAGGED` block). Plus ONE project-level
  `global_footer` write across the whole sitemap walk. Reads via
  Notion MCP are fine — but don't fan out additional
  `roadmap_state_set` calls per section.
- Resolve overflow during binding via SUBSTITUTE / SPLIT only.
  Never TRUNCATE the partner's content. Never paraphrase. If
  neither SUBSTITUTE nor SPLIT fits, fall back to
  `content_image_text_b` and let the body render at full length;
  emit a `layout_no_match` directive so the strategist sees what
  exceeded the visual rhythm.
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
