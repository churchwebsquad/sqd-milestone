// Duplicated shapes from `src/types/strategy.ts`. The Deno edge function
// bundle can't import from the Vite `src/` tree, so these live here too.
// Keep in sync — renames here must also happen in the client-side file.

export type Department = 'all-in' | 'social' | 'branding' | 'web'

export type InitiativeStatus =
  | 'proposed'
  | 'scoping'
  | 'in-progress'
  | 'testing'
  | 'blocked'
  | 'in-review'
  | 'launched'
  | 'paused'
  | 'archived'

export type MilestoneStatus = 'proposed' | 'not-started' | 'in-progress' | 'blocked' | 'complete' | 'skipped'

export type Priority = 'high' | 'medium' | 'low'

export type DateConfidence = 'hard-deadline' | 'soft-target' | 'exploratory' | 'tbd'

export type ProgressCategory =
  | 'progress'
  | 'decision'
  | 'resource'
  | 'feedback'
  | 'intel'
  | 'blocker'

export interface NotionPersonRef {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

export interface Initiative {
  id: string
  name: string
  summary: string | null
  department: Department | null
  status: InitiativeStatus | null
  priority: Priority | null
  targetDate: string | null
  targetQuarter: string | null
  dateConfidence: DateConfidence | null
  owner: NotionPersonRef | null
  touchpoints: string | null
  initiativeType: string[]
  goal: string | null
  checkInCadence: string | null
  lastCheckedOn: string | null
  lastCheckedBy: string | null
  nextCheckInDue: string | null
  parentId: string | null
  milestoneTotalCount: number
  milestoneCompletedCount: number
  milestoneCompletionPct: number | null
  updateCount: number
  lastProgressAt: string | null
  notionUrl: string
}

export interface Milestone {
  id: string
  name: string
  /** All initiatives this Action Item / Milestone is linked to. The
   *  Notion `Initiative` property is a many-to-many relation so a
   *  single task can sit under multiple initiatives. Empty array
   *  means unlinked. */
  initiativeIds: string[]
  /** Resolved name of the *primary* (first) initiative — kept for
   *  cards / feeds that render a single chip. */
  initiativeName: string | null
  department: Department | null
  status: MilestoneStatus
  targetDate: string | null
  dateConfidence: DateConfidence | null
  order: number | null
  notes: string | null
  owner: NotionPersonRef | null
  notionUrl: string
  // Phase 2.5 (Action Items) — read-only `Suggested By` chain (the page
  // ID of the Action Item that suggested this one) + the date the status
  // flipped to Complete. Empty/null when the Notion properties don't
  // exist yet.
  suggestedById: string | null
  completionDate: string | null
}

export interface ProgressEntry {
  id: string
  title: string
  initiativeId: string | null
  initiativeName: string | null
  department: Department | null
  datePosted: string | null
  author: NotionPersonRef | null
  body: string
  categories: ProgressCategory[]
  actionItemIds: string[]
  /** Resolved names for `actionItemIds`, same order. Filled by ops
   *  that have a milestone list in scope (initiative detail, action
   *  item detail, list-progress when it can spare the second pass). */
  actionItemNames?: string[]
}

export interface MilestoneEvent {
  kind: 'milestone-event'
  id: string
  milestoneName: string
  /** Primary (first) parent initiative — used for the single chip and
   *  legacy navigation. Multi-linked items list every parent in
   *  `initiativeIds`. */
  initiativeId: string | null
  initiativeIds: string[]
  initiativeName: string | null
  department: Department | null
  completedAt: string | null
  notionUrl: string
}

export interface ProgressFeedEntry extends ProgressEntry {
  kind: 'progress-entry'
}

export type FeedItem = ProgressFeedEntry | MilestoneEvent

export type VerificationStatus = 'needs-verification' | 'in-progress' | 'verified' | 'outdated'

export interface DocHubEntry {
  id: string
  title: string
  notionUrl: string
  department: Department | null
  groups: string[]
  types: string[]
  workflowSteps: string[]
  verificationStatus: VerificationStatus | null
  verifiedBy: NotionPersonRef | null
  verifiedOn: string | null
  priorityDoc: boolean
  linkedInitiativeIds: string[]
  parentDocId: string | null
  lastEditedTime: string | null
}

export interface DocBlock {
  id?: string
  type:
    | 'paragraph' | 'heading_1' | 'heading_2' | 'heading_3'
    | 'bulleted_list_item' | 'numbered_list_item'
    | 'callout' | 'quote' | 'code' | 'divider' | 'image'
    | 'to_do' | 'toggle' | 'bookmark' | 'embed' | 'video' | 'link_preview'
    | 'table' | 'table_row'
    | 'container'
    | 'child_page'
    | 'unsupported'
  text: string
  url?: string
  meta?: {
    emoji?: string | null
    language?: string | null
    checked?: boolean
    caption?: string
    columnHeader?: boolean
    rowHeader?: boolean
  }
  cells?: string[]
  children?: DocBlock[]
}

export interface DocContent {
  doc: DocHubEntry
  blocks: DocBlock[]
}

// ── Writable shapes (Phase 2) ─────────────────────────────────────────────

export interface InitiativeWritable {
  name?: string
  summary?: string | null
  department?: Department | null
  status?: InitiativeStatus | null
  priority?: Priority | null
  targetDate?: string | null
  targetQuarter?: string | null
  dateConfidence?: DateConfidence | null
  ownerId?: string | null
  touchpoints?: string | null
  initiativeType?: string[]
  goal?: string | null
  checkInCadence?: string | null
}

export interface InitiativeCreate extends InitiativeWritable {
  name: string
}

export interface MilestoneWritable {
  name?: string
  /** Replaces the full relation. Pass `[]` to clear all parents. */
  initiativeIds?: string[]
  status?: MilestoneStatus
  targetDate?: string | null
  dateConfidence?: DateConfidence | null
  order?: number | null
  notes?: string | null
  ownerId?: string | null
  /** Page ID of the Action Item that suggested this one. */
  suggestedById?: string | null
  /** ISO date — typically stamped automatically when status flips to Complete. */
  completionDate?: string | null
}

export interface MilestoneCreate extends MilestoneWritable {
  name: string
  /** At least one parent initiative is required at create time. */
  initiativeIds: string[]
}

export interface ProgressWritable {
  title?: string
  body?: string
  categories?: ProgressCategory[]
  initiativeId?: string | null
  actionItemIds?: string[]
  datePosted?: string | null
}

export interface ProgressCreate {
  title: string
  body: string
  categories: ProgressCategory[]
  initiativeId: string
  actionItemIds?: string[]
}

export interface DocWritable {
  title?: string
  department?: Department | null
  groups?: string[]
  types?: string[]
  workflowSteps?: string[]
  verificationStatus?: VerificationStatus | null
  verifiedBy?: string | null
  verifiedOn?: string | null
  priorityDoc?: boolean
  linkedInitiativeIds?: string[]
}

export interface DocCreate {
  title: string
  department: Department
  groups: string[]
  types?: string[]
  workflowSteps?: string[]
  body?: string
  priorityDoc?: boolean
  /** When set, the page body opens with a callout block of this text
   *  prefixed with "📩 Note from VP of Strategy:" — used by the
   *  VP "Suggest a doc" flow so directors see context the moment they
   *  open the draft in Notion. */
  vpNote?: string
}

export type StrategyEntity = 'initiative' | 'milestone' | 'progress' | 'doc'

export interface NotionUserOption {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

// ── Notion REST shapes we actually touch ──────────────────────────────────

export interface NotionPage {
  id: string
  url: string
  created_time: string
  last_edited_time: string
  properties: Record<string, NotionProperty>
}

export interface NotionUser {
  object: 'user'
  id: string
  name: string | null
  avatar_url: string | null
  type?: 'person' | 'bot'
  person?: { email: string }
}

export type NotionProperty =
  | { type: 'title'; title: Array<{ plain_text: string }> }
  | { type: 'rich_text'; rich_text: NotionRichText[] }
  | { type: 'select'; select: { name: string } | null }
  | { type: 'multi_select'; multi_select: Array<{ name: string }> }
  | { type: 'status'; status: { name: string } | null }
  | { type: 'date'; date: { start: string | null; end: string | null } | null }
  | { type: 'number'; number: number | null }
  | { type: 'people'; people: NotionUser[] }
  | { type: 'relation'; relation: Array<{ id: string }>; has_more?: boolean }
  | { type: 'rollup'; rollup: { type: string; [k: string]: unknown } }
  | { type: 'formula'; formula: { type: string; [k: string]: unknown } }
  | { type: 'url'; url: string | null }
  | { type: 'checkbox'; checkbox: boolean }
  | { type: 'created_time'; created_time: string }
  | { type: 'last_edited_time'; last_edited_time: string }
  | { type: 'created_by'; created_by: NotionUser }
  | { type: 'last_edited_by'; last_edited_by: NotionUser }

export interface NotionRichText {
  type: 'text' | 'mention' | 'equation'
  plain_text: string
  href?: string | null
  annotations?: {
    bold?: boolean
    italic?: boolean
    strikethrough?: boolean
    underline?: boolean
    code?: boolean
    color?: string
  }
  text?: { content: string; link: { url: string } | null }
}
