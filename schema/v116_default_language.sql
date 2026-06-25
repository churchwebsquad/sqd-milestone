-- v116 — site language detection
--
-- Some partner churches publish entirely (or partially) in Spanish.
-- We can't help them with copywriting — they speak it, we don't —
-- but we CAN still help them organize and redesign the site. This
-- column captures the detected language so downstream gates know
-- when to skip rewrite-y workflows and stick to verbatim only.
--
-- Single-campus projects: `default_language` reflects the whole site.
-- Multi-campus projects: `default_language` is the primary campus's
-- language; per-campus overrides live in `campuses[].language`
-- (additive jsonb field, no migration needed — see the v113 schema).
-- Example: Doxology has Southwest + Alliance in 'en', Espanol in 'es'.
--
-- Values: ISO 639-1 lowercase 2-letter codes (en, es, pt, ...). NULL
-- means "not yet detected" — categorize will fill it on next run.

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS default_language text DEFAULT 'en';

COMMENT ON COLUMN strategy_web_projects.default_language IS
  'ISO 639-1 language code detected from the crawl markdown. Drives verbatim-only gates downstream (no rewrites for non-English sites). Multi-campus projects also carry per-campus overrides in campuses[].language.';
