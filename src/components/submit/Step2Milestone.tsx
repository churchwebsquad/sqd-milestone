import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { StepProps } from './types'
import { SQUAD_LABELS, PATHWAY_LABELS } from './types'
import type { StrategyMilestoneDefinition } from '../../types/database'
import StepNav from './StepNav'

interface LastSub {
  id: string
  milestone_id: string
  submitted_at: string
}

export default function Step2Milestone({ formData, updateForm, onNext, onBack, allMilestones, milestonesLoading }: StepProps) {
  const [expandedSquads, setExpandedSquads] = useState<Record<string, boolean>>({ brand: true, web: true, social: true })
  const [checkingContinuation, setCheckingContinuation] = useState(false)
  const [lastSub, setLastSub] = useState<LastSub | null>(null)
  const [promptAnswered, setPromptAnswered] = useState(formData.selectedMilestone !== null)

  // Group milestones: squad → pathway → steps
  const grouped = allMilestones.reduce<Record<string, Record<string, StrategyMilestoneDefinition[]>>>((acc, m) => {
    if (!acc[m.squad]) acc[m.squad] = {}
    if (!acc[m.squad][m.pathway]) acc[m.squad][m.pathway] = []
    acc[m.squad][m.pathway].push(m)
    return acc
  }, {})

  const showContinuationPrompt = lastSub !== null && lastSub.milestone_id === formData.selectedMilestone?.id

  const handleSelect = async (milestone: StrategyMilestoneDefinition) => {
    const isNewSelection = milestone.id !== formData.selectedMilestone?.id
    updateForm({
      selectedMilestone: milestone,
      isContinuation: false,
      continuationOfId: null,
      // Clear downstream state on new milestone selection
      ...(isNewSelection ? { messageBody: '', currentMilestoneId: milestone.id, nextMilestoneId: null } : {}),
    })
    setPromptAnswered(false)
    setLastSub(null)

    if (!formData.partner) return
    setCheckingContinuation(true)
    try {
      const { data } = await supabase
        .from('strategy_milestone_submissions')
        .select('id, milestone_id, submitted_at')
        .eq('member', formData.partner.member)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data && (data as LastSub).milestone_id === milestone.id) {
        setLastSub(data as LastSub)
      } else {
        setPromptAnswered(true)
      }
    } finally {
      setCheckingContinuation(false)
    }
  }

  const handleContinuationChoice = (isContinuation: boolean) => {
    updateForm({
      isContinuation,
      continuationOfId: isContinuation ? (lastSub?.id ?? null) : null,
      messageBody: '',
    })
    setPromptAnswered(true)
  }

  const toggleSquad = (squad: string) => {
    setExpandedSquads(prev => ({ ...prev, [squad]: !prev[squad] }))
  }

  const canContinue = !!formData.selectedMilestone && (promptAnswered || !showContinuationPrompt)

  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 2 — Select Milestone</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-5">
        Submitting for <span className="font-medium text-deep-plum">{formData.partner?.church_name}</span>
      </p>

      {milestonesLoading && allMilestones.length === 0 && (
        <div className="flex items-center justify-center h-24 rounded-xl bg-lavender-tint">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-lavender border-t-primary-purple" />
        </div>
      )}
      {!milestonesLoading && allMilestones.length === 0 && (
        <div className="flex items-center justify-center h-24 rounded-xl bg-lavender-tint">
          <p className="text-sm text-purple-gray">No milestones found. Check that milestone definitions are set up in Supabase.</p>
        </div>
      )}

      <div className="space-y-3">
        {Object.entries(grouped).map(([squad, pathways]) => (
          <div key={squad} className="border border-lavender rounded-xl overflow-hidden">
            {/* Squad header */}
            <button
              type="button"
              onClick={() => toggleSquad(squad)}
              className="w-full flex items-center justify-between px-4 py-3 bg-lavender-tint hover:bg-lavender/30 transition-colors"
            >
              <span className="text-sm font-semibold text-deep-plum uppercase tracking-wide">
                {SQUAD_LABELS[squad] ?? squad}
              </span>
              {expandedSquads[squad]
                ? <ChevronDown size={16} className="text-purple-gray" />
                : <ChevronRight size={16} className="text-purple-gray" />
              }
            </button>

            {expandedSquads[squad] && (
              <div className="divide-y divide-lavender/60">
                {Object.entries(pathways).map(([pathway, steps]) => (
                  <div key={pathway} className="px-4 py-3">
                    <p className="text-xs font-semibold text-purple-gray uppercase tracking-wide mb-2">
                      {PATHWAY_LABELS[pathway] ?? pathway}
                    </p>
                    <div className="space-y-1">
                      {steps
                        .sort((a, b) => a.step_number - b.step_number)
                        .map(m => {
                          const isSelected = formData.selectedMilestone?.id === m.id
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => handleSelect(m)}
                              className={[
                                'w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                                isSelected
                                  ? 'bg-primary-purple/10 border border-primary-purple/30'
                                  : 'hover:bg-lavender/30 border border-transparent',
                              ].join(' ')}
                            >
                              <span className={[
                                'shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold',
                                isSelected ? 'bg-primary-purple text-white' : 'bg-lavender text-purple-gray',
                              ].join(' ')}>
                                {m.step_number}
                              </span>
                              <div className="min-w-0">
                                <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary-purple' : 'text-deep-plum'}`}>
                                  {m.step_name}
                                </p>
                                {m.section_group && (
                                  <p className="text-xs text-purple-gray truncate">{m.section_group}</p>
                                )}
                              </div>
                            </button>
                          )
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Continuation prompt */}
      {showContinuationPrompt && lastSub && (
        <div className="mt-5 rounded-xl bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">Previous submission detected</p>
          <p className="text-sm text-amber-700 mb-3">
            The last submission for <strong>{formData.partner?.church_name}</strong> was also{' '}
            <strong>{formData.selectedMilestone?.step_name}</strong> on{' '}
            {new Date(lastSub.submitted_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
            Is this a continuation or a new submission?
          </p>
          {checkingContinuation && <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />}
          <div className="space-y-2">
            {[
              { value: true, label: 'Continuation (e.g. round 2 edits — previous stays active)' },
              { value: false, label: 'New submission (previous milestone is now complete)' },
            ].map(opt => (
              <label key={String(opt.value)} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="continuation"
                  checked={promptAnswered && formData.isContinuation === opt.value}
                  onChange={() => handleContinuationChoice(opt.value)}
                  className="mt-0.5 accent-primary-purple"
                />
                <span className="text-sm text-amber-800">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} loading={checkingContinuation} />
    </div>
  )
}
