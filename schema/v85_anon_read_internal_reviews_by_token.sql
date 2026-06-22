-- v85 — Allow anon to read open INTERNAL reviews by token.
--
-- Bug: PortalReviewPage uses the anon supabase client to look up
-- web_reviews by partner_token. The existing RLS policy "Anon can
-- read open partner reviews" only allows kind='partner' rows; when
-- a strategist generates an internal review link and shares it with
-- a teammate, the teammate (or any staff member viewing the link
-- from a logged-out tab) gets "This review link is invalid" because
-- RLS hides the row. Authenticated staff with a valid JWT get in via
-- the broader auth.uid() policy, but link sharing breaks for the
-- common case where the recipient isn't logged in.
--
-- The token IS the access control on both kinds (32-char opaque
-- partner_token). Expanding the anon-read policy to include
-- kind='internal' carries the same threat model as kind='partner'.

DROP POLICY IF EXISTS "Anon can read open partner reviews" ON web_reviews;

CREATE POLICY "Anon can read open reviews by token"
  ON web_reviews FOR SELECT TO anon
  USING (
    partner_token IS NOT NULL
    AND status = ANY (ARRAY['open','no_status','open_for_review','editing_content','on_hold'])
    AND kind IN ('partner','internal')
  );

DROP POLICY IF EXISTS "Anon can update partner_name on open partner reviews" ON web_reviews;

CREATE POLICY "Anon can update partner_name on open reviews by token"
  ON web_reviews FOR UPDATE TO anon
  USING (
    partner_token IS NOT NULL
    AND status = ANY (ARRAY['open','no_status','open_for_review','editing_content','on_hold'])
    AND kind IN ('partner','internal')
  );
