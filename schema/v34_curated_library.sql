-- v34 — Curated Brixies library per web project
--
-- The Global Elements workspace lets strategists bind one (or a few)
-- Brixies templates to each named "concept" the site will use —
-- Ministry Card, Homepage Hero, Simple CTA Banner, etc. Stored as a
-- flat object keyed by concept_id; values are arrays of template ids
-- (most concepts pick 1, a few allow up to 2 — see
-- src/lib/webCuratedLibrary.ts for the concept definitions).
--
-- The AI auto-bind pass (Phase 3) prioritizes templates listed here
-- over the global catalog, so this becomes the site-specific Brixies
-- palette and the foundation for streamlined section binding.

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS curated_library jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN strategy_web_projects.curated_library IS
  'Map of concept_id → [template_id, …]. Concepts are defined in src/lib/webCuratedLibrary.ts.';
