import { useState } from 'react'
import { updateSession } from '../../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../../types/database'
import { GeneratorShell } from './GeneratorShell'
import { useSrpGenerator } from './useSrpGenerator'

type RecapType = 'serviceHighlights' | 'weekendTeaching' | 'seriesStartEnd' | 'generalCelebration'

const RECAP_LABELS: Record<RecapType, string> = {
  serviceHighlights:  'Service highlights',
  weekendTeaching:    'Weekend teaching',
  seriesStartEnd:     'Series start / end',
  generalCelebration: 'General celebration',
}

export function PhotoRecapGenerator({ session, onChange }: {
  session: SmsSrpGeneration
  onChange: () => void
}) {
  const [recapType, setRecapType] = useState<RecapType>('generalCelebration')
  const [seriesTitle, setSeriesTitle] = useState('')
  const { busy, error, lastTook, call } = useSrpGenerator()

  return (
    <GeneratorShell
      title="Photo recap"
      description="3-5 carousel caption options recapping the weekend service. Pick the recap angle below."
      value={session.photo_recap_caption ?? ''}
      busy={busy}
      error={error}
      lastTook={lastTook}
      extraControls={
        <div className="space-y-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Recap angle</span>
            <select
              value={recapType}
              onChange={e => setRecapType(e.target.value as RecapType)}
              className="mt-1 w-full rounded-md border border-wm-border bg-wm-bg px-3 py-1.5 text-[13px] focus:outline-none focus:border-wm-accent"
            >
              {(Object.keys(RECAP_LABELS) as RecapType[]).map(k => (
                <option key={k} value={k}>{RECAP_LABELS[k]}</option>
              ))}
            </select>
          </label>
          {recapType === 'seriesStartEnd' && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Series title</span>
              <input
                type="text"
                value={seriesTitle}
                onChange={e => setSeriesTitle(e.target.value)}
                placeholder="e.g. Anchored"
                className="mt-1 w-full rounded-md border border-wm-border bg-wm-bg px-3 py-1.5 text-[13px] focus:outline-none focus:border-wm-accent"
              />
            </label>
          )}
        </div>
      }
      onGenerate={async () => {
        const result = await call('generate-photo-recap', {
          sessionId:  session.session_id,
          transcript: session.transcript ?? '',
          recapType,
          seriesTitle,
          churchName: session.church_name ?? '',
        })
        if (result) onChange()
      }}
      onSave={async next => {
        await updateSession(session.session_id, { photo_recap_caption: next })
        onChange()
      }}
    />
  )
}
