/**
 * Strategic Goals → prompt-context renderer.
 *
 * Both Phase 2 web_ui endpoints (run-*.ts) and the cowork-session
 * starter prompts (stepCatalog.ts) need to inject the strategic-goals
 * snapshot into their model prompt. They all need the same shape:
 * grouped by category, fields filtered to those the step actually
 * consumes, derived rules surfaced inline (nav_change_level,
 * verbatim band).
 *
 * This module centralizes that rendering so each endpoint can call
 * one function and get a markdown block to splice into its user
 * message — and so the renderer evolves in one place when a new
 * field lands.
 *
 * Approval gating: by default ONLY status='approved' fields are
 * rendered. Draft + archived fields are suppressed so the pipeline
 * doesn't trust pre-review content. Set `includeDrafts: true` to
 * render drafts too (used by validators that want to see what the
 * strategist hasn't yet weighed in on).
 */

import {
  STRATEGIC_GOAL_FIELDS,
  type StrategicGoalCategory,
  type StrategicGoalField,
  type StrategicGoalFieldDef,
  type StrategicGoalsSnapshot,
} from './strategicGoals.js'

/** Build the strategic-goals block for a specific step. Returns ''
 *  when no relevant fields are populated/approved — caller can splice
 *  unconditionally without a check. */
export function renderStrategicGoalsForStep(
  snapshot: StrategicGoalsSnapshot | null | undefined,
  stepKey: string,
  opts: { includeDrafts?: boolean } = {},
): string {
  if (!snapshot) return ''
  const includeDrafts = opts.includeDrafts === true

  // Filter to fields whose pipeline_consumers names this step.
  const relevant = STRATEGIC_GOAL_FIELDS.filter(d => d.pipeline_consumers.includes(stepKey))
  if (relevant.length === 0) return ''

  // Group by category so the prompt block reads in strategist order.
  const byCategory = new Map<StrategicGoalCategory, Array<{ def: StrategicGoalFieldDef; field: StrategicGoalField }>>()
  for (const def of relevant) {
    const field = snapshot[def.category]?.[def.key]
    if (!field) continue
    const hasValue = field.value != null && (typeof field.value !== 'string' || field.value.trim() !== '')
    if (!hasValue) continue
    const include = field.status === 'approved' || (includeDrafts && field.status !== 'archived')
    if (!include) continue
    const list = byCategory.get(def.category) ?? []
    list.push({ def, field })
    byCategory.set(def.category, list)
  }
  if (byCategory.size === 0) return ''

  const lines: string[] = []
  lines.push('# Strategic Goals — strategist-approved inputs')
  lines.push('')
  lines.push('These are the partner intent + constraints the strategist has approved for this step. Treat them as load-bearing — your output should be traceable to these where applicable.')
  lines.push('')

  const CATEGORY_LABELS: Record<StrategicGoalCategory, string> = {
    goals_and_vision:       'Goals & Vision',
    voice_and_tone:         'Voice & Tone',
    content_and_allocation: 'Content & Allocation',
    display_and_technical:  'Display & Technical',
    inspiration_and_notes:  'Inspiration & Notes',
  }

  const CATEGORY_ORDER: StrategicGoalCategory[] = [
    'goals_and_vision', 'voice_and_tone', 'content_and_allocation', 'display_and_technical', 'inspiration_and_notes',
  ]

  for (const cat of CATEGORY_ORDER) {
    const entries = byCategory.get(cat)
    if (!entries || entries.length === 0) continue
    lines.push(`## ${CATEGORY_LABELS[cat]}`)
    for (const { def, field } of entries) {
      lines.push('')
      lines.push(`**${def.label}** (${def.key}${field.status === 'draft' ? ', draft — not yet strategist-approved' : ''})`)
      // The value — rendered as a blockquote when it's multi-line
      // prose so the model can visually parse the boundary.
      const value = typeof field.value === 'number' ? String(field.value) : (field.value as string)
      const isMultiline = value.includes('\n') || value.length > 80
      if (isMultiline) {
        for (const line of value.split('\n')) lines.push(`> ${line}`)
      } else {
        lines.push(`> ${value}`)
      }
      // Surface derived rules right next to the value so the model
      // doesn't have to derive them again. The rules ARE the contract.
      if (field.derived?.nav_change_level) {
        lines.push('')
        lines.push(`**Derived rule**: \`nav_change_level = ${field.derived.nav_change_level}\` — ${navChangeExplanation(field.derived.nav_change_level)}`)
      }
      if (field.derived?.intended_verbatim_band) {
        lines.push('')
        lines.push(`**Derived rule**: \`intended_verbatim_band = ${field.derived.intended_verbatim_band}\` — ${verbatimBandExplanation(field.derived.intended_verbatim_band)}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}

/** Plain-English version of the nav_change_level rule — included next
 *  to the value so the model sees the *consequence*, not just the
 *  enum. Mirrors the user's spec. */
function navChangeExplanation(level: 'full_rewrite' | 'partial' | 'tweaks' | 'preserve'): string {
  switch (level) {
    case 'full_rewrite': return 'Partner is unsatisfied with their current nav (score ≤6). Plan a fresh nav structure from scratch; do NOT echo the crawled menu.'
    case 'partial':      return 'Partner is mostly satisfied (score 7-8). Keep the spine of the crawled nav but adjust groupings and labels where they conflict with the strategic plan.'
    case 'tweaks':       return 'Partner is happy with their current nav (score 9). Preserve the structure; only adjust 1-2 labels that conflict with the strategic plan.'
    case 'preserve':     return 'Partner explicitly does not want nav changed (score 10). Keep the crawled nav verbatim. Do NOT add or remove items.'
  }
}

/** Plain-English version of the verbatim-band rule. */
function verbatimBandExplanation(band: 'high' | 'mid' | 'low'): string {
  switch (band) {
    case 'high': return 'Partner wants to keep most existing copy (≥70% verbatim from crawl). Outline + draft should preserve crawled lines, only lightly edit for voice + dignity.'
    case 'mid':  return 'Partner wants a mix (~50% verbatim from crawl). Blend lifted lines with fresh prose that strengthens the strategic foundation.'
    case 'low':  return 'Partner wants new copy written from scratch (≤20% verbatim from crawl). Treat crawl as background context; write fresh prose anchored in core messages.'
  }
}

/** Returns just the derived nav_change_level if the snapshot has one
 *  AND the field is approved. Used by plan-site-strategy's prompt to
 *  enforce the contract more aggressively than the markdown render. */
export function getApprovedNavChangeLevel(snapshot: StrategicGoalsSnapshot | null | undefined): 'full_rewrite' | 'partial' | 'tweaks' | 'preserve' | null {
  const field = snapshot?.display_and_technical?.current_navigation_satisfaction
  if (!field || field.status !== 'approved') return null
  return field.derived?.nav_change_level ?? null
}

/** Returns just the derived verbatim band when approved. Used by
 *  allocation + outline + draft prompts. */
export function getApprovedVerbatimBand(snapshot: StrategicGoalsSnapshot | null | undefined): 'high' | 'mid' | 'low' | null {
  const field = snapshot?.content_and_allocation?.copy_approach
  if (!field || field.status !== 'approved') return null
  return field.derived?.intended_verbatim_band ?? null
}
