-- v54: Add the three columns that turn web_sections into a Text/Layout/Preview-ready row.
--
--   source_markdown   — the writer's canonical prose for this section. Source of
--                       truth that the Text view edits and the matcher re-parses
--                       from.
--   ir_snapshot       — the ContentDocument (semantic IR) captured at last
--                       parse, with stable node_ids on every block/item. Used
--                       by the matcher on re-parse so node_ids survive
--                       reorders + small content edits.
--   field_provenance  — per-field tag map: { [field_key]: { source: 'auto' |
--                       'override' | 'default' | 'unbound', ir_path?: string,
--                       override_at?: timestamptz, override_by?: text } }.
--                       Override flags protect staff edits from being clobbered
--                       when markdown re-flows.
--
-- All additive. NULL-default. No existing reads care about these columns.
-- Dependency audit run 2026-05-29:
--   • Only trigger: web_sections_set_updated_at (BEFORE UPDATE) — unaffected
--   • Zero functions, views, MVs reference the table
--   • Three FKs point at web_sections.id (web_review_edits, web_review_comments,
--     web_bind_telemetry) — none reference any column we're adding
--   • RLS policies are row-level, no column refs
ALTER TABLE web_sections
  ADD COLUMN IF NOT EXISTS source_markdown   text,
  ADD COLUMN IF NOT EXISTS ir_snapshot       jsonb,
  ADD COLUMN IF NOT EXISTS field_provenance  jsonb;

COMMENT ON COLUMN web_sections.source_markdown IS
  'Writer''s canonical prose for the section. Source of truth for the Text view; parsed into ir_snapshot on save.';
COMMENT ON COLUMN web_sections.ir_snapshot IS
  'ContentDocument captured at last parse, with stable node_ids on every block/item. Used by the matcher to preserve identity across edits.';
COMMENT ON COLUMN web_sections.field_provenance IS
  'Per-field provenance map: { [field_key]: { source: auto|override|default|unbound, ir_path?, override_at?, override_by? } }. Protects staff edits during markdown re-flow.';
