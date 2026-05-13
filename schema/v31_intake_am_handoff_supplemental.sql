-- v31_intake_am_handoff_supplemental.sql
--
-- Adds the 'am_handoff_supplemental' category to web_intake_documents
-- so strategists can upload AM handoff notes directly from the Intake
-- page (in addition to the auto-source from strategy_account_progress
-- .handoff_web_form). Same dual-source pattern as the discovery
-- questionnaire supplemental.
--
-- Also note: the brand-assets storage bucket's allowed_mime_types was
-- expanded out-of-band to support PDF / Word / text / markdown / CSV
-- in addition to the previous image/font/video/zip allowlist. Bucket
-- policy now permits 22 MIME types.

ALTER TABLE web_intake_documents DROP CONSTRAINT IF EXISTS web_intake_documents_category_check;
ALTER TABLE web_intake_documents ADD CONSTRAINT web_intake_documents_category_check
  CHECK (category IN (
    'strategy_brief',
    'content_collection',
    'discovery_questionnaire_supplemental',
    'am_handoff_supplemental'
  ));
