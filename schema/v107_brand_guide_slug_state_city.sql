-- v107 — state + city columns on strategy_brand_guides
--
-- Inputs to the slug-composition logic. When known, slug becomes
-- {state}/{base-slug} (e.g. tx/lakeway) so partner-facing URLs stay
-- clean even when two churches share a name. When unknown, we fall
-- back to flat slug behavior — no change for those partners.
--
-- Both nullable. Persisted (rather than parsed-on-the-fly each time)
-- so we can debug "why did this guide get a flat slug?" by inspecting
-- the row's slug_state column without re-running address parsing.
--
-- Existing rows keep NULL on both columns — their slug stays unchanged.
-- Only new guides (and explicit re-slug operations by staff) compose
-- with the prefix.

ALTER TABLE strategy_brand_guides
  ADD COLUMN IF NOT EXISTS slug_state text,
  ADD COLUMN IF NOT EXISTS slug_city  text;

COMMENT ON COLUMN strategy_brand_guides.slug_state IS
  'US state abbreviation (2 chars, lowercase) parsed from accounts.address at brand-guide creation. NULL when address was missing/unparseable. Drives the slug prefix when present.';
COMMENT ON COLUMN strategy_brand_guides.slug_city IS
  'City slug parsed from accounts.address at brand-guide creation. Used as a secondary disambiguator when the state-prefixed base slug collides with another guide.';
