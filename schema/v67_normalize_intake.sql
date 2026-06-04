-- ============================================================================
-- v67_normalize_intake.sql
-- Stage 0 of the copywriting pipeline — the Intake Normalizer.
--
-- Atomizes raw intake (strategy brief + brand handoff + discovery +
-- content collection + AM handoff) into two project-scoped tables that
-- Stage 3 (page_inventory) and Stage 6 (coverage_qa) consume:
--
--   content_atoms — prose snippets, persona notes, voice rules, mission
--                   statements (one per "complete unit of meaning")
--   church_facts  — typed structured facts (service times, ministries,
--                   staff, beliefs, etc.)
--
-- Each row tracks its source (strategy_brief / brand_handoff / etc.) and
-- a confidence score so Stage 6's coverage audit can reason about which
-- atoms HAVE to land vs. which are nice-to-have.
-- ============================================================================

CREATE TABLE content_atoms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  topic          text NOT NULL,
  body           text NOT NULL,
  metadata       jsonb,
  source_kind    text,
  source_ref     text,
  verbatim       boolean NOT NULL DEFAULT false,
  confidence     real,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_atoms_project_idx ON content_atoms (web_project_id);
CREATE INDEX content_atoms_topic_idx   ON content_atoms (web_project_id, topic);

CREATE TABLE church_facts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  topic          text NOT NULL,
  data           jsonb NOT NULL,
  source_kind    text,
  source_ref     text,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX church_facts_project_idx ON church_facts (web_project_id);
CREATE INDEX church_facts_topic_idx   ON church_facts (web_project_id, topic);

CREATE TRIGGER content_atoms_set_updated_at BEFORE UPDATE ON content_atoms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER church_facts_set_updated_at  BEFORE UPDATE ON church_facts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE content_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_facts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read content_atoms"
  ON content_atoms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write content_atoms"
  ON content_atoms FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read church_facts"
  ON church_facts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write church_facts"
  ON church_facts FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE web_pipeline_prompts DROP CONSTRAINT web_pipeline_prompts_stage_check;
ALTER TABLE web_pipeline_prompts ADD CONSTRAINT web_pipeline_prompts_stage_check
  CHECK (stage IN (
    'normalize','synthesize','sitemap','page_inventory',
    'outlines','bind','coverage_qa','voice_pass','final_qa'
  ));

INSERT INTO web_pipeline_prompts (stage, scope, system_prompt, notes)
VALUES ('normalize', 'global', 'placeholder', 'Stage 0 — Intake Normalizer');
