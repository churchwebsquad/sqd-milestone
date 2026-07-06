/**
 * Step — Service overview (between Sermon input and Clip selection).
 *
 * Calls /api/srp/generate-overview on first load, displays a read-only
 * structured breakdown of the service. Key insights are stored in context
 * so downstream steps (clips, facebook, carousel, photo recap) can use them.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Loader2, RefreshCw,
  BookOpen, Mic2, Megaphone, ListOrdered, Lightbulb, Music,
} from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'

interface BibleVerse    { reference: string; text: string }
interface WorshipSong   { title: string; artist?: string; notes?: string }
interface Announcement  { title: string; details: string }

interface Overview {
  summary:       string
  mainPoints:    string[]
  keyInsights:   string[]
  bibleVerses:   BibleVerse[]
  worshipSongs:  WorshipSong[]
  announcements: Announcement[]
}

interface OverviewResponse {
  overview: Overview
}

export function TranscriptOverviewStep() {
  const {
    transcript,
    account, sermonSubmission,
    keyInsights, setKeyInsights,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [overview,    setOverview]    = useState<Overview | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const stepNum = visibleSteps.indexOf('overview') + 1

  const generate = useCallback(async () => {
    if (!transcript || transcript.trim().length < 200) {
      setError('Transcript too short — go back to the Sermon step.')
      return
    }
    setLoading(true); setError(null)
    try {
      const r = await callSrpApi<OverviewResponse>('generate-overview', {
        transcript,
        churchName:  account?.church_name ?? '',
        speakerName: (sermonSubmission as any)?.speaker_name ?? '',
        sermonTitle: (sermonSubmission as any)?.sermon_title ?? '',
        seriesName:  (sermonSubmission as any)?.series_name  ?? '',
      })
      setOverview(r.overview)
      setKeyInsights(r.overview.keyInsights ?? [])
    } catch (e) {
      const err = e as Error & { errorCode?: string }
      setError(err.errorCode ? `${err.errorCode}: ${err.message}` : err.message)
    } finally {
      setLoading(false)
    }
  }, [transcript, account, sermonSubmission, setKeyInsights])

  // Auto-generate on first mount
  useEffect(() => {
    if (!overview && !loading) void generate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
            Step {stepNum} of {visibleSteps.length}
          </p>
          <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
            {STEP_LABELS.overview}
          </h2>
          <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
            {STEP_DESCRIPTIONS.overview}
          </p>
        </div>
        {overview && (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading}
            className="shrink-0 inline-flex items-center gap-1.5 text-[11px] text-[var(--color-primary-purple)] border border-[var(--color-lavender)] rounded-full px-3 py-1.5 hover:bg-[var(--color-lavender-tint)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Regenerate
          </button>
        )}
      </header>

      {/* Loading */}
      {loading && !overview && (
        <div className="rounded-xl border border-[var(--color-lavender)] bg-white p-8 flex flex-col items-center gap-3 text-center">
          <Loader2 size={24} className="animate-spin text-[var(--color-primary-purple)]" />
          <p className="text-[13px] text-[var(--color-purple-gray)]">Analyzing transcript…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">
          {error}
          <button
            type="button"
            onClick={() => void generate()}
            className="ml-3 underline font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {overview && (
        <div className="space-y-4">

          {/* Summary */}
          <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <Mic2 size={13} className="text-[var(--color-primary-purple)]" />
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Summary</p>
            </div>
            <p className="text-[13px] text-[var(--color-deep-plum)] leading-relaxed">{overview.summary}</p>
          </section>

          {/* Key Insights */}
          {overview.keyInsights?.length > 0 && (
            <section className="rounded-xl border border-[var(--color-primary-purple)]/30 bg-[var(--color-lavender-tint)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb size={13} className="text-[var(--color-primary-purple)]" />
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
                  Key insights · will inform clips &amp; captions
                </p>
              </div>
              <ul className="space-y-2">
                {overview.keyInsights.map((insight, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-[var(--color-deep-plum)]">
                    <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary-purple)] text-white text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    {insight}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Main Points */}
          {overview.mainPoints?.length > 0 && (
            <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <ListOrdered size={13} className="text-[var(--color-primary-purple)]" />
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Main points</p>
              </div>
              <ol className="space-y-2">
                {overview.mainPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-[var(--color-deep-plum)]">
                    <span className="shrink-0 text-[10px] font-bold text-[var(--color-purple-gray)] mt-0.5 w-4">{i + 1}.</span>
                    {point}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Bible Verses */}
          {overview.bibleVerses?.length > 0 && (
            <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen size={13} className="text-[var(--color-primary-purple)]" />
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Scripture references</p>
              </div>
              <ul className="space-y-3">
                {overview.bibleVerses.map((v, i) => (
                  <li key={i}>
                    <p className="text-[11px] font-bold text-[var(--color-primary-purple)] mb-0.5">{v.reference}</p>
                    <p className="text-[12px] text-[var(--color-deep-plum)] italic leading-relaxed">"{v.text}"</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Worship Songs */}
          {overview.worshipSongs?.length > 0 && (
            <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Music size={13} className="text-[var(--color-primary-purple)]" />
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Worship songs</p>
              </div>
              <ul className="space-y-2">
                {overview.worshipSongs.map((s, i) => (
                  <li key={i} className="text-[12px] text-[var(--color-deep-plum)]">
                    <span className="font-semibold">{s.title}</span>
                    {s.artist && <span className="text-[var(--color-purple-gray)]"> — {s.artist}</span>}
                    {s.notes && <span className="text-[var(--color-purple-gray)] block text-[11px] mt-0.5">{s.notes}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Announcements */}
          {overview.announcements?.length > 0 && (
            <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Megaphone size={13} className="text-[var(--color-primary-purple)]" />
                <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Announcements</p>
              </div>
              <ul className="space-y-3">
                {overview.announcements.map((a, i) => (
                  <li key={i}>
                    <p className="text-[12px] font-semibold text-[var(--color-deep-plum)] mb-0.5">{a.title}</p>
                    <p className="text-[12px] text-[var(--color-purple-gray)] leading-relaxed">{a.details}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton
          disabled={!overview || loading}
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          Continue to clip selection
        </SrpButton>
      </div>
    </div>
  )
}
