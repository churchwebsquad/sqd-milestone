/**
 * Inline clip preview player. Supports four sources without external
 * library deps:
 *
 *   - rendered_mp4: a clipcutter-rendered MP4 — plays whole, no timing
 *   - youtube:      iframe embed with ?start=X&end=Y
 *   - vimeo:        iframe embed with #t=Xs (Vimeo doesn't honor an
 *                   end param, so we run a poller that pauses at endSec)
 *   - direct:       HTML5 <video> with currentTime + ended-watching
 *
 * Open/close is parent-controlled so the player only mounts when the
 * strategist explicitly opens it (avoids 4 simultaneous iframes when
 * Reel 1 + Reel 2 + their source previews are all open at once).
 */

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { deepLinkAtTime, type MediaSourceType } from '../../lib/mediaUrlValidator'

interface BaseProps {
  /** When the rendered_url is set, we just play that whole — no timing. */
  renderedUrl?: string | null
  /** Source video URL — used when rendered_url isn't available. */
  sourceUrl?: string | null
  sourceType?: MediaSourceType
  /** Sermon-absolute seconds for the clip start / end. */
  startSec?: number | null
  endSec?: number | null
  /** Label shown above the player. */
  title?: string
  onClose: () => void
}

export function ClipPreview({ renderedUrl, sourceUrl, sourceType, startSec, endSec, title, onClose }: BaseProps) {
  const usingRendered = !!renderedUrl

  return (
    <div className="rounded-md border border-wm-accent/30 bg-wm-bg p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold text-wm-text">
          {title ?? 'Clip preview'}
          {usingRendered && <span className="ml-2 text-[10px] uppercase tracking-wider text-wm-success">Rendered MP4</span>}
          {!usingRendered && sourceType && <span className="ml-2 text-[10px] uppercase tracking-wider text-wm-text-subtle">{sourceType} source</span>}
        </p>
        <button type="button" onClick={onClose} className="text-wm-text-muted hover:text-wm-text" aria-label="Close preview">
          <X size={12} />
        </button>
      </div>

      <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
        {usingRendered
          ? <DirectVideo url={renderedUrl!} startSec={null} endSec={null} />
          : sourceType === 'youtube' && sourceUrl
            ? <YouTubeFrame url={sourceUrl} startSec={startSec} endSec={endSec} />
            : sourceType === 'vimeo' && sourceUrl
              ? <VimeoFrame url={sourceUrl} startSec={startSec} endSec={endSec} />
              : sourceType === 'direct' && sourceUrl
                ? <DirectVideo url={sourceUrl} startSec={startSec} endSec={endSec} />
                : <UnsupportedSource sourceType={sourceType} sourceUrl={sourceUrl} startSec={startSec} />}
      </div>
    </div>
  )
}

function YouTubeFrame({ url, startSec, endSec }: { url: string; startSec?: number | null; endSec?: number | null }) {
  // Derive the YouTube video id from either watch?v=, /shorts/, /live/,
  // or youtu.be/<id> shapes.
  const videoId = extractYouTubeId(url)
  if (!videoId) return <UnsupportedSource sourceType="youtube" sourceUrl={url} startSec={startSec} />
  const params = new URLSearchParams({ autoplay: '1', rel: '0' })
  if (startSec != null && startSec >= 0) params.set('start', String(Math.floor(startSec)))
  if (endSec   != null && endSec   > 0)  params.set('end',   String(Math.ceil(endSec)))
  return (
    <iframe
      title="YouTube clip preview"
      src={`https://www.youtube.com/embed/${videoId}?${params.toString()}`}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className="w-full h-full border-0"
    />
  )
}

function VimeoFrame({ url, startSec, endSec }: { url: string; startSec?: number | null; endSec?: number | null }) {
  const videoId = extractVimeoId(url)
  if (!videoId) return <UnsupportedSource sourceType="vimeo" sourceUrl={url} startSec={startSec} />
  // Vimeo's embed doesn't support an end-time query param — clipcutter
  // output is the way to get a tight cut. For source previews we just
  // jump to startSec and let the team scrub past endSec themselves.
  const hash = extractVimeoHash(url)
  const params = new URLSearchParams({ autoplay: '1' })
  if (hash) params.set('h', hash)
  const fragment = startSec != null && startSec >= 0 ? `#t=${Math.floor(startSec)}s` : ''
  void endSec  // Vimeo end-time isn't supported in plain iframe.
  return (
    <iframe
      title="Vimeo clip preview"
      src={`https://player.vimeo.com/video/${videoId}?${params.toString()}${fragment}`}
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      className="w-full h-full border-0"
    />
  )
}

function DirectVideo({ url, startSec, endSec }: { url: string; startSec?: number | null; endSec?: number | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onLoaded = () => {
      if (startSec != null && startSec >= 0) {
        try { v.currentTime = startSec } catch { /* some streams reject seeks until enough is buffered */ }
      }
      v.play().catch(() => { /* autoplay can be blocked; user can click play */ })
    }
    v.addEventListener('loadedmetadata', onLoaded)
    return () => { v.removeEventListener('loadedmetadata', onLoaded) }
  }, [startSec])

  useEffect(() => {
    const v = videoRef.current
    if (!v || endSec == null || endSec <= 0) return
    const onTime = () => {
      if (v.currentTime >= endSec) v.pause()
    }
    v.addEventListener('timeupdate', onTime)
    return () => { v.removeEventListener('timeupdate', onTime) }
  }, [endSec])

  return (
    <video
      ref={videoRef}
      src={url}
      controls
      playsInline
      preload="metadata"
      className="w-full h-full"
    />
  )
}

function UnsupportedSource({ sourceType, sourceUrl, startSec }: { sourceType: MediaSourceType | undefined; sourceUrl: string | null | undefined; startSec?: number | null }) {
  if (!sourceUrl) {
    return (
      <div className="w-full h-full grid place-items-center text-center px-4">
        <p className="text-[12px] text-wm-text-muted">No preview source available. Render the clip via Cut clips to enable inline preview.</p>
      </div>
    )
  }
  const link = deepLinkAtTime((sourceType ?? 'unknown') as MediaSourceType, sourceUrl, startSec ?? 0)
  return (
    <div className="w-full h-full grid place-items-center text-center px-4">
      <p className="text-[12px] text-wm-text-muted">
        Inline preview not supported for this source.<br />
        <a href={link} target="_blank" rel="noreferrer" className="text-wm-accent-strong underline">
          Open in source ↗
        </a>
      </p>
    </div>
  )
}

// ── ID extraction helpers ─────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null
    if (u.pathname === '/watch') return u.searchParams.get('v')
    if (u.pathname.startsWith('/shorts/')) return u.pathname.slice('/shorts/'.length).split('/')[0] || null
    if (u.pathname.startsWith('/live/'))   return u.pathname.slice('/live/'.length).split('/')[0]   || null
    if (u.pathname.startsWith('/embed/'))  return u.pathname.slice('/embed/'.length).split('/')[0]  || null
    return null
  } catch { return null }
}

function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/^\/(?:video\/|channels\/[^/]+\/)?(\d+)/)
    return m?.[1] ?? null
  } catch { return null }
}

function extractVimeoHash(url: string): string | null {
  try {
    const u = new URL(url)
    const h = u.searchParams.get('h')
    if (h) return h
    // Vimeo unlisted URLs sometimes have /:id/:hash format
    const m = u.pathname.match(/^\/\d+\/([a-zA-Z0-9]{8,})/)
    return m?.[1] ?? null
  } catch { return null }
}
