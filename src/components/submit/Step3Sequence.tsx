import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { StrategyMilestoneDefinition } from '../../types/database'
import type { StepProps } from './types'
import { PATHWAY_LABELS } from './types'
import StepNav from './StepNav'

export default function Step3Sequence({ formData, updateForm, onNext, onBack }: StepProps) {
  const { selectedMilestone, currentMilestoneId, nextMilestoneId } = formData
  const [pathwayMilestones, setPathwayMilestones] = useState<StrategyMilestoneDefinition[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch the full milestone sequence for the selected squad + pathway directly from DB.
  // This runs whenever the selected milestone changes and is independent of allMilestones.
  useEffect(() => {
    if (!selectedMilestone) return

    setLoading(true)
    supabase
      .from('strategy_milestone_definitions')
      .select('*')
      .eq('squad', selectedMilestone.squad)
      .eq('pathway', selectedMilestone.pathway)
      .eq('is_active', true)
      .order('step_number')
      .then(({ data }) => {
        const milestones = (data ?? []) as StrategyMilestoneDefinition[]
        setPathwayMilestones(milestones)

        // Auto-set current = the submitted milestone, next = the one after it
        const idx = milestones.findIndex(m => m.id === selectedMilestone.id)
        updateForm({
          currentMilestoneId: selectedMilestone.id,
          nextMilestoneId: milestones[idx + 1]?.id ?? null,
        })
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMilestone?.id])

  const handleCurrentChange = (newId: string) => {
    const idx = pathwayMilestones.findIndex(m => m.id === newId)
    updateForm({
      currentMilestoneId: newId,
      nextMilestoneId: pathwayMilestones[idx + 1]?.id ?? null,
    })
  }

  if (!selectedMilestone) return null

  const currentStep = pathwayMilestones.find(m => m.id === currentMilestoneId)?.step_number ?? 0

  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 3 — Confirm Sequence</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-5">
        Confirm where <strong>{formData.partner?.church_name}</strong> is in their{' '}
        {PATHWAY_LABELS[selectedMilestone.pathway] ?? selectedMilestone.pathway} pathway.
      </p>

      {/* Visual timeline */}
      {loading ? (
        <div className="flex items-center justify-center h-24 rounded-xl bg-lavender-tint mb-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-lavender border-t-primary-purple" />
        </div>
      ) : (
        <div className="mb-6 space-y-0">
          {pathwayMilestones.map((m, i) => {
            const isCurrent = m.id === currentMilestoneId
            const isNext = m.id === nextMilestoneId
            const isPast = m.step_number < currentStep

            return (
              <div key={m.id} className="flex gap-3">
                {/* Dot + connector column */}
                <div className="flex flex-col items-center" style={{ width: 28 }}>
                  <div className={[
                    'shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2',
                    isCurrent ? 'bg-primary-purple border-primary-purple text-white' :
                    isNext    ? 'bg-white border-deep-plum text-deep-plum' :
                    isPast    ? 'bg-lavender border-lavender text-purple-gray' :
                                'bg-white border-lavender text-purple-gray',
                  ].join(' ')}>
                    {m.step_number}
                  </div>
                  {i < pathwayMilestones.length - 1 && (
                    <div className={`w-px flex-1 my-0.5 min-h-[14px] ${isPast || isCurrent ? 'bg-lavender' : 'bg-lavender/40'}`} />
                  )}
                </div>

                {/* Label */}
                <div className="flex items-center gap-2 pb-2 min-w-0">
                  <span className={[
                    'text-sm truncate',
                    isCurrent ? 'font-semibold text-deep-plum' :
                    isNext    ? 'font-medium text-deep-plum' :
                                'text-purple-gray',
                  ].join(' ')}>
                    {m.step_name}
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 rounded-full bg-primary-purple/10 text-primary-purple text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">
                      Current
                    </span>
                  )}
                  {isNext && (
                    <span className="shrink-0 rounded-full bg-lavender text-deep-plum text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">
                      Next Up
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Override dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-lavender pt-5">
        <div>
          <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
            Current Milestone
          </label>
          <select
            value={currentMilestoneId}
            onChange={e => handleCurrentChange(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 disabled:opacity-60"
          >
            {pathwayMilestones.map(m => (
              <option key={m.id} value={m.id}>{m.step_number}. {m.step_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
            Next Milestone
          </label>
          <select
            value={nextMilestoneId ?? ''}
            onChange={e => updateForm({ nextMilestoneId: e.target.value || null })}
            disabled={loading}
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 disabled:opacity-60"
          >
            <option value="">— None (final step) —</option>
            {pathwayMilestones.map(m => (
              <option key={m.id} value={m.id}>{m.step_number}. {m.step_name}</option>
            ))}
          </select>
        </div>
      </div>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!currentMilestoneId || loading} loading={loading} />
    </div>
  )
}
