-- ============================================================================
-- v66_pipeline_prompts.sql
-- Per-stage editable prompts for the in-app copywriting pipeline.
--
-- Two scopes:
--   • 'global'  — Cowork-maintained baseline (one row per stage,
--                 web_project_id IS NULL)
--   • 'project' — optional per-project addendum (UNIQUE per stage)
--
-- Project addenda are APPENDED to the global at run time so global
-- improvements propagate to every project automatically. Resolver:
-- src/lib/pipelinePrompts.ts.
-- ============================================================================

CREATE TABLE web_pipeline_prompts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage          text NOT NULL CHECK (stage IN (
    'synthesize','sitemap','page_inventory','outlines',
    'bind','coverage_qa','voice_pass','final_qa'
  )),
  scope          text NOT NULL CHECK (scope IN ('global', 'project')),
  web_project_id uuid REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  system_prompt  text NOT NULL,
  notes          text,
  version        integer NOT NULL DEFAULT 1,
  updated_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_pipeline_prompts_scope_project_pair_check CHECK (
    (scope = 'global'  AND web_project_id IS NULL)
    OR
    (scope = 'project' AND web_project_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX web_pipeline_prompts_global_idx
  ON web_pipeline_prompts (stage) WHERE scope = 'global' AND web_project_id IS NULL;
CREATE UNIQUE INDEX web_pipeline_prompts_project_idx
  ON web_pipeline_prompts (stage, web_project_id) WHERE scope = 'project';

CREATE TRIGGER web_pipeline_prompts_set_updated_at
  BEFORE UPDATE ON web_pipeline_prompts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE web_pipeline_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pipeline prompts"
  ON web_pipeline_prompts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert pipeline prompts"
  ON web_pipeline_prompts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update pipeline prompts"
  ON web_pipeline_prompts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete pipeline prompts"
  ON web_pipeline_prompts FOR DELETE TO authenticated USING (true);

-- Placeholder global rows so resolvePrompt() has a hit on day one.
-- The richer content lives in src/lib/pipelinePrompts.ts as
-- FALLBACK_PROMPTS, which the resolver returns when the placeholder
-- text is still in the DB. The admin UI replaces these as the team
-- refines per-stage guidance.
INSERT INTO web_pipeline_prompts (stage, scope, system_prompt, notes) VALUES
  ('synthesize',     'global', 'placeholder', 'seed from cowork-skills/web-content-strategy-author.md'),
  ('sitemap',        'global', 'placeholder', 'seed from cowork-skills/web-sitemap-builder.md'),
  ('page_inventory', 'global', 'placeholder', 'seed from cowork-skills/web-content-map-builder.md'),
  ('outlines',       'global', 'placeholder', 'seed from cowork-skills/web-section-planner.md'),
  ('bind',           'global', 'placeholder', 'seed from cowork-skills/web-page-drafter.md'),
  ('coverage_qa',    'global', 'placeholder', 'new'),
  ('voice_pass',     'global', 'placeholder', 'seed from cowork-skills/web-voice-card-compiler.md'),
  ('final_qa',       'global', 'placeholder', 'new');
