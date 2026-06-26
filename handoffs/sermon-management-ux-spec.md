# Sermon Management UX — Content Collection Page 2

Local design spec. Nothing pushed until you sign off.

## Goal

Restructure the SermonsQuestion section so the partner can compose
exactly how the Watch page shows up. Two questions instead of one
tier ladder:

1. **What do we put on the Watch page?**
2. **When someone clicks a sermon, where do they land?**

The current 3-tier ladder (cta_only / embed_latest / wordpress)
collapses these two decisions into one and hides the on-site-page
option behind "Most Complex," which is the wrong frame — a sermon
detail page (your "With Jesus in the Room" example from Mosaic) is
a content choice, not a complexity tier.

## New shape

**Question 1 — What to embed.** Required.

  ○  Most recent sermon only
       The Watch page features ONE sermon — the latest one. New
       sermons replace the previous one automatically.

  ○  Most recent series
       The Watch page features the latest series — current sermon
       on top, prior sermons in the series shown below as cards.

  ○  Full archive
       Every sermon, browsable. Filters by date / series / speaker.

**Question 2 — Where each sermon links.** Visible only when Q1 ≠
"Most recent sermon only".

  ○  Direct to YouTube
       Clicking a sermon opens its YouTube video in a new tab.
       Simplest — no extra page maintenance.

  ○  Individual on-site page for each sermon
       Each sermon gets its own page with description, scripture,
       embedded video, etc. More polish; more upkeep.

When Q1 == "Most recent sermon only", we lock Q2 to "Direct to
YouTube" (per your spec — single-sermon mode has no archive to
link into).

## State / data model

Reuses the existing `strategy_content_collection_sessions` columns:

- `sermons_display_preference` (text) — new values:
  - `latest_sermon` — Q1 "most recent sermon only" (Q2 implicitly YouTube)
  - `latest_series_youtube` — Q1 "most recent series" + Q2 YouTube
  - `latest_series_pages`   — Q1 "most recent series" + Q2 on-site pages
  - `archive_youtube`       — Q1 "full archive" + Q2 YouTube
  - `archive_pages`         — Q1 "full archive" + Q2 on-site pages
- `sermons_external_url` (text) — YouTube/Vimeo channel/playlist URL.
  Always required.
- `sermon_archive_features` (text[]) — multi-select extras (notes,
  audio, filters, discussion guides). Visible only when Q1 == "Full
  archive" AND Q2 == "on-site pages".

Why one combined column instead of two: the front-end is simpler
(one radio group's value drives both rendered choices), and the
downstream layout-picker reads ONE field to know how to render the
Watch page. Splitting into two booleans would require teaching every
consumer about both fields.

## Migration of existing values

Old → new mapping:

  cta_only      → latest_sermon         (we'll keep showing the latest sermon, just link to YouTube)
  embed_latest  → latest_sermon         (already does this — same intent)
  wordpress     → archive_pages         (existing full-archive partners get the on-site-pages variant)

No data loss. Migration runs once at deploy:

```sql
UPDATE strategy_content_collection_sessions
SET sermons_display_preference = CASE sermons_display_preference
  WHEN 'cta_only'     THEN 'latest_sermon'
  WHEN 'embed_latest' THEN 'latest_sermon'
  WHEN 'wordpress'    THEN 'archive_pages'
  ELSE sermons_display_preference
END
WHERE sermons_display_preference IN ('cta_only', 'embed_latest', 'wordpress');
```

## Render — partner-facing draft

```
┌─────────────────────────────────────────────────────────────────┐
│  How should sermons show up on your new site?                   │
│  Required — we use this to plan the Watch page layout.          │
│                                                                 │
│  ○ Most recent sermon only                                      │
│    The Watch page features the latest sermon. Replaces          │
│    automatically when you upload a new one.                     │
│                                                                 │
│  ○ Most recent series                                           │
│    The Watch page features the current series — newest          │
│    message at the top, prior messages in the series shown       │
│    below.                                                       │
│                                                                 │
│  ○ Full sermon archive                                          │
│    Every sermon, browsable. Filters by date, series, speaker.   │
│                                                                 │
│  [Once an option is picked, the linking question appears.]      │
│                                                                 │
│  How should clicks on a sermon work?                            │
│  [Locked to YouTube when "Most recent sermon only" is picked.]  │
│                                                                 │
│  ○ Open the YouTube video in a new tab                          │
│    Simplest. No extra page maintenance on your side.            │
│                                                                 │
│  ○ Each sermon gets its own page on our site                    │
│    Description, scripture references, embedded video. More      │
│    polish; you keep each page updated.                          │
│                                                                 │
│  Link to your sermon channel: [https://youtube.com/____    ]    │
│                                                                 │
│  [If on-site pages picked, archive-features multi-select shows  │
│   below for sermon notes / audio / filters / discussion guides.]│
└─────────────────────────────────────────────────────────────────┘
```

## Examples I'll use for the implementation

Each image maps to a different end state:

  ┌─────────────────────────┬───────────────────────────────────────────────┐
  │  One City                │  latest_sermon — single featured video on the │
  │  (Crowned hero)          │  Watch page; clicks open YouTube.             │
  ├─────────────────────────┼───────────────────────────────────────────────┤
  │  Mosaic light            │  latest_series_(youtube|pages) — featured     │
  │  ("Watch Online" hero +  │  current sermon on top, the rest of the       │
  │  "Current Series" cards) │  series below as cards.                       │
  ├─────────────────────────┼───────────────────────────────────────────────┤
  │  Pentecost               │  archive_(youtube|pages) — full archive grid  │
  │  (Comforter Has Come)    │  with per-sermon cards, filters by series.    │
  ├─────────────────────────┼───────────────────────────────────────────────┤
  │  Mosaic dark             │  This is the *destination* layout for a       │
  │  ("Currently Watching")  │  per-sermon ON-SITE page — i.e. what you land │
  │                          │  on when a series/archive card sends you to a │
  │                          │  page on our site (rather than YouTube). So   │
  │                          │  this image illustrates the difference between│
  │                          │  the `_youtube` and `_pages` link-target      │
  │                          │  choice, not the index layout itself.         │
  └─────────────────────────┴───────────────────────────────────────────────┘

## Stop-before-pushing checklist

When you sign off on the spec, the actual rollout is:

- [ ] Reference component drafted in `src/pages/ContentCollectionPage.tsx`
      — replaces the existing SermonsQuestion. Keep all 5 enum values
      writeable, gate the visible options by Q1's value.
- [ ] Data migration via `apply_migration` (CASE WHEN remap above).
- [ ] Verify partners with existing `cta_only` / `embed_latest` /
      `wordpress` rows see the new UI pre-filled correctly.
- [ ] downstream consumers that read `sermons_display_preference` —
      list them and update each. Search:
      `grep -rn "sermons_display_preference" src/ supabase/ api/`

## Calls I'm making (override if wrong)

1. **`cta_only` → `latest_sermon`.** Both old states render exactly one
   featured sermon on the Watch page, so collapsing them is correct.
   We do NOT add a 4th "just a button, no embed" Q1 option — partners
   who picked `cta_only` were saying "I just want the latest sermon
   linked," and the new `latest_sermon` mode delivers that with an
   embed + click-out to YouTube. The embed is strictly better than a
   bare button. If you want to keep the no-embed-at-all option, say
   so and I'll add a Q1 toggle for "Hide the embed, just show a CTA
   button" on the `latest_sermon` mode.

2. **Archive features fire whenever per-sermon ON-SITE pages render.**
   So: `latest_series_pages` AND `archive_pages`. Both have per-sermon
   pages where notes/audio/discussion-guides have somewhere to live.
   The YouTube-target modes (`latest_series_youtube`, `archive_youtube`)
   skip this question — no on-site page = no place for those features.

3. **YouTube playlist URL fires for both `_youtube` modes.** Both
   `latest_series_youtube` and `archive_youtube` need a playlist URL
   to populate the card grid. For `latest_sermon`, we use the channel's
   most-recent upload (no playlist needed). I'll rename the existing
   `sermon_youtube_playlist_*` fields accordingly so they're clearly
   tied to "this is the playlist your archive/series renders from."

If any of these are wrong, push back. Otherwise I'll implement.
