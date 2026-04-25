/**
 * Types for the Strategy module — mirrors the parsed shapes returned by the
 * `strategy-notion` Supabase Edge Function. The edge function hides Notion's
 * raw `page.properties.*` blob and hands back clean objects; this file is
 * the typed contract between the function and the client.
 *
 * Keep this in sync with `supabase/functions/strategy-notion/_lib/types.ts`.
 * The Deno edge function can't import from `src/`, so the shapes are
 * duplicated there — rename carefully and in both places.
 */

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

/** Categories attached to a progress entry. Multi-select — an entry can
 *  carry several (e.g., an "Intel + Resource" share). */
export type ProgressCategory =
  | 'progress'
  | 'decision'
  | 'resource'
  | 'feedback'
  | 'intel'
  | 'blocker'

// ── Core entities ──────────────────────────────────────────────────────────

export interface Initiative {
  id: string
  name: string
  summary: string | null
  department: Department | null
  status: InitiativeStatus | null
  priority: Priority | null
  targetDate: string | null       // ISO date
  targetQuarter: string | null    // e.g. "Q3 2026"
  dateConfidence: DateConfidence | null
  owner: NotionPersonRef | null
  touchpoints: string | null
  initiativeType: string[]        // multi-select
  goal: string | null
  checkInCadence: string | null
  lastCheckedOn: string | null
  lastCheckedBy: string | null
  nextCheckInDue: string | null
  parentId: string | null
  /** Derived at list time (count of Milestone rows relating to this). */
  milestoneTotalCount: number
  milestoneCompletedCount: number
  /** 0..100, or null when there are no milestones. */
  milestoneCompletionPct: number | null
  /** Count of Progress entries relating to this initiative. */
  updateCount: number
  /** ISO date of the most recent Progress entry. */
  lastProgressAt: string | null
  notionUrl: string
}

export interface Milestone {
  id: string
  name: string
  /** All initiatives this Action Item / Milestone is linked to. The
   *  Notion property is a many-to-many relation so a single task can
   *  belong to multiple initiatives (a feature we expose for Action
   *  Items but treat as informational for proper Milestones). The
   *  array is empty when nothing is linked.
   *
   *  Convenience reads: callers that only need a "primary" parent
   *  (e.g., back-link breadcrumb) use `initiativeIds[0] ?? null`. */
  initiativeIds: string[]
  /** Resolved name of the *primary* (first) initiative — kept for the
   *  cards/feeds that render a single chip. Multi-link rendering does
   *  its own resolution against the initiative list. */
  initiativeName: string | null
  department: Department | null
  status: MilestoneStatus
  targetDate: string | null       // ISO date
  dateConfidence: DateConfidence | null
  order: number | null
  notes: string | null
  owner: NotionPersonRef | null
  notionUrl: string
  // Phase 2.5 (Action Items)
  suggestedById: string | null
  completionDate: string | null
}

export interface ProgressEntry {
  id: string
  title: string
  initiativeId: string | null
  initiativeName: string | null
  department: Department | null
  datePosted: string | null       // ISO date
  author: NotionPersonRef | null
  /** Rich-text body flattened to markdown-ish plain text. The edge
   *  function renders Notion rich-text runs into `**bold**`, `[text](url)`,
   *  bullets, and paragraph breaks so the client can display faithfully. */
  body: string
  categories: ProgressCategory[]
  /** Notion `Action Items` relation. A progress entry can reference one
   *  or more Action Items it pertains to — the page lists progress
   *  scoped to that Action Item, and the user can post new updates
   *  pre-filled with the relation. */
  actionItemIds: string[]
  /** Names paired with `actionItemIds`, in the same order. Filled by
   *  the edge function when the surrounding bundle has the milestone
   *  list available (initiative detail, action item detail). Other
   *  surfaces may leave this empty — fall back to "Action Item" when
   *  an id has no name. */
  actionItemNames?: string[]
}

export interface NotionPersonRef {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

/** Notion `Verification Status` (status property). The to-do/in-progress/
 *  complete states map to the same canonical strings the parser
 *  normalizes. `outdated` is set when a user flags a previously-verified
 *  doc as no longer accurate — it's a separate state from the initial
 *  `needs-verification` so directors can spot regressions vs. greenfield
 *  work. */
export type VerificationStatus = 'needs-verification' | 'in-progress' | 'verified' | 'outdated'

export interface DocHubEntry {
  id: string
  title: string
  notionUrl: string                  // Page URL on notion.so — for "Open in Notion"
  department: Department | null
  groups: string[]                   // Document Group (multi-select)
  types: string[]                    // Type (multi-select)
  workflowSteps: string[]            // Workflow Step (multi-select)
  verificationStatus: VerificationStatus | null
  verifiedBy: NotionPersonRef | null
  verifiedOn: string | null
  priorityDoc: boolean               // "Priority Doc" checkbox
  linkedInitiativeIds: string[]
  parentDocId: string | null
  lastEditedTime: string | null
}

/** Recursively-rendered doc content. Returned by `get-doc-content`; the
 *  edge function flattens Notion's block tree into a thin discriminated
 *  union the client can render without knowing the Notion shape. */
export interface DocBlock {
  /** Notion block ID. Present on all blocks the edge function flattened
   *  from the page. Used by the in-app body editor to PATCH a single
   *  block. */
  id?: string
  type:
    | 'paragraph' | 'heading_1' | 'heading_2' | 'heading_3'
    | 'bulleted_list_item' | 'numbered_list_item'
    | 'callout' | 'quote' | 'code' | 'divider' | 'image'
    | 'to_do' | 'toggle' | 'bookmark' | 'embed' | 'video' | 'link_preview'
    | 'table' | 'table_row'
    /** Transparent block whose only purpose is to hold children —
     *  Notion's column_list, column, and synced_block all flatten to
     *  this so the renderer can pass through the nested content
     *  without an extra wrapper. Without this, multi-column / synced
     *  body content silently disappeared. */
    | 'container'
    /** Notion subpage — rendered as a card linking out to Notion. */
    | 'child_page'
    | 'unsupported'
  /** Plain-text rich-text rendered to markdown-ish (matches `richTextToMarkdown`). */
  text: string
  /** For images, bookmarks, embeds, videos, link previews. */
  url?: string
  /** For callouts/code/bookmarks/to_do: extra metadata. */
  meta?: {
    emoji?: string | null
    language?: string | null
    /** to_do checkbox state */
    checked?: boolean
    /** bookmark caption */
    caption?: string
    /** table layout flags */
    columnHeader?: boolean
    rowHeader?: boolean
  }
  /** For `table_row` blocks — the per-cell text values. */
  cells?: string[]
  /** Nested children (e.g., bullet sub-lists, toggle children, table rows). */
  children?: DocBlock[]
}

export interface DocContent {
  doc: DocHubEntry
  blocks: DocBlock[]
}

/** Returned by `get-action-item`: an Action Item's metadata + body
 *  (Notion page blocks). The Action Item detail view renders this. */
export interface ActionItemContent {
  actionItem: Milestone
  blocks: DocBlock[]
}

// ── Merged feed item for cross-initiative + initiative-detail views ────────

/** Virtual "milestone complete" event — synthesized at read time from the
 *  Milestones DB (status = 'complete'). Not stored anywhere. */
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
  /** ISO — completion date; parsers derive this from the Milestone's
   *  `Target Date` when a `Completed On` property doesn't exist. */
  completedAt: string | null
  notionUrl: string
}

export interface ProgressFeedEntry extends ProgressEntry {
  kind: 'progress-entry'
}

/** Discriminated union the Progress feed renders over. */
export type FeedItem = ProgressFeedEntry | MilestoneEvent

// ── Bundle shapes returned by composite ops ───────────────────────────────

export interface CommandCenterStats {
  recentProgressCount: number
  milestonesThisWeekCount: number
  needsCheckInCount: number
  /** Top 3 most-recent progress entries across all initiatives. */
  recentProgressPreview: ProgressFeedEntry[]
  /** Top 3 milestones due in the next 7 days. */
  milestonesThisWeekPreview: Milestone[]
  /** Top 3 initiatives overdue for a check-in. */
  needsCheckInPreview: Initiative[]
}

export interface CommandCenterBundle {
  stats: CommandCenterStats
  activeInitiatives: Initiative[]
}

export interface MyDashboardStrategyStats {
  /** Global count across the workspace — for VPs. */
  needsCheckInCount: number
  /** Caller-owned overdue initiatives — for non-VP staff. */
  myNeedsCheckInCount: number
  yourInitiativesCount: number
  /** null when the user's email couldn't be matched to a Notion user. */
  notionUserId: string | null
}

export interface MyDashboardStrategyBundle {
  stats: MyDashboardStrategyStats
  recentFeed: FeedItem[]
}

export interface InitiativeDetailBundle {
  initiative: Initiative
  milestones: Milestone[]
  progress: ProgressEntry[]
  /** Notion page body for the initiative — flattened block tree, same
   *  shape the Doc Manager + Action Item detail use. Rendered under
   *  "Additional Info" on the Initiative Detail and editable via the
   *  shared DocBlocks editor. Empty when the page has no body content. */
  blocks: DocBlock[]
}

// ── Writable shapes (Phase 2) ─────────────────────────────────────────────

/** Fields a user can update on an existing Initiative. Subset of `Initiative`
 *  — read-only/computed fields (counts, lastProgressAt, parentId) and
 *  audit fields (lastCheckedOn, lastCheckedBy, nextCheckInDue) are excluded.
 *  Set a field to its current value to no-op; pass `null` to clear it. */
export interface InitiativeWritable {
  name?: string
  summary?: string | null
  department?: Department | null
  status?: InitiativeStatus | null
  priority?: Priority | null
  targetDate?: string | null
  targetQuarter?: string | null
  dateConfidence?: DateConfidence | null
  ownerId?: string | null            // Notion user id
  touchpoints?: string | null
  initiativeType?: string[]
  goal?: string | null
  checkInCadence?: string | null
}

export interface InitiativeCreate extends InitiativeWritable {
  name: string                       // title is required at create time
}

export interface MilestoneWritable {
  name?: string
  /** Replaces the full relation. Pass `[]` to clear all parent
   *  initiatives, or a single-element array to pin to one. */
  initiativeIds?: string[]
  status?: MilestoneStatus
  targetDate?: string | null
  dateConfidence?: DateConfidence | null
  order?: number | null
  notes?: string | null
  ownerId?: string | null
  suggestedById?: string | null
  completionDate?: string | null
}

export interface MilestoneCreate extends MilestoneWritable {
  name: string
  /** Required at create time — at least one parent initiative. */
  initiativeIds: string[]
}

export interface ProgressWritable {
  title?: string
  body?: string
  categories?: ProgressCategory[]
  initiativeId?: string | null
  /** Pass an empty array to clear; pass IDs to replace. */
  actionItemIds?: string[]
  datePosted?: string | null
}

export interface ProgressCreate {
  title: string
  body: string
  categories: ProgressCategory[]
  initiativeId: string
  /** Optional — when set, the new progress entry is tagged with these
   *  Action Items so the per-Action Item progress feed picks it up. */
  actionItemIds?: string[]
  // Author is set server-side from the JWT email
}

export interface DocWritable {
  title?: string
  department?: Department | null
  groups?: string[]
  types?: string[]
  workflowSteps?: string[]
  verificationStatus?: VerificationStatus | null
  verifiedBy?: string | null         // Notion user id
  verifiedOn?: string | null         // ISO date
  priorityDoc?: boolean
  linkedInitiativeIds?: string[]
}

/** Payload for creating a new Doc Hub page. Title + dept + at least one
 *  Document Group is required by the form; status defaults to "Needs
 *  Verification" server-side. */
export interface DocCreate {
  title: string
  department: Department
  groups: string[]
  types?: string[]
  workflowSteps?: string[]
  /** Plain-text body. Written as a single paragraph block on the page;
   *  authors continue to edit rich content directly in Notion. */
  body?: string
  priorityDoc?: boolean
  /** When set, prepends a yellow callout to the body: "📩 Note from VP
   *  of Strategy: [text]". Used by the VP suggest-a-doc flow so directors
   *  see the framing as soon as they open the draft. */
  vpNote?: string
}

/** Verifier-defaults row, mirrored from `strategy_wiki_verifier_defaults`. */
export interface VerifierDefault {
  dept: Department
  directorEmployeeId: string
  delegateEmployeeId: string | null
  delegationUntil: string | null    // ISO timestamp
  notes: string | null
  updatedAt: string
  updatedBy: string
}

export interface VerifierActive {
  employeeId: string
  isDelegate: boolean
}

export interface EmployeeRef {
  id: string
  fullName: string | null
  email: string | null
  department: string | null
  role: string | null
  avatarUrl: string | null
}

/** Generic entity discriminator for `archive-page`. */
export type StrategyEntity = 'initiative' | 'milestone' | 'progress' | 'doc'

/** Lightweight Notion user shape for the EditablePerson picker. */
export interface NotionUserOption {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

// ── Edge function error/setup wrapper ─────────────────────────────────────

/** Error shape the edge function returns when the Notion integration isn't
 *  configured yet. The UI uses this to show a "Set up Notion integration"
 *  banner on Strategy pages. `'write-capability'` lands when the integration
 *  has read access but lacks Update/Insert capabilities (Phase 2). */
export interface StrategyNotionSetupError {
  error: 'setup-required'
  missing: Array<'NOTION_TOKEN' | 'database-access' | 'write-capability'>
  message: string
}

export interface StrategyNotionError {
  error: string
  message: string
}
