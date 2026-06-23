-- v93 — Per-week base capacity override.
--
-- Until now each week's base capacity was hard-locked at the team
-- default (35h). For weeks where the dev is out part of the week
-- (one day off, half-day appointment, etc.) we needed a way to
-- knock the base down without blacking out the whole week or
-- conflating with extra help hours.
--
-- New column: base_capacity_override numeric NULLABLE.
--   null  → use the team default 35h
--   value → overrides the base; help_hours still stack on top,
--           is_blackout still zeros the whole week.

ALTER TABLE strategy_dev_weekly_allocations
  ADD COLUMN IF NOT EXISTS base_capacity_override numeric;

COMMENT ON COLUMN strategy_dev_weekly_allocations.base_capacity_override IS
  'Per-week override of the developer''s locked 35h base capacity. Null = use the team default 35h. Set when the dev is out part of the week without blacking out the whole week.';
