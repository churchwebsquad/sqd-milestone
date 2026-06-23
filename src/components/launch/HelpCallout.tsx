/**
 * Recovery summary callout — appears below the queue table when at
 * least one site is behind target. Splits sites into:
 *   - Recoverable with help (total designer hrs/days)
 *   - Can't be recovered with help (with the reason per site:
 *     dev-only, designer out, or insufficient capacity)
 */
import type { RecoveryResult } from '../../lib/launchRecoverySolver'
import type { ProjectLaunchRow } from '../../hooks/useLaunchPlan'

interface Props {
  rows:     ProjectLaunchRow[]
  recovery: Record<string, RecoveryResult>
}

export function HelpCallout({ rows, recovery }: Props) {
  const recoverable: Array<{ row: ProjectLaunchRow; rec: RecoveryResult }> = []
  const locked:      Array<{ row: ProjectLaunchRow; rec: RecoveryResult }> = []
  const insufficient:Array<{ row: ProjectLaunchRow; rec: RecoveryResult }> = []
  for (const r of rows) {
    const rec = recovery[r.id]
    if (!rec || rec.state === 'on_time') continue
    if (rec.state === 'recoverable')      recoverable.push({ row: r, rec })
    else if (rec.state === 'locked')      locked.push({ row: r, rec })
    else                                  insufficient.push({ row: r, rec })
  }
  if (recoverable.length + locked.length + insufficient.length === 0) return null

  const totalRecHelp = recoverable.reduce((s, x) => s + (x.rec.helpHours ?? 0), 0)

  return (
    <div className="rounded-2xl border border-lavender bg-white px-4 py-4 mt-4">
      <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-1">Recovery summary</p>
      <p className="text-sm text-purple-gray mb-3">
        {recoverable.length + locked.length + insufficient.length} site{recoverable.length + locked.length + insufficient.length === 1 ? '' : 's'} behind target.
      </p>

      {recoverable.length > 0 && (
        <div className="mb-3">
          <p className="text-[12px] font-semibold text-emerald-800">
            Recoverable with help · {totalRecHelp} hrs total (≈{(totalRecHelp / 7).toFixed(1)} designer-days)
          </p>
          <ul className="mt-1 space-y-0.5">
            {recoverable.map(({ row, rec }) => (
              <li key={row.id} className="text-[11.5px] text-deep-plum">
                <strong>{row.church_name ?? row.name}</strong>
                {' — '}
                <span className="text-red-700">{rec.behind}d behind</span>
                {' → recover with '}
                <strong>{rec.helpHours}h</strong>
                {' help, launches '}
                <strong>{rec.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(locked.length + insufficient.length) > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-purple-gray">
            Can't be recovered with help · {locked.length + insufficient.length} site{locked.length + insufficient.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-1 space-y-0.5">
            {locked.map(({ row, rec }) => (
              <li key={row.id} className="text-[11.5px] text-deep-plum">
                <strong>{row.church_name ?? row.name}</strong>
                {' — '}
                <span className="text-red-700">{rec.behind}d behind</span>
                {', '}
                <span className="text-purple-gray italic">
                  {rec.reason === 'dev-only'
                    ? 'work is developer-only — date stands'
                    : 'designer unavailable in the eligible weeks — date stands'}
                </span>
              </li>
            ))}
            {insufficient.map(({ row, rec }) => (
              <li key={row.id} className="text-[11.5px] text-deep-plum">
                <strong>{row.church_name ?? row.name}</strong>
                {' — '}
                <span className="text-red-700">{rec.behind}d behind</span>
                {', '}
                <span className="text-purple-gray italic">
                  max help still {rec.stillLate}d late
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
