// Writers: typed write input → Notion property payloads.
//
// Mirror of `parsers.ts` — the parser file owns property *names*, this file
// owns the inverse encoding into the JSON shape Notion's REST API expects.
// Both reuse the `*_PROP` constants exported from parsers.ts so reads and
// writes stay locked in step.
//
// Convention: passing `undefined` means "don't touch this field" (omitted
// from the payload). Passing `null` means "clear it" — Notion accepts an
// empty/null value in the property payload.

import { INIT_PROP, MS_PROP, PROG_PROP, DOC_PROP } from './parsers.ts'
import { DB } from './ops/data-sources.ts'
import type {
  Department, DocCreate, DocWritable, InitiativeWritable, InitiativeCreate,
  MilestoneStatus, MilestoneWritable, MilestoneCreate, Priority, DateConfidence,
  ProgressCategory, ProgressWritable, ProgressCreate, InitiativeStatus,
  VerificationStatus,
} from './types.ts'

// ── Enum → Notion select-name mapping ────────────────────────────────────
//
// Notion's API takes the human-readable select option name. Mappings here
// are the inverse of the normalizers in parsers.ts.

const DEPT_OUT: Record<Department, string> = {
  'all-in':   'All In',
  'social':   'Social',
  'branding': 'Branding',
  'web':      'Web',
}

const STATUS_OUT: Record<InitiativeStatus, string> = {
  'proposed':     'Proposed',
  'scoping':      'Scoping',
  'in-progress':  'In Progress',
  'testing':      'Testing',
  'blocked':      'Blocked',
  'in-review':    'In Review',
  'launched':     'Launched',
  'paused':       'Paused',
  'archived':     'Archived',
}

const MS_STATUS_OUT: Record<MilestoneStatus, string> = {
  'proposed':    'Proposed',
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  'blocked':     'Blocked',
  'complete':    'Complete',
  'skipped':     'Skipped',
}

const PRIORITY_OUT: Record<Priority, string> = {
  high:   'High',
  medium: 'Medium',
  low:    'Low',
}

const DATE_CONF_OUT: Record<DateConfidence, string> = {
  'hard-deadline': 'Hard Deadline',
  'soft-target':   'Soft Target',
  'exploratory':   'Exploratory',
  'tbd':           'TBD',
}

const CATEGORY_OUT: Record<ProgressCategory, string> = {
  progress: 'Progress',
  decision: 'Decision',
  resource: 'Resource',
  feedback: 'Feedback',
  intel:    'Intel',
  blocker:  'Blocker',
}

const VERIFICATION_OUT: Record<VerificationStatus, string> = {
  'needs-verification': 'Needs Verification',
  'in-progress':        'In Progress',
  'verified':           'Verified',
  'outdated':           'Outdated',
}

// ── Field-level property builders ─────────────────────────────────────────

export function titleProp(text: string): unknown {
  return { title: [{ type: 'text', text: { content: text } }] }
}

export function richTextProp(text: string | null): unknown {
  if (text === null || text === '') return { rich_text: [] }
  // Plain-text round-trip — split on blank lines, write each paragraph as
  // its own run separated by `\n`. We don't try to parse markdown.
  return { rich_text: [{ type: 'text', text: { content: text } }] }
}

export function selectProp(name: string | null): unknown {
  return { select: name ? { name } : null }
}

export function multiSelectProp(names: string[]): unknown {
  return { multi_select: names.map(name => ({ name })) }
}

export function dateProp(iso: string | null): unknown {
  return { date: iso ? { start: iso } : null }
}

export function peopleProp(userIds: string[]): unknown {
  return { people: userIds.map(id => ({ object: 'user', id })) }
}

export function relationProp(pageIds: string[]): unknown {
  return { relation: pageIds.map(id => ({ id })) }
}

export function numberProp(n: number | null): unknown {
  return { number: n }
}

export function urlProp(url: string | null): unknown {
  return { url: url ?? null }
}

export function checkboxProp(value: boolean): unknown {
  return { checkbox: value }
}

/** `status` properties have a different shape than `select`. Notion lets a
 *  user clear a status (set to none); we don't expose that — pass a name or
 *  null. */
export function statusProp(name: string | null): unknown {
  return { status: name ? { name } : null }
}

// ── Entity-level patch builders ───────────────────────────────────────────

/** Build a `{ properties }` patch payload for an Initiative update.
 *  `undefined` keys are skipped; `null` clears the value. */
export function initiativePatch(updates: InitiativeWritable): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  if (updates.name !== undefined)
    props[INIT_PROP.NAME] = titleProp(updates.name)
  if (updates.summary !== undefined)
    props[INIT_PROP.SUMMARY] = richTextProp(updates.summary)
  if (updates.department !== undefined)
    props[INIT_PROP.DEPARTMENT] = selectProp(updates.department ? DEPT_OUT[updates.department] : null)
  if (updates.status !== undefined)
    props[INIT_PROP.STATUS] = selectProp(updates.status ? STATUS_OUT[updates.status] : null)
  if (updates.priority !== undefined)
    props[INIT_PROP.PRIORITY] = selectProp(updates.priority ? PRIORITY_OUT[updates.priority] : null)
  if (updates.targetDate !== undefined)
    props[INIT_PROP.TARGET_DATE] = dateProp(updates.targetDate)
  if (updates.targetQuarter !== undefined)
    // Notion's `Target Quarter` property is a multi_select even though
    // the UI treats it as single-valued. Wrap as a 1-element array (or
    // empty when clearing) so the API accepts the write.
    props[INIT_PROP.TARGET_QUARTER] = multiSelectProp(
      updates.targetQuarter ? [updates.targetQuarter] : [],
    )
  if (updates.dateConfidence !== undefined)
    props[INIT_PROP.DATE_CONF] = selectProp(updates.dateConfidence ? DATE_CONF_OUT[updates.dateConfidence] : null)
  if (updates.ownerId !== undefined)
    props[INIT_PROP.OWNER] = peopleProp(updates.ownerId ? [updates.ownerId] : [])
  if (updates.touchpoints !== undefined)
    props[INIT_PROP.TOUCHPOINTS] = richTextProp(updates.touchpoints)
  if (updates.initiativeType !== undefined)
    props[INIT_PROP.TYPE] = multiSelectProp(updates.initiativeType)
  if (updates.goal !== undefined)
    props[INIT_PROP.GOAL] = richTextProp(updates.goal)
  if (updates.checkInCadence !== undefined)
    props[INIT_PROP.CADENCE] = selectProp(updates.checkInCadence)
  return { properties: props }
}

export function initiativeCreate(input: InitiativeCreate): Record<string, unknown> {
  const patch = initiativePatch(input)
  return {
    parent: { database_id: DB.INITIATIVES },
    properties: patch.properties,
  }
}

export function milestonePatch(updates: MilestoneWritable): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  if (updates.name !== undefined)
    props[MS_PROP.NAME] = titleProp(updates.name)
  if (updates.initiativeIds !== undefined)
    props[MS_PROP.INITIATIVE] = relationProp(updates.initiativeIds)
  if (updates.status !== undefined)
    props[MS_PROP.STATUS] = selectProp(MS_STATUS_OUT[updates.status])
  if (updates.targetDate !== undefined)
    props[MS_PROP.TARGET_DATE] = dateProp(updates.targetDate)
  if (updates.dateConfidence !== undefined)
    props[MS_PROP.DATE_CONF] = selectProp(updates.dateConfidence ? DATE_CONF_OUT[updates.dateConfidence] : null)
  if (updates.order !== undefined)
    props[MS_PROP.ORDER] = numberProp(updates.order)
  if (updates.notes !== undefined)
    props[MS_PROP.NOTES] = richTextProp(updates.notes)
  if (updates.ownerId !== undefined)
    props[MS_PROP.OWNER] = peopleProp(updates.ownerId ? [updates.ownerId] : [])
  if (updates.suggestedById !== undefined)
    props[MS_PROP.SUGGESTED_BY] = relationProp(updates.suggestedById ? [updates.suggestedById] : [])
  if (updates.completionDate !== undefined)
    props[MS_PROP.COMPLETION_DATE] = dateProp(updates.completionDate)
  return { properties: props }
}

export function milestoneCreate(input: MilestoneCreate): Record<string, unknown> {
  const patch = milestonePatch(input)
  return {
    parent: { database_id: DB.MILESTONES },
    properties: patch.properties,
  }
}

export function progressPatch(updates: ProgressWritable): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  if (updates.title !== undefined)
    props[PROG_PROP.TITLE] = titleProp(updates.title)
  if (updates.body !== undefined)
    props[PROG_PROP.BODY] = richTextProp(updates.body)
  if (updates.categories !== undefined)
    props[PROG_PROP.CATEGORY] = multiSelectProp(updates.categories.map(c => CATEGORY_OUT[c]))
  if (updates.initiativeId !== undefined)
    props[PROG_PROP.INITIATIVE] = relationProp(updates.initiativeId ? [updates.initiativeId] : [])
  if (updates.actionItemIds !== undefined)
    props[PROG_PROP.ACTION_ITEMS] = relationProp(updates.actionItemIds ?? [])
  if (updates.datePosted !== undefined)
    props[PROG_PROP.DATE_POSTED] = dateProp(updates.datePosted)
  return { properties: props }
}

/** Progress create needs the Author resolved server-side. The resolver
 *  passes its `authorId` (or null) here; we set the people property only
 *  when we have a resolved id. */
export function progressCreate(input: ProgressCreate, authorId: string | null): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10)
  const props: Record<string, unknown> = {
    [PROG_PROP.TITLE]:       titleProp(input.title),
    [PROG_PROP.BODY]:        richTextProp(input.body),
    [PROG_PROP.CATEGORY]:    multiSelectProp(input.categories.map(c => CATEGORY_OUT[c])),
    [PROG_PROP.INITIATIVE]:  relationProp([input.initiativeId]),
    [PROG_PROP.DATE_POSTED]: dateProp(today),
  }
  if (input.actionItemIds && input.actionItemIds.length > 0) {
    props[PROG_PROP.ACTION_ITEMS] = relationProp(input.actionItemIds)
  }
  if (authorId) props[PROG_PROP.AUTHOR] = peopleProp([authorId])
  return {
    parent: { database_id: DB.PROGRESS },
    properties: props,
  }
}

export function docPatch(updates: DocWritable): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  if (updates.title !== undefined)
    props[DOC_PROP.TITLE] = titleProp(updates.title)
  if (updates.department !== undefined)
    props[DOC_PROP.DEPARTMENT] = selectProp(updates.department ? DEPT_OUT[updates.department] : null)
  if (updates.groups !== undefined)
    props[DOC_PROP.GROUP] = multiSelectProp(updates.groups)
  if (updates.types !== undefined)
    props[DOC_PROP.TYPE] = multiSelectProp(updates.types)
  if (updates.workflowSteps !== undefined)
    props[DOC_PROP.WORKFLOW_STEP] = multiSelectProp(updates.workflowSteps)
  if (updates.verificationStatus !== undefined)
    props[DOC_PROP.VERIFICATION] = statusProp(updates.verificationStatus ? VERIFICATION_OUT[updates.verificationStatus] : null)
  if (updates.verifiedBy !== undefined)
    props[DOC_PROP.VERIFIED_BY] = peopleProp(updates.verifiedBy ? [updates.verifiedBy] : [])
  if (updates.verifiedOn !== undefined)
    props[DOC_PROP.VERIFIED_ON] = dateProp(updates.verifiedOn)
  if (updates.priorityDoc !== undefined)
    props[DOC_PROP.PRIORITY] = checkboxProp(updates.priorityDoc)
  if (updates.linkedInitiativeIds !== undefined)
    props[DOC_PROP.LINKED_INITS] = relationProp(updates.linkedInitiativeIds)
  return { properties: props }
}

/** Build a Notion `pages.create` payload for a new Doc Hub doc.
 *  Verification Status defaults to "Needs Verification" — staff don't get
 *  to publish without director sign-off. The optional plain-text body is
 *  written as a single paragraph block on the page; rich editing happens
 *  in Notion.
 *
 *  VP suggest mode: when `vpNote` is set, the doc is tagged with the
 *  "Suggested Document" type so the Doc Manager's Suggested bucket can
 *  pick it up cleanly (vs. matching on Document Group, which we used to
 *  do but turned out to be ambiguous because Group doubles as a content
 *  taxonomy). The note text itself is *not* written as body content —
 *  `createDoc` posts it as a Notion page comment after the page is
 *  created (with a body-block fallback if the integration lacks "Insert
 *  comments" capability). */
export function docCreate(input: DocCreate): Record<string, unknown> {
  const isVPSuggested = !!input.vpNote && !!input.vpNote.trim()
  const types = isVPSuggested
    ? Array.from(new Set([...(input.types ?? []), 'Suggested Document']))
    : input.types

  const props: Record<string, unknown> = {
    [DOC_PROP.TITLE]:        titleProp(input.title),
    [DOC_PROP.DEPARTMENT]:   selectProp(DEPT_OUT[input.department]),
    [DOC_PROP.GROUP]:        multiSelectProp(input.groups),
    [DOC_PROP.VERIFICATION]: statusProp(VERIFICATION_OUT['needs-verification']),
  }
  if (types?.length) props[DOC_PROP.TYPE] = multiSelectProp(types)
  if (input.workflowSteps?.length) props[DOC_PROP.WORKFLOW_STEP] = multiSelectProp(input.workflowSteps)
  if (input.priorityDoc !== undefined) props[DOC_PROP.PRIORITY] = checkboxProp(input.priorityDoc)

  const payload: Record<string, unknown> = {
    parent: { database_id: DB.DOC_HUB },
    properties: props,
  }
  if (input.body && input.body.trim()) {
    payload.children = [{
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: input.body } }],
      },
    }]
  }
  return payload
}

/** Yellow callout used as the VP-note fallback when the integration lacks
 *  Notion's "Insert comments" capability. Keeps the note visible on the
 *  page so the assigned director still sees the framing on first open. */
export function vpNoteCalloutBlock(note: string): Record<string, unknown> {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: `Note from VP of Strategy: ${note}` } }],
      icon: { type: 'emoji', emoji: '📩' },
      color: 'yellow_background',
    },
  }
}

/** Append a "Request Changes" callout block to a doc page. Used by
 *  `request-doc-changes` so reviewer feedback is visible to authors when
 *  they re-open the doc in Notion. Status stays at Needs Verification. */
export function requestChangesBlock(reviewerName: string, comments: string): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10)
  const body = `Request Changes from ${reviewerName} on ${today}: ${comments}`
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: body } }],
      icon: { type: 'emoji', emoji: '💬' },
      color: 'yellow_background',
    },
  }
}

/** Mark a page as archived. Notion's only "delete" op. */
export function archivePatch(): Record<string, unknown> {
  return { archived: true }
}

// ── Mark-check-in convenience ─────────────────────────────────────────────

/** Patch payload for stamping a check-in. `note` writes Check-In Note
 *  only when provided. Leaves all other fields untouched. */
export function checkInPatch(notionUserId: string | null, note: string | null): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10)
  const props: Record<string, unknown> = {
    [INIT_PROP.LAST_CHECKED]: dateProp(today),
  }
  if (notionUserId) props[INIT_PROP.LAST_BY] = peopleProp([notionUserId])
  if (note !== null) props[INIT_PROP.CHECK_IN_NOTE] = richTextProp(note)
  return { properties: props }
}
