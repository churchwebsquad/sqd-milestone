/**
 * Featured CTA card linking to the dedicated Discovery Brief page.
 *
 * Sits at the top of the per-church surfaces (ChurchDetailPage,
 * AccountLogPage) so the brief is the first thing staff see when
 * loading a partner — every other surface (assets, brand voice,
 * milestones) is downstream of these answers, so it deserves the
 * top-of-page slot.
 *
 * Visual lineage: deep-plum→purple gradient banner + cream chrome,
 * matches the dark hero gradient used by the login page and portal
 * header per the brand spec.
 */

import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ArrowRight, ClipboardList, Calendar } from 'lucide-react'
import { getLatestQuestionnaireForMember } from '../../lib/discoveryQuestionnaire'
import type { StrategyDiscoveryQuestionnaire } from '../../types/database'

interface Props {
  member: number
}

export default function DiscoveryBriefCard({ member }: Props) {
  const [loading, setLoading] = useState(true)
  const [row, setRow] = useState<StrategyDiscoveryQuestionnaire | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getLatestQuestionnaireForMember(member)
      .then(r => { if (!cancelled) setRow(r) })
      .catch(() => { if (!cancelled) setRow(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [member])

  return (
    <RouterLink
      to={`/churches/${member}/discovery-brief`}
      className="group block rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
      style={{ background: 'linear-gradient(135deg, #341756 0%, #513DE5 100%)' }}
    >
      <div className="px-6 py-5 flex items-center gap-5">
        <div className="shrink-0 h-12 w-12 rounded-full bg-white/15 inline-flex items-center justify-center border border-white/20">
          <ClipboardList size={22} className="text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
            Discovery Brief
          </p>
          <h2 className="text-base sm:text-lg font-semibold text-white leading-tight">
            {loading
              ? 'Loading…'
              : row
                ? 'Partner-supplied vision, voice & visual signals'
                : 'No discovery questionnaire on file'}
          </h2>
          {!loading && row && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/75">
              <span className="inline-flex items-center gap-1">
                <Calendar size={11} className="opacity-80" />
                Submitted {formatDate(row.submitted_at)}
              </span>
              {row.cohort && <span>· {row.cohort}</span>}
              {row.primary_contact_name && <span>· {row.primary_contact_name}</span>}
            </div>
          )}
        </div>

        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white text-deep-plum text-xs font-bold px-4 py-2 group-hover:bg-lavender-tint transition-colors">
          {row ? 'View brief' : 'Open'}
          <ArrowRight size={12} />
        </div>
      </div>
    </RouterLink>
  )
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
