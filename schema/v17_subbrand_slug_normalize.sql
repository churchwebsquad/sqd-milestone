-- v17_subbrand_slug_normalize.sql
--
-- Subbrands created before the "{parent}/{ministry}" slug convention landed
-- have flat slugs (e.g. "kids") that don't match the new `/brand/{church}/{ministry}`
-- routing or the editor's composite-slug lookup. This migration rewrites those
-- legacy rows to the new format.
--
-- Safe to re-run: only touches subbrands whose current slug has no `/` (i.e.
-- hasn't already been normalized). The update is self-joined against the
-- parent's slug so there's no chance of pointing at the wrong church.
--
-- After this runs, the v16 RPC + the editor's `{parent.slug}/{sub}` composite
-- lookup will both resolve. The MinistriesSection "Edit" link also uses the
-- short portion (`.split('/').pop()`), so URLs stay clean.

UPDATE strategy_brand_guides AS child
SET slug = parent.slug || '/' || child.slug
FROM strategy_brand_guides AS parent
WHERE child.parent_id = parent.id
  AND child.parent_id IS NOT NULL
  AND child.slug NOT LIKE '%/%';
