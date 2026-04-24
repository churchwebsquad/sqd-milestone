-- v21_typography_sources.sql
--
-- Restructures how a typography row models its font sources. Each row now
-- supports three distinct "source" concepts plus the always-required web
-- family:
--
--   1. Open-source source — `font_url` (existing). Google Fonts URL or an
--      uploaded webfont file. Works on every downstream surface.
--   2. Custom paid source — `custom_font_purchase_url` (new). Link to where
--      the church can buy the license. Editor shows a kind footnote
--      explaining why licensing matters.
--   3. Free alternative — `free_alt_family` + `free_alt_font_url` (new).
--      Required UX-side when the custom source is used. Gives downstream
--      surfaces a royalty-free fallback.
--   4. Web font family — `web_font_family` (existing). What renders on the
--      online brand guide + downstream web projects. Auto-prefilled in the
--      editor when the row's `font_url` is a Google Fonts URL.
--
-- All three new columns are plain text, nullable. Editor enforces "free alt
-- required when custom URL is present" as a soft warning — not a DB
-- constraint — so the brand squad can draft without the flow fighting them.
-- Typography RPC payload flows through `to_jsonb(t)`, so no RPC change.

ALTER TABLE strategy_brand_typography
  ADD COLUMN IF NOT EXISTS custom_font_purchase_url text,
  ADD COLUMN IF NOT EXISTS free_alt_family text,
  ADD COLUMN IF NOT EXISTS free_alt_font_url text;
