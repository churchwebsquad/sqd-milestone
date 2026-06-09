/**
 * Step 3: Sermon input. Strategist pastes the sermon transcript and
 * optionally a video URL / sermon title. Both fields save to
 * sms_srp_generation on blur — no "Save" button to forget.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Save, Sparkles, X } from 'lucide-react'
import { updateSession, getSession } from '../../lib/srpSessions'
import { validateMediaUrl } from '../../lib/mediaUrlValidator'
import { supabase } from '../../lib/supabase'
import type { SmsSrpGeneration } from '../../types/database'

const FAILED_PREFIX = '__TRANSCRIPTION_FAILED__'

export function SermonInputStep({ session, onBack, onContinue, onChange }: {
  session: SmsSrpGeneration
  onBack: () => void
  onContinue: () => void
  onChange: () => void
}) {
  const [transcript, setTranscript] = useState(session.transcript ?? '')
  const [videoUrl,   setVideoUrl]   = useState(session.video_url ?? '')
  const [saving, setSaving] = useState<'transcript' | 'video' | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(session.updated_at)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const [transcribeElapsed, setTranscribeElapsed] = useState(0)
  const transcribeStartRef = useRef<number | null>(null)
  const pollAbortRef = useRef<boolean>(false)

  // Keep local state in sync if upstream reloads after onChange().
  useEffect(() => { setTranscript(session.transcript ?? '') }, [session.transcript])
  useEffect(() => { setVideoUrl(session.video_url ?? '') }, [session.video_url])

  // Detect server-side failure sentinel
  const failedMessage = transcript.startsWith(FAILED_PREFIX)
    ? transcript.slice(FAILED_PREFIX.length).trim()
    : null

  useEffect(() => {
    if (!transcribing || !transcribeStartRef.current) return
    const tick = () => setTranscribeElapsed(Math.floor((Date.now() - transcribeStartRef.current!) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [transcribing])

  const saveTranscript = useCallback(async () => {
    if (transcript === (session.transcript ?? '')) return
    setSaving('transcript')
    try {
      await updateSession(session.session_id, { transcript })
      setSavedAt(new Date().toISOString())
      onChange()
    } finally { setSaving(null) }
  }, [transcript, session.transcript, session.session_id, onChange])

  const saveVideoUrl = useCallback(async () => {
    if (videoUrl === (session.video_url ?? '')) return
    setSaving('video')
    try {
      await updateSession(session.session_id, { video_url: videoUrl })
      setSavedAt(new Date().toISOString())
      onChange()
    } finally { setSaving(null) }
  }, [videoUrl, session.video_url, session.session_id, onChange])

  const transcribeFromUrl = useCallback(async () => {
    setTranscribeError(null)
    const v = validateMediaUrl(videoUrl)
    if (!v.ok) { setTranscribeError(v.userMessage); return }

    setTranscribing(true)
    transcribeStartRef.current = Date.now()
    pollAbortRef.current = false

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const r = await fetch('/api/srp/start-transcription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ sessionId: session.session_id, sourceUrl: videoUrl }),
      })
      const text = await r.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status}`)

      // Poll sms_srp_generation.transcript until the n8n callback updates it.
      // Sentinel value means failure; non-empty + non-sentinel means done.
      // 12 minute hard cap to prevent infinite polling.
      const maxMs = 12 * 60 * 1000
      const intervalMs = 5000
      const start = Date.now()
      while (!pollAbortRef.current && Date.now() - start < maxMs) {
        await new Promise(res => setTimeout(res, intervalMs))
        const fresh = await getSession(session.session_id)
        const t = fresh?.transcript ?? ''
        if (t.startsWith(FAILED_PREFIX)) {
          setTranscribeError(t.slice(FAILED_PREFIX.length).trim() || 'Transcription failed')
          await onChange()
          return
        }
        if (t && t.length > 0) {
          setTranscript(t)
          await onChange()
          return
        }
      }
      if (!pollAbortRef.current) {
        setTranscribeError('Transcription is taking longer than 12 minutes. Check the n8n workflow or paste the transcript manually.')
      }
    } catch (e) {
      setTranscribeError(e instanceof Error ? e.message : 'Failed to start transcription')
    } finally {
      setTranscribing(false)
      transcribeStartRef.current = null
    }
  }, [videoUrl, session.session_id, onChange])

  const cancelTranscribePolling = useCallback(() => {
    pollAbortRef.current = true
    setTranscribing(false)
  }, [])

  const canContinue = transcript.trim().length > 0

  return (
    <section className="rounded-lg border border-wm-border bg-wm-bg-elevated p-5 space-y-4">
      <header>
        <h2 className="text-[16px] font-semibold text-wm-text">Sermon input</h2>
        <p className="text-[12px] text-wm-text-muted mt-1">
          Paste the sermon transcript and optionally link the recording. Fields auto-save when you click outside them.
        </p>
      </header>

      <div className="space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Video URL <span className="text-wm-text-muted normal-case font-normal">(optional — for transcription + clip rendering)</span>
          </p>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="url"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              onBlur={() => void saveVideoUrl()}
              placeholder="https://… (YouTube, Vimeo, Dropbox, Drive)"
              disabled={transcribing}
              className="flex-1 rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] focus:outline-none focus:border-wm-accent disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void transcribeFromUrl()}
              disabled={transcribing || !videoUrl.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-2 text-[12px] text-white font-semibold disabled:opacity-50 whitespace-nowrap"
            >
              {transcribing
                ? <><Loader2 size={12} className="animate-spin" /> Transcribing…</>
                : <><Sparkles size={12} /> Transcribe</>}
            </button>
          </div>
          {transcribing && (
            <div className="mt-2 rounded-md border border-wm-accent/30 bg-wm-accent/5 px-3 py-2 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-wm-accent-strong shrink-0" />
              <p className="text-[12px] text-wm-text leading-snug flex-1">
                {transcribeElapsed < 30   ? 'Sending to the transcription service…'
                : transcribeElapsed < 90  ? 'Audio extraction + transcription in progress…'
                : transcribeElapsed < 240 ? 'Still working. Sermon transcription typically takes 3-7 minutes.'
                : 'Long-running. Check back, the result lands in this textarea when n8n completes.'}
              </p>
              <span className="text-[10px] font-mono text-wm-text-subtle">{Math.floor(transcribeElapsed / 60)}:{String(transcribeElapsed % 60).padStart(2, '0')}</span>
              <button onClick={cancelTranscribePolling} className="text-wm-text-muted hover:text-wm-text" title="Stop polling (n8n continues in background)">
                <X size={12} />
              </button>
            </div>
          )}
          {transcribeError && !transcribing && (
            <div className="mt-2 rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
              {transcribeError}
            </div>
          )}
          {failedMessage && !transcribing && (
            <div className="mt-2 rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
              Last transcription failed: {failedMessage}
            </div>
          )}
        </div>

        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Transcript <span className="text-wm-danger normal-case font-normal">(required)</span></span>
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            onBlur={() => void saveTranscript()}
            placeholder="Paste the sermon transcript here…"
            rows={14}
            className="mt-1 w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] focus:outline-none focus:border-wm-accent font-mono"
          />
          <p className="text-[10px] text-wm-text-subtle mt-1">
            {transcript.length.toLocaleString()} characters · ~{Math.round(transcript.split(/\s+/).filter(Boolean).length).toLocaleString()} words
          </p>
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] text-wm-text-muted hover:text-wm-text px-2 py-1.5">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-[11px] text-wm-text-muted inline-flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> Saving {saving}…
            </span>
          )}
          {!saving && savedAt && (
            <span className="text-[11px] text-wm-text-subtle inline-flex items-center gap-1">
              <Save size={11} /> Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={onContinue}
            disabled={!canContinue}
            className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
          >
            Continue <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </section>
  )
}
