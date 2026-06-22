-- v84 — Auto-parse web_intake_documents the same way v83 handles
-- strategy_content_collection_attachments.
--
-- Why v84 exists (separate from v83):
--
-- Partner content arrives via TWO paths into the system:
--
--   1. Public content-collection portal → strategy_content_collection_attachments
--      (handled by v83 — trigger fires ingest-partner-upload, which calls
--      parse-facts-csv for CSVs.)
--   2. Staff AM upload → web_intake_documents
--      (NOT handled by v83. Files go through normalize-intake's LLM
--      atomizer, which compresses lossily. Confirmed on Real Life
--      Church 3061: 113 KB content_collection.txt + 3 CSVs ingested into
--      96 atoms, dropping the 6 elder names + "About God's Word" belief
--      + structured staff bios. The partner sent the data; the LLM
--      "summarized" it into oblivion.)
--
-- Fix: every CSV in web_intake_documents (category='content_collection')
-- runs through parse-facts-csv via a database trigger, BEFORE
-- normalize-intake's LLM gets to compress it. Facts persist verbatim
-- in church_facts (one fact per row). The LLM atomizer still runs for
-- prose, but it can't drop the structured data because it's already
-- parsed deterministically.
--
-- ── Setup ─────────────────────────────────────────────────────────
-- This migration reuses partner_upload_ingest_config (created in v83).
-- The endpoint URL stays the same (ingest-partner-upload) — the
-- endpoint itself gets extended in a sibling code change to accept
-- intake_document_id alongside attachment_id.

-- ── Schema: parse-tracking columns ────────────────────────────────
ALTER TABLE web_intake_documents
  ADD COLUMN IF NOT EXISTS parsed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS parsed_destination text,
  ADD COLUMN IF NOT EXISTS parsed_rows_count  integer,
  ADD COLUMN IF NOT EXISTS parse_error        text;

COMMENT ON COLUMN web_intake_documents.parsed_at IS
  'Set by the ingest pipeline when the file has been parsed. NULL means queued.';
COMMENT ON COLUMN web_intake_documents.parsed_destination IS
  'Table the parsed content landed in (church_facts, content_atoms, etc.)';

-- ── Trigger function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fire_intake_document_ingest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cfg partner_upload_ingest_config;
BEGIN
  -- Only fire on freshly-uploaded content_collection-category files
  -- that haven't been parsed yet. Other categories (strategy_brief,
  -- brand_handoff, am_handoff_supplemental, etc.) go through their
  -- own normalize-intake flow and don't need fact extraction.
  IF NEW.parsed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.archived THEN
    RETURN NEW;
  END IF;
  IF NEW.category NOT IN ('content_collection', 'content_collection_supplemental') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM partner_upload_ingest_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.ingest_token IS NULL OR cfg.ingest_token = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := cfg.endpoint_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-ingest-token',  cfg.ingest_token
    ),
    body    := jsonb_build_object('intake_document_id', NEW.id::text, 'force', false)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'intake_document_ingest trigger error for document %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS intake_document_auto_parse ON web_intake_documents;
CREATE TRIGGER intake_document_auto_parse
  AFTER INSERT ON web_intake_documents
  FOR EACH ROW
  EXECUTE FUNCTION trg_fire_intake_document_ingest();

-- ── Backfill helper ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION intake_document_ingest_backfill()
RETURNS TABLE(out_document_id uuid, out_project_id uuid, out_filename text, out_fired boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cfg partner_upload_ingest_config;
  rec record;
BEGIN
  SELECT * INTO cfg FROM partner_upload_ingest_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.ingest_token IS NULL OR cfg.ingest_token = '' THEN
    RAISE EXCEPTION 'partner_upload_ingest_config not enabled or token missing — populate ingest_token + enabled=true first';
  END IF;

  FOR rec IN
    SELECT d.id, d.web_project_id, d.filename
    FROM web_intake_documents d
    WHERE d.parsed_at IS NULL
      AND d.archived = false
      AND d.category IN ('content_collection', 'content_collection_supplemental')
    ORDER BY d.uploaded_at ASC
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := cfg.endpoint_url,
        headers := jsonb_build_object(
          'Content-Type',   'application/json',
          'x-ingest-token', cfg.ingest_token
        ),
        body    := jsonb_build_object('intake_document_id', rec.id::text, 'force', false)
      );
      out_document_id := rec.id; out_project_id := rec.web_project_id;
      out_filename := rec.filename; out_fired := true;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      out_document_id := rec.id; out_project_id := rec.web_project_id;
      out_filename := rec.filename; out_fired := false;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION intake_document_ingest_backfill() TO authenticated;

-- ── Coverage audit function ───────────────────────────────────────
-- Surfaces "partner uploaded content that didn't reach atoms or facts"
-- so the strategist can verify nothing was silently dropped BEFORE
-- partner review. Returns one row per uploaded file with parse state
-- + downstream fact/atom counts. Run for any project:
--
--   SELECT * FROM partner_content_coverage_report(
--     '99a23de3-333e-4f3a-b46f-eb1cd0c1f62b'::uuid
--   );
CREATE OR REPLACE FUNCTION partner_content_coverage_report(p_project_id uuid)
RETURNS TABLE(
  source       text,
  id           uuid,
  filename     text,
  category     text,
  uploaded_at  timestamptz,
  parsed_at    timestamptz,
  parse_error  text,
  rows_parsed  integer,
  facts_count  bigint,
  status       text
)
LANGUAGE sql SECURITY DEFINER AS $$
  -- web_intake_documents (staff AM upload path)
  SELECT
    'intake_document'::text                          AS source,
    d.id,
    d.filename,
    d.category,
    d.uploaded_at,
    d.parsed_at,
    d.parse_error,
    d.parsed_rows_count                              AS rows_parsed,
    (SELECT count(*) FROM church_facts f
       WHERE f.data ->> 'source_intake_document_id' = d.id::text)
                                                     AS facts_count,
    CASE
      WHEN d.archived              THEN 'archived'
      WHEN d.parsed_at IS NULL     THEN 'queued'
      WHEN d.parse_error IS NOT NULL THEN 'error'
      WHEN d.parsed_rows_count = 0 THEN 'parsed_empty'
      ELSE 'parsed'
    END                                              AS status
  FROM web_intake_documents d
  WHERE d.web_project_id = p_project_id

  UNION ALL

  -- strategy_content_collection_attachments (public portal path)
  SELECT
    'cc_attachment'::text,
    a.id,
    a.file_name,
    a.kind,
    a.uploaded_at,
    a.parsed_at,
    a.parse_error,
    a.parsed_rows_count,
    (SELECT count(*) FROM church_facts f WHERE f.source_attachment_id = a.id),
    CASE
      WHEN a.parsed_at IS NULL       THEN 'queued'
      WHEN a.parse_error IS NOT NULL THEN 'error'
      WHEN a.parsed_rows_count = 0   THEN 'parsed_empty'
      ELSE 'parsed'
    END
  FROM strategy_content_collection_attachments a
  JOIN strategy_content_collection_sessions s ON s.id = a.session_id
  WHERE s.web_project_id = p_project_id
  ORDER BY uploaded_at DESC;
$$;

GRANT EXECUTE ON FUNCTION partner_content_coverage_report(uuid) TO authenticated;
COMMENT ON FUNCTION partner_content_coverage_report(uuid) IS
  'Cross-pipeline audit. Lists every partner-uploaded file across both ingest paths with parse + downstream coverage state. Run before partner review to catch silent drops.';
