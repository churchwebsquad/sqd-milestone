-- v18_reply_folders.sql
--
-- Introduces a "folder" concept for partner replies. Each submission can
-- have at most one markup_review folder — a virtual row on
-- strategy_milestone_replies that aggregates all the individual markup.io
-- comments for that submission into a single row staff can triage in bulk.
--
-- Why: markup.io fires one webhook per comment. Staff were drowning in
-- 8–20 individual triage dropdowns per review. This lets them triage the
-- whole markup pass in one click while preserving each individual comment
-- as its own row (for the scheduled "new replies" automations that read
-- this table daily/weekly).
--
-- Scope: markup_review only. ClickUp thread replies stay individual — they
-- arrive one at a time with intentional context, different triage needs.
--
-- Implementation: two Postgres triggers on INSERT.
--   1. BEFORE INSERT: for any markup_review child reply, find-or-create
--      the folder and attach the child to it. Auto-set the child's
--      triage_category to 'no_action_needed' so the scheduled automations
--      don't double-count children alongside the folder.
--   2. AFTER INSERT: rebuild the folder's rollup text and shared_with_sqd
--      flag from its children. The folder's `reply_text` becomes a concise
--      summary "5 comments from markup.io" followed by each comment's
--      unwrapped text — so downstream consumers that read reply_text get
--      human-readable content, not raw markup.io JSON envelopes.
--
-- No backfill: existing rows keep their current (pre-folder) shape.

-- ── Schema ────────────────────────────────────────────────────────────────

ALTER TABLE strategy_milestone_replies
  ADD COLUMN IF NOT EXISTS is_folder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES strategy_milestone_replies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS strategy_milestone_replies_folder_id_idx
  ON strategy_milestone_replies(folder_id);

CREATE INDEX IF NOT EXISTS strategy_milestone_replies_folder_lookup_idx
  ON strategy_milestone_replies(submission_id, source)
  WHERE is_folder = true;

-- ── Helpers ───────────────────────────────────────────────────────────────

-- Unwrap the human-readable text from a markup.io JSON envelope. Mirrors
-- the client-side displayReplyText() so the folder rollup reads the same
-- way the reply cards do. Non-JSON input (ClickUp, plain text, empty)
-- passes through unchanged.
CREATE OR REPLACE FUNCTION markup_extract_text(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  trimmed text := btrim(COALESCE(raw, ''));
  extracted text;
BEGIN
  IF trimmed = '' OR substring(trimmed FROM 1 FOR 1) <> '{' THEN
    RETURN COALESCE(raw, '');
  END IF;
  BEGIN
    extracted := (trimmed::jsonb -> 'firstMessage' ->> 'text');
    IF extracted IS NOT NULL THEN
      RETURN extracted;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Malformed JSON — fall through to raw text.
    NULL;
  END;
  RETURN raw;
END;
$$;

-- ── Triggers ──────────────────────────────────────────────────────────────

-- BEFORE INSERT: when a markup_review reply is inserted without a folder,
-- find-or-create the folder for (submission, source='markup_review') and
-- attach the new row to it. Auto-set triage_category to 'no_action_needed'
-- so staff only triage the folder, not every individual child.
CREATE OR REPLACE FUNCTION reply_assign_to_folder() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_folder_id uuid;
BEGIN
  -- Skip folders themselves, non-markup sources, and already-attached children.
  IF NEW.is_folder OR NEW.source IS DISTINCT FROM 'markup_review' OR NEW.folder_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_folder_id
  FROM strategy_milestone_replies
  WHERE submission_id = NEW.submission_id
    AND source = 'markup_review'
    AND is_folder = true
  LIMIT 1;

  IF v_folder_id IS NULL THEN
    INSERT INTO strategy_milestone_replies (
      submission_id, source, is_folder, is_partner_reply,
      reply_text, reply_author_name, detected_at,
      shared_with_sqd, triage_category
    ) VALUES (
      NEW.submission_id, 'markup_review', true, true,
      '', 'markup.io', COALESCE(NEW.detected_at, now()),
      COALESCE(NEW.shared_with_sqd, false), NULL
    )
    RETURNING id INTO v_folder_id;
  END IF;

  NEW.folder_id := v_folder_id;
  NEW.triage_category := COALESCE(NEW.triage_category, 'no_action_needed');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reply_assign_to_folder_trigger ON strategy_milestone_replies;
CREATE TRIGGER reply_assign_to_folder_trigger
BEFORE INSERT ON strategy_milestone_replies
FOR EACH ROW EXECUTE FUNCTION reply_assign_to_folder();

-- AFTER INSERT: rebuild the folder's reply_text rollup and synchronize its
-- shared_with_sqd flag with its children. Re-runs on every child insert,
-- so the folder always reflects the latest state.
CREATE OR REPLACE FUNCTION reply_update_folder_rollup() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_child_count integer;
  v_shared boolean;
  v_child_body text;
  v_rollup text;
BEGIN
  IF NEW.folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    bool_or(shared_with_sqd),
    string_agg(
      '— ' || COALESCE(reply_author_name, 'Partner') || ': ' || markup_extract_text(reply_text),
      E'\n\n' ORDER BY detected_at
    )
  INTO v_child_count, v_shared, v_child_body
  FROM strategy_milestone_replies
  WHERE folder_id = NEW.folder_id;

  v_rollup := format(
    E'%s comment%s from markup.io\n\n%s',
    v_child_count,
    CASE WHEN v_child_count = 1 THEN '' ELSE 's' END,
    COALESCE(v_child_body, '')
  );

  UPDATE strategy_milestone_replies
  SET reply_text = v_rollup,
      shared_with_sqd = COALESCE(v_shared, false)
  WHERE id = NEW.folder_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reply_update_folder_rollup_trigger ON strategy_milestone_replies;
CREATE TRIGGER reply_update_folder_rollup_trigger
AFTER INSERT ON strategy_milestone_replies
FOR EACH ROW EXECUTE FUNCTION reply_update_folder_rollup();
