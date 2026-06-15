/**
 * Cowork prompt context — Supabase preamble + token substitution.
 *
 * Every cowork session prompt (the per-step starter_prompts in
 * stepCatalog.ts and the per-artifact editPrompt in the View Details
 * drawer) needs to tell the Claude Desktop session WHERE the data
 * lives. The {{project_id}} token names the row in
 * strategy_web_projects; this preamble names the surrounding context
 * — Supabase project ref, the main table, the JSONB column, the
 * inventory tables — so the model can fire the right MCP calls
 * without guessing.
 *
 * Both tokens (`{{project_id}}` + `{{supabase_project}}`) are
 * substituted at copy-time via expandCoworkTokens().
 */

/** Derive the Supabase project ref from VITE_SUPABASE_URL.
 *  e.g. 'https://wttgwoxlezqoyzmesekt.supabase.co' → 'wttgwoxlezqoyzmesekt'.
 *  Returns '<your-supabase-project-ref>' when the env var isn't readable
 *  (e.g. server-side render) so the prompt is still useful to a human. */
export function getSupabaseProjectRef(): string {
  const url = import.meta.env?.VITE_SUPABASE_URL
  if (typeof url !== 'string') return '<your-supabase-project-ref>'
  const m = url.match(/^https?:\/\/([^.]+)\.supabase\.co/i)
  return m?.[1] ?? '<your-supabase-project-ref>'
}

/** Preamble injected at the top of every cowork prompt. Names the
 *  Supabase project + the canonical tables/columns the SKILLs read
 *  from + the RPC the SKILLs write through. Uses {{project_id}}
 *  + {{supabase_project}} tokens so the same string survives copy-
 *  paste into Claude Desktop with both substituted. */
export const SUPABASE_CONTEXT_PREAMBLE =
`## Supabase context (use the Supabase MCP)

- **Supabase project**: \`{{supabase_project}}\`
- **Project row**: \`strategy_web_projects\` where \`id = '{{project_id}}'\`
- **Roadmap state** (where every step's output lives): \`strategy_web_projects.roadmap_state\` JSONB. Read with \`->\`/\`->>\`; write atomically via the \`roadmap_state_set(p_project_id, p_path, p_value)\` RPC.
- **Inventory tables** (filter by \`web_project_id = '{{project_id}}'\`):
  - \`content_atoms\` — strategist-reviewed pillar messages (status = 'approved' | 'draft' | 'archived')
  - \`church_facts\` — structured-data sources (staff, service times, etc.)
  - \`web_project_topics\` — crawled site content, keyed by \`topic_key\`
- **Strategic goals snapshot**: \`strategy_web_projects.roadmap_state.strategic_goals\` (the curated AI-facing block; filter to \`status='approved'\` for pipeline consumption).
`

/** Replace cowork prompt tokens at copy-time. Currently:
 *    {{project_id}}        → the web project's UUID
 *    {{supabase_project}}  → the Supabase project ref (from env)
 *  Plus prepends SUPABASE_CONTEXT_PREAMBLE when the input doesn't
 *  already include it (idempotent — safe to call on inputs that
 *  hand-embed the preamble themselves). */
export function expandCoworkTokens(template: string, projectId: string): string {
  const supabaseRef = getSupabaseProjectRef()
  const withPreamble = template.includes('Supabase context')
    ? template
    : `${SUPABASE_CONTEXT_PREAMBLE}\n${template}`
  return withPreamble
    .replaceAll('{{project_id}}',       projectId)
    .replaceAll('{{supabase_project}}', supabaseRef)
}
