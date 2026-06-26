# Formation Plan — Human Summary

*Translated from* `paradox-single-campus.json`
*Generated* 6/26/2026, 9:46:15 AM *by* `analyzer-v1` *fingerprint* `-1gkibu`

## At a glance

| Metric | Count |
|--------|------:|
| Classifications (one per piece of content)        | 169 |
| WordPress objects (CPTs + Options + Repeaters)    | 36 |
| ACF field groups (one per WP object)              | 35 |
| Open questions for McNeel                         | 3 |
| Low-confidence classifications                    | 0 |

## What the developer needs to build

### Custom Post Types (1)

#### `sermon` — Sermon / Sermons

- **Single detail page**: ✅ yes — Legacy "wordpress" value — treated as the equivalent of archive_pages (CPT + single template + archive).
- **Archive page**: ✅ yes
- **Public**: yes · **Queryable**: yes · **REST**: yes · **In nav menus**: yes · **In search**: yes
- **Supports**: title, editor, thumbnail, revisions, excerpt
- **Taxonomies**:
  - `sermon_series` — Series / Series (flat)
  - `sermon_speaker` — Speaker / Speakers (flat)
  - `sermon_topic` — Topic / Topics (hierarchical)
- **URL slug**: `/sermon/`

### Global Settings / Options Page (1)

#### `global-site` — Global Site Settings

Single editable location for site-wide content. Anything edited here propagates wherever it's referenced.

**Fields seeded from existing project columns:**

- `church_name`
- `denomination`
- `social_facebook_url`
- `social_instagram_url`
- `social_youtube_url`
- `social_tiktok_url`
- `social_twitter_url`
- `social_linkedin_url`
- `address`
- `city_state`
- `phone`
- `email`
- `primary_service_time`
- `all_service_times`
- `pastor_name`

### External / managed in third-party system (1)

Partner answered "external" / "embed" / "contact" on these — no WordPress CPT needed. Site links out or embeds.

- **wp_object.external.events** — display mode `link-out`
  - Partner picked "external" — events are managed in a third-party system (Church Center / CCB / etc.). Site links out or embeds; no CPT needed.

### Page-scoped Repeater fields (33)

Per-page repeating content (card grids, accordion lists, step lists, etc.). One ACF repeater field per (page, content piece) pair. Grouped by page for readability:

- **`/paradox-kids`** (10 repeaters): `paradox-kids_tagline`, `paradox-kids_heading`, `paradox-kids_description`, `paradox-kids_row_list`, `paradox-kids_buttons`, `paradox-kids_grid_row`, `paradox-kids_card`, `paradox-kids_accordion_right`, `paradox-kids_accordion_left`, `paradox-kids_image`
- **`/plan-a-visit`** (9 repeaters): `plan-a-visit_buttons`, `plan-a-visit_image`, `plan-a-visit_tagline`, `plan-a-visit_heading`, `plan-a-visit_description`, `plan-a-visit_row_list`, `plan-a-visit_accordion_right`, `plan-a-visit_accordion_left`, `plan-a-visit_grid_row`
- **`/home`** (6 repeaters): `home_buttons`, `home_card`, `home_grid_row`, `home_grid_rows`, `home_description`, `home_image`
- **`/sermons`** (4 repeaters): `sermons_buttons`, `sermons_grid_rows`, `sermons_card`, `sermons_tab`
- **`/open-and-affirming`** (4 repeaters): `open-and-affirming_buttons`, `open-and-affirming_image`, `open-and-affirming_card`, `open-and-affirming_grid_row`

## Classification distribution (Layer 1)

| Structure | Count |
|-----------|------:|
| REPEATER | 71 |
| PLAIN_FIELD | 48 |
| GROUP | 47 |
| BRICKS_NESTABLE_SECTION | 3 |

### Pages flagged as modular layouts (Bricks Nestable preferred)

These pages have 5+ sections with high template variety, so the analyzer recommends Bricks-native Nestable sections instead of ACF Flexible Content (better DB perf):

- **`/sermons`** — 5 sections, medium confidence
- **`/open-and-affirming`** — 5 sections, medium confidence
- **`/paradox-kids`** — 6 sections, medium confidence

## Open questions for McNeel (3)

Items the analyzer flagged as needing human judgment before dev starts:

- **sermons/__page_layout** — Confirm with McNeel: use Bricks native Nestable for this page, or fall back to ACF Flexible Content?
- **open-and-affirming/__page_layout** — Confirm with McNeel: use Bricks native Nestable for this page, or fall back to ACF Flexible Content?
- **paradox-kids/__page_layout** — Confirm with McNeel: use Bricks native Nestable for this page, or fall back to ACF Flexible Content?

---
*To regenerate this summary: `tsx scripts/translate-formation-plan.ts handoffs/formation-plan-samples/paradox-single-campus.json`*
