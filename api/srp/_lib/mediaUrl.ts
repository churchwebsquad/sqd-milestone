/**
 * Shared media URL validator for SRP endpoints.
 *
 * Normalizes YouTube / Dropbox / Vimeo / Google Drive / direct-MP4 links
 * to a canonical form and classifies the source_type. Catches common
 * mistakes (Dropbox folder vs file, YouTube playlist vs video, ZIP
 * archives, images, expiring hosts).
 *
 * Kept in sync with src/lib/mediaUrlValidator.ts on the client side.
 * The client validates before submit; this is the last-line server defense.
 */

const ARCHIVE_EXTS = ['.zip', '.rar', '.7z', '.tar', '.tar.gz', '.tgz', '.gz']
const IMAGE_EXTS   = ['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.bmp', '.tiff', '.tif', '.svg']
const DOC_EXTS     = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.rtf']
const MEDIA_EXTS   = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.opus']

const endsWithAny = (s: string, list: string[]) => list.some(ext => s.endsWith(ext))

export type SourceType = 'youtube' | 'dropbox' | 'vimeo' | 'google_drive' | 'direct' | 'unknown'

export interface ValidMediaUrl  { ok: true;  sourceType: SourceType; normalizedUrl: string }
export interface InvalidMediaUrl { ok: false; errorCode: string;       userMessage: string }
export type MediaUrlValidation = ValidMediaUrl | InvalidMediaUrl

export function validateMediaUrl(input: unknown): MediaUrlValidation {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, errorCode: 'EMPTY_URL', userMessage: 'Please paste a link.' }
  }
  const trimmed = input.trim()
  if (/^(file|about|chrome|chrome-extension|data|blob|javascript):/i.test(trimmed)) {
    return { ok: false, errorCode: 'LOCAL_URL', userMessage: "Local file paths can't be processed." }
  }
  let url: URL
  try { url = new URL(trimmed) } catch {
    return { ok: false, errorCode: 'INVALID_URL', userMessage: "That doesn't look like a valid link." }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, errorCode: 'NON_HTTP_PROTOCOL', userMessage: 'Only https:// links are supported.' }
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.startsWith('127.') || host === '0.0.0.0' || host === '::1') {
    return { ok: false, errorCode: 'LOCAL_URL', userMessage: "Local file paths can't be processed." }
  }
  if (host === 'wetransfer.com' || host === 'www.wetransfer.com' || host === 'we.tl') {
    return { ok: false, errorCode: 'EXPIRING_HOST', userMessage: "WeTransfer links expire and can't be processed reliably." }
  }
  if (host === 'loom.com' || host === 'www.loom.com') {
    return { ok: false, errorCode: 'UNSUPPORTED_HOST', userMessage: "Loom isn't currently supported." }
  }
  const path = url.pathname.toLowerCase()

  const isDropbox = host === 'dropbox.com' || host === 'www.dropbox.com' || host.endsWith('.dropbox.com')
  if (isDropbox) {
    if (path.startsWith('/scl/fo/') || (path.startsWith('/sh/') && !path.includes('/file/'))) {
      return { ok: false, errorCode: 'DROPBOX_FOLDER_URL', userMessage: 'This is a Dropbox folder link. Right-click the specific video file and choose Share → Copy link.' }
    }
    if (path.startsWith('/scl/fi/') || path.startsWith('/s/') || (path.startsWith('/sh/') && path.includes('/file/'))) {
      url.searchParams.delete('st')
      url.searchParams.set('dl', '1')
      if (endsWithAny(path, ARCHIVE_EXTS)) return { ok: false, errorCode: 'ARCHIVE_FILE',  userMessage: "ZIP/archive files aren't supported." }
      if (endsWithAny(path, IMAGE_EXTS))   return { ok: false, errorCode: 'IMAGE_FILE',    userMessage: 'This is an image, not a video.' }
      if (endsWithAny(path, DOC_EXTS))     return { ok: false, errorCode: 'DOCUMENT_FILE', userMessage: 'This is a document, not a video.' }
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
    if ((isPlaylistPage || (isWatch && !v)) && list) {
      return { ok: false, errorCode: 'YOUTUBE_PLAYLIST', userMessage: 'This is a YouTube playlist, not a single video.' }
    }
    if ((isWatch && v) || isShorts || isLive || isShortLink) {
      if (list) {
        url.searchParams.delete('list')
        url.searchParams.delete('index')
        url.searchParams.delete('pp')
        url.searchParams.delete('t')
      }
      return { ok: true, sourceType: 'youtube', normalizedUrl: url.toString() }
    }
  }

  if ((host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') && /^\/(?:video\/|channels\/[^/]+\/)?\d+/.test(url.pathname)) {
    return { ok: true, sourceType: 'vimeo', normalizedUrl: url.toString() }
  }

  if (host === 'drive.google.com' || host === 'docs.google.com') {
    if (/^\/file\/d\//.test(url.pathname) || (url.pathname === '/open' && url.searchParams.get('id'))) {
      return { ok: true, sourceType: 'google_drive', normalizedUrl: url.toString() }
    }
    if (/^\/drive\/folders\//.test(url.pathname)) {
      return { ok: false, errorCode: 'GOOGLE_DRIVE_FOLDER', userMessage: 'This is a Google Drive folder. Share a link to the specific file.' }
    }
  }

  if (endsWithAny(path, MEDIA_EXTS))   return { ok: true,  sourceType: 'direct',         normalizedUrl: url.toString() }
  if (endsWithAny(path, ARCHIVE_EXTS)) return { ok: false, errorCode: 'ARCHIVE_FILE',    userMessage: "ZIP/archive files aren't supported." }
  if (endsWithAny(path, IMAGE_EXTS))   return { ok: false, errorCode: 'IMAGE_FILE',      userMessage: 'This is an image, not a video.' }
  if (endsWithAny(path, DOC_EXTS))     return { ok: false, errorCode: 'DOCUMENT_FILE',   userMessage: 'This is a document, not a video.' }

  return { ok: true, sourceType: 'unknown', normalizedUrl: url.toString() }
}
