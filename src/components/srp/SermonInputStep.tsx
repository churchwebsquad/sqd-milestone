/**
 * Step 3: Sermon input. Strategist pastes the sermon transcript and
 * optionally a video URL / sermon title. Both fields save to
 * sms_srp_generation on blur — no "Save" button to forget.
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Save } from 'lucide-react'
import { updateSession } from '../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../types/database'

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

  // Keep local state in sync if upstream reloads after onChange().
  useEffect(() => { setTranscript(session.transcript ?? '') }, [session.transcript])
  useEffect(() => { setVideoUrl(session.video_url ?? '') }, [session.video_url])

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
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Video URL <span className="text-wm-text-muted normal-case font-normal">(optional)</span></span>
          <input
            type="url"
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            onBlur={() => void saveVideoUrl()}
            placeholder="https://… (YouTube, Vimeo, Dropbox)"
            className="mt-1 w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] focus:outline-none focus:border-wm-accent"
          />
        </label>

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
