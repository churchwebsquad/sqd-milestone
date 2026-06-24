-- v96: add 'omit' to the strategy_content_collection_marks.status
-- CHECK constraint. Lets partners explicitly drop a topic / program /
-- topic_item / missing_program card during content collection, which
-- downstream consumers (atomizer, prompt builder, sitemap builder)
-- will honor as "do not carry this into the new site."
--
-- Dep audit: no views, no materialized views, no triggers, no
-- functions reference strategy_content_collection_marks beyond
-- direct row inserts/updates from the partner-facing form. Safe to
-- relax the CHECK to a wider value set.

ALTER TABLE public.strategy_content_collection_marks
  DROP CONSTRAINT IF EXISTS strategy_content_collection_marks_status_check;

ALTER TABLE public.strategy_content_collection_marks
  ADD  CONSTRAINT strategy_content_collection_marks_status_check
  CHECK (status = ANY (ARRAY[
    'approved'::text,
    'outdated'::text,
    'approved_keep_as_is'::text,
    'omit'::text
  ]));

COMMENT ON COLUMN public.strategy_content_collection_marks.status IS
  'approved = content carries forward as-is for review. outdated = needs partner update. approved_keep_as_is = do not let the copywriter rewrite this. omit = partner has dropped this card; downstream pipeline must exclude it from atomization / sitemap / handoff.';
