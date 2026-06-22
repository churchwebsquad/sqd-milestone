-- v89 — Planning surface refocus around dev-hour allocation.
--
-- Context: with the content pipeline producing full-site copy in a
-- day and Brixies-driven design wrapping fast on top of that, dev is
-- the only phase that meaningfully consumes the launch budget. The
-- planning UI now treats dev hours as the primary unit and exposes
-- the velocity levers explicitly (Novamira AI tooling, dev edits
-- routed to a designer instead of dev, extra capacity from Ashley or
-- another helper).
--
-- All additions are additive + nullable-or-defaulted. No existing
-- column is altered or dropped. Dependency audit done before this
-- migration: 10 functions reference strategy_web_projects (all
-- query specific columns; none break on new columns); 2 triggers
-- (set_updated_at + crawl trigger) unaffected; no views, no matviews,
-- no policies blocking; FKs point at id only.
--
-- Note: phase_estimates / phase_progress / status_note columns stay
-- in place even though their UI is being retired. Dropping them
-- requires a separate audit and migration in a later round.

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS expected_page_count int,
  ADD COLUMN IF NOT EXISTS dev_hours_per_page numeric NOT NULL DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS uses_novamira boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dev_edits_route_to_designer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assist_hours_per_week_extra int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pre_dev_complete boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN strategy_web_projects.expected_page_count IS
  'Manual override for expected total pages. Used by hour math before web_pages is scaffolded. Null = fall back to web_pages count.';

COMMENT ON COLUMN strategy_web_projects.dev_hours_per_page IS
  'Per-project dev hours/page baseline. Team default 3.0; the Novamira-on target is 1.5. Edit per project when the partner buys hand-tuning or extra hardening.';

COMMENT ON COLUMN strategy_web_projects.uses_novamira IS
  'When true, hour math applies a 0.5 multiplier — Novamira-assisted dev runs roughly half the hours.';

COMMENT ON COLUMN strategy_web_projects.dev_edits_route_to_designer IS
  'When true, review-cycle edits land in the designer''s queue instead of the developer''s — reduces dev hours during the review phase.';

COMMENT ON COLUMN strategy_web_projects.assist_hours_per_week_extra IS
  'Extra hours/week of dev capacity for THIS project from a helper outside the team default 35h (e.g. Ashley assisting). Adds to the project''s usable cap without affecting other projects.';

COMMENT ON COLUMN strategy_web_projects.pre_dev_complete IS
  'Strategist flips this when intake + content + design phases are all done so the math knows it can attribute the full launch budget to dev. Replaces the per-phase budget/progress sliders.';
