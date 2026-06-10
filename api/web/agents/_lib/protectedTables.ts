/**
 * PROTECTED TABLES — Content Collection workflow data.
 *
 * Any agent that touches these tables risks destroying partner-
 * submitted data with no recovery path. Read-only access is fine;
 * INSERT / UPDATE / DELETE / DDL on these tables is NOT permitted
 * by any agent in this pipeline.
 *
 * The Copy Engine cascade reads FROM these tables (intake docs,
 * crawl topics, content collection sessions/marks, partner uploads)
 * and writes its own outputs to:
 *   • content_atoms + church_facts (normalize-intake-owned working
 *     tables — safe to truncate + re-insert)
 *   • strategy_web_projects.roadmap_state JSONB (every stage's
 *     output lands as a nested key here)
 *   • web_pages + web_sections (only at commit)
 *
 * If you find yourself wanting to write to one of these protected
 * tables to "fix" something, you're solving the wrong problem.
 * Add a column to strategy_web_projects or store under
 * roadmap_state instead.
 */

export const PROTECTED_TABLES = [
  // Page 2 Content Collection form answers (events / sermons / groups
  // display preferences, blog handling, ministries to grow, domain +
  // hosting, etc.). Partners write directly.
  'strategy_content_collection_sessions',

  // Page 1 inventory review — partner marks each crawled topic /
  // program as Approved / Outdated / Approved-keep-as-is. Includes
  // `do_not_rewrite` flag (drives copywriter treatment) and
  // proposed_program_name / description for partner-added items.
  // Partners write directly.
  'strategy_content_collection_marks',

  // Partner-uploaded supplemental files (missing program docs,
  // copy_doc, staff_csv, volunteer_csv, groups_csv, etc.). Tied
  // to a session id. Partners upload directly.
  'strategy_content_collection_attachments',

  // Crawl-source-of-truth — Firecrawl-categorized topic buckets with
  // verbatim passages, source URLs, items. The partner's CURRENT
  // live website inventory. Written by the crawl edge function.
  'web_project_topics',

  // Crawl fire signal — idempotency lock; written by triggers when
  // an audit / redesign / microsite is requested. Don't touch from
  // copy-engine agents.
  'web_crawl_intent',

  // Uploaded intake documents — strategy brief, brand handoff,
  // discovery questionnaire supplemental, content collection files,
  // AM handoff supplemental. Storage URLs. Partners + AM write.
  'web_intake_documents',
] as const

export type ProtectedTable = typeof PROTECTED_TABLES[number]

/** Defensive guard for any new agent that does DB writes. Throw if
 *  the caller is about to operate on a protected table. Use the
 *  table name (table-name-as-string), not a Supabase query builder
 *  ref — the goal is human-readable assertion at the call site. */
export function assertNotProtected(tableName: string, op: 'insert' | 'update' | 'delete' | 'truncate'): void {
  if ((PROTECTED_TABLES as readonly string[]).includes(tableName)) {
    throw new Error(
      `Protected table guard: refused ${op.toUpperCase()} on "${tableName}". ` +
      `This is Content Collection partner data. Store new outputs on ` +
      `strategy_web_projects.roadmap_state or extend an existing non-protected table instead.`,
    )
  }
}
