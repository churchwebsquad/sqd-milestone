import { CheckCircle2 } from 'lucide-react'
import { STEP_LABELS } from '../../lib/srpSessions'
import type { SrpStep } from '../../types/database'

export function SrpStepIndicator({ steps, currentStep, onJump }: {
  steps: SrpStep[]
  currentStep: SrpStep
  onJump: (s: SrpStep) => void
}) {
  const currentIx = steps.indexOf(currentStep)
  return (
    <ol className="flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => {
        const isActive = i === currentIx
        const isDone   = i < currentIx
        const canJump  = i <= currentIx
        return (
          <li key={s} className="flex items-center gap-2">
            <button
              onClick={() => canJump && onJump(s)}
              disabled={!canJump}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]',
                isActive ? 'bg-wm-accent text-white font-semibold'
                : isDone ? 'bg-wm-success-bg text-wm-success hover:bg-wm-success/20 cursor-pointer'
                : 'bg-wm-bg-elevated text-wm-text-subtle cursor-not-allowed',
              ].join(' ')}
            >
              {isDone ? <CheckCircle2 size={12} /> : <span className="font-mono">{i + 1}</span>}
              {STEP_LABELS[s] ?? s}
            </button>
            {i < steps.length - 1 && (
              <span className="text-wm-text-subtle">›</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
