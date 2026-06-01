-- v43: Auto-trigger Firecrawl on church redesign signal.
--
-- Two signals fire a one-time crawl per web project:
--   1. `strategy_account_progress.website_needs_discovery_questionnaire`
--      contains a redesign phrase ("Start Fresh", "Make Significant
--      Changes", legacy "We would like a new website", "Redesign:").
--   2. `strategy_account_progress.handoff_web_form.form.selectedPathways`
--      contains "redesign" (or "audit"/"microsite" when toggled on
--      from the WM Settings tab).
--
-- Idempotency: `web_crawl_intent` has UNIQUE(web_project_id) so a
-- second trigger pulse on the same project is a no-op. Crawl results
-- continue to land in `web-hub.crawl_jobs` (existing table, untouched).

-- ── Per-org toggles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_crawl_config (
  id                int PRIMARY KEY DEFAULT 1,
  fire_on_redesign  boolean NOT NULL DEFAULT true,
  fire_on_audit     boolean NOT NULL DEFAULT false,
  fire_on_microsite boolean NOT NULL DEFAULT false,
  max_pages         int     NOT NULL DEFAULT 50,
  edge_fn_url       text    NOT NULL DEFAULT 'https://wttgwoxlezqoyzmesekt.supabase.co/functions/v1/fire-crawl-trigger',
  updated_at        timestamptz DEFAULT now(),
  updated_by        text,
  CONSTRAINT web_crawl_config_singleton CHECK (id = 1)
);
INSERT INTO web_crawl_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Anyone authenticated can read; only authenticated can update. Locked
-- to the singleton row so the toggle can't be replaced or deleted.
ALTER TABLE web_crawl_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS web_crawl_config_read ON web_crawl_config;
CREATE POLICY web_crawl_config_read ON web_crawl_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS web_crawl_config_write ON web_crawl_config;
CREATE POLICY web_crawl_config_write ON web_crawl_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── Intent records (one per project, idempotency lock) ───────────────
CREATE TABLE IF NOT EXISTS web_crawl_intent (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id       uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  member               integer NOT NULL,
  target_url           text NOT NULL,
  triggered_by         text NOT NULL CHECK (triggered_by IN ('discovery','am_handoff','manual')),
  trigger_value        text,
  triggered_at         timestamptz DEFAULT now(),
  fired_at             timestamptz,
  fire_response_status int,
  fire_response_body   text,
  CONSTRAINT one_intent_per_project UNIQUE (web_project_id)
);
CREATE INDEX IF NOT EXISTS web_crawl_intent_member_idx ON web_crawl_intent(member);

ALTER TABLE web_crawl_intent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS web_crawl_intent_read ON web_crawl_intent;
CREATE POLICY web_crawl_intent_read ON web_crawl_intent FOR SELECT TO authenticated USING (true);

-- ── Signal evaluator ──────────────────────────────────────────────────
-- Returns true when the strategy_account_progress row's signals + the
-- toggles say we should fire for this member. Pure read; trigger
-- functions call it to decide.
CREATE OR REPLACE FUNCTION web_crawl_should_fire(
  cfg  web_crawl_config,
  prog strategy_account_progress,
  OUT  fired_kind text,
  OUT  fired_value text
) AS $$
DECLARE
  discovery_text text := prog.website_needs_discovery_questionnaire;
  pathways jsonb := prog.handoff_web_form -> 'form' -> 'selectedPathways';
BEGIN
  -- Discovery path — only when fire_on_redesign is enabled.
  IF cfg.fire_on_redesign AND discovery_text IS NOT NULL AND length(trim(discovery_text)) > 0 THEN
    IF discovery_text ILIKE 'Start Fresh:%'
       OR discovery_text ILIKE 'Make Significant Changes%'
       OR discovery_text ILIKE 'We would like a new website%'
       OR discovery_text ILIKE 'Redesign:%' THEN
      fired_kind  := 'discovery';
      fired_value := discovery_text;
      RETURN;
    END IF;
  END IF;

  -- AM handoff path — array under handoff_web_form.form.selectedPathways.
  IF pathways IS NOT NULL AND jsonb_typeof(pathways) = 'array' THEN
    IF cfg.fire_on_redesign AND pathways ? 'redesign' THEN
      fired_kind  := 'am_handoff'; fired_value := 'redesign'; RETURN;
    END IF;
    IF cfg.fire_on_audit AND pathways ? 'audit' THEN
      fired_kind  := 'am_handoff'; fired_value := 'audit'; RETURN;
    END IF;
    IF cfg.fire_on_microsite AND pathways ? 'microsite' THEN
      fired_kind  := 'am_handoff'; fired_value := 'microsite'; RETURN;
    END IF;
  END IF;

  fired_kind  := NULL;
  fired_value := NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── Core firing routine ───────────────────────────────────────────────
-- Inserts an intent row (ON CONFLICT DO NOTHING — that's the lock),
-- then calls fire-crawl-trigger via pg_net. Returns the intent id or
-- NULL if a prior intent already existed.
CREATE OR REPLACE FUNCTION web_crawl_fire(
  p_web_project_id uuid,
  p_member         integer,
  p_target_url     text,
  p_triggered_by   text,
  p_trigger_value  text
) RETURNS uuid AS $$
DECLARE
  cfg          web_crawl_config;
  intent_id    uuid;
  request_body jsonb;
BEGIN
  SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;

  INSERT INTO web_crawl_intent (
    web_project_id, member, target_url, triggered_by, trigger_value
  ) VALUES (
    p_web_project_id, p_member, p_target_url, p_triggered_by, p_trigger_value
  )
  ON CONFLICT (web_project_id) DO NOTHING
  RETURNING id INTO intent_id;

  IF intent_id IS NULL THEN
    RETURN NULL;  -- prior intent exists; skip
  END IF;

  request_body := jsonb_build_object(
    'project_id', p_web_project_id::text,
    'target_url', p_target_url,
    'max_pages',  cfg.max_pages
  );

  PERFORM net.http_post(
    url     := cfg.edge_fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := request_body
  );

  UPDATE web_crawl_intent
  SET fired_at = now()
  WHERE id = intent_id;

  RETURN intent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Trigger A: signal change on strategy_account_progress ─────────────
-- Fires when one of the watched columns changes AND a web project
-- already exists for the member.
CREATE OR REPLACE FUNCTION trg_eval_crawl_on_account_progress() RETURNS trigger AS $$
DECLARE
  cfg         web_crawl_config;
  fired_kind  text;
  fired_value text;
  project_id  uuid;
BEGIN
  SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;
  SELECT (web_crawl_should_fire(cfg, NEW)).* INTO fired_kind, fired_value;
  IF fired_kind IS NULL THEN RETURN NEW; END IF;
  IF NEW.church_website IS NULL OR length(trim(NEW.church_website)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Find the active (non-archived) web project for this member.
  SELECT id INTO project_id
  FROM strategy_web_projects
  WHERE member = NEW.member AND archived = false
  ORDER BY created_at DESC
  LIMIT 1;

  IF project_id IS NULL THEN
    -- No project yet — strategy_web_projects INSERT trigger will pick
    -- this up when one is created.
    RETURN NEW;
  END IF;

  PERFORM web_crawl_fire(project_id, NEW.member::integer, NEW.church_website, fired_kind, fired_value);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crawl_account_progress ON strategy_account_progress;
CREATE TRIGGER trg_crawl_account_progress
AFTER INSERT OR UPDATE OF
  website_needs_discovery_questionnaire,
  handoff_web_form,
  church_website
ON strategy_account_progress
FOR EACH ROW EXECUTE FUNCTION trg_eval_crawl_on_account_progress();

-- ── Trigger B: a web project gets created ────────────────────────────
-- When a new project lands, check whether the member's
-- strategy_account_progress already carries a fire-worthy signal.
CREATE OR REPLACE FUNCTION trg_eval_crawl_on_web_project() RETURNS trigger AS $$
DECLARE
  cfg         web_crawl_config;
  prog        strategy_account_progress;
  fired_kind  text;
  fired_value text;
BEGIN
  SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;
  SELECT * INTO prog FROM strategy_account_progress WHERE member = NEW.member LIMIT 1;
  IF prog.member IS NULL THEN RETURN NEW; END IF;
  SELECT (web_crawl_should_fire(cfg, prog)).* INTO fired_kind, fired_value;
  IF fired_kind IS NULL THEN RETURN NEW; END IF;
  IF prog.church_website IS NULL OR length(trim(prog.church_website)) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM web_crawl_fire(NEW.id, NEW.member, prog.church_website, fired_kind, fired_value);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crawl_web_project ON strategy_web_projects;
CREATE TRIGGER trg_crawl_web_project
AFTER INSERT ON strategy_web_projects
FOR EACH ROW EXECUTE FUNCTION trg_eval_crawl_on_web_project();
