interface Props {
  onBack?: () => void
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  loading?: boolean
  isSubmit?: boolean
}

export default function StepNav({
  onBack,
  onNext,
  nextLabel = 'Continue →',
  nextDisabled,
  loading,
  isSubmit,
}: Props) {
  return (
    <div className="flex justify-between items-center pt-5 mt-5 border-t border-lavender">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-purple-gray hover:text-deep-plum transition-colors font-medium"
        >
          ← Back
        </button>
      ) : (
        <div />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || loading}
        className={[
          'rounded-full text-white text-sm font-semibold py-2.5 px-6 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          isSubmit
            ? 'bg-primary-purple hover:bg-deep-plum'
            : 'bg-deep-plum hover:bg-primary-purple',
        ].join(' ')}
      >
        {loading ? 'Loading…' : nextLabel}
      </button>
    </div>
  )
}
