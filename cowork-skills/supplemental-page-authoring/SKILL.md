---
name: supplemental-page-authoring
description: |
  Writes copy for sitemap pages that didn't have a matching Notion
  page in the audit branch. Runs after audit-external-copy. For each
  gap page, produces the standard outline → draft → critique trio
  in one autonomous pass, replacing the audit's placeholder
  critique (which had overall_band='gap'). If no gap pages exist,
  surfaces "nothing to author" and stops.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.0.0'
references:
  - ../outline-page/SKILL.md
  - ../draft-page/SKILL.md
  - ../critique-page/SKILL.md
---

# Supplemental Page Authoring

You write copy for the sitemap pages that the partner DIDN'T cover
in their Notion copywriting. audit-external-copy already audited the
pages they did cover; you fill the remaining gaps.

This is the same outline → draft → critique sequence the standard
pipeline runs, but scoped to ONLY the gap pages and collapsed into
one autonomous skill (you produce all three artifacts per gap page
in conversation, not three separate cowork sessions).

## Your input — read from the attached project bundle, NOT from MCP

The strategist attached `cowork-pipeline.<partner>.project-bundle.json`
— the same bundle audit-external-copy consumed. Key sections:

```ts
{
  sitemap_pages:              Array<{ slug, name, nav_order, ... }>
  stage_1, ministry_model, strategic_goals_approved, canonical_templates
  atoms_pool, facts_pool, crawl_topics_pool
  allocations_by_page                                       // for each gap page
  build_directives_by_page

  notion_audit_branch: {
    pages_by_slug: Record<string, { ... }>                  // the AUDITED set
  }
}
```

## Compute the gap set

`gap_slugs = sitemap_pages.map(p => p.slug)` filtered to those NOT in
`notion_audit_branch.pages_by_slug`. These are the pages with no
existing Notion copy.

If `gap_slugs.length === 0`, surface:
> No supplemental authoring needed. Every sitemap page had a
> matching Notion page; audit-external-copy covered them all. Mark
> this step complete with Approve as-is on the workspace card.

…and STOP. Do not write any artifacts.

## Walk the gap set

For each `slug` in `gap_slugs` (walk by `nav_order` from `sitemap_pages`):

### 1. Outline the page

Follow the **outline-page** SKILL contract:
- Look up `allocations_by_page[slug]` for the section_intents.
- Resolve `section_intents[].sources[].ref` against `atoms_pool` /
  `facts_pool` / `crawl_topics_pool` (id-first, topic fallback).
- For each section: pick a `template_key` from
  `canonical_templates.page_section_templates`, bind atoms/facts/
  crawl to the template's slots, stamp `intended_verbatim_band`
  from `strategic_goals_approved.content_and_allocation.copy_approach.derived.intended_verbatim_band`.
- Honor `voice_and_tone.one_key_message` (at least one section's
  voice_anchor cites it) and `content_and_allocation.ministries_to_grow`
  (named ministries surface early with clear CTAs).

Write the outline:

```sql
SELECT roadmap_state_set(
  '<project_id>'::uuid,
  ARRAY['page_outlines', '<slug>'],
  '<outline_jsonb>'::jsonb
);
```

### 2. Draft the page

Follow the **draft-page** SKILL contract:
- Write each section's copy per the outline + the verbatim band.
- Stamp each section's `actual_verbatim_ratio` so the critique can
  verify it lands within band.
- Track `atoms_used` / `facts_used` / `crawl_topics_used` per section
  (the source-coverage axis reads these).

Write the draft:

```sql
SELECT roadmap_state_set(
  '<project_id>'::uuid,
  ARRAY['page_drafts', '<slug>'],
  '<draft_jsonb>'::jsonb
);
```

### 3. Critique the page — REPLACES the audit's placeholder

Follow the **critique-page** SKILL contract:
- 5 axes (dignity, voice_character, persona_fit, source_coverage,
  claim_plausibility).
- Reference `church_vision` verbatim in the dignity axis rationale.
- Check `actual_verbatim_ratio` lands in the approved band.
- Surface `deferred_atoms[]` from the draft as directives at
  severity ≥ warning.

Write the critique — this OVERWRITES the gap placeholder the audit
wrote at `page_critiques.<slug>`:

```sql
SELECT roadmap_state_set(
  '<project_id>'::uuid,
  ARRAY['page_critiques', '<slug>'],
  '<critique_jsonb>'::jsonb
);
```

The critique's `_meta.audit_source = 'generated-supplemental'` so
synthesize-critique can distinguish "external copy audited" from
"generated to fill gap." Both feed the project rollup the same way.

### 4. Pause for strategist pushback

After each gap page (outline + draft + critique written), surface a
one-screen summary and pause so the strategist can push back before
you advance to the next gap. This is the cost of supplemental
authoring being a fresh write rather than an audit — the strategist
wants to verify the new copy lands before more is generated.

## After all gap pages

Surface a final report:

```md
# Supplemental authoring complete — <N> pages written

## Summary
- <slug-1>: <green/yellow/red> · <N sections> · verbatim <X.XX>
- <slug-2>: ...

## Outliers
- Pages flagged red: <list with one-line why>
- Pages with deferred atoms (need strategist follow-up): <list>

## Next step
Run **synthesize-critique** to roll the full sitemap into a project verdict.
```

## Hard rules

- Only write artifacts for pages in `gap_slugs`. Do NOT touch pages
  audit-external-copy already wrote critiques for (those have
  `_meta.audit_source = 'notion'`).
- ONE MCP write per artifact per page (three writes per gap page:
  outline + draft + critique). Use the project bundle for all reads.
- If `gap_slugs.length === 0`, surface "nothing to do" and stop —
  do not write empty artifacts.
- Honor the same verbatim-band + voice + ministries-to-grow gates
  as the standard outline → draft → critique trio. The audit
  branch's existence doesn't relax these for the gap pages.
