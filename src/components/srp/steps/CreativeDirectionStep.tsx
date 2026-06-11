/**
 * Step 10 — Creative direction.
 *
 * Coach picks the SRP template (A-F), toggles background music, drops
 * designer notes. These values are forwarded to the n8n clipcutter on
 * Step 11 as `creative_direction`.
 *
 * Saving as default writes to srp_pipeline.clip_templates via
 * /api/srp/save-clip-template so future SRP sessions for the same
 * church pre-fill these.
 *
 * Template thumbnails are .webm 9:16 loops hosted on the Squad's
 * Wasabi S3 — same URLs srp-generator-main uses.
 */

import { useCallback, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Save, Check, Music2, Music3 } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'

const TEMPLATE_BASE = 'https://s3.us-central-1.wasabisys.com/sqd-upload-portal/vid1.assets/template.videos'
const TEMPLATES = [
  { id: 'SRPA', label: 'Template A', preview: `${TEMPLATE_BASE}/reel_template_a.webm` },
  { id: 'SRPB', label: 'Template B', preview: `${TEMPLATE_BASE}/reel_template_b.webm` },
  { id: 'SRPC', label: 'Template C', preview: `${TEMPLATE_BASE}/reel_template_c.webm` },
  { id: 'SRPD', label: 'Template D', preview: `${TEMPLATE_BASE}/reel_template_d.webm` },
  { id: 'SRPE', label: 'Template E', preview: `${TEMPLATE_BASE}/reel_template_e.webm` },
  { id: 'SRPF', label: 'Template F', preview: `${TEMPLATE_BASE}/reel_template_f.webm` },
]

export function CreativeDirectionStep() {
  const {
    account,
    srpTemplate, setSrpTemplate,
    backgroundMusic, setBackgroundMusic,
    designerNotes, setDesignerNotes,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [saveAsDefault, setSaveAsDefault] = useState<boolean>(false)
  const [savingDefault, setSavingDefault] = useState<boolean>(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const stepNum = visibleSteps.indexOf('creativeDirection') + 1

  const handleContinue = useCallback(async () => {
    if (saveAsDefault && account?.member) {
      setSavingDefault(true); setSaveError(null)
      try {
        await callSrpApi('save-clip-template', {
          member:           account.member,
          srp_template:     srpTemplate,
          background_music: backgroundMusic,
          designer_notes:   designerNotes || null,
          template_name:    'Default',
        })
        setSavedAt(new Date())
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'save failed')
        setSavingDefault(false)
        return  // Block continue if the save failed.
      } finally {
        setSavingDefault(false)
      }
    }
    goToNextStep()
  }, [saveAsDefault, account?.member, srpTemplate, backgroundMusic, designerNotes, goToNextStep])

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">{STEP_LABELS.creativeDirection}</h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.creativeDirection}</p>
      </header>

      {/* Template grid */}
      <section className="space-y-3">
        <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
          SRP template
        </p>
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {TEMPLATES.map(t => {
            const picked = t.id === srpTemplate
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSrpTemplate(t.id)}
                  className={[
                    'relative w-full aspect-[9/16] rounded-xl overflow-hidden border-2 transition-colors group bg-[var(--color-lavender-tint)]',
                    picked
                      ? 'border-[var(--color-primary-purple)] ring-2 ring-[var(--color-lavender)] ring-offset-2'
                      : 'border-[var(--color-lavender)] hover:border-[var(--color-primary-purple)]/50',
                  ].join(' ')}
                >
                  <video
                    src={t.preview}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {/* Label overlay */}
                  <span className="absolute bottom-0 inset-x-0 px-2 py-1 text-[10px] font-semibold text-white uppercase tracking-widest bg-gradient-to-t from-[var(--color-deep-plum)]/90 to-transparent">
                    {t.label}
                  </span>
                  {picked && (
                    <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary-purple)] text-white">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* BGM + designer notes */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[var(--color-deep-plum)] inline-flex items-center gap-1.5">
              {backgroundMusic ? <Music2 size={14} /> : <Music3 size={14} />}
              Background music
            </p>
            <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">
              When ON, the clipcutter mixes a low-volume music bed under the dialog.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={backgroundMusic}
            onClick={() => setBackgroundMusic(!backgroundMusic)}
            className={[
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
              backgroundMusic ? 'bg-[var(--color-primary-purple)]' : 'bg-[var(--color-lavender)]',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                backgroundMusic ? 'translate-x-5' : 'translate-x-0.5',
              ].join(' ')}
            />
          </button>
        </div>

        <div className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
          <label className="block text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-2">
            Designer notes
          </label>
          <textarea
            value={designerNotes}
            onChange={e => setDesignerNotes(e.target.value)}
            rows={3}
            placeholder="e.g. lean warm/tan tones, leave room top-right for the church mark"
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white p-2.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
          />
        </div>
      </section>

      {/* Save as default */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 flex items-start gap-3">
        <input
          id="save-as-default"
          type="checkbox"
          checked={saveAsDefault}
          onChange={e => setSaveAsDefault(e.target.checked)}
          className="mt-0.5 accent-[var(--color-primary-purple)]"
        />
        <label htmlFor="save-as-default" className="text-[12px] text-[var(--color-deep-plum)]">
          Save these settings as the default for <strong>{account?.church_name ?? 'this church'}</strong>. Future SRP sessions for this partner will pre-fill the template, background music, and designer notes.
        </label>
      </section>

      {saveError && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{saveError}</div>
      )}
      {savedAt && (
        <p className="text-[11px] text-wm-success">
          Saved default at {savedAt.toLocaleTimeString()}.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>Back</SrpButton>
        <SrpButton
          onClick={() => void handleContinue()}
          trailingIcon={savingDefault ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
          disabled={savingDefault}
          leadingIcon={saveAsDefault ? <Save size={14} /> : undefined}
        >
          {savingDefault ? 'Saving…' : (saveAsDefault ? 'Save & continue' : 'Continue')}
        </SrpButton>
      </div>
    </div>
  )
}
