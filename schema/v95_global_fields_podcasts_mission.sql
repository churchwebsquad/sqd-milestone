-- v95: promote podcast + mission_statement to the global merge-field
-- set on strategy_web_projects.
--
-- These join the existing 15 global fields (church_name, address,
-- city_state, phone, email, denomination, pastor_name,
-- all_service_times, social_*_url) as project-level reusable
-- snippets. They're surfaced on the Dev Handoff "Church settings"
-- card and selectable from the CTA snippet dropdown.
--
-- All additive nullable text columns; dep audit from v94 still
-- applies — no view/matview references these, FKs are id-based.

ALTER TABLE public.strategy_web_projects
  ADD COLUMN IF NOT EXISTS podcast_name        text,
  ADD COLUMN IF NOT EXISTS podcast_apple_url   text,
  ADD COLUMN IF NOT EXISTS podcast_spotify_url text,
  ADD COLUMN IF NOT EXISTS mission_statement   text;

COMMENT ON COLUMN public.strategy_web_projects.podcast_name        IS 'Global merge field: podcast show name. Referenced as {{podcast_name}}.';
COMMENT ON COLUMN public.strategy_web_projects.podcast_apple_url   IS 'Global merge field: Apple Podcasts show URL.';
COMMENT ON COLUMN public.strategy_web_projects.podcast_spotify_url IS 'Global merge field: Spotify podcast show URL.';
COMMENT ON COLUMN public.strategy_web_projects.mission_statement   IS 'Global merge field: the church''s mission statement. Referenced as {{mission_statement}}.';
