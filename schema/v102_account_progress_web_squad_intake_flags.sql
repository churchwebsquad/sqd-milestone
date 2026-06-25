-- v102 — Web Squad intake flags on strategy_account_progress
--
-- Four nullable booleans tracking the partner's "initial site access"
-- handoff to the Web Squad. Each independently flippable from the
-- Church details page → Web Squad section. NULL = not-yet-set (the
-- distinguishable third state from false/true). All additive,
-- non-destructive.
--
-- Existing triggers on strategy_account_progress fire on specific
-- columns (crawl, contentsnare, website_launched) — these new
-- columns do not intersect with any of them. Verified before apply.

ALTER TABLE strategy_account_progress
  ADD COLUMN IF NOT EXISTS web_squad_site_access_provided    boolean,
  ADD COLUMN IF NOT EXISTS web_squad_login_in_1password      boolean,
  ADD COLUMN IF NOT EXISTS web_squad_ga_access_shared        boolean,
  ADD COLUMN IF NOT EXISTS web_squad_ready_for_evaluation    boolean;

COMMENT ON COLUMN strategy_account_progress.web_squad_site_access_provided IS
  'Web Squad intake: partner has provided access to their current site (CMS login or hosting access).';
COMMENT ON COLUMN strategy_account_progress.web_squad_login_in_1password IS
  'Web Squad intake: the access credentials have been added to the Squad 1Password vault.';
COMMENT ON COLUMN strategy_account_progress.web_squad_ga_access_shared IS
  'Web Squad intake: partner has granted Google Analytics access to the Squad GA account.';
COMMENT ON COLUMN strategy_account_progress.web_squad_ready_for_evaluation IS
  'Web Squad intake: all access prerequisites met, partner is ready for the site evaluation pass.';
