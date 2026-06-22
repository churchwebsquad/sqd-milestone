-- v88 — Auto-create {single-X} template pages when the partner's
-- display preferences imply they need them.
--
-- Convention: pages named/slugged with {single-X} (e.g. {single-event},
-- {single-staff}) are routing stand-ins for the dev's WordPress
-- post-template loop, NOT pages the partner reviews. PortalReviewPage
-- already filters them out of partner-facing surfaces. They land in
-- Pages workspace so the designer + dev see them on the page tree
-- and can wire the per-post layout.
--
-- Triggers per partner pref:
--   events_display_preference  IN ('wordpress','embed')   → {single-event}
--   groups_display_preference  IN ('wordpress','embed')   → {single-group}
--   sermons_display_preference IN ('wordpress')           → {single-sermon}
--   ALWAYS (regardless of prefs)                          → {single-staff}
--
-- "wordpress" means a per-record CMS page lives on the site.
-- "embed" means embedded view from Planning Center / CCB / etc.,
-- which on the WordPress side still uses a per-record template.

DROP FUNCTION IF EXISTS ensure_single_template_pages(uuid);

CREATE OR REPLACE FUNCTION ensure_single_template_pages(p_web_project_id uuid)
RETURNS TABLE(out_slug text, out_action text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  ses        strategy_content_collection_sessions%ROWTYPE;
  want_event   boolean := false;
  want_group   boolean := false;
  want_sermon  boolean := false;
  want_staff   boolean := true;
  max_order    integer;
BEGIN
  SELECT * INTO ses
  FROM strategy_content_collection_sessions s
  WHERE s.web_project_id = p_web_project_id
  ORDER BY s.submitted_at DESC NULLS LAST, s.updated_at DESC
  LIMIT 1;
  IF FOUND THEN
    want_event  := ses.events_display_preference  IN ('wordpress','embed');
    want_group  := ses.groups_display_preference  IN ('wordpress','embed');
    want_sermon := ses.sermons_display_preference IN ('wordpress');
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) INTO max_order
  FROM web_pages WHERE web_project_id = p_web_project_id AND archived = false;

  RETURN QUERY
  WITH wanted AS (
    SELECT 'nav-only'::text AS phase_v, t.s AS slug_v, t.n AS name_v
    FROM (VALUES
      ('{single-event}',  'Single Event Template',  want_event),
      ('{single-group}',  'Single Group Template',  want_group),
      ('{single-sermon}', 'Single Sermon Template', want_sermon),
      ('{single-staff}',  'Single Staff Template',  want_staff)
    ) AS t(s, n, w)
    WHERE t.w
  ),
  ins AS (
    INSERT INTO web_pages (web_project_id, name, slug, phase, sort_order, archived, content_status)
    SELECT p_web_project_id, w.name_v, w.slug_v, w.phase_v,
           max_order + ROW_NUMBER() OVER (ORDER BY w.slug_v),
           false, 'draft'
    FROM wanted w
    WHERE NOT EXISTS (
      SELECT 1 FROM web_pages p
      WHERE p.web_project_id = p_web_project_id
        AND p.slug = w.slug_v
        AND p.archived = false
    )
    RETURNING web_pages.slug AS s, 'created'::text AS act
  ),
  skipped AS (
    SELECT w.slug_v AS s, 'already_exists'::text AS act
    FROM wanted w
    WHERE EXISTS (
      SELECT 1 FROM web_pages p
      WHERE p.web_project_id = p_web_project_id
        AND p.slug = w.slug_v
        AND p.archived = false
    )
  )
  SELECT s, act FROM ins UNION ALL SELECT s, act FROM skipped;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_single_template_pages(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION trg_ensure_single_template_pages() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.web_project_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.events_display_preference,'')  = COALESCE(OLD.events_display_preference,'')
     AND COALESCE(NEW.groups_display_preference,'')  = COALESCE(OLD.groups_display_preference,'')
     AND COALESCE(NEW.sermons_display_preference,'') = COALESCE(OLD.sermons_display_preference,'') THEN
    RETURN NEW;
  END IF;
  PERFORM ensure_single_template_pages(NEW.web_project_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_single_template_pages_on_cc_session ON strategy_content_collection_sessions;
CREATE TRIGGER ensure_single_template_pages_on_cc_session
  AFTER INSERT OR UPDATE ON strategy_content_collection_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trg_ensure_single_template_pages();
