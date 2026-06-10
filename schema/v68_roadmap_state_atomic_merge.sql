-- v68 — Atomic roadmap_state merge RPC.
--
-- Every Copy Engine agent (extract-strategy, draft-sitemap,
-- acf-content-organizer, determine-ministry-model, strategist,
-- page-outlines, page-draft, slot-edit, director, plus orchestrate's
-- writeEngineState) was doing read-modify-write of
-- strategy_web_projects.roadmap_state:
--
--   1. SELECT roadmap_state FROM strategy_web_projects WHERE id=$1
--   2. 30-90s LLM call inside the agent
--   3. UPDATE strategy_web_projects SET roadmap_state = {...state, my_key: value}
--
-- Between steps 1 and 3, any sibling write to the same row (a
-- different agent's write, a writeEngineState heartbeat, the
-- auto-heal cascade, etc.) gets OBLITERATED when step 3 lands —
-- because the state spread in step 3 is frozen at step 1's read.
--
-- We saw this in production:
--   - project 3886: page-outlines / page-drafts dropped from 21 down
--     to 3 / 12 because parallel writes overwrote each other.
--   - project 3734: stage_1 + site_strategy + ministry_model + acf_plan
--     all silently disappeared even though they had been written
--     successfully earlier. The sitemap proved they HAD existed (it
--     couldn't have been drafted without stage_1); a later agent's
--     stale-state write removed them.
--
-- This function does the merge in a single UPDATE statement with
-- jsonb_set. No read-then-write window for a race to slip into. The
-- agent passes only the slot path + the new value; everything else
-- in the JSONB column is untouched.
--
-- Path examples:
--   ['stage_1']                            → set top-level key
--   ['site_strategy']                      → set top-level key
--   ['page_outlines', 'home']              → set one page's outline
--   ['page_drafts', 'home']                → set one page's draft
--   ['page_bind_suggestions', 'home']      → set one page's bind
--   ['engine_state']                       → overwrite engine_state
--   ['engine_state', 'status']             → set a single field

CREATE OR REPLACE FUNCTION roadmap_state_set(
  p_project_id uuid,
  p_path       text[],
  p_value      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Reject empty paths — without a path target, jsonb_set would
  -- replace the entire column (effectively the broken pattern).
  IF p_path IS NULL OR cardinality(p_path) = 0 THEN
    RAISE EXCEPTION 'roadmap_state_set: path must be a non-empty text[]';
  END IF;

  UPDATE strategy_web_projects
  SET roadmap_state = jsonb_set(
    COALESCE(roadmap_state, '{}'::jsonb),
    p_path,
    p_value,
    true  -- create_missing: create intermediate keys if they don't exist yet
  )
  WHERE id = p_project_id
  RETURNING roadmap_state INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'roadmap_state_set: project % not found', p_project_id;
  END IF;

  RETURN v_result;
END;
$$;

-- Companion: atomic DELETE of a single key. Used by orchestrate's
-- reset_engine_state action and any caller that wants to wipe a slot
-- without re-reading the whole column.
CREATE OR REPLACE FUNCTION roadmap_state_delete(
  p_project_id uuid,
  p_key        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Both functions called only from server-side agents using the
-- service-role key — no anon access. The SECURITY DEFINER on each
-- runs as the function owner so RLS doesn't second-guess service
-- role writes (which already bypass RLS, but being explicit costs
-- nothing).
REVOKE ALL ON FUNCTION roadmap_state_set(uuid, text[], jsonb)    FROM PUBLIC;
REVOKE ALL ON FUNCTION roadmap_state_delete(uuid, text)          FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION roadmap_state_set(uuid, text[], jsonb)    TO service_role;
GRANT  EXECUTE ON FUNCTION roadmap_state_delete(uuid, text)          TO service_role;
