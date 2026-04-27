-- v21_strategy_announcements.sql
--
-- "What's New" announcement popups for Initiative Progress entries.
--
-- When a director/VP posts a Progress update, they can flip a toggle to
-- broadcast it as a one-time popup to every staff member in the
-- initiative's department (or to everyone, when the initiative is
-- 'all-in'). Each user sees a given announcement at most once — they
-- record their dismissal in `strategy_announcement_dismissals`, and the
-- targeting query filters those out.
--
-- Design choices:
--   - Supabase-only (no Notion property change). Title / body / dept
--     are denormalized onto the announcement row so the popup loads
--     without re-fetching the Notion page.
--   - One popup at a time, newest first; no auto-expire. Old
--     announcements stay in the table indefinitely. To pull one off
--     stage, set `is_active = false` (admin SQL for now; UI later).
--
-- RLS: matches the precedent set by strategy_prompt_settings — any
-- authenticated user can read + write to all four CRUD verbs. The
-- author-side gate (only directors+VP can post announcements) is
-- enforced in the app via isVPByEmail / isDirectorByEmployeeId, same
-- pattern Library uses for Doc Manager. Anyone signed in could POST
-- directly; acceptable because every signed-in user is internal staff.

-- ── Schema ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_announcements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Notion Progress page this announcement was generated from. We
  -- denormalize headline/body so we don't need a Notion fetch on every
  -- popup load, but we keep the id so a future "View source post"
  -- affordance has the deep link.
  progress_notion_id       text NOT NULL,
  initiative_notion_id     text NOT NULL,
  -- Subhead on the popup ("[Initiative Name]"). Denormalized so a
  -- rename in Notion doesn't change historical announcements.
  initiative_name          text NOT NULL,
  -- 'all-in' broadcasts to everyone; 'social'|'branding'|'web' only to
  -- staff whose strategy dept matches; null falls back to 'all-in'
  -- behavior so an unset dept doesn't silently hide the announcement.
  initiative_department    text,
  headline                 text NOT NULL,
  body                     text,
  created_by_employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  is_active                boolean NOT NULL DEFAULT true,
  -- Set when an admin retires a stale announcement so it stops showing.
  -- We keep is_active as the primary on/off switch and use retired_at
  -- only as an audit timestamp.
  retired_at               timestamptz
);

CREATE INDEX IF NOT EXISTS strategy_announcements_active_recent_idx
  ON strategy_announcements (is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS strategy_announcements_progress_lookup_idx
  ON strategy_announcements (progress_notion_id);

CREATE TABLE IF NOT EXISTS strategy_announcement_dismissals (
  announcement_id  uuid NOT NULL REFERENCES strategy_announcements(id) ON DELETE CASCADE,
  -- auth.uid() of the dismissing user. Keyed against auth.users; not a
  -- hard FK because employees rows are keyed differently and we want
  -- the dismissal to survive an employee record change.
  user_id          uuid NOT NULL,
  dismissed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS strategy_announcement_dismissals_user_idx
  ON strategy_announcement_dismissals (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE strategy_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_announcement_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read announcements"
  ON strategy_announcements FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert announcements"
  ON strategy_announcements FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update announcements"
  ON strategy_announcements FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete announcements"
  ON strategy_announcements FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Dismissals are per-user — a user can only see/insert/delete their own
-- dismissal rows. Reading another user's dismissal would leak who has
-- engaged with what announcement.
CREATE POLICY "Users can read their own dismissals"
  ON strategy_announcement_dismissals FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own dismissals"
  ON strategy_announcement_dismissals FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own dismissals"
  ON strategy_announcement_dismissals FOR DELETE
  USING (user_id = auth.uid());
