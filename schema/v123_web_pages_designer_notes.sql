-- v123 — Free-form per-page notes for the design team. Sibling to
-- web_pages.dev_notes. NOT rendered on partner-visible surfaces; only
-- the page editor and the Design workspace rollup read this column.
ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS designer_notes text;

COMMENT ON COLUMN web_pages.designer_notes IS
  'Free-form per-page notes for the design team. Sibling to dev_notes. Surfaced in the Design workspace rollup. NEVER rendered on partner-visible surfaces.';
