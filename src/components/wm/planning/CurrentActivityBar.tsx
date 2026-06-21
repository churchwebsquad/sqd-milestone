/**
 * Single-line current-activity bar for the per-project Planning tab.
 *
 * Replaces the old phase ribbon (which was visually nice but hid
 * step-level detail). Reads `CurrentActivity` from the signal
 * consolidator and renders ONE legible line that names:
 *   • the active phase (color-coded)
 *   • the active step (cowork / copy engine / milestone / clickup)
 *   • per-step progress when known
 *   • days-since-last-activity + stall warning
 *   • a primary action (open the underlying surface, mark complete,
 *     pause, etc.) sized to the situation
 *
 * Provenance: an "auto" badge with a hover tooltip explains which
 * signal source informed the bar's text, so the user trusts the
 * displayed step is current.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Pause, CheckCircle2, AlertTriangle, ExternalLink, Info } from 'lucide-react'
import { WMStatusPill } from '../StatusPill'
import { ProvenanceBadge } from './ProvenanceBadge'
import type { CurrentActivity } from '../../../lib/webCurrentActivity'
import type { StallSignal } from '../../../lib/webStallDetector'
import type { WebProjectPhase, ManualSubStatus } from '../../../types/database'

interface Props {
  activity:    CurrentActivity
  stall:       StallSignal
  /** ClickUp deep-link target (null when no folder/list mapping). */
  clickUpUrl:  string | null
  /** When the active step has its own UI tab (cowork / copy engine
   *  / partner reviews), this opens it. null hides the button. */
  openStepHref: string | null
  /** Called when the user clicks "Resume" on a paused project. */
  onResume?: () => Promise<void> | void
  /** Called when the user clicks "Dismiss stall" — clears the stall
   *  warning for a sane TTL (configurable upstream). */
  onDismissStall?: () => Promise<void> | void
  /** Called when the user clicks "Open status panel" to flip to the
   *  manual-status editor. */
  onOpenStatusPanel?: () => void
}

const PHASE_TONE: Record<WebProjectPhase, string> = {
  intake:   'bg-wm-bg-elevated text-wm-text-muted',
  content:  'bg-wm-accent/15 text-wm-accent-strong',
  design:   'bg-wm-accent/25 text-wm-accent-strong',
  dev:      'bg-amber-100 text-amber-800',
  review:   'bg-purple-100 text-purple-800',
  launched: 'bg-emerald-100 text-emerald-800',
}
const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake: 'Intake', content: 'Content', design: 'Design',
  dev: 'Dev', review: 'Final review', launched: 'Launched',
}
const MANUAL_LABEL: Record<ManualSubStatus, string> = {
  in_progress:     'In progress',
  waiting_partner: 'Waiting on partner',
  blocked:         'Blocked',
  paused:          'Paused',
}

export function CurrentActivityBar({
  activity, stall, clickUpUrl, openStepHref,
  onResume, onDismissStall, onOpenStatusPanel,
}: Props) {
  const [busy, setBusy] = useState<'resume' | 'dismiss' | null>(null)

  const phase = activity.phase
  const phaseTone = PHASE_TONE[phase] ?? PHASE_TONE.intake
  const phaseLabel = PHASE_LABEL[phase] ?? phase

  // Provenance description for the auto-badge tooltip.
  const provenance = describeProvenance(activity)

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Phase pill — visual anchor for which phase the project is in */}
        <span className={`text-[10.5px] uppercase tracking-widest font-bold px-2 py-1 rounded ${phaseTone}`}>
          {phaseLabel}
        </span>

        {/* Step descriptor — the actual "where are we" line */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-wm-text truncate">
            {activity.oneLiner}
          </p>
          <ProvenanceBadge provenance={provenance} />
        </div>

        {/* Stall / manual-override surface */}
        {activity.signal === 'manual_override' && activity.manualStatus && (
          <WMStatusPill
            tone={
              activity.manualStatus === 'blocked' ? 'danger'
            : activity.manualStatus === 'waiting_partner' ? 'warning'
            : 'neutral'
            }
            size="sm"
          >
            {MANUAL_LABEL[activity.manualStatus]}
          </WMStatusPill>
        )}
        {stall.isStalled && activity.signal !== 'manual_override' && (
          <WMStatusPill tone="warning" size="sm">
            <AlertTriangle size={9} className="inline mr-1" />
            Stalled {stall.daysSinceActivity}d
          </WMStatusPill>
        )}
      </div>

      {/* Per-step progress bar when both done + total are known */}
      {activity.progressDone != null && activity.progressTotal != null && activity.progressTotal > 0 && (
        <div className="space-y-1">
          <div className="w-full h-1.5 bg-wm-border rounded-full overflow-hidden">
            <div
              className="h-full bg-wm-accent"
              style={{ width: `${Math.min(100, (activity.progressDone / activity.progressTotal) * 100)}%` }}
            />
          </div>
          <p className="text-[10.5px] font-mono text-wm-text-muted">
            {activity.progressDone}/{activity.progressTotal} ·
            {' '}{Math.round((activity.progressDone / activity.progressTotal) * 100)}%
          </p>
        </div>
      )}

      {/* Last-activity timestamp */}
      {activity.lastActivityAt && (
        <p className="text-[10.5px] text-wm-text-subtle">
          Last activity: {fmtRelative(activity.lastActivityAt)}
        </p>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {openStepHref && (
          // Internal routes use react-router's Link so the SPA
          // doesn't full-reload; external URLs (ClickUp) fall through
          // to a plain anchor with target=_blank below.
          openStepHref.startsWith('/') ? (
            <Link
              to={openStepHref}
              className="inline-flex items-center gap-1 rounded-full bg-wm-accent text-white px-3 py-1 text-[11.5px] font-semibold hover:bg-wm-accent-strong transition-colors"
            >
              Open step
              <ExternalLink size={11} />
            </Link>
          ) : (
            <a
              href={openStepHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-wm-accent text-white px-3 py-1 text-[11.5px] font-semibold hover:bg-wm-accent-strong transition-colors"
            >
              Open step
              <ExternalLink size={11} />
            </a>
          )
        )}
        {onOpenStatusPanel && activity.signal !== 'manual_override' && (
          <button
            type="button"
            onClick={onOpenStatusPanel}
            className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg-elevated px-3 py-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-accent transition-colors"
          >
            <Pause size={11} />
            Set status
          </button>
        )}
        {activity.signal === 'manual_override' && onResume && (
          <button
            type="button"
            disabled={busy === 'resume'}
            onClick={async () => { setBusy('resume'); try { await onResume() } finally { setBusy(null) } }}
            className="inline-flex items-center gap-1 rounded-full border border-wm-success/40 bg-wm-success-bg px-3 py-1 text-[11.5px] font-semibold text-wm-success hover:bg-wm-success/15 transition-colors disabled:opacity-50"
          >
            {busy === 'resume' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            Resume
          </button>
        )}
        {stall.isStalled && onDismissStall && (
          <button
            type="button"
            disabled={busy === 'dismiss'}
            onClick={async () => { setBusy('dismiss'); try { await onDismissStall() } finally { setBusy(null) } }}
            className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg-elevated px-3 py-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-accent transition-colors disabled:opacity-50"
          >
            {busy === 'dismiss' ? <Loader2 size={11} className="animate-spin" /> : <Info size={11} />}
            Dismiss stall (7d)
          </button>
        )}
        {clickUpUrl && (
          <a
            href={clickUpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg-elevated px-3 py-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-accent transition-colors ml-auto"
          >
            ClickUp
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function describeProvenance(a: CurrentActivity): { mode: 'auto' | 'manual'; sourceLabel: string; detail: string } {
  switch (a.signal) {
    case 'manual_override':
      return { mode: 'manual', sourceLabel: 'Manual', detail: 'Set by AM (overrides computed signal).' }
    case 'copy_engine':
      return { mode: 'auto', sourceLabel: 'Copy engine', detail: 'Autonomous engine state (roadmap_state.engine_state).' }
    case 'cowork_step':
      return { mode: 'auto', sourceLabel: 'Cowork pipeline', detail: 'Latest cowork step output (roadmap_state.<step_key>._meta.generated_at).' }
    case 'clickup_tasks':
      return { mode: 'auto', sourceLabel: 'ClickUp tasks', detail: 'Inferred from task_details / view_latest_due_dates.' }
    case 'milestone':
      return { mode: 'auto', sourceLabel: 'Milestone submission', detail: 'strategy_milestone_submissions latest entry.' }
    case 'launched':
      return { mode: 'auto', sourceLabel: 'Phase: launched', detail: 'web_projects.current_phase === launched.' }
    case 'intake':
      return { mode: 'auto', sourceLabel: 'Phase: intake', detail: 'No work started.' }
    case 'phase_only':
    default:
      return { mode: 'auto', sourceLabel: 'Phase only', detail: 'No fine-grained signal found.' }
  }
}

function fmtRelative(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const now = Date.now()
  const days = Math.round((now - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  if (days < 60) return `${Math.round(days / 7)}w ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
