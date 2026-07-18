/**
 * POST /api/srp/auto-generate
 *
 * Fires all transcript-dependent deliverables in parallel once a session
 * has a transcript. Called automatically by SrpWorkflowContext when
 * transcript becomes ready and auto_drafts is null.
 *
 * Flow:
 *   1. generate-overview  → extract keyInsights
 *   2. In parallel: carousel, facebook, photoRecap, sundayInvite
 *   3. Save all options to sessions.auto_drafts + key_insights to sessions
 *
 * The coach arrives at each step to find 3 options pre-generated.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

function buildBaseUrl(req: any): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host  = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  if (host) return `${proto}://${host}`
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
}

async function callGenerate(baseUrl: string, path: string, body: Record<string, any>): Promise<any | null> {
  try {
    const r = await fetch(`${baseUrl}/api/srp/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(50_000),
    })
    if (!r.ok) {
      console.warn(`[auto-generate] ${path} returned ${r.status}`)
      return null
    }
    return await r.json()
  } catch (e) {
    console.warn(`[auto-generate] ${path} failed:`, e instanceof Error ? e.message : e)
    return null
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id.trim() : ''
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Load session
  const { data: session, error: sessionErr } = await sb
    .schema('srp_pipeline')
    .from('sessions')
    .select('transcript, transcript_words, church_name, sermon_title, series_title, brand_voice_guidelines, auto_drafts, selected_deliverables')
    .eq('session_id', sessionId)
    .single()

  if (sessionErr || !session) return res.status(404).json({ error: 'Session not found' })
  if (!session.transcript || session.transcript.trim().length < 200) {
    return res.status(400).json({ error: 'No transcript on session' })
  }
  if (session.auto_drafts) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'auto_drafts already present' })
  }

  const baseUrl      = buildBaseUrl(req)
  const transcript   = session.transcript as string
  const churchName   = (session.church_name as string) ?? ''
  const sermonTitle  = (session.sermon_title as string) ?? ''
  const seriesName   = (session.series_title as string) ?? ''
  const brandVoice   = (session.brand_voice_guidelines as string) ?? ''
  const accountCtx   = [churchName && `Church: ${churchName}`, seriesName && `Series: ${seriesName}`].filter(Boolean).join('\n')
  const deliverables: string[] = Array.isArray(session.selected_deliverables) ? session.selected_deliverables : []
  const hasReels     = deliverables.some(d => /^reel\d+$/.test(d))

  const generated: Record<string, string> = {}

  // ── Step 1: Overview (needed for keyInsights) ────────────────────────────
  const overviewRes = await callGenerate(baseUrl, 'generate-overview', {
    transcript,
    churchName,
    sermonTitle,
    seriesName,
  })
  const overview    = overviewRes?.overview ?? null
  const keyInsights: string[] = Array.isArray(overview?.keyInsights) ? overview.keyInsights : []

  if (overview) generated.overview = 'ok'

  // ── Step 2: All selected deliverables in parallel ────────────────────────
  const commonBody = { transcript, brandVoice, accountContext: accountCtx, keyInsights }

  const tasks: Promise<any>[] = []
  const taskKeys: string[] = []

  if (hasReels) {
    tasks.push(callGenerate(baseUrl, 'generate-clips', {
      transcript,
      transcriptWords: session.transcript_words ?? [],
      brandVoice,
      accountContext: accountCtx,
      keyInsights,
    }))
    taskKeys.push('clips')
  }
  if (deliverables.includes('carousel')) {
    tasks.push(callGenerate(baseUrl, 'generate-carousel', commonBody))
    taskKeys.push('carousel')
  }
  if (deliverables.includes('facebook')) {
    tasks.push(callGenerate(baseUrl, 'generate-facebook-post', commonBody))
    taskKeys.push('facebook')
  }
  if (deliverables.includes('photoRecap')) {
    tasks.push(callGenerate(baseUrl, 'generate-photo-recap', { ...commonBody, promptType: 'highlights' }))
    taskKeys.push('photoRecap')
  }
  if (deliverables.includes('sundayInvite')) {
    tasks.push(callGenerate(baseUrl, 'generate-sunday-invite', commonBody))
    taskKeys.push('sundayInvite')
  }

  const results = await Promise.all(tasks)
  const resultMap: Record<string, any> = {}
  taskKeys.forEach((key, i) => { resultMap[key] = results[i] })

  taskKeys.forEach(key => { if (resultMap[key]) generated[key] = 'ok' })

  // ── Step 3: Persist to session ───────────────────────────────────────────
  const autoDrafts = {
    ...(overview                  ? { overview }                                                      : {}),
    ...(resultMap.clips           ? { clips:       resultMap.clips.clips ?? [] }                      : {}),
    ...(resultMap.carousel        ? { carousel:    resultMap.carousel.options ?? [] }                 : {}),
    ...(resultMap.facebook        ? { facebook:    resultMap.facebook.posts ?? [] }                   : {}),
    ...(resultMap.photoRecap      ? { photoRecap:  resultMap.photoRecap.captions ?? [] }              : {}),
    ...(resultMap.sundayInvite    ? { sundayInvite: resultMap.sundayInvite.invites ?? [] }            : {}),
  }

  const updatePayload: Record<string, any> = { auto_drafts: autoDrafts }
  if (keyInsights.length > 0) updatePayload.key_insights = keyInsights

  await sb
    .schema('srp_pipeline')
    .from('sessions')
    .update(updatePayload)
    .eq('session_id', sessionId)

  return res.status(200).json({ ok: true, generated })
}
