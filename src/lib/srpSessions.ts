/**
 * SRP session lifecycle. Wraps every interaction with sms_srp_generation.
 *
 * State-isolation discipline (the bug class the previous app had):
 *
 *  - URL is canonical. The session_id lives in the URL path, not in
 *    React state or localStorage. Workflow pages read from URL params,
 *    load from DB. No global session context, no client-side cache.
 *  - Every change persists immediately. setStep / setField call
 *    updateSession with a patch; loaders re-read on mount. Navigation
 *    away and back is safe by construction.
 *  - createSession writes a fresh row BEFORE returning the session_id.
 *    The dashboard's "New SRP" button cannot navigate to a sessionId
 *    that doesn't already have its own row.
 *
 * The id column is bigint NOT NULL with no default, so we compute
 * COALESCE(MAX(id), 0) + 1 on insert. Race-prone in theory; in
 * practice the SRP tool is single-user-at-a-time and the worst case
 * is one retry. Acceptable trade-off vs adding a schema sequence.
 */

import { supabase } from './supabase'
import type {
  SmsSrpGeneration, SrpStep, SrpDeliverableKey,
} from '../types/database'

export interface ClipSelection {
  clip_id: string
  startTime?: number
  endTime?: number
  quote?: string
  category?: string
}

export interface CarouselSlide {
  slide_number: number
  kind: 'hook' | 'verse' | 'quote' | 'application' | 'cta'
  text: string
}

export interface SessionListRow {
  id: number
  session_id: string
  church_name: string | null
  member: string | null
  user_email: string | null
  current_step: SrpStep | null
  status: 'in_progress' | 'completed' | 'archived' | null
  created_at: string | null
  updated_at: string | null
}

/** Generate the conventional session_id format used by existing rows.
 *  Format: {member}_{ChurchNameNoSpaces}_{YYYYMMDDHHMMSS}. */
export function makeSessionId(member: string, churchName: string): string {
  const slug = churchName.replace(/[^A-Za-z0-9]/g, '')
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `${member}_${slug}_${ts}`
}

/** Create a fresh session row. Returns the new session_id. */
export async function createSession(input: {
  member: string
  churchName: string
  userEmail: string | null
}): Promise<string> {
  const sessionId = makeSessionId(input.member, input.churchName)

  // Compute next id: COALESCE(MAX(id), 0) + 1. Race-prone but adequate.
  const { data: maxRow } = await supabase
    .from('sms_srp_generation')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextId = ((maxRow?.id as number | undefined) ?? 0) + 1

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('sms_srp_generation')
    .insert({
      id: nextId,
      session_id: sessionId,
      member: input.member,
      church_name: input.churchName,
      user_email: input.userEmail,
      current_step: 'account',
      status: 'in_progress',
      created_at: nowIso,
      updated_at: nowIso,
    })
  if (error) throw new Error(`createSession failed: ${error.message}`)
  return sessionId
}

export async function getSession(sessionId: string): Promise<SmsSrpGeneration | null> {
  const { data, error } = await supabase
    .from('sms_srp_generation')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw new Error(`getSession failed: ${error.message}`)
  return (data as SmsSrpGeneration | null) ?? null
}

/** Patch a session by session_id. updated_at is stamped automatically. */
export async function updateSession(
  sessionId: string,
  patch: Partial<SmsSrpGeneration>,
): Promise<void> {
  const { error } = await supabase
    .from('sms_srp_generation')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (error) throw new Error(`updateSession failed: ${error.message}`)
}

export async function listSessions(opts: {
  userEmail?: string | null
  limit?: number
} = {}): Promise<SessionListRow[]> {
  let q = supabase
    .from('sms_srp_generation')
    .select('id, session_id, church_name, member, user_email, current_step, status, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (opts.userEmail) q = q.eq('user_email', opts.userEmail)
  const { data, error } = await q
  if (error) throw new Error(`listSessions failed: ${error.message}`)
  return (data as SessionListRow[]) ?? []
}

export async function archiveSession(sessionId: string): Promise<void> {
  await updateSession(sessionId, { status: 'archived' })
}

// ── JSON-as-text helpers ──────────────────────────────────────────────
//
// selected_deliverables, clip_selections, carousel_slides are TEXT
// columns holding JSON. Parsing every read defensively keeps callers
// from crashing on null / malformed rows.

export function parseDeliverables(raw: string | null | undefined): SrpDeliverableKey[] {
  if (!raw) return []
  try { return (JSON.parse(raw) ?? []) as SrpDeliverableKey[] }
  catch { return [] }
}
export function stringifyDeliverables(d: SrpDeliverableKey[]): string {
  return JSON.stringify(d)
}

export function parseClipSelections(raw: string | null | undefined): ClipSelection[] {
  if (!raw) return []
  try { return (JSON.parse(raw) ?? []) as ClipSelection[] }
  catch { return [] }
}
export function stringifyClipSelections(c: ClipSelection[]): string {
  return JSON.stringify(c)
}

export function parseCarouselSlides(raw: string | null | undefined): CarouselSlide[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Filter + coerce: drop slides without text, default missing fields.
    // Defensive against malformed AI output that previously crashed the
    // slide editor (Array.map → s.text.split → "Cannot read split of undefined").
    return parsed
      .filter((s): s is Record<string, unknown> => s != null && typeof s === 'object')
      .map((s, i) => ({
        slide_number: typeof s.slide_number === 'number' ? s.slide_number : i + 1,
        kind: (typeof s.kind === 'string' ? s.kind : 'hook') as CarouselSlide['kind'],
        text: typeof s.text === 'string' ? s.text : '',
      }))
  } catch { return [] }
}
export function stringifyCarouselSlides(s: CarouselSlide[]): string {
  return JSON.stringify(s)
}

// ── Step ordering for the workflow UI ─────────────────────────────────
export const SRP_STEPS: SrpStep[] = ['account', 'deliverables', 'sermon', 'review']

export const STEP_LABELS: Record<string, string> = {
  account:      'Account',
  deliverables: 'Deliverables',
  sermon:       'Sermon input',
  review:       'Review & generate',
  approved:     'Approved',
  reelCaptions: 'Reel captions',
}

export const DELIVERABLE_LABELS: Record<SrpDeliverableKey, string> = {
  facebook_post:    'Facebook post',
  sunday_invite:    'Sunday invite',
  photo_recap:      'Photo recap',
  carousel_slides:  'Carousel slides',
  reel_captions:    'Reel captions (2)',
}

export const DELIVERABLE_DESCRIPTIONS: Record<SrpDeliverableKey, string> = {
  facebook_post:   'Long-form Facebook text post with paragraph breaks.',
  sunday_invite:   '3 invite variants (warm / energetic / topical). Church name + service times at the bottom.',
  photo_recap:     '3-5 carousel caption options recapping the weekend service.',
  carousel_slides: '5-slide structure: hook · Bible verse · pastor quote · application · CTA.',
  reel_captions:   'Pick 2 clip moments from the transcript, then generate a short caption for each.',
}
