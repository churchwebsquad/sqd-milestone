-- v41 — Auto-transition review round status based on comment resolutions.
--
-- The board lifecycle the strategist sees on the kanban:
--   open_for_review → someone resolves a comment → editing_content
--   editing_content + every comment resolved → completed
--
-- The "Finish review" button no longer flips the round to completed —
-- it just exits the editor. Completion is a consequence of every
-- comment being resolved, not a user toggle. (The column-header
-- status menu still lets users force-set the state when they need to
-- override, e.g. "On hold" while waiting on the partner.)
--
-- The trigger only auto-transitions in the forward direction. Once a
-- round is `completed` / `on_hold` / `no_status`, comment edits don't
-- bounce it back — explicit user action is required.

CREATE OR REPLACE FUNCTION reconcile_review_round_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_total  int;
  v_open   int;
BEGIN
  SELECT status INTO v_status FROM web_reviews WHERE id = NEW.review_id;
  IF v_status IS NULL THEN RETURN NEW; END IF;

  -- Only auto-transition forward-direction states. on_hold / no_status
  -- / completed all require manual user action to leave.
  IF v_status NOT IN ('open_for_review', 'editing_content') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'open')
    INTO v_total, v_open
  FROM web_review_comments
  WHERE review_id = NEW.review_id;

  -- All comments resolved → completed (requires at least one comment
  -- to ever have existed; an empty review never auto-completes).
  IF v_total > 0 AND v_open = 0 THEN
    UPDATE web_reviews
       SET status    = 'completed',
           closed_at = COALESCE(closed_at, NOW())
     WHERE id = NEW.review_id;
    RETURN NEW;
  END IF;

  -- Round had at least one resolution → bump open_for_review to
  -- editing_content. Reviews still in open_for_review with zero
  -- resolutions stay put.
  IF v_status = 'open_for_review' AND v_total > 0 AND v_open < v_total THEN
    UPDATE web_reviews
       SET status = 'editing_content'
     WHERE id = NEW.review_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_round_status ON web_review_comments;
CREATE TRIGGER trg_reconcile_round_status
  AFTER INSERT OR UPDATE OF status ON web_review_comments
  FOR EACH ROW EXECUTE FUNCTION reconcile_review_round_status();

COMMENT ON FUNCTION reconcile_review_round_status() IS
  'Auto-transitions web_reviews.status based on comment resolution count. open_for_review → editing_content on first resolve; editing_content → completed when every comment is resolved. Manual states (on_hold / no_status / completed) are never auto-changed.';
