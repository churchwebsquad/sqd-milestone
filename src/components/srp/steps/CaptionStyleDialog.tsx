import { useEffect, useRef, useState } from 'react'
import { X, Check } from 'lucide-react'
import { SrpButton } from '../_shared/SrpButton'

const TEMPLATE_BASE = 'https://s3.us-central-1.wasabisys.com/sqd-upload-portal/vid1.assets/template.videos'

const TEMPLATES = [
  { id: 'SRPA', label: 'Template A', url: `${TEMPLATE_BASE}/reel_template_a.webm` },
  { id: 'SRPB', label: 'Template B', url: `${TEMPLATE_BASE}/reel_template_b.webm` },
  { id: 'SRPC', label: 'Template C', url: `${TEMPLATE_BASE}/reel_template_c.webm` },
  { id: 'SRPD', label: 'Template D', url: `${TEMPLATE_BASE}/reel_template_d.webm` },
  { id: 'SRPE', label: 'Template E', url: `${TEMPLATE_BASE}/reel_template_e.webm` },
  { id: 'SRPF', label: 'Template F', url: `${TEMPLATE_BASE}/reel_template_f.webm` },
]

const FONTS = [
  { value: '', label: "Default (style's own font)" },
  { value: 'Inter', label: 'Inter' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Oswald', label: 'Oswald' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Playfair Display', label: 'Playfair Display' },
  { value: 'Bebas Neue', label: 'Bebas Neue' },
]

const POSITIONS = ['Top', 'Center', 'Bottom']
const TEXT_CASES = ['As typed', 'UPPER', 'lower', 'Title']
const WORDS_PER_SEGMENT = ['Auto', '1', '2', '3', '4', '5', '6', '7', '8']

export interface CaptionStyleConfig {
  templateId:          string
  textColor:           string
  highlightColor:      string
  font:                string
  position:            string
  textCase:            string
  sizePct:             number
  wordsPerSegment:     string
  reverentCaps:        boolean
  deliver9x16:         boolean
}

interface Props {
  initial:        CaptionStyleConfig
  onApply:        (cfg: CaptionStyleConfig) => void
  onClose:        () => void
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
      <span
        className={[
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  )
}

export function CaptionStyleDialog({ initial, onApply, onClose }: Props) {
  const [cfg, setCfg] = useState<CaptionStyleConfig>(initial)
  const previewRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const vid = previewRef.current
    if (!vid) return
    const tmpl = TEMPLATES.find(t => t.id === cfg.templateId)
    if (!tmpl) return
    vid.src = tmpl.url
    void vid.play().catch(() => undefined)
  }, [cfg.templateId])

  const set = <K extends keyof CaptionStyleConfig>(key: K, val: CaptionStyleConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: val }))

  const labelCls = 'block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1'
  const selectCls = 'w-full rounded-lg border border-[var(--color-lavender)] bg-white px-2.5 py-1.5 text-[12px] text-[var(--color-deep-plum)] focus:outline-none focus:border-[var(--color-primary-purple)]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-deep-plum)]/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-[var(--color-lavender)] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-lavender)]">
          <h3 className="text-[16px] font-semibold text-[var(--color-deep-plum)]">Choose Caption Style</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[var(--color-lavender-tint)] text-[var(--color-purple-gray)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: live preview */}
          <div className="w-[200px] shrink-0 flex flex-col items-center justify-start gap-2 p-4 bg-[var(--color-cream)] border-r border-[var(--color-lavender)]">
            <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">Preview</p>
            <div className="w-full aspect-[9/16] rounded-xl overflow-hidden bg-[var(--color-lavender-tint)] border border-[var(--color-lavender)]">
              <video
                ref={previewRef}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-[11px] text-center text-[var(--color-purple-gray)]">
              {TEMPLATES.find(t => t.id === cfg.templateId)?.label ?? ''}
            </p>
          </div>

          {/* Right: grid + controls */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Template grid */}
            <ul className="grid grid-cols-3 gap-3">
              {TEMPLATES.map(t => {
                const picked = t.id === cfg.templateId
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => set('templateId', t.id)}
                      className={[
                        'relative w-full aspect-[9/16] rounded-xl overflow-hidden border-2 transition-colors bg-[var(--color-lavender-tint)]',
                        picked
                          ? 'border-[var(--color-primary-purple)] ring-2 ring-[var(--color-lavender)] ring-offset-1'
                          : 'border-[var(--color-lavender)] hover:border-[var(--color-primary-purple)]/60',
                      ].join(' ')}
                    >
                      <video
                        src={t.url}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <span className="absolute bottom-0 inset-x-0 px-2 py-1 text-[9px] font-semibold text-white uppercase tracking-widest bg-gradient-to-t from-[var(--color-deep-plum)]/90 to-transparent">
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

            {/* Caption config controls */}
            <div className="border-t border-[var(--color-lavender)] pt-4 grid grid-cols-2 gap-4">
              {/* Text color */}
              <div>
                <label className={labelCls}>Text color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={cfg.textColor || '#ffffff'}
                    onChange={e => set('textColor', e.target.value)}
                    className="h-8 w-10 rounded cursor-pointer border border-[var(--color-lavender)]"
                  />
                  <span className="text-[12px] text-[var(--color-purple-gray)] font-mono">
                    {cfg.textColor || '#ffffff'}
                  </span>
                </div>
              </div>

              {/* Highlight color */}
              <div>
                <label className={labelCls}>Highlight color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={cfg.highlightColor || '#513DE5'}
                    onChange={e => set('highlightColor', e.target.value)}
                    className="h-8 w-10 rounded cursor-pointer border border-[var(--color-lavender)]"
                  />
                  <span className="text-[12px] text-[var(--color-purple-gray)] font-mono">
                    {cfg.highlightColor || '#513DE5'}
                  </span>
                </div>
              </div>

              {/* Font */}
              <div>
                <label className={labelCls}>Font</label>
                <select value={cfg.font} onChange={e => set('font', e.target.value)} className={selectCls}>
                  {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>

              {/* Position */}
              <div>
                <label className={labelCls}>Position</label>
                <select value={cfg.position} onChange={e => set('position', e.target.value)} className={selectCls}>
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* Text case */}
              <div>
                <label className={labelCls}>Text case</label>
                <select value={cfg.textCase} onChange={e => set('textCase', e.target.value)} className={selectCls}>
                  {TEXT_CASES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Words per segment */}
              <div>
                <label className={labelCls}>Words per segment</label>
                <select value={cfg.wordsPerSegment} onChange={e => set('wordsPerSegment', e.target.value)} className={selectCls}>
                  {WORDS_PER_SEGMENT.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>

              {/* Size slider — full width */}
              <div className="col-span-2">
                <label className={labelCls}>
                  Size — <span className="font-mono normal-case">{cfg.sizePct}%</span>
                </label>
                <input
                  type="range"
                  min={70}
                  max={140}
                  value={cfg.sizePct}
                  onChange={e => set('sizePct', Number(e.target.value))}
                  className="w-full accent-[var(--color-primary-purple)]"
                />
                <div className="flex justify-between text-[10px] text-[var(--color-purple-gray)] mt-0.5">
                  <span>70%</span><span>140%</span>
                </div>
              </div>

              {/* Reverent caps */}
              <div className="flex items-center justify-between col-span-2 rounded-xl border border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-3">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">Reverent capitalization</p>
                  <p className="text-[11px] text-[var(--color-purple-gray)]">Capitalize God, Lord, Jesus, He / Him / His</p>
                </div>
                <Toggle checked={cfg.reverentCaps} onChange={v => set('reverentCaps', v)} />
              </div>

              {/* Deliver as 9:16 reel */}
              <div className="flex items-center justify-between col-span-2 rounded-xl border border-[var(--color-lavender)] bg-[var(--color-cream)] px-4 py-3">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">Deliver as 9:16 reel</p>
                  <p className="text-[11px] text-[var(--color-purple-gray)]">Final output cropped to vertical format</p>
                </div>
                <Toggle checked={cfg.deliver9x16} onChange={v => set('deliver9x16', v)} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-lavender)] flex justify-end gap-3">
          <SrpButton variant="ghost" onClick={onClose}>Cancel</SrpButton>
          <SrpButton onClick={() => onApply(cfg)}>Apply</SrpButton>
        </div>
      </div>
    </div>
  )
}
