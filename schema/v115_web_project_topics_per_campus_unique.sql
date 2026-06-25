-- v115 — per-campus topic rows.
--
-- Original constraint `one_topic_per_project` was UNIQUE
-- (web_project_id, topic_key) — exactly one row per topic per project.
-- That collapses multi-campus churches' per-location topics (e.g.
-- Doxology's Southwest / Alliance / Espanol kids ministries) into a
-- single shared row, losing per-campus fidelity.
--
-- Replace it with UNIQUE NULLS NOT DISTINCT (web_project_id, topic_key,
-- campus_slug). The "NULLS NOT DISTINCT" clause (Postgres 15+) treats
-- two NULL values as equal — so a "global" row with campus_slug=NULL
-- is still unique per (project, topic), while campus-specific rows
-- are unique per (project, topic, campus_slug). Single-campus projects
-- (campus_slug always NULL) keep their one-row-per-topic-key behavior
-- exactly as before.
--
-- One constraint + standard ON CONFLICT (web_project_id, topic_key,
-- campus_slug) — works with PostgREST/supabase-js upsert without
-- needing partial-index inference.
--
-- Audit (per CLAUDE.md Dependency Audit Before Supabase Table Changes):
--   • Trigger trg_web_project_topics_touch — only sets updated_at,
--     unaffected.
--   • cowork_load_outline_context() — selects by
--     topic_key = ANY(...). Multi-row results inflate per-page outline
--     context for multi-campus projects. Phase 4 makes the outline
--     RPC campus-aware. For single-campus projects (the existing
--     fleet), behavior is unchanged because at most one row matches.
--   • web_crawl_categorize_reconcile() — only an EXISTS check,
--     unaffected.
--   • No views / matviews / FKs depend on the constraint name itself.
--   • Three RLS policies — read/write gates, unaffected.

-- Drop any prior attempt from in-flight v115 deploys.
DROP INDEX IF EXISTS web_project_topics_global_uidx;
DROP INDEX IF EXISTS web_project_topics_per_campus_uidx;

ALTER TABLE web_project_topics
  DROP CONSTRAINT IF EXISTS one_topic_per_project;

ALTER TABLE web_project_topics
  ADD CONSTRAINT one_topic_per_project_per_campus
  UNIQUE NULLS NOT DISTINCT (web_project_id, topic_key, campus_slug);

-- v114's secondary lookup index is now redundant — the new unique
-- constraint's underlying index covers the same (project, campus_slug)
-- access path.
DROP INDEX IF EXISTS web_project_topics_campus_slug_idx;

COMMENT ON COLUMN web_project_topics.campus_slug IS
  'Campus this topic belongs to (matches strategy_web_projects.campuses[].slug). NULL = global / church-wide. Uniqueness via one_topic_per_project_per_campus: (project, topic, campus_slug) with NULLS NOT DISTINCT — see v115.';
