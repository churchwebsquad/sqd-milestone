-- v77_audit_branch_metadata.sql
-- 2026-06-17
--
-- Audit branch (Notion → web_pages) lossless-extraction support.
-- Adds three nullable jsonb columns so the SKILL + handoff can persist
-- every partner annotation it extracts from a Notion DB without
-- losing words, links, gap markers, or designer intent.
--
-- web_pages.seo_metadata          ← partner-written `# SEO` block
-- web_pages.partner_gaps_flagged  ← partner-written page-final `## GAPS FLAGGED` bullets
-- strategy_web_projects.global_footer  ← Notion Type=Footer row body (or `## GLOBAL FOOTER` block)
--
-- Dependency audit (run 2026-06-17 against project wttgwoxlezqoyzmesekt):
--   - Triggers on web_pages / strategy_web_projects: only generic
--     *_set_updated_at + trg_crawl_web_project (references member /
--     web_crawl_config — not our new columns). Safe.
--   - No functions, views, matviews, FKs, or RLS policies reference
--     any of seo_metadata / partner_gaps_flagged / global_footer
--     (verified — the names don't exist yet anywhere).
--   - 21 FKs point INTO these tables on ID columns; new columns are
--     not in any FK.
-- Additive ADD COLUMN IF NOT EXISTS with nullable jsonb — no
-- regression risk for existing rows.

ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS seo_metadata          jsonb,
  ADD COLUMN IF NOT EXISTS partner_gaps_flagged  jsonb;

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS global_footer jsonb;

COMMENT ON COLUMN web_pages.seo_metadata IS
  'Audit branch: verbatim partner-written SEO block from Notion. Shape: { raw_block, primary_keywords[], secondary_keywords[], local_keywords[], meta_title, meta_description, aeo_snippet }. Null when no audit branch / no SEO block present.';

COMMENT ON COLUMN web_pages.partner_gaps_flagged IS
  'Audit branch: partner-authored gap markers from the page-final "## GAPS FLAGGED" block in Notion. Array of { note, kind: "partner_flagged" }. Surface to strategist alongside SKILL-generated critique directives.';

COMMENT ON COLUMN strategy_web_projects.global_footer IS
  'Audit branch: partner-written global footer (Type=Footer row body in Notion, or "## GLOBAL FOOTER" block on Homepage). One value per project. Shape: { raw_block, columns[], footer_notes[] }. Consumed by the layout once per site.';
