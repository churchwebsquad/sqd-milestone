-- v101 — Notion source tracking on web_intake_documents
--
-- Lets a row in web_intake_documents be linked back to a Notion page so
-- the Strategy Brief / Content Strategy can sync from a Notion documents
-- database instead of (or alongside) staff/partner uploads.
--
-- All columns are nullable — uploads continue to work unchanged. Only
-- rows synced from Notion carry the metadata.
--
-- The trigger trg_fire_intake_document_ingest only fires for
-- content_collection / content_collection_supplemental categories, so
-- Notion-sourced strategy_brief / content_strategy rows do NOT trigger
-- the ingest webhook. Verified before apply.

ALTER TABLE web_intake_documents
  ADD COLUMN IF NOT EXISTS notion_page_id       text,
  ADD COLUMN IF NOT EXISTS notion_database_id   text,
  ADD COLUMN IF NOT EXISTS notion_synced_at     timestamptz,
  ADD COLUMN IF NOT EXISTS notion_last_edited_at timestamptz;

-- Look-up index — sync job dedupes by (project, page) before writing.
CREATE UNIQUE INDEX IF NOT EXISTS web_intake_documents_notion_page_idx
  ON web_intake_documents (web_project_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;

COMMENT ON COLUMN web_intake_documents.notion_page_id IS
  'Notion page UUID the row was synced from. NULL = uploaded by staff/partner.';
COMMENT ON COLUMN web_intake_documents.notion_database_id IS
  'Notion database UUID the page belongs to. Lets us scope future syncs.';
COMMENT ON COLUMN web_intake_documents.notion_synced_at IS
  'When this row was last refreshed from Notion. Used to decide whether to re-pull on subsequent syncs.';
COMMENT ON COLUMN web_intake_documents.notion_last_edited_at IS
  'Notion page.last_edited_time at the moment of the last sync. Used to skip pages that have not changed.';
