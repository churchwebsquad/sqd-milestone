-- ============================================================================
-- v13_brand_guide_updates.sql
-- Follow-ups to v12:
--   1. Drop tone_summary + brand_narrative from strategy_brand_guides (not used)
--   2. Add assets_zip_url to strategy_brand_guides (optional bulk download)
--   3. Add override_logo_url to strategy_brand_color_combinations (so an
--      on-color row can show a white logo on dark bg, etc.)
--   4. Add strategy_brand_voice_guidelines (same shape as voice_attributes).
--      Portal renders voice_attributes as "Tone Characteristics" and
--      voice_guidelines as "Voice Guidelines" — two labeled 2x2 grids.
--   5. Extend brand-assets bucket MIME allowlist with application/zip
--   6. Replace get_brand_guide_by_slug RPC so the payload includes the new
--      fields + voice_guidelines array
-- ============================================================================

-- 1. Drop unused voice fields
ALTER TABLE strategy_brand_guides DROP COLUMN IF EXISTS tone_summary;
ALTER TABLE strategy_brand_guides DROP COLUMN IF EXISTS brand_narrative;

-- 2. Add zip asset URL
ALTER TABLE strategy_brand_guides
  ADD COLUMN IF NOT EXISTS assets_zip_url text;
COMMENT ON COLUMN strategy_brand_guides.assets_zip_url IS 'Optional URL to a zip of logos/assets in Supabase Storage — surfaces as a Download all assets button on the public portal.';

-- 3. Per-combination override logo
ALTER TABLE strategy_brand_color_combinations
  ADD COLUMN IF NOT EXISTS override_logo_url text;
COMMENT ON COLUMN strategy_brand_color_combinations.override_logo_url IS 'Optional Supabase Storage URL for the logo variant to render on top of this combination''s background. Falls back to the primary logo when null.';

-- 4. New voice_guidelines table (parallel to voice_attributes)
CREATE TABLE IF NOT EXISTS strategy_brand_voice_guidelines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id  uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_brand_voice_guidelines IS 'Voice Guidelines entries (title + description). Shown as a 2x2 grid on the public portal labeled "Voice Guidelines". Distinct from strategy_brand_voice_attributes which renders as "Tone Characteristics".';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_voice_guidelines_guide
  ON strategy_brand_voice_guidelines (brand_guide_id);

ALTER TABLE strategy_brand_voice_guidelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read voice guidelines"
  ON strategy_brand_voice_guidelines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert voice guidelines"
  ON strategy_brand_voice_guidelines FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update voice guidelines"
  ON strategy_brand_voice_guidelines FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete voice guidelines"
  ON strategy_brand_voice_guidelines FOR DELETE USING (auth.uid() IS NOT NULL);

-- 5. Extend bucket MIME allowlist with zip
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4',
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/octet-stream',
  'application/zip', 'application/x-zip-compressed'
]
WHERE id = 'brand-assets';

-- 6. Replace the public-read RPC so it returns the new fields + voice_guidelines.
CREATE OR REPLACE FUNCTION get_brand_guide_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guide strategy_brand_guides%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_guide
  FROM strategy_brand_guides
  WHERE slug = p_slug AND is_published = true
  LIMIT 1;

  IF v_guide.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_result := jsonb_build_object(
    'guide', jsonb_build_object(
      'id',              v_guide.id,
      'member',          v_guide.member,
      'parent_id',       v_guide.parent_id,
      'slug',            v_guide.slug,
      'display_name',    v_guide.display_name,
      'contact_name',    v_guide.contact_name,
      'contact_email',   v_guide.contact_email,
      'voice_overview',  v_guide.voice_overview,
      'brand_statement', v_guide.brand_statement,
      'assets_zip_url',  v_guide.assets_zip_url,
      'last_updated_at', v_guide.last_updated_at,
      'updated_at',      v_guide.updated_at
    ),
    'logos', COALESCE(
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.sort_order, l.created_at)
       FROM strategy_brand_logos l WHERE l.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'colors', COALESCE(
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.sort_order, c.created_at)
       FROM strategy_brand_colors c WHERE c.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'color_combinations', COALESCE(
      (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.sort_order, k.created_at)
       FROM strategy_brand_color_combinations k WHERE k.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'typography', COALESCE(
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order, t.created_at)
       FROM strategy_brand_typography t WHERE t.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'elements', COALESCE(
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.sort_order, e.created_at)
       FROM strategy_brand_elements e WHERE e.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'voice_attributes', COALESCE(
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.sort_order, v.created_at)
       FROM strategy_brand_voice_attributes v WHERE v.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'voice_guidelines', COALESCE(
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.sort_order, v.created_at)
       FROM strategy_brand_voice_guidelines v WHERE v.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'attributes', COALESCE(
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.sort_order, a.created_at)
       FROM strategy_brand_attributes a WHERE a.brand_guide_id = v_guide.id), '[]'::jsonb
    ),
    'subbrands', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('slug', s.slug, 'display_name', s.display_name) ORDER BY s.display_name)
       FROM strategy_brand_guides s WHERE s.parent_id = v_guide.id AND s.is_published = true), '[]'::jsonb
    )
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_brand_guide_by_slug(text) TO anon, authenticated;
