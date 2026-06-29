# Multi-Campus Work — Fresh-Session Handoff

This brief catches a fresh Claude Code session up to where the
multi-campus / Doxology work stands. Copy-paste this whole document
into your first message.

## State

Multi-campus is functionally live and shipping to production. Doxology
Bible Church (project `4ef827f7-3e66-46d3-a4f6-26e1a744ddba`, member
1963) is the lead use case. Three campuses configured: `southwest`
(primary, English), `alliance` (English), `espanol` (Spanish).

## Architecture (already committed, deployed)

### Schema
- `v113` — `strategy_web_projects.campuses jsonb` + `campus_label_*` text.
- `v114` — `web_project_topics.campus_slug text`.
- `v115` — uniqueness on
  `(web_project_id, topic_key, campus_slug) NULLS NOT DISTINCT`.
- `v116` — `strategy_web_projects.default_language text DEFAULT 'en'`.
- `v117` — `web-hub.crawl_jobs.firecrawl_crawl_id text` + index.

### Edge functions (all deployed)
- `fire-crawl-trigger` — v117 webhook architecture. Starts a Firecrawl
  crawl with `webhook: {url, events: ['completed','failed']}` and
  returns in ~1-2 s. NO synchronous polling. Records
  `firecrawl_crawl_id` so the webhook handler can find the job.
- `firecrawl-webhook` — new. `verify_jwt: false`. Implicit auth =
  `firecrawl_crawl_id` must match a row we created. On completion,
  pages `/v1/crawl/{id}?limit=20&skip=N` from Firecrawl (NOT from the
  webhook body — Firecrawl's webhook payload doesn't include data),
  strips HTML to control memory, applies a heavy-prefix filter
  (≥3 children → drop them, keep only the index), normalizes pages
  down to `{url, title, markdown, metadata.sourceURL}`. Hard cap 100
  pages kept. Writes crawl_results, chains copy-fixing + atomize.
- `crawl-categorize` — strips campus prefix before URL pattern
  matching (so `/southwest/kids` matches the kids topic). Aggregates
  pages across ALL completed crawl_jobs for the project before
  partitioning. Cross-partition dedup: items appearing in global +
  any campus → keep only global; items appearing in 2+ campuses
  with no global → promote to global. Per-campus language detection
  with a `ñ/¿/¡ ≥ 5` absolute override that beats stopword tallies
  even on small English-template / Spanish-content bilingual sites.
- `atomize-crawl-into-atoms` — tags each atom's `metadata.campus_slug`.

### RPC
- `web_crawl_expand(p_web_project_id uuid)` — for multi-campus
  projects (`campuses[]` non-empty), iterates the registry and fires
  ONE `fire-crawl-trigger` call per campus's `crawl_url`. Each call
  creates its own crawl_job. Single-campus projects fall back to one
  call against the project's last completed target_url.
- `cowork_load_outline_context` (v115c) — selects topics by
  `topic_key = ANY(...)`. Surfaces `campus_slug` per topic + per
  atom, plus the project's `campuses` registry. Phase-4 outline RPC
  for the cowork pipeline.

### Browser
- `InventoryView` (`src/components/wm/inventory/InventoryView.tsx`)
  receives `topicRows: TopicRow[]` (raw per-campus rows), merges per-
  campus rows into one TopicRow per topic_key with `_src_campus`
  stamped on each item, renders:
  - `CampusOverview` banner (multi-campus only) listing campuses
    with content counts.
  - `CampusSourcesLine` under each topic header listing contributing
    campuses when content spans more than one.
  - `CampusBadge` pill on each program card showing source campus.
  - Verbatim-language banner (`!reviewMode` only — staff view).
- Partner view (`reviewMode={true}`) drops all banner/jargon
  surfaces. Strict rule the user gave: never put CMS-internal
  language in front of partners.

### Cowork
- `page-context-bundle` surfaces `campuses` field, atom `metadata`
  (carrying `campus_slug`), and re-shapes `crawl_topics_pool.by_key`
  for multi-campus projects with per-campus nested children.
- `plan-cross-page-allocation/SKILL.md` has a top-of-file "Non-
  English partner sites" section that locks every atom to
  `lift_verbatim` when `default_language != 'en'`.
- `plan-site-strategy/SKILL.md` has a "Multi-campus discipline"
  section covering per-campus-page vs global-page-with-callouts vs
  one global page.

## Open issues to address

1. **Per-campus facts leaking to global.** Service times, addresses,
   meeting times, and phone numbers for Doxology landed in
   `(project, sundays, NULL)` and similar instead of
   `(project, sundays, 'southwest')`. Root cause: when Doxology's
   crawl visited `doxology.church/` AND `doxology.church/southwest/`,
   both rendered Southwest's content. The crawler tagged the root URL
   as global (no campus prefix) and the southwest URL as southwest.
   Cross-partition dedup saw the duplicate and promoted to global —
   but in this case the "global" copy was just the root reflecting
   the primary campus's content.

   **Two fixes worth considering:**
   - At categorize-time: for `meeting_time`, `location_info`,
     `contact_block`, `cta` (campus-URL'd), and `detail` items whose
     label matches per-campus-fact patterns (service times, address,
     pastor name, etc.), NEVER promote to global. Keep them in the
     campus partition they came from, or fall back to the primary
     campus when ambiguous.
   - At partition-time: when an item's source_url is the project's
     root and the project has a primary campus, tag the item as
     primary (not global). The root URL of a multi-campus church
     defaults to rendering the primary campus.

   See `handoffs/cowork-data-cleanup-prompt.md` — that's the one-shot
   cowork prompt to clean up Doxology's current rows by hand while
   the proper fix gets built.

2. **`location_contact` global has 197 items.** Footer chrome from
   every crawled page deposits address/phone fragments into
   location_contact. Even after dedup, this bucket is bloated. Two
   passes worth: (a) tighten the LLM prompt to only emit
   `location_contact` from pages that are PRIMARILY about contact
   (drop footer-fragment scrapes); (b) prefer the canonical contact
   page over per-page footer copies in dedup.

3. **AddMissingButton default.** With the chip filter gone (replaced
   by CampusOverview), `selectedCampus` in `CampusFilterContext`
   defaults to the primary campus. AddMissingButton uses that as the
   default for new entries. May want to default to `null` (church-
   wide) instead so partners explicitly pick a campus.

4. **`debug-firecrawl-probe` edge function** already deleted. No
   action.

5. **Doxology's espanol crawled to 8 pages.** Firecrawl found 255
   detail pages but the heavy-prefix filter dropped them. If Cameron
   Sanderson confirms there are deep pages we should keep (specific
   ministry programs at /seriespredicaciones/ etc.), revisit the
   filter threshold or add a per-project allow-list.

## Recent commits (most recent first)

```
82eec33  Categorize: aggregate all jobs + cross-partition dedup
9bbc336  Inventory: surface campus structure on every topic + program
a530c69  Categorize: strip campus prefix before URL pre-classification
76a7c10  Language detect: default to Spanish, hide banner from partner
62f2489  Webhook robustness: fetch crawl data + paged + filter + lang
8d6a5c0  Crawl architecture: switch to Firecrawl webhook mode (v117)
3ee01a3  Revert auto multi-seed crawl: each invocation handles ONE URL
da08fca  Language detection + cross-domain campus matching
b937085  Multi-campus crawl: seed every campus URL + stop orphan-wiping
bfde176  Multi-campus: pre-crawl flag + auto-recategorize on save
173f73e  Multi-campus support — Doxology and other multi-location churches
```

## Hard rules from the user

These were re-stated multiple times across the session — follow
without re-confirming:

1. **Partner-facing surfaces never see CMS-internal jargon.** Strip
   "verbatim", "organize the inventory", "we'll help design", etc.
   from partner views. Banners about workflows go in `!reviewMode`
   only.
2. **Spanish > Portuguese for default language.** Partner mix is
   overwhelmingly Spanish-speaking; a Portuguese false-negative is
   preferable to mistagging Spanish content as Portuguese.
3. **Don't burn Firecrawl credits on retries.** Re-use cached
   `/v1/crawl/{id}` data instead of refiring. Each crawl_job's pages
   are paid-for and Firecrawl keeps them for 24h.
4. **"Don't ask me to defer to tomorrow."** Fix the issue, don't
   suggest the user revisit. (Exception: when the user explicitly
   says "we'll come back to it" — then defer.)
5. **Don't commit unrelated working-tree changes.** `scripts/render-
   one.ts`, `supabase/.temp/cli-latest`, prototypes/, and cowork-
   skills/draft-page/examples/ are dirty / unrelated; leave them
   alone.

## Files / paths to know

- Schema: `schema/v113`…`v117*.sql` — multi-campus stack
- Edge functions: `supabase/functions/{fire-crawl-trigger,
  firecrawl-webhook, crawl-categorize, atomize-crawl-into-atoms}`
- Shared utils: `supabase/functions/_shared/{campusMatching,
  languageDetect, firecrawlPostProcess}.ts`
- Browser side: `src/components/wm/inventory/InventoryView.tsx`,
  `src/lib/webCampuses.ts`, `src/components/wm/workspaces/
  CrawlWorkspace.tsx`, `src/pages/ContentCollectionPage.tsx`,
  `src/components/wm/workspaces/CrawlInventory.tsx`
- Cowork pipeline: `api/web/cowork/page-context-bundle.ts`,
  `cowork-skills/plan-cross-page-allocation/SKILL.md`,
  `cowork-skills/plan-site-strategy/SKILL.md`
- Backfill (one-off Doxology relic): `scripts/backfill-doxology-
  campuses.ts` — header notes it's no longer needed for new partners

## Suggested first move in the next session

Tackle item #1 from "Open issues" — the per-campus-facts-leaking-to-
global bug. Add a "never promote to global" list in
`crawl-categorize/index.ts`'s `dedupAcrossPartitions` (keyed on item
kind + label patterns) so service times, addresses, contact blocks
stay in their source campus partition. Optionally, add a "fallback
to primary campus when source_url is the project root and the
project has campuses[] populated" rule in `partitionBucketByCampus`.

After that, re-run categorize on Doxology and verify the global
`sundays` row no longer contains "Service Times: 9 AM & 10:30 AM"
(which is Southwest-only).
