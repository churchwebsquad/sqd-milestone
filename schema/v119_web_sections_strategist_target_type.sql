-- v119 — strategist annotation for per-section target type.
--
-- The formation plan analyzer (src/lib/acfFormationPlan) can usually
-- infer where items in a section "land" (individual detail page vs
-- flat list vs external embed) from section_role + the partner's
-- content-collection display_preference. But same-role sections can
-- diverge: on a /staff page, "Pastoral Staff" gets individual detail
-- pages while "Program & Support Staff" stays flat. The strategist
-- knows this; the template alone doesn't.
--
-- This column lets the strategist annotate per section. Null = let
-- the analyzer infer (current behaviour). Non-null overrides.
--
-- Dependency audit done BEFORE applying:
--   - Triggers on web_sections: web_sections_set_updated_at — safe
--     (fires on UPDATE only; ADD COLUMN doesn't fire it).
--   - Views referencing web_sections: none in information_schema.
--   - Functions referencing strategist_target_type: none (new column).
--   - Foreign keys pointing at web_sections: unaffected.
--   - RLS policies on web_sections: unchanged (column inherits the
--     table's existing row-level access).

ALTER TABLE web_sections
  ADD COLUMN IF NOT EXISTS strategist_target_type text;

COMMENT ON COLUMN web_sections.strategist_target_type IS
  'Strategist-set "where do items in this section land" hint, overrides the formation plan analyzer''s inferred target_hint. Values: individual-page | flat-list | embed | external | mailto. Null = let the analyzer infer.';
