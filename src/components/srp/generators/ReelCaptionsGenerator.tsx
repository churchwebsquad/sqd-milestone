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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Save, Sparkles } from 'lucide-react'
import { parseClipSelections, stringifyClipSelections, updateSession, type ClipSelection } from '../../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../../types/database'
import { useSrpGenerator } from './useSrpGenerator'

interface ClipCandidate extends ClipSelection {
  label?: string
  wordCount?: number
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
