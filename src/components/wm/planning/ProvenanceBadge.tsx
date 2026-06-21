/**
 * Tiny "auto" / "manual" / "fallback" / "mixed" chip with a hover
 * tooltip explaining the source. Reused next to every computed
 * field so users can verify *where* a number came from.
 */
import { useState } from 'react'

interface Props {
  provenance: {
    mode: 'auto' | 'manual' | 'mixed' | 'fallback'
    sourceLabel: string
    detail?: string
    asOf?: string
  }
}

const TONE: Record<Props['provenance']['mode'], string> = {
  auto:     'bg-wm-bg-elevated text-wm-text-subtle border-wm-border',
  manual:   'bg-amber-50 text-amber-800 border-amber-200',
  mixed:    'bg-purple-50 text-purple-800 border-purple-200',
  fallback: 'bg-wm-warn-bg text-wm-warn border-wm-warn/40',
}
const LABEL: Record<Props['provenance']['mode'], string> = {
  auto: 'auto', manual: 'manual', mixed: 'mixed', fallback: 'default',
}

export function ProvenanceBadge({ provenance }: Props) {
  const [hover, setHover] = useState(false)
  // Auto mode is the common case (computed signal); rendering a
  // visible chip for every auto field becomes noise. Keep it
  // hover-only — a small dot the user can target without it
  // competing for attention. Manual / fallback / mixed STAY
  // visible because they're the cases the user actually needs to
  // notice ("this number came from a person, not the math" /
  // "this is a default because real data is missing").
  const isAuto = provenance.mode === 'auto'
  const dotMode = isAuto && !hover
  return (
    <span className="relative inline-block">
      <span
        className={
          dotMode
            ? 'inline-block w-1 h-1 rounded-full bg-wm-text-subtle/40 align-middle cursor-help'
            : `inline-flex items-center text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border cursor-help ${TONE[provenance.mode]}`
        }
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        tabIndex={0}
        aria-label={`Source: ${provenance.sourceLabel}`}
      >
        {dotMode ? '' : LABEL[provenance.mode]}
      </span>
      {hover && (
        <span className="absolute z-50 left-0 top-full mt-1 min-w-[200px] max-w-[280px] rounded-md bg-wm-text text-white text-[11px] px-2.5 py-2 shadow-lg pointer-events-none">
          <span className="font-semibold block">{provenance.sourceLabel}</span>
          {provenance.detail && <span className="block opacity-80 mt-0.5">{provenance.detail}</span>}
          {provenance.asOf && (
            <span className="block opacity-60 mt-0.5 font-mono text-[10px]">
              as of {provenance.asOf}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
