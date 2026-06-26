-- v118 — split hosting + registrar out of "site access provided"
--
-- The Web Squad Initial Site Access checklist previously had one
-- catch-all "Site access provided" item. Staff requested separating:
--   - Site access provided (CMS / admin login only)
--   - Hosting details provided (current host + credentials)
--   - Domain registrar confirmation (registrar URL + credential method)
-- These are three distinct migration prerequisites and should each
-- have their own state. Adds two new boolean columns plus a
-- current_host text on the existing strategy_content_collection_sessions
-- so the migration intake form can capture it.

ALTER TABLE strategy_account_progress
  ADD COLUMN IF NOT EXISTS web_squad_hosting_details_provided  boolean,
  ADD COLUMN IF NOT EXISTS web_squad_domain_registrar_provided boolean;

ALTER TABLE strategy_content_collection_sessions
  ADD COLUMN IF NOT EXISTS current_host text;

COMMENT ON COLUMN strategy_account_progress.web_squad_hosting_details_provided IS
  'Web Squad checklist: has the partner shared current-hosting credentials? NULL=not asked, true=yes, false=no.';
COMMENT ON COLUMN strategy_account_progress.web_squad_domain_registrar_provided IS
  'Web Squad checklist: has the partner shared the domain registrar (and granted access)? NULL=not asked, true=yes, false=no.';
COMMENT ON COLUMN strategy_content_collection_sessions.current_host IS
  'Current hosting provider name (e.g. "Squarespace", "Wix", "Wordpress.com", "Bluehost"). Captured by RegistrarIntakePage / ContentCollectionPage / the standalone migration intake form. Shared field across all three surfaces.';
