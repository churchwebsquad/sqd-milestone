-- v22_announcement_linked_docs.sql
--
-- Lets a "What's New" announcement carry references to one or more
-- Library docs. Authors typically post a Progress update like
-- "We just shipped SOPs for the new Strategy OS app — here are the
-- new docs," and the popup needs a one-click way for the recipient to
-- jump straight to the library doc (where reading is already
-- auto-tracked via strategy_wiki_reads).
--
-- Storage: a jsonb column holding an array of `{ notion_id, title }`
-- objects. We denormalize the title at create time so the popup can
-- render `[Doc Title] →` buttons without an extra Notion / DocHub
-- fetch. Title drift after the fact is fine — the popup shows the
-- title that was current when the announcement was authored.
--
-- Empty array (default) means "no linked docs"; the popup just shows
-- the existing 'View initiative' + 'Got it' CTAs in that case.

ALTER TABLE strategy_announcements
  ADD COLUMN IF NOT EXISTS linked_docs jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Sanity-check constraint: linked_docs must be a JSON array. Doesn't
-- enforce per-element shape (would require a stricter schema check
-- that's not worth the complexity for v1) — the app sends the right
-- shape, and a malformed row just renders a broken button.
ALTER TABLE strategy_announcements
  DROP CONSTRAINT IF EXISTS strategy_announcements_linked_docs_is_array;
ALTER TABLE strategy_announcements
  ADD CONSTRAINT strategy_announcements_linked_docs_is_array
  CHECK (jsonb_typeof(linked_docs) = 'array');
