-- v16_brand_guide_family.sql
--
-- Extends the public-read brand guide RPC so subbrand portal pages can link
-- back to the parent church guide and cross-link to sibling ministries
-- without needing another round trip.
--
-- Adds two new fields to the response:
--   - parent:   { slug, display_name } | null  (set only when the loaded guide
--               is a subbrand, i.e. parent_id is not null)
--   - siblings: array of { slug, display_name } — peer subbrands of the same
--               parent, excluding the current guide. Empty array for main
--               guides (which have no siblings).
--
-- The existing `subbrands` field is unchanged: it continues to list children
-- of the loaded guide, so main-guide portals still show their ministry grid.

CREATE OR REPLACE FUNCTION get_brand_guide_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guide strategy_brand_guides%ROWTYPE;
  v_parent strategy_brand_guides%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_guide
  FROM strategy_brand_guides
  WHERE slug = p_slug AND is_published = true
  LIMIT 1;

  IF v_guide.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Pull parent row (unpublished parents still resolve — the subbrand may be
  -- the only thing published at this church). `v_parent.id` is NULL when the
  -- loaded guide is a main guide.
  IF v_guide.parent_id IS NOT NULL THEN
    SELECT * INTO v_parent
    FROM strategy_brand_guides
    WHERE id = v_guide.parent_id
    LIMIT 1;
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
    ),
    'parent', CASE
      WHEN v_parent.id IS NULL THEN NULL
      ELSE jsonb_build_object('slug', v_parent.slug, 'display_name', v_parent.display_name)
    END,
    'siblings', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('slug', s.slug, 'display_name', s.display_name) ORDER BY s.display_name)
       FROM strategy_brand_guides s
       WHERE s.parent_id = v_guide.parent_id
         AND s.parent_id IS NOT NULL
         AND s.id <> v_guide.id
         AND s.is_published = true), '[]'::jsonb
    )
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_brand_guide_by_slug(text) TO anon, authenticated;
