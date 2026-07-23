import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { SrpButton } from '../_shared/SrpButton'
import {
  CAPTION_STYLES, styleBySlug,
  type CaptionGroup, type CaptionStyleConfig,
} from '../../../lib/captionStyles'
import {
  loadCaptionEngine, getCaptionComponent,
  chunkWords, chunkAt, captionHiddenAt,
  applyTextCase, applySacredCaps, synthesizePreviewWords,
  type CaptionWord, type CaptionChunk,
} from '../../../lib/captionEngine'
import { CaptionTile } from '../CaptionTile'

export type { CaptionStyleConfig }

/* ---------- constants ---------- */

const FONTS = [
  { value: '',                 label: "Default (style's font)" },
  { value: 'Inter',            label: 'Inter' },
  { value: 'Georgia',          label: 'Georgia' },
  { value: 'Oswald',           label: 'Oswald' },
  { value: 'Montserrat',       label: 'Montserrat' },
  { value: 'Playfair Display', label: 'Playfair Display' },
  { value: 'Bebas Neue',       label: 'Bebas Neue' },
]
const POSITIONS  = [
  { value: 'top',    label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
]
const TEXT_CASES = [
  { value: 'as_typed', label: 'As typed' },
  { value: 'upper',    label: 'UPPER' },
  { value: 'lower',    label: 'lower' },
  { value: 'title',    label: 'Title' },
]

const GROUPS: CaptionGroup[] = ['Traditional', 'Elevated', 'Reference', 'Basic']

// Full 1080×1920 render reference — same as VidDrop
const REF_W = 1080
const REF_H = 1920

/* ---------- TranscriptSegment type ---------- */
interface TranscriptSegment { startSec: number; endSec: number; text: string }

/* ---------- props ---------- */
interface Props {
  open:         boolean
  onClose:      () => void
  value:        CaptionStyleConfig
  onChange:     (cfg: CaptionStyleConfig) => void
  /** Optional: MP4/video url for the direct clip preview */
  videoUrl?:    string
  /** Optional: parsed transcript segments to drive live captions in preview */
  segments?:    TranscriptSegment[]
  /** Pre-built word timings (rebased to t=0) — takes priority over segments/previewText */
  words?:       CaptionWord[]
  /** Fallback text to synthesize word timings from when no segments/words are available */
  previewText?: string
  /** Optional: title card image URL (1080×1920) to overlay on the preview */
  titleCardUrl?: string
  /** Title card visibility window in milliseconds (from processed_clips) */
  titleCardStartMs?: number | null
  titleCardEndMs?: number | null
}

/* ---------- dialog ---------- */
export function CaptionStyleDialog({ open, onClose, value, onChange, videoUrl, segments, words: wordsProp, previewText, titleCardUrl, titleCardStartMs, titleCardEndMs }: Props) {
  const [activeGroup, setActiveGroup] = useState<CaptionGroup>('Traditional')
  const [engineReady, setEngineReady] = useState(false)
  const [t, setT]                     = useState(0)
  const videoRef                      = useRef<HTMLVideoElement>(null)
  const stageRef                      = useRef<HTMLDivElement>(null)
  const [stageW, setStageW]           = useState(0)

  const motionSlug     = value.captionSlug ?? 'cap01-hormozi-pill'
  const wordsPerSeg    = value.wordsPerSegment ?? 0
  const meta           = styleBySlug(motionSlug)
  const effectiveStyle = useMemo(() => ({ ...(meta?.defaults ?? {}), ...value }), [meta, value])

  // Load caption engine
  useEffect(() => {
    if (!open) return
    let alive = true
    let tries = 0
    const attempt = () => {
      loadCaptionEngine()
        .then(() => { if (alive) setEngineReady(true) })
        .catch((e) => {
          console.error('caption engine load failed', e)
          if (alive && tries++ < 4) setTimeout(attempt, 400)
        })
    }
    attempt()
    return () => { alive = false }
  }, [open])

  // Measure stage width
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => setStageW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  // Drive caption time from video via rAF (same as VidDrop)
  useEffect(() => {
    if (!open) return
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) setT(v.currentTime || 0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  // Build timed words — priority: wordsProp > segments > synthesize from previewText
  const casedWords: CaptionWord[] = useMemo(() => {
    if (!engineReady) return []
    let words: CaptionWord[] = []
    if (wordsProp && wordsProp.length > 0) {
      words = wordsProp
    } else if (segments && segments.length > 0) {
      segments.forEach(seg => {
        const tokens = seg.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
        if (tokens.length === 0) return
        const dur = seg.endSec - seg.startSec
        const per = dur / tokens.length
        tokens.forEach((word, i) => {
          words.push({
            word,
            start: +(seg.startSec + i * per).toFixed(3),
            end:   +(seg.startSec + (i + 1) * per).toFixed(3),
          })
        })
      })
    } else {
      const dur  = videoRef.current?.duration || 30
      const text = previewText?.trim() || 'Your faith has made you well'
      words = synthesizePreviewWords(text, dur)
    }
    words = applyTextCase(words, effectiveStyle.textCase)
    words = applySacredCaps(words, effectiveStyle.reverentCaps)
    return words
  }, [engineReady, wordsProp, segments, previewText, effectiveStyle.textCase, effectiveStyle.reverentCaps])

  const chunks: CaptionChunk[] | null = useMemo(() => {
    if (!engineReady || casedWords.length === 0) return null
    try { return chunkWords(casedWords, wordsPerSeg ? { wordsPerSegment: wordsPerSeg } : undefined) }
    catch { return null }
  }, [engineReady, casedWords, wordsPerSeg])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Comp        = engineReady ? getCaptionComponent((meta as any)?.component ?? motionSlug) : null
  const scale       = (stageW > 0 ? stageW : 270) / REF_W
  const activeChunk = chunks ? chunkAt(chunks, t) : null
  const activeWords = activeChunk?.words ?? casedWords
  const hidden      = casedWords.length > 0 ? captionHiddenAt(casedWords, t, 2) : false

  const patch = (p: Partial<CaptionStyleConfig>) => onChange({ ...value, ...p })


  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-lavender)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-deep-plum)]">Caption Studio</h2>
            <p className="text-xs text-[var(--color-purple-gray)] mt-0.5">
              Pick a style and fine-tune the look. The preview plays the clip with live captions.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden grid md:grid-cols-[270px_1fr]">

          {/* Left: live preview stage */}
          <div className="p-4 border-r border-[var(--color-lavender)] flex flex-col gap-3">
            <div
              ref={stageRef}
              className="relative w-full overflow-hidden rounded-xl bg-black"
              style={{ aspectRatio: '9 / 16' }}
            >
              {/* Video layer — direct MP4 only; captions overlay it */}
              {videoUrl && (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="absolute inset-0 h-full w-full object-cover"
                  muted loop autoPlay playsInline preload="auto"
                />
              )}

              {/* Title card overlay — visible only within its timestamp window */}
              {titleCardUrl && (() => {
                const startS = titleCardStartMs != null ? titleCardStartMs / 1000 : 0
                const endS   = titleCardEndMs   != null ? titleCardEndMs   / 1000 : Infinity
                return t >= startS && t <= endS ? (
                  <img
                    src={titleCardUrl}
                    alt="Title card"
                    className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                  />
                ) : null
              })()}

              {/* Caption overlay: 1080×1920 space scaled down */}
              {Comp && activeWords.length > 0 && (
                <div
                  className="absolute left-0 top-0 origin-top-left pointer-events-none"
                  style={{
                    width:     REF_W,
                    height:    REF_H,
                    transform: `scale(${scale})`,
                    opacity:   hidden ? 0 : 1,
                  }}
                >
                  <Comp
                    t={t}
                    words={activeWords}
                    style={effectiveStyle}
                    mode="render"
                    showFrom={activeChunk?.showFrom ?? 0}
                    showUntil={activeChunk?.showUntil ?? Infinity}
                  />
                </div>
              )}

              {open && !engineReady && (
                <div className="absolute bottom-2 left-2 right-2 text-center text-[10px] text-white/60 pointer-events-none">
                  Loading caption styles…
                </div>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-purple-gray)] text-center">
              {segments?.length ? 'Showing your actual transcript — synced to the clip.' : 'Preview timing is approximate — final captions are synced precisely during rendering.'}
            </p>
          </div>

          {/* Right: controls */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* Style category tabs */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--color-purple-gray)] mb-2">Style category</p>
              <div className="flex gap-1 flex-wrap mb-3">
                {GROUPS.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setActiveGroup(g)}
                    className={[
                      'px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
                      activeGroup === g
                        ? 'bg-[var(--color-deep-plum)] text-white'
                        : 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender)]',
                    ].join(' ')}
                  >
                    {g}
                  </button>
                ))}
              </div>

              {/* Tile grid */}
              {GROUPS.map(g => activeGroup === g && (
                <div key={g} className="grid grid-cols-3 gap-2">
                  {CAPTION_STYLES.filter(s => s.group === g).map(s => (
                    <CaptionTile
                      key={s.slug}
                      meta={s}
                      selected={motionSlug === s.slug}
                      onSelect={() => patch({ captionSlug: s.slug })}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Color pickers */}
            <div className="grid grid-cols-2 gap-4">
              <ColorDial label="Text color"  value={effectiveStyle.textColor  ?? '#ffffff'} onChange={c => patch({ textColor: c })} />
              {meta?.usesHighlight && (
                <ColorDial label="Highlight" value={effectiveStyle.highlightColor ?? '#FBA09C'} onChange={c => patch({ highlightColor: c })} />
              )}
              {meta?.usesBackground && (
                <ColorDial label="Background" value={effectiveStyle.bgColor ?? '#000000'} onChange={c => patch({ bgColor: c })} />
              )}
            </div>

            {/* Font */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">Font</label>
              <select
                value={value.fontFamily ?? ''}
                onChange={e => patch({ fontFamily: e.target.value || undefined })}
                className="w-full rounded-lg border border-[var(--color-lavender)] px-3 py-2 text-sm text-[var(--color-deep-plum)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-purple)]"
              >
                {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            {/* Position + Text case */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">Position</label>
                <select
                  value={effectiveStyle.position ?? 'center'}
                  onChange={e => patch({ position: e.target.value as CaptionStyleConfig['position'] })}
                  className="w-full rounded-lg border border-[var(--color-lavender)] px-3 py-2 text-sm text-[var(--color-deep-plum)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-purple)]"
                >
                  {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">Text case</label>
                <select
                  value={effectiveStyle.textCase ?? 'as_typed'}
                  onChange={e => patch({ textCase: e.target.value as CaptionStyleConfig['textCase'] })}
                  className="w-full rounded-lg border border-[var(--color-lavender)] px-3 py-2 text-sm text-[var(--color-deep-plum)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-purple)]"
                >
                  {TEXT_CASES.map(tc => <option key={tc.value} value={tc.value}>{tc.label}</option>)}
                </select>
              </div>
            </div>

            {/* Size slider */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">
                Size ({Math.round((effectiveStyle.scale ?? 1) * 100)}%)
              </label>
              <input
                type="range" min={70} max={140} step={5}
                value={Math.round((effectiveStyle.scale ?? 1) * 100)}
                onChange={e => patch({ scale: Number(e.target.value) / 100 })}
                className="w-full accent-[var(--color-primary-purple)]"
              />
            </div>

            {/* Vertical offset */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">
                Vertical offset ({effectiveStyle.offset ?? 0}px)
              </label>
              <input
                type="range" min={-120} max={120} step={4}
                value={effectiveStyle.offset ?? 0}
                onChange={e => patch({ offset: Number(e.target.value) })}
                className="w-full accent-[var(--color-primary-purple)]"
              />
            </div>

            {/* Words per segment */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">Words per segment</label>
              <select
                value={String(wordsPerSeg)}
                onChange={e => patch({ wordsPerSegment: Number(e.target.value) })}
                className="w-full rounded-lg border border-[var(--color-lavender)] px-3 py-2 text-sm text-[var(--color-deep-plum)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-purple)]"
              >
                <option value="0">Auto</option>
                {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {/* Reverent caps toggle */}
            <label className="flex items-center justify-between rounded-xl border border-[var(--color-lavender)] p-3 cursor-pointer">
              <div>
                <span className="block text-sm font-semibold text-[var(--color-deep-plum)]">Reverent capitalization</span>
                <span className="block text-[11px] text-[var(--color-purple-gray)] mt-0.5">Capitalize God, Lord, Jesus, He/Him/His.</span>
              </div>
              <div
                role="checkbox"
                aria-checked={!!effectiveStyle.reverentCaps}
                onClick={() => patch({ reverentCaps: !effectiveStyle.reverentCaps })}
                className={[
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer flex-shrink-0 ml-3',
                  effectiveStyle.reverentCaps ? 'bg-[var(--color-primary-purple)]' : 'bg-gray-200',
                ].join(' ')}
              >
                <span className={[
                  'inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform',
                  effectiveStyle.reverentCaps ? 'translate-x-6' : 'translate-x-1',
                ].join(' ')} />
              </div>
            </label>

          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-lavender)]">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-sm font-semibold border border-[var(--color-lavender)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] transition-colors"
          >
            Cancel
          </button>
          <SrpButton onClick={onClose}>Apply →</SrpButton>
        </div>

      </div>
    </div>
  )
}

/* ---------- color picker ---------- */
function ColorDial({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color" value={value}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-[var(--color-lavender)] bg-transparent"
        />
        <span className="text-xs text-[var(--color-purple-gray)] font-mono">{value}</span>
      </div>
    </div>
  )
}
