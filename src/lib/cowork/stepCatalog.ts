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
  critique_rollup:       { _meta?: { generated_at?: string; model?: string } } | null
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

export const COWORK_STEPS: StepCatalogEntry[] = [
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

**Read the handoff note from the prior step FIRST** — \`roadmap_state.site_strategy._meta.handoff_note\` carries the decisions + cross-step gotchas the prior session resolved, including any persona / nav / ministry routing the strategist already settled. Skim it before you load the full artifacts so you don't re-litigate those decisions.

Read from Supabase:
- \`strategy_web_projects.roadmap_state.stage_1\` (strategic foundation)
- \`strategy_web_projects.roadmap_state.ministry_model\` (church posture)
- \`strategy_web_projects.roadmap_state.site_strategy\` (sitemap; respect its \`nav_change_level\`)
- \`strategy_web_projects.roadmap_state.acf_plan\` (audience × category × funnel matrix)
- \`strategy_web_projects.roadmap_state.strategic_goals\` — **read this first**. Filter to fields where \`status = 'approved'\`. Especially weigh:
  - \`content_and_allocation.copy_approach\` → \`derived.intended_verbatim_band\` (high/mid/low) sets the verbatim-vs-rewrite ratio. high = ≥70% verbatim from crawl, mid ≈ 50%, low ≤ 20%.
  - \`content_and_allocation.ministries_to_grow\` — every named ministry MUST get a featured allocation on the homepage AND on its own page if one exists.
  - \`content_and_allocation.content_needs\` (AM handoff) — the specific weak/missing areas drive allocation emphasis.
  - \`content_and_allocation.best_outreach_methods\` — deserves a dedicated allocation slice with a clear CTA.
  - \`content_and_allocation.additional_clarifications\` — read each item, route to the page it informs.
  - \`goals_and_vision.top_3_website_goals\` + \`goals_and_vision.ideal_website_experience\` — frame page-level emphasis.
- All \`content_atoms\` for this project where status in ('approved', 'draft')
- All \`church_facts\` for this project where status in ('approved', 'draft')
- All \`web_project_topics\` for this project (crawled content)

Record the verbatim-band budget per allocation: each \`allocations[].intended_verbatim_band\` MUST equal the approved \`copy_approach.derived.intended_verbatim_band\` so outline + draft can enforce it downstream.

Walk me through each page's allocation as you produce it — pause for my push-back before persisting.

When complete, write the allocation to \`roadmap_state.page_allocation_plan\` via the \`roadmap_state_set\` RPC (path: \`['page_allocation_plan']\`). Stamp the \`_meta\` block per the SKILL contract.

**Final substep — handoff note.** Before declaring this step done, write a ≤1-screen handoff note to \`roadmap_state.page_allocation_plan._meta.handoff_note\` AND surface it as a paste-ready block in the conversation. Cover (a) what was written + where, (b) any open/deferred issues or validator gaps, (c) cross-step gotchas the next session (outline-page) needs to honor — banned vocab, per-page exceptions, persona postures, copy-approach band, ministries-to-grow placement, build_directives that affect outlining — and (d) what outline-page should read + decisions already litigated.`,
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

  // ── Cowork session: per-page work ─────────────────────────────────
  {
    key:         'outline-page',
    step_number: 8,
    title:       'Outline each page',
    subtitle:    'outline-page',
    description:
      'For each page in the sitemap, picks the section layouts and assigns each section\'s sources (which core messages, facts, and quoted content each section will land). One short conversation per page.',
    kind:        'cowork_session',
    skill_md_path: 'cowork-skills/outline-page/SKILL.md',
    starter_prompt:
`Use the **outline-page** skill for project_id \`{{project_id}}\`, page_slug \`<PAGE-SLUG>\`.

**Read the handoff note from the prior step FIRST** — \`roadmap_state.page_allocation_plan._meta.handoff_note\` carries the allocation strategist's decisions + cross-step gotchas (verbatim band, ministries-to-grow placement, banned vocab, build_directives that affect outlining). Read it before you load the full allocation so you don't re-litigate decisions.

Read:
- \`roadmap_state.page_allocation_plan.allocations[]\` (find the entry where page_slug matches; respect its \`intended_verbatim_band\`)
- \`roadmap_state.stage_1\` (strategic foundation)
- \`roadmap_state.ministry_model\` (template choices)
- \`roadmap_state.strategic_goals\` — filter to \`status='approved'\`. For this page outline, especially:
  - \`content_and_allocation.copy_approach.derived.intended_verbatim_band\` — stamp this on each section. high = ≥70% verbatim from crawl; mid ≈ 50%; low ≤ 20%.
  - \`voice_and_tone.one_key_message\` + \`voice_and_tone.recurring_message_theme\` — every page outline MUST include a section whose voice anchors against one of these.
  - \`content_and_allocation.ministries_to_grow\` — if this page is the homepage OR a related ministry page, surface those ministries early with progression CTAs.
  - \`content_and_allocation.content_needs\` — if this page is named in the AM content_needs, give it the section-count it needs.
  - \`display_and_technical.sermons_display_preference\` — only relevant when outlining a sermons/watch page. embed_latest → single \`embed-latest-sermon\` archetype; archive → list/grid archetype.
- The content_atoms / church_facts / web_project_topics referenced in the allocation slice

Produce the outline per the SKILL contract: sections with archetype + atom_assignments + fact_assignments + crawl_topic_assignments + voice_anchor + \`intended_verbatim_band\` per section (matching the allocation).

When done, write to \`roadmap_state.page_outlines.<PAGE-SLUG>\` via \`roadmap_state_set\` (path: \`['page_outlines', '<PAGE-SLUG>']\`). Stamp \`_meta\`.

**Final substep — handoff note.** Before declaring this page's outline done, write a ≤1-screen handoff note to \`roadmap_state.page_outlines.<PAGE-SLUG>._meta.handoff_note\` AND surface it in the conversation. Cover (a) what the outline contains (section count + archetypes), (b) any deferred slots / overflow atoms / unfilled required slots, (c) cross-step gotchas the drafter needs (verbatim band per section, voice anchor exemplars cited, persona posture, banned phrases that almost slipped in), (d) what draft-page should read first for this page.`,
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
    step_number: 9,
    title:       'Write each page',
    subtitle:    'draft-page',
    description:
      'For each outlined page, writes the actual copy — every heading, body paragraph, card, and CTA. Reads the outline + the strategic foundation + the source material. One short conversation per page.',
    kind:        'cowork_session',
    skill_md_path: 'cowork-skills/draft-page/SKILL.md',
    starter_prompt:
`Use the **draft-page** skill for project_id \`{{project_id}}\`, page_slug \`<PAGE-SLUG>\`.

**Read the handoff note from the prior step FIRST** — \`roadmap_state.page_outlines.<PAGE-SLUG>._meta.handoff_note\` carries the outline strategist's decisions (verbatim band per section, voice anchor exemplars, persona posture, banned phrases). Skim it before loading the outline so you don't re-litigate those calls.

Read:
- \`roadmap_state.page_outlines.<PAGE-SLUG>\` (the outline; honor each section's \`intended_verbatim_band\`)
- \`roadmap_state.stage_1\` (voice, personas, ethos)
- \`roadmap_state.strategic_goals\` — filter to \`status='approved'\`. For drafting, especially:
  - \`content_and_allocation.copy_approach.derived.intended_verbatim_band\` — applies per section. high band: keep at least 70% of words from the cited crawl passages; only edit for voice/dignity. mid: blend lifted lines with fresh prose ~50/50. low: ≤20% verbatim from crawl, write fresh prose anchored in atoms + facts.
  - \`voice_and_tone.one_key_message\` — every page MUST include a section whose copy echoes this message.
  - \`voice_and_tone.recurring_message_theme\` — the page's voice posture should resonate with this theme.
- The content_atoms / church_facts / web_project_topics the outline references

Write the copy per the SKILL contract (each section's copy + atoms_used + facts_used + crawl_topics_used + voice_notes + deferred_atoms if any). Each section MUST stamp its \`actual_verbatim_ratio\` (0.0-1.0) — the share of section words lifted verbatim from cited crawl passages — so the critique can verify it lands within the section's \`intended_verbatim_band\`.

When done, write to \`roadmap_state.page_drafts.<PAGE-SLUG>\` via \`roadmap_state_set\`. Stamp \`_meta\` with the model + prompt_hash + generated_at.

**Final substep — handoff note.** Write a ≤1-screen note to \`roadmap_state.page_drafts.<PAGE-SLUG>._meta.handoff_note\` AND surface it. Cover (a) what was drafted (section archetypes, total slot count, verbatim ratios), (b) deferred slots or atoms with reasons, (c) cross-step gotchas the critique should weigh (voice anchors honored, key_message section identified, mechanical-scan close calls), (d) what critique-page should focus on for this page.`,
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
    step_number: 10,
    title:       'Review each page',
    subtitle:    'critique-page',
    description:
      'For each drafted page, scores the copy on five axes (dignity, voice character, persona fit, source coverage, claim plausibility) and flags specific lines to revise. The strategist reads the critique to decide whether to ship the page or iterate.',
    kind:        'cowork_session',
    skill_md_path: 'cowork-skills/critique-page/SKILL.md',
    starter_prompt:
`Use the **critique-page** skill for project_id \`{{project_id}}\`, page_slug \`<PAGE-SLUG>\`.

**Read the handoff note from the prior step FIRST** — \`roadmap_state.page_drafts.<PAGE-SLUG>._meta.handoff_note\` carries the drafter's close calls + cross-step gotchas (voice anchors honored, mechanical-scan near-misses, deferred slot reasons). Skim it before scoring so you don't double-count what the drafter already self-reported.

Read:
- \`roadmap_state.page_drafts.<PAGE-SLUG>\` (the draft)
- \`roadmap_state.page_outlines.<PAGE-SLUG>\` (the outline)
- \`roadmap_state.stage_1\` (voice + ethos for dignity scoring)
- \`roadmap_state.strategic_goals\` — filter to \`status='approved'\`. For critique, especially:
  - \`goals_and_vision.church_vision\` (AM handoff) — add a \`vision_fit\` directive when the draft fails to match the partner's stated emotional outcome.
  - \`content_and_allocation.copy_approach.derived.intended_verbatim_band\` — every section's \`actual_verbatim_ratio\` MUST land within band (high ≥ 0.7; mid 0.3-0.7; low ≤ 0.2). Flag drift as a directive at severity ≥ warning.
- The atoms / facts / crawl topics the draft used
- The draft's deferred_atoms[] — every entry MUST surface in directives at severity ≥ warning

Produce the 5-axis critique + standout_lines + problem_lines + directives + summary. Reference \`church_vision\` verbatim in the dignity-axis rationale when applicable.

When done, write to \`roadmap_state.page_critiques.<PAGE-SLUG>\` via \`roadmap_state_set\`. Stamp \`_meta\`.

**Final substep — handoff note.** Write a ≤1-screen note to \`roadmap_state.page_critiques.<PAGE-SLUG>._meta.handoff_note\` AND surface it. Cover (a) overall band + per-axis bands, (b) the directives that gate ship-vs-iterate, (c) cross-step gotchas the rollup needs (voice-drift signals worth elevating, persona-fit edge cases, verbatim band misses), (d) what synthesize-critique should weight when this page enters the project verdict.`,
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
    step_number: 11,
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
