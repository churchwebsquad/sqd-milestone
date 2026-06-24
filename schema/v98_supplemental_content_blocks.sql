-- v98: supplemental content form (the partner's "Page 2"). Stores
-- a list of rich-text blocks the partner can paste fresh content into
-- when their current site doesn't reflect where they're headed.
-- Structured at the outer level (kind, label) and free-form at the
-- inner level (markdown body) so downstream tools route blocks by
-- kind but consume the markdown as one ingestible unit.
--
-- Schema:
--   supplemental_blocks jsonb DEFAULT '[]'::jsonb NOT NULL
--     [{ kind: 'vision_prose' | 'who_we_are' | 'gospel_or_beliefs'
--             | 'ministry_outline' | 'rhythms_and_events'
--             | 'next_steps' | 'key_page_request' | 'references'
--             | 'notes_for_team',
--        label?: string,           // optional partner-set label
--        body_markdown: string,    // free-form rich text (markdown)
--        updated_at: string,
--        files?: string[] }]
--
--   supplemental_submitted_at timestamptz — when the partner sealed
--     this page (separate from the main session submitted_at since
--     this page may land before or after the main flow).
--
-- Dep audit: 2 functions and 2 triggers reference this table; none
-- use SELECT * or rely on column position. Safe additive change.

ALTER TABLE public.strategy_content_collection_sessions
  ADD COLUMN IF NOT EXISTS supplemental_blocks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS supplemental_submitted_at  timestamptz;

COMMENT ON COLUMN public.strategy_content_collection_sessions.supplemental_blocks IS
  'Partner-supplied rich-text blocks for the supplemental content page (Page 2). Each block carries a kind for downstream routing + markdown body for the actual content.';
COMMENT ON COLUMN public.strategy_content_collection_sessions.supplemental_submitted_at IS
  'When the partner sealed the supplemental page. Separate from session.submitted_at because the supplemental page can be filled before or after the main flow.';
