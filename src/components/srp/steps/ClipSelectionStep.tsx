/**
 * Step 4 — Clip selection (redesigned).
 *
 * Layout:
 *   1. Controls: guidance input + Refresh + Manual Entry
 *   2. Sticky video player — seeks to whichever clip is playing
 *   3. Scrollable clip list — select, play, edit timestamps, pin
 *
 * Caption style picker has moved to a later step.
 * Continue is gated on selecting the correct reel count.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  ArrowLeft, ArrowRight, Loader2,
  Check, Pin, PinOff, Play, Pencil, Plus, RefreshCw,
} from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { isSrpReelDeliverable, type SrpClipSelection } from '../../../types/database'
import { buildAccountContext } from '../../../lib/accountContext'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'Profound Ideas':        'bg-[#EDE9FC] text-[#341756]',
  'Practical Application': 'bg-[#D6F0E6] text-[#0F5132]',
  'Challenges':            'bg-[#FCE9E9] text-[#7A1F1F]',
  'Encouragement':         'bg-[#FFF1D6] text-[#7A5A0F]',
  'Life of Jesus':         'bg-[#E0E8FA] text-[#1F3A7A]',
}

function mmssToSeconds(ts: string | undefined): number {
  if (!ts) return 0
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

function secondsToMmss(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0]
    if (u.hostname.includes('youtube.com'))
      return u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? null
  } catch { /* invalid URL */ }
  return null
}

/**
 * Re-anchor a clip's timestamps by finding the AI quote's first and last words
 * in transcript_words. The AI often drifts from the true word-level timestamps,
 * so we search for the actual position of the first 4 words in the quote to
 * get the real startTime, and the last word to get the real endTime.
 */
function reanchorClip(
  words: any[] | null | undefined,
  clip: { quote?: string; startTime?: string; endTime?: string },
): { startTime: string; endTime: string } | null {
  if (!words?.length || !clip.quote) return null
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const quoteWords = clip.quote.split(/\s+/).filter(Boolean)
  if (quoteWords.length < 3) return null

  const needle = quoteWords.slice(0, 4).map(normalize)
  const lastNeedle = normalize(quoteWords[quoteWords.length - 1])

  // Find the best-matching run of words for the first 4 words of the quote
  let bestIdx = -1
  let bestScore = 0
  for (let i = 0; i <= words.length - needle.length; i++) {
    let score = 0
    for (let j = 0; j < needle.length; j++) {
      if (normalize(words[i + j]?.word ?? words[i + j]?.text ?? '') === needle[j]) score++
    }
    if (score > bestScore) { bestScore = score; bestIdx = i }
    if (score === needle.length) break // perfect match, stop early
  }
  if (bestScore < 2 || bestIdx < 0) return null

  const startWord = words[bestIdx]
  const startSec = typeof startWord.start === 'number' ? startWord.start : mmssToSeconds(startWord.start ?? '')

  // Find the last word of the quote starting from bestIdx
  const endSearchFrom = bestIdx + quoteWords.length - 8
  const endSearchTo   = bestIdx + quoteWords.length + 8
  let endSec = startSec + (mmssToSeconds(clip.endTime ?? '') - mmssToSeconds(clip.startTime ?? ''))
  for (let i = Math.max(bestIdx, endSearchFrom); i < Math.min(words.length, endSearchTo); i++) {
    if (normalize(words[i]?.word ?? words[i]?.text ?? '') === lastNeedle) {
      const t = typeof words[i].start === 'number' ? words[i].start : mmssToSeconds(words[i].start ?? '')
      endSec = t
    }
  }

  return { startTime: secondsToMmss(Math.round(startSec)), endTime: secondsToMmss(Math.round(endSec)) }
}

/** Slice a verbatim quote from transcript_words for a given time range. */
function sliceQuoteFromWords(
  words: any[] | null | undefined,
  startTs: string,
  endTs: string,
): string {
  if (!words?.length) return ''
  const startSec = mmssToSeconds(startTs)
  const endSec   = mmssToSeconds(endTs)
  return words
    .filter((w: any) => {
      const t = typeof w.start === 'number' ? w.start : mmssToSeconds(w.start)
      return t >= startSec && t <= endSec
    })
    .map((w: any) => w.word ?? w.text ?? '')
    .join(' ')
    .trim()
}

// ── Sticky YouTube player ─────────────────────────────────────────────────────

function StickyVideoPlayer({
  videoUrl,
  videoSourceType,
  activeStart,
  playerRef,
}: {
  videoUrl:        string
  videoSourceType: string | null | undefined
  activeStart:     number | null
  playerRef:       MutableRefObject<HTMLIFrameElement | null>
}) {
  const videoElemRef = useRef<HTMLVideoElement | null>(null)

  // Seek the native <video> element only when activeStart actually changes —
  // not on every re-render. This prevents the video from restarting whenever
  // unrelated state updates (like clip selection) cause a re-render.
  useEffect(() => {
    const vid = videoElemRef.current
    if (!vid || activeStart === null) return
    const doSeek = () => {
      vid.currentTime = activeStart
      void vid.play()
    }
    if (vid.readyState >= 1) {
      doSeek()
    } else {
      vid.addEventListener('loadedmetadata', doSeek, { once: true })
      return () => vid.removeEventListener('loadedmetadata', doSeek)
    }
  }, [activeStart])

  // Detect source type from URL if not stored
  const effectiveSourceType = videoSourceType ?? (
    videoUrl.includes('youtu') ? 'youtube' :
    videoUrl.includes('dropbox.com') ? 'dropbox' :
    videoUrl.includes('vimeo.com') ? 'vimeo' : 'direct'
  )

  const ytId = effectiveSourceType === 'youtube' ? extractYouTubeId(videoUrl) : null

  if (ytId) {
    const src = `https://www.youtube.com/embed/${ytId}?enablejsapi=1&rel=0&modestbranding=1`
    return (
      <div className="sticky top-0 z-10 bg-[var(--color-cream)] pt-1 pb-3">
        <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shadow-md">
          <iframe
            ref={playerRef}
            src={src}
            className="w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
            title="Sermon video"
          />
        </div>
        {activeStart !== null && (
          <p className="text-[10px] text-[var(--color-purple-gray)] mt-1 text-center">
            Playing from {secondsToMmss(activeStart)}
          </p>
        )}
      </div>
    )
  }

  // Dropbox / direct video
  if (effectiveSourceType === 'dropbox' || effectiveSourceType === 'direct') {
    const direct = effectiveSourceType === 'dropbox'
      ? videoUrl
          .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
          .replace(/([?&])dl=0/, '$1dl=1')
          .replace(/([?&])st=[^&]+/, '')
      : videoUrl
    return (
      <div className="sticky top-0 z-10 bg-[var(--color-cream)] pt-1 pb-3">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoElemRef}
          src={direct}
          controls
          className="w-full rounded-xl bg-black shadow-md"
          style={{ maxHeight: 340 }}
        />
        {activeStart !== null && (
          <p className="text-[10px] text-[var(--color-purple-gray)] mt-1 text-center">
            Playing from {secondsToMmss(activeStart)}
          </p>
        )}
      </div>
    )
  }

  return null
}

// ── Clip card ─────────────────────────────────────────────────────────────────

interface ClipCardProps {
  clip:      SrpClipSelection & { [k: string]: any }
  index:     number
  isPicked:  boolean
  isPinned:  boolean
  onSelect:  () => void
  onPlay:    () => void
  onPin:     () => void
  transcriptWords: any[] | null | undefined
  onUpdateTimes: (startTime: string, endTime: string, quote: string) => void
}

function ClipCard({
  clip, index, isPicked, isPinned,
  onSelect, onPlay, onPin,
  transcriptWords, onUpdateTimes,
}: ClipCardProps) {
  const [editing, setEditing]       = useState(false)
  const [editStart, setEditStart]   = useState(clip.startTime ?? '')
  const [editEnd, setEditEnd]       = useState(clip.endTime ?? '')
  const catColor = CATEGORY_COLORS[clip.category ?? ''] ?? 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]'

  const duration = useMemo(() => {
    if (!clip.startTime || !clip.endTime) return null
    const d = mmssToSeconds(clip.endTime) - mmssToSeconds(clip.startTime)
    return d > 0 ? `${d}s` : null
  }, [clip.startTime, clip.endTime])

  const handleSaveEdit = () => {
    const newQuote = sliceQuoteFromWords(transcriptWords, editStart, editEnd) || clip.quote || ''
    onUpdateTimes(editStart, editEnd, newQuote)
    setEditing(false)
  }

  return (
    <div className={[
      'rounded-xl border overflow-hidden transition-colors',
      isPicked
        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]/60'
        : 'border-[var(--color-lavender)] bg-white',
    ].join(' ')}>
      <div className="flex items-start gap-3 px-4 py-3">

        {/* Select radio */}
        <button
          type="button"
          onClick={() => { onSelect(); onPlay() }}
          aria-label={isPicked ? 'Deselect clip' : 'Select clip'}
          className={[
            'shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
            isPicked
              ? 'border-[var(--color-primary-purple)] bg-[var(--color-primary-purple)]'
              : 'border-[var(--color-lavender)] hover:border-[var(--color-primary-purple)]',
          ].join(' ')}
        >
          {isPicked && <Check size={10} strokeWidth={3} className="text-white" />}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-bold text-[var(--color-purple-gray)]">
              {index + 1}
            </span>
            {clip.category && (
              <span className={['text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5', catColor].join(' ')}>
                {clip.category}
              </span>
            )}
            {clip.startTime && clip.endTime && (
              <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                {clip.startTime} → {clip.endTime}
              </span>
            )}
            {duration && (
              <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">{duration}</span>
            )}
          </div>
          <p className="text-[12px] text-[var(--color-deep-plum)] leading-snug">
            "{clip.quote}"
          </p>

          {/* Inline time editor */}
          {editing && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[10px] font-semibold text-[var(--color-purple-gray)] w-12">Start</label>
                <input
                  type="text"
                  value={editStart}
                  onChange={e => setEditStart(e.target.value)}
                  placeholder="MM:SS"
                  className="w-20 rounded border border-[var(--color-lavender)] px-2 py-1 text-[11px] font-mono text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
                />
                <label className="text-[10px] font-semibold text-[var(--color-purple-gray)] w-12">End</label>
                <input
                  type="text"
                  value={editEnd}
                  onChange={e => setEditEnd(e.target.value)}
                  placeholder="MM:SS"
                  className="w-20 rounded border border-[var(--color-lavender)] px-2 py-1 text-[11px] font-mono text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
                />
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="text-[10px] font-semibold text-white bg-[var(--color-primary-purple)] rounded-full px-3 py-1 hover:bg-[var(--color-purple-mid)] transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-[10px] font-semibold text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onPlay}
            title="Play clip in video above"
            className="p-1.5 rounded-lg text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] hover:bg-[var(--color-lavender-tint)] transition-colors"
          >
            <Play size={13} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(e => !e)}
            title="Edit clip timestamps"
            className={[
              'p-1.5 rounded-lg transition-colors',
              editing
                ? 'text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                : 'text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] hover:bg-[var(--color-lavender-tint)]',
            ].join(' ')}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={onPin}
            title={isPinned ? 'Pinned — kept on regenerate' : 'Pin to keep on regenerate'}
            className={[
              'p-1.5 rounded-lg transition-colors',
              isPinned
                ? 'text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                : 'text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)] hover:bg-[var(--color-lavender-tint)]',
            ].join(' ')}
          >
            {isPinned ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Generate clips response ───────────────────────────────────────────────────

interface GenerateClipsResponse {
  clips: SrpClipSelection[]
  has_timecodes: boolean
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClipSelectionStep() {
  const {
    account, sermonSubmission, brandVoice,
    selectedDeliverables,
    transcript, transcriptWords, hasTimecodes,
    keyInsights,
    clipSuggestions, setClipSuggestions,
    clipSelections, setClipSelections,
    videoUrl, videoSourceType,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const playerRef  = useRef<HTMLIFrameElement | null>(null)
  const [activeStartSec, setActiveStartSec] = useState<number | null>(null)
  const [generating, setGenerating]         = useState(false)
  const [genError, setGenError]             = useState<string | null>(null)
  const [guidance, setGuidance]             = useState('')
  const [pinnedIds, setPinnedIds]           = useState<Set<string>>(new Set())

  // Manual entry state
  const [showManual, setShowManual]         = useState(false)
  const [manualStart, setManualStart]       = useState('')
  const [manualEnd, setManualEnd]           = useState('')

  const stepNum   = visibleSteps.indexOf('clips') + 1
  const reelCount = useMemo(
    () => selectedDeliverables.filter(isSrpReelDeliverable).length,
    [selectedDeliverables],
  )

  // ── YouTube seek via postMessage ─────────────────────────────────────────

  const seekAndPlay = useCallback((startSec: number) => {
    setActiveStartSec(startSec)
    const iframe = playerRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'seekTo', args: [startSec, true] }), '*',
    )
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*',
    )
  }, [])

  // ── Clip generation ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!transcript || transcript.trim().length < 200) {
      setGenError('Transcript too short. Go back to Step 3.')
      return
    }
    setGenerating(true); setGenError(null)
    const pinnedQuotes = clipSuggestions
      .filter(c => c.clip_id && pinnedIds.has(c.clip_id) && c.quote)
      .map(c => c.quote!)
    try {
      const r = await callSrpApi<GenerateClipsResponse>('generate-clips', {
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        hasTimecodes,
        pinnedQuotes,
        guidance: guidance.trim() || undefined,
        keyInsights: keyInsights.length ? keyInsights : undefined,
      })
      // Re-anchor AI timestamps to actual word-level positions
      const anchored = (r.clips ?? []).map(c => {
        const fix = reanchorClip(transcriptWords, c)
        return fix ? { ...c, ...fix } : c
      })
      // Preserve pinned clips, replace the rest
      const pinned = clipSuggestions.filter(c => c.clip_id && pinnedIds.has(c.clip_id))
      const fresh  = anchored.filter(c => !pinnedQuotes.includes(c.quote ?? ''))
      setClipSuggestions([...pinned, ...fresh])
    } catch (e) {
      const err = e as Error & { errorCode?: string }
      setGenError(err.errorCode ? `${err.errorCode}: ${err.message}` : err.message)
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, hasTimecodes,
      clipSuggestions, pinnedIds, guidance, keyInsights, setClipSuggestions])

  // Auto-generate if no suggestions yet
  useEffect(() => {
    if (clipSuggestions.length === 0 && transcript && transcript.length > 200 && !generating) {
      void handleGenerate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Pick / unpick ────────────────────────────────────────────────────────

  const togglePick = useCallback((clip: SrpClipSelection) => {
    const idx = clipSelections.findIndex(c => c.quote === clip.quote)
    if (idx >= 0) {
      // Deselect
      setClipSelections(clipSelections.filter((_, i) => i !== idx))
      return
    }
    // Already at the limit — do nothing (user must deselect first)
    if (clipSelections.length >= reelCount) return
    setClipSelections([...clipSelections, assignClipId(clip, clipSelections.length + 1)])
  }, [clipSelections, reelCount, setClipSelections])

  const isPicked = useCallback((clip: SrpClipSelection) =>
    clipSelections.some(c => c.quote === clip.quote), [clipSelections])

  // ── Pin ──────────────────────────────────────────────────────────────────

  const togglePin = useCallback((clipId: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(clipId)) next.delete(clipId)
      else next.add(clipId)
      return next
    })
  }, [])

  // ── Update clip times + re-slice quote ──────────────────────────────────

  const updateClipTimes = useCallback((
    index: number, startTime: string, endTime: string, quote: string,
  ) => {
    const updated = [...clipSuggestions]
    updated[index] = { ...updated[index], startTime, endTime, quote }
    setClipSuggestions(updated)
    // Also update in selections if picked
    setClipSelections(clipSelections.map(c =>
      c.quote === clipSuggestions[index].quote ? { ...c, startTime, endTime, quote } : c,
    ))
  }, [clipSuggestions, clipSelections, setClipSuggestions, setClipSelections])

  // ── Manual entry ─────────────────────────────────────────────────────────

  const handleAddManual = useCallback(() => {
    if (!manualStart || !manualEnd) return
    const quote = sliceQuoteFromWords(transcriptWords, manualStart, manualEnd)
    const manual: SrpClipSelection = {
      clip_id:          `manual_${Date.now().toString(36)}`,
      startTime:        manualStart,
      endTime:          manualEnd,
      quote:            quote || `${manualStart} – ${manualEnd}`,
      category:         undefined,
      estimatedSeconds: mmssToSeconds(manualEnd) - mmssToSeconds(manualStart),
    } as any
    setClipSuggestions([...clipSuggestions, manual])
    setManualStart(''); setManualEnd(''); setShowManual(false)
  }, [manualStart, manualEnd, transcriptWords, clipSuggestions, setClipSuggestions])

  const continueReady = clipSelections.length >= 1

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.clips}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.clips} · Pick {reelCount} clip{reelCount === 1 ? '' : 's'}.
        </p>
      </header>

      {/* Controls bar */}
      <div className="rounded-xl border border-[var(--color-lavender)] bg-white p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={guidance}
            onChange={e => setGuidance(e.target.value)}
            placeholder='Guidance for refresh (e.g. "focus on hope moments")'
            className="flex-1 min-w-0 rounded-full border border-[var(--color-lavender)] px-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || !transcript}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border border-[var(--color-lavender)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {generating
              ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
              : <><RefreshCw size={12} /> {clipSuggestions.length > 0 ? 'Refresh' : 'Generate'}{pinnedIds.size > 0 ? ` (${pinnedIds.size} pinned)` : ''}</>
            }
          </button>
          <button
            type="button"
            onClick={() => setShowManual(s => !s)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border border-[var(--color-lavender)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] transition-colors whitespace-nowrap"
          >
            <Plus size={12} /> Manual Entry
          </button>
        </div>

        {/* Manual entry form */}
        {showManual && (
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[var(--color-lavender)]">
            <span className="text-[11px] font-semibold text-[var(--color-purple-gray)]">Start</span>
            <input
              type="text" value={manualStart} onChange={e => setManualStart(e.target.value)}
              placeholder="MM:SS"
              className="w-20 rounded border border-[var(--color-lavender)] px-2 py-1 text-[11px] font-mono text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
            />
            <span className="text-[11px] font-semibold text-[var(--color-purple-gray)]">End</span>
            <input
              type="text" value={manualEnd} onChange={e => setManualEnd(e.target.value)}
              placeholder="MM:SS"
              className="w-20 rounded border border-[var(--color-lavender)] px-2 py-1 text-[11px] font-mono text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]"
            />
            <button
              type="button" onClick={handleAddManual}
              disabled={!manualStart || !manualEnd}
              className="text-[11px] font-semibold text-white bg-[var(--color-primary-purple)] rounded-full px-3 py-1 hover:bg-[var(--color-purple-mid)] disabled:opacity-50 transition-colors"
            >
              Add clip
            </button>
          </div>
        )}
      </div>

      {genError && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">
          {genError}
        </div>
      )}

      {/* Sticky video player */}
      {videoUrl && (
        <StickyVideoPlayer
          videoUrl={videoUrl}
          videoSourceType={videoSourceType}
          activeStart={activeStartSec}
          playerRef={playerRef}
        />
      )}

      {/* Status line */}
      {clipSuggestions.length > 0 && (
        <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
          {clipSuggestions.length} suggestions — ranked by social potential · pick {reelCount}
          {clipSelections.length > 0 && ` · ${clipSelections.length} selected`}
        </p>
      )}

      {/* Clip list */}
      {clipSuggestions.length > 0 && (
        <ul className="space-y-2">
          {clipSuggestions.map((c, i) => {
            const clipId = (c as any).clip_id ?? `suggestion-${i}`
            const cWithId = { ...c, clip_id: clipId }
            return (
              <li key={clipId}>
                <ClipCard
                  clip={cWithId}
                  index={i}
                  isPicked={isPicked(c)}
                  isPinned={pinnedIds.has(clipId)}
                  onSelect={() => togglePick(cWithId)}
                  onPlay={() => c.startTime ? seekAndPlay(mmssToSeconds(c.startTime)) : undefined}
                  onPin={() => togglePin(clipId)}
                  transcriptWords={transcriptWords}
                  onUpdateTimes={(st, et, q) => { updateClipTimes(i, st, et, q); seekAndPlay(mmssToSeconds(st)) }}
                />
              </li>
            )
          })}
        </ul>
      )}

      {generating && clipSuggestions.length === 0 && (
        <div className="flex items-center justify-center py-12 text-[var(--color-purple-gray)]">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-[13px]">Finding the best moments…</span>
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton
          disabled={!continueReady}
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          {continueReady
            ? 'Continue'
            : `Continue (${clipSelections.length}/${reelCount} picked)`}
        </SrpButton>
      </div>
    </div>
  )
}

function assignClipId(clip: SrpClipSelection, slotNumber: number): SrpClipSelection {
  return {
    ...clip,
    clip_id:      (clip as any).clip_id ?? `clip_${slotNumber}_${Date.now().toString(36)}`,
    caption_text: clip.caption_text ?? clip.quote ?? '',
  }
}
