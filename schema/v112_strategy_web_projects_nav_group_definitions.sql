-- v112 — nav_group_definitions jsonb on strategy_web_projects
--
-- The Pages workspace lets staff organize pages into nav groups (v111).
-- Today a group exists only if at least one page carries that label —
-- there's no way to add an EMPTY group and assign pages to it later.
--
-- This adds a per-project list of "known" group definitions. Pages
-- still carry the source-of-truth nav_group_label; the definitions
-- array is the registry of groups that exist regardless of page
-- assignments. Empty groups (no pages yet) live here.
--
-- Shape: [{label: string, sort_order: integer}]
-- Sort by sort_order; consistent with web_pages.nav_group_sort_order.
--
-- Backfill: derive initial definitions from existing nav_group_label
-- assignments on web_pages. One entry per distinct label per project;
-- sort_order = the existing nav_group_sort_order from any member page
-- (all members share the same value per the v111 invariant).

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS nav_group_definitions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN strategy_web_projects.nav_group_definitions IS
  'Per-project registry of nav group definitions. Each entry: {label, sort_order}. Empty groups exist here even when no web_pages row carries the label. Renames + moves keep this in sync with web_pages.nav_group_label / nav_group_sort_order.';

-- Seed from existing page assignments. Aggregates distinct
-- (nav_group_label, nav_group_sort_order) pairs per project. Skips
-- projects that already have entries so this migration is idempotent.
WITH per_project_groups AS (
  SELECT
    wp.web_project_id,
    jsonb_agg(
      jsonb_build_object('label', label, 'sort_order', sort_order)
      ORDER BY sort_order
    ) AS defs
  FROM (
    SELECT DISTINCT
      web_project_id,
      nav_group_label                     AS label,
      COALESCE(nav_group_sort_order, 0)   AS sort_order
    FROM web_pages
    WHERE nav_group_label IS NOT NULL
      AND archived = false
  ) wp
  GROUP BY wp.web_project_id
)
UPDATE strategy_web_projects p
SET    nav_group_definitions = pg.defs
FROM   per_project_groups pg
WHERE  p.id = pg.web_project_id
  AND  (p.nav_group_definitions IS NULL OR p.nav_group_definitions = '[]'::jsonb);
