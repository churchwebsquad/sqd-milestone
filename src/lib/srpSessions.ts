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
import { SRP_MAX_REELS } from '../types/database'

/** Untyped client scoped to the `srp_pipeline` schema. Cast is unavoidable
 *  because the Database generic only ships public.* types. */
export const srpPipeline = (supabase as any).schema('srp_pipeline') as ReturnType<typeof supabase.schema>

export interface SrpSessionListRow {
  id:                 string
  session_id:         string
  church_name:        string | null
  member:             number | null
  user_email:         string | null
  current_step:       SrpWorkflowStep | null
  status:             string | null
  sermon_title:       string | null
  clickup_task_id:    string | null
  video_url:          string | null
  transcript_job_id:  string | null
  created_at:         string | null
  updated_at:         string | null
}

/** session_id format: {member}_{ChurchNameNoSpaces}_{YYYYMMDDHHMMSS} */
export function makeSessionId(member: number | string, churchName: string): string {
  const slug = churchName.replace(/[^A-Za-z0-9]/g, '')
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `${member}_${slug}_${ts}`
}

/** Parse a ClickUp task name/description to suggest deliverables. */
export function suggestDeliverablesFromText(text: string): SrpDeliverable[] {
  const lower = text.toLowerCase()
  const result: SrpDeliverable[] = []

  // Detect reel count from patterns like:
  //   "3 reel", "reel x3", "x3 reel", "3x reel", "3 sermon video", "sermon video x3"
  // Count occurrences of "sermon video" or "worship video" (each line = 1 reel)
  const sermonVideoCount = (lower.match(/(?:sermon|worship)\s*video/g) ?? []).length

  const reelMatch =
    lower.match(/(\d+)\s*x?\s*reel/) ??
    lower.match(/reel\s*x?\s*(\d+)/) ??
    lower.match(/x\s*(\d+)\s*reel/) ??
    lower.match(/(\d+)\s*x\s*reel/) ??
    lower.match(/(\d+)\s*x?\s*video/) ??
    lower.match(/video\s*x?\s*(\d+)/)

  const hasReelKeyword = lower.includes('reel') || lower.includes('sermon video') || lower.includes('worship video') || lower.includes('sermon recap')

  if (hasReelKeyword) {
    const count = reelMatch
      ? Math.min(parseInt(reelMatch[1], 10), SRP_MAX_REELS)
      : sermonVideoCount > 1
        ? Math.min(sermonVideoCount, SRP_MAX_REELS)
        : 2 // default to 2 reels when keyword detected but no explicit count
    for (let i = 1; i <= count; i++) {
      result.push(`reel${i}` as SrpDeliverable)
    }
  }

  if (lower.includes('carousel'))                                          result.push('carousel')
  if (lower.includes('facebook'))                                          result.push('facebook')
  if (lower.includes('invite') || lower.includes('sunday'))                result.push('sundayInvite')
  if (lower.includes('photo recap') || lower.includes('photo_recap'))      result.push('photoRecap')

  return [...new Set(result)] as SrpDeliverable[]
}

/** Create a fresh session row. Returns { id, session_id }. */
export async function createSession(input: {
  member:                 number | string
  churchName:             string
  userEmail:              string | null
  brandVoiceGuidelines?:  string | null
  clickupTaskId?:         string | null
  sermonTitle?:           string | null
  suggestedDeliverables?: SrpDeliverable[] | null
  videoUrl?:              string | null
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
      current_step:          input.clickupTaskId ? 'deliverables' : 'account',
      status:                'in_progress',
      // TODO: restore once v77_srp_sessions_brand_voice.sql migration is run
      // ...(input.brandVoiceGuidelines ? { brand_voice_guidelines: input.brandVoiceGuidelines } : {}),
      ...(input.clickupTaskId         ? { clickup_task_id:       input.clickupTaskId }         : {}),
      ...(input.sermonTitle           ? { sermon_title:          input.sermonTitle }           : {}),
      ...(input.suggestedDeliverables?.length
          ? { selected_deliverables: input.suggestedDeliverables }
          : {}),
      ...(input.videoUrl ? { video_url: input.videoUrl } : {}),
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
  'overview', 'clips', 'creativeDirection', 'preRenderEdit', 'reelCaptions',
  'carousel', 'facebook', 'sundayInvite', 'photoRecap',
  'clipProcessing',
  'approved',
]

export const STEP_LABELS: Record<SrpWorkflowStep, string> = {
  account:           'Account',
  deliverables:      'Deliverables',
  sermon:            'Sermon input',
  overview:          'Service overview',
  clips:             'Clip selection',
  creativeDirection: 'Creative direction',
  preRenderEdit:     'Music & edits',
  reelCaptions:      'Reel captions',
  carousel:          'Carousel',
  facebook:          'Facebook',
  sundayInvite:      'Sunday invite',
  photoRecap:        'Photo recap',
  clipProcessing:    'Clip processing',
  approved:          'Approved & ship',
}

export const STEP_DESCRIPTIONS: Record<SrpWorkflowStep, string> = {
  account:           'Partner this run is for',
  deliverables:      'What this run will produce',
  sermon:            'Drop sermon URL or paste transcript',
  overview:          'AI-generated summary, key insights, and scripture',
  clips:             'Pick the best moments for reels',
  creativeDirection: 'Template, music, and designer notes',
  preRenderEdit:     'Title screens, outro logo, and caption text fixes',
  reelCaptions:      'Caption each reel',
  carousel:          '5-slide Instagram carousel',
  facebook:          'Long-form Facebook post',
  sundayInvite:      '3 invite variants for the week',
  photoRecap:        '3-5 carousel captions for the photo recap',
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
