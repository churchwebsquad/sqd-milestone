import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Film, Link, Loader2, Music2, Palette, Save } from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { CaptionStyleDialog } from './CaptionStyleDialog'
import { DEFAULT_CAPTION_CFG, type CaptionStyleConfig } from '../../../lib/captionStyles'
import { MusicPickerDialog } from './MusicPickerDialog'
import { MUSIC_LIBRARY } from '../../../lib/musicLibrary'
import { styleBySlug } from '../../../lib/captionStyles'
import { useProcessedClips } from '../../../hooks/useProcessedClips'

function parseSegments(transcript: string | null | undefined) {
  if (!transcript) return undefined
  try {
    const parsed = JSON.parse(transcript)
    if (Array.isArray(parsed) && parsed.length > 0 && 'startSec' in parsed[0]) {
      return parsed as { startSec: number; endSec: number; text: string }[]
    }
  } catch { /* not JSON segments */ }
  return undefined
}

function mmssToSec(ts: string | null | undefined): number {
  if (!ts) return 0
  const parts = String(ts).split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number(ts) || 0
}

function sliceClipWords(
  transcriptWords: unknown[] | null,
  startTs: string | undefined,
  endTs:   string | undefined,
): { word: string; start: number; end: number }[] | undefined {
  if (!Array.isArray(transcriptWords) || !transcriptWords.length) return undefined
  if (!startTs || !endTs) return undefined
  const clipStart = mmssToSec(startTs)
  const clipEnd   = mmssToSec(endTs)
  const slice = (transcriptWords as Record<string, unknown>[])
    .filter(w => {
      const t = typeof w.start === 'number' ? w.start : mmssToSec(w.start as string)
      return t >= clipStart && t <= clipEnd
    })
    .map(w => ({
      word:  typeof w.word === 'string' ? w.word : typeof w.text === 'string' ? w.text : '',
      start: +(((typeof w.start === 'number' ? w.start : mmssToSec(w.start as string)) - clipStart).toFixed(3)),
      end:   +(((typeof w.end   === 'number' ? w.end   : mmssToSec(w.end   as string)) - clipStart).toFixed(3)),
    }))
  return slice.length > 0 ? slice : undefined
}

interface PerClipSettings {
  captionCfg:    CaptionStyleConfig
  musicMode:     string
  musicTrackId:  string
  isWorship:     boolean
  deliver9x16:   boolean
  enhanceAudio:  boolean
}

const DEFAULT_PER_CLIP: PerClipSettings = {
  captionCfg:   DEFAULT_CAPTION_CFG,
  musicMode:    'editor_choice',
  musicTrackId: '',
  isWorship:    false,
  deliver9x16:  false,
  enhanceAudio: true,
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
    musicMode, setMusicMode,
    captionStyleConfig, setCaptionStyleConfig,
    deliver9x16, setDeliver9x16,
    outroUrl, setOutroUrl,
    clipSelections,
    transcriptWords,
    visibleSteps,
    sessionId,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const { clips: processedClips } = useProcessedClips(sessionId)

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

  // -- Save-as-default --
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [savingDefault, setSavingDefault] = useState(false)
  const [saveError,     setSaveError]     = useState<string | null>(null)
  const [savedAt,       setSavedAt]       = useState<Date | null>(null)

  /* helpers */
  const clipKey = (idx: number) =>
    clipSelections[idx]?.clip_id ?? clipSelections[idx]?.clip_name ?? String(idx)

  const updatePerClip = (id: string, patch: Partial<PerClipSettings>) =>
    setPerClip(prev => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_PER_CLIP), ...patch } }))

  /* live-update global caption (called on every change in dialog — must NOT close) */
  const handleApplyGlobalCaption = useCallback((cfg: CaptionStyleConfig) => {
    if (cfg.captionSlug) setSrpTemplate(cfg.captionSlug)
    setDeliver9x16(cfg.deliver9x16 ?? false)
    setCaptionStyleConfig({ ...cfg } as unknown as Record<string, unknown>)
  }, [setSrpTemplate, setDeliver9x16, setCaptionStyleConfig])

  /* live-update per-clip caption (called on every change in dialog — must NOT close) */
  const handleApplyClipCaption = useCallback((id: string, cfg: CaptionStyleConfig) => {
    updatePerClip(id, { captionCfg: cfg })
  }, [updatePerClip])

  /* flush per-clip settings into context before navigating */
  const flushPerClip = useCallback(() => {
    const byClip: Record<string, unknown> = {}
    const enhanceAudioByClip: Record<string, boolean> = {}
    const musicByClipMap: Record<string, string> = {}
    for (const [id, s] of Object.entries(perClip)) {
      byClip[id] = s
      enhanceAudioByClip[id] = s.enhanceAudio ?? true
      if (s.musicMode === 'select' && s.musicTrackId) musicByClipMap[id] = s.musicTrackId
    }
    // Derive a representative musicMode for the global field (used by legacy paths)
    const anySelect = Object.values(perClip).some(s => s.musicMode === 'select')
    const allNone   = Object.values(perClip).every(s => s.musicMode === 'none')
    setMusicMode(anySelect ? 'select' : allNone ? 'none' : 'editor_choice')
    setCaptionStyleConfig({
      ...globalCaptionCfg,
      byClip,
      enhance_audio_by_clip: enhanceAudioByClip,
      music_by_clip:         Object.keys(musicByClipMap).length > 0 ? musicByClipMap : null,
    } as unknown as Record<string, unknown>)
  }, [perClip, globalCaptionCfg, setCaptionStyleConfig, setMusicMode])

  const handleContinue = useCallback(async () => {
    flushPerClip()

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
  }, [flushPerClip, saveAsDefault, account?.member, srpTemplate, musicMode, designerNotes, goToNextStep])

  /* ---------- render ---------- */
  return (
    <>
      {/* Global caption dialog */}
      {captionDialogFor === 'global' && (() => {
        const firstClip   = clipSelections[0]
        const firstClipId = firstClip?.clip_id ?? firstClip?.clip_name ?? ''
        const pc          = processedClips[firstClipId]
        const useRendered = pc?.status === 'ready' && !!pc.video_url
        const approved    = !!pc?.transcript_approved
        const segs        = parseSegments(pc?.transcript)
        const clipWords   = approved ? undefined : sliceClipWords(transcriptWords, firstClip?.startTime, firstClip?.endTime)
        const previewText = firstClip?.caption_text ?? firstClip?.quote ?? undefined
        return (
          <CaptionStyleDialog
            open
            value={globalCaptionCfg}
            onChange={handleApplyGlobalCaption}
            onClose={() => setCaptionDialogFor(null)}
            videoUrl={useRendered ? pc.video_url! : undefined}
            segments={segs}
            words={clipWords}
            previewText={previewText}
          />
        )
      })()}

      {/* Per-clip caption dialogs */}
      {captionDialogFor !== null && captionDialogFor !== 'global' && (() => {
        const _idx = clipSelections.findIndex((c, i) => (c.clip_id ?? c.clip_name ?? String(i)) === captionDialogFor)
        void _idx
        const pc          = processedClips[captionDialogFor]
        const useRendered = pc?.status === 'ready' && !!pc.video_url
        const approved    = !!pc?.transcript_approved
        const segs        = parseSegments(pc?.transcript)
        const clipSel     = clipSelections.find((c, i) => (c.clip_id ?? c.clip_name ?? String(i)) === captionDialogFor)
        const clipWords   = approved ? undefined : sliceClipWords(transcriptWords, clipSel?.startTime, clipSel?.endTime)
        const previewText = clipSel?.caption_text ?? clipSel?.quote ?? undefined
        return (
          <CaptionStyleDialog
            open
            value={perClip[captionDialogFor]?.captionCfg ?? DEFAULT_CAPTION_CFG}
            onChange={(cfg: CaptionStyleConfig) => handleApplyClipCaption(captionDialogFor, cfg)}
            onClose={() => setCaptionDialogFor(null)}
            videoUrl={useRendered ? pc.video_url! : undefined}
            segments={segs}
            words={clipWords}
            previewText={previewText}
          />
        )
      })()}

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

        {/* Caption style — global (sermon clips) */}
        <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Palette size={15} className="text-[var(--color-primary-purple)]" />
            <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Caption Style</p>
          </div>
          <p className="text-[12px] text-[var(--color-purple-gray)]">
            Applies to all sermon clips. Mark individual clips as worship below to set a different style.
          </p>
          {globalCaptionCfg.captionSlug && <CaptionChip cfg={globalCaptionCfg} />}
          <SrpButton
            variant="secondary"
            leadingIcon={<Film size={14} />}
            onClick={() => setCaptionDialogFor('global')}
          >
            Choose Caption Style
          </SrpButton>
        </section>

        {/* Per-clip: worship toggle + 9:16 */}
        {clipSelections.length > 0 && (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
              Per-clip settings
            </p>

            {/* Warn when any clip has a track selected AND enhance audio off */}
            {Object.values(perClip).some(s => s.musicMode === 'select' && s.musicTrackId && !s.enhanceAudio) && (
              <div className="flex gap-3 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-semibold text-amber-800">Two audio tracks will play at once</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    You've turned Enhance Audio OFF on a clip (preserving its live mix) and selected a background track. Both will play on top of each other. Turn Enhance Audio back on if the clip is speech-only, or set Background Music to None for this job.
                  </p>
                </div>
              </div>
            )}
            {clipSelections.map((clip, idx) => {
              const id       = clipKey(idx)
              const settings = perClip[id] ?? DEFAULT_PER_CLIP
              const worshipMeta = styleBySlug(settings.captionCfg.captionSlug ?? '')

              return (
                <div key={id} className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 space-y-3">
                  <p className="text-[13px] font-semibold text-[var(--color-deep-plum)] truncate">
                    Clip {idx + 1}{clip.clip_title ? ` — ${clip.clip_title}` : ''}
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    {/* Worship toggle */}
                    <div className={[
                      'flex-1 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      settings.isWorship
                        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                        : 'border-[var(--color-lavender)]',
                    ].join(' ')}>
                      <div>
                        <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">Worship video</p>
                        <p className="text-[10px] text-[var(--color-purple-gray)]">Uses a different caption style</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings.isWorship}
                        onClick={() => updatePerClip(id, { isWorship: !settings.isWorship })}
                        className={[
                          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
                          settings.isWorship ? 'bg-[var(--color-primary-purple)]' : 'bg-[var(--color-lavender)]',
                        ].join(' ')}
                      >
                        <span className={[
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                          settings.isWorship ? 'translate-x-5' : 'translate-x-0.5',
                        ].join(' ')} />
                      </button>
                    </div>

                    {/* 9:16 toggle */}
                    <div className={[
                      'flex-1 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      settings.deliver9x16
                        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                        : 'border-[var(--color-lavender)]',
                    ].join(' ')}>
                      <div>
                        <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">Deliver as 9:16</p>
                        <p className="text-[10px] text-[var(--color-purple-gray)]">Crop to vertical reel format</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings.deliver9x16}
                        onClick={() => updatePerClip(id, { deliver9x16: !settings.deliver9x16 })}
                        className={[
                          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
                          settings.deliver9x16 ? 'bg-[var(--color-primary-purple)]' : 'bg-[var(--color-lavender)]',
                        ].join(' ')}
                      >
                        <span className={[
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                          settings.deliver9x16 ? 'translate-x-5' : 'translate-x-0.5',
                        ].join(' ')} />
                      </button>
                    </div>
                  </div>

                  {/* Enhance audio toggle */}
                  <div className={[
                    'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                    !settings.enhanceAudio
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-[var(--color-lavender)]',
                  ].join(' ')}>
                    <div>
                      <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">Enhance audio</p>
                      <p className="text-[10px] text-[var(--color-purple-gray)]">
                        {settings.enhanceAudio ? 'ON — audio will be cleaned and leveled' : 'OFF — preserves the clip\'s own live mix'}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.enhanceAudio}
                      onClick={() => updatePerClip(id, { enhanceAudio: !settings.enhanceAudio })}
                      className={[
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
                        settings.enhanceAudio ? 'bg-[var(--color-primary-purple)]' : 'bg-amber-400',
                      ].join(' ')}
                    >
                      <span className={[
                        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                        settings.enhanceAudio ? 'translate-x-5' : 'translate-x-0.5',
                      ].join(' ')} />
                    </button>
                  </div>

                  {/* Background music per clip */}
                  <div className="pt-1 border-t border-[var(--color-lavender)] space-y-2">
                    <div className="flex items-center gap-2 pt-2">
                      <Music2 size={13} className="text-[var(--color-primary-purple)]" />
                      <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Background Music</p>
                    </div>
                    <MusicRadio
                      value={settings.musicMode}
                      onChange={v => updatePerClip(id, { musicMode: v, musicTrackId: v !== 'select' ? '' : settings.musicTrackId })}
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
                        {settings.musicTrackId && (() => {
                          const track = MUSIC_LIBRARY.find(t => t.id === settings.musicTrackId)
                          return track ? (
                            <span className="text-[12px] text-[var(--color-deep-plum)]">
                              <span className="font-semibold">{track.name}</span>
                              <span className="text-[var(--color-purple-gray)] ml-1">({track.genre})</span>
                            </span>
                          ) : null
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Worship caption style picker */}
                  {settings.isWorship && (
                    <div className="space-y-2 pt-1 border-t border-[var(--color-lavender)]">
                      <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] pt-2">Worship caption style</p>
                      {worshipMeta && <CaptionChip cfg={settings.captionCfg} />}
                      <SrpButton
                        variant="secondary"
                        leadingIcon={<Film size={14} />}
                        onClick={() => setCaptionDialogFor(id)}
                      >
                        Choose Worship Style
                      </SrpButton>
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
