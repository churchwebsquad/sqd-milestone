-- v78 — Update anon-facing partner-review RLS policies to use the
-- BoardStatus enum instead of the legacy status='open' literal.
--
-- The Review tab and feedback boards moved the review lifecycle from
-- a simple {open, closed} pair to BoardStatus (no_status,
-- open_for_review, editing_content, on_hold, completed). The six
-- anon-facing RLS policies were never updated, so they kept filtering
-- on status='open' — which no reviews use anymore. Every partner
-- portal visit returned zero rows from the anon SELECT and hit
-- "Review link is invalid" in PortalReviewPage's loader.
--
-- Each policy is now gated on the "open-shaped" status set:
--   open, no_status, open_for_review, editing_content, on_hold
-- ('open' is kept as a safety net for any straggler rows still on
-- the legacy value.) 'completed' is intentionally excluded — a closed
-- round shouldn't be reachable via the partner link.
--
-- Affected tables / policies:
--   web_reviews
--     - "Anon can read open partner reviews" (SELECT)
--     - "Anon can update partner_name on open partner reviews" (UPDATE)
--   web_pages
--     - "Anon can read pages of projects with open partner reviews" (SELECT)
--   web_sections
--     - "Anon can read sections of projects with open partner reviews" (SELECT)
--   web_review_comments
--     - "Anon can read comments for open partner reviews" (SELECT)
--     - "Anon can insert comments on open partner reviews" (INSERT)

DROP POLICY IF EXISTS "Anon can read open partner reviews" ON public.web_reviews;
CREATE POLICY "Anon can read open partner reviews"
  ON public.web_reviews FOR SELECT TO anon
  USING (
    kind = 'partner'
    AND partner_token IS NOT NULL
    AND status IN ('open','no_status','open_for_review','editing_content','on_hold')
  );

DROP POLICY IF EXISTS "Anon can update partner_name on open partner reviews" ON public.web_reviews;
CREATE POLICY "Anon can update partner_name on open partner reviews"
  ON public.web_reviews FOR UPDATE TO anon
  USING (
    kind = 'partner'
    AND partner_token IS NOT NULL
    AND status IN ('open','no_status','open_for_review','editing_content','on_hold')
  );

DROP POLICY IF EXISTS "Anon can read pages of projects with open partner reviews" ON public.web_pages;
CREATE POLICY "Anon can read pages of projects with open partner reviews"
  ON public.web_pages FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.web_reviews r
      WHERE r.web_project_id = web_pages.web_project_id
        AND r.kind = 'partner'
        AND r.status IN ('open','no_status','open_for_review','editing_content','on_hold')
    )
  );

DROP POLICY IF EXISTS "Anon can read sections of projects with open partner reviews" ON public.web_sections;
CREATE POLICY "Anon can read sections of projects with open partner reviews"
  ON public.web_sections FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.web_pages p
      JOIN public.web_reviews r ON r.web_project_id = p.web_project_id
      WHERE p.id = web_sections.web_page_id
        AND r.kind = 'partner'
        AND r.status IN ('open','no_status','open_for_review','editing_content','on_hold')
    )
  );

DROP POLICY IF EXISTS "Anon can read comments for open partner reviews" ON public.web_review_comments;
CREATE POLICY "Anon can read comments for open partner reviews"
  ON public.web_review_comments FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.web_reviews r
      WHERE r.id = web_review_comments.review_id
        AND r.kind = 'partner'
        AND r.status IN ('open','no_status','open_for_review','editing_content','on_hold')
    )
  );

DROP POLICY IF EXISTS "Anon can insert comments on open partner reviews" ON public.web_review_comments;
CREATE POLICY "Anon can insert comments on open partner reviews"
  ON public.web_review_comments FOR INSERT TO anon
  WITH CHECK (
    author_kind = 'partner'
    AND EXISTS (
      SELECT 1 FROM public.web_reviews r
      WHERE r.id = web_review_comments.review_id
        AND r.kind = 'partner'
        AND r.status IN ('open','no_status','open_for_review','editing_content','on_hold')
    )
  );
