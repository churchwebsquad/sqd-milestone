/**
 * Step 1 — Account / task selection (holding session only).
 *
 * This step is shown only for holding sessions (no clickup_task_id).
 * The coach:
 *   1. Selects a sermon submission from the Recent Submissions list
 *   2. Clicks Continue → a dedicated task session is created and the
 *      coach is navigated there
 *   3. (Optionally) edits the per-account brand voice
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, Save, Sparkles } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { RecentSubmissionsWidget } from '../RecentSubmissionsWidget'
import { createSession, updateSession, suggestDeliverablesFromText } from '../../../lib/srpSessions'
import { saveBrandVoice } from '../../../lib/squadAccount'
import type { SrpSermonSubmission } from '../../../types/database'

export function AccountSelectionStep() {
  const navigate = useNavigate()
  const {
    sessionId,
    account,
    brandVoice, setBrandVoice,
  } = useSrpWorkflow()

  // Picker always starts empty — user explicitly selects a task
  const [selectedTask, setSelectedTask] = useState<SrpSermonSubmission | null>(null)

  // Local brand voice draft so the textarea doesn't autosave-thrash.
  const [voiceDraft, setVoiceDraft] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)

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

  const handleContinue = useCallback(async () => {
    if (!selectedTask) return

    // If this task already has its own dedicated coach session (distinct from
    // the current holding session), navigate there.
    if (selectedTask.pipeline_session_id &&
        selectedTask.session_status &&
        selectedTask.session_status !== 'background' &&
        selectedTask.pipeline_session_id !== sessionId) {
      navigate(`/social/srp/${encodeURIComponent(selectedTask.pipeline_session_id)}`)
      return
    }

    // Create a new dedicated session for this task
    setPairing(true)
    try {
      // Fetch task description for deliverable detection
      let detectedText = [selectedTask.srp_info_selection, selectedTask.sermon_title, selectedTask.series_title].filter(Boolean).join(' ')
      if (selectedTask.clickup_task_id) {
        try {
          const res = await fetch(`/api/clickup/task-detail?taskId=${encodeURIComponent(selectedTask.clickup_task_id)}`)
          if (res.ok) {
            const td = await res.json()
            detectedText = `${detectedText} ${td.description ?? ''}`.trim()
          }
        } catch { /* non-fatal */ }
      }
      const suggested = suggestDeliverablesFromText(detectedText)

      // Fetch background pipeline data
      let pipelineVideoUrl: string | null = null
      let pipelineTranscript: string | null = null
      let pipelineTranscriptWords: unknown[] | null = null
      let pipelineAutoDrafts: Record<string, unknown> | null = null
      let pipelineHasTimecodes: boolean | null = null
      if (selectedTask.clickup_task_id) {
        try {
          const res = await fetch('/api/srp/get-background-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clickup_task_id: selectedTask.clickup_task_id }),
          })
          if (res.ok) {
            const ps = await res.json()
            if (ps.found) {
              if (ps.video_url)             pipelineVideoUrl        = ps.video_url
              if (ps.transcript)            pipelineTranscript      = ps.transcript
              if (ps.transcript_words)      pipelineTranscriptWords = ps.transcript_words
              if (ps.auto_drafts)           pipelineAutoDrafts      = ps.auto_drafts
              if (ps.has_timecodes != null) pipelineHasTimecodes    = ps.has_timecodes
            }
          }
        } catch { /* non-fatal */ }
      }

      const videoUrlToSave = pipelineVideoUrl ?? selectedTask.video_url ?? null

      // Create the dedicated task session starting at deliverables
      const { session_id: newSlug } = await createSession({
        member:                account?.member ?? 0,
        churchName:            account?.church_name ?? '',
        userEmail:             null,
        clickupTaskId:         selectedTask.clickup_task_id ?? null,
        sermonTitle:           selectedTask.sermon_title ?? null,
        suggestedDeliverables: suggested.length > 0 ? suggested : null,
        videoUrl:              videoUrlToSave,
        startStep:             'deliverables',
      })

      // Hydrate with pipeline data and sermon metadata
      const extras: Record<string, unknown> = {
        sermon_description: selectedTask.sermon_description,
        series_title:       selectedTask.series_title,
        series_description: selectedTask.series_description,
        ...(selectedTask.clickup_task_id ? { clickup_url: `https://app.clickup.com/t/${selectedTask.clickup_task_id}` } : {}),
        ...(pipelineTranscript      ? { transcript:        pipelineTranscript }      : {}),
        ...(pipelineTranscriptWords ? { transcript_words:  pipelineTranscriptWords } : {}),
        ...(pipelineAutoDrafts      ? { auto_drafts:       pipelineAutoDrafts }      : {}),
        ...(pipelineHasTimecodes != null ? { has_timecodes: pipelineHasTimecodes }   : {}),
      }
      if (Object.keys(extras).length > 0) {
        await updateSession(newSlug, extras)
      }

      navigate(`/social/srp/${encodeURIComponent(newSlug)}`)
    } catch (e) {
      console.error('Failed to create task session:', e)
      setPairing(false)
    }
  }, [selectedTask, account, navigate, sessionId])

  const voiceIsDirty = useMemo(
    () => voiceDraft !== (account?.brand_voice_guidelines ?? brandVoice ?? ''),
    [voiceDraft, account?.brand_voice_guidelines, brandVoice],
  )

  return (
    <div className="space-y-6">
      {/* Recent submissions — selection list */}
      <RecentSubmissionsWidget
        selectedTaskId={selectedTask?.clickup_task_id}
        member={account?.member}
        onSelect={setSelectedTask}
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
          disabled={!selectedTask || pairing}
          onClick={() => void handleContinue()}
          trailingIcon={pairing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
        >
          {pairing ? 'Loading…' : 'Continue →'}
        </SrpButton>
      </div>
    </div>
  )
}
