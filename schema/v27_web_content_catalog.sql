-- v27_web_content_catalog.sql
--
-- The structural spine for the Website Manager's Content Manager tool.
-- Three new tables:
--
--   1. web_content_templates  — global catalog of Brixies sections
--      (one row per Brixies section variant, e.g. "Feature section 3").
--      Same row drives AI generation, the wireframe renderer, the
--      Figma plugin, and the WordPress / ACF import — one schema, four
--      consumers.
--
--   2. web_pages              — per-project page list. Each web_project
--      has its own pages with phase tagging (Phase 1 / Phase 2 /
--      nav-only) and an optional user-journey step index.
--
--   3. web_sections           — per-page section instances bound to
--      a content template. `field_values` is the typed copy payload
--      (matches the template's `fields` schema). `cards` is the
--      repeating array (matches the template's `card_schema`).
--
-- The catalog ships seeded with the Feature Sections family today
-- (24 templates). Other families (Heroes, Content, Banners, etc.)
-- get added via the same import script as their HTML lands.

-- ── 1. Catalog ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_content_templates (
  -- Stable kebab-case id, e.g. 'feature-section-3'. Foreign-keyed
  -- from web_sections so renames cascade carefully.
  id                  text PRIMARY KEY,
  -- Verbatim Brixies layer name ('Feature section 3'). Matches Figma
  -- layer names 1:1, which is the bridge that lets one schema drive
  -- both the wireframe renderer and the Figma plugin.
  brixies_layer_name  text NOT NULL,
  brixies_family      text NOT NULL,
  label               text NOT NULL,
  description         text,
  preview_image_url   text,
  -- Cleaned, RTF-stripped HTML for the renderer. Stored alongside the
  -- schema so a template move is one DB write, no file shuffles.
  source_html         text NOT NULL,
  -- Field schema: array of { key, label?, type, required?, max_chars? }.
  -- Field types today: 'text' | 'richtext' | 'cta' | 'image'.
  fields              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Card schema (same shape as `fields`) — null when the section has
  -- no card container.
  card_schema         jsonb,
  max_cards           int,
  image_slots         int NOT NULL DEFAULT 0,
  -- Hidden templates don't show up in the section picker. Lets the
  -- catalog grow with experimental imports without breaking
  -- strategists' workflows.
  is_published        boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_content_templates_family
  ON web_content_templates (brixies_family);
CREATE INDEX IF NOT EXISTS idx_web_content_templates_published
  ON web_content_templates (is_published, brixies_family);

CREATE OR REPLACE FUNCTION update_web_content_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS web_content_templates_set_updated_at ON web_content_templates;
CREATE TRIGGER web_content_templates_set_updated_at
  BEFORE UPDATE ON web_content_templates
  FOR EACH ROW EXECUTE FUNCTION update_web_content_templates_updated_at();

-- ── 2. Pages ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_pages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id      uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  name                text NOT NULL,             -- e.g. 'Visit', 'About'
  slug                text NOT NULL,             -- url-shape, e.g. 'visit'
  -- Phase tagging from the Sitemap skill. 'nav-only' = item lives in
  -- the nav but the page itself isn't authored (parking lot, etc.).
  phase               text NOT NULL DEFAULT '1',
  -- User-journey position. NULL when the page isn't part of an
  -- ordered persona path.
  user_journey_step   int,
  sort_order          int NOT NULL DEFAULT 0,
  archived            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_pages_project_active
  ON web_pages (web_project_id, archived, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_pages_project_slug
  ON web_pages (web_project_id, slug) WHERE archived = false;

CREATE OR REPLACE FUNCTION update_web_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS web_pages_set_updated_at ON web_pages;
CREATE TRIGGER web_pages_set_updated_at
  BEFORE UPDATE ON web_pages
  FOR EACH ROW EXECUTE FUNCTION update_web_pages_updated_at();

-- ── 3. Sections ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_sections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_page_id         uuid NOT NULL REFERENCES web_pages(id) ON DELETE CASCADE,
  -- The Brixies template this section instance is bound to. RESTRICT
  -- on delete so we never orphan a section because someone removed
  -- a template from the catalog (templates can be unpublished, not
  -- deleted, in practice).
  content_template_id text NOT NULL REFERENCES web_content_templates(id) ON DELETE RESTRICT,
  -- Typed copy payload, matches the template's `fields` schema.
  field_values        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Repeating card instances. Each entry matches the template's
  -- `card_schema`. Empty array when the template has no cards.
  cards               jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order          int NOT NULL DEFAULT 0,
  -- Workflow status — drives the Content Manager's per-section gate.
  --   'draft'     — strategist still authoring
  --   'in_review' — sent to the partner via the Review Console
  --   'approved'  — locked in, ready to flow into Design / Dev handoffs
  content_status      text NOT NULL DEFAULT 'draft',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_sections_page_order
  ON web_sections (web_page_id, sort_order);

CREATE OR REPLACE FUNCTION update_web_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS web_sections_set_updated_at ON web_sections;
CREATE TRIGGER web_sections_set_updated_at
  BEFORE UPDATE ON web_sections
  FOR EACH ROW EXECUTE FUNCTION update_web_sections_updated_at();

-- ── RLS — staff-only, mirrors the other strategy_* tables ────────────────

ALTER TABLE web_content_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_sections ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE pattern so the file is safe to re-run.
DROP POLICY IF EXISTS "Authenticated users can read web_content_templates" ON web_content_templates;
CREATE POLICY "Authenticated users can read web_content_templates"
  ON web_content_templates FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write web_content_templates" ON web_content_templates;
CREATE POLICY "Authenticated users can write web_content_templates"
  ON web_content_templates FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read web_pages" ON web_pages;
CREATE POLICY "Authenticated users can read web_pages"
  ON web_pages FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write web_pages" ON web_pages;
CREATE POLICY "Authenticated users can write web_pages"
  ON web_pages FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read web_sections" ON web_sections;
CREATE POLICY "Authenticated users can read web_sections"
  ON web_sections FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write web_sections" ON web_sections;
CREATE POLICY "Authenticated users can write web_sections"
  ON web_sections FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
