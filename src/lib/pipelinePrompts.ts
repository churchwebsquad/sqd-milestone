/**
 * In-app copywriting pipeline — system prompt resolver.
 *
 * Two-tier prompt model:
 *   • Global default — Cowork-maintained, one row per stage in
 *     web_pipeline_prompts (scope='global').
 *   • Project addendum — optional per-project row APPENDED to the
 *     global at run time (scope='project'). Global improvements
 *     keep propagating; project nuance rides on top.
 *
 * Until the team replaces the placeholder global rows via the
 * admin UI, the resolver falls back to FALLBACK_PROMPTS below.
 * Those baselines are summarized from the cowork-skills/*.md files
 * — full skill prose stays in those files as reference docs.
 */

import { supabase } from './supabase'

export type PipelineStage =
  | 'synthesize'
  | 'sitemap'
  | 'page_inventory'
  | 'outlines'
  | 'bind'
  | 'coverage_qa'
  | 'voice_pass'
  | 'final_qa'

export const PIPELINE_STAGES: PipelineStage[] = [
  'synthesize',
  'sitemap',
  'page_inventory',
  'outlines',
  'bind',
  'coverage_qa',
  'voice_pass',
  'final_qa',
]

export const STAGE_LABELS: Record<PipelineStage, string> = {
  synthesize:     'Synthesize',
  sitemap:        'Sitemap + nav',
  page_inventory: 'Page inventory',
  outlines:       'Baseline outlines',
  bind:           'Bind to Brixies',
  coverage_qa:    'Coverage QA',
  voice_pass:     'Voice pass',
  final_qa:       'Final QA',
}

export const STAGE_NUMBER: Record<PipelineStage, number> = {
  synthesize:     1,
  sitemap:        2,
  page_inventory: 3,
  outlines:       4,
  bind:           5,
  coverage_qa:    6,
  voice_pass:     7,
  final_qa:       8,
}

export const STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  synthesize:     'Read discovery, brief, content inventory + collection. Solidify goals, page count, SEO/AEO/GEO targets.',
  sitemap:        'Draft a unique navigation + sitemap structure from the page list.',
  page_inventory: 'Map every content atom to a primary page (with optional reference pages and CTA placement).',
  outlines:       'Per page, draft plain-prose section outlines + suggest display options (cards, columns, accordion, …).',
  bind:           'Pick a Brixies template per section, rephrase the outline content to fit slot character budgets.',
  coverage_qa:    'Audit: did every content atom land somewhere? Surface orphans for strategist review.',
  voice_pass:     'Element-by-element brand-voice rewrite of every text + richtext slot.',
  final_qa:       'Cross-page voice + consistency + merge-field + nav-vs-pages audit.',
}

// ── Fallback prompts ──────────────────────────────────────────
// Returned by resolvePrompt() when the DB row's system_prompt is
// the placeholder. Replace these via the admin UI as the team
// refines. Full skill text lives in cowork-skills/*.md.
const PLACEHOLDER_MARKER = 'placeholder'

const FALLBACK_PROMPTS: Record<PipelineStage, string> = {
  synthesize: `You are the Strategy Synthesizer. You read every intake source for a church
website project (discovery questionnaire, content inventory crawl, content
collection submissions, strategy brief, brand guide, AM handoff notes) and
produce a single structured JSON that codifies what we know about this
partner.

Output the strategy via the submit_strategy_extraction tool. Be exhaustive
but not redundant. Quote sources where helpful. Crucially: the new site does
NOT have to 1:1 replicate the current site — your job is to determine the
RIGHT page count for this partner's actual content density, not match what
they had before.

Required outputs:
- audience (primary + secondary)
- voice_characteristics (signature moves + sample sentences)
- personas (one per persona, with need/goal/voice_resonance)
- x_factor (1-2 sentences on what makes this church distinct)
- project_goals (3-5 outcomes the partner cares about)
- total_page_count (your recommendation; explain any consolidation)
- existing_pages_to_carry_forward (slugs from the current site that survive)
- seo_aeo_geo_targets (per topic: search phrases, answer-engine intents,
  geographic anchors)
- sources_used (which intake files informed each decision)`,

  sitemap: `You are the Sitemap Drafter. Given the strategy extraction from Stage 1,
produce a lean nav structure and full page list via the submit_sitemap tool.

Rules:
- Every page in stage_1.total_page_count must appear in your output
- Header nav holds 4-6 items max; everything else goes in footer or as
  reference pages
- Each page gets a slug (lowercase, hyphenated) and a clear name
- Vocabulary decisions: pick the words this partner uses (e.g. "Sunday
  Gatherings" vs "Services") and apply consistently
- Phase 1 vs Phase 2 — flag pages that ship in the initial launch vs.
  follow-on releases
- AEO keyword targets per page (the conversational queries the page will
  rank for)
- CS (content service) flags — note any pages needing follow-up content
  collection from the partner

On a redo request, preserve every page/slug/nav item that the strategist
didn't explicitly call out for change.`,

  page_inventory: `You are the Page Inventory Mapper. For every content atom (prose snippet,
fact, persona note) and every church fact (service time, ministry, staff
member, belief statement), decide which page in the Stage 2 sitemap it
belongs on as its primary home. Optionally suggest reference pages where a
CTA or short summary should also appear.

Output via submit_page_inventory:
- atom_placements[]: one entry per atom_id with {primary_page_slug,
  reference_pages[], suggested_treatment, rationale}
- fact_placements[]: same shape for church_facts
- orphans[]: atoms/facts you couldn't place (rationale required)

Suggested_treatment values: hero_anchor, section_body, card_in_grid,
sidebar_callout, footer_link, cta_button, schema_only (don't render but
include in SEO schema).

A persona's voice notes may appear on multiple pages — that's fine. A
ministry fact should usually have one primary home + maybe a homepage card
reference.`,

  outlines: `You are the Page Outliner. For every page in the Stage 2 sitemap, draft
plain-prose section outlines based on the Stage 3 atom/fact placements
mapped to this page. Do NOT think about Brixies templates yet — that's
Stage 5's job.

For each section, output:
- section_job (one sentence: what this section accomplishes for the visitor)
- content_summary (the core info that must be communicated, in plain prose)
- display_options (2-3 alternative layout treatments: e.g. "3-card grid",
  "split column with image right", "accordion of FAQs", "single CTA hero
  with background image")
- atoms_used (atom_ids consumed by this section)
- voice_notes (any persona-specific tone considerations)

Lead with the section_job. The display options give Stage 5 useful
flexibility — pick the one that matches the content shape.

Output via submit_page_outlines.`,

  bind: `You are the Brixies Binder + Rephraser. Given Stage 4's plain-prose page
outlines, pick the best Brixies template per section from the curated
library + catalog, then rephrase the section content to fit the template's
slot character budgets and required field shapes.

For each section:
- Pick template_id (use the Brixies Pairer's archetype scoring as a starting
  point; override only with explicit rationale)
- Map content_summary into field_values for every slot in the template
- Honor max_chars per slot — abbreviate, don't truncate awkwardly
- Preserve atoms_used from Stage 4 — every atom should appear in
  field_values somewhere

Output via submit_bind_results: per-section template_id + field_values +
rephrasing_notes + any atoms that couldn't fit (deferred to Stage 6).`,

  coverage_qa: `You are the Coverage Auditor. Compare every content_atom and church_fact
loaded for this project against the field_values written across all bound
sections in Stage 5. Categorize each as landed, partially_landed (mentioned
but key info dropped), or orphaned (didn't make it in anywhere).

For partially_landed and orphaned items, write a one-sentence rationale and
suggest a remedy: re-route to a different page, request more content from
partner, archive as schema-only, etc.

Output via submit_coverage_audit: {landed[], partially_landed[], orphaned[],
total_score: percentage_landed}.`,

  voice_pass: `You are the Brand Voice Polisher. For each text or richtext slot across
every section of every page, rewrite the current value to better match the
project's voice card from Stage 1 + the brand guide. Constrained by:
- slot's max_chars (NEVER exceed)
- slot's type (text = no markdown; richtext = markdown allowed)
- the section's section_job from Stage 4 (don't drift)

Skip slots where the existing content is already on-voice and on-budget.
Skip slots marked field_provenance='override' (strategist already locked
them).

Output via submit_voice_rewrites: one entry per slot {section_id, slot_key,
old_value, new_value, voice_alignment_score, rationale}.`,

  final_qa: `You are the Final QA. Run the following checks across all bound + voiced
sections and produce a findings list:

1. Nav-vs-page parity: every page in Stage 2 sitemap has at least one
   inbound link (nav or in-page CTA)
2. Persona coverage: every persona from Stage 1 has at least one page where
   their voice_resonance shows
3. Voice consistency: detect significant tone drift between pages
4. Merge-field resolution: every {{token}} in field_values matches an
   existing project snippet
5. SEO targets: every page has seo title + meta_description; AEO keywords
   from Stage 1 are represented across pages

Output via submit_final_qa: findings[] with {severity, page_slug, section_id,
issue, suggested_fix}. Severity: blocker, warning, nit.`,
}

// ── Public API ────────────────────────────────────────────────

export interface ResolvedPrompt {
  systemPrompt: string
  globalSource: 'db' | 'fallback'
  hasProjectAddendum: boolean
}

/** Resolve a stage's effective system prompt for a project.
 *  Global default + optional project addendum, separated by a
 *  markdown header so the model sees the two cleanly. */
export async function resolvePrompt(
  stage:     PipelineStage,
  projectId: string,
): Promise<ResolvedPrompt> {
  const [globalRow, projectRow] = await Promise.all([
    supabase.from('web_pipeline_prompts')
      .select('system_prompt')
      .eq('stage', stage)
      .eq('scope', 'global')
      .is('web_project_id', null)
      .maybeSingle(),
    supabase.from('web_pipeline_prompts')
      .select('system_prompt')
      .eq('stage', stage)
      .eq('scope', 'project')
      .eq('web_project_id', projectId)
      .maybeSingle(),
  ])

  const dbGlobal      = globalRow.data?.system_prompt ?? null
  const useFallback   = !dbGlobal || dbGlobal === PLACEHOLDER_MARKER
  const base          = useFallback ? FALLBACK_PROMPTS[stage] : dbGlobal
  const projectAddend = projectRow.data?.system_prompt ?? null

  const systemPrompt = projectAddend
    ? `${base}\n\n## Project-specific notes\n${projectAddend}`
    : base

  return {
    systemPrompt,
    globalSource:       useFallback ? 'fallback' : 'db',
    hasProjectAddendum: !!projectAddend,
  }
}

/** Admin — replace the global prompt for a stage. */
export async function updateGlobalPrompt(
  stage:        PipelineStage,
  systemPrompt: string,
  notes?:       string | null,
): Promise<{ error?: string }> {
  const { error } = await supabase.from('web_pipeline_prompts')
    .update({
      system_prompt: systemPrompt,
      notes:         notes ?? null,
      updated_at:    new Date().toISOString(),
    })
    .eq('stage', stage)
    .eq('scope', 'global')
    .is('web_project_id', null)
  return error ? { error: error.message } : {}
}

/** Per-project — set or replace the addendum for a stage. */
export async function upsertProjectAddendum(
  stage:        PipelineStage,
  projectId:    string,
  systemPrompt: string,
): Promise<{ error?: string }> {
  // We can't use .upsert() cleanly because the partial unique index
  // requires us to check existence first.
  const { data: existing } = await supabase.from('web_pipeline_prompts')
    .select('id')
    .eq('stage', stage)
    .eq('scope', 'project')
    .eq('web_project_id', projectId)
    .maybeSingle()
  if (existing?.id) {
    const { error } = await supabase.from('web_pipeline_prompts')
      .update({ system_prompt: systemPrompt, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return error ? { error: error.message } : {}
  }
  const { error } = await supabase.from('web_pipeline_prompts').insert({
    stage,
    scope: 'project',
    web_project_id: projectId,
    system_prompt: systemPrompt,
  })
  return error ? { error: error.message } : {}
}

/** Per-project — remove the addendum so the project reverts to the
 *  pure global default on next resolve. */
export async function clearProjectAddendum(
  stage:     PipelineStage,
  projectId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.from('web_pipeline_prompts')
    .delete()
    .eq('stage', stage)
    .eq('scope', 'project')
    .eq('web_project_id', projectId)
  return error ? { error: error.message } : {}
}

/** Admin listing for the global prompts page. */
export async function listGlobalPrompts(): Promise<Array<{
  stage:         PipelineStage
  system_prompt: string
  notes:         string | null
  updated_at:    string
  is_placeholder: boolean
}>> {
  const { data } = await supabase.from('web_pipeline_prompts')
    .select('stage, system_prompt, notes, updated_at')
    .eq('scope', 'global')
    .is('web_project_id', null)
    .order('stage')
  return ((data ?? []) as Array<{
    stage: PipelineStage; system_prompt: string; notes: string | null; updated_at: string
  }>).map(r => ({
    ...r,
    is_placeholder: r.system_prompt === PLACEHOLDER_MARKER,
  }))
}

export { FALLBACK_PROMPTS, PLACEHOLDER_MARKER }
