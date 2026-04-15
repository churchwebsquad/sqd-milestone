import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { StrategyMilestoneDefinition } from '../types/database'
import { INITIAL_FORM_STATE } from '../components/submit/types'
import type { FormState } from '../components/submit/types'
import StepIndicator from '../components/submit/StepIndicator'
import Step1Partner from '../components/submit/Step1Partner'
import Step2Milestone from '../components/submit/Step2Milestone'
import Step3Sequence from '../components/submit/Step3Sequence'
import Step4Message from '../components/submit/Step4Message'
import Step5Assets from '../components/submit/Step5Assets'
import Step6Contact from '../components/submit/Step6Contact'
import Step7Review from '../components/submit/Step7Review'

const TOTAL_STEPS = 7

export default function SubmitFormPage() {
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<FormState>(() => ({
    ...INITIAL_FORM_STATE,
    memberNumber: searchParams.get('member') ?? '',
  }))
  const [allMilestones, setAllMilestones] = useState<StrategyMilestoneDefinition[]>([])
  const [milestonesLoading, setMilestonesLoading] = useState(true)
  const [milestonesError, setMilestonesError] = useState<string | null>(null)

  const updateForm = (updates: Partial<FormState>) => {
    setFormData(prev => ({ ...prev, ...updates }))
  }

  const goNext = () => setStep(s => Math.min(s + 1, TOTAL_STEPS))
  const goBack = () => setStep(s => Math.max(s - 1, 1))

  const resetForm = () => {
    setFormData(INITIAL_FORM_STATE)
    setStep(1)
  }

  // Load all active milestones once on mount
  useEffect(() => {
    supabase
      .from('strategy_milestone_definitions')
      .select('*')
      .eq('is_active', true)
      .order('squad')
      .order('pathway')
      .order('step_number')
      .then(({ data, error }) => {
        if (error) {
          setMilestonesError('Could not load milestones. Please refresh the page.')
          console.error('[Milestones]', error)
        } else {
          setAllMilestones((data ?? []) as StrategyMilestoneDefinition[])
        }
        setMilestonesLoading(false)
      })
  }, [])

  const stepProps = { formData, updateForm, onNext: goNext, onBack: goBack, allMilestones, onReset: resetForm }

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-deep-plum mb-0.5">Submit Milestone</h1>
          <p className="text-sm text-purple-gray">
            Send a milestone update to a partner via ClickUp.
          </p>
        </div>

        {milestonesError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {milestonesError}
          </div>
        )}

        <div className="mb-6">
          <StepIndicator currentStep={step} />
        </div>

        {step === 1 && <Step1Partner {...stepProps} />}
        {step === 2 && <Step2Milestone {...stepProps} milestonesLoading={milestonesLoading} />}
        {step === 3 && <Step3Sequence {...stepProps} />}
        {step === 4 && <Step6Contact {...stepProps} />}
        {step === 5 && <Step4Message {...stepProps} />}
        {step === 6 && <Step5Assets {...stepProps} />}
        {step === 7 && <Step7Review {...stepProps} />}
      </div>
    </div>
  )
}
