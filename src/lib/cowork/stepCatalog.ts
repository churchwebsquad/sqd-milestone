/**
 * Cowork pipeline step catalog — single source of truth for the
 * per-step UI metadata the Cowork tab consumes.
 *
 * Decouples the WORKSPACE COMPONENT (presentation) from STEP DEFINITIONS
 * (data). Adding a step, changing a description, or tweaking a starter
 * prompt happens here, not inside the React component.
 *
 * Strategist-language is the default voice. Internal skill names
 * (e.g. `synthesize-strategy`) appear in `subtitle` for developer
 * traceability but never in the user-facing title or description.
 */

/** Snapshot of the project's current state. Step definitions use this
 *  to compute statuses (done / ready / blocked / etc.) and progress.
 *  Mirrors the same fields the workspace component loads — passed in
 *  by the component on every render. */
export interface CoworkPipelineState {
  /** Number of approved+draft atoms (content_atoms) for the project. */
  atom_count:           number
  atom_sources:         number
  /** Number of approved+draft facts (church_facts) for the project. */
  fact_count:           number
  fact_sources:         number
  /** Latest content_atoms.created_at — upstream of synthesize-strategy. */
  latest_atom_at:       string | null

  // roadmap_state keys (each holds {_meta?: {generated_at?, model?}, ...})
  stage_1:               { _meta?: { generated_at?: string; model?: string } } | null
  ministry_model:        { _meta?: { generated_at?: string; model?: string } } | null
  acf_plan:              { _meta?: { generated_at?: string; model?: string } } | null
  site_strategy:         { _meta?: { generated_at?: string; model?: string } } | null
  page_allocation_plan:  { _meta?: { generated_at?: string; model?: string } } | null
  /** Per-page SEO plans (title + meta description + keyword targets +
   *  AEO Q&A) generated BEFORE page copy is written. Downstream
   *  outline + draft steps read this to keep headings, body copy,
   *  and CTAs aligned to the chosen keyword targets. Persisted to
   *  roadmap_state.page_seo_plans as `{ <slug>: { ...seo }, _meta }`. */
  page_seo_plans:        { _meta?: { generated_at?: string; model?: string } } | null
  critique_rollup:       { _meta?: { generated_at?: string; model?: string } } | null
  /** Telemetry from /api/web/cowork/handoff-to-pages — written when
   *  the cowork pipeline pushes its three artifacts into web_pages +
   *  web_sections. Drives the "Push to Pages" button state on the
   *  CoworkWorkspace header. */
  cowork_handoff_audit:  {
    ran_at?:              string
    branch?:              string
    pages?:               Record<string, unknown>
    total_atoms_preserved?:  number
    total_facts_preserved?:  number
    total_topics_preserved?: number
    any_round_trip_loss?: boolean
  } | null
  /** Strategic-goals snapshot timestamp — upstream of every step that
   *  consumes goals (3, 6, 7, 8, 9, 10, 11). When this is fresher than
   *  the step's own output, the step flips to 'stale'. */
  strategic_goals_at:    string | null

  /** Per-page progress counts (steps 8-10 span all sitemap pages). */
  page_outlines_count:   number
  page_drafts_count:     number
  page_critiques_count:  number
  /** Latest per-page critique timestamp (upstream of synthesize-critique). */
  latest_critique_at:    string | null
  /** Sitemap slugs from site_strategy.pages (or legacy stage_2.pages). */
  sitemap_slugs:         string[]

  // ── Notion-audit branch (v74) ─────────────────────────────────
  /** When set, the project takes the audit-external-copy branch:
   *  steps 8-10 collapse into a single autonomous audit pass that
   *  scores existing Notion copy against the 5 axes. Drawn from
   *  strategy_web_projects.notion_database_id. */
  notion_database_id:    string | null
  notion_database_url:   string | null
}

/** Status a step card displays. Maps onto a colored pill in the UI. */
export type StepStatus =
  | 'done'                    // green check
  | 'ready'                   // blue, primary action available
  | 'stale'                   // yellow, output exists but upstream newer
  | 'blocked_waiting'         // gray, upstream not done yet
  | 'cowork_session'          // purple, copy-prompt action
  | 'aggregate_info'          // gray, no action (steps 1-2)

/** What kind of action the step card surfaces. */
export type StepKind =
  /** Strategist clicks Run on the Cowork tab; Vercel endpoint fires. */
  | 'web_ui'
  /** Strategist copies the prompt, pastes into Claude Desktop. */
  | 'cowork_session'
  /** Informational only (extraction is driven elsewhere). */
  | 'aggregate_info'

export interface StepCatalogEntry {
  /** Stable identifier (used in URL state, React keys). */
  key:           string
  step_number:   number
  /** Strategist-language phrase. ~5-7 words. */
  title:         string
  /** Internal skill name (mono caption under the title). */
  subtitle:      string
  /** 1-2 sentence plain-language explanation. NOT the SKILL.md
   *  description (those are model-facing). */
  description:   string
  kind:          StepKind
  /** Vercel endpoint path (web_ui kind only). */
  endpoint?:     string
  /** roadmap_state key (or nested path) that holds this step's
   *  output. Used by the artifact drawer. Empty for aggregate_info
   *  steps (no single artifact). */
  output_key?:   string
  /** Markdown prompt template for cowork_session steps. The token
   *  `{{project_id}}` gets substituted at copy time. */
  starter_prompt?: string
  /** Relative path to the SKILL.md for the "Open SKILL" link. */
  skill_md_path?: string
  /** Function returning per-step status. Has access to project state
   *  + a reference to the catalog (for upstream lookups). */
  computeStatus: (s: CoworkPipelineState) => StepStatus
  /** Optional accessor for the last-run timestamp (web_ui done steps
   *  show "Last run … · model"). */
  lastRunAt?:    (s: CoworkPipelineState) => string | null
  lastModel?:    (s: CoworkPipelineState) => string | null
  /** Optional progress descriptor for aggregate steps (1, 2, 8, 9, 10).
   *  Returns done count + total count + label. */
  progress?:     (s: CoworkPipelineState) => { done: number; total: number; label: string }
  /** Optional: when status==='stale', returns the upstream artifact
   *  that bumped fresh past this step's output (so the UI can surface
   *  "stale because <upstream> changed at <ts>"). null when stale isn't
   *  due to a tracked upstream (or status isn't stale). */
  staleReason?:  (s: CoworkPipelineState) => StaleReason | null
}

/** Common helper — refuse if output is at least as fresh as upstream.
 *  Mirrors the server-side stalenessGuard.decideStaleness logic. */
function fresherThan(outputAt: string | undefined | null, upstreamAt: string | null): boolean {
  if (!outputAt) return false
  if (!upstreamAt) return true   // output exists, no upstream timestamp resolved
  return outputAt >= upstreamAt
}

/** Resolve the latest timestamp from an arbitrary list of upstream
 *  candidates. nulls are skipped. Used by steps with multiple
 *  upstream sources (e.g. step 6 watches both ministry_model AND
 *  strategic_goals). */
function latestOf(...candidates: Array<string | null | undefined>): string | null {
  let max: string | null = null
  for (const c of candidates) {
    if (!c) continue
    if (!max || c > max) max = c
  }
  return max
}

/** Resolved stale-reason for a step card. Names which upstream
 *  artifact got fresher than this step's output. UI surfaces this in
 *  a tooltip/banner so the strategist sees *why* before re-running. */
export interface StaleReason {
  upstream_label: string     // e.g. 'site_strategy' / 'stage_1' / 'strategic_goals'
  upstream_at:    string     // ISO timestamp
  output_at:      string     // ISO timestamp of THIS step's last run
}

/** Per-step upstream-source descriptor. Each step's computeStatus
 *  uses these to derive both its status pill AND the StaleReason
 *  shown to the strategist when stale. Pulled from the same state
 *  shape so there's one source of truth. */
type UpstreamRef = { label: string; getAt: (s: CoworkPipelineState) => string | null }

function staleReasonFor(
  state: CoworkPipelineState,
  outputAt: string | null,
  upstreams: UpstreamRef[],
): StaleReason | null {
  if (!outputAt) return null
  // Pick the upstream with the LATEST timestamp that exceeds output_at.
  let winner: { label: string; at: string } | null = null
  for (const u of upstreams) {
    const at = u.getAt(state)
    if (!at) continue
    if (at <= outputAt) continue
    if (!winner || at > winner.at) winner = { label: u.label, at }
  }
  if (!winner) return null
  return { upstream_label: winner.label, upstream_at: winner.at, output_at: outputAt }
}

/** The audit-branch alternates for steps 8-10 + a supplemental step.
 *  Returned when the project has notion_database_id set; otherwise
 *  the default outline/draft/critique trio applies. Defined at the
 *  bottom of this file (below COWORK_STEPS_BASE) so the entries can
 *  reference the shared helpers + types declared above. */
const COWORK_STEPS_BASE: StepCatalogEntry[] = [
  // ── Inventory extraction (informational; driven outside the tab) ───
  {
    key:         'extract-strategic-pillars',
    step_number: 1,
    title:       'Pull out the core messages',
    subtitle:    'extract-strategic-pillars',
    description:
      'Reads the strategy brief, discovery questionnaire, brand guide, and AM handoff. ' +
      'Extracts the church\'s mission, vision, voice samples, value statements, and personas as discrete "core messages" the rest of the pipeline can route to pages.',
    kind:        'aggregate_info',
    computeStatus: () => 'aggregate_info',
    progress: s => ({
      done:  s.atom_count,
      total: s.atom_count,   // no "total expected" — extraction yield is what it is
      label: `${s.atom_count} core message${s.atom_count === 1 ? '' : 's'} from ${s.atom_sources} source${s.atom_sources === 1 ? '' : 's'}`,
    }),
  },
  {
    key:         'parse-facts-csv',
    step_number: 2,
    title:       'Capture the site facts',
    subtitle:    'parse-facts-csv',
    description:
      'Reads structured sources (staff lists, service times, location details, ministry rosters). ' +
      'Captures each as a fact row the page-writer skill can drop directly into copy without invention.',
    kind:        'aggregate_info',
    computeStatus: () => 'aggregate_info',
    progress: s => ({
      done:  s.fact_count,
      total: s.fact_count,
      label: `${s.fact_count} fact${s.fact_count === 1 ? '' : 's'} from ${s.fact_sources} source${s.fact_sources === 1 ? '' : 's'}`,
    }),
  },

  // ── Project-level pipeline (web UI Run buttons) ───────────────────
  {
    key:         'synthesize-strategy',
    step_number: 3,
    title:       'Build the strategic foundation',
    subtitle:    'synthesize-strategy',
    description:
      'Reads every approved core message + the discovery questionnaire and synthesizes the project\'s strategic foundation: 3-5 named personas, voice exemplars to imitate, things this church doesn\'t sound like, the ethos statement, and the x-factor.',
    kind:        'web_ui',
    endpoint:    '/api/web/agents/run-synthesize-strategy',
    output_key:  'stage_1',
    computeStatus: s => {
      const out = s.stage_1?._meta?.generated_at
      if (!out)                           return 'ready'
      // Step 3 consumes the strategic_goals snapshot — when the strategist
      // edits/approves a field, mutateField bumps strategic_goals._meta.
      // Treat that bump like an atom edit for staleness purposes.
      const upstream = latestOf(s.latest_atom_at, s.strategic_goals_at)
      if (fresherThan(out, upstream))     return 'done'
      return 'stale'
    },
    staleReason: s => staleReasonFor(s, s.stage_1?._meta?.generated_at ?? null, [
      { label: 'content_atoms (newest edit)', getAt: ss => ss.latest_atom_at },
      { label: 'strategic_goals',             getAt: ss => ss.strategic_goals_at },
    ]),
    lastRunAt: s => s.stage_1?._meta?.generated_at ?? null,
    lastModel: s => s.stage_1?._meta?.model ?? null,
  },
  {
    key:         'classify-ministry',
    step_number: 4,
    title:       'Identify the ministry style',
    subtitle:    'classify-ministry',
    description:
      'Decides whether this church\'s primary posture is attractional (Sunday is the front door), discipleship (Sunday is the launchpad), or missional (the church exists for the city). Drives the page-template choices downstream.',
    kind:        'web_ui',
    endpoint:    '/api/web/agents/run-classify-ministry',
    output_key:  'ministry_model',
    computeStatus: s => {
      if (!s.stage_1?._meta?.generated_at)                     return 'blocked_waiting'
      const out = s.ministry_model?._meta?.generated_at
      if (!out)                                                return 'ready'
      if (fresherThan(out, s.stage_1._meta.generated_at ?? null)) return 'done'
      return 'stale'
    },
    staleReason: s => staleReasonFor(s, s.ministry_model?._meta?.generated_at ?? null, [
      { label: 'stage_1', getAt: ss => ss.stage_1?._meta?.generated_at ?? null },
    ]),
    lastRunAt: s => s.ministry_model?._meta?.generated_at ?? null,
    lastModel: s => s.ministry_model?._meta?.model ?? null,
  },
  {
    key:         'organize-acf',
    step_number: 5,
    title:       'Map content to audience and funnel',
    subtitle:    'organize-acf',
    description:
      'Routes every core message and fact into an Audience × Category × Funnel-stage matrix. Surfaces which audiences are well-covered and where the strategy has gaps before page-writing starts.',
    kind:        'web_ui',
    endpoint:    '/api/web/agents/run-organize-acf',
    output_key:  'acf_plan',
    computeStatus: s => {
      if (!s.stage_1?._meta?.generated_at)                     return 'blocked_waiting'
      const out = s.acf_plan?._meta?.generated_at
      if (!out)                                                return 'ready'
      if (fresherThan(out, s.stage_1._meta.generated_at ?? null)) return 'done'
      return 'stale'
    },
    staleReason: s => staleReasonFor(s, s.acf_plan?._meta?.generated_at ?? null, [
      { label: 'stage_1', getAt: ss => ss.stage_1?._meta?.generated_at ?? null },
    ]),
    lastRunAt: s => s.acf_plan?._meta?.generated_at ?? null,
    lastModel: s => s.acf_plan?._meta?.model ?? null,
  },
  {
    key:         'plan-site-strategy',
    step_number: 6,
    title:       'Plan the sitemap and navigation',
    subtitle:    'plan-site-strategy',
    description:
      'Decides the page list, the navigation structure, and a journey through the site for each persona. Names which pages carry over from the current site vs. need writing from scratch.',
    kind:        'web_ui',
    endpoint:    '/api/web/agents/run-plan-site-strategy',
    output_key:  'site_strategy',
    computeStatus: s => {
      if (!s.ministry_model?._meta?.generated_at)              return 'blocked_waiting'
      const out = s.site_strategy?._meta?.generated_at
      if (!out)                                                return 'ready'
      // Step 6 consumes nav_satisfaction, primary_goals, ministries_to_grow,
      // top_3_website_goals, ideal_website_experience — all in strategic_goals.
      const upstream = latestOf(s.ministry_model._meta.generated_at ?? null, s.strategic_goals_at)
      if (fresherThan(out, upstream))                          return 'done'
      return 'stale'
    },
    staleReason: s => staleReasonFor(s, s.site_strategy?._meta?.generated_at ?? null, [
      { label: 'ministry_model',  getAt: ss => ss.ministry_model?._meta?.generated_at ?? null },
      { label: 'strategic_goals', getAt: ss => ss.strategic_goals_at },
    ]),
    lastRunAt: s => s.site_strategy?._meta?.generated_at ?? null,
    lastModel: s => s.site_strategy?._meta?.model ?? null,
  },

  // ── Cowork session: project-level allocation ──────────────────────
  {
    key:         'plan-cross-page-allocation',
    step_number: 7,
    title:       'Decide what goes on which page',
    subtitle:    'plan-cross-page-allocation',
    description:
      'The strategic call. Decides which core messages, facts, and crawled content land on which page, and how each source should be used (verbatim quote, summarized, drop-in card, etc.). The strategist does this in conversation with Claude so they can push back on each routing decision.',
    kind:        'cowork_session',
    output_key:  'page_allocation_plan',
    skill_md_path: 'cowork-skills/plan-cross-page-allocation/SKILL.md',
    starter_prompt:
`Use the **plan-cross-page-allocation** skill to produce a page_allocation_plan for project_id \`{{project_id}}\`.

## Inputs (attached, NOT MCP)

I'm attaching:
1. The plan-cross-page-allocation **SKILL.md**.
2. The **project bundle** \`cowork-pipeline.<partner>.project-bundle.json\` — one JSON that holds every read this step needs in-context. **Do not fan out individual MCP SELECTs to load these — the bundle has them already.** The bundle carries:
   - \`stage_1\`, \`ministry_model\`, \`strategic_goals_approved\` (filtered to status='approved' for you)
   - \`site_strategy\` (full step-6 artifact: pages + persona_journeys + page_elevations + nav_change_level + nav_drop_candidates)
   - \`acf_plan\` (full step-5 artifact: atom_routes + fact_routes + cell_density + coverage_gaps)
   - \`atoms_pool.by_id\` / \`facts_pool.by_id\` / \`crawl_topics_pool.by_key\` — the FULL content inventory
   - \`partner_added_inventory[]\` — the partner's "Add something we missed" submissions from content collection (fourth source kind; route each entry whose bucket maps to a page)
   - \`canonical_templates\` (slot vocab + pickable_templates allow-list)
   - \`prior_handoff_notes.site_strategy\` — read this FIRST so you don't re-litigate the step-6 strategist's decisions
   - \`build_directives_by_page\` (when present from prior runs)

If something genuinely isn't in the bundle and you need it, fall back to a single targeted MCP SELECT — but the bundle is shaped for this step, so check it carefully before fanning out.

## Read order

1. \`prior_handoff_notes.site_strategy\` — what step 6 already settled. Honor it.
2. \`strategic_goals_approved\` — especially weigh:
   - \`content_and_allocation.copy_approach.derived.intended_verbatim_band\` (high/mid/low) sets the verbatim-vs-rewrite ratio. Every \`allocations[].intended_verbatim_band\` MUST equal this approved band.
   - \`content_and_allocation.ministries_to_grow\` — every named ministry MUST get a featured allocation on the homepage AND on its own page if one exists.
   - \`content_and_allocation.content_needs\` (AM handoff), \`best_outreach_methods\`, \`additional_clarifications\`.
   - \`goals_and_vision.top_3_website_goals\` + \`ideal_website_experience\` — frame page-level emphasis.
3. \`site_strategy.persona_journeys[]\` + \`site_strategy.page_elevations[]\` — the journey ordering + which pages elevate which goals.
4. \`acf_plan.atom_routes[]\` + \`fact_routes[]\` — which Audience × Category × Funnel cell each source lives in.
5. \`partner_added_inventory[]\` — every entry whose \`bucket_key\` clearly maps to a planned page MUST be routed somewhere. Bucket → page mapping (e.g. ways_to_give → /give, care → /care, kids → /kids, global_outreach → /local-global or /missions).
6. Atoms/facts/crawl pools — the source bodies the allocation routes.

Walk me through each page's allocation as you produce it — pause for my push-back before persisting.

## Persist — column-free chunked write (load-bearing)

Two failures we have to avoid every time:

**(A) Output-limit failure** — a naked \`SELECT roadmap_state_set(...)\` returns the full ~370 KB roadmap_state on success and blows the MCP output limit. **Every \`roadmap_state_set\` call MUST be wrapped in \`IS NOT NULL\`.**

**(B) Input-size failure** — emitting a single \`execute_sql\` with all chunks inline as VALUES exceeds your output token cap (~32 KB SQL) once the allocation grows past ~12 KB raw JSON. The session improvises ad-hoc temp tables, mid-stream socket disconnects leave state partial. This is what broke step 7 on Arvada (2026-06-17).

**Use the column-free scratchpad pattern.** Every individual statement < 8 KB SQL. See the SKILL §Persist for the full rationale. The four-step shape:

\`\`\`sql
-- Step 1: clear prior scratch (idempotent)
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_allocation_plan}'
WHERE id = '{{project_id}}'::uuid;

-- Step 2: stage each chunk (one tiny call per chunk index)
UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  COALESCE(roadmap_state, '{}'::jsonb),
  ARRAY['_chunks','page_allocation_plan','<INDEX>'],
  to_jsonb('<BASE64-CHUNK>'::text)
)
WHERE id = '{{project_id}}'::uuid;

-- Step 3: assemble + verify + write + return BOOLEAN
WITH chunks AS (
  SELECT (e.key)::int AS ix, e.value AS b64
  FROM strategy_web_projects p,
       jsonb_each_text(p.roadmap_state -> '_chunks' -> 'page_allocation_plan') AS e
  WHERE p.id = '{{project_id}}'::uuid
),
body_cte AS (
  SELECT convert_from(decode(string_agg(b64, '' ORDER BY ix), 'base64'), 'UTF8') AS body
  FROM chunks
)
SELECT
  CASE WHEN md5(body) = '<LOCAL-MD5>'
    THEN (roadmap_state_set('{{project_id}}'::uuid, ARRAY['page_allocation_plan'], body::jsonb) IS NOT NULL)
    ELSE false
  END AS ok
FROM body_cte;

-- Step 4: clear scratch
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_allocation_plan}'
WHERE id = '{{project_id}}'::uuid;
\`\`\`

Each chunk write is idempotent. Step 3 \`false\` → re-emit the bad chunk via Step 2 and re-run Step 3. Never silently proceed.

Inspect staged chunks without pulling the payload:
\`SELECT jsonb_object_keys(roadmap_state -> '_chunks' -> 'page_allocation_plan') FROM strategy_web_projects WHERE id = '{{project_id}}'::uuid;\`

**Final substep — handoff note.** Before declaring this step done, write a ≤1-screen handoff note to \`roadmap_state.page_allocation_plan._meta.handoff_note\` AND surface it as a paste-ready block in the conversation. Cover (a) what was written + where, (b) any open/deferred issues or validator gaps, (c) cross-step gotchas the next session (outline-page) needs to honor — banned vocab, per-page exceptions, persona postures, copy-approach band, ministries-to-grow placement, build_directives that affect outlining, partner_added entries surfaced — and (d) what outline-page should read + decisions already litigated.`,
    computeStatus: s => {
      if (!s.site_strategy?._meta?.generated_at) return 'blocked_waiting'
      const out = s.page_allocation_plan?._meta?.generated_at
      if (!out) return 'cowork_session'
      // Step 7 consumes copy_approach (verbatim band), ministries_to_grow,
      // content_needs, best_outreach_methods, top_3_website_goals, etc.
      const upstream = latestOf(s.site_strategy._meta.generated_at ?? null, s.strategic_goals_at)
      if (fresherThan(out, upstream)) return 'done'
      return 'stale'
    },
    staleReason: s => staleReasonFor(s, s.page_allocation_plan?._meta?.generated_at ?? null, [
      { label: 'site_strategy',   getAt: ss => ss.site_strategy?._meta?.generated_at ?? null },
      { label: 'strategic_goals', getAt: ss => ss.strategic_goals_at },
    ]),
    lastRunAt: s => s.page_allocation_plan?._meta?.generated_at ?? null,
    lastModel: s => s.page_allocation_plan?._meta?.model ?? null,
  },

  // ── SEO plan generation — BEFORE copy is written ───────────────────
  // Runs after allocation (so we know which content is on which page)
  // and BEFORE outline + draft (so headings, body, and CTAs can be
  // written against a chosen keyword target instead of after-the-fact
  // retrofitting). Output persists to roadmap_state.page_seo_plans and
  // is copied into web_pages.seo at handoff-to-pages, so the same
  // record drives WordPress / RankMath / Yoast injection downstream.
  {
    key:         'plan-page-seo',
    step_number: 8,
    title:       'Plan SEO for each page',
    subtitle:    'plan-page-seo',
    description:
      'Writes the per-page SEO plan before copy is drafted: primary keyword target, secondary keywords, meta title + meta description drafts, AEO Q&A candidates, and local GEO signals. The outline + copy steps then write against these targets so headings and body actually align with the search intent we chose, not the other way around.',
    kind:        'web_ui',
    endpoint:    '/api/web/agents/run-plan-page-seo',
    output_key:  'page_seo_plans',
    computeStatus: s => {
      if (!s.page_allocation_plan?._meta?.generated_at) return 'blocked_waiting'
      const out = s.page_seo_plans?._meta?.generated_at
      if (!out)                                          return 'ready'
      // Freshens when the sitemap changes (page list) OR allocation
      // shifts (what content each page carries) OR strategic goals
      // move (audience / voice).
      const upstream = latestOf(
        s.site_strategy?._meta?.generated_at ?? null,
        s.page_allocation_plan._meta.generated_at ?? null,
        s.strategic_goals_at,
      )
      if (fresherThan(out, upstream))                    return 'done'
      return 'stale'
    },
    staleReason: s => staleReasonFor(s, s.page_seo_plans?._meta?.generated_at ?? null, [
      { label: 'site_strategy',        getAt: ss => ss.site_strategy?._meta?.generated_at ?? null },
      { label: 'page_allocation_plan', getAt: ss => ss.page_allocation_plan?._meta?.generated_at ?? null },
      { label: 'strategic_goals',      getAt: ss => ss.strategic_goals_at },
    ]),
    lastRunAt: s => s.page_seo_plans?._meta?.generated_at ?? null,
    lastModel: s => s.page_seo_plans?._meta?.model ?? null,
  },

  // ── Cowork session: per-page work ─────────────────────────────────
  {
    key:         'outline-page',
    step_number: 9,
    title:       'Outline each page',
    subtitle:    'outline-page',
    description:
      'For each page in the sitemap, picks the section layouts and assigns each section\'s sources (which core messages, facts, and quoted content each section will land). One short conversation per page.',
    kind:        'cowork_session',
    skill_md_path: 'cowork-skills/outline-page/SKILL.md',
    starter_prompt:
`Use the **outline-page** skill for project_id \`{{project_id}}\`. Walk the sitemap sequentially — don't ask me which page to start on, you have the list.

## Inputs (attached, NOT MCP)

I'm attaching two files to this conversation:
1. The outline-page **SKILL.md** (contract + slot rules + verification checklist).
2. The **project bundle** \`cowork-pipeline.<partner>.project-bundle.json\` — every read you need for the whole sitemap, pre-packaged. Atoms/facts/crawl pools indexed by id AND topic so source refs resolve in-context. Allocations keyed by page_slug. Handoff notes from prior steps. Canonical templates slot vocab. Strategic goals filtered to approved-only.

**Read the bundle first.** Skim \`prior_handoff_notes.site_strategy\`, \`prior_handoff_notes.page_allocation_plan\`, and \`prior_handoff_notes.page_seo_plans\` so you start with the allocation strategist's decisions and the SEO keyword targets already loaded.

## Workflow — ONE MCP write per page

For each page in \`sitemap_pages\` (walk by \`nav_order\`):

1. Look up the allocation in-context: \`allocations_by_page[<slug>]\` plus \`build_directives_by_page[<slug>]\`.
2. Look up the SEO plan for this page: \`page_seo_plans.pages[<slug>]\` — this is the keyword target the outline MUST route sections against. Fields you'll use: \`primary_keyword\`, \`secondary_keywords\`, \`h1_directive\`, \`aeo_qa\` (the featured-snippet Q&A candidates the outline should reserve a section for), \`search_intent\` (drives whether the page opens with an answer or a story), and \`local_geo\` (informs whether a section carries neighborhood / city context). Never skip this — it's what turns the outline into an SEO-aware plan instead of a generic one.
3. Resolve each \`section_intents[].sources[].ref\` against the bundle pools:
   - \`kind='pillar'\` → \`atoms_pool.by_id[ref]\` (fall back to \`atoms_pool.by_topic[ref]\` for topic-keyed drift)
   - \`kind='fact'\` → \`facts_pool.by_id[ref]\` (fall back to \`facts_pool.by_topic[ref]\` — fixes the \`'service_times'\` / \`'kids'\` topic-ref drift)
   - \`kind='crawl_topic'\` → \`crawl_topics_pool.by_key[ref]\` (passages capped 10 × 600 chars; if \`passages_truncated\` and the page genuinely needs more, that's the ONE valid case to run a direct SELECT)
4. Apply strategic_goals_approved gates:
   - \`content_and_allocation.copy_approach.derived.intended_verbatim_band\` — stamp on each section.
   - \`voice_and_tone.one_key_message\` + \`recurring_message_theme\` — at least one section's voice anchors against these.
   - \`content_and_allocation.ministries_to_grow\` — surface early on homepage / ministry pages.
5. Walk me through the outline before persisting; pause for my pushback.
6. **Persist via the column-free chunked-write pattern** (see SKILL §Persist for the full rationale + recovery hints). Each per-page write is:

\`\`\`sql
-- Step 1: clear scratch
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_outlines,<slug>}'
WHERE id = '{{project_id}}'::uuid;

-- Step 2: stage each chunk (≤6 KB base64 per call)
UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  COALESCE(roadmap_state, '{}'::jsonb),
  ARRAY['_chunks','page_outlines','<slug>','<INDEX>'],
  to_jsonb('<BASE64-CHUNK>'::text)
)
WHERE id = '{{project_id}}'::uuid;

-- Step 3: assemble + verify + write + return BOOLEAN
WITH chunks AS (
  SELECT (e.key)::int AS ix, e.value AS b64
  FROM strategy_web_projects p,
       jsonb_each_text(p.roadmap_state -> '_chunks' -> 'page_outlines' -> '<slug>') AS e
  WHERE p.id = '{{project_id}}'::uuid
),
body_cte AS (SELECT convert_from(decode(string_agg(b64, '' ORDER BY ix), 'base64'), 'UTF8') AS body FROM chunks)
SELECT
  CASE WHEN md5(body) = '<LOCAL-MD5>'
    THEN (roadmap_state_set('{{project_id}}'::uuid, ARRAY['page_outlines','<slug>'], body::jsonb) IS NOT NULL)
    ELSE false
  END AS ok
FROM body_cte;

-- Step 4: clear scratch
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_outlines,<slug>}'
WHERE id = '{{project_id}}'::uuid;
\`\`\`

**Small outlines (≤12 KB raw JSON) can skip the scratchpad** and inline-write directly:

\`\`\`sql
SELECT roadmap_state_set('{{project_id}}'::uuid, ARRAY['page_outlines','<slug>'], '<inline_jsonb>'::jsonb) IS NOT NULL AS ok;
\`\`\`

The \`IS NOT NULL\` wrapper is mandatory even for inline writes — without it the RPC's full-state return floods the MCP output (the failure that broke step 7 on Arvada).

The outline's \`_meta\` MUST carry \`handoff_note\` (≤1-screen markdown — see the SKILL). The drafter reads it first on its next page.

**No per-page RPC fan-out.** The legacy \`cowork_load_outline_context(...)\` is a fallback — don't run it as part of routine flow.`,
    computeStatus: s => {
      if (!s.page_allocation_plan?._meta?.generated_at) return 'blocked_waiting'
      if (s.page_outlines_count === 0)                  return 'cowork_session'
      if (s.page_outlines_count === s.sitemap_slugs.length) return 'done'
      return 'cowork_session'
    },
    progress: s => ({
      done:  s.page_outlines_count,
      total: s.sitemap_slugs.length || 0,
      label: `${s.page_outlines_count} of ${s.sitemap_slugs.length || '?'} page${s.sitemap_slugs.length === 1 ? '' : 's'} outlined`,
    }),
  },
  {
    key:         'draft-page',
    step_number: 10,
    title:       'Write each page',
    subtitle:    'draft-page',
    description:
      'For each outlined page, writes the actual copy — every heading, body paragraph, card, and CTA. Reads the outline + the strategic foundation + the source material. One short conversation per page.',
    kind:        'cowork_session',
    skill_md_path: 'cowork-skills/draft-page/SKILL.md',
    starter_prompt:
`Use the **draft-page** skill for project_id \`{{project_id}}\`. Walk \`sitemap_pages\` in \`nav_order\` — don't ask me which page to start on.

## Inputs (attached, NOT MCP)

I'm attaching:
1. The draft-page **SKILL.md**.
2. The **project bundle** \`cowork-pipeline.<partner>.project-bundle.json\` — same file outline-page consumed. You read atoms_pool / facts_pool / crawl_topics_pool / stage_1 / strategic_goals_approved / canonical_templates / sitemap_pages from it in-context.

**Read \`prior_handoff_notes.page_outlines\` first** — the outline strategist's cross-step gotchas (voice anchor exemplars, persona postures, banned phrases, key_message section, mechanical-scan close calls). Also skim \`prior_handoff_notes.page_seo_plans\` so you know each page's chosen primary_keyword + secondary keywords + AEO Q&A candidates before you start writing headings.

## SEO ingestion — each page's plan is load-bearing on copy

Before drafting any slot for a page, look up its SEO plan in the bundle: \`page_seo_plans.pages[<slug>]\`. The plan carries \`primary_keyword\`, \`secondary_keywords\`, \`meta_title\`, \`meta_description\`, \`h1_directive\`, \`aeo_qa\` (question / short_answer pairs), \`local_geo\`, and \`search_intent\`. Draft this way:

- The page's H1 MUST fulfill \`h1_directive\`. That directive tells you the intent behind the H1; draft the actual copy in the church's voice.
- Weave the \`primary_keyword\` naturally into the H1 and the first body paragraph. Never keyword-stuff — one clean, human-readable mention beats five awkward ones.
- Weave 2-3 \`secondary_keywords\` across the page. Prefer subheadings + card headings; body paragraphs when nothing else fits.
- For each \`aeo_qa\` question the outline reserved a section for, draft the section body so its lead sentence directly answers the question — that's what earns the featured snippet.
- If \`local_geo\` is set + the page has a local surface (Visit / Contact / Locations), include the city / neighborhood explicitly in at least one section heading or body line.
- If a copy line would keyword-stuff or fight the church's voice, prefer the voice — surface the tension in the batch review so the strategist can decide.

## Workflow — 5-page BATCHES (draft → show full copy → revise → combined persist)

Drafting is fast; the bottleneck is the strategist's review + persistence. So we batch. Walk \`sitemap_pages\` in chunks of FIVE pages. Per batch:

### 1. Draft all 5

For each page in the batch:
- Load the outline (one SELECT per page — the bundle doesn't inline page_outlines because they're written mid-session by step 8):
  \`SELECT roadmap_state->'page_outlines'->'<slug>' AS outline FROM strategy_web_projects WHERE id = '{{project_id}}';\`
- Look up resources from the bundle in-context: \`stage_1\`, \`strategic_goals_approved.content_and_allocation.copy_approach.derived.intended_verbatim_band\`, \`strategic_goals_approved.voice_and_tone.one_key_message\`, \`atoms_pool.by_id\`, \`facts_pool.by_id\`, \`crawl_topics_pool.by_key\`.
- **MANDATORY full source-read step BEFORE drafting any slot of any page** (see SKILL.md §Source coverage). Walk every assigned crawl topic's FULL \`items\` tree, every kind. Never \`[:N]\`. Never subset kinds. This is what burned Desert Springs.
- Draft per the SKILL contract. Each section stamps \`actual_verbatim_ratio\` AND a \`source_coverage[]\` report (one entry per assigned source per kind, with every items[] leaf marked \`rendered\` / \`deferred\` / \`coverage_gap\`).

### 2. Show ALL 5 pages in chat — FULL rendered copy, not JSON

Render the batch as a scannable spread:

\`\`\`
# /<slug-1>  (template_archetype_list — e.g. "hero_inner · content_image_text_b · feature_card_carousel_proxy")
## Section 1 — <template_key>  ·  verbatim ratio: 0.78 / band: high ✓
🔒 <verbatim atom text exactly as it will land in slot X>
✍️ <drafter-written text for slot Y>
✍️ <drafter-written text for slot Z>
…build_cards (for feature_card_carousel_proxy): 🔒/✍️ heading + body + cta label/url per card…

## Section 2 — …
…
\`\`\`

**Marker rules:**
- 🔒 = locked / verbatim atom text (the church's own words, preserved character-for-character).
- ✍️ = drafter-authored text (you wrote it; the strategist may revise it without breaking any contract).

Show EVERY slot of EVERY section of all 5 pages, with the exact words that will appear on the page. **NOT JSON. NOT abbreviated.** Pad with per-section verbatim ratio + band status (\`band: high ✓\` / \`band: mid ✓\` / \`band: high ✗ verbatim_band_unreachable\` etc.).

### 3. Collect consolidated revisions

Wait for the strategist to walk the batch and feed back a single consolidated revision pass (edits, swaps, "kick this section to a different template", template-swap-back-to-outline asks, cap_override authorizations for long bodies, etc.).

When the strategist edits a 🔒 line: keep the atom_id in \`atoms_used\` AND log a \`section.verbatim_overrides[]\` entry: \`{atom_id, reason: "strategist_directed_modification", note: "<what they changed and why>"}\`. If the change drops the section under its \`intended_verbatim_band\`, stamp \`band_status: "verbatim_band_unreachable"\` + a \`band_note\`. critique-page treats logged overrides as authorized.

When the strategist authorizes a \`max_chars\` cap waiver (e.g. "the section 16 long-form body holds a full pastor bio, don't trim to 400"): add the slot to that section's \`cap_overrides: [...]\` array; the self-validator skips the cap check for that slot. Only the strategist can authorize; only for layouts known to support long text (NEVER headings, taglines, CTA labels).

### 4. Polish + re-validate

Re-run all draft-page self-validation steps (mechanical scan, source-coverage cross-foot, no-fabrication spot check) against the revised batch. Fix any new violations.

### 5. Persist each page in the batch via the column-free chunked-write pattern

Trim each draft to the lean shape (see SKILL.md §Persistence — drop \`char_budgets\`, prune \`voice_notes_by_slot\` to slots with a real note only). Then for EACH of the 5 pages, run the four-step pattern (SKILL.md §Persist has the full recipe + recovery hints):

\`\`\`sql
-- Step 1: clear scratch for this page (idempotent)
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_drafts,<slug>}'
WHERE id = '{{project_id}}'::uuid;

-- Step 2: stage each chunk (one tiny call per chunk index, ≤6 KB base64 per chunk)
UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  COALESCE(roadmap_state, '{}'::jsonb),
  ARRAY['_chunks','page_drafts','<slug>','<INDEX>'],
  to_jsonb('<BASE64-CHUNK>'::text)
)
WHERE id = '{{project_id}}'::uuid;

-- Step 3: assemble + verify + write + return BOOLEAN
WITH chunks AS (
  SELECT (e.key)::int AS ix, e.value AS b64
  FROM strategy_web_projects p,
       jsonb_each_text(p.roadmap_state -> '_chunks' -> 'page_drafts' -> '<slug>') AS e
  WHERE p.id = '{{project_id}}'::uuid
),
body_cte AS (SELECT convert_from(decode(string_agg(b64, '' ORDER BY ix), 'base64'), 'UTF8') AS body FROM chunks)
SELECT
  CASE WHEN md5(body) = '<LOCAL-MD5>'
    THEN (roadmap_state_set('{{project_id}}'::uuid, ARRAY['page_drafts','<slug>'], body::jsonb) IS NOT NULL)
    ELSE false
  END AS ok
FROM body_cte;

-- Step 4: clear scratch
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_drafts,<slug>}'
WHERE id = '{{project_id}}'::uuid;
\`\`\`

**Why per-page instead of one combined batch write?** Previously this skill prescribed a single \`execute_sql\` with inline-VALUES for all 5 pages. That works on paper but breaks once the combined SQL exceeds your output token cap (~32 KB total) — typical for trimmed drafts past ~6 KB raw JSON each. The session would improvise ad-hoc temp tables to compensate, then a mid-stream socket disconnect leaves state partial. Per-page scratchpad keeps every individual statement small (< 8 KB SQL) AND keeps assembly server-side.

**Small drafts (≤12 KB raw JSON) — inline shortcut:**

\`\`\`sql
SELECT roadmap_state_set('{{project_id}}'::uuid, ARRAY['page_drafts','<slug>'], '<inline_jsonb>'::jsonb) IS NOT NULL AS ok;
\`\`\`

\`IS NOT NULL\` wrapper is mandatory either way — without it the RPC's full-state return blows the MCP output limit (the failure that broke step 7 on Arvada).

If Step 3 returns \`false\`, the md5 mismatched — re-emit JUST that slug's bad chunks via Step 2 and re-run Step 3.

### Move to the next 5

Do NOT persist any page before the strategist signs off on its batch. Do NOT ask which page to start on. Walk in \`nav_order\`.

**Final substep (after the LAST batch lands) — handoff note.** Stamp \`_meta.handoff_note\` on the final page (≤1 screen): (a) section archetypes + verbatim ratios + band_statuses, (b) deferred slots/atoms with reasons + \`source_coverage[]\` coverage_gaps + cross-source conflicts surfaced for partner confirmation, (c) cross-step gotchas for critique (banned-phrase close calls, template swaps that need outline re-fire, cap_overrides logged), (d) critique focus areas. The critique reads it first.`,
    computeStatus: s => {
      if (s.page_outlines_count === 0)               return 'blocked_waiting'
      if (s.page_drafts_count === 0)                 return 'cowork_session'
      if (s.page_drafts_count === s.page_outlines_count) return 'done'
      return 'cowork_session'
    },
    progress: s => ({
      done:  s.page_drafts_count,
      total: s.page_outlines_count,
      label: `${s.page_drafts_count} of ${s.page_outlines_count} outlined page${s.page_outlines_count === 1 ? '' : 's'} drafted`,
    }),
  },
  {
    key:         'critique-page',
    step_number: 11,
    title:       'Review each page',
    subtitle:    'critique-page',
    description:
      'For each drafted page, scores the copy on five axes (dignity, voice character, persona fit, source coverage, claim plausibility) and flags specific lines to revise. The strategist reads the critique to decide whether to ship the page or iterate.',
    kind:        'cowork_session',
    skill_md_path: 'cowork-skills/critique-page/SKILL.md',
    starter_prompt:
`Use the **critique-page** skill for project_id \`{{project_id}}\`. Walk \`sitemap_pages\` sequentially.

## Inputs (attached, NOT MCP)

I'm attaching:
1. The critique-page **SKILL.md**.
2. The **project bundle** \`cowork-pipeline.<partner>.project-bundle.json\` — same file outline + draft consumed. You read atoms_pool / facts_pool / crawl_topics_pool / stage_1 / strategic_goals_approved / canonical_templates / sitemap_pages from it.

## Workflow — TWO MCP calls per page (1 SELECT to read outline+draft, 1 write)

For each page in \`sitemap_pages\`:

1. **Load outline + draft + draft's handoff note** in one SELECT (skim the handoff note FIRST so you don't double-count the drafter's self-reports):

\`\`\`sql
SELECT
  roadmap_state->'page_outlines'->'<slug>' AS outline,
  roadmap_state->'page_drafts'->'<slug>'   AS draft
FROM strategy_web_projects WHERE id = '{{project_id}}';
\`\`\`

2. Look up resources from the bundle:
   - Voice + ethos for dignity scoring: \`stage_1\`
   - \`strategic_goals_approved.goals_and_vision.church_vision\` — when the draft fails the partner's stated emotional outcome, add a \`vision_fit\` directive (reference \`church_vision\` verbatim in the dignity-axis rationale).
   - \`strategic_goals_approved.content_and_allocation.copy_approach.derived.intended_verbatim_band\` — every section's \`actual_verbatim_ratio\` MUST land within band (high ≥0.7, mid 0.3-0.7, low ≤0.2). Flag drift as a directive at severity ≥ warning.
   - Atoms / facts / crawl topics the draft used → bundle pools (by_id with by_topic fallback)
   - The draft's \`deferred_atoms[]\` — every entry MUST surface in directives at severity ≥ warning.

3. Produce the 5-axis critique + standout_lines + problem_lines + directives + summary.

4. **Persist via the column-free chunked-write pattern** (see SKILL §Persist). Critiques on clean greens are usually small enough to inline-write; verbose problem_lines + per-section directives can push past 12 KB and need the scratchpad. Same four-step shape as outline-page, just with \`page_critiques\` in the path:

\`\`\`sql
-- Step 1: clear scratch
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_critiques,<slug>}'
WHERE id = '{{project_id}}'::uuid;

-- Step 2: stage each chunk (≤6 KB base64 per call)
UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  COALESCE(roadmap_state, '{}'::jsonb),
  ARRAY['_chunks','page_critiques','<slug>','<INDEX>'],
  to_jsonb('<BASE64-CHUNK>'::text)
)
WHERE id = '{{project_id}}'::uuid;

-- Step 3: assemble + verify + write
WITH chunks AS (
  SELECT (e.key)::int AS ix, e.value AS b64
  FROM strategy_web_projects p,
       jsonb_each_text(p.roadmap_state -> '_chunks' -> 'page_critiques' -> '<slug>') AS e
  WHERE p.id = '{{project_id}}'::uuid
),
body_cte AS (SELECT convert_from(decode(string_agg(b64, '' ORDER BY ix), 'base64'), 'UTF8') AS body FROM chunks)
SELECT
  CASE WHEN md5(body) = '<LOCAL-MD5>'
    THEN (roadmap_state_set('{{project_id}}'::uuid, ARRAY['page_critiques','<slug>'], body::jsonb) IS NOT NULL)
    ELSE false
  END AS ok
FROM body_cte;

-- Step 4: clear scratch
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,page_critiques,<slug>}'
WHERE id = '{{project_id}}'::uuid;
\`\`\`

**Small critiques (≤12 KB raw JSON) — inline shortcut:**

\`\`\`sql
SELECT roadmap_state_set('{{project_id}}'::uuid, ARRAY['page_critiques','<slug>'], '<inline_jsonb>'::jsonb) IS NOT NULL AS ok;
\`\`\`

\`IS NOT NULL\` wrapper is mandatory either way.

**Final substep — handoff note.** Stamp \`_meta.handoff_note\` (≤1 screen): (a) overall band + per-axis bands, (b) directives that gate ship-vs-iterate, (c) cross-step gotchas for rollup (voice-drift signals, persona-fit edge cases, verbatim-band misses), (d) what synthesize-critique should weight when this page enters the project verdict.`,
    computeStatus: s => {
      if (s.page_drafts_count === 0)                 return 'blocked_waiting'
      if (s.page_critiques_count === 0)              return 'cowork_session'
      if (s.page_critiques_count === s.page_drafts_count) return 'done'
      return 'cowork_session'
    },
    progress: s => ({
      done:  s.page_critiques_count,
      total: s.page_drafts_count,
      label: `${s.page_critiques_count} of ${s.page_drafts_count} drafted page${s.page_drafts_count === 1 ? '' : 's'} reviewed`,
    }),
  },

  // ── Project-level rollup (web UI Run button) ──────────────────────
  {
    key:         'synthesize-critique',
    step_number: 12,
    title:       'Final project review',
    subtitle:    'synthesize-critique',
    description:
      'Rolls every per-page review into a project-level verdict. Flags voice drift across pages, persona-journey gaps, navigation parity, and which pages still have blockers. This is the strategist\'s "ship or iterate" decision surface.',
    kind:        'web_ui',
    endpoint:    '/api/web/agents/run-synthesize-critique',
    output_key:  'critique_rollup',
    computeStatus: s => {
      if (s.page_critiques_count === 0)              return 'blocked_waiting'
      const out = s.critique_rollup?._meta?.generated_at
      if (!out)                                      return 'ready'
      // Step 11 reads church_vision (AM handoff) for project-level
      // vision-drift detection; a fresh goals snapshot means the
      // rollup needs to re-fire.
      const upstream = latestOf(s.latest_critique_at, s.strategic_goals_at)
      if (fresherThan(out, upstream))                return 'done'
      return 'stale'
    },
    staleReason: s => staleReasonFor(s, s.critique_rollup?._meta?.generated_at ?? null, [
      { label: 'latest page critique', getAt: ss => ss.latest_critique_at },
      { label: 'strategic_goals',      getAt: ss => ss.strategic_goals_at },
    ]),
    lastRunAt: s => s.critique_rollup?._meta?.generated_at ?? null,
    lastModel: s => s.critique_rollup?._meta?.model ?? null,
  },
]

// ── Audit-branch step entries ─────────────────────────────────────────
// When the project has notion_database_id set, steps 8-10 collapse
// into ONE autonomous audit-external-copy step. A supplemental
// authoring step appears between audit and synthesize-critique to
// cover any sitemap pages that didn't have a Notion match.
//
// The artifact shapes match the default branch exactly
// (page_critiques.<slug>) so synthesize-critique + downstream
// dev-handoff don't need to know which branch produced the data.

const AUDIT_EXTERNAL_COPY_STEP: StepCatalogEntry = {
  key:         'audit-external-copy',
  step_number: 8,
  title:       'Audit + bind each page (Notion copy → Brixies)',
  subtitle:    'audit-external-copy',
  description:
    'Walks the partner\'s Notion DB via Notion MCP and produces THREE artifacts per page in one pass: page_outlines (template + slot binding), page_drafts (slot values), page_critiques (5-axis scoring + directives). Overflow (e.g. 6 staff when feature_team caps at 2) gets RESOLVED during binding — split into multiple sections, substituted to a template with a higher cap, or truncated with deferred items tracked on the draft. Replaces outline + draft + critique for projects where copywriting was already drafted externally; the outline + draft are what the importer needs to insert pages into Brixies.',
  kind:        'cowork_session',
  skill_md_path: 'cowork-skills/audit-external-copy/SKILL.md',
  starter_prompt:
`Use the **audit-external-copy** skill for project_id \`{{project_id}}\`. Autonomous run — don't prompt the strategist until the full audit is done. Use TWO MCP servers: **Notion MCP** (to walk the partner's database) + **Supabase MCP** (one write per page).

## Inputs

I'm attaching:
1. The audit-external-copy **SKILL.md** — full contract.
2. The **project bundle** \`cowork-pipeline.<partner>.project-bundle.json\` — foundations only.

## Read this carefully — what's in the audit-branch bundle (and what isn't)

The audit branch ships a **deliberately slim** bundle. Don't treat missing fields as "the bundle failed" or "data is degraded" — they're intentional. Use only what's present; don't probe for the others.

**PRESENT and authoritative**:
- \`stage_1\` — voice exemplars, anti-exemplars, ethos, personas, key_message
- \`ministry_model\` — page-treatment posture
- \`strategic_goals_approved\` — copy_approach.derived.intended_verbatim_band, one_key_message, church_vision, recurring_message_theme, etc.
- \`canonical_templates.page_section_templates\` — slot vocab + caps for the formatting axis
- \`atoms_pool\` (by_id + by_topic) — for source-coverage axis
- \`facts_pool\` (by_id + by_topic) — for claim-plausibility + source-coverage
- \`notion_audit_branch.database_id\` + \`notion_audit_branch.database_url\` — your Notion entry point

**INTENTIONALLY ABSENT in this branch — do NOT flag as missing**:
- \`sitemap_pages\` — empty. The sitemap IS the Notion DB; derive it via Notion MCP \`query_database\`.
- \`allocations_by_page\` — absent. Notion copy IS the allocation in this branch.
- \`build_directives_by_page\` — empty. No allocation step ran.
- \`notion_audit_branch.pages_by_slug\` — absent. You walk Notion yourself.
- \`prior_handoff_notes\` — mostly null. No outline/draft steps run in this branch.

**OPTIONAL — may be empty**:
- \`crawl_topics_pool\` — only populated if the project has a site crawl. Many audit-branch projects don't (partner uploaded Notion instead of running a crawl). When empty, score source-coverage + verbatim-band against \`atoms_pool\` and \`facts_pool\` alone; don't flag "no crawl" as a problem.

## Workflow — produces THREE artifacts per page

This step is the audit-branch equivalent of outline + draft + critique
collapsed into one pass. For each Notion page you write **three**
Supabase MCP records, so the importer can ingest pages without
re-running anything.

1. Notion MCP: \`query_database(database_id=notion_audit_branch.database_id)\` → page list. Walk in returned order.
2. For each page: \`retrieve_block_children(page_id, recursive=true)\` → body.
3. Slugify the page title (lowercase, non-alphas → dashes). Skip nav-container pages (no slug property OR Type='Nav Item' / 'Link').
4. **Bind each section to a canonical template** (see SKILL §2):
   - Pick \`template_key\` from \`canonical_templates.page_section_templates\`.
   - RESOLVE overflow: SUBSTITUTE (better-fitting template) → SPLIT (N sections of the same template) → TRUNCATE+defer (only when neither works).
   - Map content into the template's \`cowork_writable_slots\` (primary_heading / body / items / buttons / tagline / accent_body).
   - Every \`required: true\` slot must have a value — if absent, emit a directive and use a placeholder.
5. Score 5 axes on the bound copy against the foundations (audit-criteria.md rubric, referenced from this SKILL's frontmatter).
6. **Persist per page via the column-free chunked-write pattern** (see SKILL §Persist for the full recipe). Three artifacts per page — outline → draft → critique — each goes through the four-step scratchpad pattern. Plus the page-level \`cowork_page_meta.<slug>\` write when the page has a \`# SEO\` or \`## GAPS FLAGGED\` block, and ONE project-level \`global_footer\` write across the whole walk.

**EVERY \`roadmap_state_set\` MUST be wrapped in \`IS NOT NULL\`.** Without it, the RPC's full-state return floods the MCP output. A 20-page audit does 60+ artifact writes; unchecked returns guarantee a mid-stream MCP failure. The audit-branch SKILL has a dedicated §Persist section with the four-step scratchpad pattern (clear → stage chunks → assemble + verify + write → clear). Use it for every artifact whose payload exceeds ~12 KB raw JSON. For smaller artifacts (most \`cowork_page_meta\`, often \`page_critiques\` on clean greens) the inline shortcut is fine — but still \`IS NOT NULL\`:

\`\`\`sql
SELECT roadmap_state_set('{{project_id}}'::uuid, <target_path>, '<inline_jsonb>'::jsonb) IS NOT NULL AS ok;
\`\`\`

All artifact \`_meta\` blocks carry \`audit_source = 'notion'\` so synthesize-critique + the importer can tell where these came from.

## After all pages

Surface a SINGLE final report (one message, not page-by-page):
- N pages audited + bound (excluded list: nav-container pages, external links)
- 5-axis distribution (counts per band: green/yellow/red)
- **Brixies binding summary**: template distribution, overflow resolutions (N splits / N substitutes / N truncates), pages with TRUNCATED content the strategist should review
- Top content issues (body trims, items overflow, required_slot_unfilled, source / contact drift between Notion and facts_pool)
- **Partner-input asks** — items that need partner clarification (named sermon series, current staff emails, etc.) so the strategist can batch them into one AM ping
- Verbatim-band misses (which pages deviate from \`copy_approach.derived.intended_verbatim_band\`)

Then tell the strategist to run synthesize-critique (step 7) for the ship/iterate rollup.`,
  computeStatus: s => {
    // Audit branch foundations: stage_1 (voice rubric anchor) +
    // ministry_model (page-treatment context). We don't gate on
    // allocation — Notion copy IS the allocation in this branch.
    if (!s.stage_1?._meta?.generated_at)        return 'blocked_waiting'
    if (!s.ministry_model?._meta?.generated_at) return 'blocked_waiting'
    // This step produces THREE artifacts per page (outline, draft,
    // critique). "Done" requires all three to be written across the
    // sitemap so the importer can ingest. If any page is partially
    // bound (e.g. critique exists but no outline), the step stays
    // in cowork_session until the strategist re-runs to finish.
    const allThree = Math.min(s.page_outlines_count, s.page_drafts_count, s.page_critiques_count)
    if (allThree === 0)                         return 'cowork_session'
    if (s.sitemap_slugs.length > 0 && allThree >= s.sitemap_slugs.length) return 'done'
    return 'cowork_session'
  },
  progress: s => {
    // Surface the laggard among the three artifact counts so the
    // strategist sees which write is incomplete. All three should
    // tick up in lockstep — divergence means the cowork session
    // wrote some but bailed.
    const minCount = Math.min(s.page_outlines_count, s.page_drafts_count, s.page_critiques_count)
    return {
      done:  minCount,
      total: s.sitemap_slugs.length,
      label: `${minCount} of ${s.sitemap_slugs.length || '?'} Notion page${s.sitemap_slugs.length === 1 ? '' : 's'} bound (outline + draft + critique)`,
    }
  },
}

const SUPPLEMENTAL_PAGE_AUTHORING_STEP: StepCatalogEntry = {
  key:         'supplemental-page-authoring',
  step_number: 9,
  title:       'Author copy for gap pages',
  subtitle:    'supplemental-page-authoring',
  description:
    'Sitemap pages that didn\'t have a matching Notion page need copy written. This step is the standard outline → draft → critique sequence, scoped to ONLY those gap pages. Runs after audit-external-copy. If no gaps exist, the step is a no-op and the strategist marks it complete.',
  kind:        'cowork_session',
  skill_md_path: 'cowork-skills/supplemental-page-authoring/SKILL.md',
  starter_prompt:
`Use the **supplemental-page-authoring** skill for project_id \`{{project_id}}\`. Read the audit's gap-list first; if there are no gaps, surface that and stop.

## Inputs (attached, NOT MCP)

I'm attaching:
1. The supplemental-page-authoring **SKILL.md**.
2. The **project bundle** \`cowork-pipeline.<partner>.project-bundle.json\` — same bundle as audit-external-copy. \`notion_audit_branch.pages_by_slug\` tells you which sitemap pages were covered by Notion (the audited set). The complement is the gap set you author for.

## Workflow

1. **Compute the gap set**: \`sitemap_pages\` minus the slugs in \`notion_audit_branch.pages_by_slug\`. These are the pages with no existing Notion copy.

2. **For each gap page**: run outline + draft + critique inline (no separate steps — this skill produces all three artifacts in conversation). Reuse the outline-page / draft-page / critique-page rubrics from those SKILL.mds. Each page writes:
   - \`page_outlines.<slug>\` (the outline)
   - \`page_drafts.<slug>\` (the draft)
   - \`page_critiques.<slug>\` REPLACES the placeholder critique the audit wrote (which had overall_band='gap'). The new critique has \`_meta.audit_source = 'generated-supplemental'\` so synthesize-critique can distinguish.

3. **Single MCP write per page** for each of the three artifacts. The outline + draft + critique-replace happen in three writes total per page (six approvals for three artifacts × paste-confirm cadence).

If gaps.length === 0, surface "All sitemap pages had matching Notion copy — no supplemental authoring needed" and stop. The strategist marks the step done via Approve as-is on the workspace card.`,
  computeStatus: s => {
    if (s.page_critiques_count === 0)                  return 'blocked_waiting'
    if (s.page_critiques_count < s.sitemap_slugs.length) return 'blocked_waiting'
    // Audit is done. Whether supplemental is needed depends on whether
    // any page_critique has _meta.audit_source === 'notion-gap'. The
    // workspace surfaces this via a "ready" card; the strategist clicks
    // through and the SKILL itself determines the gap set from the
    // bundle. We mark ready (cowork_session) by default; the SKILL
    // will say "no gaps, nothing to do" when applicable.
    if (!s.page_drafts_count || s.page_drafts_count === 0) return 'cowork_session'
    if (s.page_drafts_count >= s.sitemap_slugs.length)     return 'done'
    return 'cowork_session'
  },
  progress: s => ({
    done:  s.page_drafts_count,
    total: s.sitemap_slugs.length,
    label: `${s.page_drafts_count} of ${s.sitemap_slugs.length} page${s.sitemap_slugs.length === 1 ? '' : 's'} authored`,
  }),
}

/** Select the right step catalog for the project's branch.
 *
 * Default (notion_database_id null): the standard 11-step pipeline.
 *   inventory → facts → strategy → ministry → ACF → sitemap →
 *   allocation → outline → draft → critique → rollup
 *
 * Audit branch (notion_database_id set): just SEVEN steps. The
 * partner came in with copy already drafted in Notion, so the
 * "design the IA + plan the allocation + write the copy" middle
 * three steps (organize-acf / plan-site-strategy /
 * plan-cross-page-allocation) get dropped — the sitemap IS the
 * Notion DB and the existing copy IS the allocation. We keep the
 * foundation steps (1-4) because the audit needs atoms + facts +
 * stage_1 voice + ministry_model to score against. Then a single
 * autonomous audit-external-copy step walks the Notion pages,
 * scores 5 axes + flags formatting gaps against canonical templates;
 * supplemental-page-authoring fills any gap pages; and the same
 * project-level rollup runs at the end.
 *
 * The collapse from 11 steps to 7 is intentional — Arvada Vineyard
 * (the seed use case) shouldn't have to re-design IA the partner
 * already specified in Notion.
 */
export function getCoworkSteps(opts: { auditBranch: boolean }): StepCatalogEntry[] {
  if (!opts.auditBranch) return COWORK_STEPS_BASE
  // KEEP: foundations the audit reads against (atoms, facts, stage_1,
  // ministry_model) + the project-level rollup at the end.
  // DROP: organize-acf, plan-site-strategy, plan-cross-page-allocation,
  // outline-page, draft-page, critique-page — none serve "audit
  // existing Notion copy."
  const KEEP_FOUNDATION = new Set<string>([
    'extract-strategic-pillars',
    'parse-facts-csv',
    'synthesize-strategy',
    'classify-ministry',
  ])
  const foundation = COWORK_STEPS_BASE.filter(s => KEEP_FOUNDATION.has(s.key))
  const synth      = COWORK_STEPS_BASE.find(s => s.key === 'synthesize-critique')
  // Renumber to a tight 1-7 sequence so the workspace progress bar
  // ("4 of 7 steps complete") reads honestly. Display-only.
  return [
    ...foundation.map((s, i) => ({ ...s, step_number: i + 1 })),
    { ...AUDIT_EXTERNAL_COPY_STEP, step_number: 5 },
    { ...SUPPLEMENTAL_PAGE_AUTHORING_STEP, step_number: 6 },
    ...(synth ? [{ ...synth, step_number: 7 }] : []),
  ]
}

/** Default export for legacy consumers. Equivalent to
 *  getCoworkSteps({ auditBranch: false }). */
export const COWORK_STEPS: StepCatalogEntry[] = COWORK_STEPS_BASE
