// Parsers: Notion page → clean typed shape.
// This module is the ONLY place that knows Notion property names. If a
// property gets renamed in Notion, only this file needs updating. Property
// names are exported as named constants so `_lib/writers.ts` (the reverse
// path) can reuse them — keeping reads and writes in lockstep.

import type {
  Department, DocHubEntry, Initiative, InitiativeStatus, Milestone, MilestoneStatus,
  NotionPage, NotionPersonRef, NotionProperty, NotionRichText, NotionUser,
  Priority, DateConfidence, ProgressCategory, ProgressEntry, VerificationStatus,
} from './types.ts'

// ── Notion property names (single source of truth, used by writers too) ───

export const INIT_PROP = {
  NAME:           'Initiative Name',
  NAME_FALLBACK:  'Name',
  SUMMARY:        'Summary',
  DEPARTMENT:     'Department',
  STATUS:         'Status',
  PRIORITY:       'Priority',
  TARGET_DATE:    'Target Date',
  TARGET_QUARTER: 'Target Quarter',
  DATE_CONF:      'Date Confidence',
  OWNER:          'Owner',
  TOUCHPOINTS:    'Touchpoints',
  TYPE:           'Initiative Type',
  GOAL:           'Goal / Expected Outcome',
  GOAL_FALLBACK:  'Goal',
  CADENCE:        'Check-In Cadence',
  LAST_CHECKED:   'Last Checked On',
  LAST_BY:        'Last Checked By',
  NEXT_CHECK:     'Next Check-In Due',
  PARENT:         'Parent Initiative',
  CHECK_IN_NOTE:  'Check-In Note',
} as const

/** "MS_PROP" is a legacy name kept stable for the codebase — the database
 *  has been renamed from "Initiative Milestones" to "Initiative Action Items"
 *  but the typed shapes still call them milestones internally. The title
 *  property changed from "Milestone Name" to "Action Item" in Notion. */
export const MS_PROP = {
  NAME:          'Action Item',
  NAME_FALLBACK: 'Milestone Name',   // pre-rename Notion docs
  INITIATIVE:    'Initiative',
  DEPARTMENT:    'Department',
  STATUS:        'Status',
  TARGET_DATE:   'Target Date',
  DATE_CONF:     'Date Confidence',
  ORDER:         'Order',
  NOTES:         'Notes',
  OWNER:         'Owner',
  // Phase 2.5 additions — gracefully no-op when Ashley hasn't yet added
  // them in Notion; the parser returns null/empty and the writer still
  // attempts the PATCH (Notion ignores unknown properties on updates).
  SUGGESTED_BY:    'Suggested By',
  COMPLETION_DATE: 'Completion Date',
} as const

export const PROG_PROP = {
  TITLE:          'Title',
  TITLE_FALLBACK: 'Name',
  INITIATIVE:     'Initiative',
  DEPARTMENT:     'Department',
  BODY:           'Body',
  DATE_POSTED:    'Date Posted',
  AUTHOR:         'Author',
  CATEGORY:       'Category',
  // Existing Notion relation pointing at the Milestones DB. When a
  // progress entry is logged against a specific Action Item this
  // captures it. The exact Notion property name is "Action Items"
  // (matching what's already on the database). If a workspace renames
  // it, swap this constant + a redeploy is enough to retarget.
  ACTION_ITEMS:   'Action Items',
} as const

export const DOC_PROP = {
  TITLE:          'Document Name',
  TITLE_FALLBACK: 'Name',
  DEPARTMENT:     'Department',
  GROUP:          'Document Group',
  TYPE:           'Type',
  WORKFLOW_STEP:  'Workflow Step',
  VERIFICATION:   'Verification Status',
  VERIFIED_BY:    'Verified By',
  VERIFIED_ON:    'Verified On',
  PRIORITY:       'Priority Doc',
  LINKED_INITS:   'Linked Initiatives',
  PARENT_DOC:     'Parent Document',
  ARCHIVED:       'Archived',
} as const

// ── Low-level property accessors ──────────────────────────────────────────

function prop(page: NotionPage, key: string): NotionProperty | undefined {
  return page.properties[key]
}

function readTitle(p: NotionProperty | undefined): string {
  if (!p || p.type !== 'title') return ''
  return (p.title ?? []).map(t => t.plain_text).join('').trim()
}

function readPlain(p: NotionProperty | undefined): string | null {
  if (!p || p.type !== 'rich_text') return null
  const txt = (p.rich_text ?? []).map(t => t.plain_text).join('').trim()
  return txt.length > 0 ? txt : null
}

function readSelect(p: NotionProperty | undefined): string | null {
  if (!p) return null
  if (p.type === 'select') return p.select?.name ?? null
  if (p.type === 'status') return p.status?.name ?? null
  return null
}

function readMultiSelect(p: NotionProperty | undefined): string[] {
  if (!p || p.type !== 'multi_select') return []
  return (p.multi_select ?? []).map(o => o.name)
}

function readDate(p: NotionProperty | undefined): string | null {
  if (!p) return null
  if (p.type === 'date') return p.date?.start ?? null
  if (p.type === 'formula' && (p.formula as { type?: string; date?: { start?: string } }).type === 'date') {
    return (p.formula as { date?: { start?: string } }).date?.start ?? null
  }
  return null
}

function readPerson(p: NotionProperty | undefined): NotionPersonRef | null {
  if (!p || p.type !== 'people') return null
  const u = p.people?.[0]
  if (!u) return null
  return {
    id: u.id,
    name: u.name,
    email: u.person?.email ?? null,
    avatarUrl: u.avatar_url ?? null,
  }
}

function readRelationIds(p: NotionProperty | undefined): string[] {
  if (!p || p.type !== 'relation') return []
  return (p.relation ?? []).map(r => r.id)
}

function readNumber(p: NotionProperty | undefined): number | null {
  if (!p || p.type !== 'number') return null
  return p.number
}

function readUrl(p: NotionProperty | undefined): string | null {
  if (!p || p.type !== 'url') return null
  return p.url
}

function readCheckbox(p: NotionProperty | undefined): boolean {
  if (!p || p.type !== 'checkbox') return false
  return p.checkbox
}

function readLastEditedTime(p: NotionProperty | undefined): string | null {
  if (!p || p.type !== 'last_edited_time') return null
  return p.last_edited_time
}

// ── Rich-text → lightly-formatted plain text (for Progress body) ─────────

export function richTextToMarkdown(runs: NotionRichText[] | undefined): string {
  if (!runs || runs.length === 0) return ''
  let out = ''
  for (const r of runs) {
    let text = r.plain_text
    const a = r.annotations ?? {}
    if (a.code)          text = '`' + text + '`'
    if (a.bold)          text = `**${text}**`
    if (a.italic)        text = `_${text}_`
    if (a.strikethrough) text = `~~${text}~~`
    const href = r.href ?? r.text?.link?.url ?? null
    if (href) text = `[${text}](${href})`
    out += text
  }
  return out
}

// ── Enum normalization ───────────────────────────────────────────────────

const DEPT_MAP: Record<string, Department> = {
  'all in':     'all-in',
  'all-in':     'all-in',
  'allin':      'all-in',
  'social':     'social',
  'branding':   'branding',
  'brand':      'branding',
  'web':        'web',
}
function normalizeDepartment(raw: string | null): Department | null {
  if (!raw) return null
  return DEPT_MAP[raw.trim().toLowerCase()] ?? null
}

const STATUS_MAP: Record<string, InitiativeStatus> = {
  'proposed':     'proposed',
  'scoping':      'scoping',
  'in progress':  'in-progress',
  'in-progress':  'in-progress',
  'testing':      'testing',
  'blocked':      'blocked',
  'in review':    'in-review',
  'in-review':    'in-review',
  'launched':     'launched',
  'paused':       'paused',
  'archived':     'archived',
}
function normalizeInitiativeStatus(raw: string | null): InitiativeStatus | null {
  if (!raw) return null
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null
}

const MILESTONE_STATUS_MAP: Record<string, MilestoneStatus> = {
  'proposed':      'proposed',
  'not started':   'not-started',
  'not-started':   'not-started',
  'in progress':   'in-progress',
  'in-progress':   'in-progress',
  'blocked':       'blocked',
  'complete':      'complete',
  'completed':     'complete',
  'done':          'complete',
  'skipped':       'skipped',
}
function normalizeMilestoneStatus(raw: string | null): MilestoneStatus {
  if (!raw) return 'not-started'
  return MILESTONE_STATUS_MAP[raw.trim().toLowerCase()] ?? 'not-started'
}

const PRIORITY_MAP: Record<string, Priority> = { high: 'high', medium: 'medium', low: 'low' }
function normalizePriority(raw: string | null): Priority | null {
  if (!raw) return null
  return PRIORITY_MAP[raw.trim().toLowerCase()] ?? null
}

const DATE_CONF_MAP: Record<string, DateConfidence> = {
  'hard deadline':  'hard-deadline',
  'hard-deadline':  'hard-deadline',
  'soft target':    'soft-target',
  'soft-target':    'soft-target',
  'exploratory':    'exploratory',
  'tbd':            'tbd',
}
function normalizeDateConfidence(raw: string | null): DateConfidence | null {
  if (!raw) return null
  return DATE_CONF_MAP[raw.trim().toLowerCase()] ?? null
}

const VERIFICATION_MAP: Record<string, VerificationStatus> = {
  'needs verification':  'needs-verification',
  'needs-verification':  'needs-verification',
  'in progress':         'in-progress',
  'in-progress':         'in-progress',
  'verified':            'verified',
  'outdated':            'outdated',
}
function normalizeVerification(raw: string | null): VerificationStatus | null {
  if (!raw) return null
  return VERIFICATION_MAP[raw.trim().toLowerCase()] ?? null
}

const CATEGORY_MAP: Record<string, ProgressCategory> = {
  'progress':   'progress',
  'decision':   'decision',
  'resource':   'resource',
  'feedback':   'feedback',
  'intel':      'intel',
  'blocker':    'blocker',
}
function normalizeCategories(raw: string[]): ProgressCategory[] {
  return raw.map(r => CATEGORY_MAP[r.trim().toLowerCase()]).filter((c): c is ProgressCategory => !!c)
}

// ── Entity parsers ───────────────────────────────────────────────────────

/**
 * Parse an Initiative page. `milestoneCompletionPct`, `updateCount`, and
 * `lastProgressAt` are aggregates — caller fills them after loading
 * milestones + progress since they can't be read from the initiative page
 * alone.
 */
export function pageToInitiative(page: NotionPage): Initiative {
  return {
    id: page.id,
    name: readTitle(prop(page, INIT_PROP.NAME)) || readTitle(prop(page, INIT_PROP.NAME_FALLBACK)) || '(untitled)',
    summary: readPlain(prop(page, INIT_PROP.SUMMARY)),
    department: normalizeDepartment(readSelect(prop(page, INIT_PROP.DEPARTMENT))),
    status: normalizeInitiativeStatus(readSelect(prop(page, INIT_PROP.STATUS))),
    priority: normalizePriority(readSelect(prop(page, INIT_PROP.PRIORITY))),
    targetDate: readDate(prop(page, INIT_PROP.TARGET_DATE)),
    // Target Quarter is a multi_select in Notion; the app treats it as
    // single-valued (first option wins). Multiple values render as the
    // first one in lists; the writer always sets a 1-element array.
    targetQuarter: readMultiSelect(prop(page, INIT_PROP.TARGET_QUARTER))[0] ?? null,
    dateConfidence: normalizeDateConfidence(readSelect(prop(page, INIT_PROP.DATE_CONF))),
    owner: readPerson(prop(page, INIT_PROP.OWNER)),
    touchpoints: readPlain(prop(page, INIT_PROP.TOUCHPOINTS)),
    initiativeType: readMultiSelect(prop(page, INIT_PROP.TYPE)),
    goal: readPlain(prop(page, INIT_PROP.GOAL)) ?? readPlain(prop(page, INIT_PROP.GOAL_FALLBACK)),
    checkInCadence: readSelect(prop(page, INIT_PROP.CADENCE)) ?? readPlain(prop(page, INIT_PROP.CADENCE)),
    lastCheckedOn: readDate(prop(page, INIT_PROP.LAST_CHECKED)),
    lastCheckedBy: readPerson(prop(page, INIT_PROP.LAST_BY))?.name ?? null,
    nextCheckInDue: readDate(prop(page, INIT_PROP.NEXT_CHECK)),
    parentId: readRelationIds(prop(page, INIT_PROP.PARENT))[0] ?? null,
    milestoneTotalCount: 0,
    milestoneCompletedCount: 0,
    milestoneCompletionPct: null,
    updateCount: 0,
    lastProgressAt: null,
    notionUrl: page.url,
  }
}

export function pageToMilestone(page: NotionPage): Milestone {
  const initIds = readRelationIds(prop(page, MS_PROP.INITIATIVE))
  return {
    id: page.id,
    name: readTitle(prop(page, MS_PROP.NAME)) || readTitle(prop(page, MS_PROP.NAME_FALLBACK)) || '(untitled)',
    initiativeIds: initIds,
    initiativeName: null, // enriched post-load (resolves first id only)
    department: normalizeDepartment(readSelect(prop(page, MS_PROP.DEPARTMENT))),
    status: normalizeMilestoneStatus(readSelect(prop(page, MS_PROP.STATUS))),
    targetDate: readDate(prop(page, MS_PROP.TARGET_DATE)),
    dateConfidence: normalizeDateConfidence(readSelect(prop(page, MS_PROP.DATE_CONF))),
    order: readNumber(prop(page, MS_PROP.ORDER)),
    notes: readPlain(prop(page, MS_PROP.NOTES)),
    owner: readPerson(prop(page, MS_PROP.OWNER)),
    notionUrl: page.url,
    suggestedById: readRelationIds(prop(page, MS_PROP.SUGGESTED_BY))[0] ?? null,
    completionDate: readDate(prop(page, MS_PROP.COMPLETION_DATE)),
  }
}

export function pageToProgress(page: NotionPage): ProgressEntry {
  const initIds = readRelationIds(prop(page, PROG_PROP.INITIATIVE))
  const actionItemIds = readRelationIds(prop(page, PROG_PROP.ACTION_ITEMS))
  // Rich-text body: concat runs with markdown-ish formatting preserved.
  const bodyProp = prop(page, PROG_PROP.BODY)
  const body = (bodyProp && bodyProp.type === 'rich_text')
    ? richTextToMarkdown(bodyProp.rich_text)
    : ''
  return {
    id: page.id,
    title: readTitle(prop(page, PROG_PROP.TITLE)) || readTitle(prop(page, PROG_PROP.TITLE_FALLBACK)) || '(untitled update)',
    initiativeId: initIds[0] ?? null,
    initiativeName: null,
    department: normalizeDepartment(readSelect(prop(page, PROG_PROP.DEPARTMENT))),
    datePosted: readDate(prop(page, PROG_PROP.DATE_POSTED)) ?? page.created_time,
    author: readPerson(prop(page, PROG_PROP.AUTHOR)),
    body,
    categories: normalizeCategories(readMultiSelect(prop(page, PROG_PROP.CATEGORY))),
    actionItemIds,
  }
}

export function pageToDoc(page: NotionPage): DocHubEntry {
  return {
    id: page.id,
    title: readTitle(prop(page, DOC_PROP.TITLE)) || readTitle(prop(page, DOC_PROP.TITLE_FALLBACK)) || '(untitled)',
    notionUrl: page.url,
    department: normalizeDepartment(readSelect(prop(page, DOC_PROP.DEPARTMENT))),
    groups: readMultiSelect(prop(page, DOC_PROP.GROUP)),
    types: readMultiSelect(prop(page, DOC_PROP.TYPE)),
    workflowSteps: readMultiSelect(prop(page, DOC_PROP.WORKFLOW_STEP)),
    verificationStatus: normalizeVerification(readSelect(prop(page, DOC_PROP.VERIFICATION))),
    verifiedBy: readPerson(prop(page, DOC_PROP.VERIFIED_BY)),
    verifiedOn: readDate(prop(page, DOC_PROP.VERIFIED_ON)),
    priorityDoc: readCheckbox(prop(page, DOC_PROP.PRIORITY)),
    linkedInitiativeIds: readRelationIds(prop(page, DOC_PROP.LINKED_INITS)),
    parentDocId: readRelationIds(prop(page, DOC_PROP.PARENT_DOC))[0] ?? null,
    lastEditedTime: readLastEditedTime(prop(page, 'Last edited time')) ?? page.last_edited_time,
  }
}

// ── User ref builder ─────────────────────────────────────────────────────

export function notionUserToRef(u: NotionUser): NotionPersonRef {
  return {
    id: u.id,
    name: u.name,
    email: u.person?.email ?? null,
    avatarUrl: u.avatar_url ?? null,
  }
}
