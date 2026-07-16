/**
 * Step 1 — Account selection.
 *
 * The session is already keyed on a member (set when the dashboard
 * created the row). This step is where the coach:
 *   1. Confirms / reviews the church
 *   2. Pairs a sermon submission from the Recent Submissions popup OR
 *      the Pair-by-Task-ID search
 *   3. Edits the per-account brand voice (writes to
 *      srp_pipeline.clip_templates — NOT strategy_account_progress)
 *
 * Continue is gated on having an account loaded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, Save, Building2, Sparkles, Link as LinkIcon } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { RecentSubmissionsWidget } from '../RecentSubmissionsWidget'
import { STEP_LABELS, STEP_DESCRIPTIONS, updateSession, suggestDeliverablesFromText, srpPipeline } from '../../../lib/srpSessions'
import { saveBrandVoice } from '../../../lib/squadAccount'
import type { SrpSermonSubmission } from '../../../types/database'

export function AccountSelectionStep() {
  const navigate = useNavigate()
  const {
    sessionId,
    account,
    sermonSubmission, setSermonSubmission,
    setCurrentStep, visibleSteps,
    brandVoice, setBrandVoice,
    clickupTaskId, setClickupTaskId,
    setSelectedDeliverables,
    setVideoUrl, setTranscript, setTranscriptWords, setHasTimecodes,
    goToNextStep,
  } = useSrpWorkflow()

  // Local brand voice draft so the textarea doesn't autosave-thrash.
  const [voiceDraft, setVoiceDraft] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Hydrate the draft from the loaded account once.
  const didSeed = useRef(false)
  useEffect(() => {
    if (didSeed.current) return
    if (account?.brand_voice_guidelines || brandVoice) {
      setVoiceDraft(account?.brand_voice_guidelines ?? brandVoice ?? '')
      didSeed.current = true
    }
  }, [account, brandVoice])

  const handleSaveVoice = useCallback(async () => {
    if (!account?.member) return
    setSaving(true); setSaveError(null)
    try {
      await saveBrandVoice(account.member, voiceDraft)
      setBrandVoice(voiceDraft)
      setSavedAt(new Date())
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }, [account?.member, voiceDraft, setBrandVoice])

  const handlePair = useCallback(async (s: SrpSermonSubmission) => {
    // If a real coach session already exists for this task, navigate there directly.
    if (s.pipeline_session_id && s.session_status && s.session_status !== 'background') {
      navigate(`/social/srp/${encodeURIComponent(s.pipeline_session_id)}`)
      return
    }

    setSermonSubmission(s)
    if (s.clickup_task_id) setClickupTaskId(s.clickup_task_id)

    // Fetch the ClickUp task description to get the full deliverable list
    let detectedText = [s.srp_info_selection, s.sermon_title, s.series_title].filter(Boolean).join(' ')
    if (s.clickup_task_id) {
      try {
        const res = await fetch(`/api/clickup/task-detail?taskId=${encodeURIComponent(s.clickup_task_id)}`)
        if (res.ok) {
          const td = await res.json()
          detectedText = `${detectedText} ${td.description ?? ''}`.trim()
        }
      } catch { /* fall back to submission text */ }
    }

    const suggested = suggestDeliverablesFromText(detectedText)
    if (suggested.length > 0) setSelectedDeliverables(suggested)

    // Check if a background pipeline session already fetched a video URL and/or transcript.
    // If so, copy those into the current session so the Sermon step is pre-populated.
    let pipelineVideoUrl: string | null = null
    let pipelineTranscript: string | null = null
    let pipelineTranscriptWords: unknown[] | null = null
    if (s.clickup_task_id) {
      try {
        const { data: pipelineSession } = await srpPipeline
          .from('sessions')
          .select('video_url, transcript, transcript_words, has_timecodes, pipeline_status')
          .eq('clickup_task_id', s.clickup_task_id)
          .eq('status', 'background')
          .not('pipeline_status', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (pipelineSession?.video_url) pipelineVideoUrl = pipelineSession.video_url
        if (pipelineSession?.transcript) pipelineTranscript = pipelineSession.transcript
        if (pipelineSession?.transcript_words) pipelineTranscriptWords = pipelineSession.transcript_words as unknown[]
        if (pipelineSession?.has_timecodes != null) setHasTimecodes(pipelineSession.has_timecodes)
      } catch { /* non-fatal */ }
    }

    const videoUrlToSave = pipelineVideoUrl ?? s.video_url ?? null
    if (pipelineVideoUrl) setVideoUrl(pipelineVideoUrl)
    if (pipelineTranscript) {
      setTranscript(pipelineTranscript)
      setTranscriptWords(pipelineTranscriptWords)
    }

    try {
      await updateSession(sessionId, {
        clickup_task_id:       s.clickup_task_id,
        clickup_url:           s.clickup_task_id ? `https://app.clickup.com/t/${s.clickup_task_id}` : null,
        sermon_title:          s.sermon_title,
        sermon_description:    s.sermon_description,
        series_title:          s.series_title,
        series_description:    s.series_description,
        ...(videoUrlToSave ? { video_url: videoUrlToSave } : {}),
        ...(pipelineTranscript ? { transcript: pipelineTranscript } : {}),
        ...(pipelineTranscriptWords ? { transcript_words: pipelineTranscriptWords } : {}),
        ...(suggested.length > 0 ? { selected_deliverables: suggested } : {}),
      })
    } catch (e) {
      console.error('Failed to persist pairing:', e)
    }
  }, [sessionId, setSermonSubmission, setClickupTaskId, setSelectedDeliverables, setVideoUrl, setTranscript, setTranscriptWords, setHasTimecodes])

  const stepNum = visibleSteps.indexOf('account') + 1

  const voiceIsDirty = useMemo(
    () => voiceDraft !== (account?.brand_voice_guidelines ?? brandVoice ?? ''),
    [voiceDraft, account?.brand_voice_guidelines, brandVoice],
  )

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.account}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.account}
        </p>
      </header>

      {/* Church card */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)] shrink-0">
            <Building2 size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[var(--color-deep-plum)] truncate">
              {account?.church_name ?? '—'}
            </p>
            <p className="text-[12px] text-[var(--color-purple-gray)] font-mono">
              Member {account?.member ?? '—'}
            </p>
            {sermonSubmission && (
              <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] rounded-full px-2.5 py-1">
                <LinkIcon size={10} />
                Paired with: <span className="font-semibold truncate max-w-[260px]">{sermonSubmission.sermon_title ?? sermonSubmission.series_title ?? sermonSubmission.clickup_task_id}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Recent submissions */}
      <RecentSubmissionsWidget
        pairedTaskId={clickupTaskId}
        member={account?.member}
        onPair={handlePair}
      />

      {/* Brand voice editor */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white">
        <header className="px-4 py-3 border-b border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]/40 flex items-center gap-1.5">
          <Sparkles size={13} className="text-[var(--color-primary-purple)]" />
          <h3 className="text-[13px] font-semibold text-[var(--color-deep-plum)]">
            Brand voice
          </h3>
          {brandVoice && (
            <span className="ml-auto text-[10px] font-semibold text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] px-2 py-0.5 rounded-full">
              Loaded from Intel
            </span>
          )}
        </header>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-[var(--color-purple-gray)]">
            {brandVoice
              ? 'Pre-loaded from this church\'s Intel profile. Review and edit if needed — it\'s injected into every content generation call.'
              : 'Paste the church\'s voice guidelines here. This text is injected into every generate call\'s system prompt — short, specific phrases shape the output more reliably than long paragraphs.'}
          </p>
          <textarea
            value={voiceDraft}
            onChange={e => setVoiceDraft(e.target.value)}
            rows={6}
            placeholder={`e.g. "Warm, real, and a little bit funny. Speaks like a friend who happens to know the Bible. Never preachy."`}
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-3 text-[13px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <SrpButton
              size="sm"
              onClick={() => void handleSaveVoice()}
              disabled={!voiceIsDirty || saving || !account?.member}
              leadingIcon={saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            >
              {saving ? 'Saving…' : 'Save brand voice'}
            </SrpButton>
            {savedAt && !voiceIsDirty && !saveError && (
              <span className="text-[11px] text-wm-success">
                Saved at {savedAt.toLocaleTimeString()}
              </span>
            )}
            {saveError && (
              <span className="text-[11px] text-wm-danger">{saveError}</span>
            )}
          </div>
        </div>
      </section>

      {/* Continue */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <SrpButton
          disabled={!account}
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          Continue to deliverables
        </SrpButton>
      </div>

      {/* Suppress unused-import warning for setCurrentStep */}
      <span className="hidden">{typeof setCurrentStep}</span>
    </div>
  )
}
