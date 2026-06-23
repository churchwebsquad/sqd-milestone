/**
 * Sandboxed "when can this church launch?" simulator on /web.
 *
 * Inserts a hypothetical SchedulerSite at the chosen priority slot,
 * re-runs computeSchedule against the current queue + adjustments,
 * and reports the synthetic site's projected launch + cascade impact
 * on the real queue.
 *
 * Nothing is written. Pure read of the live queue + a what-if.
 */
import { useMemo, useState } from 'react'
import { Sparkles, ChevronDown, ChevronUp, ArrowDown } from 'lucide-react'
import {
  computeSchedule, calBtw, parseD,
  type SchedulerSite, type SchedulerConfig, type WeekAdjustment,
  type HelpMap, type WeekFlag,
} from '../../lib/launchScheduler'
import type { ProjectLaunchRow } from '../../hooks/useLaunchPlan'

interface Props {
  sites:       SchedulerSite[]
  rows:        ProjectLaunchRow[]
  adjustments: WeekAdjustment[]
  cfg:         SchedulerConfig
}

const SYNTH_ID = '__sim_new_prospect__'

export function NewProspectSimulator({ sites, rows, adjustments, cfg }: Props) {
  const [open, setOpen] = useState(false)
  const [churchName, setChurchName]       = useState('')
  const [plannedHours, setPlannedHours]   = useState(60)
  const [recoveryMode, setRecoveryMode]   = useState<'designer' | 'dev-only'>('dev-only')
  const [desiredPriority, setDesiredPriority] = useState(
    Math.max(0, ...sites.filter(s => s.status === 'in_progress').map(s => s.priority)) + 1,
  )
  const [targetDate, setTargetDate] = useState('')

  const result = useMemo(() => {
    // Rebuild adjustment maps locally (don't import from hook so this
    // stays a pure simulator).
    const monday = parseD(cfg.schedule_start)
    const helpMap: HelpMap = {}
    const designerOut: WeekFlag = {}
    const blackout: WeekFlag = {}
    for (const a of adjustments) {
      const idx = Math.round((parseD(a.week_starting).getTime() - monday.getTime()) / (7 * 86_400_000))
      if (idx < 0) continue
      if (a.help_hours > 0)  helpMap[idx]     = a.help_hours
      if (a.designer_out)    designerOut[idx] = true
      if (a.is_blackout)     blackout[idx]    = true
    }

    // Bump every real site at or above the requested priority down 1.
    const shifted: SchedulerSite[] = sites.map(s =>
      s.priority >= desiredPriority ? { ...s, priority: s.priority + 1 } : s,
    )
    const synth: SchedulerSite = {
      id:                SYNTH_ID,
      priority:          desiredPriority,
      status:            'in_progress',
      planned_dev_hours: plannedHours,
      tracked_hours:     0,
      pct_complete:      null,
      target_launch:     targetDate || null,
      hard_deadline:     null,
      recovery_mode:     recoveryMode,
    }

    const before = computeSchedule(sites,                helpMap, designerOut, blackout, cfg)
    const after  = computeSchedule([...shifted, synth],  helpMap, designerOut, blackout, cfg)

    const synthSlot = after[SYNTH_ID]
    const cascade: Array<{ id: string; name: string; beforeIso: string; afterIso: string; deltaDays: number }> = []
    for (const s of sites) {
      const b = before[s.id]
      const a = after[s.id]
      if (!b?.launchDate || !a?.launchDate) continue
      const beforeIso = b.launchDate.toISOString().slice(0, 10)
      const afterIso  = a.launchDate.toISOString().slice(0, 10)
      if (beforeIso === afterIso) continue
      const row = rows.find(r => r.id === s.id)
      cascade.push({
        id:        s.id,
        name:      row?.church_name ?? row?.name ?? s.id.slice(0, 8),
        beforeIso, afterIso,
        deltaDays: calBtw(b.launchDate, a.launchDate),
      })
    }
    cascade.sort((x, y) => Math.abs(y.deltaDays) - Math.abs(x.deltaDays))

    return {
      synthSlot,
      cascade,
    }
  }, [sites, rows, adjustments, desiredPriority, plannedHours, recoveryMode, targetDate, cfg])

  const targetGap = useMemo(() => {
    if (!targetDate || !result.synthSlot?.launchDate) return null
    return calBtw(result.synthSlot.launchDate, parseD(targetDate))
  }, [targetDate, result.synthSlot])

  return (
    <div className="rounded-2xl border border-lavender bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-lavender-tint/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-primary-purple shrink-0" />
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-deep-plum">Simulate a new launch</p>
            <p className="text-[11px] text-purple-gray">"When could this church launch?" — sandbox, nothing is saved.</p>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-purple-gray" /> : <ChevronDown size={16} className="text-purple-gray" />}
      </button>

      {open && (
        <div className="border-t border-lavender px-4 py-4 bg-cream/40 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Church name (optional)">
              <input type="text" value={churchName} onChange={e => setChurchName(e.target.value)}
                placeholder="e.g. WoodCreek Church"
                className="w-full text-[12px] px-2 py-1.5 rounded-md border border-lavender bg-white focus:border-primary-purple focus:outline-none" />
            </Field>
            <Field label="Dev hours (estimate)">
              <input type="number" min={0} value={plannedHours} onChange={e => setPlannedHours(Number(e.target.value) || 0)}
                className="w-full text-[12px] px-2 py-1.5 rounded-md border border-lavender bg-white font-mono focus:border-primary-purple focus:outline-none" />
            </Field>
            <Field label="Desired priority">
              <input type="number" min={1} value={desiredPriority} onChange={e => setDesiredPriority(Number(e.target.value) || 1)}
                className="w-full text-[12px] px-2 py-1.5 rounded-md border border-lavender bg-white font-mono focus:border-primary-purple focus:outline-none" />
            </Field>
            <Field label="Target launch (optional)">
              <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                className="w-full text-[12px] px-2 py-1.5 rounded-md border border-lavender bg-white focus:border-primary-purple focus:outline-none" />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[12px] text-deep-plum">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="recmode" checked={recoveryMode === 'designer'} onChange={() => setRecoveryMode('designer')} />
              🎨 designer-recoverable
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="recmode" checked={recoveryMode === 'dev-only'} onChange={() => setRecoveryMode('dev-only')} />
              🔒 dev-only
            </label>
          </div>

          {/* Answer */}
          <div className="rounded-xl border border-primary-purple/30 bg-primary-purple/5 p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Stat
              label="Dev hours needed"
              value={`${plannedHours}h`}
              note="From the estimate above."
            />
            <Stat
              label="Earliest dev start"
              value={result.synthSlot?.devCompleteDate
                ? result.synthSlot.devCompleteDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
                : '—'}
              note={`Priority slot #${desiredPriority} given the current queue.`}
            />
            <Stat
              label="Earliest launch"
              value={result.synthSlot?.launchDate
                ? result.synthSlot.launchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
                : '—'}
              note={targetGap == null
                ? 'Set a target above to compare.'
                : targetGap >= 0
                  ? `${targetGap}d cushion vs your target.`
                  : `${Math.abs(targetGap)}d past your target — infeasible without intervention.`}
              tone={targetGap == null ? 'neutral' : targetGap >= 0 ? 'good' : 'bad'}
            />
          </div>

          {/* Cascade */}
          {result.cascade.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-2">Impact on existing queue</p>
              <ul className="space-y-1.5">
                {result.cascade.slice(0, 8).map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-xs text-deep-plum bg-white border border-lavender/60 rounded-md px-3 py-1.5">
                    <span className="font-semibold truncate">{c.name}</span>
                    <span className={c.deltaDays > 0 ? 'text-red-600' : 'text-green-600'}>
                      <ArrowDown size={11} className={`inline mr-1 ${c.deltaDays > 0 ? '' : 'rotate-180'}`} />
                      {c.deltaDays > 0 ? '+' : ''}{c.deltaDays}d
                    </span>
                  </li>
                ))}
                {result.cascade.length > 8 && (
                  <li className="text-[11px] text-purple-gray italic px-3">+{result.cascade.length - 8} more affected</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Stat({
  label, value, note, tone = 'neutral',
}: { label: string; value: string; note: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const valueClass = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : 'text-deep-plum'
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">{label}</p>
      <p className={`text-xl font-semibold ${valueClass} mt-1`}>{value}</p>
      <p className="text-[11px] text-purple-gray mt-0.5 leading-snug">{note}</p>
    </div>
  )
}
