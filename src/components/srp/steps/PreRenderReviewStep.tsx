/**
 * Pre-render review step — comes after all copy deliverables.
 *
 * For each selected clip: shows the sermon video seeked to the clip's start
 * time alongside a fully editable transcript segment list. Coach can:
 *   - Edit any segment's text
 *   - Edit any segment's start / end timestamp
 *   - Add new segments
 *   - Delete segments
 *
 * Edited segments are saved back to clip_selections.transcript_segments so
 * the clipcutter picks up the corrected data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import type { SrpClipSelection } from '../../../types/database'

// ── Smart video player ────────────────────────────────────────────────────────

type SourceType = 'youtube' | 'dropbox' | 'vimeo' | 'google_drive' | 'direct' | 'unknown' | null

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  return m ? m[1] : null
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
}

interface SmartVideoPlayerProps {
  url:        string
  sourceType: SourceType
  seekRef:    React.MutableRefObject<((t: number) => void) | null>
}

function SmartVideoPlayer({ url, sourceType, seekRef }: SmartVideoPlayerProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const iframeRef   = useRef<HTMLIFrameElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ytPlayerRef = useRef<any>(null)

  // Resolve type — trust stored sourceType, fall back to URL sniffing
  const type: SourceType = sourceType
    ?? (/youtube\.com|youtu\.be/.test(url) ? 'youtube'
      : /vimeo\.com/.test(url) ? 'vimeo'
      : /\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(url) ? 'direct'
      : 'unknown')

  // Wire direct-video seek
  useEffect(() => {
    if (type !== 'direct' && type !== 'unknown') return
    seekRef.current = (t: number) => {
      if (!videoRef.current) return
      videoRef.current.currentTime = t
      videoRef.current.play().catch(() => {/* blocked without user gesture */})
    }
  }, [type, seekRef])

  // Wire YouTube seek via iframe API
  useEffect(() => {
    if (type !== 'youtube') return
    const videoId = getYouTubeId(url)
    if (!videoId) return

    function initPlayer() {
      if (!iframeRef.current) return
      ytPlayerRef.current = new window.YT.Player(iframeRef.current, {
        events: {
          onReady: () => {
            seekRef.current = (t: number) => {
              ytPlayerRef.current?.seekTo(t, true)
              ytPlayerRef.current?.playVideo()
            }
          },
        },
      })
    }

    if (window.YT?.Player) {
      initPlayer()
    } else {
      if (!document.getElementById('yt-api-script')) {
        const script   = document.createElement('script')
        script.id      = 'yt-api-script'
        script.src     = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(script)
      }
      window.onYouTubeIframeAPIReady = initPlayer
    }
    return () => { ytPlayerRef.current = null }
  }, [type, url, seekRef])

  // Wire Vimeo seek via postMessage
  useEffect(() => {
    if (type !== 'vimeo') return
    seekRef.current = (t: number) => {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'setCurrentTime', value: t }), '*')
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'play' }), '*')
    }
  }, [type, seekRef])

  if (!url) {
    return (
      <div className="aspect-video rounded-lg bg-[var(--color-lavender-tint)] flex items-center justify-center">
        <p className="text-[12px] text-[var(--color-purple-gray)]">No video for this session</p>
      </div>
    )
  }

  if (type === 'youtube') {
    const videoId = getYouTubeId(url)
    if (!videoId) return <p className="text-[12px] text-red-500">Could not parse YouTube URL</p>
    return (
      <iframe
        ref={iframeRef}
        src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
        className="w-full rounded-lg aspect-video bg-black"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    )
  }

  if (type === 'vimeo') {
    const videoId = getVimeoId(url)
    if (!videoId) return <p className="text-[12px] text-red-500">Could not parse Vimeo URL</p>
    return (
      <iframe
        ref={iframeRef}
        src={`https://player.vimeo.com/video/${videoId}?api=1`}
        className="w-full rounded-lg aspect-video bg-black"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    )
  }

  // Dropbox / Google Drive — can't embed, show a link to open externally
  if (type === 'dropbox' || type === 'google_drive') {
    return (
      <div className="aspect-video rounded-lg bg-[var(--color-lavender-tint)] flex flex-col items-center justify-center gap-3 p-4">
        <p className="text-[12px] font-medium text-[var(--color-deep-plum)] text-center">
          {type === 'dropbox' ? 'Dropbox' : 'Google Drive'} videos can't be embedded here.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--color-primary-purple)] text-white text-[12px] font-semibold hover:bg-[var(--color-deep-plum)] transition-colors"
        >
          Open video in new tab →
        </a>
        <p className="text-[10px] text-[var(--color-purple-gray)] text-center">
          Note timestamps as you watch, then enter them in the segments on the right.
        </p>
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      src={url}
      controls
      playsInline
      className="w-full rounded-lg bg-black aspect-video"
    />
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Segment {
  id:    string   // local-only key for React
  start: number
  end:   number
  text:  string
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

/** Parse a user-typed "M:SS" or "H:MM:SS" string into seconds. Returns NaN if invalid. */
function parseMMSS(str: string): number {
  const parts = str.trim().split(':').map(Number)
  if (parts.some(isNaN)) return NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return NaN
}

/** Group flat word array into display segments for a clip's time range. */
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

// ── Timestamp input ───────────────────────────────────────────────────────────

function TimeInput({
  value,
  onChange,
  label,
}: {
  value:    number
  onChange: (secs: number) => void
  label:    string
}) {
  const [draft, setDraft] = useState(toMMSS(value))
  const [error, setError] = useState(false)

  useEffect(() => { setDraft(toMMSS(value)) }, [value])

  function commit() {
    const parsed = parseMMSS(draft)
    if (isNaN(parsed)) { setError(true); return }
    setError(false)
    onChange(parsed)
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[9px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
        {label}
      </label>
      <input
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value); setError(false) }}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        placeholder="0:00"
        className={[
          'w-16 rounded border px-2 py-1 text-[11px] font-mono text-[var(--color-deep-plum)] focus:outline-none',
          error
            ? 'border-red-400 bg-red-50'
            : 'border-[var(--color-lavender)] bg-white focus:border-[var(--color-primary-purple)]',
        ].join(' ')}
      />
    </div>
  )
}

// ── Single segment row ────────────────────────────────────────────────────────

interface SegmentRowProps {
  idx:      number
  seg:      Segment
  total:    number
  onSeek:   (t: number) => void
  onChange: (updated: Segment) => void
  onDelete: () => void
  onAdd:    () => void
}

function SegmentRow({ idx, seg, onSeek, onChange, onDelete, onAdd }: SegmentRowProps) {
  const [textDraft, setTextDraft] = useState(seg.text)

  function commitText() {
    if (textDraft !== seg.text) onChange({ ...seg, text: textDraft })
  }

  return (
    <li className="group relative rounded-lg border border-[var(--color-lavender)] bg-white hover:border-[var(--color-primary-purple)]/40 transition-colors">
      <div className="flex items-start gap-2 p-3">
        {/* Drag handle (visual only) */}
        <GripVertical size={13} className="mt-1 shrink-0 text-[var(--color-lavender)] group-hover:text-[var(--color-purple-gray)] transition-colors cursor-grab" />

        {/* Index */}
        <span className="mt-1 shrink-0 w-5 text-center text-[10px] font-bold text-[var(--color-purple-gray)]">
          {idx + 1}
        </span>

        {/* Timestamps */}
        <div className="flex items-end gap-2 shrink-0">
          <TimeInput
            label="Start"
            value={seg.start}
            onChange={v => onChange({ ...seg, start: v })}
          />
          <span className="mb-1.5 text-[10px] text-[var(--color-purple-gray)]">→</span>
          <TimeInput
            label="End"
            value={seg.end}
            onChange={v => onChange({ ...seg, end: v })}
          />
          <button
            type="button"
            onClick={() => onSeek(seg.start)}
            title="Seek video to this timestamp"
            className="mb-1 shrink-0 text-[10px] font-semibold text-[var(--color-primary-purple)] hover:underline whitespace-nowrap"
          >
            ▶ Seek
          </button>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <label className="block text-[9px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-0.5">
            Text
          </label>
          <textarea
            value={textDraft}
            onChange={e => setTextDraft(e.target.value)}
            onBlur={commitText}
            rows={2}
            placeholder="Transcript text…"
            className="w-full rounded border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-2 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0 mt-4">
          <button
            type="button"
            onClick={onDelete}
            title="Delete segment"
            className="p-1.5 rounded text-[var(--color-purple-gray)] hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            onClick={onAdd}
            title="Add segment after this one"
            className="p-1.5 rounded text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] hover:bg-[var(--color-lavender-tint)] transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>
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
  const [open, setOpen] = useState(true)
  const seekRef         = useRef<((t: number) => void) | null>(null)

  const clipStart = useMemo(() => parseTime(clip.startTime), [clip.startTime])
  const clipEnd   = useMemo(() => parseTime(clip.endTime),   [clip.endTime])
  const duration  = clipEnd - clipStart

  // Seed segments from saved data or derived words (lazy initializer runs once).
  // Only use saved segments if at least some have non-empty text — otherwise the
  // saved data is stale (written before the word-key bug was fixed) and we should
  // re-derive from the raw word timestamps.
  const [segments, setSegs] = useState<Segment[]>(() => {
    const saved = clip.transcript_segments
    if (saved && saved.length > 0 && saved.some(s => s.text.trim().length > 0)) {
      return saved.map(s => ({ ...s, id: crypto.randomUUID() }))
    }
    return buildSegmentsFromWords(words, clipStart, clipEnd)
  })

  // Save segments back to the clip whenever they change.
  const saveSegments = useCallback((next: Segment[]) => {
    setSegs(next)
    onChange({
      ...clip,
      transcript_segments: next.map(({ start, end, text }) => ({ start, end, text })),
    })
  }, [clip, onChange])

  const seekTo = useCallback((t: number) => {
    if (seekRef.current) {
      seekRef.current(t)
    }
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
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-0">

            {/* Left: video */}
            <div className="p-4 border-b lg:border-b-0 lg:border-r border-[var(--color-lavender)] bg-[var(--color-cream)] flex flex-col gap-2">
              <SmartVideoPlayer url={videoUrl ?? ''} sourceType={sourceType} seekRef={seekRef} />
              {videoUrl && (
                <p className="text-[10px] text-[var(--color-purple-gray)] text-center">
                  Click <strong>▶ Seek</strong> on a segment to jump to that moment
                </p>
              )}
            </div>

            {/* Right: editable transcript */}
            <div className="p-4 flex flex-col gap-3 max-h-[560px] overflow-y-auto">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                  Transcript segments
                </p>
                <button
                  type="button"
                  onClick={addSegAtStart}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-primary-purple)] hover:underline"
                >
                  <Plus size={12} /> Add segment
                </button>
              </div>

              {segments.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] py-8 text-center space-y-2">
                  <p className="text-[12px] text-[var(--color-purple-gray)]">
                    {clip.startTime
                      ? 'No transcript segments found for this clip range.'
                      : 'This clip has no timestamps — segments can\'t be auto-derived.'}
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
                    <SegmentRow
                      key={seg.id}
                      idx={i}
                      seg={seg}
                      total={segments.length}
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
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const words = useMemo(() => {
    if (!Array.isArray(transcriptWords)) return []
    return (transcriptWords as unknown[]).map((w: unknown) => {
      const obj = w as Record<string, unknown>
      // Transcription callback stores `word`; fall back to `text` for any alternate format
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
          Verify each clip's timing in the video. Edit segment text and timestamps, add missing lines, or remove anything that shouldn't be captioned. These segments go straight to the video editor.
        </p>
      </div>

      {clipSelections.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-5 py-10 text-center">
          <p className="text-[13px] text-[var(--color-purple-gray)]">No clips selected — go back to Clip selection.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clipSelections.map((clip, idx) => (
            <ClipPanel
              key={(clip as SrpClipSelection & { id?: string }).id ?? idx}
              idx={idx}
              clip={clip as SrpClipSelection}
              words={words}
              videoUrl={videoUrl}
              sourceType={videoSourceType as SourceType}
              onChange={updated => updateClip(idx, updated)}
            />
          ))}
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
