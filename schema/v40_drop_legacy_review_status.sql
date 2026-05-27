-- v40 — Retire legacy 'open' / 'closed' review status values.
--
-- v39 added the 5-state board status (no_status / open_for_review /
-- editing_content / on_hold / completed) but kept the legacy values
-- valid in the CHECK constraint so existing readers + writers could
-- transition. Every writer has now switched (startReview → open_for_
-- review, closeReview/finalizeReview/setBoardStatus → completed),
-- and the loader normalizes legacy values on read.
--
-- This migration:
--   1. Backfills any remaining 'open'/'closed' rows into the new
--      vocabulary so no row sits in a state the new constraint would
--      reject.
--   2. Tightens the CHECK constraint to the 5-state vocabulary only.

UPDATE web_reviews
   SET status = 'open_for_review'
 WHERE status = 'open';

UPDATE web_reviews
   SET status = 'completed'
 WHERE status = 'closed';

ALTER TABLE web_reviews DROP CONSTRAINT IF EXISTS web_reviews_status_check;
ALTER TABLE web_reviews ADD CONSTRAINT web_reviews_status_check CHECK (
  status IN ('no_status', 'open_for_review', 'editing_content', 'on_hold', 'completed')
);
