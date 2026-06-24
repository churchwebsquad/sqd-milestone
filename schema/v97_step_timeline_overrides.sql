-- v97: step_timeline_overrides — staff override layer on the
-- per-project Planning workspace's step timeline. Lets the user
-- force a row's status independently of the auto-derived workflow
-- signals (phase, submitted milestones, cowork roadmap_state).
--
-- Shape: { "<row-key>": "done" | "active" | "upcoming" | "skipped" }
--   row-key examples:
--     "phase:content"
--     "milestone:3"           (web milestone step number)
--     "cowork:7"              (cowork step number 1-11)
--
-- Missing key = derive from auto signals. Empty object = no
-- overrides. Reversible per-row by deleting the key.
--
-- Additive nullable jsonb with default '{}'; dep audit from v94 shape
-- applies — no view/matview/FK references on this column.

ALTER TABLE public.strategy_web_projects
  ADD COLUMN IF NOT EXISTS step_timeline_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.strategy_web_projects.step_timeline_overrides IS
  'Staff override layer for the Planning workspace step timeline. Keyed by row identifier (phase:<phase>, milestone:<step>, cowork:<step>) → status. Missing key falls back to the auto-derived status from workflow signals.';
