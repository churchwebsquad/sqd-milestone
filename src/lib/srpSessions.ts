/**
 * SRP session data layer — `srp_pipeline.sessions` (new 12-step workflow).
 *
 * Schema lives in `srp_pipeline.*` not `public.*` so we cast through
 * `supabase.schema('srp_pipeline')` since the typed Database generic
 * only knows about `public`.
 *
 * State-isolation discipline carries over from the old 4-step build:
 *   - URL is canonical. session_id lives in the URL, not React state.
 *   - SrpWorkflowContext mirrors row state and autosaves via these
 *     helpers; navigation away + back re-loads from DB.
 *   - createSession writes a fresh row BEFORE the dashboard navigates,
 *     so the workflow page is never keyed on a not-yet-saved sessionId.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { supabase } from './supabase'
import type {
  SrpPipelineSession,
  SrpWorkflowStep,
  SrpDeliverable,
  SrpClipSelection,
  SrpCarouselSlide,
} from '../types/database'

/** Untyped client scoped to the `srp_pipeline` schema. Cast is unavoidable
 *  because the Database generic only ships public.* types. */
export const srpPipeline = (supabase as any).schema('srp_pipeline') as ReturnType<typeof supabase.schema>

export interface SrpSessionListRow {
  id:            string
  session_id:    string
  church_name:   string | null
  member:        number | null
  user_email:    string | null
  current_step:  SrpWorkflowStep | null
  status:        string | null
  sermon_title:  string | null
  created_at:    string | null
  updated_at:    string | null
}

/** session_id format: {member}_{ChurchNameNoSpaces}_{YYYYMMDDHHMMSS} */
export function makeSessionId(member: number | string, churchName: string): string {
  const slug = churchName.replace(/[^A-Za-z0-9]/g, '')
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `${member}_${slug}_${ts}`
}

/** Create a fresh session row. Returns { id, session_id }. */
export async function createSession(input: {
  member:                number | string
  churchName:            string
  userEmail:             string | null
  brandVoiceGuidelines?: string | null
  clickupTaskId?:        string | null
  sermonTitle?:          string | null
}): Promise<{ id: string; session_id: string }> {
  const session_id = makeSessionId(input.member, input.churchName)
  const memberNum = typeof input.member === 'number' ? input.member : Number(input.member)
  if (!Number.isFinite(memberNum)) throw new Error('member must be numeric')

  const { data, error } = await srpPipeline
    .from('sessions')
    .insert({
      session_id,
      member:                memberNum,
      church_name:           input.churchName,
      user_email:            input.userEmail,
      current_step:          'account',
      status:                'in_progress',
      ...(input.brandVoiceGuidelines ? { brand_voice_guidelines: input.brandVoiceGuidelines } : {}),
      ...(input.clickupTaskId  ? { clickup_task_id: input.clickupTaskId }  : {}),
      ...(input.sermonTitle    ? { sermon_title:    input.sermonTitle }    : {}),
    })
    .select('id, session_id')
    .single()
  if (error || !data) throw new Error(`createSession failed: ${error?.message ?? 'unknown'}`)
  return { id: String((data as any).id), session_id: String((data as any).session_id) }
}

export async function getSessionBySlug(sessionId: string): Promise<SrpPipelineSession | null> {
  const { data, error } = await srpPipeline
    .from('sessions')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw new Error(`getSession failed: ${error.message}`)
  return (data as SrpPipelineSession | null) ?? null
}

export async function getSessionById(id: string): Promise<SrpPipelineSession | null> {
  const { data, error } = await srpPipeline
    .from('sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getSessionById failed: ${error.message}`)
  return (data as SrpPipelineSession | null) ?? null
}

/** Patch a session by session_id. updated_at is stamped server-side via the trigger. */
export async function updateSession(
  sessionId: string,
  patch: Partial<SrpPipelineSession>,
): Promise<void> {
  const { error } = await srpPipeline
    .from('sessions')
    .update(patch as any)
    .eq('session_id', sessionId)
  if (error) throw new Error(`updateSession failed: ${error.message}`)
}

export async function listSessions(opts: {
  userEmail?: string | null
  limit?:     number
} = {}): Promise<SrpSessionListRow[]> {
  let q = srpPipeline
    .from('sessions')
    .select('id, session_id, church_name, member, user_email, current_step, status, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (opts.userEmail) q = q.eq('user_email', opts.userEmail)
  const { data, error } = await q
  if (error) throw new Error(`listSessions failed: ${error.message}`)
  return (data as SrpSessionListRow[] | null) ?? []
}

export async function archiveSession(sessionId: string): Promise<void> {
  await updateSession(sessionId, { status: 'archived' })
}

// ── Type re-exports for callers ─────────────────────────────────────────
export type { SrpPipelineSession, SrpWorkflowStep, SrpDeliverable, SrpClipSelection, SrpCarouselSlide }

// ── Step ordering + labels ──────────────────────────────────────────────

/** ALL 12 steps in canonical order. Use visibleSteps from SrpWorkflowContext
 *  for conditional ordering based on selected deliverables. */
export const SRP_ALL_STEPS: SrpWorkflowStep[] = [
  'account', 'deliverables', 'sermon',
  'clips', 'reelCaptions',
  'carousel', 'facebook', 'sundayInvite', 'photoRecap',
  'creativeDirection', 'clipProcessing',
  'approved',
]

export const STEP_LABELS: Record<SrpWorkflowStep, string> = {
  account:           'Account',
  deliverables:      'Deliverables',
  sermon:            'Sermon input',
  clips:             'Clip selection',
  reelCaptions:      'Reel captions',
  carousel:          'Carousel',
  facebook:          'Facebook',
  sundayInvite:      'Sunday invite',
  photoRecap:        'Photo recap',
  creativeDirection: 'Creative direction',
  clipProcessing:    'Clip processing',
  approved:          'Approved & ship',
}

export const STEP_DESCRIPTIONS: Record<SrpWorkflowStep, string> = {
  account:           'Partner this run is for',
  deliverables:      'What this run will produce',
  sermon:            'Drop sermon URL or paste transcript',
  clips:             'Pick the best moments for reels',
  reelCaptions:      'Caption each reel',
  carousel:          '5-slide Instagram carousel',
  facebook:          'Long-form Facebook post',
  sundayInvite:      '3 invite variants for the week',
  photoRecap:        '3-5 carousel captions for the photo recap',
  creativeDirection: 'Template, music, designer notes',
  clipProcessing:    'Render the reels',
  approved:          'Ship to ClickUp + Vista',
}

export const DELIVERABLE_LABELS: Record<Exclude<SrpDeliverable, `reel${number}`>, string> = {
  facebook:      'Facebook post',
  carousel:      'Carousel (5 slides)',
  sundayInvite:  'Sunday invite (3 variants)',
  photoRecap:    'Photo recap (3-5 captions)',
}

export const DELIVERABLE_DESCRIPTIONS: Record<Exclude<SrpDeliverable, `reel${number}`>, string> = {
  facebook:     'Long-form Facebook text post with paragraph breaks.',
  carousel:     '5-slide structure: hook · Bible verse · pastor quote · application · CTA.',
  sundayInvite: '3 invite variants (warm / energetic / topical).',
  photoRecap:   '3-5 caption options recapping the weekend service.',
}
