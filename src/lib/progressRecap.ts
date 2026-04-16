import { supabase } from './supabase'
import type { ClickUpCommentSegment } from './clickupComment'
import { DEFAULT_APP_CONFIG } from './appConfig'
import type { AppConfig } from '../types/database'

type RecapConfig = Pick<
  AppConfig,
  | 'recap_header'
  | 'recap_brand_current_label'
  | 'recap_brand_next_label'
  | 'recap_web_current_label'
  | 'recap_web_next_label'
  | 'recap_portal_label'
>

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SquadProgress {
  currentStepName: string | null  // null → display "Not started"
  nextStepName: string | null     // null → display "—"
}

export interface ProgressRecap {
  brand: SquadProgress
  web: SquadProgress
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

/**
 * Builds the cross-squad progress recap for a member.
 *
 * For `activeSquad`: uses the current submission's milestone IDs directly
 * (the form already knows what was just submitted).
 *
 * For every other squad in ['brand', 'web']: queries the most recent
 * *sent* submission where the current_milestone belongs to that squad.
 *
 * Returns two parallel async queries (submissions list + milestone defs)
 * to minimise round-trips.
 */
export async function fetchProgressRecap(
  memberId: number,
  activeSquad: string,
  activeCurrentMilestoneId: string | null,
  activeNextMilestoneId: string | null,
): Promise<ProgressRecap> {
  // ── Q1: Recent sent submissions for this member ────────────────────────────
  const { data: subs } = await supabase
    .from('strategy_milestone_submissions')
    .select('current_milestone_id, next_milestone_id')
    .eq('member', memberId)
    .eq('status', 'sent')
    .order('submitted_at', { ascending: false })
    .limit(30)

  // ── Collect all milestone IDs we need ──────────────────────────────────────
  const activeIds = [activeCurrentMilestoneId, activeNextMilestoneId]
    .filter((x): x is string => Boolean(x))

  const subIds = (subs ?? []).flatMap(s =>
    [s.current_milestone_id, s.next_milestone_id].filter((x): x is string => Boolean(x))
  )

  const allIds = [...new Set([...activeIds, ...subIds])]

  // ── Q2: Fetch milestone definitions for those IDs ─────────────────────────
  const defMap = new Map<string, { squad: string; step_name: string }>()

  if (allIds.length > 0) {
    const { data: defs } = await supabase
      .from('strategy_milestone_definitions')
      .select('id, squad, step_name')
      .in('id', allIds)

    for (const d of defs ?? []) {
      defMap.set(d.id as string, { squad: d.squad as string, step_name: d.step_name as string })
    }
  }

  // ── Build result ──────────────────────────────────────────────────────────
  const result: ProgressRecap = {
    brand: { currentStepName: null, nextStepName: null },
    web:   { currentStepName: null, nextStepName: null },
  }

  const squads = ['brand', 'web'] as const

  for (const squad of squads) {
    if (squad === activeSquad) {
      // Use the current submission's IDs for the active squad
      result[squad] = {
        currentStepName: activeCurrentMilestoneId
          ? (defMap.get(activeCurrentMilestoneId)?.step_name ?? null)
          : null,
        nextStepName: activeNextMilestoneId
          ? (defMap.get(activeNextMilestoneId)?.step_name ?? null)
          : null,
      }
    } else {
      // Find the most recent submission where the current milestone belongs to this squad
      const sub = (subs ?? []).find(s => {
        if (!s.current_milestone_id) return false
        return defMap.get(s.current_milestone_id)?.squad === squad
      })

      result[squad] = {
        currentStepName: sub?.current_milestone_id
          ? (defMap.get(sub.current_milestone_id)?.step_name ?? null)
          : null,
        nextStepName: sub?.next_milestone_id
          ? (defMap.get(sub.next_milestone_id)?.step_name ?? null)
          : null,
      }
    }
  }

  return result
}

// ── Segment builder (ClickUp rich text) ──────────────────────────────────────

/**
 * Builds the recap as a typed ClickUp comment segment array.
 * The section starts/ends with `---` dividers so it's visually distinct.
 * "All In Updates Recap:" is bold. The portal link is a real hyperlink.
 */
export function buildRecapSegments(
  recap: ProgressRecap,
  portalUrl: string,
  config?: RecapConfig,
): ClickUpCommentSegment[] {
  const c = config ?? DEFAULT_APP_CONFIG
  return [
    { text: '\n\n---\n' },
    { text: `${c.recap_header}\n`, attributes: { bold: true } },
    { text: `${c.recap_brand_current_label} ${recap.brand.currentStepName ?? 'Not started'}\n` },
    { text: `${c.recap_brand_next_label} ${recap.brand.nextStepName ?? '—'}\n` },
    { text: `${c.recap_web_current_label} ${recap.web.currentStepName ?? 'Not started'}\n` },
    { text: `${c.recap_web_next_label} ${recap.web.nextStepName ?? '—'}\n` },
    { text: `\n${c.recap_portal_label} ` },
    { text: 'View Milestone History', attributes: { link: portalUrl } },
    { text: '\n---\n\n' },
  ]
}

// ── Plain-text preview (for Step 7 review card) ───────────────────────────────

/**
 * Returns the recap as a plain text string for the Step 7 preview display.
 * Uses `**` markers so the preview visually mirrors the bold intent.
 */
export function buildRecapText(recap: ProgressRecap, portalUrl: string, config?: RecapConfig): string {
  const c = config ?? DEFAULT_APP_CONFIG
  return [
    '---',
    `**${c.recap_header}**`,
    `${c.recap_brand_current_label} ${recap.brand.currentStepName ?? 'Not started'}`,
    `${c.recap_brand_next_label} ${recap.brand.nextStepName ?? '—'}`,
    `${c.recap_web_current_label} ${recap.web.currentStepName ?? 'Not started'}`,
    `${c.recap_web_next_label} ${recap.web.nextStepName ?? '—'}`,
    '',
    `${c.recap_portal_label} ${portalUrl}`,
    '---',
  ].join('\n')
}
