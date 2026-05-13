-- v28_web_bedrock.sql
--
-- Schema changes for the Brixies catalog bedrock pass. Collapses the
-- legacy `card_schema` + `max_cards` split into the unified slot/group
-- `fields` model, adds the section `kind` enum + post-template pairing
-- + preview image columns, and stands up the project-level metadata
-- needed by the Content Manager (card palette, chrome designation,
-- global site snippets) and the new embed-block table.
--
-- Re-runnable. Wipes web_content_templates + web_sections seed data
-- so the parser can re-import against the new schema. Phase 1 only
-- had Feature Sections as a test fixture; nothing user-authored is
-- at risk.

-- ── 1. Reset seed data so re-import lands cleanly ────────────────────

TRUNCATE TABLE web_sections RESTART IDENTITY CASCADE;
TRUNCATE TABLE web_content_templates RESTART IDENTITY CASCADE;

-- ── 2. web_content_templates — bedrock columns ───────────────────────

-- Rename brixies_* → unprefixed (the table itself is the namespace).
-- Wrapped in conditional checks so the migration is safe to re-run from
-- any state (the column may already be renamed if a partial run landed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'web_content_templates' AND column_name = 'brixies_layer_name'
  ) THEN
    ALTER TABLE web_content_templates RENAME COLUMN brixies_layer_name TO layer_name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'web_content_templates' AND column_name = 'brixies_family'
  ) THEN
    ALTER TABLE web_content_templates RENAME COLUMN brixies_family TO family;
  END IF;
END $$;

-- Drop legacy slot-only + max_cards split.
ALTER TABLE web_content_templates DROP COLUMN IF EXISTS card_schema;
ALTER TABLE web_content_templates DROP COLUMN IF EXISTS max_cards;
ALTER TABLE web_content_templates DROP COLUMN IF EXISTS image_slots;
ALTER TABLE web_content_templates DROP COLUMN IF EXISTS label;
ALTER TABLE web_content_templates DROP COLUMN IF EXISTS description;

-- New bedrock columns.
ALTER TABLE web_content_templates
  ADD COLUMN IF NOT EXISTS variant              text,
  ADD COLUMN IF NOT EXISTS kind                 text NOT NULL DEFAULT 'content',
  ADD COLUMN IF NOT EXISTS paired_post_template text,
  ADD COLUMN IF NOT EXISTS paired_url_pattern   text;

-- Enforce the 7-value kind enum per scripts/brixies-taxonomy.json#kinds.
ALTER TABLE web_content_templates DROP CONSTRAINT IF EXISTS web_content_templates_kind_check;
ALTER TABLE web_content_templates ADD CONSTRAINT web_content_templates_kind_check
  CHECK (kind IN ('content', 'chrome', 'functional', 'media', 'embed', 'component', 'post_template'));

-- Drop the old index that referenced the renamed column, recreate.
DROP INDEX IF EXISTS idx_web_content_templates_family;
DROP INDEX IF EXISTS idx_web_content_templates_published;
CREATE INDEX IF NOT EXISTS idx_web_content_templates_kind_family
  ON web_content_templates (kind, family);
CREATE INDEX IF NOT EXISTS idx_web_content_templates_paired_post
  ON web_content_templates (paired_post_template) WHERE paired_post_template IS NOT NULL;

-- ── 3. web_sections — drop `cards` (groups now live inside field_values) ─

-- The unified `fields` model means groups are addressed by key inside
-- field_values, not in a separate top-level array. A group's value is
-- an array of items, each item is an object keyed by the group's
-- item_schema. Backward-compat for the old shape is not needed —
-- TRUNCATE above wiped any in-flight rows.
ALTER TABLE web_sections DROP COLUMN IF EXISTS cards;

-- ── 4. web_pages.phase — allow 'global' for chrome/functional sections ──

-- Currently `phase` is free-text with DEFAULT '1' and no CHECK. Add an
-- explicit CHECK so the Content Manager can rely on a known enum, and
-- include 'global' for the implicit project-level chrome page.
ALTER TABLE web_pages DROP CONSTRAINT IF EXISTS web_pages_phase_check;
ALTER TABLE web_pages ADD CONSTRAINT web_pages_phase_check
  CHECK (phase IN ('global', '1', '2', 'nav-only'));

-- ── 5. strategy_web_projects — bedrock metadata ──────────────────────

-- Card palette (2-4 Card N template ids the project uses everywhere).
-- Chosen at brand-design phase, amendable at content phase per the
-- taxonomy's card_palette docs.
ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS card_palette text[] NOT NULL DEFAULT '{}'::text[];

-- Chrome designation — the user picks a primary header / footer per
-- project. Megamenu / Offcanvas are alternative-nav references for the
-- dev style guide; they don't auto-render on every page.
ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS primary_header_template_id text REFERENCES web_content_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_footer_template_id text REFERENCES web_content_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS megamenu_template_ids      text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS offcanvas_template_ids     text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS nav_items                  jsonb  NOT NULL DEFAULT '[]'::jsonb;

-- Chrome auto-populated text (footer legal blocks). Strategist never
-- authors these per-page; the renderer pulls from the project row.
ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS cookies_policy_text  text,
  ADD COLUMN IF NOT EXISTS privacy_policy_text  text,
  ADD COLUMN IF NOT EXISTS credit_text          text,
  ADD COLUMN IF NOT EXISTS legal_notice_text    text,
  ADD COLUMN IF NOT EXISTS terms_text           text;

-- Global site snippets (merge fields). Available everywhere body copy
-- is authored. See `global_site_snippets` in brixies-taxonomy.json
-- for the merge-field list + token names.
ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS church_name            text,
  ADD COLUMN IF NOT EXISTS church_short_name      text,
  ADD COLUMN IF NOT EXISTS address                text,
  ADD COLUMN IF NOT EXISTS city_state             text,
  ADD COLUMN IF NOT EXISTS phone                  text,
  ADD COLUMN IF NOT EXISTS email                  text,
  ADD COLUMN IF NOT EXISTS primary_service_time   text,
  ADD COLUMN IF NOT EXISTS all_service_times      text,
  ADD COLUMN IF NOT EXISTS denomination           text,
  ADD COLUMN IF NOT EXISTS pastor_name            text,
  ADD COLUMN IF NOT EXISTS social_facebook_url    text,
  ADD COLUMN IF NOT EXISTS social_instagram_url   text,
  ADD COLUMN IF NOT EXISTS social_youtube_url     text,
  ADD COLUMN IF NOT EXISTS social_tiktok_url      text,
  ADD COLUMN IF NOT EXISTS social_twitter_url     text,
  ADD COLUMN IF NOT EXISTS social_linkedin_url    text;

-- Card palette size guard: 0-4 entries (0 allowed pre-brand-phase).
ALTER TABLE strategy_web_projects DROP CONSTRAINT IF EXISTS strategy_web_projects_card_palette_size_check;
ALTER TABLE strategy_web_projects ADD CONSTRAINT strategy_web_projects_card_palette_size_check
  CHECK (array_length(card_palette, 1) IS NULL OR array_length(card_palette, 1) <= 4);

-- ── 6. web_embed_blocks (NEW) — embed placeholder blocks ────────────

-- Embed blocks are a first-class page block type — NOT a Brixies
-- template. The Content Manager renders them as tagged placeholder
-- cards (category + title + what's-included) in the wireframe. The
-- developer replaces the placeholder with the actual widget code at
-- build time. See `embed_block_categories` in brixies-taxonomy.json
-- for the category enum + field shape.

CREATE TABLE IF NOT EXISTS web_embed_blocks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id      uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  -- NULL when the embed lives on the implicit Global page or in a
  -- chrome slot rather than a specific authored page.
  web_page_id         uuid REFERENCES web_pages(id) ON DELETE CASCADE,
  category            text NOT NULL,
  title               text NOT NULL,
  whats_included      text,
  source_url          text,
  embed_code          text,
  source_notes        text,
  sort_order          int  NOT NULL DEFAULT 0,
  archived            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE web_embed_blocks DROP CONSTRAINT IF EXISTS web_embed_blocks_category_check;
ALTER TABLE web_embed_blocks ADD CONSTRAINT web_embed_blocks_category_check
  CHECK (category IN ('event', 'forms', 'giving', 'groups', 'instagram', 'maps', 'prayer', 'sermon', 'youtube_playlist'));

CREATE INDEX IF NOT EXISTS idx_web_embed_blocks_project
  ON web_embed_blocks (web_project_id, archived, sort_order);
CREATE INDEX IF NOT EXISTS idx_web_embed_blocks_page
  ON web_embed_blocks (web_page_id, sort_order) WHERE web_page_id IS NOT NULL;

CREATE OR REPLACE FUNCTION update_web_embed_blocks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS web_embed_blocks_set_updated_at ON web_embed_blocks;
CREATE TRIGGER web_embed_blocks_set_updated_at
  BEFORE UPDATE ON web_embed_blocks
  FOR EACH ROW EXECUTE FUNCTION update_web_embed_blocks_updated_at();

-- ── 7. RLS for the new + reshaped tables ────────────────────────────

ALTER TABLE web_embed_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read web_embed_blocks" ON web_embed_blocks;
CREATE POLICY "Authenticated users can read web_embed_blocks"
  ON web_embed_blocks FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can write web_embed_blocks" ON web_embed_blocks;
CREATE POLICY "Authenticated users can write web_embed_blocks"
  ON web_embed_blocks FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
