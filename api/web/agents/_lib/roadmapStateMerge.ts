// Atomic roadmap_state writes for every Copy Engine agent.
//
// Every agent had been doing read-modify-write of
// strategy_web_projects.roadmap_state (a single JSONB column on a
// single row). With 30-90s LLM calls between read and write, sibling
// writes from other agents — or from the orchestrate engine_state
// heartbeats — landed in the gap and were silently obliterated when
// the slow agent finally wrote back its frozen-state snapshot.
//
// This is what wiped stage_1 / site_strategy / ministry_model on
// project 3734 even though every upstream agent claimed success
// (production logs showed clean returns from extract-strategy, ACF,
// ministry-model, and strategist — and yet by the time page-outlines
// ran, those keys were gone). Same race lost 3886's outlines and
// drafts (3 of 21 / 12 of 21 persisted).
//
// The Postgres-side v68 migration adds a function
// `roadmap_state_set(project_id, path[], value)` that does the merge
// in a single UPDATE via jsonb_set — no read-then-write window.
// Every agent must go through THIS helper now; direct
// `update({roadmap_state: {...state, ...}})` calls in agent code are
// banned. Search the repo for `roadmap_state:` in `.update(` and
// migrate any straggler.

/** Minimal client shape this module needs — just `.rpc(name, args)` that
 *  returns a thenable yielding `{data, error}`. PromiseLike (not Promise)
 *  so the supabase-js PostgrestFilterBuilder — which is awaitable but
 *  carries extra builder methods — assigns structurally. Lets all
 *  callers pass their full `createClient(...)` result without a cast. */
export type SupabaseClientLike = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** Atomically set a slot in roadmap_state. The path is a JSON path
 *  expressed as an array of keys: ['site_strategy'] for a top-level
 *  key, ['page_outlines', 'home'] for a nested one. The slot at the
 *  given path is overwritten; everything else in the column is
 *  untouched, regardless of what other writers have done in parallel.
 *
 *  Throws on RPC error. Callers should let the error propagate to the
 *  outer try/catch in the agent — the orchestrate handler's catch
 *  block will surface it as a 500 with the error.message included.
 */
export async function setRoadmapStateAtomic(
  sb: SupabaseClientLike,
  projectId: string,
  path: string[],
  value: unknown,
): Promise<void> {
  if (!path || path.length === 0) {
    throw new Error('setRoadmapStateAtomic: path must be a non-empty array')
  }
  const { error } = await sb.rpc('roadmap_state_set', {
    p_project_id: projectId,
    p_path:       path,
    // supabase-js accepts plain JS objects and serializes them as
    // JSONB for the function call. No need to JSON.stringify first.
    p_value:      value,
  })
  if (error) {
    throw new Error(`roadmap_state_set RPC failed for path [${path.join('.')}]: ${error.message}`)
  }
}

/** Atomically delete a top-level key from roadmap_state. Used by
 *  reset_engine_state and other clean-slate operations that should
 *  not be implemented as "read, drop key, write" — same race trap.
 */
export async function deleteRoadmapStateKey(
  sb: SupabaseClientLike,
  projectId: string,
  key: string,
): Promise<void> {
  if (!key) throw new Error('deleteRoadmapStateKey: key must be a non-empty string')
  const { error } = await sb.rpc('roadmap_state_delete', {
    p_project_id: projectId,
    p_key:        key,
  })
  if (error) {
    throw new Error(`roadmap_state_delete RPC failed for key ${key}: ${error.message}`)
  }
}
