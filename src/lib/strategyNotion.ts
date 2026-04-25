/**
 * Thin client wrappers over the `strategy-notion` Supabase Edge Function.
 * Each function maps to one op with typed args and return.
 *
 * Error handling: the edge function returns `{ error: 'setup-required', ... }`
 * with a 503 when the NOTION_TOKEN secret is missing or the integration
 * hasn't been shared with one of the required databases. Callers should
 * look for `StrategyNotionSetupError` via `isSetupError()` and render a
 * banner rather than treating it as a generic failure.
 */

import { supabase } from './supabase'
import type {
  ActionItemContent, CommandCenterBundle, DocHubEntry, DocCreate, DocContent, FeedItem,
  Initiative, InitiativeDetailBundle, Milestone, MyDashboardStrategyBundle,
  ProgressEntry, StrategyNotionError, StrategyNotionSetupError,
  InitiativeWritable, InitiativeCreate, MilestoneWritable, MilestoneCreate,
  ProgressWritable, ProgressCreate, DocWritable, StrategyEntity,
  NotionUserOption,
} from '../types/strategy'

async function invoke<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T | StrategyNotionSetupError | StrategyNotionError>(
    'strategy-notion',
    { body: { op, ...args } },
  )
  if (error) {
    // supabase-js normalizes non-2xx responses into `error`; depending on
    // the client version `error.context` is either a Response (v2) or an
    // object with `{ body: string | object }` (older). Read the JSON body
    // either way and re-throw with the real message so the UI can show it.
    const parsed = await readErrorBody(error)
    if (parsed && typeof parsed === 'object' && 'error' in parsed && (parsed as { error: unknown }).error === 'setup-required') {
      throw Object.assign(new Error((parsed as StrategyNotionSetupError).message), parsed)
    }
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      throw Object.assign(new Error(String((parsed as { message: unknown }).message)), parsed)
    }
    throw error
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw Object.assign(new Error((data as StrategyNotionError).message), data)
  }
  return data as T
}

async function readErrorBody(error: unknown): Promise<unknown> {
  const ctx = (error as { context?: unknown }).context
  if (!ctx) return null
  if (ctx instanceof Response) {
    try { return await ctx.clone().json() } catch { /* fall through */ }
    try { return await ctx.clone().text() } catch { return null }
  }
  const body = (ctx as { body?: unknown }).body
  if (typeof body === 'string') return tryParse(body) ?? body
  return body ?? null
}

function tryParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

export function isSetupError(err: unknown): err is StrategyNotionSetupError {
  return !!err && typeof err === 'object' && 'error' in err && (err as { error: unknown }).error === 'setup-required'
}

// ── Exported client API ───────────────────────────────────────────────────

export async function listInitiatives(): Promise<Initiative[]> {
  const r = await invoke<{ initiatives: Initiative[] }>('list-initiatives')
  return r.initiatives
}

export async function listMilestones(): Promise<Milestone[]> {
  const r = await invoke<{ milestones: Milestone[] }>('list-milestones')
  return r.milestones
}

export async function listProgress(opts?: { limit?: number; sinceISO?: string; initiativeId?: string }): Promise<FeedItem[]> {
  const r = await invoke<{ entries: FeedItem[] }>('list-progress', opts ?? {})
  return r.entries
}

export async function getInitiativeDetail(id: string): Promise<InitiativeDetailBundle> {
  return invoke<InitiativeDetailBundle>('get-initiative', { id })
}

export async function getCommandCenter(): Promise<CommandCenterBundle> {
  return invoke<CommandCenterBundle>('command-center-bundle')
}

export async function getMyDashboardStrategy(): Promise<MyDashboardStrategyBundle> {
  return invoke<MyDashboardStrategyBundle>('my-dashboard-bundle')
}

export async function listDocs(): Promise<DocHubEntry[]> {
  const r = await invoke<{ docs: DocHubEntry[] }>('list-docs')
  return r.docs
}

export async function listNotionUsers(): Promise<NotionUserOption[]> {
  const r = await invoke<{ users: NotionUserOption[] }>('list-notion-users')
  return r.users
}

// ── Mutations (Phase 2) ───────────────────────────────────────────────────

export async function updateInitiative(id: string, updates: InitiativeWritable): Promise<Initiative> {
  return invoke<Initiative>('update-initiative', { id, updates })
}

export async function updateMilestone(id: string, updates: MilestoneWritable): Promise<Milestone> {
  return invoke<Milestone>('update-milestone', { id, updates })
}

export async function updateProgress(id: string, updates: ProgressWritable): Promise<ProgressEntry> {
  return invoke<ProgressEntry>('update-progress', { id, updates })
}

export async function updateDoc(id: string, updates: DocWritable): Promise<DocHubEntry> {
  return invoke<DocHubEntry>('update-doc', { id, updates })
}

export async function createInitiative(updates: InitiativeCreate): Promise<Initiative> {
  return invoke<Initiative>('create-initiative', { updates })
}

export async function createMilestone(updates: MilestoneCreate): Promise<Milestone> {
  return invoke<Milestone>('create-milestone', { updates })
}

export async function createProgress(updates: ProgressCreate): Promise<ProgressEntry> {
  return invoke<ProgressEntry>('create-progress', { updates })
}

export async function markCheckIn(initiativeId: string, note?: string | null): Promise<Initiative> {
  return invoke<Initiative>('mark-check-in', { initiativeId, note: note ?? null })
}

export async function archivePage(id: string, entity: StrategyEntity): Promise<{ ok: true }> {
  return invoke<{ ok: true }>('archive-page', { id, entity })
}

// ── Library (Doc Hub) ─────────────────────────────────────────────────────

export async function createDoc(updates: DocCreate): Promise<DocHubEntry> {
  return invoke<DocHubEntry>('create-doc', { updates })
}

export async function verifyDoc(id: string): Promise<DocHubEntry> {
  return invoke<DocHubEntry>('verify-doc', { id })
}

export async function requestDocChanges(id: string, reviewerName: string, comments: string): Promise<{ ok: true }> {
  return invoke<{ ok: true }>('request-doc-changes', { id, reviewerName, comments })
}

export async function getDocContent(id: string): Promise<DocContent> {
  return invoke<DocContent>('get-doc-content', { id })
}

/** Block types the in-app body editor can update. Mirrors `EditableBlockType`
 *  in the edge function. Limited to text-bearing blocks; tables/embeds/images
 *  stay read-only. */
export type EditableBlockType =
  | 'paragraph' | 'heading_1' | 'heading_2' | 'heading_3'
  | 'bulleted_list_item' | 'numbered_list_item'
  | 'to_do' | 'toggle' | 'quote' | 'callout'

export interface UpdateDocBlockResult {
  ok: true
  flippedToNeedsVerification: boolean
}

export async function updateDocBlock(
  docId: string,
  blockId: string,
  type: EditableBlockType,
  text: string,
  meta?: { checked?: boolean },
  isDirector = false,
): Promise<UpdateDocBlockResult> {
  return invoke<UpdateDocBlockResult>('update-doc-block', {
    docId, blockId, type, text, meta, isDirector,
  })
}

export async function appendDocBlock(
  docId: string,
  type: EditableBlockType,
  text: string,
): Promise<{ ok: true }> {
  return invoke<{ ok: true }>('append-doc-block', { docId, type, text })
}

export async function archiveDocBlock(docId: string, blockId: string): Promise<{ ok: true }> {
  return invoke<{ ok: true }>('archive-doc-block', { docId, blockId })
}

export async function flagDocOutdated(
  id: string,
  flaggerName: string,
  reason: string,
): Promise<DocHubEntry> {
  return invoke<DocHubEntry>('flag-doc-outdated', { id, flaggerName, reason })
}

export interface WorkflowStepSyncResult {
  added: string[]
  kept: string[]
  candidatesToDrop: string[]
  ok: true
}

export async function syncWorkflowStepOptions(): Promise<WorkflowStepSyncResult> {
  return invoke<WorkflowStepSyncResult>('sync-workflow-step-options')
}

export interface DocCommentSummary {
  id: string
  text: string
  createdAt: string
  authorName: string | null
  authorId: string
}

export async function listDocComments(id: string): Promise<DocCommentSummary[]> {
  const r = await invoke<{ comments: DocCommentSummary[] }>('list-doc-comments', { id })
  return r.comments
}

export async function listDocCommentsBulk(ids: string[]): Promise<Record<string, DocCommentSummary[]>> {
  if (ids.length === 0) return {}
  const r = await invoke<{ commentsByDoc: Record<string, DocCommentSummary[]> }>('list-doc-comments-bulk', { ids })
  return r.commentsByDoc
}

// ── Action Items (Phase 2.5) ─────────────────────────────────────────────

export async function getActionItem(id: string): Promise<ActionItemContent> {
  return invoke<ActionItemContent>('get-action-item', { id })
}

export async function markActionItemComplete(id: string): Promise<Milestone> {
  return invoke<Milestone>('mark-action-item-complete', { id })
}

export async function suggestActionItem(args: {
  suggestedById: string
  title: string
  targetDate?: string | null
  notes?: string | null
}): Promise<Milestone> {
  return invoke<Milestone>('suggest-action-item', args)
}

export async function promoteActionItem(id: string, nextOrder: number): Promise<Milestone> {
  return invoke<Milestone>('promote-action-item', { id, nextOrder })
}
