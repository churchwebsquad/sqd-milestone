-- v100: Add social link fields to strategy_social_pro_profiles
-- Non-all-in churches need the same editable fields as all-in churches
-- but don't have a row in strategy_account_progress to save to.

alter table public.strategy_social_pro_profiles
  add column if not exists instagram                text,
  add column if not exists facebook                 text,
  add column if not exists youtube                  text,
  add column if not exists photos_link              text,
  add column if not exists bible_translation        text,
  add column if not exists platforms                text,
  add column if not exists branded_carousel_task    text,
  add column if not exists branded_carousel_dropbox_file text,
  add column if not exists notion_dashboard         text,
  add column if not exists brand_guide_link         text,
  add column if not exists sms_notes                text,
  add column if not exists social_coach             text;
