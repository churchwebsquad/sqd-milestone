-- v19_brand_handoff.sql
--
-- Backing fields for the internal brand handoff doc surface
-- (/branding/{portal_token}). Both are staff-facing — they are NOT exposed
-- by the public get_brand_guide_by_slug RPC, so partners never see them.
--
-- style_tags: controlled-vocabulary tags the brand squad sets to classify
--   the brand's visual style (minimal, bold, colorful, etc.). Surfaces on
--   the handoff Overview tab as badges. The app enforces the vocabulary in
--   src/lib/brandStyleTags.ts — the column is just a text[] so we can
--   evolve the list without a schema change.
--
-- handoff_notes: 1–3 sentences of free-text designer-facing context. Lives
--   on the handoff page Overview tab beneath the style tags.

ALTER TABLE strategy_brand_guides
  ADD COLUMN IF NOT EXISTS style_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS handoff_notes text;
