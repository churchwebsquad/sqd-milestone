-- v53_content_collection.sql
--
-- Partner-facing Content Collection: a structured workflow where the
-- partner (1) reviews the crawl inventory (Page 2) and (2) answers
-- form questions about managing their website + launch logistics
-- (Page 1). Lives at /portal/:token/hub/content-collection/:sessionId.
--
-- Two tables:
--   strategy_content_collection_sessions — one per project + run.
--     Holds session metadata (due date, status), Page 1 form responses
--     (events/sermons/groups display prefs, domain + hosting), and an
--     `inventory_snapshot` jsonb frozen at session start so the
--     partner's marks don't dangle if the crawl re-runs mid-review.
--
--   strategy_content_collection_marks — per-target review marks.
--     Tracks 3-state status (approved / outdated / approved_keep_as_is)
--     + the partner's update text when 'outdated'. A `do_not_rewrite`
--     generated column derives directly from status='approved_keep_as_is'
--     so the copywriter AI can filter to "skip these" with a single
--     boolean check downstream.
--
-- RLS: signed-in staff have full read/write. The partner-facing surface
-- writes via service_role from an edge function that gates on portal
-- token, so RLS stays staff-only here.

BEGIN;

-- ── Sessions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_content_collection_sessions (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id                    uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  member                            integer NOT NULL,

  status                            text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'submitted', 'closed')),
  due_at                            timestamptz,

  -- Frozen at session start so partner marks don't dangle if a re-crawl
  -- changes the topic structure mid-review.
  inventory_snapshot                jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── Page 1: Managing Your New Website ────────────────────────────
  -- Events
  events_display_preference         text CHECK (events_display_preference IN (
    'external', 'embed', 'wordpress', 'none'
  )),
  events_external_url               text,
  events_wordpress_source_of_truth  text,
  events_wordpress_frustration      text,
  events_wordpress_recurring_needed text,
  -- Sermons
  sermons_display_preference        text CHECK (sermons_display_preference IN (
    'external', 'wordpress'
  )),
  sermons_external_url              text,
  -- Small Groups
  groups_display_preference         text CHECK (groups_display_preference IN (
    'external', 'embed', 'wordpress', 'contact'
  )),
  groups_external_url               text,
  groups_wordpress_source_of_truth  text,
  groups_wordpress_frustration      text,
  -- Misc
  ministries_to_grow                text,
  high_maintenance_pages_context    text,
  additional_context                text,

  -- ── Page 1: Preparing For Launch ─────────────────────────────────
  domain_registrar_url              text,
  domain_credential_method          text CHECK (domain_credential_method IN (
    'invite_admin', 'one_password'
  )),
  domain_invite_confirmed           boolean NOT NULL DEFAULT false,
  domain_one_password_invite_url    text,
  hosting_approved                  boolean NOT NULL DEFAULT false,

  -- ── Lifecycle ────────────────────────────────────────────────────
  requested_by_employee_id          uuid,
  submitted_at                      timestamptz,
  closed_at                         timestamptz,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccs_project       ON strategy_content_collection_sessions(web_project_id);
CREATE INDEX IF NOT EXISTS idx_ccs_member        ON strategy_content_collection_sessions(member);
CREATE INDEX IF NOT EXISTS idx_ccs_status        ON strategy_content_collection_sessions(status);

CREATE OR REPLACE FUNCTION strategy_ccs_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ccs_touch_updated_at ON strategy_content_collection_sessions;
CREATE TRIGGER trg_ccs_touch_updated_at
  BEFORE UPDATE ON strategy_content_collection_sessions
  FOR EACH ROW EXECUTE FUNCTION strategy_ccs_touch_updated_at();

-- ── Marks ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_content_collection_marks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES strategy_content_collection_sessions(id) ON DELETE CASCADE,

  -- What the mark targets. Path is a logical pointer into the inventory
  -- snapshot, e.g. 'giving/program:90 Day Tithe Challenge' or
  -- 'missions/passage:7' or 'kids/topic-level-item:faq:3'.
  target_kind   text NOT NULL CHECK (target_kind IN (
    'topic', 'program', 'topic_item', 'missing_program'
  )),
  target_path   text NOT NULL,

  -- 3-state status + a derived flag so downstream (copywriter AI) can
  -- filter "leave this alone" content with a single boolean check.
  status        text NOT NULL CHECK (status IN (
    'approved', 'outdated', 'approved_keep_as_is'
  )),
  client_note   text,
  do_not_rewrite boolean GENERATED ALWAYS AS (status = 'approved_keep_as_is') STORED,

  -- For 'missing_program' marks: the partner-supplied new program name.
  proposed_program_name text,
  proposed_program_description text,

  marked_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, target_path)
);

CREATE INDEX IF NOT EXISTS idx_ccm_session     ON strategy_content_collection_marks(session_id);
CREATE INDEX IF NOT EXISTS idx_ccm_skip_rewrite ON strategy_content_collection_marks(session_id) WHERE do_not_rewrite = true;

-- ── RLS ──────────────────────────────────────────────────────────────

ALTER TABLE strategy_content_collection_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_content_collection_marks    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ccs_staff_all ON strategy_content_collection_sessions;
CREATE POLICY ccs_staff_all ON strategy_content_collection_sessions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ccm_staff_all ON strategy_content_collection_marks;
CREATE POLICY ccm_staff_all ON strategy_content_collection_marks
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMIT;
