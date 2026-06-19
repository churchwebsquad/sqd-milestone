---
name: seo-per-page
description: |
  Gathers SEO + AEO + GEO metadata for every active page on a web
  project and writes it to `web_pages.seo`. Reads from the page's
  bound section content (heading + body copy on the live build),
  the strategist's church_facts / brand voice, and (if available)
  the existing crawl results for the legacy URL. Produces one
  WebPageSeo blob per page, written as a single UPDATE per row.
  No partner-facing artifacts — this is dev-handoff prep that
  surfaces directly in the Dev Handoff workspace's SEO / AEO /
  GEO export.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
---

# SEO Per Page

You produce per-page SEO + AEO + GEO metadata so the dev team can
paste it straight into the WordPress page template (Yoast / Rank
Math / native fields). One row written to `web_pages.seo` per
active page on the project. The Dev Handoff workspace already
reads from this column and exports it as Markdown — your job is
just to fill it.

This is a one-shot fill, not an iterative critique. You write
exactly one UPDATE per page. /staff/ pages are skipped (auto-
generated per-staff bio pages share the parent Team Section's
content and don't carry their own SEO).

## Inputs you need before you start

Ask the strategist for these only if they aren't already in
`roadmap_state` or `church_facts`:

- The project's `web_project_id` (uuid).
- The church's primary service areas (city + state, neighborhoods,
  regional context). GEO needs this.
- The church's voice / tone — one or two sentences. Drives the
  voice of the meta description.

Everything else you derive from the page's sections.

## Step-by-step

### 1. List every active, non-staff page

```sql
SELECT id, name, slug, seo
FROM web_pages
WHERE web_project_id = $1
  AND archived = false
  AND slug NOT LIKE 'staff/%'
ORDER BY sort_order;
```

Skip pages whose `seo` already has a non-empty `seo.title` AND
`seo.meta_description` — the strategist already filled them.

### 2. For each remaining page, gather context

Read the page's bound sections to get its real content:

```sql
SELECT s.id, s.content_template_id, s.field_values, s.notes
FROM web_sections s
WHERE s.web_page_id = $1
ORDER BY s.sort_order;
```

For each section, extract:

- The hero / first H1 (substitute target `Heading` in the bound
  template's source HTML) — anchors the page's primary topic.
- Tagline + body copy from the first 1–3 sections — supplies the
  one-sentence summary you need for meta description.
- Any explicit Q&A items inside accordion / FAQ sections — these
  go straight into `aeo.structured_qa`.

Also read:

- `roadmap_state.brand_voice` — drives the tone of the meta
  description (terse, warm, formal, etc.).
- `roadmap_state.strategic_goals.display_and_technical.*` — fills
  service areas + landmark context when not explicit on the page.
- (optional) the prior crawl's content_results JSON if the dev
  team needs to preserve existing rankings — match titles to
  legacy URLs.

### 3. Produce one WebPageSeo blob per page

Shape — write the full object even if some fields are empty:

```json
{
  "seo": {
    "title":            "<≤60 chars, ends with church name>",
    "meta_description": "<≤155 chars, one sentence, partner's voice>",
    "focus_keywords":   ["primary phrase", "secondary phrase", "..."],
    "canonical_url":    "<full https URL once domain is live; else null>"
  },
  "aeo": {
    "answer_intent":    "<the one question this page answers>",
    "structured_qa":    [
      { "q": "<question>", "a": "<≤200-char answer>" }
    ]
  },
  "geo": {
    "service_areas":    ["Charlotte, NC", "..."],
    "local_keywords":   ["uptown Charlotte", "..."],
    "local_landmarks":  "<free text — neighborhoods, regional context>"
  }
}
```

Rules:

- **title** is page-specific. Don't paste the church name 5×
  across the site — use the page's actual topic. Example:
  `"Plan a Visit · First Presbyterian Church of Charlotte"`.
- **meta_description** answers "why would I click?" in the
  partner's voice. No keyword stuffing. Lead with the partner
  benefit, not the search phrase.
- **focus_keywords** has 1–5 entries. Primary phrase first.
- **canonical_url** stays null until the dev confirms the live
  domain. Don't guess.
- **answer_intent** is a single question — what someone searching
  on this topic actually asks. Used by Google's AEO snippet and
  internal search. Example for a Care page: `"How do I find
  pastoral care at First Presbyterian?"`.
- **structured_qa** is optional. Include only when the page
  already has Q&A-style content (FAQ section, accordion, "What
  to expect" lists). 2–6 entries max.
- **service_areas** is always present on local pages. Use
  `"City, ST"` format.
- **local_keywords** are search phrases that include geography
  (e.g. `"church in uptown Charlotte"`). Drop ones that are
  awkward or unnatural.
- **local_landmarks** is free text — neighborhoods, schools,
  hospitals near the church. Used for local pack relevance.

### 4. Persist per page

One UPDATE per page. NEVER batch — if one row's JSON is malformed,
batching loses every other write.

```sql
UPDATE web_pages
SET seo = '<json-stringified WebPageSeo>'::jsonb,
    updated_at = NOW()
WHERE id = '<page_id>'
RETURNING id, slug;
```

Verify the RETURNING row matches the page you intended. If it
doesn't, halt and surface the discrepancy.

### 5. Report when done

A single summary to the strategist:

```
Filled SEO for N pages on <project name> (<N skipped — already had title + description>).
Pages still missing GEO landmarks: <list>
Pages still missing canonical_url (waiting on live domain): <list>
```

The Dev Handoff workspace surfaces everything you wrote — no
separate artifact needed.

## What NOT to do

- Don't write to /staff/* pages. They share the team-link source.
- Don't write `canonical_url` unless the strategist hands you the
  live domain. Wrong canonicals harm rankings worse than missing
  ones.
- Don't paraphrase the partner's voice into "professional SEO
  speak." Meta descriptions in the partner's actual tone outrank
  generic ones once Google's RankBrain reweights against pogo-
  sticking.
- Don't invent answer_intent questions — only include if the
  page's content actually answers a clear question.
- Don't add `focus_keywords` with > 5 phrases. Keyword stuffing
  underperforms tighter targeting in 2025.

## Where the data surfaces

`web_pages.seo` is read by:

- `DevHandoffWorkspace.tsx` (SEO · AEO · GEO export card) —
  downloadable as Markdown the dev pastes into WordPress.
- The page editor's SEO panel (Pages tab) — lets the strategist
  hand-edit anything you wrote.
- (future) `webBrixiesRender.ts` — when the build ships, the SEO
  fields will populate the rendered `<head>` of each page.

No other consumers. Safe to overwrite freely on re-runs — there's
no migration log.
