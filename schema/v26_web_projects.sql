-- v26_web_projects.sql
--
-- Anchors the Website Manager. Each row is one website engagement
-- for a partner — most churches have one active project at a time,
-- but the explicit web_project_id leaves room for multiples (e.g.,
-- a 2026 redesign + a 2028 micro-site without losing history).
--
-- Phase 1 of the Web Manager build only consumes (id, member, name,
-- kind, current_phase, archived) for the projects-grid + project-view
-- screens. Subsequent phases attach the Brixies content templates,
-- pages, sections, and tool-specific outputs back to web_project_id.
--
-- The five tool concepts (Intake / Content / Design / Dev / Reviews)
-- aren't modeled as columns here — each gets its own scoped table
-- (or set of tables) in later migrations. `current_phase` is a
-- denormalized roll-up for the project-view tile + dashboard sort.

CREATE TABLE IF NOT EXISTS strategy_web_projects (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Partner key. Mirrors the convention used everywhere else in the
  -- strategy_* tables (strategy_account_progress.member is the source).
  member                  integer NOT NULL,
  -- Staff-facing label, e.g. "2026 Redesign" or "Visit micro-site".
  name                    text NOT NULL,
  -- Engagement type. Drives downstream defaults (page sets, design
  -- variant suggestions). Free-text for v1; tighten to enum later.
  kind                    text NOT NULL DEFAULT 'redesign',
  -- Coarse stage the project is currently in. Computed elsewhere too,
  -- but stored here so the project-view tile can read it cheaply.
  current_phase           text NOT NULL DEFAULT 'intake',
  -- Soft-delete (mirrors the milestone-submissions pattern). Archived
  -- projects drop out of the active list but stay restoreable.
  archived                boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by_employee_id  uuid REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_web_projects_member_active
  ON strategy_web_projects (member, archived);
CREATE INDEX IF NOT EXISTS idx_strategy_web_projects_active_recent
  ON strategy_web_projects (archived, created_at DESC);

-- ── updated_at trigger (per-table function, mirrors repo convention)
CREATE OR REPLACE FUNCTION update_strategy_web_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS strategy_web_projects_set_updated_at
  ON strategy_web_projects;
CREATE TRIGGER strategy_web_projects_set_updated_at
  BEFORE UPDATE ON strategy_web_projects
  FOR EACH ROW EXECUTE FUNCTION update_strategy_web_projects_updated_at();

-- ── RLS: any signed-in staff can read/write. Matches the strategy_*
-- pattern; staff role gating happens in app code.
--
-- Each CREATE is preceded by a DROP IF EXISTS so a re-run of this
-- file (e.g. via Supabase Studio after the MCP applied it once)
-- doesn't fail with `policy ... already exists`. Postgres has no
-- `CREATE POLICY IF NOT EXISTS`, so DROP-then-CREATE is the
-- canonical idempotent pattern.
ALTER TABLE strategy_web_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read web projects" ON strategy_web_projects;
CREATE POLICY "Authenticated users can read web projects"
  ON strategy_web_projects FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can insert web projects" ON strategy_web_projects;
CREATE POLICY "Authenticated users can insert web projects"
  ON strategy_web_projects FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update web projects" ON strategy_web_projects;
CREATE POLICY "Authenticated users can update web projects"
  ON strategy_web_projects FOR UPDATE
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete web projects" ON strategy_web_projects;
CREATE POLICY "Authenticated users can delete web projects"
  ON strategy_web_projects FOR DELETE
  USING (auth.uid() IS NOT NULL);
