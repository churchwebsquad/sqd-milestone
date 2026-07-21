import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Film, Link, Loader2, Music2, Palette, Save } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { CaptionStyleDialog } from './CaptionStyleDialog'
import { DEFAULT_CAPTION_CFG, type CaptionStyleConfig } from '../../../lib/captionStyles'
import { MusicPickerDialog } from './MusicPickerDialog'
import { MUSIC_LIBRARY } from '../../../lib/musicLibrary'
import { styleBySlug } from '../../../lib/captionStyles'

interface PerClipSettings {
  captionCfg:    CaptionStyleConfig
  musicMode:     string
  musicTrackId:  string
}

const DEFAULT_PER_CLIP: PerClipSettings = {
  captionCfg:   DEFAULT_CAPTION_CFG,
  musicMode:    'editor_choice',
  musicTrackId: '',
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
    label:    'Select Music',
    subtitle: 'Choose a specific track — auto-mastered and baked in.',
  },
]

/* ---------- helpers ---------- */

function CaptionChip({ cfg }: { cfg: CaptionStyleConfig }) {
  const meta = styleBySlug(cfg.captionSlug ?? '')
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {meta && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)] text-[11px] font-semibold">
          {meta.label}
        </span>
      )}
      {cfg.deliver9x16 && (
        <span className="inline-flex px-2 py-0.5 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)] text-[10px] font-semibold uppercase tracking-widest">
          9:16
        </span>
      )}
    </div>
  )
}

function MusicRadio({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      {MUSIC_OPTIONS.map(opt => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
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
  )
}

/* ---------- main component ---------- */

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
    clipSelections,
    videoUrl, videoSourceType,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const stepNum = visibleSteps.indexOf('creativeDirection') + 1

  // -- Global caption cfg (same-for-all mode) --
  const globalCaptionCfg = useMemo<CaptionStyleConfig>(() => ({
    ...DEFAULT_CAPTION_CFG,
    ...(captionStyleConfig as Partial<CaptionStyleConfig>),
    deliver9x16,
  }), [captionStyleConfig, deliver9x16])

  // -- Per-clip settings state --
  const [perClip, setPerClip] = useState<Record<string, PerClipSettings>>(() => {
    const byClip = (captionStyleConfig as { byClip?: Record<string, unknown> }).byClip ?? {}
    const init: Record<string, PerClipSettings> = {}
    for (const clip of clipSelections) {
      const id = clip.clip_id ?? clip.clip_name ?? String(clipSelections.indexOf(clip))
      const stored = byClip[id] as Partial<PerClipSettings> | undefined
      init[id] = { ...DEFAULT_PER_CLIP, ...stored }
    }
    return init
  })

  // -- Dialog state --
  const [captionDialogFor, setCaptionDialogFor] = useState<'global' | string | null>(null)
  const [musicDialogFor,   setMusicDialogFor]   = useState<'global' | string | null>(null)
  const [expandedClips,    setExpandedClips]     = useState<Set<string>>(new Set())

  // -- Save-as-default --
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [savingDefault, setSavingDefault] = useState(false)
  const [saveError,     setSaveError]     = useState<string | null>(null)
  const [savedAt,       setSavedAt]       = useState<Date | null>(null)

  /* helpers */
  const clipKey = (idx: number) =>
    clipSelections[idx]?.clip_id ?? clipSelections[idx]?.clip_name ?? String(idx)

  const toggleExpand = (id: string) =>
    setExpandedClips(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })

  const updatePerClip = (id: string, patch: Partial<PerClipSettings>) =>
    setPerClip(prev => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_PER_CLIP), ...patch } }))

  const selectedGlobalTrack = selectedMusicTrackId
    ? MUSIC_LIBRARY.find(t => t.id === selectedMusicTrackId)
    : null

  /* apply global caption */
  const handleApplyGlobalCaption = useCallback((cfg: CaptionStyleConfig) => {
    if (cfg.captionSlug) setSrpTemplate(cfg.captionSlug)
    setDeliver9x16(cfg.deliver9x16 ?? false)
    setCaptionStyleConfig({ ...cfg } as unknown as Record<string, unknown>)
    setCaptionDialogFor(null)
  }, [setSrpTemplate, setDeliver9x16, setCaptionStyleConfig])

  /* apply per-clip caption */
  const handleApplyClipCaption = useCallback((id: string, cfg: CaptionStyleConfig) => {
    updatePerClip(id, { captionCfg: cfg })
    setCaptionDialogFor(null)
  }, [])

  /* flush per-clip settings into context before navigating */
  const flushPerClip = useCallback(() => {
    const byClip: Record<string, unknown> = {}
    for (const [id, s] of Object.entries(perClip)) {
      byClip[id] = s
    }
    setCaptionStyleConfig({ ...globalCaptionCfg, byClip } as unknown as Record<string, unknown>)
    const musicMap: Record<string, string> = {}
    for (const [id, s] of Object.entries(perClip)) {
      if (s.musicTrackId) musicMap[id] = s.musicTrackId
    }
    // setMusicByClip is not exposed directly; we encode via captionStyleConfig.byClip above
    void musicMap
  }, [perClip, globalCaptionCfg, setCaptionStyleConfig])

  const handleContinue = useCallback(async () => {
    if (!sameCreativeForAll) flushPerClip()

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
  }, [sameCreativeForAll, flushPerClip, saveAsDefault, account?.member, srpTemplate, musicMode, designerNotes, goToNextStep])

  /* ---------- render ---------- */
  return (
    <>
      {/* Global caption dialog */}
      {captionDialogFor === 'global' && (
        <CaptionStyleDialog
          initial={globalCaptionCfg}
          onApply={handleApplyGlobalCaption}
          onClose={() => setCaptionDialogFor(null)}
          videoUrl={videoUrl}
          videoSourceType={videoSourceType}
          clipStartSec={clipSelections[0] ? parseFloat(clipSelections[0].startTime ?? '0') || 0 : undefined}
          clipEndSec={clipSelections[0] ? parseFloat(clipSelections[0].endTime ?? '0') || undefined : undefined}
          clipText={clipSelections[0]?.caption_text ?? clipSelections[0]?.quote}
        />
      )}

      {/* Per-clip caption dialogs */}
      {captionDialogFor !== null && captionDialogFor !== 'global' && (() => {
        const idx = clipSelections.findIndex((c, i) => (c.clip_id ?? c.clip_name ?? String(i)) === captionDialogFor)
        const clip = idx >= 0 ? clipSelections[idx] : undefined
        return (
          <CaptionStyleDialog
            initial={perClip[captionDialogFor]?.captionCfg ?? DEFAULT_CAPTION_CFG}
            onApply={cfg => handleApplyClipCaption(captionDialogFor, cfg)}
            onClose={() => setCaptionDialogFor(null)}
            videoUrl={videoUrl}
            videoSourceType={videoSourceType}
            clipStartSec={clip ? parseFloat(clip.startTime ?? '0') || 0 : undefined}
            clipEndSec={clip ? parseFloat(clip.endTime ?? '0') || undefined : undefined}
            clipText={clip?.caption_text ?? clip?.quote}
          />
        )
      })()}

      {/* Global music dialog */}
      {musicDialogFor === 'global' && (
        <MusicPickerDialog
          selectedTrackId={selectedMusicTrackId}
          onSelect={id => setSelectedMusicTrackId(id)}
          onClose={() => setMusicDialogFor(null)}
        />
      )}

      {/* Per-clip music dialog */}
      {musicDialogFor !== null && musicDialogFor !== 'global' && (
        <MusicPickerDialog
          selectedTrackId={perClip[musicDialogFor]?.musicTrackId ?? ''}
          onSelect={id => {
            updatePerClip(musicDialogFor, { musicTrackId: id })
            setMusicDialogFor(null)
          }}
          onClose={() => setMusicDialogFor(null)}
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
            Apply the same creative direction to all clips?
          </p>
          <div className="flex gap-3">
            {([true, false] as const).map(val => (
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

        {/* ---- SAME FOR ALL MODE ---- */}
        {sameCreativeForAll && (
          <>
            {/* Caption style */}
            <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Palette size={15} className="text-[var(--color-primary-purple)]" />
                <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Caption Style</p>
              </div>
              {globalCaptionCfg.captionSlug && <CaptionChip cfg={globalCaptionCfg} />}
              <SrpButton
                variant="secondary"
                leadingIcon={<Film size={14} />}
                onClick={() => setCaptionDialogFor('global')}
              >
                Choose Caption Style
              </SrpButton>
            </section>

            {/* Background music */}
            <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Music2 size={15} className="text-[var(--color-primary-purple)]" />
                <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Background Music</p>
              </div>
              <MusicRadio value={musicMode} onChange={setMusicMode} />
              {musicMode === 'select' && (
                <div className="flex items-center gap-3 pt-1">
                  <SrpButton
                    variant="secondary"
                    leadingIcon={<Music2 size={14} />}
                    onClick={() => setMusicDialogFor('global')}
                  >
                    Choose Track
                  </SrpButton>
                  {selectedGlobalTrack && (
                    <span className="text-[12px] text-[var(--color-deep-plum)]">
                      <span className="font-semibold">{selectedGlobalTrack.name}</span>
                      <span className="text-[var(--color-purple-gray)] ml-1">({selectedGlobalTrack.genre})</span>
                    </span>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {/* ---- PER-CLIP MODE ---- */}
        {!sameCreativeForAll && clipSelections.length > 0 && (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              Clip settings — configure each clip below
            </p>
            {clipSelections.map((clip, idx) => {
              const id       = clipKey(idx)
              const settings = perClip[id] ?? DEFAULT_PER_CLIP
              const expanded = expandedClips.has(id)
              const captionMeta = styleBySlug(settings.captionCfg.captionSlug ?? '')
              const musicTrack  = settings.musicTrackId
                ? MUSIC_LIBRARY.find(t => t.id === settings.musicTrackId)
                : null

              return (
                <div
                  key={id}
                  className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden"
                >
                  {/* Clip header / collapse toggle */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(id)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--color-deep-plum)] truncate">
                        Clip {idx + 1}{clip.clip_title ? ` — ${clip.clip_title}` : ''}
                      </p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {captionMeta && (
                          <span className="text-[11px] text-[var(--color-purple-gray)]">
                            <span className="font-medium text-[var(--color-deep-plum)]">{captionMeta.label}</span>
                          </span>
                        )}
                        {settings.musicMode !== 'editor_choice' && (
                          <span className="text-[11px] text-[var(--color-purple-gray)]">
                            {settings.musicMode === 'none' ? 'No music' : (musicTrack?.name ?? 'Track selected')}
                          </span>
                        )}
                      </div>
                    </div>
                    {expanded ? <ChevronUp size={16} className="text-[var(--color-purple-gray)] shrink-0" /> : <ChevronDown size={16} className="text-[var(--color-purple-gray)] shrink-0" />}
                  </button>

                  {/* Expanded body */}
                  {expanded && (
                    <div className="border-t border-[var(--color-lavender)] px-5 pb-5 pt-4 space-y-5">
                      {/* Caption */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Palette size={13} className="text-[var(--color-primary-purple)]" />
                          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Caption Style</p>
                        </div>
                        <CaptionChip cfg={settings.captionCfg} />
                        <SrpButton
                          variant="secondary"
                          leadingIcon={<Film size={14} />}
                          onClick={() => setCaptionDialogFor(id)}
                        >
                          Choose Caption Style
                        </SrpButton>
                      </div>

                      {/* Music */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Music2 size={13} className="text-[var(--color-primary-purple)]" />
                          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Background Music</p>
                        </div>
                        <MusicRadio
                          value={settings.musicMode}
                          onChange={v => updatePerClip(id, { musicMode: v })}
                        />
                        {settings.musicMode === 'select' && (
                          <div className="flex items-center gap-3 pt-1">
                            <SrpButton
                              variant="secondary"
                              leadingIcon={<Music2 size={14} />}
                              onClick={() => setMusicDialogFor(id)}
                            >
                              Choose Track
                            </SrpButton>
                            {musicTrack && (
                              <span className="text-[12px] text-[var(--color-deep-plum)]">
                                <span className="font-semibold">{musicTrack.name}</span>
                                <span className="text-[var(--color-purple-gray)] ml-1">({musicTrack.genre})</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Outro video (always shown) */}
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
