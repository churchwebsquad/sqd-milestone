/**
 * Step 11 — Clip processing.
 *
 * Coach fires the clipcutter: /api/srp/start-clipcutter creates an
 * srp_pipeline.clipcutter_jobs row and fires the n8n webhook. The
 * useClipcutterJob hook subscribes to that row via Realtime so we
 * see status / progress / clip_results push in live.
 *
 * Each picked clip is converted to the n8n payload shape with
 * in_point_ms / out_point_ms in milliseconds.
 *
 * Continue is gated on the job being completed (status === 'completed'
 * or 'partial' with at least one rendered clip).
 */

import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Film, Play, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { useClipcutterJob } from '../../../lib/srpRealtime'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'

interface StartClipcutterResponse {
  job_id:         string
  session_id:     string
  clip_count:     number
  status:         string
  webhook_status: string
}

interface ClipResult {
  clip_id?:   string
  video_url?: string | null
  srt_url?:   string | null
  status?:    string
  error_message?: string | null
}

function timestampToMs(ts: string | undefined): number {
  if (!ts) return 0
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
  return (parts[0] || 0) * 1000
}

export function ClipProcessingStep() {
  const {
    sessionId,
    clipSelections,
    clipcutterJobId, setClipcutterJobId,
    srpTemplate, backgroundMusic, designerNotes,
    reel1Caption, reel2Caption,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const { job, connected } = useClipcutterJob(clipcutterJobId)
  const stepNum = visibleSteps.indexOf('clipProcessing') + 1

  const handleStart = useCallback(async () => {
    if (clipSelections.length === 0) { setStartError('No clips picked.'); return }
    setStarting(true); setStartError(null)
    try {
      const captions = [reel1Caption, reel2Caption]
      const clipsPayload = clipSelections.slice(0, 2).map((c, i) => ({
        clip_id:       c.clip_id ?? `clip_${i + 1}`,
        clip_name:     c.clip_name ?? c.category ?? `Reel ${i + 1}`,
        in_point_ms:   timestampToMs(c.startTime),
        out_point_ms:  timestampToMs(c.endTime),
        duration_ms:   Math.max(0, timestampToMs(c.endTime) - timestampToMs(c.startTime)),
        quote:         c.quote ?? null,
        category:      c.category ?? null,
        caption_text:  captions[i] ?? null,
      }))
      const r = await callSrpApi<StartClipcutterResponse>('start-clipcutter', {
        session_id: sessionId,
        clips:      clipsPayload,
        creative_direction: {
          srp_template:     srpTemplate,
          background_music: backgroundMusic,
          designer_notes:   designerNotes || null,
        },
      })
      setClipcutterJobId(r.job_id)
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'failed to start clipcutter')
    } finally {
      setStarting(false)
    }
  }, [sessionId, clipSelections, srpTemplate, backgroundMusic, designerNotes, reel1Caption, reel2Caption, setClipcutterJobId])

  const clipResults = useMemo<ClipResult[]>(
    () => Array.isArray(job?.clip_results) ? (job.clip_results as ClipResult[]) : [],
    [job?.clip_results],
  )

  const status = (job?.status ?? 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed' | 'partial'
  const isRunning = clipcutterJobId && (status === 'pending' || status === 'in_progress')
  const isDone = status === 'completed' || (status === 'partial' && clipResults.some(r => r.video_url))
  const isFailed = status === 'failed'

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">{STEP_LABELS.clipProcessing}</h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.clipProcessing}</p>
      </header>

      {/* Start button */}
      {!clipcutterJobId && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-3 text-center">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]">
            <Film size={20} />
          </span>
          <div>
            <p className="text-[14px] font-semibold text-[var(--color-deep-plum)]">
              Ready to render {clipSelections.length} clip{clipSelections.length === 1 ? '' : 's'}.
            </p>
            <p className="text-[12px] text-[var(--color-purple-gray)] mt-1">
              Template <strong className="font-mono">{srpTemplate}</strong>
              {' · BGM '}<strong>{backgroundMusic ? 'on' : 'off'}</strong>
              {designerNotes ? ' · designer notes attached' : ''}
            </p>
          </div>
          <SrpButton
            onClick={() => void handleStart()}
            disabled={starting || clipSelections.length === 0}
            leadingIcon={starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          >
            {starting ? 'Starting…' : 'Render clips'}
          </SrpButton>
          {startError && <p className="text-[12px] text-wm-danger">{startError}</p>}
        </section>
      )}

      {/* Job status */}
      {clipcutterJobId && job && (
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                Clipcutter status
              </p>
              <p className="text-[16px] font-semibold text-[var(--color-deep-plum)] mt-0.5 capitalize inline-flex items-center gap-2">
                {isRunning && <Loader2 size={15} className="animate-spin text-[var(--color-primary-purple)]" />}
                {isDone && <CheckCircle2 size={15} className="text-wm-success" />}
                {isFailed && <AlertCircle size={15} className="text-wm-danger" />}
                {status.replace(/_/g, ' ')}
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] inline-block rounded-full border border-[var(--color-lavender)] px-2 py-1">
              {connected ? 'realtime' : 'polling'}
            </span>
          </div>

          {job.status_message && (
            <p className="text-[12px] text-[var(--color-purple-gray)]">{job.status_message}</p>
          )}

          {typeof job.progress_percent === 'number' && job.progress_percent > 0 && job.progress_percent < 100 && (
            <div>
              <div className="w-full h-1.5 rounded-full bg-[var(--color-lavender)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-primary-purple)] transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, job.progress_percent))}%` }}
                />
              </div>
              <p className="text-[10px] font-mono text-[var(--color-purple-gray)] mt-1">
                {job.progress_percent}%
              </p>
            </div>
          )}

          {job.error_message && (
            <p className="text-[12px] text-wm-danger bg-wm-danger-bg rounded-lg px-3 py-2">{job.error_message}</p>
          )}

          {clipResults.length > 0 && (
            <ul className="space-y-2">
              {clipResults.map((r, i) => {
                const reelLabel = `Reel ${i + 1}`
                const ok = r.status === 'done' || !!r.video_url
                const failed = r.status === 'failed' || !!r.error_message
                return (
                  <li
                    key={r.clip_id ?? i}
                    className="rounded-lg border border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]/40 p-3 flex items-center gap-3"
                  >
                    <span
                      className={[
                        'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full',
                        ok     ? 'bg-wm-success-bg text-wm-success'
                        : failed ? 'bg-wm-danger-bg text-wm-danger'
                                 : 'bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]',
                      ].join(' ')}
                    >
                      {ok ? <CheckCircle2 size={14} /> : failed ? <AlertCircle size={14} /> : <Loader2 size={14} className="animate-spin" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">
                        {reelLabel}
                        <span className="ml-2 text-[10px] font-mono font-normal text-[var(--color-purple-gray)]">
                          {r.clip_id}
                        </span>
                      </p>
                      {r.error_message && <p className="text-[11px] text-wm-danger">{r.error_message}</p>}
                    </div>
                    {r.video_url && (
                      <a
                        href={r.video_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-primary-purple)] hover:text-[var(--color-deep-plum)]"
                      >
                        <Play size={11} /> Watch
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {isFailed && (
            <SrpButton
              size="sm"
              variant="secondary"
              onClick={() => { setClipcutterJobId(null); setStartError(null) }}
            >
              Retry clipcutter
            </SrpButton>
          )}
        </section>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>Back</SrpButton>
        <SrpButton disabled={!isDone} onClick={goToNextStep} trailingIcon={<ArrowRight size={14} />}>
          Continue
        </SrpButton>
      </div>
    </div>
  )
}
