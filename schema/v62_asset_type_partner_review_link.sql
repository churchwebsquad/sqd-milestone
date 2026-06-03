-- ============================================================================
-- v62_asset_type_partner_review_link.sql
-- Adds 'partner_review_link' to strategy_submission_assets.asset_type CHECK.
-- One umbrella value for any partner-facing review portal (content
-- collection, web review, copy review, brand handoff). The specific name
-- (e.g. "Website Content Collection") rides on asset_label so the merge
-- field ([label](url)) renders cleanly without per-surface enum values
-- as more review types come online in the hub.
-- ============================================================================

ALTER TABLE strategy_submission_assets
  DROP CONSTRAINT IF EXISTS strategy_submission_assets_asset_type_check;

ALTER TABLE strategy_submission_assets
  ADD CONSTRAINT strategy_submission_assets_asset_type_check
  CHECK (asset_type = ANY (ARRAY[
    'loom_video'::text,
    'brand_guide'::text,
    'markup_review'::text,
    'figma_file'::text,
    'dropbox_folder'::text,
    'style_guide'::text,
    'mood_board'::text,
    'contentsnare'::text,
    'website_link'::text,
    'document'::text,
    'vista_social'::text,
    'form'::text,
    'attachment'::text,
    'partner_review_link'::text,
    'other'::text
  ]));
