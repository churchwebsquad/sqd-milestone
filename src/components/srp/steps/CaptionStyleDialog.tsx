import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { SrpButton } from '../_shared/SrpButton'
import {
  CAPTION_STYLES, CAPTION_GROUPS, styleBySlug,
  type CaptionGroup, type CaptionStyleConfig,
} from '../../../lib/captionStyles'
import { ClipLoopPlayer } from '../ClipLoopPlayer'
import { VimeoClipLoopPlayer } from '../VimeoClipLoopPlayer'
import { DirectClipLoopPlayer } from '../DirectClipLoopPlayer'

export type { CaptionStyleConfig }

/* ---------- constants ---------- */

const FONTS = [
  { value: '', label: "Default (style's own font)" },
  { value: 'Inter', label: 'Inter' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Oswald', label: 'Oswald' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Playfair Display', label: 'Playfair Display' },
  { value: 'Bebas Neue', label: 'Bebas Neue' },
]
const POSITIONS         = ['Top', 'Center', 'Bottom']
const TEXT_CASES        = ['As typed', 'UPPER', 'lower', 'Title']
const WORDS_PER_SEGMENT = ['Auto', '1', '2', '3', '4', '5', '6', '7', '8']

/* ---------- URL helpers (same logic as ClipSelectionStep) ---------- */

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
  if (sourceType === 'vimeo' || url.includes('vimeo.com')) return 'vimeo'
  if (url.includes('dropbox.com') || url.match(/\.(mp4|mov|webm)(\?|$)/i)) return 'direct'
  return null
}

/* ---------- caption overlay renderer ---------- */

const SAMPLE_TEXT = 'faith has made you well'
const SAMPLE_HIGHLIGHT = 'well'

function CaptionOverlay({ cfg }: { cfg: CaptionStyleConfig }) {
  const meta = styleBySlug(cfg.captionSlug)
  if (!meta) return null

  const words = SAMPLE_TEXT.split(' ')
  const posClass = cfg.position === 'Top' ? 'top-3' : cfg.position === 'Center' ? 'top-1/2 -translate-y-1/2' : 'bottom-3'

  return (
    <div className={`pointer-events-none absolute inset-x-0 ${posClass} flex justify-center px-3`}>
      <div className="flex flex-wrap justify-center gap-x-1 gap-y-0.5 max-w-[90%]">
        {words.map((word, i) => {
          const isHighlight = meta.usesHighlight && word === SAMPLE_HIGHLIGHT
          const textColor = isHighlight ? (cfg.highlightColor || '#F8A81C') : cfg.textColor
          const style: React.CSSProperties = {
            color: textColor,
            fontFamily: cfg.font || undefined,
            fontSize: `${Math.round(14 * (cfg.sizePct / 100))}px`,
            fontWeight: 'bold',
            textTransform: cfg.textCase === 'UPPER' ? 'uppercase' : cfg.textCase === 'lower' ? 'lowercase' : cfg.textCase === 'Title' ? 'capitalize' : undefined,
            textShadow: meta.usesBackground ? undefined : '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.8)',
            background: meta.usesBackground
              ? (isHighlight ? (cfg.highlightColor || '#CC0000') : (meta.defaults.bgColor || '#000'))
              : undefined,
            padding: meta.usesBackground ? '1px 6px' : undefined,
            borderRadius: meta.usesBackground ? '3px' : undefined,
          }
          if (isHighlight && meta.usesHighlight && !meta.usesBackground) {
            style.background = cfg.highlightColor || '#F8A81C'
            style.color = '#000'
            style.padding = '1px 5px'
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
      className={[
        'relative w-full rounded-xl overflow-hidden transition-all',
        'bg-gradient-to-b from-[#2d1b4e] via-[#1a0f35] to-[#0d0820]',
        selected
          ? 'ring-2 ring-[var(--color-primary-purple)] ring-offset-1'
          : 'hover:ring-1 hover:ring-[var(--color-primary-purple)]/50',
      ].join(' ')}
      style={{ aspectRatio: '9/16' }}
    >
      {/* Bokeh orb like Duane's */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-1/2 h-1/2 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
      </div>

      {/* Caption at bottom */}
      <div className="absolute inset-x-0 bottom-3 flex justify-center px-2">
        <div className="flex flex-wrap justify-center gap-x-0.5 gap-y-0.5 max-w-[95%]">
          {words.map((word, i) => {
            const isHighlight = style.usesHighlight && word === SAMPLE_HIGHLIGHT
            const textColor = isHighlight
              ? (style.defaults.highlightColor || '#F8A81C')
              : (style.defaults.textColor || '#ffffff')
            const st: React.CSSProperties = {
              color: textColor,
              fontSize: '9px',
              fontWeight: 'bold',
              lineHeight: 1.3,
              textShadow: style.usesBackground ? undefined : '0 1px 2px rgba(0,0,0,0.95)',
              background: style.usesBackground
                ? (style.defaults.bgColor || '#000')
                : undefined,
              padding: style.usesBackground ? '0px 4px' : undefined,
              borderRadius: style.usesBackground ? '2px' : undefined,
            }
            if (isHighlight && style.usesHighlight && !style.usesBackground) {
              st.background = style.defaults.highlightColor || '#F8A81C'
              st.color = '#000'
              st.padding = '0px 4px'
              st.borderRadius = '999px'
            }
            return <span key={i} style={st}>{word}</span>
          })}
        </div>
      </div>

      {/* Label */}
      <div className="absolute bottom-0 inset-x-0 h-6 bg-gradient-to-t from-black/70 to-transparent" />
      <span className="absolute bottom-0.5 inset-x-0 text-center text-[8px] font-semibold text-white/80 px-1 truncate">
        {style.label}
      </span>

      {selected && (
        <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary-purple)] text-white shadow">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

/* ---------- toggle ---------- */

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
  initial:       CaptionStyleConfig
  onApply:       (cfg: CaptionStyleConfig) => void
  onClose:       () => void
  /** Full sermon video URL (YouTube/Vimeo/Dropbox/direct) */
  videoUrl?:     string
  videoSourceType?: string | null
  /** Clip start/end in seconds for the preview loop */
  clipStartSec?: number
  clipEndSec?:   number
}

export function CaptionStyleDialog({ initial, onApply, onClose, videoUrl, videoSourceType, clipStartSec, clipEndSec }: Props) {
  const [cfg, setCfg] = useState<CaptionStyleConfig>(initial)
  const [tab, setTab] = useState<CaptionGroup>(() => {
    const meta = styleBySlug(initial.captionSlug)
    return (meta?.group ?? 'Traditional') as CaptionGroup
  })
  const nonce = 0

  const set = <K extends keyof CaptionStyleConfig>(key: K, val: CaptionStyleConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: val }))

  function handleSelect(slug: string) {
    const meta = styleBySlug(slug)
    if (!meta) return
    setCfg(prev => ({
      ...prev,
      captionSlug:    slug,
      textColor:      meta.defaults.textColor,
      highlightColor: meta.defaults.highlightColor ?? prev.highlightColor,
    }))
  }

  const selectedMeta = styleBySlug(cfg.captionSlug)
  const tabStyles    = CAPTION_STYLES.filter(s => s.group === tab)

  // Resolve video kind and IDs
  const kind       = videoUrl ? detectKind(videoUrl, videoSourceType) : null
  const youtubeId  = kind === 'youtube' ? extractYouTubeId(videoUrl!) : null
  const vimeoId    = kind === 'vimeo'   ? extractVimeoId(videoUrl!)   : null
  const directSrc  = kind === 'direct'  ? toDirectSrc(videoUrl!)      : null

  const startSec = clipStartSec ?? null
  const endSec   = clipEndSec   ?? null

  const labelCls  = 'block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1'
  const selectCls = 'w-full rounded-lg border border-[var(--color-lavender)] bg-white px-2.5 py-1.5 text-[11px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-[var(--color-deep-plum)]/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-[var(--color-lavender)] shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-lavender)] shrink-0">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--color-deep-plum)]">Caption Studio</h3>
            <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">Pick a style and fine-tune the look. The preview plays a representative clip with live captions.</p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[var(--color-lavender-tint)] text-[var(--color-purple-gray)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT — video preview */}
          <div className="w-64 shrink-0 border-r border-[var(--color-lavender)] flex flex-col bg-[var(--color-cream)]">
            <div className="px-4 pt-3 pb-1 shrink-0">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Preview</p>
            </div>

            {/* Phone-frame video */}
            <div className="flex-1 flex flex-col items-center justify-start px-3 pb-3 min-h-0">
              <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-lg"
                style={{ aspectRatio: '9/16' }}>
                {kind === 'youtube' && youtubeId && (
                  <ClipLoopPlayer
                    videoId={youtubeId}
                    startSec={startSec}
                    endSec={endSec}
                    nonce={nonce}
                    onTimeUpdate={() => {}}
                  />
                )}
                {kind === 'vimeo' && vimeoId && (
                  <VimeoClipLoopPlayer
                    vimeoId={vimeoId}
                    startSec={startSec}
                    endSec={endSec}
                    nonce={nonce}
                    onTimeUpdate={() => {}}
                  />
                )}
                {kind === 'direct' && directSrc && (
                  <DirectClipLoopPlayer
                    src={directSrc}
                    startSec={startSec}
                    endSec={endSec}
                    nonce={nonce}
                    onTimeUpdate={() => {}}
                  />
                )}
                {!kind && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#2d1b4e] to-[#0d0820]">
                    <div className="w-1/2 h-1/2 rounded-full opacity-20"
                      style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
                  </div>
                )}

                {/* Live caption overlay */}
                <CaptionOverlay cfg={cfg} />
              </div>
              <p className="text-[9px] text-[var(--color-purple-gray)] text-center mt-1.5 leading-snug">
                Preview timing is approximate — final captions are synced precisely during rendering.
              </p>
            </div>
          </div>

          {/* RIGHT — style picker + controls */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            {/* Tabs */}
            <div className="px-5 pt-4 pb-2 border-b border-[var(--color-lavender)] shrink-0">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-2">Style category</p>
              <div className="flex gap-1.5">
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
              {/* Style grid */}
              <ul className="grid grid-cols-3 gap-3">
                {tabStyles.map(style => (
                  <li key={style.slug}>
                    <StyleTile
                      style={style}
                      selected={style.slug === cfg.captionSlug}
                      onSelect={() => handleSelect(style.slug)}
                    />
                  </li>
                ))}
              </ul>

              {selectedMeta && (
                <p className="text-[11px] text-[var(--color-purple-gray)] text-center -mt-1">
                  Selected: <span className="font-semibold text-[var(--color-deep-plum)]">{selectedMeta.label}</span>
                  <span className="ml-2 text-[var(--color-primary-purple)]">{selectedMeta.group}</span>
                </p>
              )}

              {/* Config controls */}
              <div className="border-t border-[var(--color-lavender)] pt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Text color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={cfg.textColor} onChange={e => set('textColor', e.target.value)}
                      className="h-8 w-10 rounded cursor-pointer border border-[var(--color-lavender)]" />
                    <span className="text-[11px] text-[var(--color-purple-gray)] font-mono">{cfg.textColor}</span>
                  </div>
                </div>

                {selectedMeta?.usesHighlight && (
                  <div>
                    <label className={labelCls}>Highlight color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={cfg.highlightColor} onChange={e => set('highlightColor', e.target.value)}
                        className="h-8 w-10 rounded cursor-pointer border border-[var(--color-lavender)]" />
                      <span className="text-[11px] text-[var(--color-purple-gray)] font-mono">{cfg.highlightColor}</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelCls}>Font</label>
                  <select value={cfg.font} onChange={e => set('font', e.target.value)} className={selectCls}>
                    {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Position</label>
                  <select value={cfg.position} onChange={e => set('position', e.target.value)} className={selectCls}>
                    {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Text case</label>
                  <select value={cfg.textCase} onChange={e => set('textCase', e.target.value)} className={selectCls}>
                    {TEXT_CASES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Words per segment</label>
                  <select value={cfg.wordsPerSegment} onChange={e => set('wordsPerSegment', e.target.value)} className={selectCls}>
                    {WORDS_PER_SEGMENT.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className={labelCls}>Size — <span className="font-mono normal-case">{cfg.sizePct}%</span></label>
                  <input type="range" min={70} max={140} value={cfg.sizePct}
                    onChange={e => set('sizePct', Number(e.target.value))}
                    className="w-full accent-[var(--color-primary-purple)]" />
                  <div className="flex justify-between text-[10px] text-[var(--color-purple-gray)] mt-0.5">
                    <span>70%</span><span>140%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between col-span-2 rounded-xl border border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-3">
                  <div>
                    <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">Reverent capitalization</p>
                    <p className="text-[10px] text-[var(--color-purple-gray)]">Capitalize God, Lord, Jesus, He / Him / His</p>
                  </div>
                  <Toggle checked={cfg.reverentCaps} onChange={v => set('reverentCaps', v)} />
                </div>

                <div className="flex items-center justify-between col-span-2 rounded-xl border border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-3">
                  <div>
                    <p className="text-[12px] font-semibold text-[var(--color-deep-plum)]">Deliver as 9:16 reel</p>
                    <p className="text-[10px] text-[var(--color-purple-gray)]">Final output cropped to vertical format</p>
                  </div>
                  <Toggle checked={cfg.deliver9x16} onChange={v => set('deliver9x16', v)} />
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
