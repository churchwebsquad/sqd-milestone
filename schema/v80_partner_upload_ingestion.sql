-- v80 — Partner-upload ingestion provenance + parse metadata.
--
-- Closes the bug where partner-uploaded structured files (CSVs,
-- spreadsheets, docs) reach cowork as opaque `missing:<bucket>/<slug>`
-- markers instead of parsed rows. The new `ingest-partner-upload`
-- edge function fetches the file from Storage, parses by mime type,
-- and writes rows into church_facts (structured) or content_atoms
-- (prose). These columns let the ingestor record:
--   • on the attachment itself: parse status, destination, row count,
--     error if any
--   • on each produced row: a back-link to the attachment that
--     produced it, so the strategist review UI can group "rows from
--     this upload" together
--
-- The existing church_facts.confidence_score / approved_by /
-- approved_at and content_atoms.confidence / status columns already
-- cover row-level confidence + approval — no duplication added.
--
-- Dependency audit (2026-06-21): no views, no matviews, no FKs
-- pointing IN, only set_updated_at triggers (no row-shape coupling),
-- RLS policies are row-level (no column lists). Safe additive.

ALTER TABLE strategy_content_collection_attachments
  ADD COLUMN IF NOT EXISTS parsed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS parsed_destination  text,
  ADD COLUMN IF NOT EXISTS parsed_rows_count   integer,
  ADD COLUMN IF NOT EXISTS parse_error         text;

COMMENT ON COLUMN strategy_content_collection_attachments.parsed_at IS
  'When the ingest-partner-upload edge function last processed this attachment. Null = never parsed.';
COMMENT ON COLUMN strategy_content_collection_attachments.parsed_destination IS
  'Where the parser wrote: church_facts | content_atoms | failed | unsupported | rejected. NULL until parse runs.';
COMMENT ON COLUMN strategy_content_collection_attachments.parsed_rows_count IS
  'Number of rows produced by the parser. 0 for failed / unsupported / rejected.';
COMMENT ON COLUMN strategy_content_collection_attachments.parse_error IS
  'Reason the parse failed. Surfaces in the review UI so strategists can re-upload or hint columns.';

ALTER TABLE church_facts
  ADD COLUMN IF NOT EXISTS source_attachment_id uuid;
ALTER TABLE content_atoms
  ADD COLUMN IF NOT EXISTS source_attachment_id uuid;

COMMENT ON COLUMN church_facts.source_attachment_id IS
  'When this fact was extracted from a partner upload, the attachment id. Lets the review UI group rows by source.';
COMMENT ON COLUMN content_atoms.source_attachment_id IS
  'When this atom was extracted from a partner upload, the attachment id. Lets the review UI group atoms by source.';

-- Helpful indexes for the review UI (rows-by-attachment lookups).
CREATE INDEX IF NOT EXISTS church_facts_source_attachment_idx
  ON church_facts(source_attachment_id) WHERE source_attachment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_atoms_source_attachment_idx
  ON content_atoms(source_attachment_id) WHERE source_attachment_id IS NOT NULL;

-- And for the backfill job + review-pending queue.
CREATE INDEX IF NOT EXISTS attachments_parsed_at_idx
  ON strategy_content_collection_attachments(parsed_at);
