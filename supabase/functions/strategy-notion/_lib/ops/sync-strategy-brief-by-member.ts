// Auto-find + sync a partner's Strategy Brief from the All-In Documents DB.
//
// Replaces the per-project paste-the-URL flow with one that queries the
// shared Documents database, filters by `Doc Type = "Strategy Brief"`,
// and matches the page whose `Member #` rollup equals the project's
// member. Then hands off to the existing single-page sync (markdown
// render + storage upload + web_intake_documents upsert).
//
// Why this exists: the staff workflow is "we keep all strategy briefs
// in one Notion database; the AM doesn't paste a URL per partner."
// Auto-find by member is the natural way; pasting a URL was a
// stopgap. The URL-paste path remains as an override for partners
// whose brief lives elsewhere.

import { queryDatabaseAll } from '../notion.ts'
import type { NotionPage } from '../types.ts'
import { DB } from './data-sources.ts'
import { syncIntakeDocFromNotion } from './sync-intake-doc-from-notion.ts'

const DOC_TYPE_PROPERTY = 'Doc Type'
const DOC_TYPE_VALUE    = 'Strategy Brief'
const MEMBER_ROLLUP     = 'Member #'

export interface SyncStrategyBriefByMemberArgs {
  projectId:  string
  member:     number
  /** Defaults to 'strategy_brief'. Future room for the same auto-find
   *  pattern against other Doc Type values (e.g. content_strategy). */
  category?:  'strategy_brief' | 'content_strategy'
  uploadedBy?: string | null
}

export interface SyncStrategyBriefByMemberResult {
  ok:                    boolean
  /** When ok=true, the document_id / storage path of the synced row. */
  document_id?:          string
  notion_page_id?:       string
  notion_page_url?:      string | null
  storage_path?:         string
  notion_synced_at?:     string
  notion_last_edited_at?: string | null
  markdown_bytes?:       number
  /** Matched-page metadata for UI display when the partner has zero
   *  matches and we want to show "we looked but found nothing." */
  match_count?:          number
  error?:                string
}

/** Extract the numeric value of a Notion rollup property whose inner
 *  type is a number (e.g. the `Member #` rollup that pulls a number
 *  from the related Church row). Returns null if shape doesn't match. */
function readNumberRollup(page: NotionPage, propertyName: string): number | null {
  const props = (page as unknown as { properties?: Record<string, unknown> }).properties ?? {}
  const raw = (props as Record<string, unknown>)[propertyName] as
    | { type?: string; rollup?: { type?: string; number?: number | null; array?: Array<{ type?: string; number?: number | null }> } }
    | undefined
  if (!raw || raw.type !== 'rollup' || !raw.rollup) return null
  // Two shapes: single-aggregated number, or array of items.
  if (raw.rollup.type === 'number' && typeof raw.rollup.number === 'number') return raw.rollup.number
  if (raw.rollup.type === 'array'  && Array.isArray(raw.rollup.array)) {
    for (const item of raw.rollup.array) {
      if (item?.type === 'number' && typeof item.number === 'number') return item.number
    }
  }
  return null
}

export async function syncStrategyBriefByMember(
  args: SyncStrategyBriefByMemberArgs,
): Promise<SyncStrategyBriefByMemberResult> {
  const category = args.category ?? 'strategy_brief'

  // 1. Query the Documents DB filtered to the right Doc Type.
  //    Sort newest-first so when a partner has multiple briefs we take
  //    the most recently touched.
  const pages = await queryDatabaseAll(DB.ALL_IN_DOCS, {
    filter: {
      property: DOC_TYPE_PROPERTY,
      select:   { equals: DOC_TYPE_VALUE },
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
  })

  // 2. Client-side filter by Member # rollup. Notion's rollup filtering
  //    is finicky and varies by inner type — easier to walk the
  //    already-filtered set since "Strategy Brief" rows are a small
  //    portion of the database.
  const matched: NotionPage[] = []
  for (const p of pages) {
    const m = readNumberRollup(p, MEMBER_ROLLUP)
    if (m === args.member) matched.push(p)
  }

  if (matched.length === 0) {
    return {
      ok: false,
      match_count: 0,
      error: `No strategy brief found in Notion for member ${args.member}. Confirm there's a row in the All-In Documents database with Doc Type="Strategy Brief" and the Church relation set so the Member # rollup populates.`,
    }
  }

  // 3. Hand off to the existing single-page sync. It handles block
  //    rendering, storage upload, and the web_intake_documents upsert.
  const winner = matched[0] // most-recently edited per the sort above
  const pageUrl = (winner as unknown as { url?: string }).url ?? `https://www.notion.so/${winner.id.replace(/-/g, '')}`

  const syncResult = await syncIntakeDocFromNotion({
    projectId:  args.projectId,
    notionUrl:  pageUrl,
    category,
    uploadedBy: args.uploadedBy ?? null,
  })

  return {
    ok:                    true,
    document_id:           syncResult.document_id,
    notion_page_id:        syncResult.notion_page_id,
    notion_page_url:       pageUrl,
    storage_path:          syncResult.storage_path,
    notion_synced_at:      syncResult.notion_synced_at,
    notion_last_edited_at: syncResult.notion_last_edited_at,
    markdown_bytes:        syncResult.markdown_bytes,
    match_count:           matched.length,
  }
}
