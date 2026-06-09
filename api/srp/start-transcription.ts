/**
 * Vercel Serverless Function — /api/srp/start-transcription
 *
 * Kicks off transcription by firing the n8n webhook. The webhook
 * dispatches to whatever transcription engine the n8n workflow is
 * configured to use (Deepgram, Whisper, etc.) and calls back into
 * /api/srp/transcription-callback when done.
 *
 * Required env vars:
 *   SRP_N8N_TRANSCRIPTION_WEBHOOK_URL — full https URL to the n8n trigger
 *   SRP_N8N_CALLBACK_SECRET           — shared secret n8n sends back in the callback
 *
 * IMPORTANT: the n8n webhook MUST be configured to "Respond Immediately"
 * (i.e. the Webhook node returns 200 the moment the workflow is queued).
 * Vercel Node functions can't fire-and-forget the way Supabase Edge can
 * with waitUntil; if n8n blocks for the full workflow duration we'll
 * either time out at 300s or kill the outbound request when the
 * function ends.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

// Inline media URL validator — keep in sync with src/lib/mediaUrlValidator.ts
const ARCHIVE_EXTS = ['.zip', '.rar', '.7z', '.tar', '.tar.gz', '.tgz', '.gz']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.bmp', '.tiff', '.tif', '.svg']
const DOC_EXTS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.rtf']
const MEDIA_EXTS = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.opus']
const endsWithAny = (s: string, list: string[]) => list.some(ext => s.endsWith(ext))

interface ValidResult { ok: true; sourceType: string; normalizedUrl: string }
interface InvalidResult { ok: false; errorCode: string; userMessage: string }
type ValidationResult = ValidResult | InvalidResult

function validateMediaUrl(input: unknown): ValidationResult {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, errorCode: 'EMPTY_URL', userMessage: 'Please paste a link.' }
  const trimmed = input.trim()
  if (/^(file|about|chrome|chrome-extension|data|blob|javascript):/i.test(trimmed)) return { ok: false, errorCode: 'LOCAL_URL', userMessage: "Local file paths can't be processed." }
  let url: URL
  try { url = new URL(trimmed) } catch { return { ok: false, errorCode: 'INVALID_URL', userMessage: "That doesn't look like a valid link." } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, errorCode: 'NON_HTTP_PROTOCOL', userMessage: 'Only https:// links are supported.' }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.startsWith('127.') || host === '0.0.0.0' || host === '::1') return { ok: false, errorCode: 'LOCAL_URL', userMessage: "Local file paths can't be processed." }
  if (host === 'wetransfer.com' || host === 'www.wetransfer.com' || host === 'we.tl') return { ok: false, errorCode: 'EXPIRING_HOST', userMessage: "WeTransfer links expire and can't be processed reliably." }
  if (host === 'loom.com' || host === 'www.loom.com') return { ok: false, errorCode: 'UNSUPPORTED_HOST', userMessage: "Loom isn't currently supported." }
  const path = url.pathname.toLowerCase()
  const isDropbox = host === 'dropbox.com' || host === 'www.dropbox.com' || host.endsWith('.dropbox.com')
  if (isDropbox) {
    if (path.startsWith('/scl/fo/') || (path.startsWith('/sh/') && !path.includes('/file/'))) return { ok: false, errorCode: 'DROPBOX_FOLDER_URL', userMessage: 'This is a Dropbox folder link. Right-click the specific video file and choose Share → Copy link.' }
    if (path.startsWith('/scl/fi/') || path.startsWith('/s/') || (path.startsWith('/sh/') && path.includes('/file/'))) {
      url.searchParams.delete('st'); url.searchParams.set('dl', '1')
      if (endsWithAny(path, ARCHIVE_EXTS)) return { ok: false, errorCode: 'ARCHIVE_FILE', userMessage: "ZIP/archive files aren't supported." }
      if (endsWithAny(path, IMAGE_EXTS)) return { ok: false, errorCode: 'IMAGE_FILE', userMessage: 'This is an image, not a video.' }
      if (endsWithAny(path, DOC_EXTS)) return { ok: false, errorCode: 'DOCUMENT_FILE', userMessage: 'This is a document, not a video.' }
      return { ok: true, sourceType: 'dropbox', normalizedUrl: url.toString() }
    }
  }
  const isYouTube = host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be'
  if (isYouTube) {
    const v = url.searchParams.get('v')
    const list = url.searchParams.get('list')
    const isShorts = path.startsWith('/shorts/')
    const isLive = path.startsWith('/live/')
    const isWatch = path === '/watch'
    const isPlaylistPage = path === '/playlist'
    const isShortLink = host === 'youtu.be' && path.length > 1
    if ((isPlaylistPage || (isWatch && !v)) && list) return { ok: false, errorCode: 'YOUTUBE_PLAYLIST', userMessage: 'This is a YouTube playlist, not a single video.' }
    if ((isWatch && v) || isShorts || isLive || isShortLink) {
      if (list) { url.searchParams.delete('list'); url.searchParams.delete('index'); url.searchParams.delete('pp'); url.searchParams.delete('t') }
      return { ok: true, sourceType: 'youtube', normalizedUrl: url.toString() }
    }
  }
  if ((host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') && /^\/(?:video\/|channels\/[^/]+\/)?\d+/.test(url.pathname)) {
    return { ok: true, sourceType: 'vimeo', normalizedUrl: url.toString() }
  }
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    if (/^\/file\/d\//.test(url.pathname) || (url.pathname === '/open' && url.searchParams.get('id'))) return { ok: true, sourceType: 'google_drive', normalizedUrl: url.toString() }
    if (/^\/drive\/folders\//.test(url.pathname)) return { ok: false, errorCode: 'GOOGLE_DRIVE_FOLDER', userMessage: 'This is a Google Drive folder. Share a link to the specific file.' }
  }
  if (endsWithAny(path, MEDIA_EXTS)) return { ok: true, sourceType: 'direct', normalizedUrl: url.toString() }
  if (endsWithAny(path, ARCHIVE_EXTS)) return { ok: false, errorCode: 'ARCHIVE_FILE', userMessage: "ZIP/archive files aren't supported." }
  if (endsWithAny(path, IMAGE_EXTS)) return { ok: false, errorCode: 'IMAGE_FILE', userMessage: 'This is an image, not a video.' }
  if (endsWithAny(path, DOC_EXTS)) return { ok: false, errorCode: 'DOCUMENT_FILE', userMessage: 'This is a document, not a video.' }
  return { ok: true, sourceType: 'unknown', normalizedUrl: url.toString() }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const webhookUrl     = process.env.SRP_N8N_TRANSCRIPTION_WEBHOOK_URL
  const callbackSecret = process.env.SRP_N8N_CALLBACK_SECRET
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })
  if (!webhookUrl)     return res.status(500).json({ error: 'SRP_N8N_TRANSCRIPTION_WEBHOOK_URL not configured' })
  if (!callbackSecret) return res.status(500).json({ error: 'SRP_N8N_CALLBACK_SECRET not configured' })

  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : null
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl required' })

  const validation = validateMediaUrl(sourceUrl)
  if (!validation.ok) {
    return res.status(400).json({ error: validation.userMessage, error_code: validation.errorCode })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Generate a job_id so the callback can audit which trigger produced
  // which result. session_id alone is enough to route, but a job_id
  // lets us reject stale callbacks if the user re-triggered.
  const job_id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? (crypto as any).randomUUID()
    : `${sessionId}_${Date.now()}`

  // Save the video URL + clear any prior transcript so the polling UI
  // can detect when the new transcript lands.
  await sb.from('sms_srp_generation')
    .update({
      video_url: validation.normalizedUrl,
      transcript: null,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId)

  // Build the host's own base URL for the callback. The n8n workflow
  // will POST results back to this URL with the callback_secret.
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  const baseUrl = host ? `${proto}://${host}` : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  const payload = {
    job_id,
    session_id: sessionId,
    source_url: validation.normalizedUrl,
    source_type: validation.sourceType,
    callback_url: `${baseUrl}/api/srp/transcription-callback`,
    callback_secret: callbackSecret,
  }

  // Fire the webhook. Await intentionally so we surface any auth /
  // network errors to the user. If the n8n webhook is configured to
  // respond immediately (recommended), this returns within a second
  // or two; if it blocks for the full workflow, we time out at 30s
  // but n8n still runs and the callback will still arrive.
  let webhookOk = false
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // 25s — gives n8n 5s of headroom before our 30s maxDuration.
      signal: AbortSignal.timeout(25_000),
    })
    webhookOk = r.ok
    if (!r.ok) {
      const text = await r.text()
      console.error(`[start-transcription] n8n webhook returned ${r.status}: ${text.slice(0, 300)}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (msg.includes('aborted') || msg.includes('TimeoutError')) {
      // Timeout means n8n is processing but didn't respond fast enough.
      // The job is still in flight; the callback will fire when done.
      webhookOk = true
      console.warn(`[start-transcription] webhook timed out (n8n still running)`)
    } else {
      return res.status(502).json({ error: `n8n webhook failed: ${msg}` })
    }
  }

  return res.status(200).json({
    ok: true,
    job_id,
    session_id: sessionId,
    source_type: validation.sourceType,
    normalized_url: validation.normalizedUrl,
    webhook_status: webhookOk ? 'accepted' : 'failed',
  })
}
