-- v113 — multi-campus support on strategy_web_projects
--
-- Most projects are single-campus (one church, one site, one address).
-- A growing minority — Doxology Bible Church is the lead use case —
-- run multiple campuses where each has distinct ministries, service
-- times, kids programs, etc. Today's data model collapses everything
-- to project-level; that loses the campus dimension and forces staff
-- to manually re-segment downstream.
--
-- This adds a per-project campus registry plus display-label
-- customization (denominations vary: "campus", "congregation",
-- "location", "site", "parish"). Pre-existing single-campus projects
-- keep an empty registry — the rest of the system gates behavior on
-- `campuses[] != []`.
--
-- Shape:
--   campuses: [{
--     slug: string,        -- URL-safe identifier, e.g. "southwest"
--     label: string,       -- human-readable, e.g. "Southwest"
--     primary: boolean,    -- one campus is the default; others fork from it
--     sort_order: integer, -- display order (lower first)
--     crawl_url: string|null, -- per-campus crawl seed URL
--   }]
--
-- Detection runs first (crawl-categorize) and surfaces candidates to
-- staff. Staff confirm/edit, then this column gets populated.

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS campuses              jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS campus_label_singular text,
  ADD COLUMN IF NOT EXISTS campus_label_plural   text;

COMMENT ON COLUMN strategy_web_projects.campuses IS
  'Per-project campus registry. Empty array = single-campus project (default behavior unchanged). Non-empty triggers campus-aware crawl, content collection grouping, and site strategy fork.';
COMMENT ON COLUMN strategy_web_projects.campus_label_singular IS
  'UI display term for one campus, e.g. "Campus", "Congregation", "Location". Defaults to "Campus" when null. Customizable per project to match the church''s terminology.';
COMMENT ON COLUMN strategy_web_projects.campus_label_plural IS
  'UI display term for many campuses. Defaults to "Campuses" when null.';
