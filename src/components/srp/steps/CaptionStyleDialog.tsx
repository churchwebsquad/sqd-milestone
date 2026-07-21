import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { SrpButton } from '../_shared/SrpButton'
import { CAPTION_STYLES, CAPTION_GROUPS, styleBySlug, type CaptionGroup, type CaptionStyleConfig } from '../../../lib/captionStyles'

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

interface Props {
  initial:  CaptionStyleConfig
  onApply:  (cfg: CaptionStyleConfig) => void
  onClose:  () => void
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
        checked ? 'bg-[var(--color-primary-purple)]' : 'bg-[var(--color-lavender)]',
      ].join(' ')}
    >
      <span className={[
        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0.5',
      ].join(' ')} />
    </button>
  )
}

export function CaptionStyleDialog({ initial, onApply, onClose }: Props) {
  const [cfg, setCfg]       = useState<CaptionStyleConfig>(initial)
  const [tab, setTab]       = useState<CaptionGroup>('Traditional')

  const set = <K extends keyof CaptionStyleConfig>(key: K, val: CaptionStyleConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: val }))

  const selectedMeta = styleBySlug(cfg.captionSlug)
  const tabStyles    = CAPTION_STYLES.filter(s => s.group === tab)

  const labelCls  = 'block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1'
  const selectCls = 'w-full rounded-lg border border-[var(--color-lavender)] bg-white px-2.5 py-1.5 text-[12px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]'

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-deep-plum)]/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-[var(--color-lavender)] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-lavender)] shrink-0">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--color-deep-plum)]">Caption Studio</h3>
            <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">Pick a style and fine-tune the look.</p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[var(--color-lavender-tint)] text-[var(--color-purple-gray)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* Style category tabs */}
          <div className="px-6 pt-4 pb-2 border-b border-[var(--color-lavender)] shrink-0">
            <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-2">Style category</p>
            <div className="flex gap-1">
              {CAPTION_GROUPS.map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setTab(g)}
                  className={[
                    'px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors',
                    tab === g
                      ? 'bg-[var(--color-primary-purple)] text-white'
                      : 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender)]',
                  ].join(' ')}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Style grid */}
          <div className="px-6 py-4">
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {tabStyles.map(style => {
                const picked = style.slug === cfg.captionSlug
                return (
                  <li key={style.slug}>
                    <button
                      type="button"
                      onClick={() => handleSelect(style.slug)}
                      className={[
                        'relative w-full aspect-[9/16] rounded-xl border-2 transition-all flex flex-col items-center justify-center overflow-hidden',
                        'bg-gradient-to-b from-[#1a1025] to-[#0d0812]',
                        picked
                          ? 'border-[var(--color-primary-purple)] ring-2 ring-[var(--color-lavender)] ring-offset-1'
                          : 'border-[#2a1f3a] hover:border-[var(--color-primary-purple)]/50',
                      ].join(' ')}
                    >
                      {/* Sample caption text styled to hint at the style */}
                      <span className={[
                        'px-2 text-center leading-tight',
                        style.group === 'Basic' ? 'text-[11px] font-medium' : 'text-[11px] font-bold',
                        style.slug.includes('outline') ? 'text-white' : '',
                        style.slug.includes('italic') ? 'italic' : '',
                        style.slug.includes('neon') ? 'text-purple-400' : 'text-white',
                      ].join(' ')}
                        style={{
                          textShadow: style.slug.includes('neon') ? '0 0 8px #a855f7' : undefined,
                          background: style.usesBackground
                            ? `${style.defaults.bgColor ?? '#000'}cc`
                            : undefined,
                          padding: style.usesBackground ? '2px 6px' : undefined,
                          borderRadius: style.usesBackground ? 4 : undefined,
                        }}
                      >
                        {style.usesHighlight ? (
                          <>well, <span style={{ color: style.defaults.highlightColor ?? '#F8A81C' }}>faith</span></>
                        ) : 'faith made you well'}
                      </span>

                      {/* Label */}
                      <span className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-[9px] font-semibold text-white tracking-wide text-center bg-gradient-to-t from-black/80 to-transparent">
                        {style.label}
                      </span>

                      {picked && (
                        <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary-purple)] text-white">
                          <Check size={10} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>

            {selectedMeta && (
              <p className="mt-3 text-[11px] text-[var(--color-purple-gray)] text-center">
                Selected: <span className="font-semibold text-[var(--color-deep-plum)]">{selectedMeta.label}</span>
                <span className="ml-2 text-[var(--color-primary-purple)]">{selectedMeta.group}</span>
              </p>
            )}
          </div>

          {/* Config controls */}
          <div className="px-6 pb-6 border-t border-[var(--color-lavender)] pt-4 grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Text color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={cfg.textColor} onChange={e => set('textColor', e.target.value)}
                  className="h-8 w-10 rounded cursor-pointer border border-[var(--color-lavender)]" />
                <span className="text-[12px] text-[var(--color-purple-gray)] font-mono">{cfg.textColor}</span>
              </div>
            </div>

            {selectedMeta?.usesHighlight && (
              <div>
                <label className={labelCls}>Highlight color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={cfg.highlightColor} onChange={e => set('highlightColor', e.target.value)}
                    className="h-8 w-10 rounded cursor-pointer border border-[var(--color-lavender)]" />
                  <span className="text-[12px] text-[var(--color-purple-gray)] font-mono">{cfg.highlightColor}</span>
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
                <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">Reverent capitalization</p>
                <p className="text-[11px] text-[var(--color-purple-gray)]">Capitalize God, Lord, Jesus, He / Him / His</p>
              </div>
              <Toggle checked={cfg.reverentCaps} onChange={v => set('reverentCaps', v)} />
            </div>

            <div className="flex items-center justify-between col-span-2 rounded-xl border border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">Deliver as 9:16 reel</p>
                <p className="text-[11px] text-[var(--color-purple-gray)]">Final output cropped to vertical format</p>
              </div>
              <Toggle checked={cfg.deliver9x16} onChange={v => set('deliver9x16', v)} />
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
