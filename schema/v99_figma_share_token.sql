-- v99: per-project share token for the Squad Figma plugin.
--
-- The local-dev Figma plugin runs in the designer's Figma instance
-- and needs to read project data (template list, figma_component_key
-- per section, page list) from our API. Authenticating via a full
-- Supabase JWT inside Figma's plugin sandbox is fiddly (pasting
-- 600+ chars). A per-project bearer token is simpler: staff click
-- "Generate plugin token" in the Web Manager, paste the resulting
-- short UUID into the plugin's settings, and the plugin uses it on
-- every API call.
--
-- Additive nullable text column on strategy_web_projects. Dep audit
-- shape matches v94 / v95 / v97 / v98 — no view, matview, FK, or
-- trigger reads this column; functions on this table query by id /
-- specific columns, none by SELECT *.
--
-- Tokens are generated server-side via gen_random_uuid()::text on
-- demand. Revoke by NULL-ing the column.

ALTER TABLE public.strategy_web_projects
  ADD COLUMN IF NOT EXISTS figma_share_token text;

COMMENT ON COLUMN public.strategy_web_projects.figma_share_token IS
  'Per-project bearer token for the Squad Figma plugin to authenticate against /api/figma/project-export. Generated on demand; NULL = no token issued yet. Revoke by setting back to NULL.';
