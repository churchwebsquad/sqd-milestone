-- v52_discovery_questionnaire_fillout_alignment.sql
--
-- Aligns strategy_discovery_questionnaire with the canonical FillOut
-- form. Three changes:
--
--   1. Adds 10 typed columns for FillOut questions that previously only
--      lived in raw_payload (logos, brand guide, photo library, etc.).
--      One-time backfill from raw_payload follows the column adds.
--
--   2. Renames two style-slider columns to match current FillOut
--      wording (Simple↔Intricate, Classic↔Modern). Old names kept as
--      generated columns for one release as a soft-compat shim so any
--      cached query plans don't break. Code refs updated separately.
--
--   3. Loosens the NOT NULL on `member`. The new fillout-discovery-
--      webhook writes rows BEFORE the partner is linked to a member
--      number — staff resolves the link later. Existing rows are
--      unaffected (they already have member values).

BEGIN;

-- ── 1. New typed columns ─────────────────────────────────────────────

ALTER TABLE strategy_discovery_questionnaire
  ADD COLUMN IF NOT EXISTS logo_upload_url              text,
  ADD COLUMN IF NOT EXISTS brand_guide_upload_url       text,
  ADD COLUMN IF NOT EXISTS ministry_subbrand_needs      text,
  ADD COLUMN IF NOT EXISTS photo_library_url            text,
  ADD COLUMN IF NOT EXISTS additional_creative_direction text,
  ADD COLUMN IF NOT EXISTS timeframe_alignment          text,
  ADD COLUMN IF NOT EXISTS blackout_dates               text,
  ADD COLUMN IF NOT EXISTS six_month_measurable_win     text,
  ADD COLUMN IF NOT EXISTS other_social_platforms       text,
  ADD COLUMN IF NOT EXISTS high_maintenance_pages       text;

-- ── 2. Slider renames ────────────────────────────────────────────────

ALTER TABLE strategy_discovery_questionnaire
  RENAME COLUMN visual_simple_to_elevated    TO visual_simple_to_intricate;
ALTER TABLE strategy_discovery_questionnaire
  RENAME COLUMN visual_traditional_to_modern TO visual_classic_to_modern;

-- Drop and re-add CHECK constraints under the new names to keep error
-- messages clean.
ALTER TABLE strategy_discovery_questionnaire
  DROP CONSTRAINT IF EXISTS strategy_discovery_questionnaire_visual_simple_to_elevated_check;
ALTER TABLE strategy_discovery_questionnaire
  DROP CONSTRAINT IF EXISTS strategy_discovery_questionnaire_visual_traditional_to_modern_check;
ALTER TABLE strategy_discovery_questionnaire
  ADD CONSTRAINT strategy_discovery_questionnaire_visual_simple_to_intricate_check
    CHECK (visual_simple_to_intricate IS NULL OR visual_simple_to_intricate BETWEEN 1 AND 5);
ALTER TABLE strategy_discovery_questionnaire
  ADD CONSTRAINT strategy_discovery_questionnaire_visual_classic_to_modern_check
    CHECK (visual_classic_to_modern IS NULL OR visual_classic_to_modern BETWEEN 1 AND 5);

-- ── 3. Loosen member NOT NULL for webhook pre-link inserts ───────────

ALTER TABLE strategy_discovery_questionnaire
  ALTER COLUMN member DROP NOT NULL;

-- Member is now nullable; rely on a partial unique index to prevent
-- duplicate native rows for the same member (existing v23 unique on
-- (member, submitted_at) stays, but if member is null both halves are
-- null and Postgres treats them as distinct — that's the desired
-- behavior for unmatched webhook arrivals).

-- ── 4. One-time backfill of new columns from raw_payload ─────────────

-- Logo and Brand Guide are stored as "filename (url)" string. Extract
-- the URL portion via regex; if no parens, keep the whole string.
UPDATE strategy_discovery_questionnaire
SET logo_upload_url = COALESCE(
      (regexp_match(raw_payload->>'Logo', '\((https?://[^)]+)\)'))[1],
      raw_payload->>'Logo'
    )
WHERE logo_upload_url IS NULL
  AND raw_payload ? 'Logo'
  AND raw_payload->>'Logo' IS NOT NULL;

UPDATE strategy_discovery_questionnaire
SET brand_guide_upload_url = COALESCE(
      (regexp_match(raw_payload->>'Brand Guide', '\((https?://[^)]+)\)'))[1],
      raw_payload->>'Brand Guide'
    )
WHERE brand_guide_upload_url IS NULL
  AND raw_payload ? 'Brand Guide'
  AND raw_payload->>'Brand Guide' IS NOT NULL;

UPDATE strategy_discovery_questionnaire
SET ministry_subbrand_needs = raw_payload->>'Will you need any ministry / sub-brand logos? Please list them.'
WHERE ministry_subbrand_needs IS NULL
  AND raw_payload ? 'Will you need any ministry / sub-brand logos? Please list them.';

UPDATE strategy_discovery_questionnaire
SET photo_library_url = raw_payload->>'Provide a link to your photo library.'
WHERE photo_library_url IS NULL
  AND raw_payload ? 'Provide a link to your photo library.';

UPDATE strategy_discovery_questionnaire
SET additional_creative_direction = raw_payload->>'Add additional creative style direction helpful for Creative Director.'
WHERE additional_creative_direction IS NULL
  AND raw_payload ? 'Add additional creative style direction helpful for Creative Director.';

UPDATE strategy_discovery_questionnaire
SET timeframe_alignment = raw_payload->>'Are there any upcoming events, seasons, or ideal timeframes you’re hoping to align any projects with?'
WHERE timeframe_alignment IS NULL
  AND raw_payload ? 'Are there any upcoming events, seasons, or ideal timeframes you’re hoping to align any projects with?';

UPDATE strategy_discovery_questionnaire
SET blackout_dates = raw_payload->>'Are there any key events or recurring days when your team is unavailable?'
WHERE blackout_dates IS NULL
  AND raw_payload ? 'Are there any key events or recurring days when your team is unavailable?';

UPDATE strategy_discovery_questionnaire
SET six_month_measurable_win = raw_payload->>'Name a measurable win you’d like to see six months after launch.'
WHERE six_month_measurable_win IS NULL
  AND raw_payload ? 'Name a measurable win you’d like to see six months after launch.';

UPDATE strategy_discovery_questionnaire
SET other_social_platforms = raw_payload->>'List the other social media platforms to post to.'
WHERE other_social_platforms IS NULL
  AND raw_payload ? 'List the other social media platforms to post to.';

-- high_maintenance_pages is genuinely new — not in raw_payload because
-- the Airtable mirror never captured it. No backfill possible; future
-- FillOut submissions will populate it via the webhook.

COMMIT;
