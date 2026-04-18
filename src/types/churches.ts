import type { MilestoneStatus } from './database'

// ── Grid page types ──────────────────────────────────────────────────────────

export type ChurchSortField =
  | 'church_name'
  | 'member'
  | 'account_status'
  | 'plan'
  | 'cohort'
  | 'css_rep'
  | 'web_pathway'
  | 'brand_pathway'
  | 'web_milestone'
  | 'brand_milestone'

export interface ChurchGridRow {
  member: number
  church_name: string | null
  account_status: string | null
  plan: string | null
  cohort: string | null
  css_rep: string | null
  instagram: string | null
  facebook: string | null
  youtube: string | null
  web_pathway: string | null
  brand_pathway: string | null
  web_milestone: string | null
  web_milestone_status: MilestoneStatus | null
  brand_milestone: string | null
  brand_milestone_status: MilestoneStatus | null
}

/**
 * Sort priority for account_status column.
 * Trial first, cancelled last.
 */
export const ACCOUNT_STATUS_ORDER: Record<string, number> = {
  Trial: 0,
  Active: 1,
  'Non-Renewing': 2,
  Paused: 3,
  Cancelled: 4,
}

export function accountStatusSortValue(status: string | null): number {
  if (!status) return 3
  return ACCOUNT_STATUS_ORDER[status] ?? 3
}

// ── Handoff form JSONB shape ─────────────────────────────────────────────────

export interface HandoffForm {
  form?: {
    selectedPathways?: string | string[]
    selectedPathway?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

const BRAND_PATHWAY_SLUGS: Record<string, string> = {
  'pathway-a': 'New Brand',
  'pathway-b': 'Use Existing Brand',
}

/** Extract web pathways from handoff_web_form.form.selectedPathways (array) */
export function extractWebPathway(form: Record<string, unknown> | null): string | null {
  if (!form) return null
  const inner = (form as HandoffForm).form
  if (!inner) return null
  const val = inner.selectedPathways
  if (Array.isArray(val)) return val.join(', ')
  return typeof val === 'string' ? val : null
}

/** Extract brand pathway from handoff_brand_form.form.selectedPathway (singular slug) */
export function extractBrandPathway(form: Record<string, unknown> | null): string | null {
  if (!form) return null
  const inner = (form as HandoffForm).form
  if (!inner) return null
  const slug = inner.selectedPathway
  if (typeof slug === 'string') return BRAND_PATHWAY_SLUGS[slug] ?? slug
  return null
}

/** Extract plan from accounts.acc_airtable_data.fields.Plan + AddOns.
 *  Anything containing "All In" normalizes to "All In". */
export function extractPlan(airtableData: Record<string, unknown> | null): string | null {
  if (!airtableData) return null
  const fields = airtableData.fields as Record<string, unknown> | undefined
  if (!fields) return null
  const rawPlan = fields.Plan
  if (!rawPlan) return null
  const planStr = typeof rawPlan === 'string' ? rawPlan : String(rawPlan)
  if (planStr.toLowerCase().includes('all in')) return 'All In'
  const addons = fields.AddOns
  const addonsStr = addons ? (typeof addons === 'string' ? addons : String(addons)) : null
  return addonsStr ? `${planStr} + ${addonsStr}` : planStr
}

// ── Detail page section IDs ──────────────────────────────────────────────────

export const DETAIL_SECTIONS = [
  { id: 'church-information', label: 'Church Information' },
  { id: 'assets', label: 'Assets' },
  { id: 'account-manager-handoff', label: 'Account Manager Handoff' },
  { id: 'brand-squad', label: 'Brand Squad' },
  { id: 'brand-voice', label: 'Brand Voice' },
  { id: 'website-squad', label: 'Website Squad' },
  { id: 'social-media', label: 'Social Media' },
  { id: 'clickup-tasks', label: 'ClickUp Tasks' },
] as const

export type SectionId = (typeof DETAIL_SECTIONS)[number]['id']
