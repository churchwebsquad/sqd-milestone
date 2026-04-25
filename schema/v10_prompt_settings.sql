-- ============================================================================
-- v10_prompt_settings.sql
-- Admin-editable prompt registry used by Social Media Squad's SRP Generator
-- (and future LLM-backed features). Each row is a single named prompt whose
-- text overrides the hard-coded default in src/lib/prompts.ts.
-- Absence of a row → the default in code applies.
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_prompt_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key  text NOT NULL UNIQUE,
  prompt_text text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

COMMENT ON TABLE strategy_prompt_settings IS 'Admin-editable override registry for named LLM prompts. Absence of a row = use the default baked into src/lib/prompts.ts.';
COMMENT ON COLUMN strategy_prompt_settings.prompt_key IS 'Matches a PromptKey in src/lib/prompts.ts (e.g. reel_caption, facebook_post, carousel_slides).';
COMMENT ON COLUMN strategy_prompt_settings.updated_by IS 'Admin email who last saved this prompt.';

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_strategy_prompt_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_prompt_settings_updated_at
  BEFORE UPDATE ON strategy_prompt_settings
  FOR EACH ROW EXECUTE FUNCTION update_strategy_prompt_settings_updated_at();

CREATE INDEX IF NOT EXISTS idx_strategy_prompt_settings_key
  ON strategy_prompt_settings (prompt_key);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Any authenticated staff can READ (so the SRP runtime can fetch overrides).
-- INSERT/UPDATE/DELETE are also gated to authenticated staff only; the
-- PromptSettingsPage UI layer further restricts the editor to the admin
-- allowlist in src/lib/admin.ts, but anyone logged in could in theory POST
-- directly. Acceptable for v1 — staff is the same sign-in domain.

ALTER TABLE strategy_prompt_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read prompt settings"
  ON strategy_prompt_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert prompt settings"
  ON strategy_prompt_settings FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update prompt settings"
  ON strategy_prompt_settings FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete prompt settings"
  ON strategy_prompt_settings FOR DELETE
  USING (auth.uid() IS NOT NULL);
