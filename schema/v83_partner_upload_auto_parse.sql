-- v83 — Auto-fire the partner-upload parser on attachment insert.
--
-- Bug: partners uploading CSVs from the public Content Collection
-- page hit the upload helper at src/lib/contentCollectionAttachments.ts.
-- After successful storage upload + row insert, the helper fires the
-- parse endpoint via browser fetch():
--
--     fetch('/api/web/cowork/ingest-partner-upload', { ... })
--
-- The endpoint requires either a logged-in JWT or the server-only
-- INGEST_AUTH_TOKEN header. Public partner sessions use anon auth, so
-- the fetch lands without a valid token. The endpoint rejects (401).
-- The helper's catch block swallows the error silently. Result:
-- attachment row gets `parsed_at: NULL` and no atoms / facts ever
-- materialize from the upload.
--
-- Confirmed on Arvada Vineyard (member 3734): 3 partner-uploaded CSVs
-- (staff_board, small_groups, volunteers) sat unparsed since 2026-06-17.
-- Cowork drafted from atoms only, so all team bios + group lists +
-- volunteer roles were missing from the partner-facing copy.
--
-- Fix: a database-side trigger calls the parse endpoint via pg_net
-- with the server-side INGEST_AUTH_TOKEN. Runs as the postgres role
-- regardless of who inserted the attachment row, so anon-auth public
-- uploads also kick the parser. The browser-side fetch in the upload
-- helper remains in place as a redundant trigger (staff uploads will
-- still hit both paths; the endpoint's idempotency check via
-- `parsed_at` makes the double-fire safe).
--
-- ── Setup required after this migration applies ───────────────────
-- The token + endpoint URL must be populated once:
--
--   UPDATE partner_upload_ingest_config SET
--     endpoint_url = 'https://brand.thesqd.com/api/web/cowork/ingest-partner-upload',
--     ingest_token = '<value of INGEST_AUTH_TOKEN env var in Vercel>',
--     enabled      = true
--   WHERE id = 1;
--
-- Without that UPDATE the trigger is a no-op (enabled=false guards
-- against firing with placeholder credentials). The token MUST match
-- what's in Vercel's INGEST_AUTH_TOKEN env or the endpoint will 401
-- and the parse will silently fail again.

-- ── Config table (singleton row, id=1) ────────────────────────────
CREATE TABLE IF NOT EXISTS partner_upload_ingest_config (
  id            integer PRIMARY KEY DEFAULT 1,
  endpoint_url  text    NOT NULL DEFAULT 'https://brand.thesqd.com/api/web/cowork/ingest-partner-upload',
  ingest_token  text,
  enabled       boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton_only CHECK (id = 1)
);

INSERT INTO partner_upload_ingest_config (id, enabled) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE partner_upload_ingest_config IS
  'Singleton config for the partner-upload parse trigger. Set ingest_token + enabled=true to activate.';

-- ── Trigger function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_fire_partner_upload_ingest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cfg partner_upload_ingest_config;
BEGIN
  -- Only fire on NEW rows that haven't been parsed yet. The endpoint's
  -- own idempotency check (parsed_at != NULL → return cached result)
  -- backstops us, but skipping here saves a network round-trip.
  IF NEW.parsed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM partner_upload_ingest_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.ingest_token IS NULL OR cfg.ingest_token = '' THEN
    -- Config not populated yet — silent no-op. Strategist review UI
    -- still shows the unparsed row so nothing falls silently. The
    -- backfill function below can sweep these once the config lands.
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := cfg.endpoint_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-ingest-token',  cfg.ingest_token
    ),
    body    := jsonb_build_object('attachment_id', NEW.id::text, 'force', false)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the upload itself. If pg_net fails for any reason,
  -- the row still lands and the strategist review UI / manual
  -- backfill can recover.
  RAISE WARNING 'partner_upload_ingest trigger error for attachment %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ── Trigger binding ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS partner_upload_auto_parse ON strategy_content_collection_attachments;
CREATE TRIGGER partner_upload_auto_parse
  AFTER INSERT ON strategy_content_collection_attachments
  FOR EACH ROW
  EXECUTE FUNCTION trg_fire_partner_upload_ingest();

-- ── Backfill helper ───────────────────────────────────────────────
-- Sweeps all attachments with parsed_at IS NULL and fires the parser
-- for each. Call once after the trigger goes live to catch the
-- backlog (Arvada's 3 unparsed CSVs + anyone else's queue).
CREATE OR REPLACE FUNCTION partner_upload_ingest_backfill()
RETURNS TABLE(attachment_id uuid, session_id uuid, file_name text, fired boolean)
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
    SELECT id, session_id AS sid, file_name AS fname
    FROM strategy_content_collection_attachments
    WHERE parsed_at IS NULL
    ORDER BY uploaded_at ASC
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := cfg.endpoint_url,
        headers := jsonb_build_object(
          'Content-Type',   'application/json',
          'x-ingest-token', cfg.ingest_token
        ),
        body    := jsonb_build_object('attachment_id', rec.id::text, 'force', false)
      );
      attachment_id := rec.id; session_id := rec.sid; file_name := rec.fname; fired := true;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      attachment_id := rec.id; session_id := rec.sid; file_name := rec.fname; fired := false;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION partner_upload_ingest_backfill() TO authenticated;
COMMENT ON FUNCTION partner_upload_ingest_backfill() IS
  'One-shot sweep over unparsed partner upload attachments. Call after setting ingest_token + enabled=true.';
