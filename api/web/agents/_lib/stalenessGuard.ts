/**
 * Upstream-staleness guard for cowork roadmap_state writer endpoints.
 *
 * The rule (banked from cowork-director SKILL.md's resume-conditions
 * table): refuse the call if the OUTPUT artifact already exists AND
 * its `_meta.generated_at` is newer than the latest UPSTREAM
 * timestamp. This is "if the output exists AND is fresh enough
 * relative to upstream, skip" — promoted from director-only logic
 * into a uniform endpoint-level check per the 2026-06-13 directive.
 *
 * Why it has to live in every project-level writer endpoint, not just
 * the director: the director walks the table sequentially and skips
 * fresh steps, but ANY direct call to an endpoint (scripted, smoke
 * harness, ad-hoc curl, future workspace UI button) bypasses the
 * director. Without an endpoint-level guard, the first scripted call
 * against a mid-flight real account silently regenerates the shared
 * artifact and the resulting drift cascades through every downstream
 * stage. synthesize-strategy is the most dangerous case (stage_1 is
 * the foundation everything reads), but plan-site-strategy and
 * synthesize-critique are the same hazard class.
 *
 * Contract: endpoints accept `force?: boolean` on the request body;
 * pass `force=true` to regenerate. Without force, a stale-by-this-
 * definition output returns 409 with a structured detail block the
 * caller can inspect (which upstream is newer, by how much, etc.).
 *
 * Caveat: this guard is about "did upstream change since I last ran?"
 * not about "is my output good?" Quality is the critique-page's job.
 * If the strategist wants to re-run a project-level step for QUALITY
 * reasons (not staleness), they pass force=true — the guard's purpose
 * is only to prevent SILENT overwrites of fresh artifacts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** What kind of source produced a timestamp. The endpoint declares
 *  these for both its own output and each upstream input; the helper
 *  knows how to resolve each kind into a real timestamp. */
export type UpstreamSpec =
  /** max(created_at) from content_atoms scoped to the project.
   *  Used as the upstream for synthesize-strategy (step 3): stage_1
   *  must be newer than the latest atom that informed it. */
  | { kind: 'content_atoms_max_created_at' }
  /** max(created_at) from church_facts scoped to the project. Used
   *  alongside content_atoms when an endpoint reads both. */
  | { kind: 'church_facts_max_created_at' }
  /** Top-level roadmap_state[key]._meta.generated_at. Used for
   *  stage_1 / ministry_model / acf_plan / site_strategy /
   *  page_allocation_plan / critique_rollup. */
  | { kind: 'roadmap_state_meta', key: string }
  /** roadmap_state[parent]: max of all children's _meta.generated_at.
   *  Used for the page_critiques rollup — synthesize-critique's
   *  upstream is "the latest per-page critique". */
  | { kind: 'roadmap_state_meta_max_child', parent_key: string }
  /** A specific nested key — roadmap_state[parent][child]._meta
   *  .generated_at. Used for outline-page / draft-page / critique-
   *  page where the output is per-slug. */
  | { kind: 'roadmap_state_meta_nested', parent_key: string, child_key: string }

export interface FreshnessCheckInput {
  project_id:    string
  /** Identifier for the writer endpoint's output — used in error
   *  messages. NOT used for resolution (output_spec handles that). */
  output_key:    string
  /** Where to read the output's current _meta.generated_at. */
  output_spec:   UpstreamSpec
  /** All upstream sources. The output must be newer than ALL of them
   *  (= newer than the LATEST one) to be considered fresh. */
  upstream:      UpstreamSpec[]
}

export interface FreshnessCheckResult {
  /** The output's current generated_at, or null if the output
   *  doesn't exist yet. */
  output_generated_at:   string | null
  /** Every upstream's resolved timestamp + human-readable label. */
  upstream: Array<{
    label:     string
    timestamp: string | null
  }>
  /** The newest upstream timestamp + its label. Null only if every
   *  upstream resolved to null (no upstream content yet). */
  latest_upstream_at:    string | null
  latest_upstream_label: string | null
}

/** Resolve a single UpstreamSpec to its current timestamp. */
async function resolveTimestamp(
  sb:         any,
  projectId:  string,
  spec:       UpstreamSpec,
): Promise<{ label: string; timestamp: string | null }> {
  if (spec.kind === 'content_atoms_max_created_at') {
    const { data, error } = await sb
      .from('content_atoms')
      .select('created_at')
      .eq('web_project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`content_atoms timestamp probe failed: ${error.message}`)
    return { label: 'content_atoms.max(created_at)', timestamp: data?.created_at ?? null }
  }
  if (spec.kind === 'church_facts_max_created_at') {
    const { data, error } = await sb
      .from('church_facts')
      .select('created_at')
      .eq('web_project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`church_facts timestamp probe failed: ${error.message}`)
    return { label: 'church_facts.max(created_at)', timestamp: data?.created_at ?? null }
  }
  if (spec.kind === 'roadmap_state_meta') {
    const { data, error } = await sb
      .from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(`roadmap_state load failed: ${error.message}`)
    const ts = data?.roadmap_state?.[spec.key]?._meta?.generated_at ?? null
    return { label: `roadmap_state.${spec.key}._meta.generated_at`, timestamp: ts }
  }
  if (spec.kind === 'roadmap_state_meta_nested') {
    const { data, error } = await sb
      .from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(`roadmap_state load failed: ${error.message}`)
    const ts = data?.roadmap_state?.[spec.parent_key]?.[spec.child_key]?._meta?.generated_at ?? null
    return { label: `roadmap_state.${spec.parent_key}.${spec.child_key}._meta.generated_at`, timestamp: ts }
  }
  if (spec.kind === 'roadmap_state_meta_max_child') {
    const { data, error } = await sb
      .from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(`roadmap_state load failed: ${error.message}`)
    const parent = data?.roadmap_state?.[spec.parent_key]
    if (!parent || typeof parent !== 'object') {
      return { label: `roadmap_state.${spec.parent_key}.*._meta.generated_at (max)`, timestamp: null }
    }
    let maxTs: string | null = null
    for (const child of Object.values(parent as Record<string, any>)) {
      const ts = child?._meta?.generated_at
      if (typeof ts === 'string' && (!maxTs || ts > maxTs)) maxTs = ts
    }
    return { label: `roadmap_state.${spec.parent_key}.*._meta.generated_at (max)`, timestamp: maxTs }
  }
  // Exhaustiveness check
  const _exhaustive: never = spec
  throw new Error(`Unknown UpstreamSpec kind: ${JSON.stringify(_exhaustive)}`)
}

/** Probe Supabase + return both the output's current timestamp and
 *  every upstream's timestamp. The result is the full picture; the
 *  decision helper (decideStaleness) turns it into proceed/refuse. */
export async function freshnessCheck(
  sb:    any,
  input: FreshnessCheckInput,
): Promise<FreshnessCheckResult> {
  const [outputRow, ...upstreamRows] = await Promise.all([
    resolveTimestamp(sb, input.project_id, input.output_spec),
    ...input.upstream.map(spec => resolveTimestamp(sb, input.project_id, spec)),
  ])

  let latest_upstream_at:    string | null = null
  let latest_upstream_label: string | null = null
  for (const u of upstreamRows) {
    if (u.timestamp && (!latest_upstream_at || u.timestamp > latest_upstream_at)) {
      latest_upstream_at    = u.timestamp
      latest_upstream_label = u.label
    }
  }

  return {
    output_generated_at:   outputRow.timestamp,
    upstream:              upstreamRows,
    latest_upstream_at,
    latest_upstream_label,
  }
}

export interface RefusalDetail {
  refuse:                true
  detail:                string
  output_key:            string
  output_generated_at:   string
  latest_upstream_at:    string | null
  latest_upstream_label: string | null
  /** Echo of the full check so the caller can show every upstream's
   *  timestamp in the error UI (helps diagnose "why is this stale
   *  going to fire?"). */
  freshness_snapshot:    FreshnessCheckResult
}

export type StalenessDecision =
  | { refuse: false }
  | RefusalDetail

/** Pure decision: given a freshness snapshot + the strategist's
 *  intent (force or not), return proceed or a structured refusal.
 *
 *  Refusal happens ONLY when ALL of:
 *    - force is false (default)
 *    - the output already exists (output_generated_at != null)
 *    - the output is at least as new as every upstream
 *
 *  Note: ties on timestamp resolve as REFUSE (output is fresh — same
 *  millisecond). This matters when an endpoint and an upstream both
 *  stamp on the same wall-clock millisecond (rare; usually only
 *  during initial seeding); calling force=true is the explicit
 *  override.
 */
export function decideStaleness(
  check:      FreshnessCheckResult,
  opts:       { output_key: string; force?: boolean },
): StalenessDecision {
  if (opts.force) return { refuse: false }
  if (!check.output_generated_at) return { refuse: false }
  if (!check.latest_upstream_at) {
    // Output exists; no upstream timestamp resolved. Two cases:
    //   (a) upstream genuinely has no content yet (shouldn't be
    //       possible if the output exists — output couldn't have been
    //       generated without upstream input).
    //   (b) the upstream spec resolved to null because of a bug
    //       (table query empty, key missing).
    // Either way, refusing is the conservative call — the strategist
    // can pass force=true to override.
    return {
      refuse:                true,
      detail:                `${opts.output_key} exists (generated_at=${check.output_generated_at}) but no upstream timestamp resolved. Cannot determine staleness; pass force=true to regenerate.`,
      output_key:            opts.output_key,
      output_generated_at:   check.output_generated_at,
      latest_upstream_at:    null,
      latest_upstream_label: null,
      freshness_snapshot:    check,
    }
  }
  if (check.output_generated_at >= check.latest_upstream_at) {
    return {
      refuse:                true,
      detail:                `${opts.output_key} (generated_at=${check.output_generated_at}) is at least as fresh as the latest upstream ${check.latest_upstream_label} (${check.latest_upstream_at}). Calling without force=true would silently overwrite a fresh artifact. Pass force=true to regenerate intentionally.`,
      output_key:            opts.output_key,
      output_generated_at:   check.output_generated_at,
      latest_upstream_at:    check.latest_upstream_at,
      latest_upstream_label: check.latest_upstream_label,
      freshness_snapshot:    check,
    }
  }
  // Output is stale relative to at least one upstream — proceed.
  return { refuse: false }
}

/** One-shot helper for endpoints — runs the probe + the decision +
 *  short-circuits with the structured 409 response if refusal. Returns
 *  the result of decideStaleness so the endpoint can branch. */
export async function guardOrRefuse(
  sb:    any,
  input: FreshnessCheckInput,
  opts:  { force?: boolean },
): Promise<StalenessDecision> {
  const check = await freshnessCheck(sb, input)
  return decideStaleness(check, { output_key: input.output_key, force: opts.force })
}
