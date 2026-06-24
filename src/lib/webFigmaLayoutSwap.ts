/**
 * Effective Figma template resolver.
 *
 * The designer can swap layouts in two places:
 *   1. Per-section: web_sections.figma_template_override_id
 *      "in Figma + dev handoff, use THIS layout for THIS slot,
 *       overriding both the wireframe layout AND the site-wide swap"
 *   2. Site-wide: strategy_web_projects.figma_layout_swaps[from_id]
 *      "anywhere this layout was used on this site, render the
 *       replacement instead"
 *
 * The page editor + content pipeline ignore both — content stays
 * sourced from the wireframe-stage content_template_id. These swaps
 * exist ONLY for the Design Handoff swap board, the Figma plugin's
 * style guide assembler, and the Dev handoff checklist.
 *
 * Effective resolution:
 *
 *     section.figma_template_override_id                                  -- per-section override wins
 *  ?? project.figma_layout_swaps[section.content_template_id]?.to_template_id  -- site-wide swap
 *  ?? section.content_template_id                                         -- original wireframe layout
 */

import type { FigmaLayoutSwapEntry, StrategyWebProject, WebSection } from '../types/database'

export interface EffectiveTemplateInfo {
  /** The template id that should render in Figma + dev handoff. */
  effective_template_id: string | null
  /** Where the value came from. */
  source: 'section_override' | 'project_swap' | 'wireframe' | 'none'
  /** When source === 'project_swap', the swap entry's metadata. NULL otherwise. */
  project_swap: FigmaLayoutSwapEntry | null
}

/** Resolve the effective Figma layout for a single section. */
export function effectiveFigmaTemplate(
  section: Pick<WebSection, 'content_template_id' | 'figma_template_override_id'>,
  projectSwaps: StrategyWebProject['figma_layout_swaps'] | null | undefined,
): EffectiveTemplateInfo {
  if (section.figma_template_override_id) {
    return {
      effective_template_id: section.figma_template_override_id,
      source: 'section_override',
      project_swap: null,
    }
  }
  const original = section.content_template_id
  if (original && projectSwaps && projectSwaps[original]) {
    const swap = projectSwaps[original]
    return {
      effective_template_id: swap.to_template_id,
      source: 'project_swap',
      project_swap: swap,
    }
  }
  if (original) {
    return { effective_template_id: original, source: 'wireframe', project_swap: null }
  }
  return { effective_template_id: null, source: 'none', project_swap: null }
}

/** Set a site-wide layout swap. Returns a NEW figma_layout_swaps object
 *  (immutable update — caller persists it back to the project row). */
export function setProjectSwap(
  current: StrategyWebProject['figma_layout_swaps'] | null | undefined,
  fromTemplateId: string,
  entry: FigmaLayoutSwapEntry,
): Record<string, FigmaLayoutSwapEntry> {
  const next = { ...(current ?? {}) }
  next[fromTemplateId] = entry
  return next
}

/** Clear a site-wide swap (designer reverted their swap choice). */
export function clearProjectSwap(
  current: StrategyWebProject['figma_layout_swaps'] | null | undefined,
  fromTemplateId: string,
): Record<string, FigmaLayoutSwapEntry> {
  const next = { ...(current ?? {}) }
  delete next[fromTemplateId]
  return next
}

/** Group sections by their wireframe-stage content_template_id —
 *  the rows of the Design Handoff swap board. Sections without a
 *  template are skipped (freehand). */
export function groupSectionsByWireframeTemplate<
  T extends Pick<WebSection, 'id' | 'content_template_id'>,
>(sections: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const s of sections) {
    const t = s.content_template_id
    if (!t) continue
    const arr = out.get(t) ?? []
    arr.push(s)
    out.set(t, arr)
  }
  return out
}
