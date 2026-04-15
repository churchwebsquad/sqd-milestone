-- ============================================================================
-- v2_add_milestone_status.sql
-- Adds milestone_status workflow column to strategy_milestone_submissions.
--
-- DO NOT run this automatically — paste into the Supabase SQL editor.
-- This script is idempotent (safe to run more than once).
-- ============================================================================

ALTER TABLE strategy_milestone_submissions
  ADD COLUMN IF NOT EXISTS milestone_status text NOT NULL DEFAULT 'sent'
    CONSTRAINT strategy_milestone_submissions_milestone_status_check
    CHECK (milestone_status IN (
      'sent',
      'waiting_on_partner',
      'partner_replied',
      'in_revision',
      'approved',
      'escalated'
    ));

CREATE INDEX IF NOT EXISTS idx_strategy_milestone_submissions_milestone_status
  ON strategy_milestone_submissions (milestone_status);
