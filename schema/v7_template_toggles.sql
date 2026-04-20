-- ============================================================================
-- v7_template_toggles.sql
-- Per-template defaults for the footer + recap toggles.
-- Lets admins decide whether a given template should include the Standard
-- Footer and/or the All-In Updates Recap by default. Staff can still override
-- per-message via the toggles in Step 5 of the submission form.
-- ============================================================================

ALTER TABLE strategy_message_templates
  ADD COLUMN IF NOT EXISTS include_footer boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_recap  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN strategy_message_templates.include_footer IS
  'Default value for the Standard Footer toggle when this template is applied in Step 5. Staff can override per-message.';
COMMENT ON COLUMN strategy_message_templates.include_recap IS
  'Default value for the All-In Updates Recap toggle when this template is applied in Step 5. Staff can override per-message.';
