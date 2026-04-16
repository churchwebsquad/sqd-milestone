-- ============================================================================
-- v4_portal_token.sql
-- Adds a portal_token UUID column to strategy_account_progress.
-- The client portal URL becomes /portal/<uuid> instead of /portal/<member_id>.
-- This prevents partners from guessing adjacent member IDs.
-- ============================================================================

-- Step 1: Add column (nullable first so existing rows don't fail)
ALTER TABLE strategy_account_progress
  ADD COLUMN IF NOT EXISTS portal_token uuid DEFAULT gen_random_uuid();

-- Step 2: Backfill any rows that somehow have NULL
-- (shouldn't happen because of the DEFAULT, but defensive)
UPDATE strategy_account_progress
SET portal_token = gen_random_uuid()
WHERE portal_token IS NULL;

-- Step 3: Enforce NOT NULL now that all rows are populated
ALTER TABLE strategy_account_progress
  ALTER COLUMN portal_token SET NOT NULL;

-- Step 4: Unique constraint — each partner gets a distinct token
ALTER TABLE strategy_account_progress
  ADD CONSTRAINT strategy_account_progress_portal_token_key UNIQUE (portal_token);
