-- v100 — page version history + section role identity + designer Figma swaps
--
-- Three additive changes that share a goal: make the page builder's lo-fi
-- wireframe layout decoupled from the designer's final Figma layout, and
-- make every page-level change revertible.
--
--   1. strategy_web_page_versions — snapshot of a page + its sections at
--      a point in time. Captured by the page-snapshot helper before every
--      agent run and on every manual save. Revert = copy
--      page_snapshot/sections_snapshot back to the live tables in a
--      transaction. A revert itself writes a new snapshot with
--      reverted_from_version set so the lineage is queryable.
--
--   2. web_sections.section_role / section_role_label — stable slot
--      identity. The role survives layout swaps so "the events page's
--      simple CTA banner" is the same row even after the designer picks
--      a different Brixies layout for it in Figma. section_role is the
--      curated enum (SectionRole in TS); section_role_label is an
--      optional per-section override of the role's default label.
--
--   3. web_sections.figma_template_override_id + figma_swap_note /
--      figma_swap_at / figma_swap_by — designer's PER-SECTION Figma
--      layout swap. Surfaces in the design handoff swap board.
--      NULL = no override; the project-level figma_layout_swaps map
--      handles the section-agnostic case.
--
--   4. strategy_web_projects.figma_layout_swaps jsonb — designer's
--      SITE-WIDE swap map. Shape:
--        { <from_template_id>: { to_template_id, note, swapped_at, swapped_by } }
--      Wins over the original content_template_id but loses to a
--      per-section figma_template_override_id when both apply.
--
-- Effective-template resolver (used by Figma plugin + design handoff +
-- dev checklist; NOT by the page editor — content stays sourced from
-- the original wireframe layout):
--   effective_template_id =
--        section.figma_template_override_id
--     ?? project.figma_layout_swaps[section.content_template_id]?.to_template_id
--     ?? section.content_template_id

CREATE TABLE IF NOT EXISTS strategy_web_page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_page_id uuid NOT NULL REFERENCES web_pages(id) ON DELETE CASCADE,
  web_project_id uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  trigger_kind text NOT NULL,
  trigger_label text,
  reverted_from_version uuid REFERENCES strategy_web_page_versions(id),
  page_snapshot jsonb NOT NULL,
  sections_snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategy_web_page_versions_page_created
  ON strategy_web_page_versions (web_page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_web_page_versions_project
  ON strategy_web_page_versions (web_project_id, created_at DESC);
COMMENT ON TABLE strategy_web_page_versions IS
  'Snapshot of a page + its sections at a point in time. Captured before every agent run and on manual saves. Revertible — copy page_snapshot/sections_snapshot back to live tables.';

ALTER TABLE web_sections
  ADD COLUMN IF NOT EXISTS section_role text,
  ADD COLUMN IF NOT EXISTS section_role_label text,
  ADD COLUMN IF NOT EXISTS figma_template_override_id text REFERENCES web_content_templates(id),
  ADD COLUMN IF NOT EXISTS figma_swap_note text,
  ADD COLUMN IF NOT EXISTS figma_swap_at timestamptz,
  ADD COLUMN IF NOT EXISTS figma_swap_by uuid;
COMMENT ON COLUMN web_sections.section_role IS
  'Curated enum (SectionRole in TS) identifying the slot purpose: hero_innerpage, cta_banner_simple, etc. Stable across layout swaps.';
COMMENT ON COLUMN web_sections.section_role_label IS
  'Optional per-section override of the role''s default human-readable label.';
COMMENT ON COLUMN web_sections.figma_template_override_id IS
  'Designer''s per-section Figma layout swap. Wins over project-level figma_layout_swaps. NULL = no override.';

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS figma_layout_swaps jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN strategy_web_projects.figma_layout_swaps IS
  'Site-wide Figma layout swap map. Shape: { <from_template_id>: { to_template_id, note, swapped_at, swapped_by } }. Section-level figma_template_override_id wins when both apply.';
