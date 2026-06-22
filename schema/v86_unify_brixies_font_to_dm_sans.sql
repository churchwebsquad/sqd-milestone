-- v86 — Swap every Brixies template's font-family declaration from
-- Inter to DM Sans so wireframe previews render with the brand sans
-- consistently across staff machines.
--
-- Bug: All 258 published web_content_templates declared
-- `font-family: Inter` inside their source_html. Our preview iframes
-- don't load Inter (we standardized on DM Sans in commit 473b2f3),
-- so browsers fell back to the next available font in their default
-- stack — which is system serif on many setups. Staff with Inter
-- installed locally saw sans; staff without saw serif. Same template,
-- different rendering.
--
-- Fix: replace `font-family: Inter` → `font-family: 'DM Sans'` across
-- every published template. The CSS quotes are needed because "DM
-- Sans" contains a space; without quotes the browser parses it as
-- two fallback names. Value-only change; no schema impact.
--
-- This migration is checked in as documentation of the value update
-- already applied to the database. Re-running is idempotent — the
-- LIKE filter only matches rows that still carry the old string.

UPDATE web_content_templates
SET source_html = REPLACE(source_html, 'font-family: Inter', $$font-family: 'DM Sans'$$),
    updated_at = now()
WHERE is_published = true
  AND source_html LIKE '%font-family: Inter%';
