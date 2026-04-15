import { Check } from 'lucide-react'

const STEP_LABELS = ['Partner', 'Milestone', 'Sequence', 'Contact', 'Message', 'Assets', 'Review']

export default function StepIndicator({ currentStep }: { currentStep: number }) {
  const total = STEP_LABELS.length

  return (
    <>
      {/* Mobile: text + progress bar */}
      <div className="md:hidden">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-semibold text-deep-plum">Step {currentStep} of {total}</span>
          <span className="text-purple-gray">{STEP_LABELS[currentStep - 1]}</span>
        </div>
        <div className="h-1.5 bg-lavender rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-purple rounded-full transition-all duration-300"
            style={{ width: `${(currentStep / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Desktop: numbered circles */}
      <div className="hidden md:flex items-start">
        {STEP_LABELS.map((label, i) => {
          const num = i + 1
          const done = num < currentStep
          const active = num === currentStep
          return (
            <div key={num} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center shrink-0">
                <div className={[
                  'h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                  done ? 'bg-deep-plum text-white' :
                  active ? 'bg-primary-purple text-white' :
                  'bg-lavender text-purple-gray',
                ].join(' ')}>
                  {done ? <Check size={13} /> : num}
                </div>
                <span className={[
                  'text-[10px] mt-1 text-center leading-tight w-12 truncate',
                  active ? 'text-deep-plum font-semibold' : 'text-purple-gray',
                ].join(' ')}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={[
                  'flex-1 h-px mt-4 mx-1 transition-colors',
                  num < currentStep ? 'bg-deep-plum' : 'bg-lavender',
                ].join(' ')} />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
