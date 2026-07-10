# Timberline Church (member 3804) — content collection fix

Ashley 2026-07-10 named a specific list of issues on Timberline's
inventory:

1. **Weekend services (sundays) is blank** except for an Easter-times FAQ, even though the `locations_multi` topic already has per-campus meeting times.
2. **Fort Collins is duplicated** in `locations_multi`. One record has "sign language interpreter" and the other doesn't. Merge into one master with the union of fields.
3. **Windsor same problem.** Merge to one.
4. **Kids ministry, students, adults topics are all blank** but "other" is dense with content that belongs in those buckets.
5. **A style guide got ingested** unnecessarily — remove it entirely.
6. **Divorce care, missions, and other ministry content is in "other"** — recategorize to their proper topics.

This handoff pairs with the reusable [`rehome-content-collection`
cowork skill](../cowork-skills/rehome-content-collection/SKILL.md).
Follow the skill's discovery → propose → apply loop. Everything
below is the concrete SELECT + UPDATE / DELETE / INSERT SQL,
targeted at Timberline. Paste into the Supabase SQL Editor for
project `squad-data` (project_id `wttgwoxlezqoyzmesekt`).

Timberline's `web_project_id` (used in every query below):

```sql
-- Confirm:
SELECT id, name, member FROM strategy_web_projects WHERE member = 3804;
```

Substitute the returned UUID everywhere `<TIMBERLINE_ID>` appears.

---

## Step 1 — Discover current state

Run this first to see what topics exist, their item counts, and
whether items are per-campus or global.

```sql
SELECT topic_key, topic_label, campus_slug,
       jsonb_array_length(coalesce(items,    '[]'::jsonb)) AS n_items,
       jsonb_array_length(coalesce(passages, '[]'::jsonb)) AS n_passages
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>'
ORDER BY topic_key, campus_slug NULLS FIRST;
```

Then dump the `other` topic (where kids/students/adults content is
hiding) and the `locations_multi` items (Fort Collins / Windsor
merge targets):

```sql
-- What's in 'other'
SELECT jsonb_pretty(items) AS items
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'other';

-- What's in locations_multi
SELECT jsonb_pretty(items) AS items
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'locations_multi';

-- What's in sundays
SELECT jsonb_pretty(items) AS items, jsonb_pretty(passages) AS passages
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'sundays';
```

Note the **array indices** of items you plan to move / merge /
delete — you'll need them in the operations below.

---

## Step 2 — Merge Fort Collins duplicates in locations_multi

Read the two Fort Collins items, compose a merged JSON object
locally that has the union of fields (prefer the record with the
"sign language interpreter" note as the base, then overlay any
missing fields from the other), and write the reduced array back.

Template (fill in the actual merged JSON):

```sql
-- 1. Read both records to eyeball
SELECT jsonb_pretty(items -> <A_INDEX>) AS fort_collins_a,
       jsonb_pretty(items -> <B_INDEX>) AS fort_collins_b
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'locations_multi';

-- 2. Compose the merged item locally. Rule: field-by-field union,
--    prefer the fuller string when both are populated. Keep sign
--    language interpreter, campus_pastor, service_times, address —
--    every accessibility + scheduling detail.

-- 3. Write back: replace the array with the reduced set. Assumes A
--    was at index <A_INDEX> and B at <B_INDEX>; the merged record
--    replaces A's position, B gets dropped.
UPDATE web_project_topics
SET items = (
  SELECT jsonb_agg(
    CASE WHEN ord = <A_INDEX> THEN '<MERGED_FORT_COLLINS_JSON>'::jsonb
         WHEN ord = <B_INDEX> THEN NULL
         ELSE elem
    END
  ) FILTER (WHERE ord = <A_INDEX> OR ord != <B_INDEX>)
  FROM jsonb_array_elements(items) WITH ORDINALITY AS t(elem, ord0)
  CROSS JOIN LATERAL (SELECT (ord0 - 1)::int AS ord) o
)
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'locations_multi';
```

Verify item count dropped by 1:

```sql
SELECT jsonb_array_length(items) FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'locations_multi';
```

---

## Step 3 — Merge Windsor duplicates in locations_multi

Same pattern as Fort Collins — different indices. Run the discover
query in Step 1 first to identify Windsor's A + B indices AFTER the
Fort Collins merge (indices SHIFT when you remove items).

---

## Step 4 — Cross-populate `sundays` from locations_multi meeting_times

The partner's actual weekend service info lives inside each
campus's nested `items` in `locations_multi` (as `kind:
meeting_time` records). Compose a `sundays` topic from those.

```sql
-- 1. Pull every campus's meeting_time + address into a preview
SELECT campus->>'name'         AS campus,
       nested->>'when'         AS meeting_time,
       nested->>'location'     AS location
FROM web_project_topics,
     jsonb_array_elements(items) campus,
     jsonb_array_elements(coalesce(campus->'items', '[]'::jsonb)) nested
WHERE web_project_id = '<TIMBERLINE_ID>'
  AND topic_key = 'locations_multi'
  AND campus->>'kind' = 'program'
  AND nested->>'kind' = 'meeting_time';

-- 2. If sundays doesn't have a row yet, insert one; if it does,
--    APPEND the composed items to its existing array. Preserve the
--    Easter FAQ that's already there.
--
-- Composed items array shape (adjust to Timberline's campuses):
-- [
--   { "kind": "detail", "label": "Fort Collins service times",  "value": "9:00 AM & 11:00 AM" },
--   { "kind": "detail", "label": "Windsor service times",       "value": "10:30 AM"           },
--   { "kind": "detail", "label": "Loveland service times",      "value": "..."                }
-- ]

UPDATE web_project_topics
SET items = coalesce(items, '[]'::jsonb) ||
            '<COMPOSED_ITEMS_JSON>'::jsonb
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'sundays';
```

If `sundays` doesn't exist (no row), insert instead:

```sql
INSERT INTO web_project_topics
  (web_project_id, topic_key, topic_label, items, passages)
VALUES
  ('<TIMBERLINE_ID>', 'sundays', 'Sundays / Services',
   '<COMPOSED_ITEMS_JSON>'::jsonb, '[]'::jsonb);
```

---

## Step 5 — Move miscategorized items from `other` to their proper topics

From the Step 1 dump of `other`, identify items that clearly belong
in a canonical topic. Ashley named: kids, students, adults, divorce
care (→ `care`), missions.

Pattern per move: pull the item's index from the Step 1 dump, then
remove-from-`other` + append-to-target in one session. Do these
sequentially — indices shift after each remove.

Because indices shift, safer to match by a stable field. Example
for moving anything with "divorce" in its name from `other` to
`care`:

```sql
-- 1. Preview what will move
SELECT jsonb_array_elements(items) AS item
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'other'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(items) i
    WHERE i->>'name' ILIKE '%divorce%'
  );

-- 2. Append matching items to `care` (INSERT the row if `care`
--    doesn't exist yet):
INSERT INTO web_project_topics (web_project_id, topic_key, topic_label, items)
VALUES ('<TIMBERLINE_ID>', 'care', 'Care', '[]'::jsonb)
ON CONFLICT (web_project_id, topic_key, campus_slug) DO NOTHING;

UPDATE web_project_topics
SET items = coalesce(items, '[]'::jsonb) || (
  SELECT jsonb_agg(i)
  FROM web_project_topics o, jsonb_array_elements(o.items) i
  WHERE o.web_project_id = '<TIMBERLINE_ID>' AND o.topic_key = 'other'
    AND i->>'name' ILIKE '%divorce%'
)
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'care';

-- 3. Remove the moved items from `other`
UPDATE web_project_topics
SET items = (
  SELECT jsonb_agg(i)
  FROM jsonb_array_elements(items) i
  WHERE i->>'name' NOT ILIKE '%divorce%'
)
WHERE web_project_id = '<TIMBERLINE_ID>' AND topic_key = 'other';
```

Repeat the same pattern for **each** category Ashley named. The
match keywords per bucket:

| Target topic  | Match items in `other` where `name` / `description` matches            |
|---------------|-------------------------------------------------------------------------|
| `kids`        | kids, children, KidLife, nursery, preschool, Sunday Kids                |
| `students`    | students, youth, middle school, high school, YouthGroup                 |
| `adults`      | men, women, seniors, marriage, mom, dad, adult                          |
| `missions`    | missions, outreach, global, local outreach, mission partner             |
| `care`        | care, prayer, grief, funerals, divorce, recovery, support               |
| `worship_music` | worship, music, choir, band, worship arts                             |
| `serve`       | serve, volunteer, get involved                                          |
| `giving`      | give, giving, tithe, generosity, stewardship                            |

For each pass, ADAPT the ILIKE pattern to actual item names you
saw in Step 1's dump. Don't blindly move — read the item body /
description before moving to make sure it's not, say, an "About"
page mentioning "care ministry" in passing.

---

## Step 6 — Remove the accidentally-ingested style guide

If it's an entire topic row (e.g. `topic_key = 'style_guide'` or
`'brand_guide'`):

```sql
-- Confirm before firing:
SELECT topic_key, topic_label, jsonb_array_length(items) AS n
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>'
  AND (topic_key ILIKE '%style%' OR topic_key ILIKE '%brand%' OR topic_label ILIKE '%style guide%');

-- Delete:
DELETE FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>'
  AND topic_key = '<style_guide_topic_key_here>';
```

If it's individual items inside `other` or another topic, use the
Step 5 move-out pattern but SKIP the append — just remove.

---

## Step 7 — Verify

```sql
SELECT topic_key, topic_label, campus_slug,
       jsonb_array_length(coalesce(items, '[]'::jsonb)) AS n_items
FROM web_project_topics
WHERE web_project_id = '<TIMBERLINE_ID>'
ORDER BY topic_key, campus_slug;
```

Expected after all fixes:
- `sundays` has content (was ≤1 items with the Easter FAQ, now has campus service times + Easter FAQ preserved).
- `kids`, `students`, `adults`, `missions`, `care` each have ≥1 items (were 0 before).
- `locations_multi` count dropped by 2 (Fort Collins + Windsor duplicates merged).
- `other` count dropped by 5+ (kids/students/adults/missions/care items moved out).
- Style guide topic gone (either whole row deleted or items removed).

Open the composer for Timberline in the app, click **Refresh
content + intake docs** on the crawl inventory (this now re-fires
categorize + atomize live per the 2026-07 fix), and confirm the
partner-facing view reflects the reorganization.
