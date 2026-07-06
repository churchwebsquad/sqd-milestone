/**
 * Step 3 — Sermon input.
 *
 * Two ways to provide the transcript:
 *   1. Paste a video URL (YouTube / Dropbox / Vimeo / Google Drive /
 *      direct MP4). Hit "Transcribe" → /api/srp/start-transcription
 *      creates an srp_pipeline.transcript_jobs row + fires n8n. We
 *      subscribe to that row via useTranscriptJob() and update the
 *      UI live as n8n progresses.
 *   2. Paste a transcript directly (skip transcription).
 *
 * Either way, the transcript ends up on srp_pipeline.sessions.transcript
 * + transcript_words, autosaved by the workflow context.
 *
 * Continue is gated on transcript present (≥200 chars).
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, FileText, Link as LinkIcon, AlertCircle, CheckCircle2, Search } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { useTranscriptJob } from '../../../lib/srpRealtime'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { supabase } from '../../../lib/supabase'

type Mode = 'url' | 'paste'

interface StartTranscriptionResponse {
  job_id:         string
  session_id:     string
  source_type:    string
  normalized_url: string
  status:         string
  webhook_status: string
}

export function SermonInputStep() {
  const {
    sessionId,
    videoUrl, setVideoUrl,
    transcript, setTranscript,
    transcriptWords, setTranscriptWords,
    hasTimecodes, setHasTimecodes,
    transcriptJobId, setTranscriptJobId,
    clickupTaskId,
    visibleSteps,
    goToNextStep, goToPrevStep,
    refresh,
  } = useSrpWorkflow()

  const [mode, setMode] = useState<Mode>(videoUrl ? 'url' : 'paste')
  const [pasteDraft, setPasteDraft] = useState<string>(transcript)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [autoPulling, setAutoPulling] = useState(false)
  const [autoPullSource, setAutoPullSource] = useState<string | null>(null)
  const [autoPullError, setAutoPullError] = useState<string | null>(null)

  // Auto-pull video URL from ClickUp task on first load if we have a task ID but no URL yet
  useEffect(() => {
    if (!clickupTaskId || videoUrl.trim()) return
    let cancelled = false
    setAutoPulling(true)
    setAutoPullError(null)
    fetch(`/api/clickup/task-video-url?taskId=${encodeURIComponent(clickupTaskId)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.videoUrl) {
          setVideoUrl(data.videoUrl)
          setAutoPullSource(data.source)
          setMode('url')
        } else {
          setAutoPullError('No video link found in the ClickUp task. Paste one below or switch to transcript.')
        }
      })
      .catch(() => {
        if (!cancelled) setAutoPullError('Could not check ClickUp task for a video link.')
      })
      .finally(() => { if (!cancelled) setAutoPulling(false) })
    return () => { cancelled = true }
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickupTaskId])

  // Sync paste draft if context transcript changes (e.g. after refresh).
  useEffect(() => {
    setPasteDraft(transcript)
  }, [transcript])

  // Subscribe to the active transcript_jobs row.
  const { job, connected: jobConnected } = useTranscriptJob(transcriptJobId)

  // When the job lands completed, refresh the session row so the
  // transcript autosaves down to the local context.
  useEffect(() => {
    if (job?.status === 'completed' && job.transcript) {
      void refresh()
    }
  }, [job?.status, job?.transcript, refresh])

  const stepNum = visibleSteps.indexOf('sermon') + 1

  const handleStartTranscription = useCallback(async () => {
    const url = videoUrl.trim()
    if (!url) { setStartError('Paste a video URL first.'); return }
    setStarting(true); setStartError(null)
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const r = await callSrpApi<StartTranscriptionResponse>('start-transcription', {
        session_id: sessionId,
        source_url: url,
        source_type: 'unknown',
      }, { authToken: authSession?.access_token })
      setTranscriptJobId(r.job_id)
      // Clear any prior pasted transcript so the "you can also paste"
      // hint doesn't mislead while the job runs.
      setTranscript('')
      setTranscriptWords(null)
    } catch (e) {
      const err = e as Error & { errorCode?: string }
      setStartError(err.errorCode ? `${err.errorCode}: ${err.message}` : err.message)
    } finally {
      setStarting(false)
    }
  }, [sessionId, videoUrl, setTranscriptJobId, setTranscript, setTranscriptWords])

  const handlePasteSave = useCallback(() => {
    const txt = pasteDraft.trim()
    setTranscript(txt)
    setTranscriptWords(null)
    // Heuristic — same one start-clips uses: look for MM:SS or HH:MM:SS
    // tokens in the first 5KB.
    const sample = txt.slice(0, 5000)
    setHasTimecodes(/\b\d{1,2}:\d{2}(:\d{2})?\b/.test(sample))
  }, [pasteDraft, setTranscript, setTranscriptWords, setHasTimecodes])

  const transcriptReady = transcript.trim().length >= 200

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.sermon}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.sermon}
        </p>
      </header>

      {/* Mode toggle */}
      <div className="inline-flex rounded-full border border-[var(--color-lavender)] overflow-hidden text-[12px] bg-white">
        <button
          type="button"
          onClick={() => setMode('url')}
          className={[
            'px-4 py-1.5 transition-colors inline-flex items-center gap-1.5',
            mode === 'url'
              ? 'bg-[var(--color-deep-plum)] text-white font-semibold'
              : 'text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)]',
          ].join(' ')}
        >
          <LinkIcon size={12} /> Video URL
        </button>
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={[
            'px-4 py-1.5 transition-colors inline-flex items-center gap-1.5',
            mode === 'paste'
              ? 'bg-[var(--color-deep-plum)] text-white font-semibold'
              : 'text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)]',
          ].join(' ')}
        >
          <FileText size={12} /> Paste transcript
        </button>
      </div>

      {/* Auto-pull status */}
      {autoPulling && (
        <div className="inline-flex items-center gap-2 text-[12px] text-[var(--color-purple-gray)] bg-[var(--color-lavender-tint)] rounded-full px-3 py-1.5">
          <Loader2 size={12} className="animate-spin" />
          Searching ClickUp task for video link…
        </div>
      )}
      {autoPullSource && !autoPulling && (
        <div className="inline-flex items-center gap-1.5 text-[12px] text-wm-success bg-wm-success-bg rounded-full px-3 py-1.5">
          <Search size={12} />
          Video link found in task {autoPullSource} — confirm or replace below
        </div>
      )}
      {autoPullError && !autoPulling && (
        <div className="inline-flex items-center gap-1.5 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
          <AlertCircle size={12} />
          {autoPullError}
        </div>
      )}

      {mode === 'url' && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <label className="block text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Sermon video URL
          </label>
          <input
            type="url"
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            placeholder="YouTube, Dropbox, Vimeo, Google Drive, or direct MP4"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-2 text-[13px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <SrpButton
              size="sm"
              onClick={() => void handleStartTranscription()}
              disabled={starting || !videoUrl.trim() || job?.status === 'pending' || job?.status === 'in_progress'}
              leadingIcon={starting ? <Loader2 size={12} className="animate-spin" /> : undefined}
            >
              {starting ? 'Starting…' : 'Transcribe via n8n'}
            </SrpButton>
            {startError && (
              <span className="inline-flex items-center gap-1 text-[11px] text-wm-danger">
                <AlertCircle size={11} /> {startError}
              </span>
            )}
          </div>

          {/* Live job status */}
          {transcriptJobId && job && (
            <div className="rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]/40 px-3 py-2.5 text-[12px] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--color-deep-plum)] capitalize">
                  {job.status}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-[var(--color-purple-gray)]">
                  {jobConnected ? 'live' : 'polling'}
                </span>
              </div>
              {job.status_message && (
                <p className="text-[var(--color-purple-gray)]">{job.status_message}</p>
              )}
              {typeof job.progress_percent === 'number' && job.progress_percent > 0 && (
                <div className="w-full h-1.5 rounded-full bg-[var(--color-lavender)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-primary-purple)] transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, job.progress_percent))}%` }}
                  />
                </div>
              )}
              {job.error_message && (
                <p className="text-wm-danger">{job.error_message}</p>
              )}
              {job.transcription_engine && (
                <p className="text-[10px] text-[var(--color-purple-gray)]">
                  via {job.transcription_engine}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {mode === 'paste' && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
          <label className="block text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            Transcript text
          </label>
          <textarea
            value={pasteDraft}
            onChange={e => setPasteDraft(e.target.value)}
            rows={14}
            placeholder="Paste the sermon transcript here. Timecodes optional but recommended — they let clip selection target exact MM:SS ranges."
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[12px] text-[var(--color-deep-plum)] font-mono placeholder:text-[var(--color-purple-gray)] placeholder:font-sans focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
          <label className="inline-flex items-center gap-2 text-[12px] text-[var(--color-deep-plum)]">
            <input
              type="checkbox"
              checked={hasTimecodes}
              onChange={e => setHasTimecodes(e.target.checked)}
              className="accent-[var(--color-primary-purple)]"
            />
            Transcript includes timecodes (MM:SS or HH:MM:SS)
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <SrpButton
              size="sm"
              onClick={handlePasteSave}
              disabled={pasteDraft.trim().length < 200 || pasteDraft === transcript}
            >
              Save transcript
            </SrpButton>
            <span className="text-[11px] text-[var(--color-purple-gray)]">
              {pasteDraft.trim().split(/\s+/).filter(Boolean).length} words · {pasteDraft.length} chars
            </span>
          </div>
        </section>
      )}

      {/* Transcript-present indicator */}
      {transcriptReady && (
        <div className="inline-flex items-center gap-1.5 text-[12px] text-wm-success bg-wm-success-bg rounded-full px-3 py-1.5">
          <CheckCircle2 size={12} />
          Transcript saved · {transcript.trim().split(/\s+/).filter(Boolean).length} words · {hasTimecodes ? 'timecoded' : 'no timecodes'}
          {transcriptWords && transcriptWords.length > 0 && (
            <span className="text-[10px] uppercase tracking-widest font-bold">· word-level timing</span>
          )}
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton
          variant="ghost"
          onClick={goToPrevStep}
          leadingIcon={<ArrowLeft size={14} />}
        >
          Back
        </SrpButton>
        <SrpButton
          disabled={!transcriptReady}
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          Continue
        </SrpButton>
      </div>
    </div>
  )
}
