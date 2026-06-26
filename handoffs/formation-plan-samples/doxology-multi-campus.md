# Formation Plan — Human Summary

*Translated from* `doxology-multi-campus.json`
*Generated* 6/26/2026, 9:46:46 AM *by* `analyzer-v1` *fingerprint* `-vmtt3h`

## At a glance

| Metric | Count |
|--------|------:|
| Classifications (one per piece of content)        | 0 |
| WordPress objects (CPTs + Options + Repeaters)    | 4 |
| ACF field groups (one per WP object)              | 4 |
| Open questions for McNeel                         | 1 |
| Low-confidence classifications                    | 0 |

## What the developer needs to build

### Custom Post Types (3)

#### `event` — Event / Events

- **Single detail page**: ✅ yes — Partner picked "wordpress" — events live in WP with per-event detail pages, surfaced via a Bricks query loop on /events.
- **Archive page**: ❌ no (rendered via query loop on `/events`)
- **Public**: yes · **Queryable**: yes · **REST**: yes · **In nav menus**: yes · **In search**: yes
- **Supports**: title, editor, thumbnail, revisions, excerpt
- **Taxonomies**:
  - `event_category` — Category / Categories (hierarchical)
  - `event_campus` — Campus / Campuses (flat)
- **URL slug**: `/event/`

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

#### `group` — Group / Groups

- **Single detail page**: ✅ yes — Groups in WP with per-group detail pages, listed via Bricks query loop on /groups.
- **Archive page**: ❌ no (rendered via query loop on `/groups`)
- **Public**: yes · **Queryable**: yes · **REST**: yes · **In nav menus**: yes · **In search**: yes
- **Supports**: title, revisions
- **Taxonomies**:
  - `group_type` — Type / Types (hierarchical)
  - `group_day` — Day / Days (flat)
  - `group_campus` — Campus / Campuses (flat)
- **URL slug**: `/group/`

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

⚠️ **Open questions for McNeel:**
- Multi-campus project — these fields are inherently per-campus and should NOT be seeded as flat globals: address, city_state, phone, email, primary_service_time, all_service_times, pastor_name. Recommend modeling as a "Campus" CPT or as a per-campus repeater on the Visit page. Confirm with McNeel.

## Classification distribution (Layer 1)

| Structure | Count |
|-----------|------:|

## Open questions for McNeel (1)

Items the analyzer flagged as needing human judgment before dev starts:

- **wp_object.global_site** — Multi-campus project — these fields are inherently per-campus and should NOT be seeded as flat globals: address, city_state, phone, email, primary_service_time, all_service_times, pastor_name. Recommend modeling as a "Campus" CPT or as a per-campus repeater on the Visit page. Confirm with McNeel.

---
*To regenerate this summary: `tsx scripts/translate-formation-plan.ts handoffs/formation-plan-samples/doxology-multi-campus.json`*
