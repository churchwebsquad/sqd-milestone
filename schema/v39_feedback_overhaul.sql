-- v39 — Feedback overhaul foundation.
--
-- Adds the round-numbering + richer board status + per-comment metadata
-- the new Web Manager feedback UI relies on. Strictly additive: existing
-- legacy `'open'`/`'closed'` status values remain valid until a follow-up
-- v40 drops them once every writer has switched to the new vocabulary.
--
-- See ~/.claude/plans/moonlit-leaping-summit.md for the full context.

-- ── 1. Round numbering on web_reviews ──────────────────────────────────
-- Stored (not derived) so users can reference "Round 2" stably even after
-- deletes — and the loader doesn't need a window function on every read.

ALTER TABLE web_reviews ADD COLUMN round_number int;

UPDATE web_reviews SET round_number = sub.rn FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY web_project_id, kind ORDER BY started_at) AS rn
  FROM web_reviews
) sub WHERE web_reviews.id = sub.id;

ALTER TABLE web_reviews ALTER COLUMN round_number SET NOT NULL;

-- Auto-assign on insert via trigger. Uses MAX+1 (not COUNT+1) so deleting
-- a review doesn't compress the sequence — round 2 stays round 2 even
-- after round 1 is removed.
CREATE OR REPLACE FUNCTION assign_review_round_number() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.round_number IS NULL THEN
    NEW.round_number := COALESCE(
      (SELECT MAX(round_number) FROM web_reviews
       WHERE web_project_id = NEW.web_project_id AND kind = NEW.kind),
      0
    ) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_review_round_number ON web_reviews;
CREATE TRIGGER trg_assign_review_round_number
  BEFORE INSERT ON web_reviews
  FOR EACH ROW EXECUTE FUNCTION assign_review_round_number();

-- ── 2. Extend status enum ──────────────────────────────────────────────
-- 5 new values for the board-level UI: no_status, open_for_review,
-- editing_content, on_hold, completed. Legacy 'open'/'closed' remain valid
-- so we can ship the schema before every writer is updated; v40 will drop
-- them after the UI cutover.

ALTER TABLE web_reviews DROP CONSTRAINT IF EXISTS web_reviews_status_check;
ALTER TABLE web_reviews ADD CONSTRAINT web_reviews_status_check CHECK (
  status IN (
    'no_status', 'open_for_review', 'editing_content', 'on_hold', 'completed',
    'open', 'closed'
  )
);

-- ── 3. Per-comment additions ───────────────────────────────────────────
-- category: design vs content tagging from the card UI.
-- assignee_*: snapshot pattern (mirrors started_by_name) so the card
--   renders without a join.
-- due_at: card footer due-date.
-- resolved_by_name: snapshot of the resolver for the resolution banner.

ALTER TABLE web_review_comments
  ADD COLUMN category text CHECK (category IN ('design', 'content')),
  ADD COLUMN assignee_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN assignee_name text,
  ADD COLUMN assignee_email text,
  ADD COLUMN due_at timestamptz,
  ADD COLUMN resolved_by_name text;

COMMENT ON COLUMN web_review_comments.category IS
  'Strategist-applied tag: design or content. Drives card chip selection in the feedback board UI.';
COMMENT ON COLUMN web_review_comments.assignee_user_id IS
  'Staff member responsible for resolving this comment. Snapshotted in assignee_name/email so the card renders without a join.';
COMMENT ON COLUMN web_review_comments.due_at IS
  'Optional due date shown in the feedback card footer.';
COMMENT ON COLUMN web_review_comments.resolved_by_name IS
  'Display-name snapshot of resolved_by_user_id, populated when Apply/Amend/Dismiss fires. Avoids joins on render.';

COMMENT ON COLUMN web_reviews.round_number IS
  'Sequential round number within (web_project_id, kind). Auto-assigned by trigger; never reused after deletes.';
