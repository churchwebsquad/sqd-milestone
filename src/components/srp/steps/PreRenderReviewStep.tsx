/**
 * Pre-render review step — comes after clip selection and all copy deliverables.
 *
 * For each selected clip: shows the sermon video seeked to the clip's start time
 * alongside the transcript segments for that clip's time range. Coach can click
 * a timestamp to seek the video and click any segment text to edit it inline.
 *
 * The video is rendering in the background while the coach works through
 * captions/carousel/facebook. By the time they get here the render may be done.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, ChevronDown, ChevronRight } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import type { SrpClipSelection } from '../../../types/database'

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Word {
  start: number
  end:   number
  text:  string
}

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
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Group flat word array into display segments (lines) by pausing on gaps > 1s. */
function buildSegments(words: Word[], clipStart: number, clipEnd: number) {
  const inRange = words.filter(w => w.start >= clipStart - 0.1 && w.end <= clipEnd + 0.1)
  if (inRange.length === 0) return []

  const lines: { start: number; end: number; text: string }[] = []
  let lineWords: Word[] = []

  for (let i = 0; i < inRange.length; i++) {
    const w = inRange[i]
    const prev = inRange[i - 1]
    const gap = prev ? w.start - prev.end : 0
    if (lineWords.length > 0 && (gap > 1 || lineWords.length >= 10)) {
      lines.push({
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
      start: lineWords[0].start,
      end:   lineWords[lineWords.length - 1].end,
      text:  lineWords.map(x => x.text).join(' '),
    })
  }
  return lines
}

// ── Single clip panel ─────────────────────────────────────────────────────────

interface ClipPanelProps {
  idx:     number
  clip:    SrpClipSelection
  words:   Word[]
  videoUrl: string | null
}

function ClipPanel({ idx, clip, words, videoUrl }: ClipPanelProps) {
  const [open, setOpen]               = useState(true)
  const [editIdx, setEditIdx]         = useState<number | null>(null)
  const [editText, setEditText]       = useState('')
  const [segments, setSegments]       = useState<{ start: number; end: number; text: string }[]>([])
  const videoRef                      = useRef<HTMLVideoElement>(null)

  const clipStart = useMemo(() => parseTime(clip.startTime), [clip.startTime])
  const clipEnd   = useMemo(() => parseTime(clip.endTime),   [clip.endTime])

  useEffect(() => {
    setSegments(buildSegments(words, clipStart, clipEnd))
  }, [words, clipStart, clipEnd])

  // Seek video when panel opens
  useEffect(() => {
    if (open && videoRef.current && clipStart > 0) {
      videoRef.current.currentTime = clipStart
    }
  }, [open, clipStart])

  const seekTo = useCallback((t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t
      videoRef.current.play().catch(() => {/* user gesture required in some browsers */})
    }
  }, [])

  function startEdit(i: number) {
    setEditIdx(i)
    setEditText(segments[i].text)
  }

  function saveEdit(i: number) {
    setSegments(prev => prev.map((s, si) => si === i ? { ...s, text: editText } : s))
    setEditIdx(null)
  }

  const duration = clipEnd - clipStart

  return (
    <div className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--color-lavender-tint)] transition-colors text-left"
      >
        {open ? <ChevronDown size={14} className="shrink-0 text-[var(--color-purple-gray)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--color-purple-gray)]" />}
        <span className="text-[13px] font-semibold text-[var(--color-deep-plum)]">
          Clip {idx + 1}{clip.clip_title ? ` — ${clip.clip_title}` : ''}
        </span>
        {clip.startTime && (
          <span className="ml-auto text-[11px] text-[var(--color-purple-gray)] font-mono whitespace-nowrap">
            {clip.startTime} → {clip.endTime}
            {duration > 0 && <span className="ml-1 text-[var(--color-primary-purple)]">({Math.round(duration)}s)</span>}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--color-lavender)]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">

            {/* Left: video */}
            <div className="p-4 border-b lg:border-b-0 lg:border-r border-[var(--color-lavender)] bg-[var(--color-cream)]">
              {videoUrl ? (
                <div className="space-y-2">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    playsInline
                    className="w-full rounded-lg bg-black aspect-video"
                    onLoadedMetadata={() => {
                      if (videoRef.current && clipStart > 0) {
                        videoRef.current.currentTime = clipStart
                      }
                    }}
                  />
                  <p className="text-[10px] text-[var(--color-purple-gray)] text-center">
                    Click a timestamp on the right to seek
                  </p>
                </div>
              ) : (
                <div className="aspect-video rounded-lg bg-[var(--color-lavender-tint)] flex items-center justify-center">
                  <p className="text-[12px] text-[var(--color-purple-gray)]">No video URL for this session</p>
                </div>
              )}
            </div>

            {/* Right: transcript */}
            <div className="p-4 overflow-y-auto max-h-[420px]">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-3">
                Interactive Transcript ({segments.length} segments)
              </p>
              {segments.length === 0 ? (
                <p className="text-[12px] text-[var(--color-purple-gray)]">
                  {clip.startTime
                    ? 'No word-level transcript available for this clip range.'
                    : 'This clip has no timestamps — transcript sync not available.'}
                </p>
              ) : (
                <ol className="space-y-3">
                  {segments.map((seg, i) => (
                    <li key={i} className="flex gap-3 group">
                      {/* Timestamp (click to seek) */}
                      <button
                        type="button"
                        onClick={() => seekTo(seg.start)}
                        className="shrink-0 text-[10px] font-mono text-[var(--color-primary-purple)] hover:text-[var(--color-deep-plum)] transition-colors whitespace-nowrap pt-0.5"
                        title="Click to seek video"
                      >
                        #{i + 1} · {toMMSS(seg.start - clipStart)} → {toMMSS(seg.end - clipStart)}
                      </button>

                      {/* Text (click to edit) */}
                      {editIdx === i ? (
                        <div className="flex-1 space-y-1">
                          <textarea
                            autoFocus
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(i) }
                              if (e.key === 'Escape') setEditIdx(null)
                            }}
                            rows={2}
                            className="w-full rounded border border-[var(--color-primary-purple)] bg-white px-2 py-1 text-[12px] text-[var(--color-deep-plum)] focus:outline-none resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(i)}
                              className="text-[10px] font-semibold text-[var(--color-primary-purple)] hover:underline"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditIdx(null)}
                              className="text-[10px] text-[var(--color-purple-gray)] hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(i)}
                          className="flex-1 text-left text-[13px] text-[var(--color-deep-plum)] hover:text-[var(--color-primary-purple)] transition-colors leading-snug"
                          title="Click to edit"
                        >
                          {seg.text}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
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
  const { clipSelections, transcriptWords, videoUrl, goToNextStep, goToPrevStep } = useSrpWorkflow()

  const words = useMemo<Word[]>(() => {
    if (!Array.isArray(transcriptWords)) return []
    return (transcriptWords as unknown[]).map((w: unknown) => {
      const obj = w as Record<string, unknown>
      return {
        start: parseTime(obj.start),
        end:   parseTime(obj.end),
        text:  typeof obj.text === 'string' ? obj.text : String(obj.text ?? ''),
      }
    })
  }, [transcriptWords])

  return (
    <div className="space-y-6 pb-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-primary-purple)] flex items-center gap-1.5">
          <Film size={12} /> Pre-render review
        </p>
        <h2 className="text-[22px] font-bold text-[var(--color-deep-plum)] mt-0.5">
          Review your clip cuts
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          Verify each clip's exact start and end in the video. Click timestamps to seek. Click text to fix any transcript errors before the clips are finalized.
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
          Continue to Music &amp; edits →
        </SrpButton>
      </div>
    </div>
  )
}
