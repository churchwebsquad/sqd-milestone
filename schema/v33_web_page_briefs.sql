-- v33 — Page briefs ingested from cowork
--
-- Cowork produces a structured JSON brief per page (Stage 4 equivalent
-- in our pipeline) that the app imports. We persist the raw brief on
-- the page so:
--   1. Re-imports reconcile against the prior brief (idempotent updates)
--   2. AI fact-check passes can reference it
--   3. Strategists can re-render sections from the brief if their edits
--      go sideways
--
-- The brief schema is documented in references/page-brief-schema.md.
-- Stored as jsonb; no shape enforcement at the DB layer.

ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS brief jsonb,
  ADD COLUMN IF NOT EXISTS brief_imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS brief_imported_by_employee_id uuid REFERENCES employees(id);

COMMENT ON COLUMN web_pages.brief IS
  'The structured page brief produced by cowork. See references/page-brief-schema.md.';
