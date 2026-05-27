-- v35_pipeline_foundation.sql
--
-- The autonomous-pipeline foundation. With no in-house strategist to
-- drive copy page-by-page, the website-build workflow has to run end-
-- to-end on its own, surfacing humans only at meaningful artifact
-- gates (voice, sitemap+strategy, content map, phase-1 review,
-- partner publish). This migration stands up the data layer required
-- for that:
--
--   1. church_facts            — structured, multi-valued facts
--                                extracted from intake. Coexists with
--                                the single-valued global merge fields
--                                already on strategy_web_projects.
--   2. church_voice_card       — the synthesized voice profile
--                                (tone, banned terms, branded vocab,
--                                denominational filter, persona
--                                snapshots). One row per project,
--                                superseded-not-overwritten on
--                                regeneration.
--   3. content_atoms           — every distinct intake fact, classified
--                                by topic. The single-sourcing layer
--                                under web_pages.brief.
--   4. content_page_map        — atom × page × role (canonical /
--                                reference / cta / context). Solves
--                                cross-page reuse — kids info canonical
--                                on /kids, reference on /visit, cta on /.
--   5. pipeline_jobs           — the execution queue + state machine.
--   6. pipeline_feedback       — human approvals / send-backs at gates.
--   7. prompt_versions         — versioned agent prompts so we can
--                                A/B test and roll back drift.
--
-- Conventions follow v26-v34: uuid PKs, gen_random_uuid(), per-table
-- updated_at triggers, archived soft-delete, RLS staff-only via
-- auth.uid() IS NOT NULL, DROP-then-CREATE for idempotency.
--
-- pg_cron wiring (the tick that pulls `ready` jobs and dispatches them
-- to the Vercel agent endpoints) is intentionally NOT in this file —
-- pg_cron is enabled via Supabase dashboard / a separate ops migration
-- and the schedule is environment-specific. See bottom of file for the
-- one-liner to drop into the cron migration once the worker endpoints
-- exist.

-- ═══════════════════════════════════════════════════════════════════
-- 1. church_facts — typed, multi-valued intake projection
-- ═══════════════════════════════════════════════════════════════════
--
-- The "rollup" tab data, structured. Existing single-valued globals
-- stay on strategy_web_projects (church_name, address, denomination,
-- pastor_name, primary_service_time, social URLs, etc. — see v28).
-- This table is for the multi-valued, typed facts:
--
--   - service_time  (Sunday 9am, Sunday 11am, Wednesday 7pm, multi-campus)
--   - campus        (Main, North, Spanish-language)
--   - ministry      (kids, students, young adults, recovery, food pantry)
--   - staff         (pastor, kids director, worship lead — beyond pastor_name)
--   - belief        (statement-of-faith items)
--   - program       (named programs: GriefShare, Celebrate Recovery, etc.)
--   - milestone     (church history beats — founded 1991, building 2008)
--   - testimonial   (partner-supplied stories)
--   - branded_term  (terms the church owns: "Riverwood Roots", "HUB757")
--
-- Each fact carries source + confidence + verbatim flags so the
-- copywriter knows what it can paraphrase vs. what must appear
-- unchanged.

CREATE TABLE IF NOT EXISTS church_facts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id  uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,

  topic           text NOT NULL,
  subtopic        text,                           -- optional finer cut, e.g. 'service_time.kids'
  body            text NOT NULL,                  -- canonical phrasing
  body_short      text,                           -- pre-truncated reference form (1 sentence)

  -- Provenance — must trace back to intake. Drives source-integrity
  -- checks in the reviewer agent (every claim in copy must point at
  -- a fact row whose source is one of these).
  source_kind     text NOT NULL,
  source_ref      text,                           -- filename / URL / ContentSnare question id / brief section
  -- Stable foreign key into the source system so re-ingestion is
  -- idempotent. ContentSnare exposes `reference_id` per field
  -- (rfld_*); Fillout exposes `submission_id` + per-question ids.
  -- The normalizer upserts by (web_project_id, external_ref_id)
  -- when this is set.
  external_ref_id text,

  verbatim        boolean NOT NULL DEFAULT false, -- must appear unchanged in copy
  confidence      text NOT NULL DEFAULT 'partner_stated',

  -- Typed payload — for service_times: {day, time, campus, audience};
  -- for staff: {role, photo_url, bio}; for ministry: {category, age_range, schedule}.
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle. Regeneration inserts new rows + sets superseded_at on
  -- the old. Reads filter `WHERE superseded_at IS NULL AND archived = false`.
  superseded_at   timestamptz,
  superseded_by   uuid REFERENCES church_facts(id) ON DELETE SET NULL,
  archived        boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL
);

ALTER TABLE church_facts DROP CONSTRAINT IF EXISTS church_facts_topic_check;
ALTER TABLE church_facts ADD CONSTRAINT church_facts_topic_check
  CHECK (topic IN (
    'service_time',
    'campus',
    'ministry',
    'staff',
    'belief',
    'program',
    'milestone',
    'testimonial',
    'branded_term',
    'audience',
    'location_detail',
    'contact_method',
    'partnership',
    'other'
  ));

ALTER TABLE church_facts DROP CONSTRAINT IF EXISTS church_facts_source_kind_check;
ALTER TABLE church_facts ADD CONSTRAINT church_facts_source_kind_check
  CHECK (source_kind IN (
    'content_collection',
    'site_crawl',
    'strategy_brief',
    'am_handoff',
    'discovery_questionnaire',
    'brand_handoff',
    'seo_report',
    'manual'
  ));

ALTER TABLE church_facts DROP CONSTRAINT IF EXISTS church_facts_confidence_check;
ALTER TABLE church_facts ADD CONSTRAINT church_facts_confidence_check
  CHECK (confidence IN ('partner_stated', 'inferred', 'guessed'));

CREATE INDEX IF NOT EXISTS idx_church_facts_project_topic
  ON church_facts (web_project_id, topic, archived)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_church_facts_verbatim
  ON church_facts (web_project_id, verbatim)
  WHERE verbatim = true AND superseded_at IS NULL AND archived = false;

-- Idempotent re-ingestion key — partial unique so projects without
-- a source ref still allow multiple rows.
DROP INDEX IF EXISTS idx_church_facts_external_ref_unique;
CREATE UNIQUE INDEX idx_church_facts_external_ref_unique
  ON church_facts (web_project_id, external_ref_id)
  WHERE external_ref_id IS NOT NULL AND superseded_at IS NULL;

CREATE OR REPLACE FUNCTION update_church_facts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS church_facts_set_updated_at ON church_facts;
CREATE TRIGGER church_facts_set_updated_at
  BEFORE UPDATE ON church_facts
  FOR EACH ROW EXECUTE FUNCTION update_church_facts_updated_at();


-- ═══════════════════════════════════════════════════════════════════
-- 2. church_voice_card — synthesized voice profile
-- ═══════════════════════════════════════════════════════════════════
--
-- One ROW per project (with a version counter — never overwritten on
-- regeneration; old rows get superseded_at + the new row is inserted).
-- This is the single highest-leverage artifact in the autonomous
-- pipeline. Every downstream LLM call references it via prompt-cached
-- system prompt. Get this right; downstream copy stays on-brand.
-- Get it wrong; everything drifts.
--
-- The strategist-substitute reviews this at Gate 1 (Voice Card review).
-- Approval is required before any drafting begins.

CREATE TABLE IF NOT EXISTS church_voice_cards (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id           uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  version                  integer NOT NULL DEFAULT 1,

  -- Core voice anatomy. Each is denormalized for fast read access in
  -- prompt assembly; the full structured payload also lands in `payload`
  -- below for round-tripping with the synthesizer agent.
  tone_descriptors         text[] NOT NULL DEFAULT '{}'::text[],   -- e.g. {warm, conversational, hopeful}
  banned_terms             text[] NOT NULL DEFAULT '{}'::text[],   -- AI-cliché + church-cliché blocklist
  branded_vocabulary       jsonb  NOT NULL DEFAULT '{}'::jsonb,    -- {term: definition} church-specific lexicon
  denominational_filter    text,                                   -- 'non-denominational-evangelical', 'reformed', etc.
  mission_statement        text,                                   -- the canonical mission sentence
  x_factor                 text,                                   -- the church's specific differentiator
  persona_snapshots        jsonb  NOT NULL DEFAULT '[]'::jsonb,    -- [{name, age_range, situation, language_register}]
  syntax_rules             jsonb  NOT NULL DEFAULT '{}'::jsonb,    -- {no_em_dash: true, no_triads: true, you_your: true, ...}
  example_phrases_good     text[] NOT NULL DEFAULT '{}'::text[],   -- phrases that exemplify the voice
  example_phrases_bad      text[] NOT NULL DEFAULT '{}'::text[],   -- phrases to avoid (often inherited from prior projects)

  -- Full structured payload from the synthesizer for round-tripping.
  -- Source of truth if the denormalized columns ever drift.
  payload                  jsonb  NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance
  generated_by_prompt_version_id  uuid,   -- FK added after prompt_versions exists, see end of file
  generated_at                    timestamptz NOT NULL DEFAULT now(),

  -- Review state
  approved_at                     timestamptz,
  approved_by_employee_id         uuid REFERENCES employees(id) ON DELETE SET NULL,
  review_notes                    text,

  -- Lifecycle
  superseded_at                   timestamptz,
  superseded_by                   uuid REFERENCES church_voice_cards(id) ON DELETE SET NULL,
  superseded_reason               text,                            -- why a new version was generated

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE church_voice_cards DROP CONSTRAINT IF EXISTS church_voice_cards_unique_version;
ALTER TABLE church_voice_cards ADD CONSTRAINT church_voice_cards_unique_version
  UNIQUE (web_project_id, version);

-- Partial unique index: only one CURRENT (non-superseded) voice card per project.
DROP INDEX IF EXISTS idx_church_voice_cards_current_unique;
CREATE UNIQUE INDEX idx_church_voice_cards_current_unique
  ON church_voice_cards (web_project_id)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_church_voice_cards_project
  ON church_voice_cards (web_project_id, version DESC);

CREATE OR REPLACE FUNCTION update_church_voice_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS church_voice_cards_set_updated_at ON church_voice_cards;
CREATE TRIGGER church_voice_cards_set_updated_at
  BEFORE UPDATE ON church_voice_cards
  FOR EACH ROW EXECUTE FUNCTION update_church_voice_cards_updated_at();


-- ═══════════════════════════════════════════════════════════════════
-- 3. content_atoms — single-sourcing layer
-- ═══════════════════════════════════════════════════════════════════
--
-- A content atom is one distinct piece of information from intake
-- (a service time slot, a kids check-in step, a belief statement, a
-- staff bio paragraph). Atoms feed pages through content_page_map —
-- the same atom can appear canonically on /kids, as a one-line
-- reference on /visit, and as a CTA-only mention on /. Without this
-- layer, the copywriter has no idea which page is the canonical home
-- for a given fact, and ends up either duplicating full detail across
-- pages or omitting it inconsistently.
--
-- Atoms are typed (similar topic enum to church_facts) but separate
-- entities: church_facts is the structured-data projection (a service
-- time row with day/time/campus columns); atoms are the prose-shaped
-- units that get rendered into copy. They overlap but serve different
-- needs — facts answer "what does the church do?", atoms answer
-- "what copy block expresses this on the site?".

CREATE TABLE IF NOT EXISTS content_atoms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id  uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,

  topic           text NOT NULL,                  -- 'kids', 'services', 'beliefs', 'location', 'staff', etc.
  label           text NOT NULL,                  -- short human handle, e.g. 'Kids check-in process'
  body            text NOT NULL,                  -- full prose form
  body_short      text,                           -- 1-sentence reference form

  -- Provenance — same enum as church_facts. Every atom traces to intake.
  source_kind     text NOT NULL,
  source_ref      text,
  -- Stable foreign key into the source system (ContentSnare reference_id,
  -- Fillout question id, etc.) — idempotent re-ingestion.
  external_ref_id text,
  source_fact_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],  -- atoms can compose multiple facts

  verbatim        boolean NOT NULL DEFAULT false,
  confidence      text NOT NULL DEFAULT 'partner_stated',

  -- Free-form usage constraints that aren't quite verbatim:
  -- "Brad & Sara — security-sensitive, first names only"
  -- "Riverwood NOT managing sermons on-site, link-out only"
  -- The writer prompt surfaces this verbatim so the model can honor it.
  handling_notes  text,

  -- Hints for the mapper agent — overrides if set, otherwise inferred.
  default_canonical_page_slug text,               -- e.g. '/kids' — where this atom usually lives
  cross_reference_hints       text[] NOT NULL DEFAULT '{}'::text[],  -- ['/visit', '/'] — pages that should reference it

  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle
  superseded_at   timestamptz,
  superseded_by   uuid REFERENCES content_atoms(id) ON DELETE SET NULL,
  archived        boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_atoms DROP CONSTRAINT IF EXISTS content_atoms_source_kind_check;
ALTER TABLE content_atoms ADD CONSTRAINT content_atoms_source_kind_check
  CHECK (source_kind IN (
    'content_collection',
    'site_crawl',
    'strategy_brief',
    'am_handoff',
    'discovery_questionnaire',
    'brand_handoff',
    'seo_report',
    'manual',
    'derived'
  ));

ALTER TABLE content_atoms DROP CONSTRAINT IF EXISTS content_atoms_confidence_check;
ALTER TABLE content_atoms ADD CONSTRAINT content_atoms_confidence_check
  CHECK (confidence IN ('partner_stated', 'inferred', 'guessed'));

CREATE INDEX IF NOT EXISTS idx_content_atoms_project_topic
  ON content_atoms (web_project_id, topic, archived)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_content_atoms_verbatim
  ON content_atoms (web_project_id, verbatim)
  WHERE verbatim = true AND superseded_at IS NULL AND archived = false;

-- Idempotent re-ingestion key for ContentSnare / Fillout sources.
DROP INDEX IF EXISTS idx_content_atoms_external_ref_unique;
CREATE UNIQUE INDEX idx_content_atoms_external_ref_unique
  ON content_atoms (web_project_id, external_ref_id)
  WHERE external_ref_id IS NOT NULL AND superseded_at IS NULL;

CREATE OR REPLACE FUNCTION update_content_atoms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_atoms_set_updated_at ON content_atoms;
CREATE TRIGGER content_atoms_set_updated_at
  BEFORE UPDATE ON content_atoms
  FOR EACH ROW EXECUTE FUNCTION update_content_atoms_updated_at();


-- ═══════════════════════════════════════════════════════════════════
-- 4. content_page_map — atom × page × role
-- ═══════════════════════════════════════════════════════════════════
--
-- This is the cross-reference matrix. For each (atom, page) pair, the
-- mapper agent decides:
--
--   role='canonical'  — this page is the main home for this atom.
--                       Full detail, full treatment, this is where
--                       the partner expects to find the information.
--   role='reference'  — mention briefly + link to canonical. Use
--                       body_short or the agent's treatment note.
--   role='cta'        — surface as a button/callout that points to
--                       the canonical page. No body content, just the
--                       hook.
--   role='context'    — background only, informs voice/framing but
--                       doesn't appear as a section. Rarer.
--
-- Atoms with NO row in this table for a given page = omit from that
-- page. Explicit omission is just an absent row; no need for an
-- 'omit' role enum value.
--
-- The matrix renders in the app as the Content Map gate (Gate 3 in
-- the pipeline). Strategist-substitute reviews and flips cells before
-- drafting starts.

CREATE TABLE IF NOT EXISTS content_page_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id  uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  atom_id         uuid NOT NULL REFERENCES content_atoms(id) ON DELETE CASCADE,
  web_page_id     uuid NOT NULL REFERENCES web_pages(id) ON DELETE CASCADE,

  role            text NOT NULL,
  treatment       text,                           -- agent's note on how to render this atom on this page

  sort_order      int NOT NULL DEFAULT 0,         -- for ordering atoms within a page's slice

  -- Audit — was this an AI mapping or a human override?
  set_by          text NOT NULL DEFAULT 'ai',     -- 'ai' | 'human' | 'rule'
  set_at          timestamptz NOT NULL DEFAULT now(),
  set_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_page_map DROP CONSTRAINT IF EXISTS content_page_map_role_check;
ALTER TABLE content_page_map ADD CONSTRAINT content_page_map_role_check
  CHECK (role IN ('canonical', 'reference', 'cta', 'context'));

ALTER TABLE content_page_map DROP CONSTRAINT IF EXISTS content_page_map_set_by_check;
ALTER TABLE content_page_map ADD CONSTRAINT content_page_map_set_by_check
  CHECK (set_by IN ('ai', 'human', 'rule'));

ALTER TABLE content_page_map DROP CONSTRAINT IF EXISTS content_page_map_unique_atom_page;
ALTER TABLE content_page_map ADD CONSTRAINT content_page_map_unique_atom_page
  UNIQUE (atom_id, web_page_id);

-- Enforce one canonical home per atom. Partial unique index — only
-- one row with role='canonical' per atom_id. Allows zero canonicals
-- (atom not yet assigned a home) and multiple reference/cta rows.
DROP INDEX IF EXISTS idx_content_page_map_canonical_unique;
CREATE UNIQUE INDEX idx_content_page_map_canonical_unique
  ON content_page_map (atom_id)
  WHERE role = 'canonical';

CREATE INDEX IF NOT EXISTS idx_content_page_map_page_role
  ON content_page_map (web_page_id, role, sort_order);

CREATE INDEX IF NOT EXISTS idx_content_page_map_atom
  ON content_page_map (atom_id, role);

CREATE OR REPLACE FUNCTION update_content_page_map_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_page_map_set_updated_at ON content_page_map;
CREATE TRIGGER content_page_map_set_updated_at
  BEFORE UPDATE ON content_page_map
  FOR EACH ROW EXECUTE FUNCTION update_content_page_map_updated_at();


-- ═══════════════════════════════════════════════════════════════════
-- 5. prompt_versions — versioned agent prompts
-- ═══════════════════════════════════════════════════════════════════
--
-- Defined BEFORE pipeline_jobs so pipeline_jobs.prompt_version_id has
-- a target to reference. Without a strategist mid-pipeline, drift is
-- our biggest enemy — and the only way to control drift is to know
-- which version of which prompt produced which result. Every job
-- captures its prompt_version_id; if a project's copy starts coming
-- back off-brand, we look at which prompt versions changed recently
-- and roll back.

CREATE TABLE IF NOT EXISTS prompt_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name         text NOT NULL,               -- 'voice_card_synthesizer', 'sitemap_generator', etc.
  version            integer NOT NULL,            -- monotonic per agent_name
  system_prompt      text NOT NULL,
  user_prompt_template text,                      -- with {{ var }} placeholders, optional
  model              text NOT NULL,               -- 'anthropic/claude-sonnet-4-6' (via gateway)
  reviewer_model     text,                        -- model for paired reviewer, if applicable
  notes              text,                        -- changelog: why this version was created
  is_active          boolean NOT NULL DEFAULT false,  -- the one currently used in production for this agent
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL
);

ALTER TABLE prompt_versions DROP CONSTRAINT IF EXISTS prompt_versions_unique_agent_version;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_unique_agent_version
  UNIQUE (agent_name, version);

-- Only one active version per agent at a time.
DROP INDEX IF EXISTS idx_prompt_versions_active_unique;
CREATE UNIQUE INDEX idx_prompt_versions_active_unique
  ON prompt_versions (agent_name)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_prompt_versions_agent
  ON prompt_versions (agent_name, version DESC);

-- Backfill the FK from church_voice_cards now that prompt_versions exists.
ALTER TABLE church_voice_cards
  DROP CONSTRAINT IF EXISTS church_voice_cards_prompt_version_fk;
ALTER TABLE church_voice_cards
  ADD CONSTRAINT church_voice_cards_prompt_version_fk
  FOREIGN KEY (generated_by_prompt_version_id)
  REFERENCES prompt_versions(id) ON DELETE SET NULL;


-- ═══════════════════════════════════════════════════════════════════
-- 6. pipeline_jobs — execution queue + state machine
-- ═══════════════════════════════════════════════════════════════════
--
-- One row per discrete unit of work in the autonomous pipeline. The
-- pg_cron tick (configured separately) reads from `pipeline_jobs_ready`
-- (view defined below) and POSTs each job to its corresponding Vercel
-- endpoint. The endpoint does the work and updates the row.
--
-- State transitions:
--
--   pending  → ready          when all blocked_by jobs are succeeded
--                              (handled by trigger on UPDATE)
--   ready    → running        when the dispatcher picks it up
--   running  → succeeded      when the worker finishes cleanly
--   running  → failed         when the worker errors. Auto-retried up
--                              to max_attempts; then terminal.
--   running  → awaiting_gate  when a gate_required job's AI work is
--                              done but human approval still needed
--   awaiting_gate → succeeded when human approves (via pipeline_feedback)
--   awaiting_gate → failed    when human sends back (a new pending
--                              job is inserted with correction_hint)
--   any      → cancelled      manual abort

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id     uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,

  step               text NOT NULL,               -- pipeline step (see CHECK below)
  status             text NOT NULL DEFAULT 'pending',

  -- Inputs / outputs / errors
  input              jsonb NOT NULL DEFAULT '{}'::jsonb,    -- per-step params (page_id, correction_hint, etc.)
  output             jsonb NOT NULL DEFAULT '{}'::jsonb,    -- result payload + IDs of created artifacts
  error              text,

  -- Retry policy
  attempt            integer NOT NULL DEFAULT 0,
  max_attempts       integer NOT NULL DEFAULT 2,

  -- Dependencies — array of pipeline_jobs.id that must be 'succeeded'
  -- before this job becomes 'ready'. Trigger below maintains the flip.
  blocked_by         uuid[] NOT NULL DEFAULT '{}'::uuid[],

  -- Gate semantics — when true, the worker is expected to flip status
  -- to 'awaiting_gate' on completion (not 'succeeded') and wait for a
  -- pipeline_feedback row.
  gate_required      boolean NOT NULL DEFAULT false,

  -- Scope hooks — let queries find "what's the current draft job for
  -- /kids?" without scanning all jobs.
  scope_page_id      uuid REFERENCES web_pages(id) ON DELETE CASCADE,
  scope_section_id   uuid,                         -- web_sections.id (no FK because web_sections schema not fully read here)

  -- Provenance
  prompt_version_id  uuid REFERENCES prompt_versions(id) ON DELETE SET NULL,
  model              text,                         -- captured at run time for cost analysis even if prompt version was bumped
  cost_usd           numeric(10,4) NOT NULL DEFAULT 0,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,

  -- Timing
  scheduled_at       timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  duration_ms        integer,

  -- Reviewer agent result (for steps that have a paired reviewer)
  reviewer_score     integer CHECK (reviewer_score BETWEEN 0 AND 10),
  reviewer_verdict   jsonb,                        -- {score, rerun, type, hint, missing_entities}
  confidence_band    text,                         -- 'green' | 'yellow' | 'red'

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_status_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_status_check
  CHECK (status IN (
    'pending',         -- waiting on dependencies
    'ready',           -- deps satisfied; dispatcher will pick up
    'running',         -- worker is in flight
    'awaiting_gate',   -- AI work done; waiting on human approval
    'succeeded',       -- terminal success
    'failed',          -- terminal failure (or retrying — see attempt vs max_attempts)
    'cancelled'        -- manual abort
  ));

ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_step_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_step_check
  CHECK (step IN (
    -- Phase A — facts & voice
    'normalize_intake',           -- web_intake_documents → church_facts + content_atoms (deterministic + Haiku assist)
    'synthesize_voice_card',
    'review_voice_card',
    'gate_voice_card',            -- human approval marker; status=awaiting_gate by default

    -- Phase B — structure
    'generate_sitemap',           -- includes nav audit
    'review_sitemap',
    'generate_content_strategy',  -- partner-facing doc
    'gate_sitemap_strategy',      -- combined gate for sitemap + content strategy

    -- Phase C — content mapping
    'generate_content_map',
    'review_content_map',
    'gate_content_map',

    -- Phase D — roadmap (the lean partner summary)
    'generate_roadmap',
    'gate_roadmap',

    -- Phase E — per-page drafting (one job per page)
    'draft_page',
    'review_page',                -- reviewer agent pass on the page draft
    'gate_phase1_pages',          -- batch gate after all Phase-1 draft+review jobs done
    'gate_phase2_pages',

    -- Phase F — partner publish
    'gate_partner_publish'
  ));

ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_confidence_band_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_confidence_band_check
  CHECK (confidence_band IS NULL OR confidence_band IN ('green', 'yellow', 'red'));

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_ready
  ON pipeline_jobs (scheduled_at)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_project_status
  ON pipeline_jobs (web_project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_awaiting_gate
  ON pipeline_jobs (web_project_id, step)
  WHERE status = 'awaiting_gate';

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_scope_page
  ON pipeline_jobs (scope_page_id, step, status)
  WHERE scope_page_id IS NOT NULL;

CREATE OR REPLACE FUNCTION update_pipeline_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pipeline_jobs_set_updated_at ON pipeline_jobs;
CREATE TRIGGER pipeline_jobs_set_updated_at
  BEFORE UPDATE ON pipeline_jobs
  FOR EACH ROW EXECUTE FUNCTION update_pipeline_jobs_updated_at();


-- ── 6a. Dependency-resolution trigger ──────────────────────────────────
--
-- When a job moves to 'succeeded', flip every pending job that listed
-- it in blocked_by to 'ready' IFF all of that pending job's blockers
-- are now succeeded. This is what makes the pipeline self-advance.

CREATE OR REPLACE FUNCTION pipeline_jobs_advance_dependents()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when a job transitions into 'succeeded'.
  IF (OLD.status IS DISTINCT FROM NEW.status) AND NEW.status = 'succeeded' THEN
    UPDATE pipeline_jobs target
    SET status = 'ready',
        scheduled_at = now()
    WHERE target.status = 'pending'
      AND NEW.id = ANY(target.blocked_by)
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(target.blocked_by) AS dep_id
        JOIN pipeline_jobs dep ON dep.id = dep_id
        WHERE dep.status <> 'succeeded'
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pipeline_jobs_advance_dependents_trigger ON pipeline_jobs;
CREATE TRIGGER pipeline_jobs_advance_dependents_trigger
  AFTER UPDATE OF status ON pipeline_jobs
  FOR EACH ROW EXECUTE FUNCTION pipeline_jobs_advance_dependents();


-- ── 6b. Ready-queue view ──────────────────────────────────────────────
--
-- pg_cron / Vercel cron poll this view. Each call gets the oldest
-- ready jobs first, FIFO within the same scheduled_at.

CREATE OR REPLACE VIEW pipeline_jobs_ready AS
SELECT *
FROM pipeline_jobs
WHERE status = 'ready'
ORDER BY scheduled_at ASC, created_at ASC;


-- ═══════════════════════════════════════════════════════════════════
-- 7. pipeline_feedback — human approvals / send-backs at gates
-- ═══════════════════════════════════════════════════════════════════
--
-- One row per human action at a gate. The trigger below promotes the
-- referenced pipeline_job from 'awaiting_gate' to 'succeeded' (on
-- approve) or 'failed' + inserts a new corrective job (on send-back).
--
-- For send-backs, the new job's `input.correction_hint` carries the
-- human's notes — that becomes the next attempt's prompt context.

CREATE TABLE IF NOT EXISTS pipeline_feedback (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_job_id          uuid NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  web_project_id           uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,

  action                   text NOT NULL,         -- 'approve' | 'approve_with_edits' | 'send_back'
  notes                    text,                  -- correction hint / edit summary
  payload                  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- structured edit deltas if applicable

  reviewed_by_employee_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pipeline_feedback DROP CONSTRAINT IF EXISTS pipeline_feedback_action_check;
ALTER TABLE pipeline_feedback ADD CONSTRAINT pipeline_feedback_action_check
  CHECK (action IN ('approve', 'approve_with_edits', 'send_back'));

CREATE INDEX IF NOT EXISTS idx_pipeline_feedback_job
  ON pipeline_feedback (pipeline_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_feedback_project
  ON pipeline_feedback (web_project_id, created_at DESC);


-- ── 7a. Feedback-application trigger ──────────────────────────────────
--
-- When a pipeline_feedback row is inserted, advance the referenced job.

CREATE OR REPLACE FUNCTION pipeline_feedback_apply()
RETURNS TRIGGER AS $$
DECLARE
  target_job pipeline_jobs%ROWTYPE;
BEGIN
  SELECT * INTO target_job FROM pipeline_jobs WHERE id = NEW.pipeline_job_id FOR UPDATE;

  IF target_job IS NULL THEN
    RAISE EXCEPTION 'pipeline_feedback references missing job %', NEW.pipeline_job_id;
  END IF;

  IF target_job.status <> 'awaiting_gate' THEN
    RAISE EXCEPTION 'pipeline_feedback on job % requires status=awaiting_gate, got %', target_job.id, target_job.status;
  END IF;

  IF NEW.action IN ('approve', 'approve_with_edits') THEN
    UPDATE pipeline_jobs
       SET status = 'succeeded',
           finished_at = now(),
           output = COALESCE(output, '{}'::jsonb)
                    || jsonb_build_object(
                         'human_action', NEW.action,
                         'human_notes',  NEW.notes,
                         'human_edits',  NEW.payload
                       )
     WHERE id = target_job.id;

  ELSIF NEW.action = 'send_back' THEN
    -- Mark the original failed; the worker layer is responsible for
    -- enqueueing a corrective job with the correction_hint. Doing it
    -- here would require knowing the corrective step + dependencies,
    -- which is pipeline-policy that's cleaner in TypeScript.
    UPDATE pipeline_jobs
       SET status = 'failed',
           finished_at = now(),
           error  = COALESCE(error, '') || E'\nSent back by human: ' || COALESCE(NEW.notes, '(no notes)')
     WHERE id = target_job.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pipeline_feedback_apply_trigger ON pipeline_feedback;
CREATE TRIGGER pipeline_feedback_apply_trigger
  AFTER INSERT ON pipeline_feedback
  FOR EACH ROW EXECUTE FUNCTION pipeline_feedback_apply();


-- ═══════════════════════════════════════════════════════════════════
-- 8. Pipeline-aware columns on existing tables
-- ═══════════════════════════════════════════════════════════════════
--
-- These tie the new pipeline state into the existing project + page
-- tables so the app's existing UI surfaces (the AI status pill in
-- WebContentManagerPage, the page draft status, etc.) can read from
-- a consistent shape.

-- Current voice-card pointer on the project for fast joins.
ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS current_voice_card_id uuid REFERENCES church_voice_cards(id) ON DELETE SET NULL;

-- Pipeline state mirror — the existing roadmap_stage stays as the
-- coarse phase label, but we add a fine-grained pointer for the UI to
-- show "currently running: synthesize_voice_card · 12s elapsed".
ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS pipeline_current_job_id uuid REFERENCES pipeline_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_last_gate_step text;

-- Per-page reviewer band so the Phase-1 review queue can sort + filter
-- without re-joining to pipeline_jobs.
ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS reviewer_band text,
  ADD COLUMN IF NOT EXISTS reviewer_verdict jsonb;

ALTER TABLE web_pages DROP CONSTRAINT IF EXISTS web_pages_reviewer_band_check;
ALTER TABLE web_pages ADD CONSTRAINT web_pages_reviewer_band_check
  CHECK (reviewer_band IS NULL OR reviewer_band IN ('green', 'yellow', 'red'));

CREATE INDEX IF NOT EXISTS idx_web_pages_review_queue
  ON web_pages (web_project_id, reviewer_band, content_status)
  WHERE content_status IN ('draft', 'in_review');


-- ═══════════════════════════════════════════════════════════════════
-- 9. RLS — staff-only across the board (mirrors v26-v34)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE church_facts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_voice_cards  ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_atoms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_page_map    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_feedback   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read church_facts" ON church_facts;
CREATE POLICY "Authenticated users can read church_facts"
  ON church_facts FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write church_facts" ON church_facts;
CREATE POLICY "Authenticated users can write church_facts"
  ON church_facts FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read church_voice_cards" ON church_voice_cards;
CREATE POLICY "Authenticated users can read church_voice_cards"
  ON church_voice_cards FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write church_voice_cards" ON church_voice_cards;
CREATE POLICY "Authenticated users can write church_voice_cards"
  ON church_voice_cards FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read content_atoms" ON content_atoms;
CREATE POLICY "Authenticated users can read content_atoms"
  ON content_atoms FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write content_atoms" ON content_atoms;
CREATE POLICY "Authenticated users can write content_atoms"
  ON content_atoms FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read content_page_map" ON content_page_map;
CREATE POLICY "Authenticated users can read content_page_map"
  ON content_page_map FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write content_page_map" ON content_page_map;
CREATE POLICY "Authenticated users can write content_page_map"
  ON content_page_map FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read prompt_versions" ON prompt_versions;
CREATE POLICY "Authenticated users can read prompt_versions"
  ON prompt_versions FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write prompt_versions" ON prompt_versions;
CREATE POLICY "Authenticated users can write prompt_versions"
  ON prompt_versions FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read pipeline_jobs" ON pipeline_jobs;
CREATE POLICY "Authenticated users can read pipeline_jobs"
  ON pipeline_jobs FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write pipeline_jobs" ON pipeline_jobs;
CREATE POLICY "Authenticated users can write pipeline_jobs"
  ON pipeline_jobs FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read pipeline_feedback" ON pipeline_feedback;
CREATE POLICY "Authenticated users can read pipeline_feedback"
  ON pipeline_feedback FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write pipeline_feedback" ON pipeline_feedback;
CREATE POLICY "Authenticated users can write pipeline_feedback"
  ON pipeline_feedback FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);


-- ═══════════════════════════════════════════════════════════════════
-- 10. Operations notes (not executed — for the human reading this)
-- ═══════════════════════════════════════════════════════════════════
--
-- pg_cron tick:
--   Once the worker endpoints exist on Vercel, schedule a Supabase
--   function (or a tiny Vercel cron route) to run every minute:
--
--     SELECT cron.schedule(
--       'pipeline-dispatch',
--       '* * * * *',
--       $$ SELECT net.http_post(
--            url := 'https://<your-app>.vercel.app/api/web/pipeline/tick',
--            headers := jsonb_build_object('x-cron-key', '<secret>')
--          ); $$
--     );
--
--   The /api/web/pipeline/tick endpoint pulls from pipeline_jobs_ready
--   (LIMIT 5 or so), marks each 'running' inside a transaction, and
--   fans out HTTP calls to the per-step worker endpoints. Each worker
--   updates its own row on completion.
--
-- Seeding prompt_versions:
--   The pipeline can't run until at least one is_active=true row exists
--   for each agent_name. Initial seed migration TBD.
--
-- Notification wiring:
--   When a job transitions to 'awaiting_gate', the worker layer should
--   also post to ClickUp / Slack with a deep link to the gate page.
--   Not modeled in this schema — it's a side effect inside the worker.
