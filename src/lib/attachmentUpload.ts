import { supabase } from './supabase'

const DEFAULT_BUCKET = 'submission-attachments'
const DEFAULT_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024    // 20 MB — matches submission-attachments bucket policy (widened in v14)
const DEFAULT_MAX_DIM = 2000                  // resize larger images down to 2000px max
const JPEG_QUALITY = 0.85

/** MIME types that cannot be losslessly canvas-resized; uploaded as-is. */
const NON_RESIZABLE_MIME = new Set<string>([
  'image/gif',         // animation would be stripped
  'image/svg+xml',     // vector, no benefit from raster resize
  'video/mp4',
  'application/pdf',   // not an image
  'application/zip',
  'application/x-zip-compressed',
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf',
  'application/octet-stream',
])

export type UploadProgress = (pct: number) => void

export interface UploadResult {
  url: string
  path: string
  size: number
  filename: string
}

export interface UploadOptions {
  /** Destination Storage bucket. Defaults to 'submission-attachments'. */
  bucket?: string
  /** Folder path prefix inside the bucket. Appended with `{timestamp}-{slug(filename)}`.
   *  If omitted, the legacy `{memberId}/` shape is used for backward compat with
   *  submission attachments — callers passing a memberId without a prefix get that path. */
  pathPrefix?: string
  /** Allowed MIME types. Defaults to the four image types (JPEG/PNG/WebP/GIF). */
  allowedMime?: readonly string[]
  /** Maximum raw bytes. Defaults to 10 MB. */
  maxBytes?: number
  /** Longest-edge resize cap in pixels (raster images only). Defaults to 2000. */
  maxDim?: number
}

export class AttachmentError extends Error {
  kind: 'mime' | 'size' | 'upload' | 'resize'
  constructor(kind: AttachmentError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

function validate(file: File, opts: Required<Pick<UploadOptions, 'allowedMime' | 'maxBytes'>>) {
  if (!opts.allowedMime.includes(file.type)) {
    throw new AttachmentError(
      'mime',
      `File type ${file.type || 'unknown'} is not allowed. Accepted: ${opts.allowedMime.join(', ')}.`,
    )
  }
  if (file.size > opts.maxBytes) {
    throw new AttachmentError(
      'size',
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${(opts.maxBytes / 1024 / 1024).toFixed(0)} MB.`,
    )
  }
}

/**
 * Resize a raster image to fit within maxDim × maxDim. Returns a Blob ready
 * to upload. Non-resizable types (GIF, SVG, MP4, fonts) are passed through.
 */
function resize(file: File, maxDim: number): Promise<{ blob: Blob; mime: string }> {
  if (NON_RESIZABLE_MIME.has(file.type)) {
    return Promise.resolve({ blob: file, mime: file.type })
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const longest = Math.max(img.width, img.height)
      if (longest <= maxDim && file.size < 2 * 1024 * 1024) {
        resolve({ blob: file, mime: file.type })
        return
      }
      const scale = Math.min(1, maxDim / longest)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new AttachmentError('resize', 'Canvas context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new AttachmentError('resize', 'Failed to encode resized image')); return }
          resolve({ blob, mime: outMime })
        },
        outMime,
        outMime === 'image/jpeg' ? JPEG_QUALITY : undefined,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new AttachmentError('resize', 'Image load failed')) }
    img.src = url
  })
}

function slugifyFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const clean = stem.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file'
  return ext ? `${clean}.${ext}` : clean
}

/**
 * Validate → resize → upload → return the Supabase public URL.
 *
 * Two calling styles:
 *   (A) Legacy submission-attachments path:
 *       uploadAttachment(file, memberId, onProgress)
 *       → uploads to 'submission-attachments/{memberId}/{ts}-{slug}.ext' with image MIME allowlist.
 *
 *   (B) Arbitrary bucket/prefix/MIME allowlist:
 *       uploadAttachment(file, null, onProgress, {
 *         bucket: 'brand-assets',
 *         pathPrefix: `${brandGuideId}/logos`,
 *         allowedMime: ['image/svg+xml', 'image/png', ...],
 *         maxBytes: 20 * 1024 * 1024,
 *       })
 *
 * The onProgress callback fires at coarse milestones (validate/resize/upload/done).
 * The Supabase JS client doesn't expose byte-level progress, so treat this as
 * a staged indicator rather than a true progress bar.
 */
export async function uploadAttachment(
  file: File,
  memberIdOrNull: number | null,
  onProgress?: UploadProgress,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const bucket = options.bucket ?? DEFAULT_BUCKET
  const allowedMime = options.allowedMime ?? DEFAULT_ALLOWED_MIME
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxDim = options.maxDim ?? DEFAULT_MAX_DIM
  const pathPrefix = options.pathPrefix
    ?? (memberIdOrNull != null ? `${memberIdOrNull}` : '')

  validate(file, { allowedMime, maxBytes })
  onProgress?.(10)

  const { blob, mime } = await resize(file, maxDim)
  onProgress?.(50)

  if (blob.size > maxBytes) {
    throw new AttachmentError(
      'size',
      `Resized file is still ${(blob.size / 1024 / 1024).toFixed(1)} MB — larger than the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    )
  }

  const stub = `${Date.now()}-${slugifyFilename(file.name)}`
  const path = pathPrefix ? `${pathPrefix.replace(/\/$/, '')}/${stub}` : stub

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: mime,
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadErr) {
    throw new AttachmentError('upload', uploadErr.message)
  }
  onProgress?.(90)

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path)
  onProgress?.(100)

  return { url: pub.publicUrl, path, size: blob.size, filename: file.name }
}

/** Best-effort removal of a prior file when the user replaces it. Swallows
 *  errors — leaving an orphan is not worth failing the flow. */
export async function removeAttachment(path: string, bucket: string = DEFAULT_BUCKET): Promise<void> {
  if (!path) return
  await supabase.storage.from(bucket).remove([path]).catch(() => { /* ignore */ })
}

/** Derive the storage path from a public URL (for the Remove/Replace flow). */
export function pathFromPublicUrl(url: string, bucket: string = DEFAULT_BUCKET): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}
