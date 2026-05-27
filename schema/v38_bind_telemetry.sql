-- v38 — Bind telemetry.
--
-- Every bind decision (import OR variant swap) writes one row here so
-- we can see, in aggregate, which templates land cleanly and which
-- consistently drop content. Without this we're guessing — every
-- binder bug in the last sprint was found by manual eyeballing.
--
-- Row written from:
--   • webCopywriterOutput.importCopywriterPageOutput (bind_source='import')
--   • PagesWorkspace.computeBindNextValues+applyBindPayload (bind_source='variant_swap')
--
-- One row per section per bind event. Cascades when the section is
-- deleted so we don't accumulate orphan rows from re-imports.

CREATE TABLE web_bind_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  web_section_id UUID NOT NULL REFERENCES web_sections(id) ON DELETE CASCADE,
  web_project_id UUID NOT NULL REFERENCES strategy_web_projects(id) ON DELETE CASCADE,

  -- Where the bind ran.
  bind_source TEXT NOT NULL CHECK (bind_source IN ('import', 'variant_swap', 'initial_bind')),

  -- What template (and palette) was used.
  template_id TEXT NOT NULL,
  palette_template_ids TEXT[] NOT NULL DEFAULT '{}',

  -- Outcome signals.
  matched_slot_keys TEXT[] NOT NULL DEFAULT '{}',     -- top-level slot keys that ended up populated
  unmapped_source_keys TEXT[] NOT NULL DEFAULT '{}',  -- keys stashed into __unmapped
  dropped_paths TEXT[] NOT NULL DEFAULT '{}',         -- deep paths from computeDroppedDeepPaths
  used_shape_align BOOLEAN NOT NULL DEFAULT FALSE,    -- did compatible-shape matcher fire?
  used_faq_inference BOOLEAN NOT NULL DEFAULT FALSE,  -- did augmenter synthesize a FAQ group?

  -- Sizing for cost/perf trend.
  source_field_values_size_bytes INTEGER,
  bind_duration_ms INTEGER,

  -- Free-form notes (warnings caught mid-bind, e.g. value-shape phase failures).
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Project-level reads: "show me last week's binds on Riverwood."
CREATE INDEX web_bind_telemetry_project_created_idx
  ON web_bind_telemetry (web_project_id, created_at DESC);

-- Template-level reads: "how is feature-section-2 performing across all churches?"
CREATE INDEX web_bind_telemetry_template_created_idx
  ON web_bind_telemetry (template_id, created_at DESC);

COMMENT ON TABLE web_bind_telemetry IS
  'Per-section bind decisions. Read to find templates with frequent unmapped content or shape mismatches, then prioritize binder improvements.';
