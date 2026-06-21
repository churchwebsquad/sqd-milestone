/**
 * Vercel Serverless Function — /api/web/cowork/ingest-partner-upload
 *
 * Closes the bug where partner-uploaded structured files (CSVs, lists,
 * plain-text docs) reach cowork as opaque `missing:<bucket>/<slug>`
 * markers but their actual content is never read. Result: pages built
 * for those buckets came out empty (the documented small_groups case
 * on partner 3249).
 *
 * Flow:
 *   1. Look up the attachment row + resolve its web_project_id via
 *      session_id → strategy_content_collection_sessions.
 *   2. Download the file from the Supabase Storage bucket
 *      `content-collection-files`.
 *   3. Detect format by mime_type + filename:
 *        • CSV → call /api/web/agents/run-parse-facts-csv with the
 *          raw CSV text. Writes to church_facts.
 *        • TXT / MD / HTML → call /api/web/agents/run-extract-
 *          strategic-pillars with the raw text. Writes to content_atoms.
 *        • PDF / DOCX / XLSX → mark as `unsupported` (v1). Strategist
 *          re-uploads as CSV/text; future work adds binary parsers.
 *   4. Stamp produced rows with source_attachment_id so the strategist
 *      review UI can group "rows from this upload" together.
 *   5. Update the attachment row with parsed_at, parsed_destination,
 *      parsed_rows_count, parse_error.
 *
 * POST body:
 *   { attachment_id: uuid, force?: boolean }
 *
 * `force=true` re-parses an already-parsed attachment (useful for
 * backfill or after a hint upload). Without force, attachments with
 * parsed_at set return their previous result.
 *
 * Security: service-role only. The frontend hits this via the
 * existing /api/proxy or directly with anon (RLS would deny). Real
 * trigger comes from the attachment-insert-side webhook (a separate
 * pgnet trigger or app-layer call after upload completes).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const SUPPORTED_CSV_MIME = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',                // legacy CSV-as-Excel
])
const SUPPORTED_TEXT_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
])
const UNSUPPORTED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // xlsx
])

type ParseDestination = 'church_facts' | 'content_atoms' | 'failed' | 'unsupported' | 'rejected'

interface AttachmentRow {
  id:           string
  session_id:   string
  kind:         string
  file_path:    string
  file_name:    string
  mime_type:    string | null
  size_bytes:   number | null
  target_path:  string | null
  parsed_at:    string | null
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const ingestToken    = process.env.INGEST_AUTH_TOKEN
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' })
  }

  // Auth gate. Accept EITHER:
  //   (a) a valid Supabase user JWT in Authorization: Bearer <jwt>
  //       (staff browser triggers + the review UI)
  //   (b) the server-only INGEST_AUTH_TOKEN header (backfill script,
  //       future cron / webhook). Without one of these, the endpoint
  //       refuses — otherwise anyone with a guessed UUID could burn
  //       Claude budget by spamming /api/web/cowork/ingest-partner-upload.
  const authHeader = String(req.headers?.authorization ?? '')
  const tokenHeader = String(req.headers?.['x-ingest-token'] ?? '')
  let authedBy: 'jwt' | 'token' | null = null
  if (ingestToken && tokenHeader === ingestToken) {
    authedBy = 'token'
  } else if (authHeader.startsWith('Bearer ') && anonKey) {
    const jwt = authHeader.slice('Bearer '.length).trim()
    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }})
    const { data: userRes } = await authClient.auth.getUser(jwt)
    if (userRes?.user) authedBy = 'jwt'
  }
  if (!authedBy) return res.status(401).json({ error: 'unauthorized' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const attachmentId = typeof req.body?.attachment_id === 'string' ? req.body.attachment_id : null
  const force = Boolean(req.body?.force)
  if (!attachmentId) return res.status(400).json({ error: 'attachment_id required' })

  // 1. Look up the attachment + project context.
  const { data: att, error: attErr } = await sb
    .from('strategy_content_collection_attachments')
    .select('id, session_id, kind, file_path, file_name, mime_type, size_bytes, target_path, parsed_at')
    .eq('id', attachmentId)
    .maybeSingle()
  if (attErr) return res.status(500).json({ error: 'attachment lookup failed', detail: attErr.message })
  if (!att)   return res.status(404).json({ error: 'attachment_not_found' })
  const attachment = att as AttachmentRow

  if (attachment.parsed_at && !force) {
    return res.status(200).json({
      ok: true, attachment_id: attachmentId, skipped: true,
      reason: 'already_parsed', parsed_at: attachment.parsed_at,
    })
  }

  const { data: session, error: sessErr } = await sb
    .from('strategy_content_collection_sessions')
    .select('web_project_id')
    .eq('id', attachment.session_id)
    .maybeSingle()
  if (sessErr || !session) {
    return await failParse(sb, attachmentId, 'session_lookup_failed', sessErr?.message ?? 'no session')
      .then(() => res.status(500).json({ error: 'session_lookup_failed' }))
  }
  const webProjectId = (session as { web_project_id: string }).web_project_id

  // 2. Detect format. Mime wins when present; filename extension is a
  //    fallback for browsers that pass empty mime. A mime+ext mismatch
  //    (e.g. text/csv with a .xlsx name) resolves to the mime — the
  //    user explicitly tagged the bytes that way.
  const mime = (attachment.mime_type ?? '').toLowerCase()
  const name = attachment.file_name.toLowerCase()
  const extCsv  = name.endsWith('.csv')
  const extText = name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown')
  const extBinary = name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.xlsx')
  let isCsv = false, isText = false, isUnsupported = false
  if (mime) {
    if (SUPPORTED_CSV_MIME.has(mime))   isCsv = true
    else if (SUPPORTED_TEXT_MIME.has(mime)) isText = true
    else if (UNSUPPORTED_MIME.has(mime))    isUnsupported = true
    // unknown mime falls through to the extension fallback below
  }
  if (!isCsv && !isText && !isUnsupported) {
    if (extCsv)        isCsv = true
    else if (extText)  isText = true
    else if (extBinary) isUnsupported = true
  }

  if (isUnsupported) {
    await markParsed(sb, attachmentId, 'unsupported', 0, `mime ${mime || 'unknown'} not yet supported — upload as CSV or plain text`)
    return res.status(200).json({
      ok: true, attachment_id: attachmentId, destination: 'unsupported',
      detail: 'PDF / DOCX / XLSX not yet parsed; upload as CSV or .txt.',
    })
  }
  if (!isCsv && !isText) {
    await markParsed(sb, attachmentId, 'unsupported', 0, `mime ${mime || 'unknown'} not handled`)
    return res.status(200).json({ ok: true, attachment_id: attachmentId, destination: 'unsupported' })
  }

  // 3. Download from Storage. The InventoryView uploader writes to
  //    bucket `content-collection-files` at attachment.file_path.
  const { data: fileBlob, error: dlErr } = await sb.storage
    .from('content-collection-files')
    .download(attachment.file_path)
  if (dlErr || !fileBlob) {
    await markParsed(sb, attachmentId, 'failed', 0, `storage download failed: ${dlErr?.message ?? 'no blob'}`)
    return res.status(500).json({ error: 'storage_download_failed', detail: dlErr?.message })
  }
  const fileText = await fileBlob.text()
  if (!fileText.trim()) {
    await markParsed(sb, attachmentId, 'failed', 0, 'file is empty')
    return res.status(200).json({ ok: true, attachment_id: attachmentId, destination: 'failed', detail: 'empty_file' })
  }

  // 4. Call the appropriate downstream parser. We construct the URL
  //    from the deployment origin (VERCEL_URL or VITE_PUBLIC_BASE_URL)
  //    and re-use the existing Vercel function so all gateway/SKILL
  //    handling stays in one place.
  const baseUrl = resolveBaseUrl(req)
  const sourceKind = 'content_collection'
  const sourceRef  = `attachment:${attachmentId}`

  // On force=true, archive any previously-produced rows for this
  // attachment so the strategist doesn't end up with two stacks of
  // drafts referencing the same upload. The downstream parser already
  // wipes its own DRAFT rows by (project, source_kind, source_ref);
  // here we additionally archive APPROVED rows so the rerun starts
  // clean. Approved data isn't destroyed — status='archived' is the
  // existing soft-delete convention.
  if (force) {
    for (const table of ['church_facts', 'content_atoms'] as const) {
      const { error: archErr } = await (sb as any)
        .from(table)
        .update({ status: 'archived' })
        .eq('source_attachment_id', attachmentId)
        .neq('status', 'archived')
      if (archErr) {
        await markParsed(sb, attachmentId, 'failed', 0, `pre-force archive failed: ${archErr.message}`)
        return res.status(500).json({ error: 'force_archive_failed', detail: archErr.message })
      }
    }
  }

  const parserResp = isCsv
    ? await fetch(`${baseUrl}/api/web/agents/run-parse-facts-csv`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id:      webProjectId,
          source_kind:     sourceKind,
          source_ref:      sourceRef,
          source_csv:      fileText,
          source_filename: attachment.file_name,
        }),
      })
    : await fetch(`${baseUrl}/api/web/agents/run-extract-strategic-pillars`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id:      webProjectId,
          source_kind:     sourceKind,
          source_ref:      sourceRef,
          source_text:     fileText,
          source_filename: attachment.file_name,
        }),
      })

  const parserBody = await parserResp.json().catch(() => ({}))
  if (!parserResp.ok) {
    await markParsed(sb, attachmentId, 'failed', 0, `parser failed (${parserResp.status}): ${JSON.stringify(parserBody)?.slice(0, 400)}`)
    return res.status(parserResp.status).json({ error: 'parser_failed', detail: parserBody })
  }

  const insertedIds: string[] = Array.isArray(parserBody.inserted_ids) ? parserBody.inserted_ids : []
  const destination: ParseDestination = isCsv ? 'church_facts' : 'content_atoms'

  // 5. Stamp source_attachment_id on the produced rows so the review
  //    UI can group "rows from this upload."
  if (insertedIds.length > 0) {
    const table = destination === 'church_facts' ? 'church_facts' : 'content_atoms'
    const { error: stampErr } = await (sb as any)
      .from(table)
      .update({ source_attachment_id: attachmentId })
      .in('id', insertedIds)
    if (stampErr) {
      // Rows exist + are findable by source_ref, but the review UI
      // queries by source_attachment_id and would miss them. Surface
      // as 'failed' so the strategist sees the inconsistency in the
      // PartnerUploadReview pane rather than silently losing rows.
      await markParsed(sb, attachmentId, 'failed', insertedIds.length,
        `rows inserted but source stamp failed: ${stampErr.message}. Find by source_ref=${sourceRef}.`)
      return res.status(500).json({
        error: 'stamp_failed', detail: stampErr.message,
        inserted_count: insertedIds.length, source_ref: sourceRef,
      })
    }
  }

  await markParsed(sb, attachmentId, destination, insertedIds.length, null)
  return res.status(200).json({
    ok: true,
    attachment_id: attachmentId,
    destination,
    inserted_count: insertedIds.length,
    inserted_ids:   insertedIds,
    report:         parserBody.report ?? null,
  })
}

// ── Helpers ───────────────────────────────────────────────────────

async function markParsed(
  sb: any, attachmentId: string, destination: ParseDestination,
  rowsCount: number, error: string | null,
) {
  const now = new Date().toISOString()
  await sb.from('strategy_content_collection_attachments')
    .update({
      parsed_at:          now,
      parsed_destination: destination,
      parsed_rows_count:  rowsCount,
      parse_error:        error,
    })
    .eq('id', attachmentId)
}

async function failParse(sb: any, attachmentId: string, code: string, detail: string) {
  await markParsed(sb, attachmentId, 'failed', 0, `${code}: ${detail}`)
}

function resolveBaseUrl(req: any): string {
  // Prefer VERCEL_URL when running on Vercel; fall back to the
  // request's own origin for local dev.
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) return `https://${vercelUrl}`
  const host  = req.headers?.host ?? 'localhost:3000'
  const proto = req.headers?.['x-forwarded-proto'] ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
