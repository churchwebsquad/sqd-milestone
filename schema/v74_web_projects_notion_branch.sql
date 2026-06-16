-- v74 — Notion-audit branch on strategy_web_projects.
--
-- WHY
-- New cowork pathway: partners arriving with copywriting already in
-- progress (e.g. Arvada Vineyard 3734, where copy lives in a Notion
-- database) need an AUDIT path through the pipeline rather than the
-- standard "generate copy from scratch" path. Adding two nullable
-- columns is the cleanest gate: when notion_database_id is set,
-- steps 7-10 collapse into the autonomous audit-external-copy skill
-- (walks the sitemap silently, scores 5 axes against the existing
-- Notion copy, flags formatting gaps against canonical templates)
-- and any pages without a Notion match auto-route to a supplemental
-- authoring step.
--
-- COLUMNS
--   notion_database_id  text NULL — the database id parsed from the
--     strategist's URL on intake. Presence = "audit branch on."
--   notion_database_url text NULL — display + click-through.
--
-- DEPENDENCY AUDIT (per CLAUDE.md)
-- - Additive only (two nullable columns). No type changes, no
--   constraints added.
-- - 2 triggers on the table — both are mutation-trigger style
--   (e.g. updated_at maintenance, intake hard-stop notifications);
--   neither references the new columns.
-- - 7 functions reference the table; all read existing columns
--   (id, member, roadmap_state) — none read the new columns yet.
-- - 16 FKs point AT this table (child tables); no FK on the new
--   columns themselves.
-- - 0 views, 0 matviews touch the table.
--
-- ROLLBACK
--   ALTER TABLE strategy_web_projects
--     DROP COLUMN IF EXISTS notion_database_id,
--     DROP COLUMN IF EXISTS notion_database_url;

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS notion_database_id  text NULL,
  ADD COLUMN IF NOT EXISTS notion_database_url text NULL;

COMMENT ON COLUMN strategy_web_projects.notion_database_id IS
  'Notion database id for projects with copywriting already in progress externally. When set, the cowork pipeline takes the audit-external-copy branch: steps 7-10 collapse into an autonomous audit pass that scores existing Notion copy on the 5 axes + flags formatting gaps; pages missing from Notion route to supplemental-page-authoring.';

COMMENT ON COLUMN strategy_web_projects.notion_database_url IS
  'Click-through URL for the Notion database. Parsed on save to extract notion_database_id; persisted alongside for the strategist UI link-out.';
