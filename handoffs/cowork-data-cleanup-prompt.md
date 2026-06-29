# Cowork: Multi-Campus Inventory Audit + Per-Campus Tag Cleanup

You're helping me audit the crawl inventory for **Doxology Bible Church**
(project_id `4ef827f7-3e66-46d3-a4f6-26e1a744ddba`) and re-tag items
that landed in the wrong campus bucket. This is a one-shot data cleanup
session — not a strategy/copy decision.

## The data model (so you know what we're working with)

Three tables matter:

- `strategy_web_projects.campuses` — registered campuses for the
  project. JSONB array of `{slug, label, primary, sort_order,
  crawl_url, language?}`. For Doxology:
  - `southwest` (primary, English)
  - `alliance` (English)
  - `espanol` (Spanish)

- `web_project_topics` — one row per `(project_id, topic_key,
  campus_slug)`. `campus_slug` is one of the registered slugs OR NULL
  (church-wide). Each row carries:
  - `items: jsonb[]` — structured atoms: programs, details, FAQs, key
    phrases, staff, events, contacts, locations, meeting_times, CTAs,
    scriptures, testimonies. Each item has a `kind` field.
  - `passages: jsonb[]` — long-form prose.
  - `source_page_urls: text[]` — which crawled URLs contributed.

- The crawler tags each item with `_src_campus` and the categorizer
  partitions by URL prefix (`/southwest/foo` → southwest; `/foo` →
  global).

## The known bug we need to clean up

**Service times, addresses, meeting times, and other per-campus
facts are landing in the (NULL/global) partition**, where they look
"church-wide" but are actually true only of ONE campus.

Concrete example I saw on Doxology:
- Item in `(project, sundays, NULL)`: detail `Service Times:
  Sundays, 9:00 AM & 10:30 AM`
- That's Southwest's service times only. Alliance is Sundays 10:30am.
  Espanol has different times.
- The item leaked to global because **Doxology's root URL
  (`doxology.church`) renders Southwest's content by default**, so
  the crawler found those times at both `/southwest/sundays` AND
  `/sundays` (the root reflecting Southwest's content). My cross-
  partition dedup interpreted that as "appears in global + a campus
  → must be church-wide" and promoted it. Wrong.

## Item kinds that are INTRINSICALLY per-campus

Never global, even when they appear at the root URL. Move these to
the primary campus (Southwest for Doxology) if currently NULL:

- `meeting_time` (specific times a program meets — varies by campus)
- `location_info` (campus address — never church-wide)
- `contact_block` (campus phone/email — different per campus)
- `detail` items whose label matches: service times, sundays, address,
  phone, email, campus pastor, parking, directions, what to expect,
  worship time, gathering time, doors open, kids check-in time
- `cta` items pointing at campus-specific URLs (containing
  `/southwest`, `/alliance`, `/espanol`, `alliance.doxology.church`,
  `doxologyespanol.com`)
- `program` items whose `source_url` is on a campus-specific path
  AND whose content references campus-specific facts (a specific
  address, a specific service time, a specific campus pastor name)

## Item kinds that ARE legitimately church-wide

These stay in NULL/global:

- `doctrine` items (statement of faith)
- `key_phrase` items if they describe the church's identity/mission/
  values
- `staff` items where the role is `Lead Pastor`, `Senior Pastor`,
  `Executive Pastor` (those serve the whole church)
- `faq` items about the church identity (history, beliefs, what we
  believe)
- `sermon` items (sermon archive is typically shared)
- `testimony` items (the partner has approved them as church-wide
  testimony)

Identity / beliefs topics (`about`, `beliefs`, `careers`,
`blog_news`, `locations_multi`, `school`) tend to be church-wide.
Activity / logistics topics (`sundays`, `kids`, `students`,
`location_contact`, `events`, `meeting_time`) tend to be per-campus.

## What I need from you

1. **Audit** every item currently sitting in
   `web_project_topics WHERE web_project_id =
   '4ef827f7-3e66-46d3-a4f6-26e1a744ddba' AND campus_slug IS NULL`.
   For each item, decide:
   - **Keep as church-wide** (statement of faith, mission, identity,
     etc.)
   - **Re-tag to a specific campus** — Southwest is the default
     fallback for ambiguous "campus-shaped facts" since it's the
     primary campus AND Doxology's root URL renders Southwest content.
     Use Alliance or Espanol if the item explicitly mentions that
     campus's name, address, or pastor.

2. **Output a plan** before applying any change. For each move,
   show:
   - The current row's topic_key + item summary
   - Proposed new campus_slug
   - One-sentence rationale ("Service time '9:00 AM & 10:30 AM' is
     Southwest's specific schedule, not all-campus")

3. **Apply the changes** via Supabase SQL. The data model uses one
   row per `(project_id, topic_key, campus_slug)`. To move an item:
   - Remove it from the global row's `items` array
   - Append it to the matching campus row's `items` array (insert
     the row first if it doesn't exist)

4. **Don't touch passages** in this pass. They tend to be longer-
   form and cross-campus context is harder to judge from just text
   prefixes. Focus on items (structured atoms).

5. **Skip the `other` bucket** entirely. Items there are already
   "we don't know" — don't manufacture campus tags for them.

## Reference query to start

```sql
-- Items currently sitting in global partition for Doxology
SELECT topic_key, jsonb_array_length(items) AS item_count
FROM web_project_topics
WHERE web_project_id = '4ef827f7-3e66-46d3-a4f6-26e1a744ddba'
  AND campus_slug IS NULL
  AND topic_key <> 'other'
ORDER BY topic_key;
```

```sql
-- Drill into one topic's global items
SELECT jsonb_pretty(items->idx) AS item
FROM web_project_topics, generate_series(0, jsonb_array_length(items) - 1) AS idx
WHERE web_project_id = '4ef827f7-3e66-46d3-a4f6-26e1a744ddba'
  AND campus_slug IS NULL
  AND topic_key = 'sundays';
```

## Stop conditions

- Don't propose more than 50 moves in one batch — review and apply,
  then re-pull and decide on the next batch.
- If you can't tell which campus an item belongs to, **leave it
  global**. Better church-wide-and-wrong than mis-tagged.
- Don't infer from context not in the row (no "the partner mentioned
  X in a meeting"). Decide purely from the item's text + source_url.

## Result I'm looking for

After this cleanup, every per-campus fact (service times, addresses,
phone numbers, campus pastors, meeting times) should sit under the
campus it actually belongs to. The global partition should hold only
church-wide truths — identity, beliefs, mission, shared programs.
