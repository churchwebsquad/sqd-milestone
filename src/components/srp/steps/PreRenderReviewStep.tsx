/**
 * Pre-render review step — shows cut clip videos with synced transcript.
 *
 * For each selected clip: video player (left) + scrollable SRT segment list
 * (right). Active segment highlights as the video plays and appears as a
 * caption overlay. Clicking a segment row seeks the video to that point.
 *
 * Clip states:
 *   - processing/pending: loading card with spinner + elapsed timer
 *   - ready: full video + transcript layout
 *   - error: error message with retry note
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle, Film, ArrowLeft, ArrowRight } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { useProcessedClips } from '../../../hooks/useProcessedClips'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mmssToSeconds(val: string | null | undefined): number {
  if (!val) return 0
  const parts = val.trim().split(':').map(Number)
  if (parts.some(isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] ?? 0
}

function toMMSS(secs: number): string {
  const m = Math.floor(Math.max(0, secs) / 60)
  const s = Math.floor(Math.max(0, secs) % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── SRT segment type ──────────────────────────────────────────────────────────

interface SrtSegment {
  index:    number
  startSec: number
  endSec:   number
  text:     string
}

// ── Build SRT segments from transcript words ──────────────────────────────────

function buildSrtSegments(
  words: { word: string; start: number; end: number }[],
  clipStartSec: number,
  clipEndSec:   number,
  chunkSize = 4,
): SrtSegment[] {
  const inRange = words.filter(
    w => w.start >= clipStartSec - 0.1 && w.end <= clipEndSec + 0.1,
  )
  if (inRange.length === 0) return []

  const segments: SrtSegment[] = []
  for (let i = 0; i < inRange.length; i += chunkSize) {
    const chunk = inRange.slice(i, i + chunkSize)
    segments.push({
      index:    segments.length + 1,
      startSec: chunk[0].start - clipStartSec,
      endSec:   chunk[chunk.length - 1].end - clipStartSec,
      text:     chunk.map(w => w.word).join(' '),
    })
  }
  return segments
}

// ── Elapsed timer (reused from ClipSelectionStep pattern) ─────────────────────

function ElapsedTimer({ startedAt }: { startedAt: string | null | undefined }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (!startedAt) return <span>Cutting clip…</span>
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return <span>Cutting clip… {m > 0 ? `${m}m ` : ''}{s}s</span>
}

// ── Per-clip card ─────────────────────────────────────────────────────────────

interface ClipCardProps {
  idx:         number
  clipId:      string
  clipTitle?:  string | null
  startTime?:  string | null
  endTime?:    string | null
  quote?:      string | null
  videoUrl:    string | null | undefined
  transcript:  string | null | undefined
  status:      'processing' | 'ready' | 'error' | 'pending'
  errorMsg?:   string | null
  createdAt?:  string | null
  words:       { word: string; start: number; end: number }[]
}

function ClipCard({
  idx, clipTitle, startTime, endTime, quote,
  videoUrl, transcript, status, errorMsg, createdAt, words,
}: ClipCardProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const listRef     = useRef<HTMLUListElement>(null)
  const [currentTime, setCurrentTime] = useState(0)

  const clipStartSec = mmssToSeconds(startTime)
  const clipEndSec   = mmssToSeconds(endTime)

  // Build SRT segments — prefer processedClip transcript json if available,
  // fall back to raw transcriptWords filtered to clip range.
  const segments: SrtSegment[] = (() => {
    if (transcript) {
      try {
        // transcript may be a JSON array of word objects
        const parsed = JSON.parse(transcript) as { word?: string; text?: string; start: number; end: number }[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          const w = parsed.map(p => ({ word: p.word ?? p.text ?? '', start: p.start, end: p.end }))
          return buildSrtSegments(w, clipStartSec, clipEndSec)
        }
      } catch {
        // not JSON — will fall through to raw words
      }
    }
    if (words.length > 0 && clipStartSec < clipEndSec) {
      return buildSrtSegments(words, clipStartSec, clipEndSec)
    }
    return []
  })()

  const activeIdx = segments.findIndex(
    s => currentTime >= s.startSec - 0.1 && currentTime < s.endSec + 0.1,
  )
  const activeSeg = activeIdx >= 0 ? segments[activeIdx] : null

  // Auto-scroll active segment into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return
    const li = listRef.current.children[activeIdx] as HTMLLIElement | undefined
    li?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])

  const seekTo = useCallback((sec: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = sec
    videoRef.current.play().catch(() => { /* needs user gesture */ })
  }, [])

  // ── Loading state ──────────────────────────────────────────────────────────
  if (status === 'processing' || status === 'pending') {
    return (
      <div className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[var(--color-lavender-tint)] flex items-center justify-center shrink-0">
            <Film size={16} className="text-[var(--color-primary-purple)]" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-[var(--color-deep-plum)]">
              Clip {idx + 1}{clipTitle ? ` — ${clipTitle}` : ''}
            </p>
            {quote && (
              <p className="text-[11px] text-[var(--color-purple-gray)] line-clamp-1 mt-0.5">
                "{quote}"
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--color-lavender-tint)] text-[12px] text-[var(--color-purple-gray)]">
          <Loader2 size={14} className="animate-spin text-[var(--color-primary-purple)] shrink-0" />
          <ElapsedTimer startedAt={createdAt} />
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-2">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle size={15} />
          <p className="text-[13px] font-bold">
            Clip {idx + 1}{clipTitle ? ` — ${clipTitle}` : ''} failed to process
          </p>
        </div>
        {errorMsg && (
          <p className="text-[12px] text-red-500 pl-5">{errorMsg}</p>
        )}
        <p className="text-[11px] text-red-400 pl-5">
          Go back to Clip Selection and use Retry to resubmit this clip.
        </p>
      </div>
    )
  }

  // ── Ready state ────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]">
        <CheckCircle2 size={14} className="text-green-600 shrink-0" />
        <p className="text-[13px] font-bold text-[var(--color-deep-plum)]">
          Clip {idx + 1}{clipTitle ? ` — ${clipTitle}` : ''}
        </p>
        {startTime && (
          <span className="ml-auto text-[11px] font-mono text-[var(--color-purple-gray)]">
            {startTime} → {endTime}
          </span>
        )}
      </div>

      {/* Body: video left, transcript right */}
      <div className="flex flex-col lg:flex-row">
        {/* Video column */}
        <div className="lg:w-[50%] shrink-0 p-3 lg:border-r border-b lg:border-b-0 border-[var(--color-lavender)]">
          <div className="sticky top-2">
            <div className="relative rounded-lg overflow-hidden bg-black">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  playsInline
                  className="w-full rounded-lg bg-black aspect-video"
                  onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
                />
              ) : (
                <div className="aspect-video flex items-center justify-center">
                  <p className="text-[12px] text-[var(--color-purple-gray)]">No video available</p>
                </div>
              )}
              {/* Caption overlay */}
              {activeSeg && activeSeg.text && (
                <div className="absolute bottom-6 left-0 right-0 flex justify-center px-4 pointer-events-none">
                  <p className="bg-black/75 text-white text-[13px] font-bold px-3 py-1.5 rounded-lg text-center leading-snug max-w-[90%]">
                    {activeSeg.text}
                  </p>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-center text-[10px] text-[var(--color-purple-gray)] font-mono">
              {toMMSS(currentTime)}
              {activeSeg && (
                <span className="ml-2 text-[var(--color-primary-purple)]">
                  — segment {activeSeg.index}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Transcript column */}
        <div className="flex-1 p-4 flex flex-col gap-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Transcript
          </p>

          {segments.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] py-8 text-center">
              <p className="text-[12px] text-[var(--color-purple-gray)]">
                {transcript !== undefined
                  ? 'Transcript is processing — check back shortly.'
                  : 'No transcript available for this clip range.'}
              </p>
            </div>
          ) : (
            <ul
              ref={listRef}
              className="space-y-1 overflow-y-auto max-h-[400px] pr-1"
            >
              {segments.map((seg, i) => {
                const isActive = i === activeIdx
                return (
                  <li
                    key={seg.index}
                    role="button"
                    tabIndex={0}
                    onClick={() => seekTo(seg.startSec)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') seekTo(seg.startSec) }}
                    className={[
                      'flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-left',
                      isActive
                        ? 'bg-[#6B5CE7] text-white'
                        : 'bg-[var(--color-lavender-tint)] hover:bg-[var(--color-lavender)] text-[var(--color-deep-plum)]',
                    ].join(' ')}
                  >
                    <span className={[
                      'text-[10px] font-mono shrink-0 mt-0.5 w-8 text-right',
                      isActive ? 'text-white/70' : 'text-[var(--color-purple-gray)]',
                    ].join(' ')}>
                      {toMMSS(seg.startSec)}
                    </span>
                    <span className="text-[13px] leading-snug">{seg.text}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main step ─────────────────────────────────────────────────────────────────

export function PreRenderReviewStep() {
  const {
    clipSelections,
    transcriptWords,
    sessionId,
    goToNextStep,
    goToPrevStep,
  } = useSrpWorkflow()

  const { clips: processedClips } = useProcessedClips(sessionId)

  // Normalise transcriptWords to { word, start, end }
  const words: { word: string; start: number; end: number }[] = (() => {
    if (!Array.isArray(transcriptWords)) return []
    return (transcriptWords as unknown[]).map((w: unknown) => {
      const obj = w as Record<string, unknown>
      return {
        word:  typeof obj.word === 'string' ? obj.word : typeof obj.text === 'string' ? obj.text : String(obj.word ?? obj.text ?? ''),
        start: typeof obj.start === 'number' ? obj.start : Number(obj.start ?? 0),
        end:   typeof obj.end   === 'number' ? obj.end   : Number(obj.end   ?? 0),
      }
    })
  })()

  const atLeastOneReady = Object.values(processedClips).some(pc => pc.status === 'ready')

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-primary-purple)] flex items-center gap-1.5">
          <Film size={12} /> Transcript review
        </p>
        <h2 className="text-[22px] font-bold text-[var(--color-deep-plum)] mt-0.5">
          Review your cut clips
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          Watch each clip and review the auto-generated transcript. Click any transcript line to jump to that moment in the video.
        </p>
      </div>

      {clipSelections.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] px-5 py-10 text-center">
          <p className="text-[13px] text-[var(--color-purple-gray)]">No clips selected — go back to Clip Selection.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {clipSelections.map((clip, idx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clipId  = (clip as any).clip_id ?? `selection-${idx}`
            const pc      = processedClips[clipId]
            const status  = pc?.status === 'ready'       ? 'ready'
                          : pc?.status === 'processing'  ? 'processing'
                          : pc?.status === 'error'       ? 'error'
                          : 'pending'
            return (
              <ClipCard
                key={clipId}
                idx={idx}
                clipId={clipId}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                clipTitle={(clip as any).clip_title ?? null}
                startTime={clip.startTime}
                endTime={clip.endTime}
                quote={clip.quote}
                videoUrl={pc?.video_url}
                transcript={pc?.transcript}
                status={status}
                errorMsg={pc?.error_message}
                createdAt={pc?.created_at}
                words={words}
              />
            )
          })}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
          disabled={clipSelections.length > 0 && !atLeastOneReady}
        >
          Continue to Creative Direction
        </SrpButton>
      </div>
    </div>
  )
}
