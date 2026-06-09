/**
 * Media URL validator — ported from the reference srp-generator-main app.
 *
 * Resolves a pasted link to one of: youtube | vimeo | dropbox | google_drive
 * | direct | unknown. Returns a normalized URL (Dropbox dl=1 fixup, etc).
 *
 * Catches expiring hosts (WeTransfer), unsupported hosts (Loom), folder
 * URLs (Dropbox /scl/fo/, Google Drive folders), image / archive / doc
 * file extensions, and local/blob/javascript URLs.
 *
 * Kept in sync with api/srp/start-transcription.ts which inlines the
 * same logic as a last-line server-side defense.
 */

const ARCHIVE_EXTS = ['.zip', '.rar', '.7z', '.tar', '.tar.gz', '.tgz', '.gz']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.bmp', '.tiff', '.tif', '.svg']
const DOC_EXTS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.rtf']
const MEDIA_EXTS = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.opus']
const endsWithAny = (s: string, list: string[]) => list.some(ext => s.endsWith(ext))

export type MediaSourceType = 'youtube' | 'vimeo' | 'dropbox' | 'google_drive' | 'direct' | 'unknown'

export type MediaValidationResult =
  | { ok: true; sourceType: MediaSourceType; normalizedUrl: string }
  | { ok: false; errorCode: string; userMessage: string }

export function validateMediaUrl(input: unknown): MediaValidationResult {
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
    if (path.startsWith('/scl/fo/') || (path.startsWith('/sh/') && !path.includes('/file/'))) {
      return { ok: false, errorCode: 'DROPBOX_FOLDER_URL', userMessage: 'This is a Dropbox folder link. Right-click the specific video file and choose Share → Copy link.' }
    }
    if (path.startsWith('/scl/fi/') || path.startsWith('/s/') || (path.startsWith('/sh/') && path.includes('/file/'))) {
      url.searchParams.delete('st')
      url.searchParams.set('dl', '1')
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

/** Build a deep-link to play the source at a specific timestamp. Used by
 *  the clip preview to "Play in source" without an inline player.
 *  Falls back to the bare URL when the source doesn't support timestamp. */
export function deepLinkAtTime(sourceType: MediaSourceType, url: string, startSec?: number): string {
  if (startSec == null || !isFinite(startSec) || startSec < 0) return url
  const t = Math.floor(startSec)
  try {
    const u = new URL(url)
    if (sourceType === 'youtube') {
      // YouTube: ?t=Ns (replace any existing t)
      u.searchParams.set('t', `${t}s`)
      return u.toString()
    }
    if (sourceType === 'vimeo') {
      // Vimeo: #t=Xm Ys
      const m = Math.floor(t / 60)
      const s = t % 60
      return `${u.origin}${u.pathname}${u.search}#t=${m}m${s}s`
    }
    if (sourceType === 'direct') {
      // HTML video: #t=N
      return `${u.origin}${u.pathname}${u.search}#t=${t}`
    }
    return url
  } catch {
    return url
  }
}
