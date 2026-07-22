import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { SrpButton } from '../_shared/SrpButton'
import {
  CAPTION_STYLES, CAPTION_GROUPS, styleBySlug, CUSTOM_SLUG,
  type CaptionGroup, type CaptionStyleConfig,
} from '../../../lib/captionStyles'
import { ClipLoopPlayer } from '../ClipLoopPlayer'
import { VimeoClipLoopPlayer } from '../VimeoClipLoopPlayer'
import { DirectClipLoopPlayer } from '../DirectClipLoopPlayer'

export type { CaptionStyleConfig }

/* ---------- constants ---------- */

const FONTS = [
  { value: '',                  label: "Default (style's font)" },
  { value: 'Inter',             label: 'Inter' },
  { value: 'Georgia',           label: 'Georgia' },
  { value: 'Oswald',            label: 'Oswald' },
  { value: 'Montserrat',        label: 'Montserrat' },
  { value: 'Playfair Display',  label: 'Playfair Display' },
  { value: 'Bebas Neue',        label: 'Bebas Neue' },
]

// values match Duane's engine.ts
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

/* ---------- URL helpers ---------- */

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0]
    if (u.hostname.includes('youtube.com'))
      return u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? null
  } catch { /* ignore */ }
  return null
}

function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('vimeo.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      const id = parts[parts.length - 1]
      return /^\d+$/.test(id) ? id : null
    }
  } catch { /* ignore */ }
  return null
}

function toDirectSrc(url: string): string {
  if (url.includes('dropbox.com')) {
    return url
      .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
      .replace('?dl=0', '')
      .replace('?dl=1', '')
  }
  return url
}

type VideoKind = 'youtube' | 'vimeo' | 'direct' | null

function detectKind(url: string, sourceType?: string | null): VideoKind {
  if (sourceType === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (sourceType === 'vimeo'   || url.includes('vimeo.com'))                               return 'vimeo'
  if (url.includes('dropbox.com') || url.match(/\.(mp4|mov|webm)(\?|$)/i))                return 'direct'
  return null
}

/* ---------- caption overlay renderer ---------- */

const SAMPLE_TEXT      = 'faith has made you well'
const SAMPLE_HIGHLIGHT = 'well'

function CaptionOverlay({ cfg }: { cfg: CaptionStyleConfig }) {
  const meta = styleBySlug(cfg.captionSlug ?? '')
  if (!meta) return null

  const words    = SAMPLE_TEXT.split(' ')
  const scale    = cfg.scale ?? 1.0
  const fontSize = Math.round(14 * scale)
  const offset   = cfg.offset ?? 0

  const posClass = cfg.position === 'top'
    ? 'top-3'
    : cfg.position === 'center'
      ? 'top-1/2 -translate-y-1/2'
      : 'bottom-3'

  const textTransform = cfg.textCase === 'upper'
    ? 'uppercase'
    : cfg.textCase === 'lower'
      ? 'lowercase'
      : cfg.textCase === 'title'
        ? 'capitalize'
        : undefined

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 ${posClass} flex justify-center px-3`}
      style={{ transform: offset ? `translateY(${-offset * 0.12}px)` : undefined }}
    >
      <div className="flex flex-wrap justify-center gap-x-1 gap-y-0.5 max-w-[90%]">
        {words.map((word, i) => {
          const isHighlight = meta.usesHighlight && word === SAMPLE_HIGHLIGHT
          const textColor   = isHighlight ? (cfg.highlightColor ?? meta.defaults.highlightColor ?? '#FBA09C') : (cfg.textColor ?? meta.defaults.textColor)
          const style: React.CSSProperties = {
            color:       textColor,
            fontFamily:  cfg.fontFamily || undefined,
            fontSize:    `${fontSize}px`,
            fontWeight:  'bold',
            textTransform,
            textShadow:  meta.usesBackground ? undefined : '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.8)',
            background:  meta.usesBackground
              ? (isHighlight && !meta.usesHighlight ? (cfg.highlightColor ?? meta.defaults.bgColor ?? '#000') : (cfg.bgColor ?? meta.defaults.bgColor ?? '#000'))
              : undefined,
            padding:     meta.usesBackground ? '1px 6px' : undefined,
            borderRadius: meta.usesBackground ? '3px' : undefined,
          }
          if (isHighlight && meta.usesHighlight && !meta.usesBackground) {
            style.background   = cfg.highlightColor ?? meta.defaults.highlightColor ?? '#FBA09C'
            style.color        = '#000'
            style.padding      = '1px 5px'
            style.borderRadius = '999px'
          }
          return <span key={i} style={style}>{word}</span>
        })}
      </div>
    </div>
  )
}

/* ---------- style tile ---------- */

function StyleTile({ style, selected, onSelect }: { style: typeof CAPTION_STYLES[0]; selected: boolean; onSelect: () => void }) {
  const words = SAMPLE_TEXT.split(' ')
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col items-center gap-1.5 w-full text-left"
    >
      {/* Card */}
      <div
        className={[
          'relative w-full rounded-xl overflow-hidden transition-all',
          'bg-gradient-to-b from-[#1c1030] via-[#150c28] to-[#0d0820]',
          selected
            ? 'ring-2 ring-[var(--color-primary-purple)] ring-offset-2'
            : 'ring-1 ring-white/10 group-hover:ring-[var(--color-primary-purple)]/60',
        ].join(' ')}
        style={{ aspectRatio: '9/16' }}
      >
        {/* Caption preview — centered in the lower third */}
        <div className="absolute inset-x-0 bottom-[28%] flex justify-center px-3">
          <div className="flex flex-wrap justify-center gap-x-1 gap-y-1 max-w-full">
            {words.map((word, i) => {
              const isHighlight = style.usesHighlight && word === SAMPLE_HIGHLIGHT
              const textColor   = isHighlight
                ? (style.defaults.highlightColor ?? '#FBA09C')
                : (style.defaults.textColor ?? '#ffffff')
              const st: React.CSSProperties = {
                color:        textColor,
                fontSize:     '13px',
                fontWeight:   'bold',
                lineHeight:   1.4,
                letterSpacing: '0.01em',
                textShadow:   style.usesBackground ? undefined : '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.8)',
                background:   style.usesBackground ? (style.defaults.bgColor ?? '#000') : undefined,
                padding:      style.usesBackground ? '2px 7px' : undefined,
                borderRadius: style.usesBackground ? '4px' : undefined,
              }
              if (isHighlight && style.usesHighlight && !style.usesBackground) {
                st.background   = style.defaults.highlightColor ?? '#FBA09C'
                st.color        = '#000'
                st.padding      = '2px 6px'
                st.borderRadius = '999px'
              }
              return <span key={i} style={st}>{word}</span>
            })}
          </div>
        </div>

        {/* Selection indicator */}
        <div className={[
          'absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
          selected
            ? 'bg-[var(--color-primary-purple)] border-[var(--color-primary-purple)]'
            : 'bg-transparent border-white/40 group-hover:border-white/70',
        ].join(' ')}>
          {selected && <Check size={10} strokeWidth={3} className="text-white" />}
        </div>
      </div>

      {/* Label below card */}
      <span className={[
        'text-[11px] font-semibold text-center leading-tight transition-colors',
        selected ? 'text-[var(--color-primary-purple)]' : 'text-[var(--color-deep-plum)] group-hover:text-[var(--color-primary-purple)]',
      ].join(' ')}>
        {style.label}
      </span>
    </button>
  )
}

/* ---------- color picker ---------- */

function ColorDial({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="h-8 w-10 rounded cursor-pointer border border-[var(--color-lavender)]" />
        <span className="text-[11px] text-[var(--color-purple-gray)] font-mono">{value}</span>
      </div>
    </div>
  )
}

/* ---------- toggle switch ---------- */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={['relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
        checked ? 'bg-[var(--color-primary-purple)]' : 'bg-[var(--color-lavender)]'].join(' ')}>
      <span className={['inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0.5'].join(' ')} />
    </button>
  )
}

/* ---------- main dialog ---------- */

interface Props {
  initial:          CaptionStyleConfig
  onApply:          (cfg: CaptionStyleConfig) => void
  onClose:          () => void
  videoUrl?:        string
  videoSourceType?: string | null
  clipStartSec?:    number
  clipEndSec?:      number
  clipText?:        string
}

export function CaptionStyleDialog({ initial, onApply, onClose, videoUrl, videoSourceType, clipStartSec, clipEndSec }: Props) {
  const [cfg, setCfg] = useState<CaptionStyleConfig>(initial)
  const [tab, setTab] = useState<CaptionGroup>(() => {
    if (initial.captionSlug === CUSTOM_SLUG) return 'Custom'
    const meta = styleBySlug(initial.captionSlug ?? '')
    return (meta?.group ?? 'Traditional') as CaptionGroup
  })
  const nonce = 0

  const patch = <K extends keyof CaptionStyleConfig>(key: K, val: CaptionStyleConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: val }))

  function handleSelectSlug(slug: string) {
    const meta = styleBySlug(slug)
    if (!meta) return
    setCfg(prev => ({
      ...prev,
      captionSlug:    slug,
      textColor:      meta.defaults.textColor,
      highlightColor: meta.defaults.highlightColor ?? prev.highlightColor ?? '#FBA09C',
      bgColor:        meta.defaults.bgColor ?? prev.bgColor ?? '#000000',
    }))
  }

  const selectedMeta = styleBySlug(cfg.captionSlug ?? '')
  const tabStyles    = CAPTION_STYLES.filter(s => s.group === tab)

  const kind      = videoUrl ? detectKind(videoUrl, videoSourceType) : null
  const youtubeId = kind === 'youtube' ? extractYouTubeId(videoUrl!) : null
  const vimeoId   = kind === 'vimeo'   ? extractVimeoId(videoUrl!)   : null
  const directSrc = kind === 'direct'  ? toDirectSrc(videoUrl!)      : null

  const startSec = clipStartSec ?? null
  const endSec   = clipEndSec   ?? null

  const scaleDisplay = Math.round((cfg.scale ?? 1.0) * 100)

  const labelCls  = 'block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1'
  const selectCls = 'w-full rounded-lg border border-[var(--color-lavender)] bg-white px-2.5 py-1.5 text-[11px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]'
  const rowCls    = 'flex items-center justify-between rounded-xl border border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-3'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-[var(--color-deep-plum)]/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-[var(--color-lavender)] shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-lavender)] shrink-0">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--color-deep-plum)]">Caption Studio</h3>
            <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">Pick a style and fine-tune the look. The preview plays the clip with live captions.</p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[var(--color-lavender-tint)] text-[var(--color-purple-gray)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT — video preview */}
          <div className="w-72 shrink-0 border-r border-[var(--color-lavender)] flex flex-col bg-[var(--color-cream)]">
            <div className="px-4 pt-3 pb-1 shrink-0">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Preview</p>
            </div>
            <div className="flex-1 flex flex-col items-center justify-start px-3 pb-3 min-h-0">
              <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-lg" style={{ aspectRatio: '9/16' }}>
                {kind === 'youtube' && youtubeId && (
                  <ClipLoopPlayer videoId={youtubeId} startSec={startSec} endSec={endSec} nonce={nonce} />
                )}
                {kind === 'vimeo' && vimeoId && (
                  <VimeoClipLoopPlayer vimeoId={vimeoId} startSec={startSec} endSec={endSec} nonce={nonce} />
                )}
                {kind === 'direct' && directSrc && (
                  <DirectClipLoopPlayer src={directSrc} startSec={startSec} endSec={endSec} nonce={nonce} />
                )}
                {!kind && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#2d1b4e] to-[#0d0820]">
                    <div className="w-1/2 h-1/2 rounded-full opacity-20"
                      style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
                  </div>
                )}
                <CaptionOverlay cfg={cfg} />
              </div>
              <p className="text-[9px] text-[var(--color-purple-gray)] text-center mt-1.5 leading-snug">
                Final captions are synced precisely during rendering.
              </p>
            </div>
          </div>

          {/* RIGHT — style picker + controls */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            {/* Category tabs */}
            <div className="px-5 pt-4 pb-2 border-b border-[var(--color-lavender)] shrink-0">
              <p className={labelCls + ' mb-2'}>Style category</p>
              <div className="flex gap-1.5 flex-wrap">
                {CAPTION_GROUPS.map(g => (
                  <button key={g} type="button" onClick={() => setTab(g)}
                    className={['px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors',
                      tab === g
                        ? 'bg-[var(--color-primary-purple)] text-white'
                        : 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender)]',
                    ].join(' ')}>
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-5">

              {/* Style tiles or custom tab */}
              {tab === 'Custom' ? (
                <div className="rounded-xl border-2 border-dashed border-[var(--color-primary-purple)]/40 bg-[var(--color-lavender-tint)] p-5 text-center space-y-3">
                  <div className="text-[32px]">✏️</div>
                  <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">Build your own style</p>
                  <p className="text-[11px] text-[var(--color-purple-gray)] leading-relaxed">
                    Set every caption property below — color, font, position, size, and more.
                  </p>
                  {cfg.captionSlug !== CUSTOM_SLUG ? (
                    <SrpButton variant="secondary" onClick={() => patch('captionSlug', CUSTOM_SLUG)}>
                      Use custom settings
                    </SrpButton>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--color-primary-purple)] text-white text-[11px] font-semibold">
                      <Check size={11} strokeWidth={3} /> Custom style active
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <ul className="grid grid-cols-3 gap-3">
                    {tabStyles.map(style => (
                      <li key={style.slug}>
                        <StyleTile
                          style={style}
                          selected={style.slug === cfg.captionSlug}
                          onSelect={() => handleSelectSlug(style.slug)}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* Controls — exact Duane order */}
              <div className="border-t border-[var(--color-lavender)] pt-4 space-y-4">

                {/* 1. Color dials: text + highlight (if style uses it) + bg (if style uses it) */}
                <div className="grid grid-cols-2 gap-4">
                  <ColorDial
                    label="Text color"
                    value={cfg.textColor ?? selectedMeta?.defaults.textColor ?? '#ffffff'}
                    onChange={v => patch('textColor', v)}
                  />
                  {selectedMeta?.usesHighlight && (
                    <ColorDial
                      label="Highlight"
                      value={cfg.highlightColor ?? selectedMeta.defaults.highlightColor ?? '#FBA09C'}
                      onChange={v => patch('highlightColor', v)}
                    />
                  )}
                  {selectedMeta?.usesBackground && (
                    <ColorDial
                      label="Background"
                      value={cfg.bgColor ?? selectedMeta.defaults.bgColor ?? '#000000'}
                      onChange={v => patch('bgColor', v)}
                    />
                  )}
                </div>

                {/* 2. Font — full width */}
                <div>
                  <label className={labelCls}>Font</label>
                  <select value={cfg.fontFamily ?? ''} onChange={e => patch('fontFamily', e.target.value || undefined)} className={selectCls}>
                    {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>

                {/* 3. Position + Text case */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Position</label>
                    <select value={cfg.position ?? 'bottom'} onChange={e => patch('position', e.target.value as CaptionStyleConfig['position'])} className={selectCls}>
                      {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Text case</label>
                    <select value={cfg.textCase ?? 'as_typed'} onChange={e => patch('textCase', e.target.value as CaptionStyleConfig['textCase'])} className={selectCls}>
                      {TEXT_CASES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* 4. Size slider — 70–140 step 5, value = scale*100 */}
                <div>
                  <label className={labelCls}>Size ({scaleDisplay}%)</label>
                  <input type="range" min={70} max={140} step={5} value={scaleDisplay}
                    onChange={e => patch('scale', Number(e.target.value) / 100)}
                    className="w-full accent-[var(--color-primary-purple)]" />
                </div>

                {/* 5. Vertical offset slider — -120 to 120 step 4 */}
                <div>
                  <label className={labelCls}>Vertical offset ({cfg.offset ?? 0}px)</label>
                  <input type="range" min={-120} max={120} step={4} value={cfg.offset ?? 0}
                    onChange={e => patch('offset', Number(e.target.value))}
                    className="w-full accent-[var(--color-primary-purple)]" />
                </div>

                {/* 6. Words per segment */}
                <div>
                  <label className={labelCls}>Words per segment</label>
                  <select
                    value={cfg.wordsPerSegment ?? 0}
                    onChange={e => patch('wordsPerSegment', Number(e.target.value))}
                    className={selectCls}
                  >
                    <option value={0}>Auto</option>
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* 7. Reverent caps */}
                <div className={rowCls}>
                  <div>
                    <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">Reverent capitalization</p>
                    <p className="text-[10px] text-[var(--color-purple-gray)]">Capitalize God, Lord, Jesus, He / Him / His</p>
                  </div>
                  <Toggle checked={cfg.reverentCaps ?? false} onChange={v => patch('reverentCaps', v)} />
                </div>

                {/* 8. Deliver 9:16 */}
                <div className={rowCls}>
                  <div>
                    <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">Deliver as 9:16 reel</p>
                    <p className="text-[10px] text-[var(--color-purple-gray)]">Final output cropped to vertical format</p>
                  </div>
                  <Toggle checked={cfg.deliver9x16 ?? false} onChange={v => patch('deliver9x16', v)} />
                </div>

              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-lavender)] flex justify-end gap-3 shrink-0">
          <SrpButton variant="ghost" onClick={onClose}>Cancel</SrpButton>
          <SrpButton onClick={() => onApply(cfg)}>Apply</SrpButton>
        </div>
      </div>
    </div>
  )
}
