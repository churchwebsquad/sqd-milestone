/**
 * Step 3: Sermon input. Strategist pastes the sermon transcript and
 * optionally a video URL / sermon title. Both fields save to
 * sms_srp_generation on blur — no "Save" button to forget.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Save, Sparkles, X, FileVideo, AlertTriangle } from 'lucide-react'
import { updateSession, getSession } from '../../lib/srpSessions'
import { validateMediaUrl } from '../../lib/mediaUrlValidator'
import { supabase } from '../../lib/supabase'
import type { SmsSrpGeneration } from '../../types/database'
import { SrpStepPanel } from './_shared/SrpStepPanel'
import { SrpButton } from './_shared/SrpButton'
import { SrpStatusCard } from './_shared/SrpStatusCard'

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
  const wordCount = transcript.split(/\s+/).filter(Boolean).length

  return (
    <SrpStepPanel
      eyebrow="Step 3 of 4"
      icon={FileVideo}
      title="Sermon input"
      description="Paste the sermon transcript and optionally link the recording. Fields auto-save when you click outside them."
      footer={
        <>
          <SrpButton variant="ghost" onClick={onBack} leadingIcon={<ArrowLeft size={14} />}>
            Back
          </SrpButton>
          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-[11px] text-[var(--color-purple-gray)] inline-flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> Saving {saving}…
              </span>
            )}
            {!saving && savedAt && (
              <span className="text-[11px] text-[var(--color-purple-gray)] inline-flex items-center gap-1">
                <Save size={11} /> Saved {new Date(savedAt).toLocaleTimeString()}
              </span>
            )}
            <SrpButton
              variant="secondary"
              onClick={onContinue}
              disabled={!canContinue}
              trailingIcon={<ArrowRight size={14} />}
            >
              Continue
            </SrpButton>
          </div>
        </>
      }
    >
      {/* Video URL block — input + transcribe trigger + live progress */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-purple-gray)]">Video URL</p>
          <p className="text-[10px] text-[var(--color-purple-gray)]">Optional — for transcription &amp; clip rendering</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="url"
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            onBlur={() => void saveVideoUrl()}
            placeholder="https://… (YouTube, Vimeo, Dropbox, Drive)"
            disabled={transcribing}
            className="flex-1 rounded-full border border-[var(--color-lavender)] bg-white px-4 py-2 text-[13px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] disabled:opacity-50"
          />
          <SrpButton
            variant="secondary"
            onClick={() => void transcribeFromUrl()}
            disabled={!videoUrl.trim()}
            busy={transcribing}
            leadingIcon={<Sparkles size={14} />}
          >
            {transcribing ? 'Transcribing…' : 'Transcribe'}
          </SrpButton>
        </div>

        {transcribing && (
          <SrpStatusCard
            tone="accent"
            icon={Loader2}
            actions={
              <button
                onClick={cancelTranscribePolling}
                className="text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
                title="Stop polling (n8n continues in background)"
                aria-label="Stop polling"
              >
                <X size={14} />
              </button>
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <span>
                {transcribeElapsed < 30   ? 'Sending to the transcription service…'
                : transcribeElapsed < 90  ? 'Audio extraction + transcription in progress…'
                : transcribeElapsed < 240 ? 'Still working. Sermon transcription typically takes 3-7 minutes.'
                : 'Long-running. Check back, the result lands in this textarea when n8n completes.'}
              </span>
              <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                {Math.floor(transcribeElapsed / 60)}:{String(transcribeElapsed % 60).padStart(2, '0')}
              </span>
            </div>
          </SrpStatusCard>
        )}
        {transcribeError && !transcribing && (
          <SrpStatusCard tone="danger" icon={AlertTriangle} title="Transcription error">
            {transcribeError}
          </SrpStatusCard>
        )}
        {failedMessage && !transcribing && (
          <SrpStatusCard tone="danger" icon={AlertTriangle} title="Last transcription failed">
            {failedMessage}
          </SrpStatusCard>
        )}
      </div>

      {/* Transcript block */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-purple-gray)]">
            Transcript <span className="text-wm-danger normal-case font-normal">· required</span>
          </p>
          <p className="text-[10px] text-[var(--color-purple-gray)]">
            {transcript.length.toLocaleString()} chars · {wordCount.toLocaleString()} words
          </p>
        </div>
        <textarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          onBlur={() => void saveTranscript()}
          placeholder="Paste the sermon transcript here…"
          rows={14}
          className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-4 py-3 text-[13px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] font-mono leading-relaxed"
        />
      </div>
    </SrpStepPanel>
  )
}
