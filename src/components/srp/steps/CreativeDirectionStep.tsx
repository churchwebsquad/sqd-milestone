import { useCallback, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Save, Music2, Palette, Film, Link } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { CaptionStyleDialog, type CaptionStyleConfig } from './CaptionStyleDialog'
import { MusicPickerDialog } from './MusicPickerDialog'
import { MUSIC_LIBRARY } from '../../../lib/musicLibrary'

const DEFAULT_CAPTION_CFG: CaptionStyleConfig = {
  templateId:      'SRPA',
  textColor:       '#ffffff',
  highlightColor:  '#513DE5',
  font:            '',
  position:        'Bottom',
  textCase:        'As typed',
  sizePct:         100,
  wordsPerSegment: 'Auto',
  reverentCaps:    false,
  deliver9x16:     false,
}

const MUSIC_OPTIONS = [
  {
    value:    'editor_choice',
    label:    "Yes — Video Editor's Choice",
    subtitle: 'A human editor picks and adds music (same as today).',
  },
  {
    value:    'none',
    label:    'No music',
    subtitle: 'Leave the clips without any background music.',
  },
  {
    value:    'select',
    label:    'Select Music (per clip)',
    subtitle: 'Choose a track for each clip (or one default for all) — auto-mastered and baked in.',
  },
]

export function CreativeDirectionStep() {
  const {
    account,
    srpTemplate, setSrpTemplate,
    designerNotes, setDesignerNotes,
    sameCreativeForAll, setSameCreativeForAll,
    musicMode, setMusicMode,
    selectedMusicTrackId, setSelectedMusicTrackId,
    captionStyleConfig, setCaptionStyleConfig,
    deliver9x16, setDeliver9x16,
    outroUrl, setOutroUrl,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [captionDialogOpen, setCaptionDialogOpen] = useState(false)
  const [musicDialogOpen, setMusicDialogOpen] = useState(false)
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [savingDefault, setSavingDefault] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const stepNum = visibleSteps.indexOf('creativeDirection') + 1

  const activeCaptionCfg: CaptionStyleConfig = {
    ...DEFAULT_CAPTION_CFG,
    templateId:  srpTemplate || 'SRPA',
    deliver9x16: deliver9x16,
    ...(captionStyleConfig as Partial<CaptionStyleConfig>),
  }

  const selectedTrack = selectedMusicTrackId
    ? MUSIC_LIBRARY.find(t => t.id === selectedMusicTrackId)
    : null

  const handleApplyCaptions = useCallback((cfg: CaptionStyleConfig) => {
    setSrpTemplate(cfg.templateId)
    setDeliver9x16(cfg.deliver9x16)
    setCaptionStyleConfig(cfg as unknown as Record<string, unknown>)
    setCaptionDialogOpen(false)
  }, [setSrpTemplate, setDeliver9x16, setCaptionStyleConfig])

  const handleContinue = useCallback(async () => {
    if (saveAsDefault && account?.member) {
      setSavingDefault(true)
      setSaveError(null)
      try {
        await callSrpApi('save-clip-template', {
          member:           account.member,
          srp_template:     srpTemplate,
          background_music: musicMode !== 'none',
          designer_notes:   designerNotes || null,
          template_name:    'Default',
        })
        setSavedAt(new Date())
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'save failed')
        setSavingDefault(false)
        return
      } finally {
        setSavingDefault(false)
      }
    }
    goToNextStep()
  }, [saveAsDefault, account?.member, srpTemplate, musicMode, designerNotes, goToNextStep])

  return (
    <>
      {captionDialogOpen && (
        <CaptionStyleDialog
          initial={activeCaptionCfg}
          onApply={handleApplyCaptions}
          onClose={() => setCaptionDialogOpen(false)}
        />
      )}
      {musicDialogOpen && (
        <MusicPickerDialog
          selectedTrackId={selectedMusicTrackId}
          onSelect={id => setSelectedMusicTrackId(id)}
          onClose={() => setMusicDialogOpen(false)}
        />
      )}

      <div className="space-y-6">
        <header>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
            Step {stepNum} of {visibleSteps.length}
          </p>
          <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">{STEP_LABELS.creativeDirection}</h2>
          <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">{STEP_DESCRIPTIONS.creativeDirection}</p>
        </header>

        {/* 1. Same / Different toggle */}
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-3">
            Per-clip creative direction
          </p>
          <p className="text-[13px] font-semibold text-[var(--color-deep-plum)] mb-4">
            Apply same creative direction to all clips?
          </p>
          <div className="flex gap-3">
            {[true, false].map(val => (
              <button
                key={String(val)}
                type="button"
                onClick={() => setSameCreativeForAll(val)}
                className={[
                  'flex-1 rounded-xl border-2 px-4 py-3 text-[13px] font-semibold transition-colors text-left',
                  sameCreativeForAll === val
                    ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]'
                    : 'border-[var(--color-lavender)] text-[var(--color-deep-plum)] hover:border-[var(--color-primary-purple)]/50',
                ].join(' ')}
              >
                {val ? 'Yes — one set of settings for all clips' : 'No — configure each clip separately'}
              </button>
            ))}
          </div>
        </section>

        {/* 2. Caption Style */}
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Palette size={15} className="text-[var(--color-primary-purple)]" />
            <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              Caption Style
            </p>
          </div>

          {srpTemplate && (
            <div className="flex items-center gap-3 text-[12px] text-[var(--color-deep-plum)]">
              <span className="font-semibold">
                {srpTemplate.replace('SRP', 'Template ')}
              </span>
              {deliver9x16 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)] text-[10px] font-semibold uppercase tracking-widest">
                  9:16 reel
                </span>
              )}
            </div>
          )}

          <SrpButton
            variant="secondary"
            leadingIcon={<Film size={14} />}
            onClick={() => setCaptionDialogOpen(true)}
          >
            Choose Caption Style
          </SrpButton>
        </section>

        {/* 3. Music */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Music2 size={15} className="text-[var(--color-primary-purple)]" />
            <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              Background Music
            </p>
          </div>

          <div className="space-y-2">
            {MUSIC_OPTIONS.map(opt => {
              const active = musicMode === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMusicMode(opt.value)}
                  className={[
                    'w-full rounded-xl border-2 px-4 py-3 text-left transition-colors',
                    active
                      ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                      : 'border-[var(--color-lavender)] bg-white hover:border-[var(--color-primary-purple)]/50',
                  ].join(' ')}
                >
                  <p className={[
                    'text-[13px] font-semibold',
                    active ? 'text-[var(--color-primary-purple)]' : 'text-[var(--color-deep-plum)]',
                  ].join(' ')}>
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">{opt.subtitle}</p>
                </button>
              )
            })}
          </div>

          {musicMode === 'select' && (
            <div className="flex items-center gap-3 pt-1">
              <SrpButton
                variant="secondary"
                leadingIcon={<Music2 size={14} />}
                onClick={() => setMusicDialogOpen(true)}
              >
                Choose Track
              </SrpButton>
              {selectedTrack && (
                <span className="text-[12px] text-[var(--color-deep-plum)]">
                  <span className="font-semibold">{selectedTrack.name}</span>
                  <span className="text-[var(--color-purple-gray)] ml-1">({selectedTrack.genre})</span>
                </span>
              )}
            </div>
          )}
        </section>

        {/* 4. Outro video */}
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Link size={15} className="text-[var(--color-primary-purple)]" />
            <label htmlFor="outro-url" className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              Outro video (Dropbox URL)
            </label>
          </div>
          <input
            id="outro-url"
            type="url"
            value={outroUrl}
            onChange={e => setOutroUrl(e.target.value)}
            placeholder="https://www.dropbox.com/..."
            className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-2 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
          <p className="text-[11px] text-[var(--color-purple-gray)]">
            This video is appended to the end of each clip after captions are baked in.
          </p>
        </section>

        {/* Designer notes */}
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4">
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
            Save these settings as the default for <strong>{account?.church_name ?? 'this church'}</strong>. Future SRP sessions will pre-fill the template, music, and notes.
          </label>
        </section>

        {saveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">{saveError}</div>
        )}
        {savedAt && (
          <p className="text-[11px] text-green-600">Saved default at {savedAt.toLocaleTimeString()}.</p>
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
    </>
  )
}
