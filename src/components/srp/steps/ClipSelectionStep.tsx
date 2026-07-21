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
  Check, Pin, PinOff, Play, Pencil, Plus, RefreshCw, Clapperboard, AlertCircle, CheckCircle2,
} from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { IntelGuidancePanel } from '../_shared/IntelGuidancePanel'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { isSrpReelDeliverable, type SrpClipSelection } from '../../../types/database'
import { buildAccountContext } from '../../../lib/accountContext'
import { useProcessedClips } from '../../../hooks/useProcessedClips'

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

  // Preserve the original duration as a fallback — the end-word search can
  // pick up a common word too early, collapsing a 45s clip to 7s.
  const originalDuration = mmssToSeconds(clip.endTime ?? '') - mmssToSeconds(clip.startTime ?? '')
  let endSec = startSec + originalDuration

  // Search for the last word of the quote in a window around where it should be
  const endSearchFrom = bestIdx + quoteWords.length - 8
  const endSearchTo   = bestIdx + quoteWords.length + 8
  let foundEndSec: number | null = null
  for (let i = Math.max(bestIdx, endSearchFrom); i < Math.min(words.length, endSearchTo); i++) {
    if (normalize(words[i]?.word ?? words[i]?.text ?? '') === lastNeedle) {
      const t = typeof words[i].start === 'number' ? words[i].start : mmssToSeconds(words[i].start ?? '')
      foundEndSec = t
    }
  }
  // Only accept the found end if it results in a duration >= 20s (avoids common-word false matches)
  if (foundEndSec !== null && foundEndSec - startSec >= 20) {
    endSec = foundEndSec
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

function extractVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  return m ? m[1] : null
}

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
  const videoElemRef  = useRef<HTMLVideoElement | null>(null)
  const vimeoRef      = useRef<HTMLIFrameElement | null>(null)

  // Seek native <video> on activeStart change
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

  // Seek Vimeo iframe via postMessage on activeStart change
  useEffect(() => {
    const iframe = vimeoRef.current
    if (!iframe?.contentWindow || activeStart === null) return
    iframe.contentWindow.postMessage(JSON.stringify({ method: 'setCurrentTime', value: activeStart }), '*')
    iframe.contentWindow.postMessage(JSON.stringify({ method: 'play' }), '*')
  }, [activeStart])

  // Detect source type from URL if not stored
  const effectiveSourceType = videoSourceType ?? (
    videoUrl.includes('youtu')      ? 'youtube' :
    videoUrl.includes('dropbox.com') ? 'dropbox' :
    videoUrl.includes('vimeo.com')   ? 'vimeo'   : 'direct'
  )

  const ytId     = effectiveSourceType === 'youtube' ? extractYouTubeId(videoUrl) : null
  const vimeoId  = effectiveSourceType === 'vimeo'   ? extractVimeoId(videoUrl)   : null

  const wrapCls = 'sticky top-0 z-10 bg-[var(--color-cream)] pt-1 pb-3'
  const label   = activeStart !== null
    ? <p className="text-[10px] text-[var(--color-purple-gray)] mt-1 text-center">Playing from {secondsToMmss(activeStart)}</p>
    : null

  if (ytId) {
    const src = `https://www.youtube.com/embed/${ytId}?enablejsapi=1&rel=0&modestbranding=1`
    return (
      <div className={wrapCls}>
        <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shadow-md">
          <iframe ref={playerRef} src={src} className="w-full h-full"
            allow="autoplay; encrypted-media" allowFullScreen title="Sermon video" />
        </div>
        {label}
      </div>
    )
  }

  if (vimeoId) {
    const src = `https://player.vimeo.com/video/${vimeoId}?api=1&autopause=0`
    return (
      <div className={wrapCls}>
        <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shadow-md">
          <iframe ref={vimeoRef} src={src} className="w-full h-full"
            allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title="Sermon video" />
        </div>
        {label}
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
      <div className={wrapCls}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoElemRef} src={direct} controls
          className="w-full rounded-xl bg-black shadow-md" style={{ maxHeight: 340 }} />
        {label}
      </div>
    )
  }

  return null
}

// ── Clip card ─────────────────────────────────────────────────────────────────

type RenderStatus = 'idle' | 'processing' | 'ready' | 'error'

interface ClipCardProps {
  clip:          SrpClipSelection & { [k: string]: any }
  index:         number
  isPicked:      boolean
  isPinned:      boolean
  isActive:      boolean
  renderStatus:  RenderStatus
  onSelect:      () => void
  onPlay:        () => void
  onPin:         () => void
  onResetRender: () => void
  transcriptWords: any[] | null | undefined
  onUpdateTimes: (startTime: string, endTime: string, quote: string) => void
}

function ClipCard({
  clip, index, isPicked, isPinned, isActive,
  renderStatus, onSelect, onPlay, onPin, onResetRender,
  transcriptWords, onUpdateTimes,
}: ClipCardProps) {
  const [editing, setEditing]       = useState(false)
  const [editStart, setEditStart]   = useState(clip.startTime ?? '')
  const [editEnd, setEditEnd]       = useState(clip.endTime ?? '')
  const catColor = CATEGORY_COLORS[clip.category ?? ''] ?? 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]'

  const durationSec = useMemo(() => {
    if (!clip.startTime || !clip.endTime) return null
    const d = mmssToSeconds(clip.endTime) - mmssToSeconds(clip.startTime)
    return d > 0 ? d : null
  }, [clip.startTime, clip.endTime])

  const duration = durationSec != null ? `${durationSec}s` : null

  const handleSaveEdit = () => {
    const newQuote = sliceQuoteFromWords(transcriptWords, editStart, editEnd) || clip.quote || ''
    onUpdateTimes(editStart, editEnd, newQuote)
    setEditing(false)
    if (renderStatus === 'ready') onResetRender()
  }

  return (
    <div className={[
      'rounded-xl border overflow-hidden transition-colors',
      isActive  ? 'border-[var(--color-primary-purple)] ring-2 ring-[var(--color-primary-purple)]/20 bg-[var(--color-lavender-tint)]/60'
      : isPicked ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]/40'
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
            {renderStatus === 'processing' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] rounded-full px-2 py-0.5">
                <Loader2 size={9} className="animate-spin" /> Rendering…
              </span>
            )}
            {renderStatus === 'ready' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                <CheckCircle2 size={9} /> Rendered
              </span>
            )}
            {renderStatus === 'error' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 rounded-full px-2 py-0.5">
                <AlertCircle size={9} /> Error
              </span>
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
    autoDrafts,
    intelProfile,
    sessionId,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const { clips: processedClips, upsertClip, deleteClip } = useProcessedClips(sessionId)

  // Seed from autoDrafts on first load if no suggestions yet
  useEffect(() => {
    if (clipSuggestions.length === 0 && autoDrafts?.clips?.length) {
      setClipSuggestions(autoDrafts.clips)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const playerRef  = useRef<HTMLIFrameElement | null>(null)
  const [activeStartSec, setActiveStartSec]   = useState<number | null>(null)
  const [activeClipIndex, setActiveClipIndex] = useState<number | null>(null)
  const [generating, setGenerating]           = useState(false)
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
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 90_000)
    try {
      const r = await callSrpApi<GenerateClipsResponse>('generate-clips', {
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        hasTimecodes,
        pinnedQuotes,
        guidance: guidance.trim() || undefined,
        keyInsights: keyInsights.length ? keyInsights : undefined,
      }, { signal: controller.signal })
      // Re-anchor AI timestamps to actual word-level positions
      const anchored = (r.clips ?? []).map(c => {
        const fix = reanchorClip(transcriptWords, c)
        return fix ? { ...c, ...fix } : c
      })
      // Preserve pinned clips, replace the rest
      const pinned = clipSuggestions.filter(c => c.clip_id && pinnedIds.has(c.clip_id))
      const fresh  = anchored.filter(c => !pinnedQuotes.includes(c.quote ?? ''))
      const nextSuggestions = [...pinned, ...fresh]
      setClipSuggestions(nextSuggestions)
      // Drop any saved selections whose quote no longer exists in the new suggestions
      const validQuotes = new Set(nextSuggestions.map(c => c.quote))
      setClipSelections(clipSelectionsRef.current.filter((c: SrpClipSelection) => validQuotes.has(c.quote)))
    } catch (e) {
      const err = e as Error & { errorCode?: string }
      if (err.name === 'AbortError') {
        setGenError('Clip generation timed out. The transcript may be very long — try again or use Manual Entry.')
      } else {
        setGenError(err.errorCode ? `${err.errorCode}: ${err.message}` : err.message)
      }
    } finally {
      clearTimeout(timeoutId)
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, hasTimecodes,
      clipSuggestions, pinnedIds, guidance, keyInsights, setClipSuggestions])

  // Auto-generate only if no suggestions and no autoDraft clips (i.e. background generation hasn't run yet)
  useEffect(() => {
    if (clipSuggestions.length === 0 && !autoDrafts?.clips?.length && transcript && transcript.length > 200 && !generating) {
      void handleGenerate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When suggestions load (or change), drop any saved selections whose quote
  // is no longer present — they're stale from a prior generation run and
  // silently eat up selection slots.
  useEffect(() => {
    if (clipSuggestions.length === 0) return
    const validQuotes = new Set(clipSuggestions.map(c => c.quote))
    const pruned = clipSelectionsRef.current.filter((c: SrpClipSelection) => validQuotes.has(c.quote))
    if (pruned.length !== clipSelectionsRef.current.length) {
      setClipSelections(pruned)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSuggestions])

  // ── Pick / unpick ────────────────────────────────────────────────────────

  // Use a ref so togglePick always sees the latest clipSelections without
  // a stale closure — the context setter is typed as direct (not functional).
  const clipSelectionsRef = useRef(clipSelections)
  clipSelectionsRef.current = clipSelections

  const togglePick = useCallback((clip: SrpClipSelection) => {
    const prev = clipSelectionsRef.current
    const idx = prev.findIndex((c: SrpClipSelection) => c.quote === clip.quote)
    if (idx >= 0) { setClipSelections(prev.filter((_: SrpClipSelection, i: number) => i !== idx)); return }
    if (prev.length >= reelCount) return
    setClipSelections([...prev, assignClipId(clip, prev.length + 1)])
  }, [reelCount, setClipSelections])

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

  // ── Render clip ──────────────────────────────────────────────────────────

  const triggerRender = useCallback(async (clip: SrpClipSelection) => {
    const clipId = (clip as any).clip_id
    if (!clipId || !sessionId || !videoUrl) return
    await upsertClip(clipId, { status: 'processing', error_message: null, video_url: null, clipcutter_job_id: null })
    try {
      const result = await callSrpApi<{ job_id: string }>('start-clipcutter', {
        session_id:  sessionId,
        source_url:  videoUrl,
        source_type: videoSourceType || 'unknown',
        clips: [{
          clip_id:   clipId,
          startTime: clip.startTime,
          endTime:   clip.endTime,
          quote:     clip.quote,
        }],
      })
      await upsertClip(clipId, { clipcutter_job_id: result.job_id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Render failed'
      await upsertClip(clipId, { status: 'error', error_message: msg })
    }
  }, [sessionId, videoUrl, videoSourceType, upsertClip])

  // ── Manual entry ─────────────────────────────────────────────────────────

  const MIN_CLIP_SECONDS = 25

  const handleAddManual = useCallback(() => {
    if (!manualStart || !manualEnd) return
    const durationSec = mmssToSeconds(manualEnd) - mmssToSeconds(manualStart)
    if (durationSec < MIN_CLIP_SECONDS) {
      alert(`Clip must be at least ${MIN_CLIP_SECONDS} seconds long. This one is only ${durationSec}s.`)
      return
    }
    const quote = sliceQuoteFromWords(transcriptWords, manualStart, manualEnd)
    const manual: SrpClipSelection = {
      clip_id:          `manual_${Date.now().toString(36)}`,
      startTime:        manualStart,
      endTime:          manualEnd,
      quote:            quote || `${manualStart} – ${manualEnd}`,
      category:         undefined,
      estimatedSeconds: durationSec,
    } as any
    setClipSuggestions([...clipSuggestions, manual])
    setManualStart(''); setManualEnd(''); setShowManual(false)
  }, [manualStart, manualEnd, transcriptWords, clipSuggestions, setClipSuggestions])


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

      <IntelGuidancePanel title="Sermon Recap Videos" data={intelProfile?.sermon_recap_videos as Record<string, unknown> | null | undefined} />

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
          {/* DEBUG — remove once multiselect verified */}
          {' '}· deliverables: {selectedDeliverables.join(',')}
        </p>
      )}

      {/* Clip list */}
      {clipSuggestions.length > 0 && (
        <ul className="space-y-2">
          {clipSuggestions.map((c, i) => {
            const clipId = (c as any).clip_id ?? `suggestion-${i}`
            const cWithId = { ...c, clip_id: clipId }
            const pc = processedClips[clipId]
            const renderStatus: RenderStatus = pc?.status === 'ready' ? 'ready'
              : pc?.status === 'processing' ? 'processing'
              : pc?.status === 'error'      ? 'error'
              : 'idle'
            return (
              <li key={clipId}>
                <ClipCard
                  clip={cWithId}
                  index={i}
                  isPicked={isPicked(c)}
                  isPinned={pinnedIds.has(clipId)}
                  isActive={activeClipIndex === i}
                  renderStatus={renderStatus}
                  onSelect={() => togglePick(cWithId)}
                  onPlay={() => {
                    if (c.startTime) seekAndPlay(mmssToSeconds(c.startTime))
                    setActiveClipIndex(i)
                  }}
                  onPin={() => togglePin(clipId)}
                  onResetRender={() => void deleteClip(clipId)}
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

      {/* Render tray — appears when a clip is active */}
      {activeClipIndex !== null && (() => {
        const activeClip   = clipSuggestions[activeClipIndex] as SrpClipSelection & { [k: string]: any }
        if (!activeClip) return null
        const activeClipId = activeClip.clip_id ?? `suggestion-${activeClipIndex}`
        const pc           = processedClips[activeClipId]
        const status: RenderStatus = pc?.status === 'ready' ? 'ready'
          : pc?.status === 'processing' ? 'processing'
          : pc?.status === 'error'      ? 'error'
          : 'idle'
        return (
          <div className="sticky bottom-0 z-20 -mx-1 rounded-2xl border border-[var(--color-primary-purple)]/30 bg-[var(--color-deep-plum)] shadow-2xl px-4 py-3 flex items-center gap-4">
            {/* Clip info */}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-lavender)] mb-0.5">
                Clip {activeClipIndex + 1}
                {activeClip.startTime && activeClip.endTime && (
                  <span className="ml-2 font-mono normal-case tracking-normal text-[var(--color-lavender)]/70">
                    {activeClip.startTime} → {activeClip.endTime}
                  </span>
                )}
              </p>
              <p className="text-[12px] text-white/90 truncate leading-snug">
                "{activeClip.quote}"
              </p>
              {status === 'ready' && (
                <p className="text-[10px] text-green-400 mt-0.5 flex items-center gap-1">
                  <CheckCircle2 size={10} /> Rendered — video ready for creative direction
                </p>
              )}
              {status === 'error' && pc?.error_message && (
                <p className="text-[10px] text-red-400 mt-0.5 flex items-center gap-1">
                  <AlertCircle size={10} /> {pc.error_message}
                </p>
              )}
            </div>

            {/* Render button */}
            {status === 'processing' ? (
              <div className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 text-white text-[13px] font-semibold">
                <Loader2 size={15} className="animate-spin" /> Rendering…
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void triggerRender({ ...activeClip, clip_id: activeClipId })}
                className={[
                  'shrink-0 flex items-center gap-2 px-6 py-2.5 rounded-full text-[13px] font-bold transition-colors',
                  status === 'ready'
                    ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                    : 'bg-[var(--color-primary-purple)] text-white hover:bg-[var(--color-purple-mid)]',
                ].join(' ')}
              >
                <Clapperboard size={15} />
                {status === 'ready' ? 'Re-render' : status === 'error' ? 'Retry render' : 'Render clip'}
              </button>
            )}
          </div>
        )
      })()}

      {/* Nav */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          Continue{clipSelections.length > 0 ? ` (${clipSelections.length} clip${clipSelections.length === 1 ? '' : 's'})` : ''}
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
