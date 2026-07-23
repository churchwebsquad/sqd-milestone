/**
 * Pre-render review step — shows cut clip videos with synced transcript.
 *
 * Features per clip:
 *   - Video player with caption overlay + title card image overlay
 *   - Editable caption segments (click pencil → edit → save)
 *   - Manual segment entry (add a time range + text)
 *   - Title card upload (image overlaid on video between two timestamps)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2, CheckCircle2, AlertCircle, Film, ShieldCheck,
  ArrowLeft, ArrowRight, Pencil, Check, X, Plus, Image, Trash2,
} from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { useProcessedClips } from '../../../hooks/useProcessedClips'
import { supabase } from '../../../lib/supabase'

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

function msToSeconds(ms: number) { return ms / 1000 }
function secondsToMs(s: number) { return Math.round(s * 1000) }

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

function reindexSegments(segs: SrtSegment[]): SrtSegment[] {
  return segs
    .slice()
    .sort((a, b) => a.startSec - b.startSec)
    .map((s, i) => ({ ...s, index: i + 1 }))
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────

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
  sessionId:   string
  clipTitle?:  string | null
  startTime?:  string | null
  endTime?:    string | null
  quote?:      string | null
  videoUrl:    string | null | undefined
  transcript:  string | null | undefined
  transcriptApproved?: boolean | null
  status:      'processing' | 'ready' | 'error' | 'pending'
  errorMsg?:   string | null
  createdAt?:  string | null
  titleCardUrl?:     string | null
  titleCardStartMs?: number | null
  titleCardEndMs?:   number | null
  words:       { word: string; start: number; end: number }[]
  onSaveTranscript:    (clipId: string, segments: SrtSegment[]) => Promise<void>
  onApproveTranscript: (clipId: string, segments: SrtSegment[]) => Promise<void>
  onUnapproveTranscript:(clipId: string) => Promise<void>
  onSaveTitleCard:     (clipId: string, url: string, startMs: number, endMs: number) => Promise<void>
  onRemoveTitleCard:   (clipId: string) => Promise<void>
}

function ClipCard({
  idx, clipId, sessionId, clipTitle, startTime, endTime, quote,
  videoUrl, transcript, transcriptApproved, status, errorMsg, createdAt, words,
  titleCardUrl, titleCardStartMs, titleCardEndMs,
  onSaveTranscript, onApproveTranscript, onUnapproveTranscript,
  onSaveTitleCard, onRemoveTitleCard,
}: ClipCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const listRef  = useRef<HTMLUListElement>(null)
  const [currentTime, setCurrentTime] = useState(0)

  const clipStartSec = mmssToSeconds(startTime)
  const clipEndSec   = mmssToSeconds(endTime)

  // ── Segments state ─────────────────────────────────────────────────────────

  const initialSegments = (() => {
    if (transcript) {
      try {
        const parsed = JSON.parse(transcript)
        if (Array.isArray(parsed) && parsed.length > 0 && 'startSec' in parsed[0]) {
          return parsed as SrtSegment[]
        }
        if (Array.isArray(parsed) && parsed.length > 0) {
          const w = parsed.map((p: { word?: string; text?: string; start: number; end: number }) => ({
            word: p.word ?? p.text ?? '', start: p.start, end: p.end,
          }))
          return buildSrtSegments(w, clipStartSec, clipEndSec)
        }
      } catch { /* fall through */ }
    }
    if (words.length > 0 && clipStartSec < clipEndSec) {
      return buildSrtSegments(words, clipStartSec, clipEndSec)
    }
    return []
  })()

  const [segments, setSegments]         = useState<SrtSegment[]>(initialSegments)
  const [editingIdx, setEditingIdx]     = useState<number | null>(null)
  const [editText, setEditText]         = useState('')
  const [savingTranscript, setSavingTranscript]   = useState(false)
  const [transcriptDirty, setTranscriptDirty]     = useState(false)
  const [approved, setApproved]               = useState(!!transcriptApproved)
  const [approvingSaving, setApprovingSaving] = useState(false)

  // Sync with Supabase data — prop arrives async after mount so useState
  // initial value is always false on remount; this corrects it once data loads.
  useEffect(() => {
    setApproved(!!transcriptApproved)
  }, [transcriptApproved])

  // Manual segment add
  const [showAddSeg, setShowAddSeg]   = useState(false)
  const [newSegStart, setNewSegStart] = useState('')
  const [newSegEnd, setNewSegEnd]     = useState('')
  const [newSegText, setNewSegText]   = useState('')

  // Title card
  const [tcUrl, setTcUrl]               = useState(titleCardUrl ?? '')
  const [tcStartRaw, setTcStartRaw]     = useState(titleCardStartMs != null ? toMMSS(msToSeconds(titleCardStartMs)) : '')
  const [tcEndRaw, setTcEndRaw]         = useState(titleCardEndMs   != null ? toMMSS(msToSeconds(titleCardEndMs))   : '')

  // Sync title card state from Supabase after remount (same fix as approved)
  useEffect(() => {
    setTcUrl(titleCardUrl ?? '')
  }, [titleCardUrl])
  useEffect(() => {
    setTcStartRaw(titleCardStartMs != null ? toMMSS(msToSeconds(titleCardStartMs)) : '')
  }, [titleCardStartMs])
  useEffect(() => {
    setTcEndRaw(titleCardEndMs != null ? toMMSS(msToSeconds(titleCardEndMs)) : '')
  }, [titleCardEndMs])
  const [tcUploading, setTcUploading]   = useState(false)
  const [tcSaving, setTcSaving]         = useState(false)
  const [tcDirty, setTcDirty]           = useState(false)
  const tcFileRef = useRef<HTMLInputElement>(null)

  const tcStartSec = mmssToSeconds(tcStartRaw)
  const tcEndSec   = mmssToSeconds(tcEndRaw)
  const showTitleCard = !!tcUrl && tcStartSec < tcEndSec &&
    currentTime >= tcStartSec && currentTime < tcEndSec

  // ── Active segment ────────────────────────────────────────────────────────

  const activeIdx = segments.findIndex(
    s => currentTime >= s.startSec - 0.1 && currentTime < s.endSec + 0.1,
  )
  const activeSeg = activeIdx >= 0 ? segments[activeIdx] : null

  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return
    const li = listRef.current.children[activeIdx] as HTMLLIElement | undefined
    li?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])

  const seekTo = useCallback((sec: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = sec
    videoRef.current.play().catch(() => {})
  }, [])

  // ── Segment edit helpers ──────────────────────────────────────────────────

  const startEdit = (i: number) => {
    setEditingIdx(i)
    setEditText(segments[i].text)
  }

  const commitEdit = () => {
    if (editingIdx === null) return
    setSegments(prev => {
      const next = prev.map((s, i) => i === editingIdx ? { ...s, text: editText.trim() } : s)
      return next
    })
    setEditingIdx(null)
    setTranscriptDirty(true)
  }

  const deleteSegment = (i: number) => {
    setSegments(prev => reindexSegments(prev.filter((_, idx) => idx !== i)))
    setTranscriptDirty(true)
  }

  const addManualSegment = () => {
    if (!newSegStart || !newSegEnd || !newSegText.trim()) return
    const startSec = mmssToSeconds(newSegStart)
    const endSec   = mmssToSeconds(newSegEnd)
    if (endSec <= startSec) return
    const next = reindexSegments([
      ...segments,
      { index: 0, startSec, endSec, text: newSegText.trim() },
    ])
    setSegments(next)
    setNewSegStart('')
    setNewSegEnd('')
    setNewSegText('')
    setShowAddSeg(false)
    setTranscriptDirty(true)
  }

  const saveTranscript = async () => {
    setSavingTranscript(true)
    await onSaveTranscript(clipId, segments)
    setSavingTranscript(false)
    setTranscriptDirty(false)
  }

  const approveTranscript = async () => {
    setApprovingSaving(true)
    await onApproveTranscript(clipId, segments)
    setApproved(true)
    setTranscriptDirty(false)
    setApprovingSaving(false)
  }

  const unapproveTranscript = async () => {
    setApprovingSaving(true)
    await onUnapproveTranscript(clipId)
    setApproved(false)
    setApprovingSaving(false)
  }

  // ── Title card helpers ────────────────────────────────────────────────────

  const handleTcFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setTcUploading(true)
    try {
      const ext  = file.name.split('.').pop() ?? 'png'
      const path = `${sessionId}/${clipId}/title-card.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase as any).storage
        .from('srp-title-cards')
        .upload(path, file, { upsert: true })
      if (upErr) throw upErr
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: { publicUrl } } = (supabase as any).storage
        .from('srp-title-cards')
        .getPublicUrl(path)
      setTcUrl(publicUrl)
      setTcDirty(true)
    } catch (err) {
      console.error('Title card upload failed:', err)
      alert('Upload failed — please try again.')
    } finally {
      setTcUploading(false)
    }
  }

  const saveTitleCard = async () => {
    if (!tcUrl || !tcStartRaw || !tcEndRaw) return
    setTcSaving(true)
    await onSaveTitleCard(clipId, tcUrl, secondsToMs(tcStartSec), secondsToMs(tcEndSec))
    setTcSaving(false)
    setTcDirty(false)
  }

  const removeTitleCard = async () => {
    setTcUrl('')
    setTcStartRaw('')
    setTcEndRaw('')
    setTcDirty(false)
    await onRemoveTitleCard(clipId)
  }

  // ── Loading state ─────────────────────────────────────────────────────────

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

  // ── Error state ───────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-2">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle size={15} />
          <p className="text-[13px] font-bold">
            Clip {idx + 1}{clipTitle ? ` — ${clipTitle}` : ''} failed to process
          </p>
        </div>
        {errorMsg && <p className="text-[12px] text-red-500 pl-5">{errorMsg}</p>}
        <p className="text-[11px] text-red-400 pl-5">
          Go back to Clip Selection and use Retry to resubmit this clip.
        </p>
      </div>
    )
  }

  // ── Ready state ───────────────────────────────────────────────────────────

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

      {/* Body */}
      <div className="flex flex-col lg:flex-row">

        {/* ── Left: Video + Title Card ── */}
        <div className="lg:w-[50%] shrink-0 p-3 lg:border-r border-b lg:border-b-0 border-[var(--color-lavender)] space-y-3">
          <div className="sticky top-2 space-y-3">

            {/* Video with overlays */}
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

              {/* Title card overlay */}
              {showTitleCard && (
                <img
                  src={tcUrl}
                  alt="Title card"
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                />
              )}

              {/* Caption overlay */}
              {activeSeg && activeSeg.text && !showTitleCard && (
                <div className="absolute bottom-6 left-0 right-0 flex justify-center px-4 pointer-events-none">
                  <p className="bg-black/75 text-white text-[13px] font-bold px-3 py-1.5 rounded-lg text-center leading-snug max-w-[90%]">
                    {activeSeg.text}
                  </p>
                </div>
              )}
            </div>

            <p className="text-center text-[10px] text-[var(--color-purple-gray)] font-mono">
              {toMMSS(currentTime)}
              {activeSeg && (
                <span className="ml-2 text-[var(--color-primary-purple)]">
                  — segment {activeSeg.index}
                </span>
              )}
            </p>

            {/* Title Card section */}
            <div className="rounded-lg border border-[var(--color-lavender)] p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] flex items-center gap-1.5">
                <Image size={10} /> Title Card
              </p>

              {tcUrl && (
                <div className="relative rounded overflow-hidden border border-[var(--color-lavender)]">
                  <img src={tcUrl} alt="Title card preview" className="w-full object-contain max-h-24 bg-black" />
                  <button
                    onClick={removeTitleCard}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {!tcUrl && (
                <button
                  onClick={() => tcFileRef.current?.click()}
                  disabled={tcUploading}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[var(--color-lavender)] rounded-lg text-[12px] text-[var(--color-purple-gray)] hover:border-[var(--color-primary-purple)] hover:text-[var(--color-primary-purple)] transition-colors"
                >
                  {tcUploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  {tcUploading ? 'Uploading…' : 'Upload title card image'}
                </button>
              )}

              <input
                ref={tcFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleTcFileChange}
              />

              {tcUrl && (
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-[var(--color-purple-gray)] font-semibold">Start</label>
                      <input
                        type="text"
                        placeholder="0:00"
                        value={tcStartRaw}
                        onChange={e => { setTcStartRaw(e.target.value); setTcDirty(true) }}
                        className="w-full mt-0.5 px-2 py-1 text-[12px] font-mono border border-[var(--color-lavender)] rounded-md focus:outline-none focus:border-[var(--color-primary-purple)]"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-[var(--color-purple-gray)] font-semibold">End</label>
                      <input
                        type="text"
                        placeholder="0:05"
                        value={tcEndRaw}
                        onChange={e => { setTcEndRaw(e.target.value); setTcDirty(true) }}
                        className="w-full mt-0.5 px-2 py-1 text-[12px] font-mono border border-[var(--color-lavender)] rounded-md focus:outline-none focus:border-[var(--color-primary-purple)]"
                      />
                    </div>
                  </div>
                  {tcDirty && (
                    <button
                      onClick={saveTitleCard}
                      disabled={tcSaving || !tcStartRaw || !tcEndRaw}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[var(--color-primary-purple)] text-white text-[12px] font-semibold hover:bg-[var(--color-purple-mid)] disabled:opacity-50 transition-colors"
                    >
                      {tcSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Save title card
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Transcript ── */}
        <div className="flex-1 p-4 flex flex-col gap-3">

          {/* Header row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                Transcript
              </p>
              {approved && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold uppercase tracking-wider">
                  <ShieldCheck size={10} /> Source of truth
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!approved && transcriptDirty && (
                <button
                  onClick={saveTranscript}
                  disabled={savingTranscript}
                  className="flex items-center gap-1 px-3 py-1 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)] border border-[var(--color-lavender)] text-[11px] font-semibold hover:border-[var(--color-primary-purple)] disabled:opacity-50 transition-colors"
                >
                  {savingTranscript ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  Save draft
                </button>
              )}
              {approved ? (
                <button
                  onClick={unapproveTranscript}
                  disabled={approvingSaving}
                  className="flex items-center gap-1 px-3 py-1 rounded-full border border-[var(--color-lavender)] text-[var(--color-purple-gray)] text-[11px] font-semibold hover:text-[var(--color-deep-plum)] hover:border-[var(--color-deep-plum)] disabled:opacity-50 transition-colors"
                >
                  {approvingSaving ? <Loader2 size={11} className="animate-spin" /> : <Pencil size={11} />}
                  Edit
                </button>
              ) : (
                <button
                  onClick={approveTranscript}
                  disabled={approvingSaving || segments.length === 0}
                  className="flex items-center gap-1 px-3 py-1 rounded-full bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {approvingSaving ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                  Approve captions
                </button>
              )}
            </div>
          </div>

          {/* Approved banner */}
          {approved && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-700">
              These captions are locked as the source of truth. They will be used for all downstream steps. Click <strong>Edit</strong> to make changes, then re-approve.
            </div>
          )}

          {segments.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-[var(--color-lavender)] bg-[var(--color-lavender-tint)] py-8 text-center">
              <p className="text-[12px] text-[var(--color-purple-gray)]">
                No transcript available — add segments manually below.
              </p>
            </div>
          ) : (
            <ul ref={listRef} className="space-y-1 overflow-y-auto max-h-[360px] pr-1">
              {segments.map((seg, i) => {
                const isActive  = i === activeIdx
                const isEditing = !approved && editingIdx === i
                return (
                  <li key={seg.index} className={[
                    'flex items-start gap-2 px-3 py-2 rounded-lg transition-colors',
                    isActive && !isEditing
                      ? 'bg-[#6B5CE7] text-white'
                      : 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]',
                  ].join(' ')}>
                    <button
                      onClick={() => seekTo(seg.startSec)}
                      className={[
                        'text-[10px] font-mono shrink-0 mt-0.5 w-8 text-right hover:underline',
                        isActive && !isEditing ? 'text-white/70' : 'text-[var(--color-purple-gray)]',
                      ].join(' ')}
                    >
                      {toMMSS(seg.startSec)}
                    </button>

                    {isEditing ? (
                      <textarea
                        autoFocus
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={2}
                        className="flex-1 text-[12px] px-2 py-1 rounded border border-[var(--color-primary-purple)] bg-white text-[var(--color-deep-plum)] resize-none focus:outline-none"
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit() }
                          if (e.key === 'Escape') setEditingIdx(null)
                        }}
                      />
                    ) : (
                      <span
                        className="flex-1 text-[13px] leading-snug cursor-pointer"
                        onClick={() => seekTo(seg.startSec)}
                      >
                        {seg.text}
                      </span>
                    )}

                    {/* Actions — hidden when approved */}
                    {!approved && (
                      <div className="flex gap-1 shrink-0 mt-0.5">
                        {isEditing ? (
                          <>
                            <button onClick={commitEdit} className="p-0.5 rounded hover:text-green-600">
                              <Check size={13} />
                            </button>
                            <button onClick={() => setEditingIdx(null)} className="p-0.5 rounded hover:text-red-500">
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(i)}
                              className={['p-0.5 rounded opacity-50 hover:opacity-100', isActive ? 'text-white' : ''].join(' ')}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => deleteSegment(i)}
                              className={['p-0.5 rounded opacity-50 hover:opacity-100 hover:text-red-500', isActive ? 'text-white' : ''].join(' ')}
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* Add segment — hidden when approved */}
          {!approved && (
            showAddSeg ? (
              <div className="rounded-lg border border-[var(--color-lavender)] p-3 space-y-2 bg-[var(--color-lavender-tint)]">
                <p className="text-[11px] font-bold text-[var(--color-deep-plum)]">Add segment</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-[var(--color-purple-gray)] font-semibold">Start (M:SS)</label>
                    <input
                      type="text" placeholder="0:30"
                      value={newSegStart}
                      onChange={e => setNewSegStart(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1 text-[12px] font-mono border border-[var(--color-lavender)] rounded-md focus:outline-none focus:border-[var(--color-primary-purple)] bg-white"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-[var(--color-purple-gray)] font-semibold">End (M:SS)</label>
                    <input
                      type="text" placeholder="0:35"
                      value={newSegEnd}
                      onChange={e => setNewSegEnd(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1 text-[12px] font-mono border border-[var(--color-lavender)] rounded-md focus:outline-none focus:border-[var(--color-primary-purple)] bg-white"
                    />
                  </div>
                </div>
                <textarea
                  placeholder="Caption text for this segment…"
                  value={newSegText}
                  onChange={e => setNewSegText(e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 text-[12px] border border-[var(--color-lavender)] rounded-md resize-none focus:outline-none focus:border-[var(--color-primary-purple)] bg-white"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addManualSegment}
                    disabled={!newSegStart || !newSegEnd || !newSegText.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--color-primary-purple)] text-white text-[12px] font-semibold hover:bg-[var(--color-purple-mid)] disabled:opacity-40 transition-colors"
                  >
                    <Plus size={12} /> Add
                  </button>
                  <button
                    onClick={() => setShowAddSeg(false)}
                    className="px-3 py-1.5 rounded-full text-[12px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddSeg(true)}
                className="flex items-center gap-1.5 text-[12px] text-[var(--color-primary-purple)] hover:text-[var(--color-deep-plum)] transition-colors self-start"
              >
                <Plus size={13} /> Add segment manually
              </button>
            )
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

  const { clips: processedClips, upsertClip } = useProcessedClips(sessionId)

  const words: { word: string; start: number; end: number }[] = (() => {
    if (!Array.isArray(transcriptWords)) return []
    return (transcriptWords as unknown[]).map((w: unknown) => {
      const obj = w as Record<string, unknown>
      return {
        word:  typeof obj.word  === 'string' ? obj.word  : typeof obj.text === 'string' ? obj.text : String(obj.word ?? obj.text ?? ''),
        start: typeof obj.start === 'number' ? obj.start : Number(obj.start ?? 0),
        end:   typeof obj.end   === 'number' ? obj.end   : Number(obj.end   ?? 0),
      }
    })
  })()

  const atLeastOneReady = Object.values(processedClips).some(pc => pc.status === 'ready')

  const handleSaveTranscript = useCallback(async (clipId: string, segments: SrtSegment[]) => {
    await upsertClip(clipId, { transcript: JSON.stringify(segments) })
  }, [upsertClip])

  const handleApproveTranscript = useCallback(async (clipId: string, segments: SrtSegment[]) => {
    await upsertClip(clipId, { transcript: JSON.stringify(segments), transcript_approved: true })
  }, [upsertClip])

  const handleUnapproveTranscript = useCallback(async (clipId: string) => {
    await upsertClip(clipId, { transcript_approved: false })
  }, [upsertClip])

  const handleSaveTitleCard = useCallback(async (
    clipId: string, url: string, startMs: number, endMs: number,
  ) => {
    await upsertClip(clipId, {
      title_card_url:      url,
      title_card_start_ms: startMs,
      title_card_end_ms:   endMs,
    })
  }, [upsertClip])

  const handleRemoveTitleCard = useCallback(async (clipId: string) => {
    await upsertClip(clipId, {
      title_card_url:      null,
      title_card_start_ms: null,
      title_card_end_ms:   null,
    })
  }, [upsertClip])

  return (
    <div className="space-y-6 pb-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-primary-purple)] flex items-center gap-1.5">
          <Film size={12} /> Transcript review
        </p>
        <h2 className="text-[22px] font-bold text-[var(--color-deep-plum)] mt-0.5">
          Review your cut clips
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          Watch each clip, edit captions, add a title card, and fill in any missing segments.
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
            const clipId = (clip as any).clip_id ?? `selection-${idx}`
            const pc     = processedClips[clipId]
            const status = pc?.status === 'ready'      ? 'ready'
                         : pc?.status === 'processing' ? 'processing'
                         : pc?.status === 'error'      ? 'error'
                         : 'pending'
            return (
              <ClipCard
                key={clipId}
                idx={idx}
                clipId={clipId}
                sessionId={sessionId ?? ''}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                clipTitle={(clip as any).clip_title ?? null}
                startTime={clip.startTime}
                endTime={clip.endTime}
                quote={clip.quote}
                videoUrl={pc?.video_url}
                transcript={pc?.transcript}
                transcriptApproved={pc?.transcript_approved}
                status={status}
                errorMsg={pc?.error_message}
                createdAt={pc?.created_at}
                titleCardUrl={pc?.title_card_url}
                titleCardStartMs={pc?.title_card_start_ms}
                titleCardEndMs={pc?.title_card_end_ms}
                words={words}
                onSaveTranscript={handleSaveTranscript}
                onApproveTranscript={handleApproveTranscript}
                onUnapproveTranscript={handleUnapproveTranscript}
                onSaveTitleCard={handleSaveTitleCard}
                onRemoveTitleCard={handleRemoveTitleCard}
              />
            )
          })}
        </div>
      )}

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
