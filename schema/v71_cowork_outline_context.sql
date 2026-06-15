-- v71 — strategy schema + cowork outline-context RPC.
--
-- WHAT THIS DOES
-- 1. Creates a new `strategy` schema (separate from public) for
--    strategist-owned reference data.
-- 2. Creates strategy.cowork_templates — the canonical-templates
--    manifest the cowork outline-page skill must bind against.
--    Seeded from cowork-skills/canonical-templates.json in the repo
--    (the file is the source-of-truth; this table is its DB mirror so
--    Claude Desktop cowork sessions can query it via Supabase MCP).
-- 3. Creates public.cowork_load_outline_context(uuid, text) — a
--    single RPC that returns one JSONB with everything the
--    outline-page skill needs (allocation slice + atoms/facts/crawl
--    topics referenced + stage_1 + ministry_model + approved
--    strategic_goals + build_directives + prior handoff note +
--    canonical_templates manifest + sitemap walk list). Replaces
--    8-15 ad-hoc probes per page with one MCP call.
--
-- DEPENDENCY AUDIT (per CLAUDE.md rule)
-- Net-new additions only:
--   - new schema (`strategy`) — no impact on existing objects
--   - new table — no FK changes elsewhere
--   - new RPC — no existing object replaced
--   - GRANT additions — no revokes
-- Existing tables read (strategy_web_projects, content_atoms,
-- church_facts, web_project_topics) are READ-ONLY from this RPC;
-- no schema changes to them.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cowork_load_outline_context(uuid, text);
--   DROP TABLE IF EXISTS strategy.cowork_templates;
--   DROP SCHEMA IF EXISTS strategy;   -- (only if no other objects in it)

-- ── Schema ───────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS strategy;
GRANT USAGE ON SCHEMA strategy TO authenticated, anon, service_role;

-- ── Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy.cowork_templates (
  version    text         PRIMARY KEY,
  manifest   jsonb        NOT NULL,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  notes      text         NULL
);

COMMENT ON TABLE strategy.cowork_templates IS
  'Canonical-templates manifest (closed template_key + slot vocab) read by the cowork outline-page pipeline. Single global source-of-truth; not project-owned. Seeded from cowork-skills/canonical-templates.json in the repo.';

GRANT SELECT ON strategy.cowork_templates TO authenticated, anon, service_role;
GRANT INSERT, UPDATE ON strategy.cowork_templates TO service_role;

-- ── Seed v1.0.0 from cowork-skills/canonical-templates.json ──────
INSERT INTO strategy.cowork_templates(version, manifest, notes)
VALUES ('1.0.0', $json${"version": "1.0.0", "source": "Paradox Church (TEST) curated_library (project 15394f01-b371-415e-9bae-5d6e7d50c58a)", "doc": {"purpose": "Single source-of-truth that the cowork pipeline reads when picking templates + populating slots. Bind-time translation between this uniform vocabulary and Brixies field names lives in the app-side import endpoint, NOT in cowork.", "cowork_vocabulary": {"tagline": "text, optional, eyebrow above primary_heading", "primary_heading": "text, REQUIRED, page-section title (Brixies h1/h2 depending on template)", "body": "richtext, optional, descriptive prose under the heading", "accent_body": "richtext, optional, secondary descriptive prose. Only on templates that have a SECOND visible richtext block.", "buttons": "array of { label, url } CTAs. max_items varies per template.", "items": "array of { item_heading, item_body, item_meta? }. Used by accordion, cards, tabs, timeline, team, etc. max_items + palette ref vary per template; the importer figures out the visual layout."}, "designer_slots": "Every image slot in the underlying Brixies template is designer-populated (not by cowork). The total per template is recorded as design_handoff_image_count for the design handoff checklist.", "importer_responsibilities": ["Translate uniform_to_brixies field names for the picked template", "For multi-group templates (accordion_faq, content_image_text_b, contact_section): split items[] across the visual groups per layout-specific rule", "For palette-ref groups (feature_team, content_featured_a): look up the project curated_library.card_* binding to resolve the actual Card variant + write item fields against that variant", "Validate every required uniform slot is populated before INSERT into web_sections", "Leave all image fields empty (placeholders render until designer fills via design handoff)"], "empty_slot_prevention": {"philosophy": "Required slots empty at bind time = preventable upstream. Every layer validates against this manifest BEFORE handing off.", "layers": ["plan-cross-page-allocation: for each section_intent, check that allocated sources contain content sufficient to fill the picked template required slots. Gaps land in unresolved_sources with exact slot named.", "outline-page: declares atom_assignments covering all required uniform slots before returning. Self-validates against the manifest.", "draft-page: validates its own draft output before returning. Every required slot has non-empty content. One retry on gap. Else returns validation.unresolved_required_slots[].", "importer (app-side): last line of defense. Refuses INSERT if any required slot empty. Returns structured error pointing at page + section + slot + missing atom + suggested fix.", "Strategist UI: surfaces unresolved gaps with context. Strategist sees exactly which page/section/slot needs input, what was missing, what to do."]}}, "page_section_templates": {"hero_homepage": {"template_id": "hero-section-102", "concept": "hero_homepage", "family": "Hero Section", "variant": "102", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}}, "design_handoff_image_count": 0}, "hero_inner": {"template_id": "hero-section-1", "concept": "hero_inner", "family": "Hero Section", "variant": "1", "cowork_writable_slots": {"primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}}, "design_handoff_image_count": 1}, "hero_featured": {"template_id": "hero-section-43", "concept": "hero_featured", "family": "Hero Section", "variant": "43", "cowork_writable_slots": {"primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}}, "design_handoff_image_count": 1}, "cta_simple": {"template_id": "cta-section-20", "concept": "cta_simple", "family": "CTA Section", "variant": "20", "cowork_writable_slots": {"primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}}, "design_handoff_image_count": 1}, "cta_callout": {"template_id": "cta-section-52", "concept": "cta_callout", "family": "CTA Section", "variant": "52", "cowork_writable_slots": {"primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 1, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}}, "design_handoff_image_count": 0}, "accordion_faq": {"template_id": "faq-section-10", "concept": "accordion_faq", "family": "FAQ Section", "variant": "10", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 5, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 0}, "content_image_text_a": {"template_id": "content-section-45", "concept": "content_image_text_a", "family": "Content Section", "variant": "45", "cowork_writable_slots": {"primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 3, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 1}, "content_image_text_b": {"template_id": "content-section-16", "concept": "content_image_text_b", "family": "Content Section", "variant": "16", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 2, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 1}, "content_video": {"template_id": "content-section-25", "concept": "content_video", "family": "Content Section", "variant": "25", "cowork_writable_slots": {"primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "accent_body": {"max_chars": 300, "required": false}}, "design_handoff_image_count": 1}, "content_featured_a": {"template_id": "content-section-89", "concept": "content_featured_a", "family": "Content Section", "variant": "89", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 3, "uses_palette": "Card", "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 3}, "content_featured_b": {"template_id": "content-section-91", "concept": "content_featured_b", "family": "Content Section", "variant": "91", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}, "items": {"max_items": 1, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 1}, "contact_section": {"template_id": "content-section-96", "concept": "contact_section", "family": "Content Section", "variant": "96", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}, "items": {"max_items": 3, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 1}, "feature_team": {"template_id": "team-section-14", "concept": "feature_team", "family": "Team Section", "variant": "14", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 2, "uses_palette": "Card", "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 0}, "feature_tabbed": {"template_id": "feature-section-66", "concept": "feature_tabbed", "family": "Feature Section", "variant": "66", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 4, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}, "item_meta": {"max_chars": 60, "required": false}}}}, "design_handoff_image_count": 4}, "feature_unique": {"template_id": "feature-section-103", "concept": "feature_unique", "family": "Feature Section", "variant": "103", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 2, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 0}, "feature_card_carousel_proxy": {"template_id": "feature-section-6", "concept": "feature_card_carousel_proxy", "family": "Feature Section", "variant": "6", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}}, "design_handoff_image_count": 0}, "testimonial_written": {"template_id": "feature-section-19", "concept": "testimonial_written", "family": "Feature Section", "variant": "19", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 2, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 2}, "testimonial_video": {"template_id": "feature-section-77", "concept": "testimonial_video", "family": "Feature Section", "variant": "77", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 1, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 0}, "timeline_story": {"template_id": "timeline-section-6", "concept": "timeline_story", "family": "Timeline Section", "variant": "6", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "buttons": {"max_items": 2, "item_subfields": {"label": {"max_chars": 30}, "url": {"type": "url"}}}, "items": {"max_items": 5, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 1}, "career_section": {"template_id": "career-section-3", "concept": "career_section", "family": "Career Section", "variant": "3", "cowork_writable_slots": {"tagline": {"max_chars": 60, "required": false}, "primary_heading": {"max_chars": 100, "required": true}, "body": {"max_chars": 400, "required": false}, "items": {"max_items": 3, "uses_palette": null, "item_subfields": {"item_heading": {"max_chars": 100}, "item_body": {"max_chars": 400}}}}, "design_handoff_image_count": 0}}, "post_and_listing_templates_for_design_handoff": {"single_blog": "single-post-section-8", "single_event_or_sermon": "single-event-section-4", "single_staff": "single-team-section-6", "archive_filter": "category-filter-6"}}$json$::jsonb, 'Seeded from cowork-skills/canonical-templates.json — v71 schema bootstrap')
ON CONFLICT (version) DO UPDATE SET manifest = EXCLUDED.manifest, updated_at = now(), notes = EXCLUDED.notes;


-- ── RPC ──────────────────────────────────────────────────────────
-- One-shot context loader for outline-page cowork sessions.
-- Cuts per-page MCP approvals from 8-15 small probes down to 1
-- (this RPC) + 1 (the final roadmap_state_set write).

CREATE OR REPLACE FUNCTION public.cowork_load_outline_context(
  p_project_id uuid,
  p_page_slug  text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $func$
DECLARE
  v_state           jsonb;
  v_allocation      jsonb;
  v_atom_ids        uuid[];
  v_fact_ids        uuid[];
  v_topic_keys      text[];
  v_canonical       jsonb;
BEGIN
  -- Load the project's full roadmap_state once.
  SELECT roadmap_state INTO v_state
  FROM strategy_web_projects WHERE id = p_project_id;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;

  -- Find the allocation entry for this page. Tolerate both 'page_slug'
  -- (canonical, per CoworkPageAllocation type) AND 'slug' (the cowork
  -- model's drift). Validator follow-up will tighten emission to
  -- page_slug; this RPC accepts both so existing data isn't blocked.
  SELECT a INTO v_allocation
  FROM jsonb_array_elements(v_state->'page_allocation_plan'->'allocations') a
  WHERE (a->>'page_slug' = p_page_slug OR a->>'slug' = p_page_slug)
  LIMIT 1;

  -- Collect refs the section_intents point at, so we can join in the
  -- full source rows in a single shot.
  SELECT
    array_agg(DISTINCT (src->>'ref')::uuid) FILTER (
      WHERE src->>'kind' = 'pillar' AND src->>'ref' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
    ),
    array_agg(DISTINCT (src->>'ref')::uuid) FILTER (
      WHERE src->>'kind' = 'fact' AND src->>'ref' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
    ),
    array_agg(DISTINCT src->>'ref') FILTER (
      WHERE src->>'kind' = 'crawl_topic'
    )
  INTO v_atom_ids, v_fact_ids, v_topic_keys
  FROM jsonb_array_elements(COALESCE(v_allocation->'section_intents', '[]'::jsonb)) si,
       jsonb_array_elements(COALESCE(si->'sources', '[]'::jsonb)) src;

  -- Pull the latest canonical-templates manifest.
  SELECT manifest INTO v_canonical
  FROM strategy.cowork_templates
  ORDER BY updated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'page_slug',  p_page_slug,
    'allocation', v_allocation,

    'atoms_for_page', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',          id,
        'topic',       topic,
        'body',        body,
        'verbatim',    verbatim,
        'source_kind', source_kind,
        'source_ref',  source_ref,
        'confidence',  confidence,
        'status',      status
      ) ORDER BY topic, id)
      FROM content_atoms
      WHERE web_project_id = p_project_id
        AND id = ANY(COALESCE(v_atom_ids, ARRAY[]::uuid[]))
    ), '[]'::jsonb),

    'facts_for_page', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',          id,
        'topic',       topic,
        'data',        data,
        'source_kind', source_kind,
        'source_ref',  source_ref,
        'status',      status
      ) ORDER BY topic, id)
      FROM church_facts
      WHERE web_project_id = p_project_id
        AND id = ANY(COALESCE(v_fact_ids, ARRAY[]::uuid[]))
    ), '[]'::jsonb),

    'crawl_topics_for_page', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'topic_key',       topic_key,
        'topic_label',     topic_label,
        'topic_group',     topic_group,
        'coverage_status', coverage_status,
        'passages',        passages,
        'items',           items
      ) ORDER BY topic_key)
      FROM web_project_topics
      WHERE web_project_id = p_project_id
        AND topic_key = ANY(COALESCE(v_topic_keys, ARRAY[]::text[]))
    ), '[]'::jsonb),

    'build_directives_for_page', COALESCE((
      SELECT jsonb_agg(d)
      FROM jsonb_array_elements(
        COALESCE(v_state->'page_allocation_plan'->'build_directives', '[]'::jsonb)
      ) d
      WHERE d->>'applies_to' = p_page_slug
         OR d->>'applies_to' = 'site_wide'
    ), '[]'::jsonb),

    'stage_1',         v_state->'stage_1',
    'ministry_model',  v_state->'ministry_model',
    'site_strategy_pages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug',         p->>'slug',
        'name',         p->>'name',
        'nav_order',    (p->>'nav_order')::int,
        'nav_strategy', p->>'nav_strategy',
        'primary_persona', p->>'primary_audience'
      ) ORDER BY COALESCE((p->>'nav_order')::int, 9999), p->>'slug')
      FROM jsonb_array_elements(v_state->'site_strategy'->'pages') p
    ), '[]'::jsonb),

    'strategic_goals_approved', (
      SELECT jsonb_object_agg(cat, fields)
      FROM (
        SELECT cat,
               (SELECT jsonb_object_agg(k, v)
                FROM jsonb_each(v_state->'strategic_goals'->cat) AS e(k, v)
                WHERE v->>'status' = 'approved') AS fields
        FROM (VALUES
          ('goals_and_vision'),
          ('voice_and_tone'),
          ('content_and_allocation'),
          ('display_and_technical'),
          ('inspiration_and_notes')
        ) AS c(cat)
      ) approved
      WHERE fields IS NOT NULL
    ),

    'prior_handoff_note', v_state->'page_allocation_plan'->'_meta'->>'handoff_note',
    'canonical_templates', v_canonical,
    '_loaded_at',          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$func$;

COMMENT ON FUNCTION public.cowork_load_outline_context(uuid, text) IS
  'Cowork outline-page context loader. One MCP call replaces 8-15 ad-hoc probes. Returns allocation slice + atoms/facts/crawl topics referenced + stage_1 + ministry_model + approved strategic_goals + build_directives + prior handoff note + canonical_templates manifest + sitemap page list.';

GRANT EXECUTE ON FUNCTION public.cowork_load_outline_context(uuid, text) TO authenticated, anon, service_role;
