-- v70 — roadmap_state_set: create intermediate keys before final set.
--
-- BUG IT FIXES
-- v68's RPC relied on `jsonb_set(target, path, value, create_missing=true)`,
-- but `create_missing` ONLY creates the LAST path element — the prefix
-- MUST already exist or jsonb_set silently returns the target unchanged
-- (no error). Nested writes like
--   roadmap_state_set(id, ['cowork_progress', 'outline_page', 'paratots'], v)
-- on a row where `cowork_progress` didn't yet exist were silent no-ops.
-- The importer 200'd, the workflow printed green, and nothing landed.
-- Caught 2026-06-12 by an independent database read during the cowork
-- outline-page smoke fire. Same trap latent on every nested-path caller
-- in api/web/agents/* (page_outlines, page_drafts, page_bind_suggestions,
-- cowork_progress) — legacy pipeline runs almost certainly lost writes
-- the first time each intermediate key was needed; only "top-level
-- write first" runs benefited from a fortuitous prefix-creation order.
--
-- THE FIX
-- 1. Walk every prefix shorter than the full path. If a prefix is
--    missing, initialize it to `{}` via jsonb_set with create_missing.
--    (jsonb_set's create_missing CAN create a one-deep missing element
--    as long as ITS prefix exists — that's why we iterate shortest-first.)
-- 2. If a prefix exists but isn't a JSONB object (jsonb_typeof returns
--    something other than 'object'), RAISE — otherwise jsonb_set would
--    fail to set keys inside a string/number/array/null intermediate
--    and re-create the same silent-no-op class one layer deeper.
-- 3. SELECT … FOR UPDATE holds the row lock through the subsequent
--    UPDATE in the same transaction, so concurrent callers serialize
--    (preserves v68's race-free goal).
--
-- HARDENING (free moment while replacing the definition)
-- 4. `SET search_path = public` pinned on the function. v68 was
--    SECURITY DEFINER with no pinned search_path — a privilege-
--    escalation footgun (a caller could prepend a malicious schema and
--    shadow built-ins the function name-resolves through).
--
-- COMPATIBILITY
-- Top-level single-key writes (`['stage_1']`, `['site_strategy']`, etc.)
-- behave identically — the prefix loop runs zero iterations. The only
-- behavior change is nested writes that previously silently failed now
-- succeed. No working caller's behavior changes.
--
-- BACKUP
-- v68 source captured 2026-06-12 via pg_get_functiondef at
-- Projects/copy-engine-review/backup_v68_roadmap_state_rpcs_2026-06-12.sql.
-- Rollback = `apply_migration` of that file's body.

CREATE OR REPLACE FUNCTION roadmap_state_set(
  p_project_id uuid,
  p_path       text[],
  p_value      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state  jsonb;
  v_prefix text[];
  i        int;
BEGIN
  IF p_path IS NULL OR cardinality(p_path) = 0 THEN
    RAISE EXCEPTION 'roadmap_state_set: path must be a non-empty text[]';
  END IF;

  -- Lock the row + read current state. The FOR UPDATE holds the lock
  -- through the subsequent UPDATE in this same plpgsql transaction.
  SELECT COALESCE(roadmap_state, '{}'::jsonb)
  INTO v_state
  FROM strategy_web_projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'roadmap_state_set: project % not found', p_project_id;
  END IF;

  -- Initialize every missing prefix to {}. Reject wrong-type prefixes
  -- so the silent-no-op class doesn't re-emerge one layer deeper.
  FOR i IN 1..cardinality(p_path) - 1 LOOP
    v_prefix := p_path[1:i];
    IF v_state #> v_prefix IS NULL THEN
      v_state := jsonb_set(v_state, v_prefix, '{}'::jsonb, true);
    ELSIF jsonb_typeof(v_state #> v_prefix) <> 'object' THEN
      RAISE EXCEPTION
        'roadmap_state_set: cannot descend into non-object at prefix %; existing type is %',
        v_prefix,
        jsonb_typeof(v_state #> v_prefix);
    END IF;
  END LOOP;

  -- All intermediates now exist and are objects; final set lands.
  v_state := jsonb_set(v_state, p_path, p_value, true);

  UPDATE strategy_web_projects
  SET roadmap_state = v_state
  WHERE id = p_project_id;

  RETURN v_state;
END;
$$;

-- Pin search_path on roadmap_state_delete too (same hardening; the
-- function body is unchanged from v68 since top-level key delete via
-- the `-` operator has no path-creation semantics to fix).
CREATE OR REPLACE FUNCTION roadmap_state_delete(
  p_project_id uuid,
  p_key        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'roadmap_state_delete: key must be a non-empty string';
  END IF;

  UPDATE strategy_web_projects
  SET roadmap_state = (COALESCE(roadmap_state, '{}'::jsonb) - p_key)
  WHERE id = p_project_id
  RETURNING roadmap_state INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'roadmap_state_delete: project % not found', p_project_id;
  END IF;

  RETURN v_result;
END;
$$;

-- Grants unchanged. CREATE OR REPLACE preserves them, but restating is
-- belt-and-suspenders against a future env where the function was
-- dropped + recreated.
REVOKE ALL ON FUNCTION roadmap_state_set(uuid, text[], jsonb)    FROM PUBLIC;
REVOKE ALL ON FUNCTION roadmap_state_delete(uuid, text)          FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION roadmap_state_set(uuid, text[], jsonb)    TO service_role;
GRANT  EXECUTE ON FUNCTION roadmap_state_delete(uuid, text)          TO service_role;
