-- v94: per-church help hours allocation + project manager notes.
--
-- help_hours_needed: per-church number of designer hours allocated to
-- this project. The launch scheduler distributes these across the
-- weeks the church is being worked on; they travel with the church
-- if its priority shifts. Replaces the prior org-wide-per-week
-- help model for behind-target recovery.
--
-- pm_notes: free-form project-manager notes surfaced on the per-
-- project planning workspace. Not status_reason — status_reason is
-- specifically about the manual_sub_status. PM notes are general
-- context (who's owning what, partner quirks, scope changes).
--
-- Both additive nullable. Dep audit confirmed no views/matviews/FKs
-- reference these columns. 9 functions and 2 triggers exist on the
-- table; none use SELECT * or column-position assumptions that would
-- break under ADD COLUMN.

ALTER TABLE public.strategy_web_projects
  ADD COLUMN IF NOT EXISTS help_hours_needed numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pm_notes text;

COMMENT ON COLUMN public.strategy_web_projects.help_hours_needed IS
  'Designer help hours allocated to this church. Launch scheduler distributes across the weeks the church is being worked on. Travels with the church across priority shifts.';

COMMENT ON COLUMN public.strategy_web_projects.pm_notes IS
  'Project manager free-form notes surfaced on the per-project Planning workspace.';
