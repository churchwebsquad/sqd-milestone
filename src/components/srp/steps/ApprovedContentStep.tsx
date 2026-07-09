/**
 * Step 12 — Approved content (final review + ship).
 *
 * Shows every saved deliverable for one last look. Three terminal actions:
 *   1. Submit to ClickUp  → /api/srp/submit-to-clickup (n8n posts clips
 *      as attachments + transcripts to the SRP Video child task). If
 *      n8n can't resolve the blocker-dependency, surfaces a 422 with
 *      error_code 'no_blocker_dependency'; we open the
 *      MissingBlockerTaskDialog so the coach can paste a manual ID.
 *   2. Download Vista CSV → builds the per-platform schedule CSV the
 *      team imports into Vista Social.
 *   3. Push to Vista direct (optional) → /api/srp/push-to-vista. Falls
 *      through to CSV if Vista env vars aren't configured.
 */

import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, ExternalLink, Send, FileDown, Sparkles, Copy, CheckCircle2 } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { useClipcutterJob } from '../../../lib/srpRealtime'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { buildVistaCsv, downloadCsv } from '../../../lib/vistaCsvExport'
import { MissingBlockerTaskDialog } from '../MissingBlockerTaskDialog'
import type { SrpClipSelection, SrpCarouselSlide } from '../../../types/database'

export function ApprovedContentStep() {
  const {
    sessionId,
    account,
    visibleSteps,
    goToPrevStep,
    clickupTaskId, setClickupTaskId,
    srpTaskIdOverride, setSrpTaskIdOverride,
    clipcutterJobId,
    clipSelections,
    facebookPost, sundayInvite, photoRecapCaption,
    carouselSlides, carouselCaption,
  } = useSrpWorkflow()

  const stepNum = visibleSteps.indexOf('approved') + 1
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitOk, setSubmitOk] = useState(false)
  const [pushingVista, setPushingVista] = useState(false)
  const [pushResult, setPushResult] = useState<string | null>(null)
  const [blockerDialogOpen, setBlockerDialogOpen] = useState(false)
  const [blockerDetails, setBlockerDetails] = useState<string | null>(null)

  // Pull rendered clip URLs from the clipcutter job (for the CSV).
  const { job: cutterJob } = useClipcutterJob(clipcutterJobId)
  const renderedClips = useMemo<SrpClipSelection[]>(
    () => Array.isArray(cutterJob?.clip_results)
      ? (cutterJob.clip_results as Array<{ clip_id?: string; video_url?: string | null; srt_url?: string | null }>).map(r => ({
          clip_id: r.clip_id,
          video_url: r.video_url ?? null,
          srt_url: r.srt_url ?? null,
        }))
      : [],
    [cutterJob?.clip_results],
  )

  // Submit to ClickUp; handles the no_blocker_dependency override flow.
  const handleSubmit = useCallback(async (overrideTaskId?: string) => {
    if (!clickupTaskId) {
      setSubmitError('No ClickUp task ID on this session. Pair a sermon submission on Step 1.')
      return
    }
    setSubmitting(true); setSubmitError(null); setSubmitOk(false)
    try {
      await callSrpApi('submit-to-clickup', {
        session_id:           sessionId,
        srp_task_id_override: overrideTaskId ?? srpTaskIdOverride,
      })
      setSubmitOk(true)
      setBlockerDialogOpen(false)
      if (overrideTaskId) setSrpTaskIdOverride(overrideTaskId)
    } catch (e) {
      const err = e as Error & { status?: number; errorCode?: string; details?: unknown }
      if (err.status === 422 && err.errorCode === 'no_blocker_dependency') {
        setBlockerDetails(typeof err.details === 'string' ? err.details : null)
        setBlockerDialogOpen(true)
      } else {
        setSubmitError(err.message)
      }
    } finally {
      setSubmitting(false)
    }
  }, [sessionId, clickupTaskId, srpTaskIdOverride, setSrpTaskIdOverride])

  // Vista CSV download.
  const handleDownloadCsv = useCallback(() => {
    const session = {
      facebook_post:       facebookPost,
      sunday_invite:       sundayInvite,
      photo_recap_caption: photoRecapCaption,
      carousel_caption:    carouselCaption,
      church_name:         account?.church_name ?? null,
      session_id:          sessionId,
    }
    const csv = buildVistaCsv({ session, clipSelections, renderedClips })
    const slug = (account?.church_name ?? 'srp').replace(/[^A-Za-z0-9]/g, '_')
    downloadCsv(`vista_${slug}_${sessionId}.csv`, csv)
  }, [account?.church_name, sessionId, facebookPost, sundayInvite, photoRecapCaption, carouselCaption, clipSelections, renderedClips])

  // Vista direct push (best-effort; falls through to CSV if not configured).
  const handlePushVista = useCallback(async () => {
    setPushingVista(true); setPushResult(null)
    try {
      const r = await callSrpApi<{ ok: boolean; pushed: number; failed: number }>('push-to-vista', {
        session_id: sessionId,
      })
      setPushResult(`Pushed ${r.pushed}, failed ${r.failed}.`)
    } catch (e) {
      const err = e as Error & { status?: number }
      // 503 = "Vista not configured" — coach should use CSV instead.
      if (err.status === 503) {
        setPushResult('Vista direct push is not configured. Use the CSV download instead.')
      } else {
        setPushResult(err.message)
      }
    } finally {
      setPushingVista(false)
    }
  }, [sessionId])

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5 inline-flex items-center gap-2">
          <Sparkles size={20} className="text-[var(--color-primary-purple)]" />
          {STEP_LABELS.approved}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.approved}</p>
      </header>

      {/* Deliverable review */}
      <section className="space-y-3">
        {clipSelections.map((clip, i) => {
          const rendered = renderedClips.find(r => r.clip_id === clip.clip_id) ?? renderedClips[i]
          return (
            <DeliverableCard
              key={clip.clip_id ?? `reel-${i}`}
              title={`Reel ${i + 1}${clip.clip_title ? ` — ${clip.clip_title}` : ''}`}
              body={clip.social_caption ?? null}
              subline={rendered?.video_url ? <a href={rendered.video_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[11px] text-[var(--color-primary-purple)]">video <ExternalLink size={9} /></a> : null}
            />
          )
        })}
        <DeliverableCard title="Facebook post" body={facebookPost} />
        <DeliverableCard title="Sunday invite" body={sundayInvite} />
        <DeliverableCard title="Photo recap"   body={photoRecapCaption} />
        <DeliverableCard title="Carousel"      body={carouselCaption} slides={carouselSlides} />
      </section>

      {/* ClickUp submit */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">Submit to ClickUp</p>
            <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">
              Posts the rendered reels + final text deliverables to the &ldquo;SRP Video&rdquo; child task.
            </p>
          </div>
          <SrpButton
            onClick={() => void handleSubmit()}
            disabled={submitting || !clickupTaskId}
            leadingIcon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          >
            {submitting ? 'Submitting…' : submitOk ? 'Submitted ✓' : 'Submit to ClickUp'}
          </SrpButton>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <label className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            ClickUp task
          </label>
          <input
            type="text"
            value={clickupTaskId ?? ''}
            onChange={e => setClickupTaskId(e.target.value || null)}
            placeholder="86c0xyz"
            className="rounded-full border border-[var(--color-lavender)] bg-white px-3 py-1 text-[12px] font-mono text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
          {clickupTaskId && (
            <a
              href={`https://app.clickup.com/t/${clickupTaskId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11px] text-[var(--color-primary-purple)] hover:text-[var(--color-deep-plum)]"
            >
              Open <ExternalLink size={9} />
            </a>
          )}
        </div>
        {submitError && <p className="text-[12px] text-wm-danger">{submitError}</p>}
        {submitOk && (
          <p className="inline-flex items-center gap-1.5 text-[12px] text-wm-success">
            <CheckCircle2 size={12} /> Posted to ClickUp.
          </p>
        )}
      </section>

      {/* Vista */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
        <div>
          <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">Vista Social</p>
          <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">
            Download a CSV the team can batch-import into Vista, or try the direct push if it&rsquo;s configured.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SrpButton size="sm" variant="secondary" onClick={handleDownloadCsv} leadingIcon={<FileDown size={12} />}>
            Download CSV
          </SrpButton>
          <SrpButton
            size="sm"
            variant="ghost"
            onClick={() => void handlePushVista()}
            disabled={pushingVista}
            leadingIcon={pushingVista ? <Loader2 size={12} className="animate-spin" /> : undefined}
          >
            {pushingVista ? 'Pushing…' : 'Push to Vista (direct)'}
          </SrpButton>
          {pushResult && <span className="text-[11px] text-[var(--color-purple-gray)]">{pushResult}</span>}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>Back</SrpButton>
        <span className="text-[11px] uppercase tracking-widest font-bold text-wm-success">
          Session marked complete on save
        </span>
      </div>

      <MissingBlockerTaskDialog
        open={blockerDialogOpen}
        details={blockerDetails}
        onCancel={() => setBlockerDialogOpen(false)}
        onResubmit={async (overrideTaskId) => {
          await handleSubmit(overrideTaskId)
        }}
      />
    </div>
  )
}

function DeliverableCard({
  title, body, slides, subline,
}: {
  title:    string
  body:     string | null
  slides?:  SrpCarouselSlide[] | null
  subline?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const hasContent = !!(body && body.trim().length > 0) || (slides && slides.length > 0)
  if (!hasContent) return null

  const copyText = async () => {
    const text = slides && slides.length > 0
      ? slides.map((s, i) => `${i + 1}. ${s.text}`).join('\n\n') + (body ? `\n\n— Caption —\n${body}` : '')
      : body ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore — clipboard may be unavailable */ }
  }

  return (
    <article className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
      <header className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">{title}</p>
        <div className="flex items-center gap-2">
          {subline}
          <button
            type="button"
            onClick={() => void copyText()}
            className="inline-flex items-center gap-1 text-[10px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
          >
            {copied ? <CheckCircle2 size={10} className="text-wm-success" /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>
      {slides && slides.length > 0 && (
        <ol className="space-y-1.5 text-[12px] text-[var(--color-deep-plum)] mb-2">
          {slides.map((s, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-purple-gray)] mt-0.5">{i + 1}.</span>
              <span className="min-w-0">{s.text}</span>
            </li>
          ))}
        </ol>
      )}
      {body && (
        <p className="text-[13px] text-[var(--color-deep-plum)] whitespace-pre-wrap leading-snug">
          {body}
        </p>
      )}
    </article>
  )
}
