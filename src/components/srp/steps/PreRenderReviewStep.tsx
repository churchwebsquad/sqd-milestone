/**
 * Pre-render review step — comes after all copy deliverables.
 *
 * For each selected clip: side-by-side video player (left) and editable
 * transcript segment list (right). The video uses the real YouTube IFrame
 * Player API so seeks don't reload the iframe. Active segment is highlighted
 * and shown as a caption overlay on the video.
 *
 * Coach can:
 *   - Click a segment's timestamp to seek the video to that point
 *   - Click segment text to edit it inline
 *   - Edit start/end timestamps
 *   - Add new segments
 *   - Delete segments
 *
 * Edited segments are saved back to clip_selections.transcript_segments so
 * the clipcutter picks up the corrected data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, Plus, Trash2, ChevronDown, ChevronRight, GripVertical, Image } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import type { SrpClipSelection } from '../../../types/database'
import { useProcessedClips } from '../../../hooks/useProcessedClips'

// ── YouTube IFrame API loader (singleton) ─────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
}

let _ytLoading = false
let _ytReady   = false
const _ytCallbacks: (() => void)[] = []

function loadYouTubeApi(): Promise<void> {
  return new Promise(resolve => {
    if (_ytReady) { resolve(); return }
    _ytCallbacks.push(resolve)
    if (!_ytLoading) {
      _ytLoading = true
      window.onYouTubeIframeAPIReady = () => {
        _ytReady = true
        _ytCallbacks.forEach(cb => cb())
        _ytCallbacks.length = 0
      }
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
  })
}

// ── Source-type helpers ───────────────────────────────────────────────────────

type SourceType = 'youtube' | 'dropbox' | 'vimeo' | 'google_drive' | 'direct' | 'unknown' | null

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|live\/|shorts\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  return m ? m[1] : null
}

function resolveType(url: string, stored: SourceType): SourceType {
  if (stored && stored !== 'unknown') return stored
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube'
  if (/vimeo\.com/.test(url))             return 'vimeo'
  if (/dropbox\.com/.test(url))           return 'direct'
  if (/drive\.google\.com/.test(url))     return 'google_drive'
  if (/\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(url)) return 'direct'
  return 'unknown'
}

function toDirectUrl(url: string): string {
  if (url.includes('dropbox.com')) {
    return url
      .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
      .replace(/[?&]dl=\d/, '')
  }
  return url
}

// ── Smart video player ────────────────────────────────────────────────────────

interface SmartVideoPlayerProps {
  url:          string
  sourceType:   SourceType
  clipStart:    number
  clipEnd:      number
  seekRef:      React.MutableRefObject<((t: number) => void) | null>
  onTimeUpdate: (t: number) => void
}

let _playerSeq = 0

function SmartVideoPlayer({ url, sourceType, clipStart, clipEnd, seekRef, onTimeUpdate }: SmartVideoPlayerProps) {
  const type       = resolveType(url, sourceType)
  const playerIdRef = useRef(`yt-player-${++_playerSeq}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ytRef      = useRef<any>(null)
  const videoRef   = useRef<HTMLVideoElement>(null)
  const iframeRef  = useRef<HTMLIFrameElement>(null)

  // ── YouTube: create real YT.Player ─────────────────────────────────────────
  useEffect(() => {
    if (type !== 'youtube') return
    const videoId = getYouTubeId(url)
    if (!videoId) return

    let destroyed = false
    loadYouTubeApi().then(() => {
      if (destroyed) return
      ytRef.current = new window.YT.Player(playerIdRef.current, {
        videoId,
        playerVars: { start: Math.floor(clipStart), autoplay: 0, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e: { target: { cueVideoById: (opts: { videoId: string; startSeconds: number }) => void } }) => {
            e.target.cueVideoById({ videoId, startSeconds: clipStart })
          },
        },
      })
    })

    return () => {
      destroyed = true
      ytRef.current?.destroy?.()
      ytRef.current = null
    }
  // Only recreate player when the video URL changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // ── YouTube: wire seekRef ───────────────────────────────────────────────────
  useEffect(() => {
    if (type !== 'youtube') return
    seekRef.current = (t: number) => {
      ytRef.current?.seekTo?.(t, true)
      ytRef.current?.playVideo?.()
    }
  }, [type, seekRef])

  // ── YouTube: poll getCurrentTime for highlighting, caption overlay, clip end ─
  useEffect(() => {
    if (type !== 'youtube') return
    const id = setInterval(() => {
      const t = ytRef.current?.getCurrentTime?.()
      if (typeof t !== 'number') return
      onTimeUpdate(t)
      if (clipEnd > 0 && t >= clipEnd) {
        ytRef.current?.pauseVideo?.()
        ytRef.current?.seekTo?.(clipEnd, true)
      }
    }, 250)
    return () => clearInterval(id)
  }, [type, clipEnd, onTimeUpdate])

  // ── Vimeo: wire seekRef ─────────────────────────────────────────────────────
  useEffect(() => {
    if (type !== 'vimeo') return
    seekRef.current = (t: number) => {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'setCurrentTime', value: t }), '*')
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'play' }), '*')
    }
  }, [type, seekRef])

  // ── Direct/native video: wire seekRef + timeupdate ─────────────────────────
  useEffect(() => {
    if (type !== 'direct' && type !== 'unknown') return
    seekRef.current = (t: number) => {
      if (!videoRef.current) return
      videoRef.current.currentTime = t
      videoRef.current.play().catch(() => { /* needs user gesture */ })
    }
  }, [type, seekRef])

  useEffect(() => {
    if ((type === 'direct' || type === 'unknown') && videoRef.current && clipStart > 0) {
      videoRef.current.currentTime = clipStart
    }
  }, [type, clipStart])

  if (!url) {
    return (
      <div className="aspect-video rounded-lg bg-[var(--color-lavender-tint)] flex items-center justify-center">
        <p className="text-[12px] text-[var(--color-purple-gray)]">No video for this session</p>
      </div>
    )
  }

  if (type === 'youtube') {
    // The YT API replaces this div with the iframe
    return <div id={playerIdRef.current} className="w-full aspect-video rounded-lg bg-black" />
  }

  if (type === 'vimeo') {
    const videoId = getVimeoId(url)
    if (!videoId) return <p className="text-[12px] text-red-500">Could not parse Vimeo URL</p>
    return (
      <iframe
        ref={iframeRef}
        src={`https://player.vimeo.com/video/${videoId}?api=1#t=${Math.floor(clipStart)}s`}
        className="w-full rounded-lg aspect-video bg-black"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    )
  }

  if (type === 'google_drive') {
    return (
      <div className="aspect-video rounded-lg bg-[var(--color-lavender-tint)] flex flex-col items-center justify-center gap-3 p-4">
        <p className="text-[12px] font-medium text-[var(--color-deep-plum)] text-center">
          Google Drive videos can't be embedded here.
        </p>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--color-primary-purple)] text-white text-[12px] font-semibold hover:bg-[var(--color-deep-plum)] transition-colors">
          Open video in new tab →
        </a>
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      src={toDirectUrl(url)}
      controls
      playsInline
      className="w-full rounded-lg bg-black aspect-video"
      onTimeUpdate={e => onTimeUpdate(e.currentTarget.currentTime)}
    />
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Segment {
  id:       string
  start:    number
  end:      number
  text:     string
  type?:    'text' | 'title_card'
  imageUrl?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTime(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const parts = val.split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return Number(val) || 0
  }
  return 0
}

function toMMSS(secs: number): string {
  const m = Math.floor(Math.max(0, secs) / 60)
  const s = Math.floor(Math.max(0, secs) % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseMMSS(str: string): number {
  const parts = str.trim().split(':').map(Number)
  if (parts.some(isNaN)) return NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return NaN
}

function buildSegmentsFromWords(
  words: { start: number; end: number; text: string }[],
  clipStart: number,
  clipEnd: number,
): Segment[] {
  const inRange = words.filter(w => w.start >= clipStart - 0.1 && w.end <= clipEnd + 0.1)
  if (inRange.length === 0) return []

  const lines: Segment[] = []
  let lineWords: typeof inRange = []

  for (let i = 0; i < inRange.length; i++) {
    const w    = inRange[i]
    const prev = inRange[i - 1]
    const gap  = prev ? w.start - prev.end : 0
    if (lineWords.length > 0 && (gap > 1 || lineWords.length >= 10)) {
      lines.push({
        id:    crypto.randomUUID(),
        start: lineWords[0].start,
        end:   lineWords[lineWords.length - 1].end,
        text:  lineWords.map(x => x.text).join(' '),
      })
      lineWords = []
    }
    lineWords.push(w)
  }
  if (lineWords.length > 0) {
    lines.push({
      id:    crypto.randomUUID(),
      start: lineWords[0].start,
      end:   lineWords[lineWords.length - 1].end,
      text:  lineWords.map(x => x.text).join(' '),
    })
  }
  return lines
}

// ── Segment row ───────────────────────────────────────────────────────────────

interface SegmentRowProps {
  idx:      number
  seg:      Segment
  isActive: boolean
  onSeek:   (t: number) => void
  onChange: (updated: Segment) => void
  onDelete: () => void
  onAdd:    () => void
}

function SegmentRow({ idx, seg, isActive, onSeek, onChange, onDelete, onAdd }: SegmentRowProps) {
  const [editing,   setEditing]   = useState(false)
  const [textDraft, setTextDraft] = useState(seg.text)

  // Keep draft in sync if parent updates (e.g. re-derive from words)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTextDraft(seg.text) }, [seg.text])

  function commitText() {
    setEditing(false)
    if (textDraft !== seg.text) onChange({ ...seg, text: textDraft })
  }

  const activeClass = isActive
    ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
    : 'border-[var(--color-lavender)] bg-white hover:border-[var(--color-primary-purple)]/40'

  return (
    <li className={`group rounded-lg border transition-colors ${activeClass}`}>
      {/* Top row: grip + index + timestamps (clickable) + actions */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <GripVertical size={13} className="shrink-0 text-[var(--color-lavender)] group-hover:text-[var(--color-purple-gray)] cursor-grab" />
        <span className="shrink-0 w-5 text-center text-[10px] font-bold text-[var(--color-purple-gray)]">
          {idx + 1}
        </span>

        {/* Clickable timestamps — click to seek */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            title="Seek to start"
            onClick={() => onSeek(seg.start)}
            className="font-mono text-[12px] text-[var(--color-primary-purple)] hover:underline focus:outline-none"
          >
            {toMMSS(seg.start)}
          </button>
          <span className="text-[10px] text-[var(--color-purple-gray)]">→</span>
          <button
            type="button"
            title="Seek to end"
            onClick={() => onSeek(seg.end)}
            className="font-mono text-[12px] text-[var(--color-primary-purple)] hover:underline focus:outline-none"
          >
            {toMMSS(seg.end)}
          </button>
        </div>

        {/* Editable timestamp inputs — small, on hover */}
        <div className="hidden group-focus-within:flex items-center gap-1 ml-1">
          <input
            type="text"
            defaultValue={toMMSS(seg.start)}
            onBlur={e => { const v = parseMMSS(e.target.value); if (!isNaN(v)) onChange({ ...seg, start: v }) }}
            className="w-12 rounded border border-[var(--color-lavender)] px-1.5 py-0.5 text-[11px] font-mono text-center text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
          />
          <span className="text-[9px] text-[var(--color-purple-gray)]">→</span>
          <input
            type="text"
            defaultValue={toMMSS(seg.end)}
            onBlur={e => { const v = parseMMSS(e.target.value); if (!isNaN(v)) onChange({ ...seg, end: v }) }}
            className="w-12 rounded border border-[var(--color-lavender)] px-1.5 py-0.5 text-[11px] font-mono text-center text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
          />
        </div>

        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={onDelete} title="Delete segment"
            className="p-1.5 rounded text-[var(--color-purple-gray)] hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={12} />
          </button>
          <button type="button" onClick={onAdd} title="Add segment after"
            className="p-1.5 rounded text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] hover:bg-[var(--color-lavender-tint)] transition-colors">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Text — click to edit */}
      <div className="px-3 pb-2.5">
        {editing ? (
          <textarea
            autoFocus
            value={textDraft}
            onChange={e => setTextDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={e => { if (e.key === 'Escape') { setTextDraft(seg.text); setEditing(false) } }}
            rows={2}
            className="w-full rounded border border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] px-3 py-2 text-[13px] leading-snug text-[var(--color-deep-plum)] focus:outline-none resize-none"
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setEditing(true) }}
            className="cursor-text rounded border border-transparent hover:border-[var(--color-lavender)] px-3 py-2 text-[13px] leading-snug text-[var(--color-deep-plum)] transition-colors min-h-[40px]"
          >
            {textDraft
              ? textDraft
              : <span className="italic text-[var(--color-purple-gray)]">Click to edit…</span>
            }
          </div>
        )}
      </div>
    </li>
  )
}

// ── Title card row ────────────────────────────────────────────────────────────

interface TitleCardRowProps {
  idx:      number
  seg:      Segment
  onSeek:   (t: number) => void
  onChange: (updated: Segment) => void
  onDelete: () => void
  onAdd:    () => void
}

function TitleCardRow({ idx, seg, onSeek, onChange, onDelete, onAdd }: TitleCardRowProps) {
  const [urlDraft, setUrlDraft] = useState(seg.imageUrl ?? '')

  function commitUrl() {
    if (urlDraft !== seg.imageUrl) onChange({ ...seg, imageUrl: urlDraft })
  }

  return (
    <li className="group rounded-lg border-2 border-[var(--color-primary-purple)]/40 bg-[var(--color-lavender-tint)]">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <GripVertical size={13} className="shrink-0 text-[var(--color-lavender)] cursor-grab" />
        <span className="shrink-0 w-5 text-center text-[10px] font-bold text-[var(--color-purple-gray)]">
          {idx + 1}
        </span>

        {/* Timestamp chips */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" title="Seek to start" onClick={() => onSeek(seg.start)}
            className="font-mono text-[12px] text-[var(--color-primary-purple)] hover:underline focus:outline-none">
            {toMMSS(seg.start)}
          </button>
          <span className="text-[10px] text-[var(--color-purple-gray)]">→</span>
          <button type="button" title="Seek to end" onClick={() => onSeek(seg.end)}
            className="font-mono text-[12px] text-[var(--color-primary-purple)] hover:underline focus:outline-none">
            {toMMSS(seg.end)}
          </button>
        </div>

        {/* Editable timestamps on focus */}
        <div className="hidden group-focus-within:flex items-center gap-1 ml-1">
          <input type="text" defaultValue={toMMSS(seg.start)}
            onBlur={e => { const v = parseMMSS(e.target.value); if (!isNaN(v)) onChange({ ...seg, start: v }) }}
            className="w-12 rounded border border-[var(--color-lavender)] px-1.5 py-0.5 text-[11px] font-mono text-center text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
          />
          <span className="text-[9px] text-[var(--color-purple-gray)]">→</span>
          <input type="text" defaultValue={toMMSS(seg.end)}
            onBlur={e => { const v = parseMMSS(e.target.value); if (!isNaN(v)) onChange({ ...seg, end: v }) }}
            className="w-12 rounded border border-[var(--color-lavender)] px-1.5 py-0.5 text-[11px] font-mono text-center text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
          />
        </div>

        <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-primary-purple)] text-white text-[10px] font-bold uppercase tracking-widest shrink-0">
          <Image size={9} /> Title Card
        </span>

        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={onDelete} title="Delete title card"
            className="p-1.5 rounded text-[var(--color-purple-gray)] hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={12} />
          </button>
          <button type="button" onClick={onAdd} title="Add segment after"
            className="p-1.5 rounded text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] hover:bg-white transition-colors">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Image URL + preview */}
      <div className="px-3 pb-3 flex gap-3 items-start">
        <div className="flex-1">
          <input
            type="url"
            value={urlDraft}
            onChange={e => setUrlDraft(e.target.value)}
            onBlur={commitUrl}
            placeholder="Paste PNG URL (Dropbox, Wasabi, etc.)"
            className="w-full rounded border border-[var(--color-lavender)] bg-white px-3 py-2 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)]"
          />
          <p className="mt-1 text-[10px] text-[var(--color-purple-gray)]">
            This PNG overlays the video at the timestamps above. Must be a direct public link.
          </p>
        </div>
        {urlDraft && (
          <img
            src={urlDraft}
            alt="Title card preview"
            className="w-16 h-16 rounded object-contain border border-[var(--color-lavender)] bg-white shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>
    </li>
  )
}

// ── Per-clip panel ────────────────────────────────────────────────────────────

interface ClipPanelProps {
  idx:        number
  clip:       SrpClipSelection
  words:      { start: number; end: number; text: string }[]
  videoUrl:   string | null
  sourceType: SourceType
  onChange:   (updated: SrpClipSelection) => void
}

function ClipPanel({ idx, clip, words, videoUrl, sourceType, onChange }: ClipPanelProps) {
  const [open, setOpen]           = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const seekRef = useRef<((t: number) => void) | null>(null)

  const clipStart = useMemo(() => parseTime(clip.startTime), [clip.startTime])
  const clipEnd   = useMemo(() => parseTime(clip.endTime),   [clip.endTime])
  const duration  = clipEnd - clipStart

  const [segments, setSegs] = useState<Segment[]>(() => {
    const saved = clip.transcript_segments
    if (saved && saved.length > 0 && saved.some(s => s.text.trim().length > 0 || s.type === 'title_card')) {
      return saved.map(s => ({ ...s, id: crypto.randomUUID() }))
    }
    return buildSegmentsFromWords(words, clipStart, clipEnd)
  })

  const saveSegments = useCallback((next: Segment[]) => {
    setSegs(next)
    onChange({
      ...clip,
      transcript_segments: next.map(({ start, end, text, type, imageUrl }) => ({
        start, end, text,
        ...(type === 'title_card' ? { type, imageUrl: imageUrl ?? '' } : {}),
      })),
    })
  }, [clip, onChange])

  const seekTo = useCallback((t: number) => {
    seekRef.current?.(t)
  }, [])

  function updateSeg(i: number, updated: Segment) {
    saveSegments(segments.map((s, si) => si === i ? updated : s))
  }
  function deleteSeg(i: number) {
    saveSegments(segments.filter((_, si) => si !== i))
  }
  function addSegAfter(i: number) {
    const prev = segments[i]
    const next = segments[i + 1]
    const newStart = prev ? prev.end : clipStart
    const newEnd   = next ? next.start : Math.min(newStart + 2, clipEnd)
    const blank: Segment = { id: crypto.randomUUID(), start: newStart, end: newEnd, text: '' }
    const updated = [...segments]
    updated.splice(i + 1, 0, blank)
    saveSegments(updated)
  }
  function addSegAtStart() {
    const blank: Segment = { id: crypto.randomUUID(), start: clipStart, end: clipStart + 2, text: '' }
    saveSegments([blank, ...segments])
  }
  function addTitleCardAtStart() {
    const card: Segment = { id: crypto.randomUUID(), start: clipStart, end: clipStart + 3, text: '', type: 'title_card', imageUrl: '' }
    saveSegments([card, ...segments])
  }

  // Active segment for highlighting + caption overlay
  const activeSegIdx = segments.findIndex(s => currentTime >= s.start - 0.1 && currentTime <= s.end + 0.1)
  const activeSeg    = activeSegIdx >= 0 ? segments[activeSegIdx] : null

  return (
    <div className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--color-lavender-tint)] transition-colors text-left"
      >
        {open
          ? <ChevronDown  size={14} className="shrink-0 text-[var(--color-purple-gray)]" />
          : <ChevronRight size={14} className="shrink-0 text-[var(--color-purple-gray)]" />
        }
        <span className="text-[13px] font-semibold text-[var(--color-deep-plum)]">
          Clip {idx + 1}{clip.clip_title ? ` — ${clip.clip_title}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-[var(--color-purple-gray)]">
          {segments.length > 0 && (
            <span className="text-[var(--color-primary-purple)] font-semibold">{segments.length} segments</span>
          )}
          {clip.startTime && (
            <span className="font-mono">
              {clip.startTime} → {clip.endTime}
              {duration > 0 && <span className="ml-1 text-[var(--color-primary-purple)]">({Math.round(duration)}s)</span>}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-lavender)]">
          {/* Side-by-side: video left, segments right */}
          <div className="flex flex-col lg:flex-row">

            {/* ── Video column ─────────────────────────────────────────────── */}
            <div className="lg:w-[42%] shrink-0 p-3 lg:border-r border-b lg:border-b-0 border-[var(--color-lavender)]">
              <div className="sticky top-2">
                {/* Video + caption overlay */}
                <div className="relative rounded-lg overflow-hidden bg-black">
                  <SmartVideoPlayer
                    url={videoUrl ?? ''}
                    sourceType={sourceType}
                    clipStart={clipStart}
                    clipEnd={clipEnd}
                    seekRef={seekRef}
                    onTimeUpdate={setCurrentTime}
                  />
                  {/* Caption / title card overlay */}
                  {activeSeg && activeSeg.type === 'title_card' && activeSeg.imageUrl && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <img src={activeSeg.imageUrl} alt="Title card" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                  {activeSeg && activeSeg.type !== 'title_card' && activeSeg.text && (
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center px-4 pointer-events-none">
                      <p className="bg-black/75 text-white text-[13px] font-medium px-3 py-1.5 rounded-lg text-center leading-snug max-w-[90%]">
                        {activeSeg.text}
                      </p>
                    </div>
                  )}
                </div>
                {/* Current time indicator */}
                <p className="mt-1.5 text-center text-[10px] text-[var(--color-purple-gray)] font-mono">
                  {toMMSS(currentTime)}
                  {activeSeg && (
                    <span className="ml-2 text-[var(--color-primary-purple)]">
                      — segment {activeSegIdx + 1}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* ── Segments column ──────────────────────────────────────────── */}
            <div className="flex-1 p-4 flex flex-col gap-3 overflow-y-auto max-h-[520px]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                  Transcript segments
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={addTitleCardAtStart}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-primary-purple)] hover:underline"
                  >
                    <Image size={12} /> Add title card
                  </button>
                  <button
                    type="button"
                    onClick={addSegAtStart}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-primary-purple)] hover:underline"
                  >
                    <Plus size={12} /> Add segment
                  </button>
                </div>
              </div>

              {segments.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] py-8 text-center space-y-2">
                  <p className="text-[12px] text-[var(--color-purple-gray)]">
                    {clip.startTime
                      ? 'No transcript segments found for this clip range.'
                      : "This clip has no timestamps — segments can't be auto-derived."}
                  </p>
                  <button
                    type="button"
                    onClick={addSegAtStart}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-primary-purple)] text-white text-[11px] font-semibold hover:bg-[var(--color-deep-plum)] transition-colors"
                  >
                    <Plus size={12} /> Add first segment manually
                  </button>
                </div>
              ) : (
                <ol className="space-y-2">
                  {segments.map((seg, i) => (
                    seg.type === 'title_card'
                      ? <TitleCardRow
                          key={seg.id}
                          idx={i}
                          seg={seg}
                          onSeek={seekTo}
                          onChange={updated => updateSeg(i, updated)}
                          onDelete={() => deleteSeg(i)}
                          onAdd={() => addSegAfter(i)}
                        />
                      : <SegmentRow
                          key={seg.id}
                          idx={i}
                          seg={seg}
                          isActive={i === activeSegIdx}
                          onSeek={seekTo}
                          onChange={updated => updateSeg(i, updated)}
                          onDelete={() => deleteSeg(i)}
                          onAdd={() => addSegAfter(i)}
                        />
                  ))}
                </ol>
              )}

              {segments.length > 0 && (
                <button
                  type="button"
                  onClick={() => addSegAfter(segments.length - 1)}
                  className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold text-[var(--color-primary-purple)] hover:underline"
                >
                  <Plus size={12} /> Add segment at end
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main step ─────────────────────────────────────────────────────────────────

export function PreRenderReviewStep() {
  const {
    clipSelections, setClipSelections,
    transcriptWords,
    videoUrl,
    videoSourceType,
    sessionId,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const { clips: processedClips } = useProcessedClips(sessionId)

  const words = useMemo(() => {
    if (!Array.isArray(transcriptWords)) return []
    return (transcriptWords as unknown[]).map((w: unknown) => {
      const obj = w as Record<string, unknown>
      const wordText = typeof obj.word === 'string' ? obj.word
        : typeof obj.text === 'string' ? obj.text
        : String(obj.word ?? obj.text ?? '')
      return {
        start: parseTime(obj.start),
        end:   parseTime(obj.end),
        text:  wordText,
      }
    })
  }, [transcriptWords])

  function updateClip(idx: number, updated: SrpClipSelection) {
    setClipSelections(clipSelections.map((c, i) => i === idx ? updated : c) as typeof clipSelections)
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-primary-purple)] flex items-center gap-1.5">
          <Film size={12} /> Pre-render review
        </p>
        <h2 className="text-[22px] font-bold text-[var(--color-deep-plum)] mt-0.5">
          Review &amp; edit clip transcripts
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          Click any timestamp to seek the video. Click segment text to edit it. The active segment highlights as the video plays and appears as a caption overlay.
        </p>
      </div>

      {clipSelections.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-5 py-10 text-center">
          <p className="text-[13px] text-[var(--color-purple-gray)]">No clips selected — go back to Clip selection.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clipSelections.map((clip, idx) => {
            const clipId = (clip as SrpClipSelection & { clip_id?: string }).clip_id ?? ''
            const pc = clipId ? processedClips[clipId] : undefined
            const useRendered = pc?.status === 'ready' && !!pc.video_url
            return (
              <ClipPanel
                key={(clip as SrpClipSelection & { id?: string }).id ?? idx}
                idx={idx}
                clip={clip as SrpClipSelection}
                words={words}
                videoUrl={useRendered ? pc.video_url! : videoUrl}
                sourceType={useRendered ? 'direct' : videoSourceType as SourceType}
                onChange={updated => updateClip(idx, updated)}
              />
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={goToPrevStep}
          className="px-4 py-2 rounded-full text-[12px] font-medium text-[var(--color-deep-plum)] border border-[var(--color-lavender)] hover:bg-[var(--color-lavender-tint)] transition-colors"
        >
          ← Back
        </button>
        <SrpButton onClick={goToNextStep}>
          Continue to Creative direction →
        </SrpButton>
      </div>
    </div>
  )
}
