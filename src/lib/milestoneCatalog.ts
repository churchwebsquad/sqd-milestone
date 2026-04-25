/**
 * Single source of truth for milestone names + the squad/pathway/step
 * hierarchy that powers the Library's "Workflow Step" picker.
 *
 * Both the Template Editor and the Library reference the same
 * `strategy_milestone_definitions` table — Library docs are now tagged with
 * step-level workflow values (e.g. "Strategy Brief", "Brand Guide") rather
 * than the high-level phase names that were hardcoded into Notion options
 * before this change. Notion auto-creates new multi-select options when a
 * value is written, so the data layer doesn't require a Notion schema
 * change to start using these.
 */

import { supabase } from './supabase'

export interface MilestoneDef {
  id: string
  squad: string
  pathway: string
  step_number: number
  step_name: string
  section_group: string | null
  is_partner_facing: boolean
}

/** Squad → Strategy `Department` mapping. The Strategy module uses
 *  `branding` while the milestone definitions table uses `brand`; this is
 *  the one place that bridges the two. */
export function squadToStrategyDept(squad: string): 'web' | 'branding' | 'social' | 'all-in' | null {
  switch (squad) {
    case 'web':     return 'web'
    case 'brand':   return 'branding'
    case 'social':  return 'social'
    case 'all-in':  return 'all-in'
    default:        return null
  }
}

const SQUAD_LABEL: Record<string, string> = {
  brand: 'Brand',
  web: 'Web',
  social: 'Social',
  'all-in': 'All In',
}

const PATHWAY_LABEL: Record<string, string> = {
  new_brand:        'New Brand',
  existing_brand:   'Existing Brand',
  ministry_subbrand:'Ministry Subbrand',
  redesign:         'Redesign',
  audit:            'Audit',
  refresh:          'Refresh',
  'Web Support':    'Web Support',
  'Discovery & Strategy': 'Discovery & Strategy',
}

export function squadLabel(squad: string): string {
  return SQUAD_LABEL[squad] ?? squad
}
export function pathwayLabel(pathway: string): string {
  return PATHWAY_LABEL[pathway] ?? pathway
}

/** A flat list of step names — what we write to Notion's multi-select.
 *  Step names are unique enough that the user can recognize them in a
 *  list (e.g., "Brand Asset Audit", "Site Launch"). */
export function stepNames(defs: MilestoneDef[]): string[] {
  return [...new Set(defs.map(d => d.step_name))].sort()
}

export interface SquadGroup {
  squad: string
  squadLabel: string
  pathways: PathwayGroup[]
}
export interface PathwayGroup {
  squad: string
  pathway: string
  pathwayLabel: string
  steps: MilestoneDef[]
}

/** Group milestones squad → pathway → step for the cascading picker.
 *  Pathways/steps are sorted; the squad order matches how the Template
 *  Editor presents them. */
export function groupMilestones(defs: MilestoneDef[]): SquadGroup[] {
  const SQUAD_ORDER = ['all-in', 'brand', 'web', 'social']
  const bySquad = new Map<string, MilestoneDef[]>()
  for (const d of defs) {
    if (!bySquad.has(d.squad)) bySquad.set(d.squad, [])
    bySquad.get(d.squad)!.push(d)
  }
  const out: SquadGroup[] = []
  for (const squad of SQUAD_ORDER) {
    const defsForSquad = bySquad.get(squad)
    if (!defsForSquad?.length) continue
    const byPathway = new Map<string, MilestoneDef[]>()
    for (const d of defsForSquad) {
      if (!byPathway.has(d.pathway)) byPathway.set(d.pathway, [])
      byPathway.get(d.pathway)!.push(d)
    }
    const pathways: PathwayGroup[] = [...byPathway.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pathway, steps]) => ({
        squad,
        pathway,
        pathwayLabel: pathwayLabel(pathway),
        steps: steps.slice().sort((a, b) => a.step_number - b.step_number),
      }))
    out.push({ squad, squadLabel: squadLabel(squad), pathways })
  }
  return out
}

let cache: MilestoneDef[] | null = null
let inflight: Promise<MilestoneDef[]> | null = null

/** Load all active milestone defs. Cached module-wide for the session
 *  (the source rarely changes within a single user's visit). */
export async function loadMilestones(): Promise<MilestoneDef[]> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const { data, error } = await supabase
      .from('strategy_milestone_definitions')
      .select('id, squad, pathway, step_number, step_name, section_group, is_partner_facing')
      .eq('is_active', true)
      .order('squad')
      .order('pathway')
      .order('step_number')
    inflight = null
    if (error) throw error
    cache = (data ?? []) as MilestoneDef[]
    return cache
  })()
  return inflight
}
