-- v109 — proposed_metadata jsonb on strategy_content_collection_marks
--
-- Mountain Life's session surfaced a recurring pattern: partners
-- accumulate "missing program" entries that are actually CTAs (a
-- form / sign-up / RSVP URL with a short invitation paragraph) or
-- raw tool URLs (Church Center directory, Subsplash player, etc.).
-- Today they all collapse into target_kind='missing_program' with
-- a plain-text proposed_program_description — strategists have to
-- read the body to interpret what shape the content actually is.
--
-- This adds a single nullable jsonb column for the new add-flow to
-- write structured intent next to the existing fields. Old rows
-- keep NULL on the new column → no behavior change for existing
-- readers. New readers can opt in by reading proposed_metadata
-- when it's populated.
--
-- Expected shape examples (validated client-side, not enforced by
-- the DB so we don't lock future expansion):
--   {"kind": "cta", "url": "https://...", "tool": "church_center",
--    "language": null}
--   {"kind": "tool_url", "url": "https://...", "tool": "planning_center"}
--   (future) {"kind": "language_variant", "of": "...", "language": "es"}

ALTER TABLE strategy_content_collection_marks
  ADD COLUMN IF NOT EXISTS proposed_metadata jsonb;

COMMENT ON COLUMN strategy_content_collection_marks.proposed_metadata IS
  'Structured intent for partner-added entries. NULL = legacy or program-shaped add. {kind:"cta", url, tool, language?} for first-class CTAs. Schema is intentionally open so we can extend without migrations.';
