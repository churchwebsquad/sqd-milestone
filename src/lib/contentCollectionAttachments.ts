/**
 * Content Collection attachments — upload helpers + types.
 *
 * Files land in the `content-collection-files` Supabase Storage bucket
 * (public, 50 MB cap per object). Metadata + display name are kept in
 * the `strategy_content_collection_attachments` row.
 *
 * Path convention: `{session_id}/{kind}/{uuid}-{safe_filename}`
 * — session prefix lets us list / purge per-session without a join.
 */

import { supabase } from './supabase'

export type AttachmentKind =
  | 'missing'
  | 'copy_doc'
  | 'staff_csv'
  | 'volunteer_csv'
  | 'groups_csv'
  | 'careers_csv'
  | 'testimonials_csv'
  | 'campuses_csv'
  | 'supplemental'

export interface AttachmentMetadata {
  id:           string
  session_id:   string
  kind:         string
  file_path:    string
  file_name:    string
  mime_type:    string | null
  size_bytes:   number | null
  target_path:  string | null
  uploaded_at:  string
}

const BUCKET = 'content-collection-files'

/** Strip filesystem-hostile characters from a filename — keeps it
 *  human-readable in Supabase Storage's object list but ensures the
 *  URL is safe. */
function safeFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext  = dot > 0 ? name.slice(dot)    : ''
  const s = stem
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file'
  return s + ext
}

/** Random suffix that's stable enough across uploads to not collide.
 *  Date.now() is forbidden in workflows but fine in app code. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

export interface UploadInput {
  sessionId:   string
  kind:        AttachmentKind
  file:        File
  /** For kind='missing': the mark.target_path this file is attached
   *  to ("missing:staff/baseline-staff_list-abc"). Helps staff later
   *  trace which form bucket the CSV belongs to. */
  targetPath?: string | null
}

export interface UploadResult {
  ok:           boolean
  attachment?:  AttachmentMetadata
  error?:       string
}

export async function uploadContentCollectionFile(input: UploadInput): Promise<UploadResult> {
  const { sessionId, kind, file, targetPath = null } = input
  if (!sessionId) return { ok: false, error: 'Missing session id' }
  if (!file)      return { ok: false, error: 'No file selected' }

  const cleanName = safeFilename(file.name)
  const objectPath = `${sessionId}/${kind}/${randomSuffix()}-${cleanName}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, file, {
      contentType: file.type || undefined,
      upsert: false,
    })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const { data: row, error: insertErr } = await supabase
    .from('strategy_content_collection_attachments')
    .insert({
      session_id:  sessionId,
      kind,
      file_path:   objectPath,
      file_name:   file.name,
      mime_type:   file.type || null,
      size_bytes:  file.size,
      target_path: targetPath,
    })
    .select()
    .single()
  if (insertErr || !row) {
    // Best-effort cleanup so we don't orphan the storage object.
    await supabase.storage.from(BUCKET).remove([objectPath])
    return { ok: false, error: insertErr?.message ?? 'Failed to record attachment' }
  }

  // Fire-and-forget: kick off the ingest job so the file content
  // gets parsed into church_facts / content_atoms instead of sitting
  // as an opaque marker. Don't await — the upload's success doesn't
  // depend on parser completion; the strategist review UI surfaces
  // pending / failed states later.
  void triggerIngestPartnerUpload((row as AttachmentMetadata).id)

  return { ok: true, attachment: row as AttachmentMetadata }
}

/** Kick off the ingest-partner-upload edge function for an attachment.
 *  Best-effort — failures here don't block the upload. The strategist
 *  review UI surfaces unparsed attachments so nothing falls silently.
 *
 *  The endpoint requires either a Supabase user JWT (staff/partner
 *  session) or an INGEST_AUTH_TOKEN server-side header. From the
 *  browser we send the current session's access token; partners
 *  uploading via the public Content Collection page have anon-key
 *  auth — for those, the row is queued (parsed_at stays null) and
 *  the strategist review UI or the backfill script picks them up. */
export async function triggerIngestPartnerUpload(
  attachmentId: string,
  opts?: { force?: boolean },
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (session?.access_token) {
      headers.authorization = `Bearer ${session.access_token}`
    }
    await fetch('/api/web/cowork/ingest-partner-upload', {
      method: 'POST',
      headers,
      body: JSON.stringify({ attachment_id: attachmentId, force: opts?.force ?? false }),
      keepalive: true,
    })
  } catch {
    /* swallow — parser status remains null until manual retry */
  }
}

/** Build a public URL for an attachment file. The bucket is public so
 *  these URLs work for both partner-facing previews and staff downloads. */
export function attachmentPublicUrl(filePath: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

/** Delete an attachment + its storage object. Used by partner UI when
 *  they remove an upload before submitting. */
export async function deleteAttachment(attachment: AttachmentMetadata): Promise<{ ok: boolean; error?: string }> {
  const { error: storageErr } = await supabase.storage.from(BUCKET).remove([attachment.file_path])
  if (storageErr) return { ok: false, error: storageErr.message }
  const { error: dbErr } = await supabase
    .from('strategy_content_collection_attachments')
    .delete()
    .eq('id', attachment.id)
  if (dbErr) return { ok: false, error: dbErr.message }
  return { ok: true }
}

/** Load all attachments for a session. */
export async function listSessionAttachments(sessionId: string): Promise<AttachmentMetadata[]> {
  const { data } = await supabase
    .from('strategy_content_collection_attachments')
    .select('*')
    .eq('session_id', sessionId)
    .order('uploaded_at', { ascending: false })
  return (data ?? []) as AttachmentMetadata[]
}

/** Whitelist of mime types per attachment kind. Enforced in the
 *  upload UI before the request — server-side, the bucket's
 *  `allowed_mime_types` is the backstop. */
export const ACCEPT_BY_KIND: Record<AttachmentKind, string> = {
  missing:           '.csv,.doc,.docx,.jpg,.jpeg,.png,.webp,.gif,.pdf,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,application/pdf',
  copy_doc:          '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  staff_csv:         '.csv,text/csv',
  volunteer_csv:     '.csv,text/csv',
  groups_csv:        '.csv,text/csv',
  careers_csv:       '.csv,text/csv',
  testimonials_csv:  '.csv,text/csv',
  campuses_csv:      '.csv,.doc,.docx,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  supplemental:      '.csv,.doc,.docx,.jpg,.jpeg,.png,.webp,.gif,.pdf,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,application/pdf',
}

export const KIND_LABEL: Record<AttachmentKind, string> = {
  missing:          'Attachment',
  copy_doc:         'Copy document (.docx)',
  staff_csv:        'Staff directory CSV',
  volunteer_csv:    'Volunteers CSV',
  groups_csv:       'Groups CSV',
  careers_csv:      'Careers CSV',
  testimonials_csv: 'Testimonials CSV',
  campuses_csv:     'Campuses CSV or .docx',
  supplemental:     'Supplemental attachment',
}
