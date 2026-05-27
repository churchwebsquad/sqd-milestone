-- v42 — Auto-tag suggested/requested comments as 'content'.
--
-- When feedback proposes a new text value (kind ∈ suggested, requested),
-- it's a content change by definition. The new FeedbackCard renders
-- a category chip; if it's null the strategist has to manually click
-- "+ Content" every time. This BEFORE INSERT trigger sets the default
-- so suggestions / requests pre-categorize.
--
-- Doesn't override an explicit user choice — only fills NULL.
-- Doesn't touch 'comment'-kind rows (those are plain notes — could be
-- design or content; user decides).

CREATE OR REPLACE FUNCTION default_review_comment_category() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IS NULL
     AND NEW.kind IN ('suggested', 'requested') THEN
    NEW.category := 'content';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_review_comment_category ON web_review_comments;
CREATE TRIGGER trg_default_review_comment_category
  BEFORE INSERT ON web_review_comments
  FOR EACH ROW EXECUTE FUNCTION default_review_comment_category();

-- Backfill any existing suggested/requested rows that ended up null
-- (the new column landed in v39 with no default, and rows created
-- between v39 and v42 wouldn't have been tagged).
UPDATE web_review_comments
   SET category = 'content'
 WHERE category IS NULL
   AND kind IN ('suggested', 'requested');

COMMENT ON FUNCTION default_review_comment_category() IS
  'BEFORE INSERT default: tags suggested/requested comments as content automatically. Plain-kind comments are left to the user since they can be either design or content.';
