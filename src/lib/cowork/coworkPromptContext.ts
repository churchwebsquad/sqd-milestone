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
 *  from + the RPC the SKILLs write through + the hard-won lessons
 *  cowork sessions surfaced (information_schema can lie, the only
 *  write path is the Supabase MCP, large jsonb payloads need a
 *  chunked-write protocol). Uses {{project_id}} + {{supabase_project}}
 *  tokens so the same string survives copy-paste into Claude Desktop
 *  with both substituted. */
export const SUPABASE_CONTEXT_PREAMBLE =
`## Environment & access (read first — don't rediscover this at runtime)

- **Supabase project ref**: \`{{supabase_project}}\`. The project row is \`strategy_web_projects\` where \`id = '{{project_id}}'\`. Inventory tables filter on **\`web_project_id = '{{project_id}}'\`** (a uuid) — note it is \`web_project_id\`, not \`project_id\`.
- **Only write path is the Supabase MCP** (\`execute_sql\` + the \`roadmap_state_set\` RPC). There is **no psql, no \`DATABASE_URL\`, and no PostgREST key** in the sandbox — don't spend a step probing for one. Plan every write around \`execute_sql\`.
- **\`information_schema\` can lie here** — it may surface a stale or duplicate column list. **Before composing any column-specific or aggregate query**, run \`SELECT * FROM <table> WHERE web_project_id = '{{project_id}}' LIMIT 1\` to confirm the real columns.

### Known real shapes
- \`content_atoms(id, web_project_id, topic, body, metadata, source_kind, source_ref, verbatim, confidence, status, …)\`
- \`church_facts(id, web_project_id, topic, data jsonb, source_kind, source_ref, status, …)\` — **no** \`display_label\` / \`section\` / \`fact_key\` columns. Aggregate by \`topic\`; read labels from \`data->>'label' | 'name' | 'title'\`.
- \`web_project_topics(topic_key, topic_label, topic_group, inventory_kind, coverage_status, passages jsonb, items jsonb, …)\`; \`coverage_status ∈ {rich, covered, sparse}\`.
- \`strategy_web_projects.roadmap_state\` — JSONB. Read keys with \`->\` / \`->>\`. Write atomically via \`roadmap_state_set(p_project_id, p_path, p_value)\` RPC.
- \`strategy_web_projects.roadmap_state.strategic_goals\` — strategist-approved snapshot (filter to \`status='approved'\` for pipeline consumption).

## Persistence — large-payload protocol

Pipeline artifacts (page_allocation_plan, page_outlines.<slug>, page_drafts.<slug>) commonly run tens of KB. A single inline SQL literal corrupts above ~8 KB and the \`::jsonb\` cast silently truncates. **Use the chunked-write protocol for any payload > 8 KB**:

1. Generate the final JSON locally; compute **md5 of the whole payload and of each ~9 KB chunk**.
2. Create a staging table (\`CREATE TEMP TABLE _staging (ix int, body text)\`); insert chunks with \`$dollar$\` quoting.
3. **Verify server-side** *before* the RPC:
   - each chunk's md5 matches the local md5
   - assembled string's md5 equals the local whole-payload md5
   - \`(assembled)::jsonb\` parses without error (the cast fails closed — a corrupted write cannot land)
4. Call \`roadmap_state_set('{{project_id}}', ARRAY['<top_key>', ...], (assembled)::jsonb)\`, drop the staging table, then \`SELECT roadmap_state->'<top_key>'->'_meta'\` to confirm the write landed.

**For edits to an existing large object** (e.g., revising \`site_strategy\` or patching one page in \`page_outlines\`), prefer **server-side \`jsonb_set\` / \`||\` transforms** so you never re-transmit the whole blob. Always dry-run a \`SELECT\` of the transformed object's invariants (counts, key presence) BEFORE the write.
`

/** Replace cowork prompt tokens at copy-time. Currently:
 *    {{project_id}}        → the web project's UUID
 *    {{supabase_project}}  → the Supabase project ref (from env)
 *  Plus prepends SUPABASE_CONTEXT_PREAMBLE when the input doesn't
 *  already include it (idempotent — safe to call on inputs that
 *  hand-embed the preamble themselves). */
export function expandCoworkTokens(template: string, projectId: string): string {
  const supabaseRef = getSupabaseProjectRef()
  // Idempotency marker: the unique heading from the preamble. Skip
  // injection when the template already embeds the preamble (lets
  // a caller hand-customize order if needed).
  const withPreamble = template.includes('Environment & access')
    ? template
    : `${SUPABASE_CONTEXT_PREAMBLE}\n${template}`
  return withPreamble
    .replaceAll('{{project_id}}',       projectId)
    .replaceAll('{{supabase_project}}', supabaseRef)
}
