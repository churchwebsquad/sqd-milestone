/**
 * Reel captions generator. Two phases inside one panel:
 *
 *   1. Pick clips: if no clip_selections exist yet, prompt to call
 *      generate-clips. Result shows 4-6 candidates, strategist picks 2.
 *   2. Per-clip caption: for each picked clip, call generate-reel-caption.
 *      Output saves to reel1_caption / reel2_caption.
 *
 * Re-running clip generation is allowed (overwrites the candidates)
 * but only the captions for currently-picked clips persist.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Loader2, Play, RefreshCw, Save, Scissors, Sparkles, X } from 'lucide-react'
import { parseClipSelections, updateSession, type ClipSelection } from '../../../lib/srpSessions'
import { deepLinkAtTime, validateMediaUrl } from '../../../lib/mediaUrlValidator'
import { supabase } from '../../../lib/supabase'
import { getSession } from '../../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../../types/database'
import { useSrpGenerator } from './useSrpGenerator'
import { ClipPreview } from '../ClipPreview'

interface ClipCandidate extends ClipSelection {
  label?: string
  wordCount?: number
  video_url?: string | null
  srt_url?: string | null
  processing_status?: 'queued' | 'done' | 'failed' | null
  processing_error?: string | null
}

export function ReelCaptionsGenerator({ session, onChange }: {
  session: SmsSrpGeneration
  onChange: () => void
}) {
  const { busy, error, lastTook, call } = useSrpGenerator()
  const [pickedIxs, setPickedIxs] = useState<number[]>([])

  const candidates = useMemo<ClipCandidate[]>(() => {
    return parseClipSelections(session.clip_selections) as ClipCandidate[]
  }, [session.clip_selections])

  useEffect(() => {
    // Initialize picked indexes from the first 2 candidates by default,
    // unless they're already picked (preserve order across re-renders).
    if (candidates.length > 0 && pickedIxs.length === 0) {
      setPickedIxs([0, 1].filter(i => i < candidates.length))
    }
  }, [candidates.length, pickedIxs.length])

  const togglePicked = useCallback((ix: number) => {
    setPickedIxs(prev => {
      if (prev.includes(ix)) return prev.filter(i => i !== ix)
      if (prev.length >= 2) return [prev[1], ix]  // sliding window of 2
      return [...prev, ix]
    })
  }, [])

  const generateClips = useCallback(async () => {
    await call('generate-clips', {
      sessionId:  session.session_id,
      transcript: session.transcript ?? '',
      churchName: session.church_name ?? '',
    })
    setPickedIxs([])
    onChange()
  }, [call, session.session_id, session.transcript, session.church_name, onChange])

  const generateCaption = useCallback(async (clipNumber: 1 | 2) => {
    const ix = pickedIxs[clipNumber - 1]
    if (ix == null) return
    const clip = candidates[ix]
    if (!clip) return
    await call('generate-reel-caption', {
      sessionId:   session.session_id,
      clipNumber,
      quote:       clip.quote,
      category:    clip.category,
      label:       clip.label,
      churchName:  session.church_name ?? '',
      sermonContext: session.transcript?.slice(0, 8000) ?? '',
    })
    onChange()
  }, [call, candidates, pickedIxs, session.session_id, session.church_name, session.transcript, onChange])

  // ── Clipcutter: render the picked clips into MP4s via n8n ─────────
  const [cutting, setCutting] = useState(false)
  const [cutError, setCutError] = useState<string | null>(null)
  const [cutElapsed, setCutElapsed] = useState(0)
  const cutStartRef = useRef<number | null>(null)
  const cutAbortRef = useRef(false)
  // Per-reel inline preview toggle. null = closed; 'rendered' = play the
  // clipcutter MP4; 'source' = play the original video at the clip's
  // in-point.
  const [previewing, setPreviewing] = useState<Record<number, 'rendered' | 'source' | null>>({})

  useEffect(() => {
    if (!cutting || !cutStartRef.current) return
    const tick = () => setCutElapsed(Math.floor((Date.now() - cutStartRef.current!) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [cutting])

  const validatedVideo = useMemo(() => {
    if (!session.video_url) return null
    const v = validateMediaUrl(session.video_url)
    return v.ok ? v : null
  }, [session.video_url])

  const startClipcutter = useCallback(async () => {
    setCutError(null)
    if (!session.video_url) { setCutError('No video URL on this session. Paste one in Sermon input first.'); return }
    if (pickedIxs.length === 0) { setCutError('Pick at least one clip first.'); return }
    const pickedClipIds = pickedIxs.map(ix => String(candidates[ix]?.clip_id ?? '')).filter(Boolean)
    if (pickedClipIds.length === 0) { setCutError('Picked clips are missing clip_id values — re-run "Find clip moments".'); return }

    setCutting(true)
    cutStartRef.current = Date.now()
    cutAbortRef.current = false

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const r = await fetch('/api/srp/start-clipcutter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ sessionId: session.session_id, pickedClipIds }),
      })
      const text = await r.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status}`)

      // Poll for clip processing_status to flip from 'queued' to 'done' / 'failed'.
      const maxMs = 15 * 60 * 1000
      const intervalMs = 6000
      const start = Date.now()
      while (!cutAbortRef.current && Date.now() - start < maxMs) {
        await new Promise(res => setTimeout(res, intervalMs))
        const fresh = await getSession(session.session_id)
        const updated = parseClipSelections(fresh?.clip_selections) as ClipCandidate[]
        const queuedRemaining = updated.filter(c => c.processing_status === 'queued' && pickedClipIds.includes(String(c.clip_id))).length
        if (queuedRemaining === 0) {
          onChange()
          return
        }
        onChange()
      }
      if (!cutAbortRef.current) {
        setCutError('Clipcutter is taking longer than 15 minutes. Check the n8n workflow.')
      }
    } catch (e) {
      setCutError(e instanceof Error ? e.message : 'Failed to start clipcutter')
    } finally {
      setCutting(false)
      cutStartRef.current = null
    }
  }, [session.session_id, session.video_url, candidates, pickedIxs, onChange])

  const cancelCutPolling = useCallback(() => {
    cutAbortRef.current = true
    setCutting(false)
  }, [])

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated">
      <header className="px-4 py-3 border-b border-wm-border">
        <h3 className="text-[14px] font-semibold text-wm-text">Reel captions</h3>
        <p className="text-[11px] text-wm-text-muted mt-0.5">Pick 2 clip moments from the transcript, then generate a short caption for each.</p>
      </header>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void generateClips()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white font-semibold disabled:opacity-50"
          >
            {busy
              ? <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
              : candidates.length === 0
                ? <><Sparkles size={12} /> Find clip moments</>
                : <><RefreshCw size={12} /> Re-analyze</>}
          </button>
          {lastTook != null && !busy && (
            <span className="text-[11px] text-wm-text-subtle">Last run: {lastTook}s</span>
          )}
          {error && <span className="text-[11px] text-wm-danger">{error}</span>}
          {candidates.length > 0 && (
            <span className="text-[11px] text-wm-text-muted ml-auto">
              {pickedIxs.length} of 2 picked
            </span>
          )}
        </div>

        {candidates.length === 0 && !busy && (
          <p className="text-[12px] text-wm-text-muted italic">Click "Find clip moments" to surface candidate clips from the sermon.</p>
        )}

        {candidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">Candidates</p>
            {candidates.map((c, ix) => {
              const isPicked = pickedIxs.includes(ix)
              const pickedSlot = isPicked ? pickedIxs.indexOf(ix) + 1 : null
              return (
                <button
                  key={ix}
                  onClick={() => togglePicked(ix)}
                  className={[
                    'w-full text-left rounded-md border px-3 py-2.5 transition-colors',
                    isPicked ? 'border-wm-accent bg-wm-accent/5' : 'border-wm-border bg-wm-bg hover:bg-wm-accent/5',
                  ].join(' ')}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <div className="flex items-baseline gap-2">
                      {isPicked && pickedSlot != null && (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-wm-accent-strong bg-wm-accent/10 px-1.5 py-0.5 rounded">
                          Reel {pickedSlot}
                        </span>
                      )}
                      {c.category && (
                        <span className="text-[10px] uppercase tracking-wider text-wm-text-subtle">{c.category}</span>
                      )}
                      {c.label && (
                        <span className="text-[12px] font-semibold text-wm-text">{c.label}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-wm-text-subtle">
                      {c.startTime != null && c.endTime != null
                        ? `${formatTime(c.startTime)} – ${formatTime(c.endTime)} (${Math.round(c.endTime - c.startTime)}s)`
                        : c.wordCount != null
                          ? `${c.wordCount} words`
                          : ''}
                    </span>
                  </div>
                  <p className="text-[12px] text-wm-text italic leading-snug">"{c.quote}"</p>
                </button>
              )
            })}
          </div>
        )}

        {pickedIxs.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-wm-border">
            {/* Clipcutter — render picked clips into MP4s */}
            <div className="rounded-md border border-wm-border bg-wm-bg p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">Clipcutter</p>
                <span className="text-[10px] text-wm-text-subtle">
                  {pickedIxs.filter(ix => candidates[ix]?.processing_status === 'done').length} of {pickedIxs.length} rendered
                </span>
              </div>
              <p className="text-[11px] text-wm-text-muted leading-snug">
                Render the picked clip moments into MP4s via the n8n clipcutter workflow.
                Output URLs land back on each clip and surface in the deliverables panel.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void startClipcutter()}
                  disabled={cutting || !validatedVideo}
                  className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white font-semibold disabled:opacity-50"
                >
                  {cutting ? <><Loader2 size={12} className="animate-spin" /> Rendering…</> : <><Scissors size={12} /> Cut clips</>}
                </button>
                {!validatedVideo && (
                  <span className="text-[11px] text-wm-warning">Add a valid video URL in Sermon input first.</span>
                )}
                {cutting && (
                  <>
                    <span className="text-[11px] text-wm-text-muted">
                      {cutElapsed < 60 ? 'Queued…' : cutElapsed < 300 ? 'Rendering clips (typical 3-7 min)…' : 'Still rendering. Long for this many clips.'}
                    </span>
                    <span className="text-[10px] font-mono text-wm-text-subtle">{Math.floor(cutElapsed / 60)}:{String(cutElapsed % 60).padStart(2, '0')}</span>
                    <button type="button" onClick={cancelCutPolling} className="text-wm-text-muted hover:text-wm-text" title="Stop polling (n8n continues in background)">
                      <X size={12} />
                    </button>
                  </>
                )}
                {cutError && !cutting && (
                  <span className="text-[11px] text-wm-danger">{cutError}</span>
                )}
              </div>
              {/* Per-clip render status + preview controls */}
              {pickedIxs.length > 0 && (
                <ul className="space-y-2 pt-1">
                  {pickedIxs.map((ix, slot) => {
                    const c = candidates[ix]
                    if (!c) return null
                    const deepLink = validatedVideo
                      ? deepLinkAtTime(validatedVideo.sourceType as any, validatedVideo.normalizedUrl, c.startTime)
                      : null
                    const previewMode = previewing[ix] ?? null
                    return (
                      <li key={ix} className="space-y-1.5">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-wm-text-subtle">Reel {slot + 1}</span>
                          <span className="text-wm-text-muted">·</span>
                          <ClipStatusBadge status={c.processing_status ?? null} />
                          {c.video_url && (
                            <button
                              type="button"
                              onClick={() => setPreviewing(p => ({ ...p, [ix]: previewMode === 'rendered' ? null : 'rendered' }))}
                              className="text-wm-accent-strong inline-flex items-center gap-0.5 hover:underline"
                            >
                              <Play size={10} /> {previewMode === 'rendered' ? 'Hide MP4' : 'Preview MP4'}
                            </button>
                          )}
                          {validatedVideo && (
                            <button
                              type="button"
                              onClick={() => setPreviewing(p => ({ ...p, [ix]: previewMode === 'source' ? null : 'source' }))}
                              className="text-wm-text-muted inline-flex items-center gap-0.5 hover:underline"
                            >
                              <Play size={10} /> {previewMode === 'source' ? 'Hide source' : 'Preview source'}
                            </button>
                          )}
                          {c.video_url && (
                            <a href={c.video_url} target="_blank" rel="noreferrer" className="text-wm-text-muted inline-flex items-center gap-0.5 hover:underline" title="Download MP4">
                              <ExternalLink size={10} />
                            </a>
                          )}
                          {c.srt_url && (
                            <a href={c.srt_url} target="_blank" rel="noreferrer" className="text-wm-text-muted inline-flex items-center gap-0.5 hover:underline">
                              <ExternalLink size={10} /> SRT
                            </a>
                          )}
                          {deepLink && (
                            <a href={deepLink} target="_blank" rel="noreferrer" className="text-wm-text-muted inline-flex items-center gap-0.5 hover:underline">
                              <ExternalLink size={10} /> Open in source
                            </a>
                          )}
                          {c.processing_error && (
                            <span className="text-wm-danger">· {c.processing_error}</span>
                          )}
                        </div>

                        {previewMode === 'rendered' && c.video_url && (
                          <ClipPreview
                            renderedUrl={c.video_url}
                            title={`Reel ${slot + 1} · rendered MP4`}
                            onClose={() => setPreviewing(p => ({ ...p, [ix]: null }))}
                          />
                        )}
                        {previewMode === 'source' && validatedVideo && (
                          <ClipPreview
                            sourceUrl={validatedVideo.normalizedUrl}
                            sourceType={validatedVideo.sourceType as any}
                            startSec={c.startTime ?? null}
                            endSec={c.endTime ?? null}
                            title={`Reel ${slot + 1} · source preview${c.startTime != null ? ` (from ${formatTime(c.startTime)})` : ''}`}
                            onClose={() => setPreviewing(p => ({ ...p, [ix]: null }))}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">Captions</p>
            <ReelCaptionEditor
              clipNumber={1}
              caption={session.reel1_caption ?? ''}
              clip={pickedIxs[0] != null ? candidates[pickedIxs[0]] : null}
              busy={busy}
              onGenerate={() => generateCaption(1)}
              onSave={async next => {
                await updateSession(session.session_id, { reel1_caption: next })
                onChange()
              }}
            />
            {pickedIxs[1] != null && (
              <ReelCaptionEditor
                clipNumber={2}
                caption={session.reel2_caption ?? ''}
                clip={candidates[pickedIxs[1]] ?? null}
                busy={busy}
                onGenerate={() => generateCaption(2)}
                onSave={async next => {
                  await updateSession(session.session_id, { reel2_caption: next })
                  onChange()
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ReelCaptionEditor({ clipNumber, caption, clip, busy, onGenerate, onSave }: {
  clipNumber: 1 | 2
  caption: string
  clip: ClipCandidate | null
  busy: boolean
  onGenerate: () => Promise<void>
  onSave: (next: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(caption)
  const [savingEdit, setSavingEdit] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => { setDraft(caption) }, [caption])

  const dirty = draft !== caption

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold text-wm-text">
          Reel {clipNumber}{clip?.label ? <span className="text-wm-text-muted font-normal"> · {clip.label}</span> : null}
        </p>
        <button
          onClick={() => void onGenerate()}
          disabled={busy || !clip}
          className="inline-flex items-center gap-1 rounded-full bg-wm-accent px-3 py-1 text-[11px] text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : caption ? <RefreshCw size={11} /> : <Sparkles size={11} />}
          {caption ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      {caption || draft ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={Math.min(6, Math.max(3, draft.split('\n').length + 1))}
            className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[12px] focus:outline-none focus:border-wm-accent whitespace-pre-wrap"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-wm-text-subtle">{draft.length.toLocaleString()} chars</span>
            <div className="flex items-center gap-2">
              {savedAt && !dirty && (
                <span className="text-[10px] text-wm-text-subtle inline-flex items-center gap-1">
                  <Save size={10} /> Saved {new Date(savedAt).toLocaleTimeString()}
                </span>
              )}
              {dirty && (
                <button
                  onClick={async () => {
                    setSavingEdit(true)
                    try { await onSave(draft); setSavedAt(new Date().toISOString()) }
                    finally { setSavingEdit(false) }
                  }}
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1 rounded-full bg-wm-accent px-2.5 py-0.5 text-[10px] text-white disabled:opacity-50"
                >
                  {savingEdit ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-wm-text-muted italic">No caption yet.</p>
      )}
    </div>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function ClipStatusBadge({ status }: { status: 'queued' | 'done' | 'failed' | null }) {
  if (!status) return <span className="text-wm-text-subtle italic">not cut</span>
  const cls = status === 'done' ? 'bg-wm-success-bg text-wm-success'
            : status === 'failed' ? 'bg-wm-danger-bg text-wm-danger'
            : 'bg-wm-accent/10 text-wm-accent-strong'
  return <span className={['text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded', cls].join(' ')}>{status}</span>
}
