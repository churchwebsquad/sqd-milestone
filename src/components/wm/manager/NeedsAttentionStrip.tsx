/**
 * Horizontal-scroll digest strip at the top of /web.
 *
 * Each card answers "what should I look at right now?" and links to
 * the right surface (project planning tab, Waterfall scrolled to a
 * sprint, etc.). The "Why?" hover surfaces the source signal so
 * users trust the heuristic.
 */
import { AlertTriangle, Clock, Calendar, Layers } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildDigest, type DigestItem, type DigestKind } from '../../../lib/webDigest'
import { ProvenanceBadge } from '../planning/ProvenanceBadge'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'

interface Props {
  rows:        ProjectRowVM[]
  pageCounts?: Map<string, number>
  onOpenProject:  (id: string) => void
  onOpenSprint:   (startISO: string) => void
}

const KIND_TONE: Record<DigestKind, { bg: string; text: string; border: string; Icon: typeof AlertTriangle }> = {
  stalled:           { bg: 'bg-amber-50',    text: 'text-amber-800',    border: 'border-amber-300',    Icon: Clock },
  launch_overdue:    { bg: 'bg-rose-50',     text: 'text-rose-800',     border: 'border-rose-400',     Icon: Calendar },
  launch_infeasible: { bg: 'bg-rose-50',     text: 'text-rose-800',     border: 'border-rose-300',     Icon: AlertTriangle },
  launch_tight:      { bg: 'bg-amber-50',    text: 'text-amber-800',    border: 'border-amber-300',    Icon: AlertTriangle },
  manual_blocked:    { bg: 'bg-rose-50',     text: 'text-rose-800',     border: 'border-rose-300',     Icon: AlertTriangle },
  manual_waiting:    { bg: 'bg-amber-50',    text: 'text-amber-800',    border: 'border-amber-300',    Icon: Clock },
  capacity_over:     { bg: 'bg-rose-50',     text: 'text-rose-800',     border: 'border-rose-400',     Icon: Layers },
}

const DISMISS_STORAGE_KEY = 'wm.digest.dismissals.v1'
const DISMISS_TTL_DAYS = 7

/** Persist dismissals to localStorage as { itemId: expiresAtISO }.
 *  Without this, dismissed cards reappear on page refresh and AMs
 *  re-dismiss them every morning — fast trust loss. */
function loadDismissed(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as Record<string, string>
    const now = Date.now()
    const out: Record<string, string> = {}
    for (const [id, exp] of Object.entries(obj)) {
      const t = Date.parse(exp)
      if (Number.isFinite(t) && t > now) out[id] = exp
    }
    return out
  } catch { return {} }
}
function saveDismissed(map: Record<string, string>) {
  try { localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map)) } catch { /* quota */ }
}

export function NeedsAttentionStrip({ rows, pageCounts, onOpenProject, onOpenSprint }: Props) {
  const [dismissed, setDismissed] = useState<Record<string, string>>(() => loadDismissed())
  const items = useMemo(
    () => buildDigest({ rows, pageCounts, today: new Date() })
      .filter(i => !(i.id in dismissed)),
    [rows, pageCounts, dismissed],
  )

  const dismiss = (id: string) => {
    const expires = new Date()
    expires.setDate(expires.getDate() + DISMISS_TTL_DAYS)
    setDismissed(prev => {
      const next = { ...prev, [id]: expires.toISOString() }
      saveDismissed(next)
      return next
    })
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50/50 px-3 py-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
        <p className="text-[12px] text-emerald-800 font-semibold">All clear — nothing needs attention right now.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">
          Needs attention
        </p>
        <p className="text-[10.5px] text-wm-text-subtle">
          {items.length} item{items.length === 1 ? '' : 's'} · sorted by urgency
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-2 px-2">
        {items.map(item => {
          const tone = KIND_TONE[item.kind]
          const Icon = tone.Icon
          return (
            <div
              key={item.id}
              className={`rounded-md border-2 ${tone.border} ${tone.bg} ${tone.text} p-2.5 min-w-[280px] max-w-[340px] shrink-0 flex flex-col gap-1`}
            >
              <div className="flex items-start gap-1.5">
                <Icon size={13} className="shrink-0 mt-0.5" />
                <p className="text-[12px] font-bold leading-tight flex-1">{item.title}</p>
                <ProvenanceBadge
                  provenance={{
                    mode: 'auto',
                    sourceLabel: item.signalSource,
                    detail: 'Heuristic in webDigest.ts',
                  }}
                />
              </div>
              <p className="text-[11px] opacity-90 leading-snug">{item.reason}</p>
              <div className="flex items-center gap-1.5 mt-1">
                {(item.projectId || item.sprintStartISO) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (item.projectId) onOpenProject(item.projectId)
                      else if (item.sprintStartISO) onOpenSprint(item.sprintStartISO)
                    }}
                    className="text-[11px] font-semibold underline hover:no-underline"
                  >
                    {item.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="ml-auto text-[10.5px] opacity-70 hover:opacity-100 transition-opacity"
                  title="Dismissed for 7 days"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

