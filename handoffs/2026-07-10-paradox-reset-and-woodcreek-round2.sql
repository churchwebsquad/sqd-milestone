-- =====================================================================
-- 2026-07-10 — Paradox status reset + Woodcreek Round 2 nav
-- =====================================================================
--
-- Paste the whole file into Supabase SQL Editor for project squad-data
-- (jzsqmjfxvthvcdpiraam) and run.
--
-- BLOCK A: Reset Paradox 3005 sitemap_review status. Phantom
--   partner_reviewed flag from an early manual JSON push; no partner
--   actually submitted. Puts it back to draft.
--
-- BLOCK B: Rewrite Woodcreek 3249 site_strategy nav + footer for
--   Round 2, based on partner feedback from Round 1. Also carries the
--   contextual pages (Indoor Playground, Sonshine cross-link, Project
--   4:12 + Bibles & Burgers as featured inside Groups).
--
-- Both blocks are idempotent. Re-running has no effect if already
-- applied.
-- =====================================================================


-- ============================================================
-- BLOCK A — Paradox status reset
-- ============================================================

UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        roadmap_state,
        '{sitemap_review,status}',
        '"draft"'::jsonb
      ),
      '{sitemap_review,published_at}',
      'null'::jsonb
    ),
    '{sitemap_review,partner_reviewed_at}',
    'null'::jsonb
  ),
  '{sitemap_review,partner_reviewed_by}',
  'null'::jsonb
)
WHERE member = 3005
  AND roadmap_state -> 'sitemap_review' ->> 'status' = 'partner_reviewed';

-- Verify:
SELECT
  member,
  roadmap_state -> 'sitemap_review' ->> 'status'              AS status,
  roadmap_state -> 'sitemap_review' ->> 'partner_reviewed_at' AS partner_reviewed_at,
  roadmap_state -> 'sitemap_review' ->> 'partner_reviewed_by' AS partner_reviewed_by
FROM strategy_web_projects
WHERE member = 3005;


-- ============================================================
-- BLOCK B — Woodcreek 3249 Round 2 site_strategy
-- ============================================================
--
-- Replaces roadmap_state.site_strategy.nav for Woodcreek with the
-- Round 2 structure from partner feedback:
--
--   Teaching ▾    → Messages, Podcast, Live, Blog
--   Life at Woodcreek ▾ → Kids (label; Kidcreek = hero), Sonshine (PDO
--                          6mo–5yr), Youth, Men, Women, Marriage,
--                          Seniors, Care, Worship
--                          (Young Adults REMOVED, Sonshine elevated)
--   Next Steps ▾  → Gather: Groups & Bible Studies, Prayer
--                    Go: Serve, Outreach
--                    Grow: Baptism, Membership   (split into two)
--   Events & Classes  (flat)
--   About ▾       → History & Beliefs, Leadership
--   CTAs: Visit, Give
--
-- Footer:
--   Prayer (prominent), Contact, 50 Years, Indoor Playground,
--   Employment, Post Script Podcast, Church Center Login, Staff Page
--   (gated). eNews removed.
--
-- Contextual (real pages, not in top nav):
--   Indoor Playground (formerly "Facility Rental"; public hours);
--   Sonshine (cross-linked from Kids + Home);
--   Project 4:12 + Bibles & Burgers (featured inside Groups).

UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  roadmap_state,
  '{site_strategy,nav}',
  '{
    "primary": [
      { "slug": "teaching", "label": "Teaching", "has_children": true, "children": [
        { "slug": "messages", "label": "Messages" },
        { "slug": "podcast",  "label": "Podcast" },
        { "slug": "live",     "label": "Live" },
        { "slug": "blog",     "label": "Blog" }
      ] },
      { "slug": "life-at-woodcreek", "label": "Life at Woodcreek", "has_children": true, "children": [
        { "slug": "kids",     "label": "Kids" },
        { "slug": "sonshine", "label": "Sonshine (Parents Day Out, 6mo–5yr)" },
        { "slug": "youth",    "label": "Youth" },
        { "slug": "men",      "label": "Men" },
        { "slug": "women",    "label": "Women" },
        { "slug": "marriage", "label": "Marriage" },
        { "slug": "seniors",  "label": "Seniors" },
        { "slug": "care",     "label": "Care" },
        { "slug": "worship",  "label": "Worship" }
      ] },
      { "slug": "next-steps", "label": "Next Steps", "has_children": true, "children": [
        { "group_label": "Gather", "children": [
          { "slug": "groups", "label": "Groups & Bible Studies" },
          { "slug": "prayer", "label": "Prayer" }
        ] },
        { "group_label": "Go", "children": [
          { "slug": "serve",    "label": "Serve" },
          { "slug": "outreach", "label": "Outreach" }
        ] },
        { "group_label": "Grow", "children": [
          { "slug": "baptism",    "label": "Baptism" },
          { "slug": "membership", "label": "Membership" }
        ] }
      ] },
      { "slug": "events", "label": "Events & Classes" },
      { "slug": "about",  "label": "About", "has_children": true, "children": [
        { "slug": "history-beliefs", "label": "History & Beliefs" },
        { "slug": "leadership",      "label": "Leadership" }
      ] }
    ],
    "cta_only": [
      { "slug": "visit", "label": "Visit" },
      { "slug": "give",  "label": "Give" }
    ],
    "footer": {
      "primary_links": [
        { "slug": "prayer", "label": "Request Prayer / Pray for Others" }
      ],
      "explore": [
        { "slug": "contact",            "label": "Contact" },
        { "slug": "50-years",           "label": "50 Years" },
        { "slug": "indoor-playground",  "label": "Indoor Playground" },
        { "slug": "employment",         "label": "Employment" },
        { "slug": "post-script-podcast","label": "Post Script Podcast" }
      ],
      "legal": [
        { "slug": "church-center-login", "label": "Church Center Login" },
        { "slug": "staff-page",          "label": "Staff Page" }
      ]
    }
  }'::jsonb
)
WHERE member = 3249;

-- Append / upsert the contextual + Round-2-added pages into site_strategy.pages.
-- Only inserts pages whose slug isn't already present. jsonb-safe append.
WITH proj AS (
  SELECT id, roadmap_state
  FROM strategy_web_projects
  WHERE member = 3249
  LIMIT 1
),
existing_slugs AS (
  SELECT p.id, array_agg(page ->> 'slug') AS slugs
  FROM proj p,
       jsonb_array_elements(coalesce(p.roadmap_state -> 'site_strategy' -> 'pages', '[]'::jsonb)) page
  GROUP BY p.id
),
additions AS (
  SELECT p.id, jsonb_build_array(
    jsonb_build_object('slug', 'sonshine',
                       'name', 'Sonshine (Parents Day Out)',
                       'purpose', 'On-ramp for unchurched families with kids ages 6 months to 5 years. Cross-linked from Kids and Home so first-time visitors find it as a low-barrier entry point.'),
    jsonb_build_object('slug', 'indoor-playground',
                       'name', 'Indoor Playground',
                       'purpose', 'Public indoor playground with posted hours. Formerly labeled "Facility Rental". Linked from footer, Kids, and Visit.'),
    jsonb_build_object('slug', 'prayer',
                       'name', 'Request Prayer / Pray for Others',
                       'purpose', 'Prominent, persistent footer link the partner asked for. Submit a prayer request or step in to pray for others.'),
    jsonb_build_object('slug', 'post-script-podcast',
                       'name', 'Post Script Podcast',
                       'purpose', 'Woodcreek podcast; discoverable from the footer.'),
    jsonb_build_object('slug', 'employment',
                       'name', 'Employment',
                       'purpose', 'Open staff positions and how to apply.'),
    jsonb_build_object('slug', '50-years',
                       'name', '50 Years',
                       'purpose', 'Woodcreek 50th anniversary landing.'),
    jsonb_build_object('slug', 'staff-page',
                       'name', 'Staff Page',
                       'purpose', 'Internal staff resources; gated behind Church Center Login.'),
    jsonb_build_object('slug', 'project-4-12',
                       'name', 'Project 4:12',
                       'purpose', 'Featured inside Groups & Bible Studies as a specific group offering.'),
    jsonb_build_object('slug', 'bibles-burgers',
                       'name', 'Bibles & Burgers',
                       'purpose', 'Featured inside Groups & Bible Studies as a specific group offering.'),
    jsonb_build_object('slug', 'serve',
                       'name', 'Serve',
                       'purpose', 'How serving works (raise your hand → get set up → jump in) + role cards (Hospitality, Worship Arts, Kids, Youth, Outreach). Content in handoffs/2026-07-10-woodcreek-serve-page-copy.md.')
  ) AS candidates
  FROM proj p
)
UPDATE strategy_web_projects sp
SET roadmap_state = jsonb_set(
  sp.roadmap_state,
  '{site_strategy,pages}',
  coalesce(sp.roadmap_state -> 'site_strategy' -> 'pages', '[]'::jsonb) ||
  (SELECT jsonb_agg(cand)
   FROM additions a,
        jsonb_array_elements(a.candidates) cand
   WHERE NOT (cand ->> 'slug' = ANY (SELECT unnest(es.slugs)
                                     FROM existing_slugs es
                                     WHERE es.id = sp.id))),
  true
)
FROM existing_slugs es
WHERE sp.id = es.id
  AND sp.member = 3249;

-- Bump the site_strategy._meta.generated_at so downstream renderers
-- know a fresh revision landed.
UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  roadmap_state,
  '{site_strategy,_meta,generated_at}',
  to_jsonb(now()::text),
  true
)
WHERE member = 3249;

-- Verify Woodcreek Round 2 shape:
SELECT
  member,
  jsonb_array_length(roadmap_state -> 'site_strategy' -> 'nav' -> 'primary')  AS primary_top_level_count,
  jsonb_array_length(roadmap_state -> 'site_strategy' -> 'nav' -> 'cta_only') AS cta_count,
  roadmap_state -> 'site_strategy' -> 'nav' -> 'footer' -> 'primary_links'    AS footer_primary,
  jsonb_array_length(roadmap_state -> 'site_strategy' -> 'pages')             AS page_count,
  roadmap_state -> 'site_strategy' -> '_meta' ->> 'generated_at'              AS generated_at
FROM strategy_web_projects
WHERE member = 3249;
