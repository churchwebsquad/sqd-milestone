import { useState } from 'react'
import { ChevronDown, ChevronRight, Tag } from 'lucide-react'
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

interface ExistingTrack {
  name: string
  latestMilestoneId: string
}

const MULTI_TRACK_PATHWAYS = new Set(['ministry_subbrand'])

export default function Step2Milestone({ formData, updateForm, onNext, onBack, allMilestones, milestonesLoading }: StepProps) {
  const [expandedSquads, setExpandedSquads] = useState<Record<string, boolean>>({ brand: true, web: true, social: true })
  const [checkingContinuation, setCheckingContinuation] = useState(false)
  const [lastSub, setLastSub] = useState<LastSub | null>(null)
  const [promptAnswered, setPromptAnswered] = useState(formData.selectedMilestone !== null)
  const [existingTracks, setExistingTracks] = useState<ExistingTrack[]>([])
  const [trackMode, setTrackMode] = useState<'existing' | 'new' | null>(null)
  const [newTrackName, setNewTrackName] = useState('')

  // Group milestones: squad → pathway → steps
  const grouped = allMilestones.reduce<Record<string, Record<string, StrategyMilestoneDefinition[]>>>((acc, m) => {
    if (!acc[m.squad]) acc[m.squad] = {}
    if (!acc[m.squad][m.pathway]) acc[m.squad][m.pathway] = []
    acc[m.squad][m.pathway].push(m)
    return acc
  }, {})

  const isMultiTrack = !!formData.selectedMilestone && MULTI_TRACK_PATHWAYS.has(formData.selectedMilestone.pathway)
  const showContinuationPrompt = lastSub !== null && lastSub.milestone_id === formData.selectedMilestone?.id
  const trackReady = !isMultiTrack || !!formData.trackName?.trim()

  /** Re-check continuation scoped by (milestone_id, track_name). */
  const checkContinuation = async (milestone: StrategyMilestoneDefinition, trackName: string | null) => {
    if (!formData.partner) return
    setCheckingContinuation(true)
    try {
      let q = supabase
        .from('strategy_milestone_submissions')
        .select('id, milestone_id, submitted_at')
        .eq('member', formData.partner.member)
        .eq('milestone_id', milestone.id)
      if (trackName) q = q.eq('track_name', trackName)
      else q = q.is('track_name', null)

      const { data } = await q.order('submitted_at', { ascending: false }).limit(1).maybeSingle()
      if (data) {
        setLastSub(data as LastSub)
        setPromptAnswered(false)
      } else {
        setLastSub(null)
        setPromptAnswered(true)
      }
    } finally {
      setCheckingContinuation(false)
    }
  }

  const handleSelect = async (milestone: StrategyMilestoneDefinition) => {
    const isNewSelection = milestone.id !== formData.selectedMilestone?.id
    const pathwayIsMultiTrack = MULTI_TRACK_PATHWAYS.has(milestone.pathway)

    updateForm({
      selectedMilestone: milestone,
      isContinuation: false,
      continuationOfId: null,
      // Reset track when switching pathways / out of multi-track
      trackName: pathwayIsMultiTrack ? formData.trackName : null,
      ...(isNewSelection ? { messageBody: '', currentMilestoneId: milestone.id, nextMilestoneId: null } : {}),
    })
    setPromptAnswered(false)
    setLastSub(null)

    if (!formData.partner) return

    // Load existing tracks for this pathway (if multi-track)
    if (pathwayIsMultiTrack) {
      const { data: trackData } = await supabase
        .from('strategy_milestone_submissions')
        .select('track_name, milestone_id, submitted_at')
        .eq('member', formData.partner.member)
        .not('track_name', 'is', null)
        .order('submitted_at', { ascending: false })

      const seen = new Set<string>()
      const tracks: ExistingTrack[] = []
      for (const row of (trackData ?? []) as { track_name: string; milestone_id: string }[]) {
        if (row.track_name && !seen.has(row.track_name)) {
          seen.add(row.track_name)
          // only include tracks that belong to this pathway (check via milestone def)
          const def = allMilestones.find(m => m.id === row.milestone_id)
          if (def?.pathway === milestone.pathway) {
            tracks.push({ name: row.track_name, latestMilestoneId: row.milestone_id })
          }
        }
      }
      setExistingTracks(tracks)

      // If user hasn't picked a track mode yet, don't run continuation check
      if (!formData.trackName) {
        setTrackMode(tracks.length > 0 ? 'existing' : 'new')
        return
      }

      // Continuation check scoped to selected track
      await checkContinuation(milestone, formData.trackName)
    } else {
      setExistingTracks([])
      setTrackMode(null)
      await checkContinuation(milestone, null)
    }
  }

  const handlePickExistingTrack = async (name: string) => {
    setTrackMode('existing')
    setNewTrackName('')
    updateForm({ trackName: name })
    if (formData.selectedMilestone) {
      await checkContinuation(formData.selectedMilestone, name)
    }
  }

  const handleUseNewTrack = () => {
    setTrackMode('new')
    updateForm({ trackName: null })
    setLastSub(null)
    setPromptAnswered(false)
  }

  const handleNewTrackNameChange = (value: string) => {
    setNewTrackName(value)
    updateForm({ trackName: value.trim() || null })
    // New track by definition has no prior submission — no continuation prompt
    if (value.trim()) setPromptAnswered(true)
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

  const canContinue = !!formData.selectedMilestone
    && trackReady
    && (promptAnswered || !showContinuationPrompt)

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

      {/* Subbrand / track picker — shown for multi-track pathways */}
      {isMultiTrack && (
        <div className="mt-5 rounded-xl bg-primary-purple/5 border border-primary-purple/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Tag size={14} className="text-primary-purple" />
            <p className="text-sm font-semibold text-deep-plum">Which subbrand?</p>
          </div>
          <p className="text-xs text-purple-gray mb-3">
            Each subbrand is tracked as its own timeline. Pick an existing one to continue, or start a new named track.
          </p>

          <div className="space-y-2">
            {existingTracks.map(t => (
              <label key={t.name} className="flex items-start gap-2 cursor-pointer rounded-lg border border-lavender bg-white px-3 py-2 hover:border-primary-purple/50 transition-colors">
                <input
                  type="radio"
                  name="track"
                  checked={trackMode === 'existing' && formData.trackName === t.name}
                  onChange={() => handlePickExistingTrack(t.name)}
                  className="mt-0.5 accent-primary-purple"
                />
                <span className="text-sm text-deep-plum font-medium flex-1">{t.name}</span>
                <span className="text-[10px] text-purple-gray">Existing</span>
              </label>
            ))}

            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-dashed border-lavender bg-white px-3 py-2 hover:border-primary-purple/50 transition-colors">
              <input
                type="radio"
                name="track"
                checked={trackMode === 'new'}
                onChange={handleUseNewTrack}
                className="mt-0.5 accent-primary-purple"
              />
              <span className="flex-1">
                <span className="text-sm text-deep-plum font-medium block">+ New subbrand</span>
                {trackMode === 'new' && (
                  <input
                    type="text"
                    value={newTrackName}
                    onChange={e => handleNewTrackNameChange(e.target.value)}
                    placeholder="e.g. Kids Ministry"
                    autoFocus
                    className="mt-1.5 w-full rounded-md border border-lavender px-2.5 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
                  />
                )}
              </span>
            </label>
          </div>

          {!trackReady && (
            <p className="text-xs text-amber-700 mt-2">Pick an existing subbrand or enter a new name to continue.</p>
          )}
        </div>
      )}

      {/* Continuation prompt */}
      {trackReady && showContinuationPrompt && lastSub && (
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

          {/* Thread-reply toggle — only when continuation is selected */}
          {promptAnswered && formData.isContinuation && (
            <div className="mt-4 pt-4 border-t border-amber-200/60">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">Where to Post This Update</p>
              <div className="space-y-2">
                {[
                  { value: true, label: 'Reply inside the original thread', desc: 'Keeps all rounds together in one ClickUp conversation (recommended)' },
                  { value: false, label: 'Post as new channel message', desc: 'Starts a fresh top-level message in the channel' },
                ].map(opt => (
                  <label key={String(opt.value)} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="post-location"
                      checked={formData.postAsThreadReply === opt.value}
                      onChange={() => updateForm({ postAsThreadReply: opt.value })}
                      className="mt-0.5 accent-primary-purple"
                    />
                    <span className="flex-1">
                      <span className="text-sm text-amber-800 block">{opt.label}</span>
                      <span className="text-xs text-amber-700/70">{opt.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} loading={checkingContinuation} />
    </div>
  )
}
