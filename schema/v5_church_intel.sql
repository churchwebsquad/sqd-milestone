-- ============================================================================
-- v5_church_intel.sql
-- Church Intelligence Profile tables for Social Media Squad
-- Stores AI-generated content strategy profiles per church (JSONB)
-- ============================================================================

-- ── Main intel table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_church_intel (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member                  integer NOT NULL UNIQUE,
  notion_page_id          text UNIQUE,
  notion_page_url         text,
  intel_profile           jsonb,
  intel_version           integer NOT NULL DEFAULT 1,
  intel_updated_at        timestamptz NOT NULL DEFAULT now(),
  intel_updated_by        text,
  homepage_screenshot_path text,
  status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'live', 'needs_refresh')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_church_intel IS 'Church Intelligence Profiles — AI-generated content strategy per church for Social Media Squad';
COMMENT ON COLUMN strategy_church_intel.member IS 'Business key matching strategy_account_progress.member';
COMMENT ON COLUMN strategy_church_intel.intel_profile IS 'Full ChurchIntelProfile JSON (brand voice, audience, deliverable guidance, etc.)';
COMMENT ON COLUMN strategy_church_intel.intel_version IS 'Bumped on every refresh; history table stores each version';
COMMENT ON COLUMN strategy_church_intel.status IS 'draft = not yet reviewed, live = active, needs_refresh = flagged for update';

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_strategy_church_intel_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_church_intel_updated_at
  BEFORE UPDATE ON strategy_church_intel
  FOR EACH ROW EXECUTE FUNCTION update_strategy_church_intel_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_strategy_church_intel_member
  ON strategy_church_intel (member);
CREATE INDEX IF NOT EXISTS idx_strategy_church_intel_status
  ON strategy_church_intel (status);

-- ── History / audit log table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_church_intel_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_intel_id   uuid NOT NULL REFERENCES strategy_church_intel(id) ON DELETE CASCADE,
  version           integer NOT NULL,
  intel_profile     jsonb,
  author_email      text,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_church_intel_history IS 'Version history for Church Intel profiles — one row per save/refresh';

CREATE INDEX IF NOT EXISTS idx_strategy_church_intel_history_intel_id
  ON strategy_church_intel_history (church_intel_id);
CREATE INDEX IF NOT EXISTS idx_strategy_church_intel_history_version
  ON strategy_church_intel_history (church_intel_id, version DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE strategy_church_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_church_intel_history ENABLE ROW LEVEL SECURITY;

-- Authenticated staff can read all intel
CREATE POLICY "Authenticated users can read church intel"
  ON strategy_church_intel FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Authenticated staff can insert new intel
CREATE POLICY "Authenticated users can insert church intel"
  ON strategy_church_intel FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Authenticated staff can update intel
CREATE POLICY "Authenticated users can update church intel"
  ON strategy_church_intel FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- History: read + insert only (no updates/deletes — immutable audit log)
CREATE POLICY "Authenticated users can read intel history"
  ON strategy_church_intel_history FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert intel history"
  ON strategy_church_intel_history FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
