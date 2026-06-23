-- v92 — Recovery mode default flips from 'designer' to 'dev-only'.
--
-- Per Ashley: new projects should default to the conservative
-- (developer-only, can't offload) posture. The PM explicitly opts
-- IN to designer-recoverable per project — that's the safer-by-
-- default model than the reverse.
--
-- Existing rows keep whatever value they already have; the PM can
-- toggle them via the recovery chip on the queue table.

ALTER TABLE strategy_web_projects
  ALTER COLUMN recovery_mode SET DEFAULT 'dev-only';
