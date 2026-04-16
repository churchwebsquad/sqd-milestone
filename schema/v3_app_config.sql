-- ============================================================================
-- v3_app_config.sql
-- Single-row configuration table for admin-editable global text
-- (Standard Footer + All In Updates Recap labels)
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_app_config (
  id                        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  standard_footer           text NOT NULL DEFAULT 'If you have questions or additional feedback, feel free to tag {{submitter_name}} or your account manager {{account_manager}}.',
  recap_header              text NOT NULL DEFAULT 'All In Updates Recap:',
  recap_brand_current_label text NOT NULL DEFAULT '🎨 Branding Current Milestone:',
  recap_brand_next_label    text NOT NULL DEFAULT '🎨 Branding Next Up:',
  recap_web_current_label   text NOT NULL DEFAULT '🌐 Website Current Milestone:',
  recap_web_next_label      text NOT NULL DEFAULT '🌐 Website Next Up:',
  recap_portal_label        text NOT NULL DEFAULT '📍 View Your Milestone History:',
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                text
);

-- Seed the single row with defaults
INSERT INTO strategy_app_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_strategy_app_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_app_config_updated_at
  BEFORE UPDATE ON strategy_app_config
  FOR EACH ROW EXECUTE FUNCTION update_strategy_app_config_updated_at();

-- RLS
ALTER TABLE strategy_app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read app config"
  ON strategy_app_config FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update app config"
  ON strategy_app_config FOR UPDATE
  USING (auth.uid() IS NOT NULL);
