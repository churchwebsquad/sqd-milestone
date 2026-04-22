import { supabase } from './supabase'

const BUCKET = 'submission-attachments'
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
const MAX_BYTES_RAW = 20 * 1024 * 1024       // 20 MB hard cap (matches bucket policy, widened in v14)
const MAX_DIM = 2000                         // resize larger images down to 2000px max
const JPEG_QUALITY = 0.85

export type UploadProgress = (pct: number) => void

export interface UploadResult {
  url: string
  path: string
  size: number
  filename: string
}

export class AttachmentError extends Error {
  kind: 'mime' | 'size' | 'upload' | 'resize'
  constructor(kind: AttachmentError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

/** Pre-upload validation — mime + size. */
function validate(file: File) {
  if (!ALLOWED_MIME.includes(file.type)) {
    throw new AttachmentError('mime', 'Only JPEG, PNG, WebP, GIF, and PDF files are supported.')
  }
  if (file.size > MAX_BYTES_RAW) {
    throw new AttachmentError('size', `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 20 MB.`)
  }
}

/** Resize an image to fit within maxDim × maxDim. Returns a Blob ready to upload.
 *  GIFs are passed through (resizing would strip animation). PDFs are passed
 *  through as-is (not raster images). PNG/JPEG/WebP are redrawn through canvas
 *  and re-encoded. */
function resize(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.type === 'image/gif' || file.type === 'application/pdf') {
    return Promise.resolve({ blob: file, mime: file.type })
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const longest = Math.max(img.width, img.height)
      if (longest <= MAX_DIM && file.size < 2 * 1024 * 1024) {
        // Small enough to skip the re-encode entirely.
        resolve({ blob: file, mime: file.type })
        return
      }
      const scale = Math.min(1, MAX_DIM / longest)
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
      // Prefer original mime when possible; fall back to JPEG for uncompressable sources.
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

/** Turn "My File (1).PNG" into "my-file-1.png" for a clean storage path. */
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
 * The onProgress callback fires at coarse milestones (validate/resize/upload/done).
 * The Supabase JS client doesn't expose real byte-level progress yet, so callers
 * should treat this as a staged indicator rather than a true progress bar.
 */
export async function uploadAttachment(
  file: File,
  memberId: number,
  onProgress?: UploadProgress,
): Promise<UploadResult> {
  validate(file)
  onProgress?.(10)

  const { blob, mime } = await resize(file)
  onProgress?.(50)

  if (blob.size > MAX_BYTES_RAW) {
    throw new AttachmentError('size', `File is ${(blob.size / 1024 / 1024).toFixed(1)} MB — larger than the 20 MB limit.`)
  }

  const path = `${memberId}/${Date.now()}-${slugifyFilename(file.name)}`
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mime,
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadErr) {
    throw new AttachmentError('upload', uploadErr.message)
  }
  onProgress?.(90)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  onProgress?.(100)

  return {
    url: pub.publicUrl,
    path,
    size: blob.size,
    filename: file.name,
  }
}

/** Best-effort removal of a prior attachment when the user replaces it.
 *  Swallows errors — leaving an orphan is not worth failing the flow. */
export async function removeAttachment(path: string): Promise<void> {
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path]).catch(() => { /* ignore */ })
}

/** Derive the storage path from a public URL (for the Remove/Replace flow). */
export function pathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}
