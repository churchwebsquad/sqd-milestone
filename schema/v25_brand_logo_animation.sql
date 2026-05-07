-- v25_brand_logo_animation.sql
--
-- Each logo variant (primary, secondary, badge, icon) can now carry an
-- optional animated version — partners often ship motion versions of
-- the primary AND the badge, occasionally more. The still preview/
-- download urls stay unchanged; `animation_url` is purely additive.
--
-- Stored in the existing `brand-assets` Supabase Storage bucket via
-- the same uploadAttachment path the still logos use; no new bucket
-- or RLS needed. Surfaced as a video tile on the public portal +
-- brand handoff, alongside the still logo it belongs to.

ALTER TABLE strategy_brand_logos
  ADD COLUMN IF NOT EXISTS animation_url text;

COMMENT ON COLUMN strategy_brand_logos.animation_url IS
  'Optional animation file (mp4/webm/Lottie JSON) for this specific logo variant. NULL when the variant has no motion version.';
