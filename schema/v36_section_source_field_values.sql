-- v36 — Source-of-truth content store for imported sections.
--
-- When a copywriter page bundle is imported, each section's raw
-- field_values (the copywriter's shape, with its own slot names and
-- nested groups) gets normalized into the bound Brixies template's
-- shape. Until now we only kept the normalized version on
-- `web_sections.field_values` — the original was discarded. That
-- meant every variant swap remapped from the *already-transformed*
-- state, compounding content loss with each swap.
--
-- This column preserves the original imported shape per section so
-- variant swaps can always re-derive a fresh template-shaped payload
-- from the authoritative source. User edits stay on `field_values`;
-- `source_field_values` is set once at import and stays put.
--
-- NULL is meaningful: legacy sections imported before this column
-- existed, plus all freehand-created sections, have no source row.
-- The variant-swap logic falls back to the legacy "remap from
-- field_values" path when this is NULL so nothing breaks for them.

ALTER TABLE web_sections
  ADD COLUMN source_field_values JSONB NULL;

COMMENT ON COLUMN web_sections.source_field_values IS
  'Original imported shape from the copywriter page bundle. NULL for freehand sections and legacy imports. Read on variant swap to re-derive field_values against a new template without compounding content loss.';
