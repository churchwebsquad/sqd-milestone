// Auto-sync sweeper: pulls every Strategy Brief from the All-In Documents
// Notion database into the matching partner's web_intake_documents row.
//
// Runs unattended via pg_cron — no UI button, no per-project URL paste.
// The contract is: if a row exists in the Documents database with
// Doc Type="Strategy Brief" and a Church relation whose Member # matches
// an active web project, that brief lives on the project's intake.
//
// Freshness-aware: skips projects whose web_intake_documents already
// has a row with notion_page_id matching AND notion_last_edited_at >=
// the Notion page's last_edited_time. Re-runs are cheap when nothing
// has changed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { queryDatabaseAll } from '../notion.ts'
import type { NotionPage } from '../types.ts'
import { DB } from './data-sources.ts'
import { syncIntakeDocFromNotion } from './sync-intake-doc-from-notion.ts'

const DOC_TYPE_PROPERTY = 'Doc Type'
const DOC_TYPE_VALUE    = 'Strategy Brief'
const MEMBER_ROLLUP     = 'Member #'
/** Cap per run to bound total wall-clock + Claude+Notion budget. The
 *  sweeper runs on a cron, so a backlog catches up over a few passes. */
const MAX_SYNCS_PER_RUN = 25

export interface AutoSyncStrategyBriefsResult {
  ok:                       true
  ran_at:                   string
  notion_brief_count:       number
  matched_project_count:    number
  synced_count:             number
  skipped_unchanged_count:  number
  no_member_count:          number
  no_matching_project_count: number
  error_count:              number
  errors:                   Array<{ project_id: string; member: number; error: string }>
}

function readNumberRollup(page: NotionPage, propertyName: string): number | null {
  const props = (page as unknown as { properties?: Record<string, unknown> }).properties ?? {}
  const raw = (props as Record<string, unknown>)[propertyName] as
    | { type?: string; rollup?: { type?: string; number?: number | null; array?: Array<{ type?: string; number?: number | null }> } }
    | undefined
  if (!raw || raw.type !== 'rollup' || !raw.rollup) return null
  if (raw.rollup.type === 'number' && typeof raw.rollup.number === 'number') return raw.rollup.number
  if (raw.rollup.type === 'array'  && Array.isArray(raw.rollup.array)) {
    for (const item of raw.rollup.array) {
      if (item?.type === 'number' && typeof item.number === 'number') return item.number
    }
  }
  return null
}

export async function autoSyncAllStrategyBriefs(): Promise<AutoSyncStrategyBriefsResult> {
  const ranAt = new Date().toISOString()
  const errors: Array<{ project_id: string; member: number; error: string }> = []

  // 1. Pull every Strategy Brief page once. Sort newest-first so when a
  //    partner has multiple briefs we lock the most recent.
  const pages = await queryDatabaseAll(DB.ALL_IN_DOCS, {
    filter: { property: DOC_TYPE_PROPERTY, select: { equals: DOC_TYPE_VALUE } },
    sorts:  [{ timestamp: 'last_edited_time', direction: 'descending' }],
  })

  // 2. Build a member → page map. Skip pages whose Member # rollup is
  //    NULL (Church relation missing) — count them separately so we
  //    can surface a "fix the relation" signal to staff later.
  let noMemberCount = 0
  const byMember = new Map<number, NotionPage>()
  for (const page of pages) {
    const m = readNumberRollup(page, MEMBER_ROLLUP)
    if (m === null) { noMemberCount++; continue }
    if (!byMember.has(m)) byMember.set(m, page) // most recent (sort order above)
  }

  // 3. Match against active web projects.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
  const memberIds = [...byMember.keys()]
  if (memberIds.length === 0) {
    return {
      ok:                       true,
      ran_at:                   ranAt,
      notion_brief_count:       pages.length,
      matched_project_count:    0,
      synced_count:             0,
      skipped_unchanged_count:  0,
      no_member_count:          noMemberCount,
      no_matching_project_count: 0,
      error_count:              0,
      errors:                   [],
    }
  }
  const { data: projectRows } = await sb
    .from('strategy_web_projects')
    .select('id, member')
    .in('member', memberIds)
    .eq('archived', false)
  const projects = (projectRows ?? []) as Array<{ id: string; member: number }>

  // 4. Pull existing intake docs for those projects so we can decide
  //    skip-vs-sync without a per-project round trip later.
  const projectIds = projects.map(p => p.id)
  const { data: intakeRows } = projectIds.length > 0
    ? await sb
        .from('web_intake_documents')
        .select('web_project_id, notion_page_id, notion_last_edited_at')
        .in('web_project_id', projectIds)
        .eq('category', 'strategy_brief')
    : { data: [] }
  const intakeByProject = new Map<string, { notion_page_id: string | null; notion_last_edited_at: string | null }>()
  for (const r of (intakeRows ?? []) as Array<{ web_project_id: string; notion_page_id: string | null; notion_last_edited_at: string | null }>) {
    intakeByProject.set(r.web_project_id, { notion_page_id: r.notion_page_id, notion_last_edited_at: r.notion_last_edited_at })
  }

  // 5. Per project, decide skip-vs-sync. Cap the synced count at
  //    MAX_SYNCS_PER_RUN to bound budget; remaining will catch up
  //    on the next cron pass.
  let syncedCount = 0
  let skippedUnchangedCount = 0
  for (const proj of projects) {
    const page = byMember.get(proj.member)
    if (!page) continue
    const pageId = page.id
    const pageEditedAt = (page as unknown as { last_edited_time?: string }).last_edited_time ?? null
    const existing = intakeByProject.get(proj.id) ?? null

    const upToDate = existing
      && existing.notion_page_id === pageId
      && existing.notion_last_edited_at
      && pageEditedAt
      && new Date(existing.notion_last_edited_at).getTime() >= new Date(pageEditedAt).getTime()
    if (upToDate) { skippedUnchangedCount++; continue }

    if (syncedCount >= MAX_SYNCS_PER_RUN) {
      // Hit the cap — leave the rest for the next pass.
      break
    }

    try {
      const pageUrl = (page as unknown as { url?: string }).url
        ?? `https://www.notion.so/${pageId.replace(/-/g, '')}`
      await syncIntakeDocFromNotion({
        projectId:  proj.id,
        notionUrl:  pageUrl,
        category:   'strategy_brief',
        uploadedBy: null,
      })
      syncedCount++
    } catch (err) {
      errors.push({
        project_id: proj.id,
        member:     proj.member,
        error:      err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 6. How many Strategy Brief rows in Notion had no matching project?
  //    Useful telemetry — if this is high, staff are creating briefs
  //    for partners who haven't been provisioned yet.
  const matchedMembers = new Set(projects.map(p => p.member))
  let noMatchingProjectCount = 0
  for (const m of byMember.keys()) {
    if (!matchedMembers.has(m)) noMatchingProjectCount++
  }

  return {
    ok:                       true,
    ran_at:                   ranAt,
    notion_brief_count:       pages.length,
    matched_project_count:    projects.length,
    synced_count:             syncedCount,
    skipped_unchanged_count:  skippedUnchangedCount,
    no_member_count:          noMemberCount,
    no_matching_project_count: noMatchingProjectCount,
    error_count:              errors.length,
    errors:                   errors.slice(0, 10),
  }
}
