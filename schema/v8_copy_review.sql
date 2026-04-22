-- ============================================================================
-- v8_copy_review.sql
-- Copy Review feature — a partner-facing surface (separate from the milestone
-- progress portal) for reviewing website copy section-by-section with
-- approve/request-edits decisions and comments.
--
-- Four tables:
--   strategy_copy_reviews           one uploaded review per partner round
--   strategy_copy_review_decisions  approve/edit-request per block
--   strategy_copy_review_comments   threaded comments per block (partner+staff)
--   strategy_copy_review_edits      optional proposed-text replacements
--
-- Partner writes go through SECURITY DEFINER RPCs that validate the portal
-- token; staff reads/writes use the standard auth.uid() IS NOT NULL RLS.
-- ============================================================================

-- ── Main review table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_copy_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member         integer NOT NULL,
  title          text NOT NULL,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'open', 'submitted', 'finalized')),
  source_html    text NOT NULL,
  parsed         jsonb NOT NULL,
  submitted_at   timestamptz,
  finalized_at   timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_copy_reviews IS 'One uploaded website-copy review per partner round. Status gates partner access (draft=hidden, open=partner can review, submitted=partner clicked submit, finalized=staff marked complete).';
COMMENT ON COLUMN strategy_copy_reviews.member IS 'Business key matching strategy_account_progress.member';
COMMENT ON COLUMN strategy_copy_reviews.source_html IS 'Raw Notion export HTML — kept for archival/reparse';
COMMENT ON COLUMN strategy_copy_reviews.parsed IS 'Clean tree: {title, pages:[{id,label,url,emoji,sections:[{id,label,blocks:[{id,kind,label,text}]}]}]}';

CREATE OR REPLACE FUNCTION update_strategy_copy_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_copy_reviews_updated_at
  BEFORE UPDATE ON strategy_copy_reviews
  FOR EACH ROW EXECUTE FUNCTION update_strategy_copy_reviews_updated_at();

CREATE INDEX IF NOT EXISTS idx_strategy_copy_reviews_member
  ON strategy_copy_reviews (member);
CREATE INDEX IF NOT EXISTS idx_strategy_copy_reviews_status
  ON strategy_copy_reviews (status);

-- ── Decisions table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_copy_review_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid NOT NULL REFERENCES strategy_copy_reviews(id) ON DELETE CASCADE,
  block_id    text NOT NULL,
  decision    text NOT NULL CHECK (decision IN ('approved', 'edit_requested')),
  decided_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, block_id)
);

COMMENT ON TABLE strategy_copy_review_decisions IS 'One standing decision per (review, block). Upserted by partner actions.';
COMMENT ON COLUMN strategy_copy_review_decisions.block_id IS 'Notion <p id="…"> UUID from the parsed tree. Section-level decisions use the H3 block id.';

CREATE INDEX IF NOT EXISTS idx_strategy_copy_review_decisions_review
  ON strategy_copy_review_decisions (review_id);

-- ── Comments table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_copy_review_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id      uuid NOT NULL REFERENCES strategy_copy_reviews(id) ON DELETE CASCADE,
  block_id       text NOT NULL,
  author_kind    text NOT NULL CHECK (author_kind IN ('partner', 'staff')),
  author_name    text,
  author_uid     uuid,
  body           text NOT NULL,
  resolved       boolean NOT NULL DEFAULT false,
  client_id      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_copy_review_comments IS 'Threaded comments per block. Partner comments carry client_id so partner can edit/delete without an account.';

CREATE OR REPLACE FUNCTION update_strategy_copy_review_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_copy_review_comments_updated_at
  BEFORE UPDATE ON strategy_copy_review_comments
  FOR EACH ROW EXECUTE FUNCTION update_strategy_copy_review_comments_updated_at();

CREATE INDEX IF NOT EXISTS idx_strategy_copy_review_comments_review
  ON strategy_copy_review_comments (review_id);
CREATE INDEX IF NOT EXISTS idx_strategy_copy_review_comments_block
  ON strategy_copy_review_comments (review_id, block_id);

-- ── Edits table (schema only — partner UI deferred) ─────────────────────────

CREATE TABLE IF NOT EXISTS strategy_copy_review_edits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id      uuid NOT NULL REFERENCES strategy_copy_reviews(id) ON DELETE CASCADE,
  block_id       text NOT NULL,
  proposed_text  text NOT NULL,
  author_kind    text NOT NULL CHECK (author_kind IN ('partner', 'staff')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, block_id)
);

COMMENT ON TABLE strategy_copy_review_edits IS 'Proposed replacement text per block. Latest proposal wins (unique constraint). Staff copies into production CMS — not auto-applied.';

CREATE INDEX IF NOT EXISTS idx_strategy_copy_review_edits_review
  ON strategy_copy_review_edits (review_id);

-- ── RLS — staff access ──────────────────────────────────────────────────────

ALTER TABLE strategy_copy_reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_copy_review_decisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_copy_review_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_copy_review_edits       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read copy reviews"
  ON strategy_copy_reviews FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can insert copy reviews"
  ON strategy_copy_reviews FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update copy reviews"
  ON strategy_copy_reviews FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can read copy review decisions"
  ON strategy_copy_review_decisions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can insert copy review decisions"
  ON strategy_copy_review_decisions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update copy review decisions"
  ON strategy_copy_review_decisions FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can read copy review comments"
  ON strategy_copy_review_comments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can insert copy review comments"
  ON strategy_copy_review_comments FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update copy review comments"
  ON strategy_copy_review_comments FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete copy review comments"
  ON strategy_copy_review_comments FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can read copy review edits"
  ON strategy_copy_review_edits FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can insert copy review edits"
  ON strategy_copy_review_edits FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update copy review edits"
  ON strategy_copy_review_edits FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── Partner-facing RPCs (SECURITY DEFINER, token-gated) ─────────────────────

-- Resolve portal_token → member. Returns NULL when token is invalid.
CREATE OR REPLACE FUNCTION copy_review_member_for_token(p_token uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT member
  FROM strategy_account_progress
  WHERE portal_token = p_token
  LIMIT 1;
$$;

-- Load the latest open/submitted review for a partner token, with decisions + comments.
CREATE OR REPLACE FUNCTION get_copy_review_by_token(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member   integer;
  v_review   strategy_copy_reviews%ROWTYPE;
  v_result   jsonb;
BEGIN
  v_member := copy_review_member_for_token(p_token);
  IF v_member IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_review
  FROM strategy_copy_reviews
  WHERE member = v_member
    AND status IN ('open', 'submitted')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_review.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_result := jsonb_build_object(
    'review', jsonb_build_object(
      'id',           v_review.id,
      'member',       v_review.member,
      'title',        v_review.title,
      'status',       v_review.status,
      'parsed',       v_review.parsed,
      'submitted_at', v_review.submitted_at,
      'finalized_at', v_review.finalized_at,
      'created_at',   v_review.created_at
    ),
    'decisions', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'block_id',  d.block_id,
        'decision',  d.decision,
        'decided_at', d.decided_at
      )) FROM strategy_copy_review_decisions d WHERE d.review_id = v_review.id),
      '[]'::jsonb
    ),
    'comments', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id',          c.id,
        'block_id',    c.block_id,
        'author_kind', c.author_kind,
        'author_name', c.author_name,
        'body',        c.body,
        'resolved',    c.resolved,
        'client_id',   c.client_id,
        'created_at',  c.created_at,
        'updated_at',  c.updated_at
      ) ORDER BY c.created_at ASC) FROM strategy_copy_review_comments c WHERE c.review_id = v_review.id),
      '[]'::jsonb
    )
  );

  RETURN v_result;
END;
$$;

-- Upsert a partner decision. Returns true on success, false if token/review mismatch.
CREATE OR REPLACE FUNCTION upsert_copy_review_decision(
  p_token     uuid,
  p_review_id uuid,
  p_block_id  text,
  p_decision  text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member         integer;
  v_review_member  integer;
  v_review_status  text;
BEGIN
  IF p_decision NOT IN ('approved', 'edit_requested') THEN
    RETURN false;
  END IF;

  v_member := copy_review_member_for_token(p_token);
  IF v_member IS NULL THEN
    RETURN false;
  END IF;

  SELECT member, status INTO v_review_member, v_review_status
  FROM strategy_copy_reviews WHERE id = p_review_id;

  IF v_review_member IS NULL OR v_review_member <> v_member THEN
    RETURN false;
  END IF;
  IF v_review_status NOT IN ('open', 'submitted') THEN
    RETURN false;
  END IF;

  INSERT INTO strategy_copy_review_decisions (review_id, block_id, decision)
  VALUES (p_review_id, p_block_id, p_decision)
  ON CONFLICT (review_id, block_id)
  DO UPDATE SET decision = EXCLUDED.decision, decided_at = now();

  RETURN true;
END;
$$;

-- Insert a partner comment. Returns the new comment id (or NULL on failure).
CREATE OR REPLACE FUNCTION insert_copy_review_comment(
  p_token       uuid,
  p_review_id   uuid,
  p_block_id    text,
  p_body        text,
  p_author_name text,
  p_client_id   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member         integer;
  v_review_member  integer;
  v_review_status  text;
  v_new_id         uuid;
BEGIN
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RETURN NULL;
  END IF;

  v_member := copy_review_member_for_token(p_token);
  IF v_member IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT member, status INTO v_review_member, v_review_status
  FROM strategy_copy_reviews WHERE id = p_review_id;

  IF v_review_member IS NULL OR v_review_member <> v_member THEN
    RETURN NULL;
  END IF;
  IF v_review_status NOT IN ('open', 'submitted') THEN
    RETURN NULL;
  END IF;

  INSERT INTO strategy_copy_review_comments
    (review_id, block_id, author_kind, author_name, body, client_id)
  VALUES
    (p_review_id, p_block_id, 'partner', NULLIF(btrim(p_author_name), ''), p_body, NULLIF(p_client_id, ''))
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- Update a partner comment (only if client_id matches).
CREATE OR REPLACE FUNCTION update_copy_review_comment(
  p_token      uuid,
  p_comment_id uuid,
  p_client_id  text,
  p_body       text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member         integer;
  v_review_member  integer;
  v_comment_client text;
  v_rows           integer;
BEGIN
  IF p_body IS NULL OR btrim(p_body) = '' OR p_client_id IS NULL OR p_client_id = '' THEN
    RETURN false;
  END IF;

  v_member := copy_review_member_for_token(p_token);
  IF v_member IS NULL THEN
    RETURN false;
  END IF;

  SELECT r.member, c.client_id INTO v_review_member, v_comment_client
  FROM strategy_copy_review_comments c
  JOIN strategy_copy_reviews r ON r.id = c.review_id
  WHERE c.id = p_comment_id;

  IF v_review_member IS NULL OR v_review_member <> v_member THEN
    RETURN false;
  END IF;
  IF v_comment_client IS NULL OR v_comment_client <> p_client_id THEN
    RETURN false;
  END IF;

  UPDATE strategy_copy_review_comments
  SET body = p_body
  WHERE id = p_comment_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- Delete a partner comment (only if client_id matches).
CREATE OR REPLACE FUNCTION delete_copy_review_comment(
  p_token      uuid,
  p_comment_id uuid,
  p_client_id  text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member         integer;
  v_review_member  integer;
  v_comment_client text;
  v_rows           integer;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN
    RETURN false;
  END IF;

  v_member := copy_review_member_for_token(p_token);
  IF v_member IS NULL THEN
    RETURN false;
  END IF;

  SELECT r.member, c.client_id INTO v_review_member, v_comment_client
  FROM strategy_copy_review_comments c
  JOIN strategy_copy_reviews r ON r.id = c.review_id
  WHERE c.id = p_comment_id;

  IF v_review_member IS NULL OR v_review_member <> v_member THEN
    RETURN false;
  END IF;
  IF v_comment_client IS NULL OR v_comment_client <> p_client_id THEN
    RETURN false;
  END IF;

  DELETE FROM strategy_copy_review_comments WHERE id = p_comment_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- Partner submits the review (open → submitted).
CREATE OR REPLACE FUNCTION submit_copy_review(
  p_token     uuid,
  p_review_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member         integer;
  v_review_member  integer;
  v_review_status  text;
BEGIN
  v_member := copy_review_member_for_token(p_token);
  IF v_member IS NULL THEN
    RETURN false;
  END IF;

  SELECT member, status INTO v_review_member, v_review_status
  FROM strategy_copy_reviews WHERE id = p_review_id;

  IF v_review_member IS NULL OR v_review_member <> v_member THEN
    RETURN false;
  END IF;
  IF v_review_status NOT IN ('open', 'submitted') THEN
    RETURN false;
  END IF;

  UPDATE strategy_copy_reviews
  SET status = 'submitted', submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_review_id;

  RETURN true;
END;
$$;

-- Grant EXECUTE on partner RPCs to anon (token is the gate).
GRANT EXECUTE ON FUNCTION copy_review_member_for_token(uuid)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_copy_review_by_token(uuid)                           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_copy_review_decision(uuid, uuid, text, text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION insert_copy_review_comment(uuid, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_copy_review_comment(uuid, uuid, text, text)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_copy_review_comment(uuid, uuid, text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_copy_review(uuid, uuid)                           TO anon, authenticated;
