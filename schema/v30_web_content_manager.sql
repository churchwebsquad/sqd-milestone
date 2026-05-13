-- v30_web_content_manager.sql
--
-- Schema for Content Manager Phase A.
--
-- Adds the project-level metadata needed for the strategist's
-- authoring workflow (roadmap stage tracking, custom snippets,
-- per-project writing rules, denominational filter, personas) plus
-- the AI agent backing stores (messages, ideas backlog) that fill
-- the Assistant Rail's Ideas/Audit tabs once AI agents wire up in
-- Phase C.
--
-- Page-level workflow status (proposed/approved per the cross-tool
-- flow with Design Manager) lives on web_pages.

-- ── 1. web_pages — page-level status ────────────────────────────────
--
-- Sections still have their own draft/in_review/approved (from v27)
-- but the page is the unit the strategist flips end-to-end. Design
-- Manager approves at the page level too.

ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'draft';

ALTER TABLE web_pages DROP CONSTRAINT IF EXISTS web_pages_content_status_check;
ALTER TABLE web_pages ADD CONSTRAINT web_pages_content_status_check
  CHECK (content_status IN ('draft', 'in_review', 'approved', 'archived'));

CREATE INDEX IF NOT EXISTS idx_web_pages_status
  ON web_pages (web_project_id, content_status, archived);

-- AI draft attribution (lets the editor surface "Drafted by AI · 2h ago"
-- and dim the badge once the strategist edits).
ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS ai_drafted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_drafted_by_stage text,  -- 'stage_5_copywriter' typically
  ADD COLUMN IF NOT EXISTS edited_since_ai boolean NOT NULL DEFAULT false;

-- ── 2. strategy_web_projects — Roadmap deliverable + AI pipeline state ─

ALTER TABLE strategy_web_projects
  -- Roadmap deliverable (the artifact, partner-addressed)
  ADD COLUMN IF NOT EXISTS roadmap_opening_paragraph text,
  ADD COLUMN IF NOT EXISTS roadmap_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS roadmap_milestone_overview text,
  ADD COLUMN IF NOT EXISTS roadmap_internal_flags jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- AI pipeline (stage tracking + per-stage approval flags)
  ADD COLUMN IF NOT EXISTS roadmap_stage text NOT NULL DEFAULT 'pre_intake',
  ADD COLUMN IF NOT EXISTS roadmap_state jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Writing rules (project overlay on top of global rules)
  ADD COLUMN IF NOT EXISTS project_writing_rules text,
  ADD COLUMN IF NOT EXISTS denominational_filter text,

  -- Personas (per-project array; not global)
  ADD COLUMN IF NOT EXISTS personas jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE strategy_web_projects DROP CONSTRAINT IF EXISTS strategy_web_projects_roadmap_stage_check;
ALTER TABLE strategy_web_projects ADD CONSTRAINT strategy_web_projects_roadmap_stage_check
  CHECK (roadmap_stage IN (
    'pre_intake',          -- intake hasn't met hard stops; AI can't run
    'ready',               -- intake met; strategist can press Begin
    'extracting_strategy', -- Stage 1 running
    'strategy_done',       -- Stage 1 complete; awaiting approval to start Stage 2
    'drafting_sitemap',
    'sitemap_done',
    'drafting_journey',
    'journey_done',
    'drafting_roadmap',    -- web roadmap per page
    'roadmap_done',
    'drafting_pages',
    'all_done'
  ));

-- ── 3. web_project_snippets — custom + AI-suggested snippets ──────────
--
-- The 17 global merge fields live on strategy_web_projects columns
-- (v28). This table holds project-scoped custom snippets and AI
-- suggestions — text expander style, with rich expansion + tags.

CREATE TABLE IF NOT EXISTS web_project_snippets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id  uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  token           text NOT NULL,                -- kebab-case; appears as {{token}} in copy
  label           text NOT NULL,                -- human-readable name
  expansion       text NOT NULL,                -- rich text content
  description     text,                         -- optional usage note
  tags            text[] NOT NULL DEFAULT '{}'::text[],
  source          text NOT NULL DEFAULT 'manual',
  used_count      integer NOT NULL DEFAULT 0,
  archived        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL
);

ALTER TABLE web_project_snippets DROP CONSTRAINT IF EXISTS web_project_snippets_source_check;
ALTER TABLE web_project_snippets ADD CONSTRAINT web_project_snippets_source_check
  CHECK (source IN ('manual', 'ai_suggested', 'extracted_from_intake'));

ALTER TABLE web_project_snippets DROP CONSTRAINT IF EXISTS web_project_snippets_unique_token;
ALTER TABLE web_project_snippets ADD CONSTRAINT web_project_snippets_unique_token
  UNIQUE (web_project_id, token);

CREATE INDEX IF NOT EXISTS idx_web_project_snippets_active
  ON web_project_snippets (web_project_id, archived, used_count DESC);

CREATE OR REPLACE FUNCTION update_web_project_snippets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS web_project_snippets_set_updated_at ON web_project_snippets;
CREATE TRIGGER web_project_snippets_set_updated_at
  BEFORE UPDATE ON web_project_snippets
  FOR EACH ROW EXECUTE FUNCTION update_web_project_snippets_updated_at();

-- ── 4. web_ai_messages — AI chat / interaction history (per-project) ─
--
-- Persists prompts + responses across sessions so the strategist can
-- see what AI suggested last week, undo specific generations, audit
-- AI billing.

CREATE TABLE IF NOT EXISTS web_ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id  uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  -- thread_key scopes messages — 'roadmap', 'page:<slug>', 'section:<id>', 'global'
  thread_key      text NOT NULL,
  role            text NOT NULL,
  content         text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE web_ai_messages DROP CONSTRAINT IF EXISTS web_ai_messages_role_check;
ALTER TABLE web_ai_messages ADD CONSTRAINT web_ai_messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'tool'));

CREATE INDEX IF NOT EXISTS idx_web_ai_messages_thread
  ON web_ai_messages (web_project_id, thread_key, created_at);

-- ── 5. web_ai_ideas — AI suggestions backlog (Assistant Rail) ────────
--
-- AI's pending proposals — add a page, add a section, restructure
-- something. Strategist accepts / dismisses / snoozes from the Ideas
-- tab on the Assistant Rail.

CREATE TABLE IF NOT EXISTS web_ai_ideas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_project_id  uuid NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,
  scope           text NOT NULL,        -- 'global' / 'page:<slug>' / 'section:<id>' / 'sitemap'
  category        text NOT NULL,        -- 'add_page' / 'add_section' / 'rewrite' / 'snippet' / 'reorder' / 'other'
  title           text NOT NULL,        -- short one-liner
  proposal        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- structured payload describing the change
  status          text NOT NULL DEFAULT 'pending',
  reason          text,                 -- AI's rationale, shown on hover/expand
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL
);

ALTER TABLE web_ai_ideas DROP CONSTRAINT IF EXISTS web_ai_ideas_status_check;
ALTER TABLE web_ai_ideas ADD CONSTRAINT web_ai_ideas_status_check
  CHECK (status IN ('pending', 'accepted', 'dismissed', 'snoozed'));

CREATE INDEX IF NOT EXISTS idx_web_ai_ideas_active
  ON web_ai_ideas (web_project_id, status, created_at DESC);

-- ── 6. RLS — staff-only ─────────────────────────────────────────────

ALTER TABLE web_project_snippets ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_ai_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_ai_ideas        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read web_project_snippets" ON web_project_snippets;
CREATE POLICY "Authenticated users can read web_project_snippets"
  ON web_project_snippets FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write web_project_snippets" ON web_project_snippets;
CREATE POLICY "Authenticated users can write web_project_snippets"
  ON web_project_snippets FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read web_ai_messages" ON web_ai_messages;
CREATE POLICY "Authenticated users can read web_ai_messages"
  ON web_ai_messages FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write web_ai_messages" ON web_ai_messages;
CREATE POLICY "Authenticated users can write web_ai_messages"
  ON web_ai_messages FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read web_ai_ideas" ON web_ai_ideas;
CREATE POLICY "Authenticated users can read web_ai_ideas"
  ON web_ai_ideas FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users can write web_ai_ideas" ON web_ai_ideas;
CREATE POLICY "Authenticated users can write web_ai_ideas"
  ON web_ai_ideas FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
