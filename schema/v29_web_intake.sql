-- v29_web_intake.sql
--
-- Schema for the Website Manager's Intake tool (v1). Intake is a
-- verification checklist — most categories source from existing
-- Supabase tables (strategy_account_progress, strategy_brand_guides,
-- strategy_discovery_questionnaire) which already join on `member`.
-- This migration adds storage for the two-and-a-half categories that
-- need direct upload (strategy brief, content collection, discovery
-- questionnaire supplemental) and two optional URL fields per project.
--
-- Hard stops (gate Content Manager entry):
--   - Discovery questionnaire  → either strategy_discovery_questionnaire row
--                                 exists, OR a supplemental file uploaded
--   - Strategy brief           → ≥1 strategy_brief file uploaded
--   - Brand handoff            → strategy_brand_guides row with is_published=true
--
-- Optional:
--   - AM handoff               → strategy_account_progress.handoff_web_form jsonb non-null
--   - Content collection       → ≥1 file uploaded (multi)
--
-- No materialized "intake complete" flag — always computed at display
-- time from the source data. Single source of truth.

CREATE TABLE IF NOT EXISTS web_intake_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id          uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  category                text NOT NULL,
  filename                text NOT NULL,
  storage_path            text NOT NULL,
  storage_url             text NOT NULL,
  file_size_bytes         integer,
  mime_type               text,
  notes                   text,
  uploaded_at             timestamptz NOT NULL DEFAULT now(),
  uploaded_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  archived                boolean NOT NULL DEFAULT false
);

ALTER TABLE web_intake_documents DROP CONSTRAINT IF EXISTS web_intake_documents_category_check;
ALTER TABLE web_intake_documents ADD CONSTRAINT web_intake_documents_category_check
  CHECK (category IN (
    'strategy_brief',
    'content_collection',
    'discovery_questionnaire_supplemental'
  ));

CREATE INDEX IF NOT EXISTS idx_web_intake_documents_project_category
  ON web_intake_documents (web_project_id, category, archived, uploaded_at DESC);

-- Optional URLs that pair with the file uploads / brand handoff display
ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS strategy_brief_notion_url text,
  ADD COLUMN IF NOT EXISTS external_brand_guide_url  text;

-- RLS — staff-only, mirrors the other strategy_* tables
ALTER TABLE web_intake_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read web_intake_documents" ON web_intake_documents;
CREATE POLICY "Authenticated users can read web_intake_documents"
  ON web_intake_documents FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can write web_intake_documents" ON web_intake_documents;
CREATE POLICY "Authenticated users can write web_intake_documents"
  ON web_intake_documents FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
