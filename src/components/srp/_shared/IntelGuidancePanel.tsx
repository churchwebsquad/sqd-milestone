import { useState } from 'react'
import { ChevronDown, ChevronUp, Brain } from 'lucide-react'

interface IntelGuidancePanelProps {
  title: string
  data: Record<string, unknown> | null | undefined
}

const FIELD_LABELS: Record<string, string> = {
  tone:                    'Tone',
  tone_summary:            'Tone',
  style:                   'Style',
  caption_tone:            'Caption tone',
  caption_style:           'Caption style',
  caption_pattern:         'Caption pattern',
  caption_example:         'Example caption',
  slide_structure:         'Slide structure',
  design_notes:            'Design notes',
  engagement_approach:     'Engagement approach',
  example:                 'Example',
  what_to_highlight:       'What to highlight',
  hook_approach:           'Hook approach',
  clip_selection_guidance: 'Clip guidance',
  music_preference:        'Music preference',
  cover_frame:             'Cover frame',
  summary:                 'What performs well',
  avoid_content:           'Avoid',
  observed_pattern:        'CTA pattern',
  recommendation:          'Recommendation',
  write_with_this_in_mind: 'Write with this in mind',
}

function renderValue(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val
  if (Array.isArray(val)) return val.filter(Boolean).join(', ')
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>
    const parts: string[] = []
    if (o.pattern && typeof o.pattern === 'string') parts.push(o.pattern)
    if (Array.isArray(o.observed_examples)) parts.push(...(o.observed_examples as string[]))
    if (o.recommendation && typeof o.recommendation === 'string') parts.push(o.recommendation as string)
    return parts.filter(Boolean).join(' · ') || null
  }
  return null
}

export function IntelGuidancePanel({ title, data }: IntelGuidancePanelProps) {
  const [open, setOpen] = useState(false)

  if (!data) return null

  const rows: { label: string; value: string }[] = []
  for (const [key, val] of Object.entries(data)) {
    const label = FIELD_LABELS[key] ?? key.replace(/_/g, ' ')
    const value = renderValue(val)
    if (value) rows.push({ label, value })
  }

  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-lavender-tint)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-[var(--color-primary-purple)]" />
          <span className="text-[12px] font-semibold text-[var(--color-deep-plum)]">
            {title} — Church Intel
          </span>
        </div>
        {open
          ? <ChevronUp size={13} className="text-[var(--color-purple-gray)]" />
          : <ChevronDown size={13} className="text-[var(--color-purple-gray)]" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2 border-t border-[var(--color-lavender)]">
          {rows.map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-0.5">
                {label}
              </p>
              <p className="text-[12px] text-[var(--color-deep-plum)] leading-relaxed whitespace-pre-wrap">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
