/**
 * Four-stat headline strip for /web — ported from the prototype.
 *
 * - Active sites          (and N launched)
 * - Dev hrs queued        (and weeks at the locked 35/wk)
 * - Extra help scheduled  (and ≈ designer-days)
 * - Behind target         (and N recoverable w/ help)
 */
import type { SchedulerSite, SchedulerConfig, SiteSchedule } from '../../lib/launchScheduler'
import type { WeekAdjustment } from '../../lib/launchScheduler'
import type { RecoveryResult } from '../../lib/launchRecoverySolver'

interface Props {
  sites:        SchedulerSite[]
  schedule:     Record<string, SiteSchedule>
  adjustments:  WeekAdjustment[]
  recovery:     Record<string, RecoveryResult>
  cfg:          SchedulerConfig
  launchedCount: number
}

export function StatCards({
  sites, schedule, adjustments, recovery, cfg, launchedCount,
}: Props) {
  const active   = sites.filter(s => s.status === 'in_progress')
  const totalHrs = active.reduce((sum, s) => sum + (s.planned_dev_hours || 0), 0)
  const behind   = active
    .map(s => ({ id: s.id, slot: schedule[s.id] }))
    .filter(x => x.slot?.delta != null && x.slot.delta < 0)
  const recov    = behind.filter(b => recovery[b.id]?.state === 'recoverable').length
  const totalHelp = adjustments.reduce((sum, a) => sum + (a.help_hours || 0), 0)
  const waiting  = sites.filter(s => s.status === 'waiting_feedback').length

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <Card
        label="Active sites"
        value={String(active.length)}
        note={`${launchedCount} launched${waiting > 0 ? ` · ${waiting} in review` : ''}`}
      />
      <Card
        label="Dev hrs queued"
        value={String(totalHrs)}
        note={`${(totalHrs / cfg.base_weekly_cap).toFixed(1)} wks at hard ${cfg.base_weekly_cap}/wk`}
      />
      <Card
        label="Extra help scheduled"
        value={`${totalHelp}h`}
        note={totalHelp > 0 ? `≈ ${(totalHelp / 7).toFixed(1)} designer-days` : 'none added'}
      />
      <Card
        label="Behind target"
        value={String(behind.length)}
        note={behind.length > 0 ? `${recov} recoverable w/ help` : 'all on track'}
        tone={behind.length > 0 ? 'danger' : 'default'}
      />
    </div>
  )
}

function Card({
  label, value, note, tone = 'default',
}: { label: string; value: string; note: string; tone?: 'default' | 'danger' }) {
  const border = tone === 'danger' ? 'border-red-200' : 'border-lavender'
  const bg     = tone === 'danger' ? 'bg-red-50/40'   : 'bg-white'
  const v      = tone === 'danger' ? 'text-red-700'   : 'text-deep-plum'
  return (
    <div className={`rounded-2xl border ${border} ${bg} px-4 py-3`}>
      <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">{label}</p>
      <p className={`text-2xl font-semibold ${v} mt-1`}>{value}</p>
      <p className="text-[11px] text-purple-gray mt-0.5">{note}</p>
    </div>
  )
}
