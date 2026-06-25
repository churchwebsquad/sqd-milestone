-- v114 — campus_slug on web_project_topics
--
-- Source of truth for which campus a crawled topic belongs to. NULL =
-- global / church-wide. Populated by the crawl-categorize edge function
-- when the project has campuses configured (strategy_web_projects.
-- campuses[] is non-empty). For single-campus projects, this column
-- stays NULL forever and the rest of the system behaves exactly as
-- before.
--
-- Atoms / facts inherit campus from their source topic via metadata
-- (no scalar column added there — reduces blast radius and matches
-- the audit principle of one source-of-truth column).

ALTER TABLE web_project_topics
  ADD COLUMN IF NOT EXISTS campus_slug text;

COMMENT ON COLUMN web_project_topics.campus_slug IS
  'Campus this topic belongs to (matches strategy_web_projects.campuses[].slug). NULL = global / church-wide content. Populated by crawl-categorize when the project is multi-campus.';

CREATE INDEX IF NOT EXISTS web_project_topics_campus_slug_idx
  ON web_project_topics (web_project_id, campus_slug)
  WHERE campus_slug IS NOT NULL;
