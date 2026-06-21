/**
 * Needs-Attention digest — the top-of-/web summary that answers
 * "what should I look at right now?"
 *
 * Pure function. Takes the same `ProjectRowVM[]` the rest of the
 * planning surface consumes plus a `today`, and returns a list of
 * `DigestItem`s ordered by urgency. Each item carries a `signalSource`
 * so the UI can render a "Why?" hover that explains the heuristic.
 *
 * Composes the four foundation libs:
 *   • buildCurrentActivity → current activity per project
 *   • detectStall           → projects where the signal hasn't moved
 *   • evaluateLaunchFeasibility → projects whose target won't fit
 *   • Capacity overflow     → sprints over the weekly cap
 */
import { buildCurrentActivity, type CurrentActivity } from './webCurrentActivity'
import { detectStall } from './webStallDetector'
import { evaluateLaunchFeasibility, type FeasibilityVerdict } from './webFeasibility'
import { sprintsFrom } from './webPlanningMath'
import { weekStart, toIsoDate, addWeeks, fromIsoDate, daysBetween } from './dateRange'
import { DEFAULT_DEV_CAPACITY } from './webProjectHealth'
import type { ProjectRowVM } from '../hooks/useProjectsWithHealth'

export type DigestKind =
  | 'stalled'
  | 'launch_overdue'
  | 'launch_infeasible'
  | 'launch_tight'
  | 'manual_blocked'
  | 'manual_waiting'
  | 'capacity_over'

export interface DigestItem {
  /** Stable key for React + dismiss tracking. */
  id: string
  kind: DigestKind
  /** Urgency 0-100 — higher = render earlier. */
  urgency: number
  /** Compact title. */
  title: string
  /** Why this item is here — strategist-language. */
  reason: string
  /** Source signal name for the "Why?" hover. */
  signalSource: string
  /** Primary action label + target. */
  actionLabel: string
  /** When kind targets a project: project id. When sprint: ISO. */
  projectId?: string
  sprintStartISO?: string
}

export interface DigestInputs {
  rows: ProjectRowVM[]
  pageCounts?: Map<string, number>
  today?: Date
}

export function buildDigest(i: DigestInputs): DigestItem[] {
  const today = i.today ?? new Date()
  const items: DigestItem[] = []

  // ── Per-project signals ────────────────────────────────────
  for (const r of i.rows) {
    if (r.archived) continue
    if (r.current_phase === 'launched') continue

    const activity = buildCurrentActivity({
      project: r,
      milestones: r.milestones,
      devTasks: r.devTasks ?? [],
      inference: r.inference,
    })

    // Manual override (waiting/blocked) — surface as digest item
    // so the AM is reminded what's pending.
    if (activity.signal === 'manual_override' && activity.manualStatus) {
      const status = activity.manualStatus
      if (status === 'blocked' || status === 'waiting_partner') {
        const days = activity.lastActivityAt
          ? daysBetween(parseAny(activity.lastActivityAt) ?? today, today)
          : null
        const dayPart = days != null ? ` ${days}d ago` : ''
        items.push({
          id: `manual-${r.id}`,
          kind: status === 'blocked' ? 'manual_blocked' : 'manual_waiting',
          urgency: status === 'blocked' ? 80 : 60,
          title: `${r.church_name ?? r.name} — ${status === 'blocked' ? 'Blocked' : 'Waiting on partner'}`,
          reason: activity.manualReason
            ? `${activity.manualReason}${dayPart}`
            : `Manually flagged${dayPart}`,
          signalSource: 'manual_sub_status',
          actionLabel: 'Open project',
          projectId: r.id,
        })
      }
    }

    // Stall detection.
    const stall = detectStall({ project: r, activity, today })
    if (stall.isStalled && stall.daysSinceActivity != null) {
      items.push({
        id: `stall-${r.id}`,
        kind: 'stalled',
        urgency: clamp(40 + stall.daysSinceActivity * 2, 40, 90),
        title: `${r.church_name ?? r.name} — Stalled ${stall.daysSinceActivity}d`,
        reason: stall.oneLiner ?? 'No activity above threshold.',
        signalSource: `${activity.signal} (threshold ${stall.thresholdDays}d)`,
        actionLabel: 'Open project',
        projectId: r.id,
      })
    }

    // Launch feasibility check (only when launch_date set + not launched).
    if (r.launch_date) {
      const pc = i.pageCounts?.get(r.id) ?? null
      // Sum competing hours across all OTHER projects per week.
      const competing = sumCompetingHoursByWeek(i.rows, r.id, today)
      // Sum THIS project's hours per week.
      const thisProj = new Map<string, number>()
      for (const a of r.allocations ?? []) {
        thisProj.set(a.week_starting, (thisProj.get(a.week_starting) ?? 0) + Number(a.hours))
      }
      const feas = evaluateLaunchFeasibility({
        targetISO: r.launch_date.slice(0, 10),
        today,
        pageCount: pc,
        overrideHours: r.dev_hours_estimate ?? null,
        competingHoursByWeek: competing,
        thisProjectHoursByWeek: thisProj,
      })
      const ld = parseAny(r.launch_date)
      const daysToLaunch = ld ? daysBetween(today, ld) : null
      // Overdue and infeasible/tight are mutually exclusive — a
      // launch that's already past doesn't need a "tight" warning on
      // top of the "overdue" card. Same project should never produce
      // multiple launch-related cards in a single render.
      if (daysToLaunch != null && daysToLaunch < 0) {
        items.push({
          id: `overdue-${r.id}`,
          kind: 'launch_overdue',
          urgency: 95,
          title: `${r.church_name ?? r.name} — Launch overdue ${Math.abs(daysToLaunch)}d`,
          reason: feas.oneLiner,
          signalSource: 'launch_date past + not launched',
          actionLabel: 'Open project',
          projectId: r.id,
        })
      } else if (feas.verdict === 'infeasible') {
        items.push({
          id: `infeas-${r.id}`,
          kind: 'launch_infeasible',
          urgency: 75,
          title: `${r.church_name ?? r.name} — Launch infeasible`,
          reason: feas.oneLiner,
          signalSource: 'feasibility check',
          actionLabel: feas.suggestion?.detail ?? 'Open project',
          projectId: r.id,
        })
      } else if (feas.verdict === 'tight') {
        items.push({
          id: `tight-${r.id}`,
          kind: 'launch_tight',
          urgency: 50,
          title: `${r.church_name ?? r.name} — Launch tight`,
          reason: feas.oneLiner,
          signalSource: 'feasibility check',
          actionLabel: 'Open project',
          projectId: r.id,
        })
      }
    }
  }

  // ── Sprint-level: capacity overflow ────────────────────────
  const sprints = sprintsFrom(today, 5)
  const cap = DEFAULT_DEV_CAPACITY * 2
  for (const s of sprints) {
    const sprintStart = fromIsoDate(s.startISO)
    if (!sprintStart) continue
    const w0 = toIsoDate(weekStart(sprintStart))
    const w1 = toIsoDate(weekStart(addWeeks(sprintStart, 1)))
    let total = 0
    const projects = new Set<string>()
    for (const r of i.rows) {
      for (const a of r.allocations ?? []) {
        if (a.week_starting === w0 || a.week_starting === w1) {
          const h = Number(a.hours)
          if (h > 0) {
            total += h
            projects.add(r.id)
          }
        }
      }
    }
    if (total > cap) {
      const over = Math.round((total - cap) * 10) / 10
      items.push({
        id: `over-${s.startISO}`,
        kind: 'capacity_over',
        urgency: 70,
        title: `Sprint ${s.label} — over by ${over}h`,
        reason: `${projects.size} project${projects.size === 1 ? '' : 's'} stacked into this sprint (${total}h vs ${cap}h cap).`,
        signalSource: 'dev_weekly_allocations sum',
        actionLabel: 'Open Waterfall at this sprint',
        sprintStartISO: s.startISO,
      })
    }
  }

  // Sort by urgency desc, then by title for stable ordering.
  items.sort((a, b) => b.urgency - a.urgency || a.title.localeCompare(b.title))
  return items
}

// ── Helpers ───────────────────────────────────────────────────────

function sumCompetingHoursByWeek(
  rows: ProjectRowVM[], excludeId: string, _today: Date,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.id === excludeId) continue
    if (r.archived) continue
    for (const a of r.allocations ?? []) {
      out.set(a.week_starting, (out.get(a.week_starting) ?? 0) + Number(a.hours))
    }
  }
  return out
}

function parseAny(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (m) return fromIsoDate(`${m[1]}-${m[2]}-${m[3]}`)
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// Re-export the activity type so callers don't have to import from two places.
export type { CurrentActivity, FeasibilityVerdict }
