/**
 * FileUploadField — single-file upload affordance used across Content
 * Collection (copy doc, per-type CSVs, "missing" attachments).
 *
 * Stateless wrt persistence — caller passes in the existing list of
 * attachments to display + the kind/target/session context. On
 * successful upload the new attachment is reported back via `onUploaded`.
 *
 * Validates against the kind's `accept` whitelist before sending the
 * request (server-side bucket policy is the backstop).
 */
import { useRef, useState } from 'react'
import { Loader2, Paperclip, X, FileText, Image as ImageIcon, AlertCircle, ExternalLink } from 'lucide-react'
import {
  uploadContentCollectionFile,
  deleteAttachment,
  attachmentPublicUrl,
  ACCEPT_BY_KIND,
  type AttachmentKind,
  type AttachmentMetadata,
} from '../../lib/contentCollectionAttachments'

interface Props {
  sessionId:    string
  kind:         AttachmentKind
  /** Existing attachments to render below the upload button. The
   *  caller is responsible for filtering its session-wide attachment
   *  list to the ones matching this field. */
  attachments:  AttachmentMetadata[]
  /** Called after a successful upload. Caller refreshes its state
   *  list so the new row appears. */
  onUploaded?:  (attachment: AttachmentMetadata) => void
  /** Called after a successful delete. */
  onDeleted?:   (attachmentId: string) => void
  /** For kind='missing' — passes through to the attachment row. */
  targetPath?:  string | null
  /** Short prompt above the input (e.g. "Upload your staff directory CSV"). */
  label?:       string
  /** Helper text beneath the prompt. */
  help?:        string
  /** Force a smaller compact button for inline use inside other forms. */
  compact?:     boolean
  /** When true, allow multiple files in sequence — same component just
   *  shows the button after each upload. Defaults to true. */
  allowMultiple?: boolean
}

export function FileUploadField({
  sessionId, kind, attachments, onUploaded, onDeleted,
  targetPath, label, help, compact, allowMultiple = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const accept = ACCEPT_BY_KIND[kind]
  const canAddMore = allowMultiple || attachments.length === 0

  const onFile = async (file: File) => {
    setError(null)
    setBusy(true)
    try {
      const r = await uploadContentCollectionFile({ sessionId, kind, file, targetPath })
      if (!r.ok || !r.attachment) {
        setError(r.error ?? 'Upload failed')
        return
      }
      onUploaded?.(r.attachment)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onRemove = async (a: AttachmentMetadata) => {
    setBusy(true)
    setError(null)
    try {
      const r = await deleteAttachment(a)
      if (!r.ok) { setError(r.error ?? 'Failed to remove'); return }
      onDeleted?.(a.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {label && (
        <p className={compact ? 'text-[11px] font-semibold text-deep-plum' : 'text-xs font-semibold text-deep-plum'}>
          {label}
        </p>
      )}
      {help && <p className="text-[11px] text-purple-gray">{help}</p>}

      {attachments.length > 0 && (
        <ul className="space-y-1.5">
          {attachments.map(a => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border border-lavender bg-cream/30 px-2.5 py-1.5">
              {fileIcon(a.mime_type)}
              <a
                href={attachmentPublicUrl(a.file_path)}
                target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-deep-plum hover:text-primary-purple truncate flex-1 min-w-0 inline-flex items-center gap-1"
                title={a.file_name}
              >
                <span className="truncate">{a.file_name}</span>
                <ExternalLink size={10} className="shrink-0" />
              </a>
              {typeof a.size_bytes === 'number' && (
                <span className="text-[10px] text-purple-gray shrink-0">{formatBytes(a.size_bytes)}</span>
              )}
              <button
                type="button"
                onClick={() => onRemove(a)}
                disabled={busy}
                className="text-purple-gray hover:text-red-600 disabled:opacity-40 shrink-0"
                title="Remove"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAddMore && (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary-purple/60 text-primary-purple font-semibold transition-colors hover:bg-lavender-tint/40 disabled:opacity-50 ${
              compact ? 'text-[11px] px-2.5 py-1' : 'text-xs px-3 py-1.5'
            }`}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
            {busy ? 'Uploading…' : attachments.length > 0 ? 'Add another' : 'Attach file'}
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-700 inline-flex items-center gap-1">
          <AlertCircle size={10} /> {error}
        </p>
      )}
    </div>
  )
}

function fileIcon(mime: string | null) {
  if (mime?.startsWith('image/')) return <ImageIcon size={12} className="text-purple-gray shrink-0" />
  return <FileText size={12} className="text-purple-gray shrink-0" />
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
