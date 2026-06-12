/**
 * Server-side resolver for cowork worker skill prompts.
 *
 * Mirrors `resolvePromptServer` for the legacy 8-stage pipeline, but
 * for the cowork worker skills. Three-tier resolution:
 *
 *   1. DB global override     — web_pipeline_prompts (scope='global'),
 *                               stage='cowork:<skill-name>'. Lets a
 *                               strategist edit prompts in-app once
 *                               the v68 migration lands.
 *   2. DB project addendum    — web_pipeline_prompts (scope='project'),
 *                               same stage. APPENDED, not replacing.
 *   3. Generated default      — src/lib/cowork/skillPrompts.generated.ts.
 *                               The SKILL.md body + each declared
 *                               reference file, baked at build time.
 *                               THIS is the floor — endpoints never
 *                               import the bundle directly, so the
 *                               override path always wins when present.
 *
 * Today (no migration yet), the web_pipeline_prompts.stage CHECK
 * constraint excludes cowork stage names; SELECT queries against those
 * names just return zero rows, which means the resolver always falls
 * back to the generated default. The code is correct as-is; a future
 * v70 migration extending the CHECK enables the override path without
 * touching this resolver. Documented separately on the migration TODO.
 *
 * Always returns the model + content hash from the bundle — endpoints
 * stamp these into artifact _meta so each output is traceable to the
 * exact prompt snapshot that produced it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COWORK_SKILL_BUNDLES,
  type CoworkSkillName,
} from '../../../../src/lib/cowork/skillPrompts.generated.js'

export interface ResolvedCoworkSkill {
  /** Fully assembled system prompt (default OR override + optional project addendum). */
  systemPrompt:       string
  /** Model string from the SKILL.md frontmatter — endpoints MUST pass this
   *  through to the gateway rather than hardcoding. */
  model:              string
  /** sha256-16 of the system prompt as resolved (computed when override
   *  is active so the hash reflects what actually ran, not the default). */
  promptHash:         string
  /** Bundle version stamped into artifact _meta. */
  skillVersion:       string
  /** 'db' = global override row exists, 'fallback' = used generated bundle. */
  globalSource:       'db' | 'fallback'
  /** True if a project-specific addendum was appended. */
  hasProjectAddendum: boolean
}

export interface ResolveCoworkSkillOptions {
  /** Optional override of the DB stage key — defaults to `cowork:<skillName>`. */
  stageKeyOverride?: string
}

/** Marker treated as "not yet customized" — same convention as
 *  pipelinePromptsCore.PLACEHOLDER_MARKER. */
const PLACEHOLDER_MARKER = 'placeholder'

export async function resolveCoworkSkill(
  sb:        SupabaseClient,
  skillName: CoworkSkillName,
  projectId: string,
  opts:      ResolveCoworkSkillOptions = {},
): Promise<ResolvedCoworkSkill> {
  const bundle = COWORK_SKILL_BUNDLES[skillName]
  if (!bundle) throw new Error(`Unknown cowork skill: ${skillName}`)

  const stageKey = opts.stageKeyOverride ?? `cowork:${skillName}`

  // Run both queries in parallel; tolerate the case where the CHECK
  // constraint rejects the stageKey at write time but allows reads
  // (today: SELECT returns zero rows because no insert has been allowed).
  const [globalRow, projectRow] = await Promise.all([
    sb.from('web_pipeline_prompts')
      .select('system_prompt')
      .eq('stage', stageKey)
      .eq('scope', 'global')
      .is('web_project_id', null)
      .maybeSingle()
      .then(r => r, () => ({ data: null, error: null } as { data: null; error: null })),
    sb.from('web_pipeline_prompts')
      .select('system_prompt')
      .eq('stage', stageKey)
      .eq('scope', 'project')
      .eq('web_project_id', projectId)
      .maybeSingle()
      .then(r => r, () => ({ data: null, error: null } as { data: null; error: null })),
  ])

  const dbGlobal      = (globalRow.data as { system_prompt?: string } | null)?.system_prompt ?? null
  const useFallback   = !dbGlobal || dbGlobal === PLACEHOLDER_MARKER
  const base          = useFallback ? bundle.systemPrompt : dbGlobal
  const projectAddend = (projectRow.data as { system_prompt?: string } | null)?.system_prompt ?? null

  const systemPrompt = projectAddend
    ? `${base}\n\n## Project-specific notes\n${projectAddend}`
    : base

  // Hash the EFFECTIVE prompt (default+addendum, or override+addendum)
  // so artifact _meta.prompt_hash reflects what actually ran.
  // Use Node's crypto via dynamic import to stay edge/serverless agnostic.
  const promptHash = useFallback && !projectAddend
    ? bundle.contentHash
    : await sha256Short(systemPrompt)

  return {
    systemPrompt,
    model:              bundle.model,
    promptHash,
    skillVersion:       bundle.version,
    globalSource:       useFallback ? 'fallback' : 'db',
    hasProjectAddendum: !!projectAddend,
  }
}

async function sha256Short(text: string): Promise<string> {
  // Web Crypto first (works on edge + recent Node); fall back to node:crypto.
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoObj?.subtle) {
    const buf = new TextEncoder().encode(text)
    const hash = await cryptoObj.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  }
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}
