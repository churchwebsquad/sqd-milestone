-- v37 — Partial-unique snippet token index, so re-imports work.
--
-- The previous index was `UNIQUE (web_project_id, token)` with no
-- predicate, meaning archived rows still occupied the constraint.
-- The snippets importer's "wipe-on-import" step archives the prior
-- custom snippets then inserts the new ones — but the new inserts
-- collided with the archived rows on the same `(web_project_id,
-- token)` pair, surfacing as:
--   "duplicate key value violates unique constraint
--    web_project_snippets_unique_token"
--
-- The intent of the wipe is to make "imports are idempotent" true. A
-- partial index over `archived = false` lets archived rows coexist
-- (useful as history) while still blocking duplicate ACTIVE tokens.

-- The previous incarnation was a UNIQUE CONSTRAINT (not just an index),
-- so we drop the constraint — Postgres removes its backing index with
-- it — and create a partial UNIQUE INDEX with the same name in its place.
ALTER TABLE web_project_snippets
  DROP CONSTRAINT IF EXISTS web_project_snippets_unique_token;

CREATE UNIQUE INDEX web_project_snippets_unique_token
  ON web_project_snippets (web_project_id, token)
  WHERE archived = false;
