-- v75 — Cowork → Pages handoff provenance columns.
--
-- WHY
-- Today the cowork pipeline produces page_outlines / page_drafts /
-- page_critiques in roadmap_state with rich provenance (atom ids,
-- fact ids, crawl topic keys, voice anchor, intended_verbatim_band,
-- actual_verbatim_ratio, deferred items, audit_source, notion
-- back-links, 5-axis scores, directives, handoff notes). The
-- existing page-bind path strips all of it — only field_values +
-- content_template_id survive into web_sections. That's the
-- translation-layer flaw the user flagged: cowork and Pages should
-- speak the same language, not converse through a lossy adapter.
--
-- This migration adds the columns a purpose-built handoff endpoint
-- needs so cowork's native shape arrives intact. Two tables, seven
-- columns. All nullable + additive — no existing row breaks.
--
-- WHAT IT ADDS
-- web_pages:
--   cowork_handoff_meta jsonb — full mirror of outline._meta +
--     critique._meta + page-level audit info
--   audit_source  text       — 'notion' | 'notion-gap' | 'generated' |
--     'generated-supplemental' (queryable narrow)
--   notion_url    text       — direct click-through to the Notion page
--     when audit branch (queryable narrow)
--   cowork_handoff_at timestamptz — when the handoff endpoint last
--     populated this page; flags staleness if cowork re-runs after edits
--
-- web_sections:
--   cowork_section_meta jsonb — full provenance bundle (section_intent,
--     atom_ids_used, fact_ids_used, crawl_topic_keys_used, voice_anchor,
--     intended_verbatim_band, actual_verbatim_ratio, deferred_items,
--     directives, axis scores, notion_page_id/url when audit branch)
--   cowork_slot_values jsonb — uniform-named slot values from cowork
--     (primary_heading, body, items[], buttons[], tagline, accent_body).
--     field_values stays the Brixies-named version, derived from this
--     via canonical-templates uniform_to_brixies at handoff time.
--   split_group_id uuid — when audit-branch overflow SPLIT one Notion
--     section into N web_sections, they share this id
--   split_position int — 1 of N within the split_group
--
-- DEPENDENCY AUDIT (per CLAUDE.md)
-- - web_pages: set_updated_at trigger + 3 RLS policies + 1 function
--   reference + 4 FKs pointing at it (web_embed_blocks,
--   web_review_comments, web_review_edits, web_sections). None
--   touch the new columns; additive nullable is safe.
-- - web_sections: set_updated_at trigger + 3 RLS policies + 0
--   function references + 3 FKs pointing at it (web_bind_telemetry,
--   web_review_comments, web_review_edits). Same — safe.
-- - No views, no matviews touch either table.
--
-- ROLLBACK
--   ALTER TABLE web_pages
--     DROP COLUMN IF EXISTS cowork_handoff_meta,
--     DROP COLUMN IF EXISTS audit_source,
--     DROP COLUMN IF EXISTS notion_url,
--     DROP COLUMN IF EXISTS cowork_handoff_at;
--   ALTER TABLE web_sections
--     DROP COLUMN IF EXISTS cowork_section_meta,
--     DROP COLUMN IF EXISTS cowork_slot_values,
--     DROP COLUMN IF EXISTS split_group_id,
--     DROP COLUMN IF EXISTS split_position;

ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS cowork_handoff_meta jsonb,
  ADD COLUMN IF NOT EXISTS audit_source        text,
  ADD COLUMN IF NOT EXISTS notion_url          text,
  ADD COLUMN IF NOT EXISTS cowork_handoff_at   timestamptz;

COMMENT ON COLUMN web_pages.cowork_handoff_meta IS
  'Full mirror of cowork outline._meta + critique._meta + page-level audit info from the handoff endpoint. Populated by /api/web/cowork/handoff-to-pages. Read by the Pages workspace audit tab.';
COMMENT ON COLUMN web_pages.audit_source IS
  'Provenance source for this page''s copy. ''notion'' = audit branch (partner copy already in Notion). ''notion-gap'' = audit branch placeholder, supplemental authoring filled it. ''generated'' = from-scratch branch. ''generated-supplemental'' = supplemental-page-authoring filled a gap.';
COMMENT ON COLUMN web_pages.notion_url IS
  'Direct click-through to the originating Notion page when audit_source = ''notion''. Mirrored from cowork_handoff_meta for fast UI access.';
COMMENT ON COLUMN web_pages.cowork_handoff_at IS
  'When /api/web/cowork/handoff-to-pages last populated this row. NULL = page existed before handoff was wired (legacy from-scratch button path).';

ALTER TABLE web_sections
  ADD COLUMN IF NOT EXISTS cowork_section_meta jsonb,
  ADD COLUMN IF NOT EXISTS cowork_slot_values  jsonb,
  ADD COLUMN IF NOT EXISTS split_group_id      uuid,
  ADD COLUMN IF NOT EXISTS split_position      int;

COMMENT ON COLUMN web_sections.cowork_section_meta IS
  'Full provenance bundle from the cowork artifact triplet (outline + draft + critique). Shape: { section_intent_id, section_intent_text, voice_anchor_atom_ids, intended_verbatim_band, actual_verbatim_ratio, atom_ids_used, fact_ids_used, crawl_topic_keys_used, deferred_items, voice_notes, axes, directives, notion_page_id?, notion_url? }. Powers the audit/scan tab in PagesWorkspace.';
COMMENT ON COLUMN web_sections.cowork_slot_values IS
  'Uniform-named slot values from cowork (primary_heading, body, items, buttons, tagline, accent_body). field_values is the Brixies-named version derived from this via canonical_templates.uniform_to_brixies at handoff time. Round-tripping cowork-original here lets future re-translations happen without re-running cowork.';
COMMENT ON COLUMN web_sections.split_group_id IS
  'When audit-branch overflow split one Notion section into multiple web_sections (e.g. 6 staff → 3× feature_team), all siblings share this uuid. NULL means standalone section.';
COMMENT ON COLUMN web_sections.split_position IS
  '1-based position within the split_group. NULL when split_group_id IS NULL.';

-- Helpful index for staleness queries from the workspace.
CREATE INDEX IF NOT EXISTS idx_web_pages_cowork_handoff_at
  ON web_pages (cowork_handoff_at DESC NULLS LAST)
  WHERE cowork_handoff_at IS NOT NULL;
