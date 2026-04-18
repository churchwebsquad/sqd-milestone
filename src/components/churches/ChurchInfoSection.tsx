import type { StrategyAccountProgress, Account } from '../../types/database'
import { extractPlan } from '../../types/churches'
import EditableField from './EditableField'

const STATUS_COLORS: Record<string, string> = {
  Trial: 'bg-primary-purple/10 text-primary-purple border-primary-purple/20',
  Active: 'bg-green-100 text-green-700 border-green-200',
  'Non-Renewing': 'bg-amber-100 text-amber-700 border-amber-200',
  Paused: 'bg-purple-gray/10 text-purple-gray border-purple-gray/20',
  Cancelled: 'bg-red-100 text-red-700 border-red-200',
}

interface Props {
  church: StrategyAccountProgress
  account: Account | null
  onSave: (field: string, value: unknown) => Promise<void>
  editing?: boolean
}

export default function ChurchInfoSection({ church, account, onSave, editing }: Props) {
  const raw = church as Record<string, unknown>
  const fullName = [raw.first_name_of_primary, raw.last_name_of_primary].filter(Boolean).join(' ') || null
  const plan = extractPlan(account?.acc_airtable_data ?? null)
  const statusCls = STATUS_COLORS[account?.status ?? ''] ?? 'bg-lavender/40 text-purple-gray border-lavender'

  return (
    <section id="church-information" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider mb-4">Church Information</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <EditableField label="Church Name" value={church.church_name} locked onSave={() => Promise.resolve()} />
        <EditableField label="Member Number" value={String(church.member)} locked onSave={() => Promise.resolve()} />
        <EditableField label="Website" value={raw.church_website as string | null ?? church.website} type="url" onSave={v => onSave('church_website', v)} forceEdit={editing} />
        <EditableField label="Primary Contact Name" value={fullName} onSave={v => onSave('first_name_of_primary', v)} forceEdit={editing} />
        <EditableField label="Primary Contact Email" value={raw.primary_contact_email as string | null} type="email" onSave={v => onSave('primary_contact_email', v)} forceEdit={editing} />
        <EditableField label="Cohort" value={church.cohort} onSave={v => onSave('cohort', v)} forceEdit={editing} />
        <EditableField label="Plan" value={plan} locked onSave={() => Promise.resolve()} />
        <EditableField label="Account Manager" value={church.css_rep} onSave={v => onSave('css_rep', v)} forceEdit={editing} />
        <EditableField label="Time Zone" value={raw.time_zone as string | null} onSave={v => onSave('time_zone', v)} forceEdit={editing} />
      </div>

      {account?.status && (
        <div className="mt-3 pt-3 border-t border-lavender/50">
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-1">Account Status</p>
          <span className={`inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-0.5 border ${statusCls}`}>
            {account.status}
          </span>
        </div>
      )}
    </section>
  )
}
