-- v111 — nav-group columns on web_pages (+ one-time backfill from
-- roadmap_state.site_strategy.nav.primary[].children)
--
-- Strategists already build a nav grouping for each project as part of
-- step 6 (plan-site-strategy). That output lives at
--   roadmap_state.site_strategy.nav.primary[]
-- where each element is either `{slug}` (top-level item) or
-- `{slug, children: [<child_slug>, ...]}` (dropdown group whose
-- children are the items under it).
--
-- The PagesWorkspace doesn't surface those groupings today — pages
-- render as a flat list ordered by sort_order. This adds two columns:
--   nav_group_label      text         — the group's display name (NULL = ungrouped)
--   nav_group_sort_order integer NULL — ordering between groups (consistent
--                                       across all pages in the same group)
--
-- Pages within a group continue to use sort_order. Reordering groups
-- only touches nav_group_sort_order, never sort_order. Both columns are
-- nullable + additive — every existing reader continues to work
-- unchanged.

ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS nav_group_label      text,
  ADD COLUMN IF NOT EXISTS nav_group_sort_order integer;

COMMENT ON COLUMN web_pages.nav_group_label IS
  'Optional group name (e.g. "About", "Ministries") for the Pages workspace navigation grouping. NULL = ungrouped. Defaults are seeded from site_strategy.nav.primary[].children; staff can rename / reassign after the fact.';
COMMENT ON COLUMN web_pages.nav_group_sort_order IS
  'Sort key for the group itself (NOT the page within the group — that stays in sort_order). All pages sharing a nav_group_label should have the same nav_group_sort_order; the UI enforces that invariant.';

-- ── Backfill from site_strategy.nav.primary[] ──────────────────────────
-- For every active project, walk the primary nav. Items WITH a children
-- array become groups; their children inherit the parent slug
-- (humanized) as nav_group_label. Group sort order = the parent's
-- position in primary[] × 100 (leaves room for inserts).
WITH proj_groups AS (
  SELECT
    p.id AS web_project_id,
    parent_idx AS group_ix,
    initcap(replace(parent.value->>'slug', '-', ' ')) AS group_label,
    trim(both '"' from child.value::text) AS page_slug
  FROM strategy_web_projects p,
       jsonb_array_elements(
         COALESCE(p.roadmap_state->'site_strategy'->'nav'->'primary', '[]'::jsonb)
       ) WITH ORDINALITY AS parent(value, parent_idx),
       jsonb_array_elements(COALESCE(parent.value->'children', '[]'::jsonb)) AS child
  WHERE NOT p.archived
    AND jsonb_typeof(parent.value->'children') = 'array'
    AND jsonb_typeof(child.value) = 'string'
)
UPDATE web_pages wp
SET    nav_group_label      = pg.group_label,
       nav_group_sort_order = (pg.group_ix * 100)
FROM   proj_groups pg
WHERE  wp.web_project_id = pg.web_project_id
  AND  wp.slug = pg.page_slug
  AND  wp.archived = false
  AND  wp.nav_group_label IS NULL;
