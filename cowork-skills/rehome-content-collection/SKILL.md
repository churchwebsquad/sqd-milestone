---
name: rehome-content-collection
description: |
  Fix a partner's content collection state: merge duplicate items,
  move miscategorized items out of "other" into their proper topic,
  remove unnecessary items (style guides, boilerplate), and
  cross-populate related topics (sundays from locations_multi
  meeting_times, etc.). You are running in a fresh Claude Code
  session with ZERO app context — everything you need is in this
  skill. Discover the current state by querying Supabase, walk the
  strategist through each proposed edit, persist ONCE at the end.
model: anthropic/claude-opus-4-8
allowed-tools: Read
version: '1.0.0'
---

# Rehome Content Collection

You fix broken states in a partner's **content collection** — the
"what we found on your site" inventory that gets built from a
website crawl + LLM categorization and reviewed by the partner.
Common breakages you handle:

1. **Duplicates within a topic** — the categorizer wrote two entries
   for the same campus / staff member / service, one richer than
   the other. Merge into ONE record that carries the union of the
   two (whichever record's field is populated wins; when both are
   populated, keep the fuller one).
2. **Miscategorized items in `other`** — kids-ministry content,
   students, missions, care, giving, etc. got dumped into the
   `other` bucket instead of their proper topic. Move them out.
3. **Blank topics that have data elsewhere** — the `sundays` topic
   is empty even though `locations_multi` has campus `meeting_time`
   items. Cross-populate.
4. **Unwanted items** — style guides, boilerplate legal text,
   third-party embed metadata the crawler grabbed but no one wants.
   Delete.

You are NOT a categorizer. If the underlying `crawl-categorize` edge
function needs rules changes, that's out of scope — surface the
observation in your handoff note. You ARE a surgical fix-up layer.

## When to invoke

An account manager (or Ashley) opens a partner's content collection
in the sqd-milestone app (`strategy.thesqd.com`), scrolls through
"what we found on your site", and notices: duplicate rows, wrong
buckets, empty topics that should have content, junk items. They
copy this skill's invocation prompt into a fresh Claude Code
session and paste it, naming the partner (church name or member
number). You do the rest.

## Environment (memorize this — a fresh session has zero context)

- **App**: Squad Strategy (`sqd-milestone`) — the internal Church
  Media Squad tool for web strategy + copy + review.
- **Supabase project**: `squad-data` (project_id `jzsqmjfxvthvcdpiraam`).
  Use `mcp__claude_ai_Supabase__execute_sql` and
  `mcp__claude_ai_Supabase__apply_migration` to read + write.
  (Same MCP a fresh Claude Code session has by default.)
- **Partner identifier**: `member` (integer, e.g. `3804` for
  Timberline Church). Every table below is scoped by
  `web_project_id` or `member`.
- **Tables you touch**:
  - `strategy_web_projects` — resolves `member → web_project_id`
    (UUID). Read-only for this skill.
  - `web_project_topics` — THE table. Every fix is a jsonb-set /
    row insert / row delete on this table. Columns:
      - `id`               uuid
      - `web_project_id`   uuid
      - `topic_key`        text — see taxonomy below
      - `topic_label`      text — human display name
      - `passages`         jsonb (array of prose passages)
      - `items`            jsonb (array of typed records)
      - `added_snippet_tokens` text[]
      - `source_page_urls` text[]
      - `campus_slug`      text | null — populated on multi-campus
      - `voice_signal`     jsonb — the categorizer's voice-detection
        outputs (leave alone unless the strategist asks)
  - `strategy_content_collection_sessions` — the container the
    partner is filling in. `member` links to a session. You DO NOT
    modify this — the partner owns it.
  - `strategy_content_collection_marks` — staff-side omit toggles /
    program renames. Read to know what the strategist has already
    hidden; write when you're consolidating an item that had a mark.
- **Topic taxonomy** (canonical keys — use ONLY these, plus `other`
  as a last resort):
    ```
    identity:  beliefs, testimonies, leadership
    ministry:  kids, students, college, adults, worship_music,
               missions, care, counseling, special_needs
    path:      new_here, plan_visit, connect_groups, serve,
               membership, baptism, next_steps, careers
    activity:  sundays, sermons, events, camps_retreats, blog_news
    logistics: location_contact, locations_multi, school
    strategy:  giving
    ```
  If an item doesn't obviously fit one of these, ASK the
  strategist — don't stuff it into `other` reflexively.

## Your inputs (all from the strategist's invocation prompt)

- `partner`: church name OR member number OR project id
- `issues`: free-text description of what needs fixing. Examples:
  - "Fort Collins is duplicated in locations_multi — merge into
    one, keep the one that has sign language interpreter"
  - "Sundays is empty but the campuses each have a meeting_time —
    cross-populate"
  - "Divorce care is in 'other'; it belongs in 'care'"
  - "Kids and students topics are blank; the crawler dumped that
    content under 'other'"
  - "We accidentally ingested a style guide — remove it"

## Your workflow

### 1. Resolve the partner

Match `partner` to a `member` and `web_project_id`. If the
strategist gave a church name, `ILIKE` search
`strategy_account_progress.church_name` and confirm the match:

```sql
SELECT sap.member, sap.church_name, swp.id AS web_project_id
FROM strategy_account_progress sap
JOIN strategy_web_projects   swp ON swp.member = sap.member
WHERE sap.church_name ILIKE '%<partial name>%';
```

If more than one row comes back, present the options to the
strategist and wait for the pick. Never guess.

### 2. Load the current state

Pull every topic for the project + the strategist's existing marks:

```sql
-- Topics
SELECT id, topic_key, topic_label, campus_slug,
       jsonb_array_length(coalesce(items,    '[]'::jsonb)) AS item_count,
       jsonb_array_length(coalesce(passages, '[]'::jsonb)) AS passage_count,
       items,
       passages,
       source_page_urls
FROM web_project_topics
WHERE web_project_id = '<web_project_id>'
ORDER BY topic_key, campus_slug NULLS FIRST;

-- Existing marks (omits, renames, hides)
SELECT target_kind, target_path, status, client_note,
       proposed_program_name, proposed_program_description
FROM strategy_content_collection_marks
WHERE session_id = (
  SELECT id FROM strategy_content_collection_sessions
  WHERE web_project_id = '<web_project_id>'
  ORDER BY created_at DESC LIMIT 1
);
```

Skim every topic's `items` array. Note: which topics are blank
(`item_count = 0`) that shouldn't be, which topics have suspicious
duplicates (same `name` twice), which items in `other` have keywords
that belong in a canonical topic (kids/students/adults/etc.).

### 3. Diagnose

For each issue the strategist named, restate what you'll change and
show a before → after for the exact records. Example:

> **Fort Collins duplicate merge (locations_multi)**
>
> Two `kind: program` records with `name: "Fort Collins"`. Item A
> at index 2 has: address, campus_pastor, service_times (9 & 11
> AM). Item B at index 5 has: address, campus_pastor, meeting_time
> (9 & 11 AM), **sign_language_interpreter**. Item B has the
> accessibility note, Item A doesn't.
>
> Plan: merge into one item using B as the base, add anything from
> A that B doesn't have, drop A. Result: 4 items in
> locations_multi (down from 5).

Wait for OK before applying anything. If the strategist wants to
tweak (e.g., prefer A's language for `description` even though B
was the base), do that in-memory and re-confirm.

### 4. Operations — SQL patterns

Every mutation uses `jsonb_set` or an item-array rewrite against
`web_project_topics`. Wrap DDL-style rewrites in
`apply_migration`; individual updates via `execute_sql`.

#### 4a. Merge two items in the same topic

```sql
-- Read both items into local variables, compute the union, then
-- write back the reduced array.
WITH cur AS (
  SELECT items FROM web_project_topics
  WHERE web_project_id = '<web_project_id>'
    AND topic_key = 'locations_multi'
    AND campus_slug IS NULL
),
merged AS (
  SELECT jsonb_agg(
    -- Keep every item that isn't A or B, plus one merged record.
    CASE WHEN idx = <B_index> THEN
      -- Merge: start with B, overlay any field from A that B is
      -- missing.
      (SELECT items->2 FROM cur)   -- placeholder — build the merged JSON in memory before this SQL
    WHEN idx = <A_index> THEN NULL
    ELSE items->idx
    END
  ) FILTER (WHERE ... IS NOT NULL) AS next_items
  FROM cur, generate_series(0, jsonb_array_length(items) - 1) idx
)
UPDATE web_project_topics
SET items = (SELECT next_items FROM merged)
WHERE web_project_id = '<web_project_id>'
  AND topic_key = 'locations_multi'
  AND campus_slug IS NULL;
```

For readability, the recommended pattern is: read the topic's
items, compute the merged array LOCALLY in your session (concat A
+ B where B wins on conflict, then drop A), and write the whole
array back via a straightforward `jsonb_set`:

```sql
UPDATE web_project_topics
SET items = '<merged JSON array literal>'::jsonb
WHERE web_project_id = '<web_project_id>'
  AND topic_key = 'locations_multi'
  AND campus_slug IS NULL;
```

Field-level merge rule: for each field in the union of A's + B's
fields, use A's if B's is absent, use B's if A's is absent, and
if both are present, PREFER THE LONGER STRING (usually the more
detailed one). Ask the strategist when both are equally-present
and differ in content.

#### 4b. Move an item from one topic to another

Two writes: remove from source topic's `items`, append to target
topic's `items`. Same session; do both:

```sql
-- Remove from source
UPDATE web_project_topics
SET items = items - <source_index>::int
WHERE web_project_id = '<web_project_id>'
  AND topic_key = 'other';

-- Append to target
UPDATE web_project_topics
SET items = coalesce(items, '[]'::jsonb) || '<moved item JSON>'::jsonb
WHERE web_project_id = '<web_project_id>'
  AND topic_key = 'care';
```

If the target topic row doesn't exist yet (empty ministry
category), INSERT it first:

```sql
INSERT INTO web_project_topics (web_project_id, topic_key, topic_label, items, source_page_urls)
VALUES ('<web_project_id>', 'care', 'Care', '<items array>'::jsonb, '{}');
```

Standard labels for topic_label (use these — the app expects them):

| topic_key         | topic_label                    |
|-------------------|--------------------------------|
| beliefs           | Beliefs & Values               |
| testimonies       | Testimonies & Stories          |
| leadership        | Leadership & Staff             |
| kids              | Kids Ministry                  |
| students          | Students / Youth               |
| college           | College / Young Adults         |
| adults            | Adult Ministry                 |
| worship_music     | Worship & Music                |
| missions          | Missions & Outreach            |
| care              | Care                           |
| counseling        | Counseling                     |
| special_needs     | Special Needs                  |
| new_here          | New Here / First-Time          |
| plan_visit        | Plan a Visit                   |
| connect_groups    | Connect / Groups               |
| serve             | Serve / Volunteer              |
| membership        | Membership                     |
| baptism           | Baptism                        |
| next_steps        | Next Steps                     |
| careers           | Careers / Jobs                 |
| sundays           | Sundays / Services             |
| sermons           | Sermons / Messages             |
| events            | Events / Calendar              |
| camps_retreats    | Camps / Retreats               |
| blog_news         | Blog / News                    |
| location_contact  | Location & Contact             |
| locations_multi   | Locations (multi-site)         |
| school            | School / Preschool             |
| giving            | Giving                         |
| other             | Other                          |

#### 4c. Delete an entire topic row (e.g., an accidentally-ingested style guide)

```sql
DELETE FROM web_project_topics
WHERE web_project_id = '<web_project_id>'
  AND topic_key = '<key to remove>';
```

#### 4d. Delete a single item from a topic

```sql
UPDATE web_project_topics
SET items = items - <index>::int
WHERE web_project_id = '<web_project_id>'
  AND topic_key = '<topic>';
```

Or match on a stable field:

```sql
UPDATE web_project_topics
SET items = (
  SELECT jsonb_agg(i)
  FROM jsonb_array_elements(items) i
  WHERE i->>'name' <> '<item name to remove>'
)
WHERE web_project_id = '<web_project_id>'
  AND topic_key = '<topic>';
```

#### 4e. Cross-populate topic A from topic B

Common case: `sundays` is empty but each `locations_multi` campus
program carries a `meeting_time` nested item. Extract those to
seed `sundays`:

```sql
-- Read the campuses' meeting_times
SELECT campus_program->>'name' AS campus_name,
       nested->>'when'          AS meeting_time
FROM web_project_topics,
     jsonb_array_elements(items) campus_program,
     jsonb_array_elements(campus_program->'items') nested
WHERE web_project_id = '<web_project_id>'
  AND topic_key = 'locations_multi'
  AND campus_program->>'kind' = 'program'
  AND nested->>'kind' = 'meeting_time';

-- Compose a sundays row locally in your session, then insert or
-- append. Prefer append if sundays row exists; INSERT if not.
```

Don't blindly duplicate — if `sundays` has any content already, ASK.
If empty, the cross-populate is safe.

#### 4f. Rename a topic label

Only when the strategist explicitly asks. `topic_label` is
human-display; `topic_key` is the enum and MUST stay canonical.

```sql
UPDATE web_project_topics
SET topic_label = '<new label>'
WHERE web_project_id = '<web_project_id>'
  AND topic_key = '<key>';
```

### 5. Persist — one operation at a time, in a single session

Unlike site-strategy edits (which persist ONCE), content collection
fixes can and should apply per-operation because they're
independent (a merge on locations_multi doesn't depend on a move
in `other`). But do them SEQUENTIALLY, not in parallel — each
write should complete before the next. If any write fails,
STOP and surface the error before proceeding.

Between operations, RE-READ the affected topic to confirm the
write landed as expected. This catches subtle jsonb_set index
errors that would otherwise leave the topic in an inconsistent
state.

### 6. Self-check before declaring done

- [ ] Every topic touched still has `items` as a JSONB array (not
      null, not a string).
- [ ] No topic has `campus_slug` set to an empty string — either
      NULL or a non-empty campus slug.
- [ ] `other` doesn't contain items whose name/description/passages
      clearly belong in a canonical topic. If any remain, they were
      genuinely ambiguous and the strategist chose to leave them.
- [ ] Every duplicate merge preserved the fuller record's fields.
- [ ] No item lost its `passages` array (verbatim partner-facing
      prose that shouldn't get dropped in a merge).
- [ ] Blank topics that were meant to be blank are still blank;
      blank topics that got cross-populated now have items.
- [ ] Topic labels still match the canonical table in §4b.

Run this final read to eyeball the result:

```sql
SELECT topic_key, topic_label,
       jsonb_array_length(coalesce(items, '[]'::jsonb)) AS n_items,
       campus_slug
FROM web_project_topics
WHERE web_project_id = '<web_project_id>'
ORDER BY topic_key, campus_slug;
```

## What you DO NOT do

- **You do NOT touch the crawl-categorize edge function.** If the
  categorizer's rules are systematically wrong (every partner has
  divorce care in "other"), surface it in the handoff note so
  Ashley can patch `supabase/functions/crawl-categorize/index.ts` +
  redeploy. You fix the DATA, not the rules.
- **You do NOT modify the partner's session responses.** Their
  answers live on `strategy_content_collection_sessions` (and its
  `responses` JSONB). Off-limits.
- **You do NOT touch `voice_signal`** on any topic — that's the
  categorizer's language-detection output. Rewriting it manually
  breaks downstream copy-writing.
- **You do NOT delete a topic that has an `added_snippet_tokens`
  array with items in it** — snippets are cross-page references
  used by copy authoring; blowing them away silently breaks page
  builds. If the topic really needs to go, first move / retire
  its snippets, then delete.
- **You do NOT fabricate item content.** If the strategist asks
  you to "add a Fort Collins entry with these details," decline
  and route them to editing the crawled content directly in the
  app. This skill fixes broken categorization; it doesn't AUTHOR.

## Handoff note (required final substep)

Emit a ≤300-word handoff note. Cover:

**(a) What you changed, per topic.** One bullet per operation:
"Merged 2 Fort Collins entries in locations_multi → 1", "Moved 3
items from other → care", "Deleted style_guide topic (2 items)",
etc.

**(b) What you couldn't fix.** Ambiguous items you left in
`other`, items that seem miscategorized but the strategist didn't
confirm the target, blank topics with no crossable source.

**(c) Categorizer patterns to escalate.** If you saw the same
mis-bucketing across 3+ items (e.g., "divorce care" always in
"other"), note it — Ashley may want to patch the URL patterns in
`crawl-categorize`.

**(d) What the strategist should verify in the app.** Open the
crawl inventory (`Content Engine → Crawl Inventory`), hit "Refresh
content + intake docs", scroll to each touched topic, confirm the
after-state matches. Any weirdness → re-invoke this skill with
the follow-up ask.

Because content collection state is user-visible to the partner
IF the session is currently in `status='open'`, if you had to make
any judgment call the strategist didn't explicitly bless, surface
it in **(b)** — never bury it.
