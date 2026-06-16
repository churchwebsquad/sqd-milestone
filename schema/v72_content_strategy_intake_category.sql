-- v72 — widen web_intake_documents.category CHECK to include 'content_strategy'.
--
-- WHY
-- Optional upload alongside the strategy_brief intake row. When a
-- partner provides a pre-written content strategy doc (with sitemap,
-- personas, x_factor, voice — already structured), the cowork
-- pipeline should lift those elements 1:1 instead of re-deriving
-- them from atoms. The lift logic lives in extract-strategy +
-- synthesize-strategy + plan-site-strategy; THIS migration just
-- legalizes the new category value.
--
-- DEPENDENCY AUDIT
-- - No triggers, functions, views, MVs, or FKs depend on this CHECK.
-- - 2 RLS policies exist (read + write) but neither references
--   `category` directly — they gate by row ownership, not value.
-- - No data migration required: existing rows keep their values; new
--   uploads can now use 'content_strategy'.
--
-- ROLLBACK
--   ALTER TABLE web_intake_documents DROP CONSTRAINT web_intake_documents_category_check;
--   ALTER TABLE web_intake_documents ADD CONSTRAINT web_intake_documents_category_check
--     CHECK (category = ANY (ARRAY['strategy_brief'::text, 'content_collection'::text,
--                                  'discovery_questionnaire_supplemental'::text,
--                                  'am_handoff_supplemental'::text]));

ALTER TABLE web_intake_documents
  DROP CONSTRAINT web_intake_documents_category_check;

ALTER TABLE web_intake_documents
  ADD CONSTRAINT web_intake_documents_category_check
  CHECK (category = ANY (ARRAY[
    'strategy_brief'::text,
    'content_strategy'::text,
    'content_collection'::text,
    'discovery_questionnaire_supplemental'::text,
    'am_handoff_supplemental'::text
  ]));
