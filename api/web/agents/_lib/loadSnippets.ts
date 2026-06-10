/**
 * Shared snippet loader for agents that send merge-field context to
 * the LLM (page-draft, slot-edit, reorg-section-for-template,
 * answer-content-collection, etc.).
 *
 * Two stores feed the project's resolved tokens:
 *   1. The 16 GLOBAL MERGE FIELDS — columns on strategy_web_projects
 *      (church_name, church_short_name, address, city_state, phone,
 *      email, denomination, pastor_name, all_service_times, and the
 *      6 social URLs). These are the most common references; missing
 *      them is why the copywriter writes "Desert Springs" as a
 *      literal instead of {{church_short_name}}.
 *   2. The web_project_snippets table — partner-defined custom
 *      tokens for project-specific values.
 *
 * Globals come FIRST so the model sees the canonical project values
 * (church_name etc.) before the long tail of custom tokens.
 *
 * Keep in sync with src/lib/webSnippets.ts which defines the same
 * 16 fields client-side.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const GLOBAL_FIELD_COLUMNS = [
  'church_name', 'church_short_name', 'address', 'city_state',
  'phone', 'email', 'denomination', 'pastor_name',
  'all_service_times',
  'social_facebook_url', 'social_instagram_url', 'social_youtube_url',
  'social_tiktok_url', 'social_twitter_url', 'social_linkedin_url',
] as const

export interface SnippetRow {
  token:     string
  expansion: string
}

/** Loads the full snippet inventory for a project — 16 global merge
 *  fields + every web_project_snippets row + a system-derived
 *  current_year. Filters out empty values so the model only sees
 *  tokens it can actually substitute. Failure on either store is
 *  non-fatal — returns what loaded successfully. */
export async function loadSnippetsForAgent(sb: any, projectId: string): Promise<SnippetRow[]> {
  const out: SnippetRow[] = []

  // 1. Global merge fields — columns on strategy_web_projects.
  try {
    const selectCols = ['id', ...GLOBAL_FIELD_COLUMNS].join(', ')
    const { data: proj } = await sb.from('strategy_web_projects')
      .select(selectCols).eq('id', projectId).maybeSingle()
    if (proj) {
      for (const col of GLOBAL_FIELD_COLUMNS) {
        const value = (proj as any)[col]
        if (typeof value === 'string' && value.trim().length > 0) {
          out.push({ token: col, expansion: value.trim() })
        }
      }
    }
  } catch (e: any) {
    console.warn('[loadSnippetsForAgent] global merge fields failed:', e?.message)
  }

  // 2. System-derived current_year.
  out.push({ token: 'current_year', expansion: String(new Date().getFullYear()) })

  // 3. web_project_snippets — partner-defined custom tokens.
  try {
    const { data: customs } = await sb.from('web_project_snippets')
      .select('token, expansion').eq('web_project_id', projectId).eq('archived', false)
    if (Array.isArray(customs)) {
      for (const row of customs) {
        if (typeof row?.token === 'string' && typeof row?.expansion === 'string' && row.expansion.trim()) {
          out.push({ token: row.token, expansion: row.expansion.trim() })
        }
      }
    }
  } catch (e: any) {
    console.warn('[loadSnippetsForAgent] custom snippets failed:', e?.message)
  }

  // De-dupe by token (custom defs override globals if they share a name).
  const byToken = new Map<string, SnippetRow>()
  for (const row of out) byToken.set(row.token, row)
  return [...byToken.values()]
}
