import { useState, useEffect, useRef } from 'react'
import { AlertTriangle, CheckCircle, Link, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { resolveMergeFields, formatAssetLinks } from '../../lib/mergeFields'
import { submitMilestone } from '../../lib/submitMilestone'
import type { SubmitMilestoneResult } from '../../lib/submitMilestone'
import { fetchProgressRecap, buildRecapText } from '../../lib/progressRecap'
import type { ProgressRecap } from '../../lib/progressRecap'
import { loadAppConfig, DEFAULT_APP_CONFIG } from '../../lib/appConfig'
import type { AppConfig } from '../../types/database'
import type { StepProps } from './types'
import { PATHWAY_LABELS, SQUAD_LABELS, ASSET_TYPE_LABELS } from './types'
import StepNav from './StepNav'

export default function Step7Review({ formData, onBack, onReset, allMilestones }: StepProps) {
  const { user, staffProfile } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitMilestoneResult | null>(null)
  const [dbError, setDbError] = useState<string | null>(null)

  // App config — for footer preview
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG)
  const configLoadedRef = useRef(false)
  useEffect(() => {
    if (configLoadedRef.current) return
    configLoadedRef.current = true
    loadAppConfig().then(setAppConfig)
  }, [])

  // Progress recap — fetched once on mount for preview + reused on submit
  const [recap, setRecap] = useState<ProgressRecap | null>(null)
  const [recapLoading, setRecapLoading] = useState(true)

  const nextMilestone    = allMilestones.find(m => m.id === formData.nextMilestoneId)
  const currentMilestone = allMilestones.find(m => m.id === formData.currentMilestoneId)

  // Resolve ALL merge fields here — Step 7 is the authoritative pass.
  const finalMessage = resolveMergeFields(formData.messageBody, {
    church_name: formData.partner?.church_name,
    first_name_of_primary: formData.partner?.first_name_of_primary,
    step_name: formData.selectedMilestone?.step_name,
    section_group: formData.selectedMilestone?.section_group,
    submitter_name: staffProfile?.full_name ?? staffProfile?.name ?? undefined,
    account_manager: formData.partner?.css_rep,
    partner_contact_name: formData.partnerContactName || undefined,
    asset_links: formData.assets.length > 0 ? formatAssetLinks(formData.assets) : '',
    next_step_name: nextMilestone?.step_name,
  })

  // Fetch the cross-squad progress recap for preview + reuse on submit
  useEffect(() => {
    if (!formData.includeRecap || !formData.partner?.member || !formData.selectedMilestone) {
      setRecapLoading(false)
      return
    }

    setRecapLoading(true)
    fetchProgressRecap(
      formData.partner.member,
      formData.selectedMilestone.squad,
      formData.currentMilestoneId || null,
      formData.nextMilestoneId,
    )
      .then(r => setRecap(r))
      .catch(err => console.warn('[Step7] Recap fetch failed:', err))
      .finally(() => setRecapLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formData.partner?.member,
    formData.selectedMilestone?.id,
    formData.currentMilestoneId,
    formData.nextMilestoneId,
  ])

  const handleSubmit = async () => {
    setSubmitting(true)
    setDbError(null)
    try {
      const res = await submitMilestone({
        formData,
        finalMessage,
        submittedByEmail: user?.email ?? '',
        submittedByName: staffProfile?.full_name ?? staffProfile?.name ?? null,
        submitterClickupId: staffProfile?.clickup_id ?? null,
        progressRecap: recap,   // reuse the already-fetched recap
      })
      setResult(res)
    } catch (err) {
      setDbError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRetry = () => {
    setResult(null)
    setDbError(null)
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (result?.status === 'sent') {
    return (
      <SuccessScreen
        churchName={formData.partner?.church_name ?? ''}
        memberId={formData.partner?.member ?? 0}
        portalToken={formData.partner?.portal_token ?? null}
        submissionId={result.submission.id}
        onReset={onReset ?? (() => {})}
      />
    )
  }

  // ── ClickUp failure screen ────────────────────────────────────────────────
  if (result?.status === 'failed') {
    return (
      <div className="bg-white border border-lavender rounded-2xl p-8 shadow-sm">
        <div className="h-14 w-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="text-amber-600" size={28} />
        </div>
        <h2 className="text-xl font-semibold text-deep-plum mb-1 text-center">Message Not Delivered</h2>
        <p className="text-sm text-purple-gray mb-3 text-center">
          The submission was logged for{' '}
          <strong className="text-deep-plum">{formData.partner?.church_name}</strong>, but the ClickUp
          message could not be sent.
        </p>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-5 text-xs text-amber-800 font-mono break-all">
          {result.clickupError}
        </div>
        <p className="text-xs text-purple-gray text-center mb-6">
          Submission ID: <span className="font-mono">{result.submission.id}</span>
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-full border border-lavender text-deep-plum text-sm font-semibold py-2.5 px-5 hover:bg-lavender-tint transition-colors"
          >
            ← Retry Send
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-full bg-deep-plum text-white text-sm font-semibold py-2.5 px-5 hover:bg-primary-purple transition-colors"
          >
            Submit Another →
          </button>
        </div>
      </div>
    )
  }

  // ── Build the preview message ─────────────────────────────────────────────
  const portalUrl = `${window.location.origin}/portal/${formData.partner?.portal_token ?? formData.partner?.member ?? 0}`
  const recapPreview = recap ? buildRecapText(recap, portalUrl) : null
  const footerPreview = resolveMergeFields(appConfig.standard_footer, {
    submitter_name: staffProfile?.full_name ?? staffProfile?.name ?? undefined,
    account_manager: formData.partner?.css_rep ?? undefined,
  })

  // ── Review form ───────────────────────────────────────────────────────────
  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 7 — Review & Submit</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-6">
        Review everything before sending the milestone update.
      </p>

      <div className="space-y-4">
        {/* Partner */}
        <ReviewCard label="Partner">
          <p className="font-semibold text-deep-plum">{formData.partner?.church_name}</p>
          <p className="text-sm text-purple-gray mt-0.5">
            Member #{formData.partner?.member} · AM: {formData.partner?.css_rep}
          </p>
          {formData.channelId
            ? <p className="text-xs text-purple-gray mt-0.5">ClickUp channel: {formData.channelId}</p>
            : <p className="text-xs text-amber-600 mt-0.5">No ClickUp channel — message will be logged but not sent.</p>
          }
        </ReviewCard>

        {/* Milestone */}
        <ReviewCard label="Milestone">
          <p className="font-semibold text-deep-plum">{formData.selectedMilestone?.step_name}</p>
          <p className="text-sm text-purple-gray mt-0.5">
            {SQUAD_LABELS[formData.selectedMilestone?.squad ?? ''] ?? ''} ·{' '}
            {PATHWAY_LABELS[formData.selectedMilestone?.pathway ?? ''] ?? formData.selectedMilestone?.pathway}
          </p>
          {formData.isContinuation && (
            <span className="inline-block mt-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5">
              Continuation
            </span>
          )}
        </ReviewCard>

        {/* Sequence */}
        <ReviewCard label="Sequence">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <p className="text-xs text-purple-gray mb-0.5 uppercase tracking-wide font-semibold">Current</p>
              <p className="text-sm font-medium text-deep-plum">{currentMilestone?.step_name ?? '—'}</p>
            </div>
            <span className="text-purple-gray">→</span>
            <div>
              <p className="text-xs text-purple-gray mb-0.5 uppercase tracking-wide font-semibold">Next Up</p>
              <p className="text-sm font-medium text-deep-plum">{nextMilestone?.step_name ?? 'Final step'}</p>
            </div>
          </div>
        </ReviewCard>

        {/* Contact */}
        <ReviewCard label="Partner Contact">
          <p className="text-sm text-deep-plum font-medium">{formData.partnerContactName || '—'}</p>
        </ReviewCard>

        {/* Assets */}
        {formData.assets.length > 0 && (
          <ReviewCard label={`Assets (${formData.assets.length})`}>
            <ul className="space-y-1">
              {formData.assets.map(a => (
                <li key={a.id} className="text-sm">
                  <span className="text-purple-gray">{ASSET_TYPE_LABELS[a.type]}</span>
                  {a.label && <span className="text-deep-plum font-medium"> — {a.label}</span>}
                  <br />
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-purple hover:underline text-xs truncate block"
                  >
                    {a.url}
                  </a>
                </li>
              ))}
            </ul>
          </ReviewCard>
        )}

        {/* Final Message — shows body + recap + footer exactly as the partner receives it */}
        <ReviewCard label="Final Message">
          {/* Main body */}
          <pre className="whitespace-pre-wrap text-sm text-deep-plum font-sans leading-relaxed">
            {finalMessage}
          </pre>

          {/* Cross-squad recap preview */}
          {formData.includeRecap ? (
            <div className="mt-3 pt-3 border-t border-lavender/60">
              <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wider mb-2">
                All-In Updates Recap <span className="font-normal normal-case tracking-normal">(auto-appended)</span>
              </p>
              {recapLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border border-lavender border-t-primary-purple" />
                  <span className="text-xs text-purple-gray">Loading cross-squad progress…</span>
                </div>
              ) : recapPreview ? (
                <pre className="whitespace-pre-wrap text-sm text-deep-plum font-sans leading-relaxed bg-lavender-tint/40 rounded-lg px-3 py-2">
                  {recapPreview}
                </pre>
              ) : (
                <p className="text-xs text-purple-gray/50 italic">Recap unavailable</p>
              )}
            </div>
          ) : (
            <div className="mt-3 pt-3 border-t border-lavender/60">
              <p className="text-[10px] text-purple-gray/50 italic">All-In Updates Recap — off</p>
            </div>
          )}

          {/* Questions footer */}
          {formData.includeFooter && footerPreview ? (
            <pre className="whitespace-pre-wrap text-sm text-deep-plum font-sans leading-relaxed mt-3 pt-3 border-t border-lavender/60">
              {footerPreview}
            </pre>
          ) : !formData.includeFooter ? (
            <div className="mt-3 pt-3 border-t border-lavender/60">
              <p className="text-[10px] text-purple-gray/50 italic">Standard footer — off</p>
            </div>
          ) : null}
        </ReviewCard>
      </div>

      {/* DB-level error */}
      {dbError && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <strong>Error:</strong> {dbError}
        </div>
      )}

      <StepNav
        onBack={onBack}
        onNext={handleSubmit}
        nextLabel="Send Milestone Update →"
        loading={submitting}
        isSubmit
      />
    </div>
  )
}

function SuccessScreen({
  churchName,
  memberId,
  portalToken,
  submissionId,
  onReset,
}: {
  churchName: string
  memberId: number
  portalToken: string | null
  submissionId: string
  onReset: () => void
}) {
  const [copied, setCopied] = useState(false)
  const portalUrl = `${window.location.origin}/portal/${portalToken ?? memberId}`
  const handleCopy = () => {
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-white border border-lavender rounded-2xl p-8 shadow-sm text-center">
      <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <CheckCircle className="text-green-600" size={32} />
      </div>
      <h2 className="text-xl font-semibold text-deep-plum mb-1">Message Sent!</h2>
      <p className="text-sm text-purple-gray mb-1">
        Milestone update delivered to{' '}
        <strong className="text-deep-plum">{churchName}</strong>.
      </p>
      <p className="text-xs text-purple-gray mb-6">
        Submission ID: <span className="font-mono">{submissionId}</span>
      </p>

      {/* Portal share */}
      <div className="mb-6 rounded-xl border border-lavender bg-lavender-tint/40 px-4 py-3 text-left">
        <p className="text-xs font-semibold text-purple-gray uppercase tracking-wide mb-2">
          Share progress with your partner
        </p>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-deep-plum font-mono truncate">{portalUrl}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors shrink-0"
          >
            {copied ? <Check size={12} className="text-green-600" /> : <Link size={12} />}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="rounded-full bg-deep-plum text-white text-sm font-semibold py-2.5 px-6 hover:bg-primary-purple transition-colors"
      >
        Submit Another →
      </button>
    </div>
  )
}

function ReviewCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-lavender overflow-hidden">
      <div className="bg-lavender-tint px-4 py-2 border-b border-lavender">
        <p className="text-xs font-semibold text-purple-gray uppercase tracking-wide">{label}</p>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}
