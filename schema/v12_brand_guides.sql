-- ============================================================================
-- v12_brand_guides.sql
-- Brand storage + online brand guide system. Eight strategy_brand_* tables,
-- one public-read RPC (SECURITY DEFINER, slug-gated), one Supabase Storage
-- bucket for logo/pattern/texture uploads.
--
-- Data shape:
--   strategy_brand_guides          root row per brand (parent_id NULL)
--                                   OR subbrand (parent_id → another brand)
--   strategy_brand_logos           primary/secondary/badge/icon variants
--   strategy_brand_colors          named colors with tier + hex/CMYK/RGB
--   strategy_brand_color_combinations  up to 4 bg/fg pairings referencing colors
--   strategy_brand_typography      font rows by tier (primary/secondary/accent)
--   strategy_brand_elements        patterns, textures, application examples
--   strategy_brand_voice_attributes  the 2x2 "Sound Like Family" voice cards
--   strategy_brand_attributes      short brand-attribute list
-- ============================================================================

-- Cleanup from an earlier run that hit a typo (strateagy_brand_guides). Safe
-- no-op when the misspelled table doesn't exist. Remove this line in v13+.
DROP TABLE IF EXISTS strateagy_brand_guides CASCADE;

-- ── Root record ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_brand_guides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member             integer NOT NULL,
  parent_id          uuid REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  slug               text NOT NULL UNIQUE,
  display_name       text NOT NULL,
  contact_name       text,
  contact_email      text,
  voice_overview     text,
  tone_summary       text,
  brand_narrative    text,
  brand_statement    text,
  is_published       boolean NOT NULL DEFAULT false,
  last_updated_at    timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_brand_guides IS 'One row per brand (parent_id NULL) or subbrand (parent_id points to the parent brand). slug is the public URL segment at /brand/:slug.';
COMMENT ON COLUMN strategy_brand_guides.member IS 'Business key matching strategy_account_progress.member.';
COMMENT ON COLUMN strategy_brand_guides.is_published IS 'When false, the public portal RPC returns NULL for this slug.';

CREATE OR REPLACE FUNCTION update_strategy_brand_guides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_brand_guides_updated_at
  BEFORE UPDATE ON strategy_brand_guides
  FOR EACH ROW EXECUTE FUNCTION update_strategy_brand_guides_updated_at();

CREATE INDEX IF NOT EXISTS idx_strategy_brand_guides_member      ON strategy_brand_guides (member);
CREATE INDEX IF NOT EXISTS idx_strategy_brand_guides_parent_id   ON strategy_brand_guides (parent_id);
CREATE INDEX IF NOT EXISTS idx_strategy_brand_guides_slug        ON strategy_brand_guides (slug);

-- ── Child tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_brand_logos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id     uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('primary', 'secondary', 'badge', 'icon')),
  label              text,
  preview_url        text NOT NULL,
  download_url       text,
  clear_space_note   text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN strategy_brand_logos.preview_url IS 'Supabase Storage public URL (PNG/SVG) used for on-screen rendering.';
COMMENT ON COLUMN strategy_brand_logos.download_url IS 'Optional Dropbox/Drive link for the full-res pack.';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_logos_guide ON strategy_brand_logos (brand_guide_id);

CREATE TABLE IF NOT EXISTS strategy_brand_colors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id     uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  name               text,
  tier               text NOT NULL CHECK (tier IN ('primary', 'secondary', 'accent', 'background', 'text')),
  hex                text NOT NULL,
  cmyk               text,
  rgb                text,
  pms                text,
  proportion_pct     integer,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN strategy_brand_colors.proportion_pct IS 'Optional — portion of total brand palette usage (0-100). Sums are advisory, not enforced.';
COMMENT ON COLUMN strategy_brand_colors.hex IS 'Including the leading # (e.g. #1ce783).';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_colors_guide ON strategy_brand_colors (brand_guide_id);

CREATE TABLE IF NOT EXISTS strategy_brand_color_combinations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id     uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  bg_color_id        uuid REFERENCES strategy_brand_colors(id) ON DELETE SET NULL,
  fg_color_id        uuid REFERENCES strategy_brand_colors(id) ON DELETE SET NULL,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_brand_color_combinations IS 'Approved background/foreground color pairings (up to ~4). Referenced colors live in strategy_brand_colors.';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_color_combinations_guide
  ON strategy_brand_color_combinations (brand_guide_id);

CREATE TABLE IF NOT EXISTS strategy_brand_typography (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id     uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  tier               text NOT NULL CHECK (tier IN ('primary', 'secondary', 'accent')),
  family_name        text NOT NULL,
  weight             text,
  suggested_use      text,
  web_font_family    text,
  font_url           text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN strategy_brand_typography.weight IS 'Freeform. Examples: "400,700" or "Regular, Bold".';
COMMENT ON COLUMN strategy_brand_typography.web_font_family IS 'Override used on web when it differs from the print family.';
COMMENT ON COLUMN strategy_brand_typography.font_url IS 'Google Fonts / Adobe Fonts / uploaded font file URL.';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_typography_guide ON strategy_brand_typography (brand_guide_id);

CREATE TABLE IF NOT EXISTS strategy_brand_elements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id     uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('pattern', 'texture', 'application')),
  label              text,
  preview_url        text,
  download_url       text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_brand_elements IS 'Patterns, textures, and application examples. preview_url is Supabase Storage; download_url is Dropbox for source files.';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_elements_guide ON strategy_brand_elements (brand_guide_id);

CREATE TABLE IF NOT EXISTS strategy_brand_voice_attributes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id     uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  title              text NOT NULL,
  description        text NOT NULL,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_brand_voice_attributes IS 'The 2x2 voice cards (title + description) from the Real Life reference.';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_voice_attributes_guide
  ON strategy_brand_voice_attributes (brand_guide_id);

CREATE TABLE IF NOT EXISTS strategy_brand_attributes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_guide_id     uuid NOT NULL REFERENCES strategy_brand_guides(id) ON DELETE CASCADE,
  label              text NOT NULL,
  description        text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_brand_attributes IS 'Short brand-attribute list (e.g. "Trustworthy", "Playful"). Separate from voice_attributes which are full 2x2 voice cards.';

CREATE INDEX IF NOT EXISTS idx_strategy_brand_attributes_guide ON strategy_brand_attributes (brand_guide_id);

-- ── RLS — staff-side direct reads/writes ────────────────────────────────────
-- Public read is via get_brand_guide_by_slug RPC (SECURITY DEFINER).

ALTER TABLE strategy_brand_guides              ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_brand_logos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_brand_colors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_brand_color_combinations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_brand_typography          ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_brand_elements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_brand_voice_attributes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_brand_attributes          ENABLE ROW LEVEL SECURITY;

-- Helper macro — same four policies per table. Do each explicitly.

CREATE POLICY "Staff read brand guides"        ON strategy_brand_guides             FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert brand guides"      ON strategy_brand_guides             FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update brand guides"      ON strategy_brand_guides             FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete brand guides"      ON strategy_brand_guides             FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff read brand logos"         ON strategy_brand_logos              FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert brand logos"       ON strategy_brand_logos              FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update brand logos"       ON strategy_brand_logos              FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete brand logos"       ON strategy_brand_logos              FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff read brand colors"        ON strategy_brand_colors             FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert brand colors"      ON strategy_brand_colors             FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update brand colors"      ON strategy_brand_colors             FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete brand colors"      ON strategy_brand_colors             FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff read brand combos"        ON strategy_brand_color_combinations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert brand combos"      ON strategy_brand_color_combinations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update brand combos"      ON strategy_brand_color_combinations FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete brand combos"      ON strategy_brand_color_combinations FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff read brand typography"    ON strategy_brand_typography         FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert brand typography"  ON strategy_brand_typography         FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update brand typography"  ON strategy_brand_typography         FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete brand typography"  ON strategy_brand_typography         FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff read brand elements"      ON strategy_brand_elements           FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert brand elements"    ON strategy_brand_elements           FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update brand elements"    ON strategy_brand_elements           FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete brand elements"    ON strategy_brand_elements           FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff read voice attributes"    ON strategy_brand_voice_attributes   FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert voice attributes"  ON strategy_brand_voice_attributes   FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update voice attributes"  ON strategy_brand_voice_attributes   FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete voice attributes"  ON strategy_brand_voice_attributes   FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff read brand attributes"    ON strategy_brand_attributes         FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff insert brand attributes"  ON strategy_brand_attributes         FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff update brand attributes"  ON strategy_brand_attributes         FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff delete brand attributes"  ON strategy_brand_attributes         FOR DELETE USING (auth.uid() IS NOT NULL);

-- ── Public-read RPC (slug-gated) ────────────────────────────────────────────
-- Returns everything needed to render the public brand guide portal in one
-- round trip. Returns NULL when the slug is unknown or the guide is unpublished.

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
      'tone_summary',    v_guide.tone_summary,
      'brand_narrative', v_guide.brand_narrative,
      'brand_statement', v_guide.brand_statement,
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

-- ── Storage bucket for brand assets ─────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  true,
  20971520,   -- 20 MB
  ARRAY['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4',
        'font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies — authenticated staff upload / replace / delete, public read.

DROP POLICY IF EXISTS "Authenticated staff can upload brand assets" ON storage.objects;
CREATE POLICY "Authenticated staff can upload brand assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Anyone can read brand assets" ON storage.objects;
CREATE POLICY "Anyone can read brand assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Staff can replace their brand assets" ON storage.objects;
CREATE POLICY "Staff can replace their brand assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-assets' AND owner = auth.uid());

DROP POLICY IF EXISTS "Staff can delete their brand assets" ON storage.objects;
CREATE POLICY "Staff can delete their brand assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand-assets' AND owner = auth.uid());
