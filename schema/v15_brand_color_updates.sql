-- ============================================================================
-- v15_brand_color_updates.sql
-- Two additions for the brand color palette:
--   1. Widen the tier CHECK to include 'light' and 'dark' — picked up by the
--      editor dropdown and the portal's On Color sort order.
--   2. Add on_color_logo_url to strategy_brand_colors. Any color with this
--      set shows up on the public portal's On Color row with the chosen
--      logo variant — so staff can avoid dark-on-dark lockups.
-- ============================================================================

-- 1. Widen tier CHECK
ALTER TABLE strategy_brand_colors
  DROP CONSTRAINT IF EXISTS strategy_brand_colors_tier_check;

ALTER TABLE strategy_brand_colors
  ADD CONSTRAINT strategy_brand_colors_tier_check
  CHECK (tier IN ('primary', 'secondary', 'accent', 'background', 'text', 'light', 'dark'));

-- 2. Optional on-color logo per color
ALTER TABLE strategy_brand_colors
  ADD COLUMN IF NOT EXISTS on_color_logo_url text;

COMMENT ON COLUMN strategy_brand_colors.on_color_logo_url IS
  'Optional Supabase Storage URL for the logo variant to render on top of this color in the portal''s On Color showcase. When NULL the color is not featured there.';
