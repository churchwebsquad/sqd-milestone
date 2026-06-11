/**
 * Account Info Panel — collapsible church info card that lives in the
 * SrpWorkflowShell sidebar footer.
 *
 * Mirrors srp-generator-main's AccountInfoPanel but restyled to CMS
 * brand. Shows the church name + member, then a compact key/value
 * list: Speak as / Bible translation / Platforms / Timezone / Plan.
 * All read-only display from the loaded SquadAccount.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, Building2 } from 'lucide-react'
import type { SquadAccount } from '../../types/database'

interface DetailRow {
  label: string
  value: string | null | undefined
}

export function SrpAccountInfoPanel({ account }: { account: SquadAccount | null }) {
  const [open, setOpen] = useState(true)
  if (!account) return null

  const details: DetailRow[] = [
    { label: 'Speaks as',     value: account.speak_to_audience_as_from_discovery },
    { label: 'Bible',         value: account.preferred_bible_translation },
    { label: 'Platforms',     value: account.which_social_media_platforms_do_you_want_us_to_post_to_from_all },
    { label: 'Timezone',      value: account.time_zone },
    { label: 'Plan',          value: account.plan },
    { label: 'Recent series', value: account.recent_series_srp },
  ].filter(r => r.value && r.value.trim().length > 0)

  return (
    <section className="rounded-lg border border-[var(--color-lavender)] bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--color-lavender-tint)]/60 transition-colors"
      >
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)] shrink-0">
          <Building2 size={12} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <p className="text-[12px] font-semibold text-[var(--color-deep-plum)] truncate">
            {account.church_name || '—'}
          </p>
          <p className="text-[10px] font-mono text-[var(--color-purple-gray)] truncate">
            Member {account.member}
          </p>
        </span>
        {open ? <ChevronUp size={12} className="text-[var(--color-purple-gray)]" /> : <ChevronDown size={12} className="text-[var(--color-purple-gray)]" />}
      </button>

      {open && details.length > 0 && (
        <dl className="px-3 pb-3 space-y-1.5 border-t border-[var(--color-lavender)]">
          {details.map(r => (
            <div key={r.label} className="pt-2">
              <dt className="text-[9px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                {r.label}
              </dt>
              <dd className="text-[11px] text-[var(--color-deep-plum)] leading-snug mt-0.5">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
