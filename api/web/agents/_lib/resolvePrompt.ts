/**
 * Server-side resolver for pipeline system prompts.
 * Mirrors `src/lib/pipelinePrompts.resolvePrompt` but takes an
 * explicit Supabase client so Vercel agents can pass their service-
 * role client. Pulls fallback prompts from `pipelinePromptsCore` so
 * both sides stay in sync.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FALLBACK_PROMPTS,
  PLACEHOLDER_MARKER,
  type PipelineStage,
} from '../../../../src/lib/pipelinePromptsCore'

export interface ResolvedPromptServer {
  systemPrompt:       string
  globalSource:       'db' | 'fallback'
  hasProjectAddendum: boolean
}

export async function resolvePromptServer(
  sb:        SupabaseClient,
  stage:     PipelineStage,
  projectId: string,
): Promise<ResolvedPromptServer> {
  const [globalRow, projectRow] = await Promise.all([
    sb.from('web_pipeline_prompts')
      .select('system_prompt').eq('stage', stage).eq('scope', 'global')
      .is('web_project_id', null).maybeSingle(),
    sb.from('web_pipeline_prompts')
      .select('system_prompt').eq('stage', stage).eq('scope', 'project')
      .eq('web_project_id', projectId).maybeSingle(),
  ])
  const dbGlobal      = (globalRow.data as { system_prompt?: string } | null)?.system_prompt ?? null
  const useFallback   = !dbGlobal || dbGlobal === PLACEHOLDER_MARKER
  const base          = useFallback ? FALLBACK_PROMPTS[stage] : dbGlobal
  const projectAddend = (projectRow.data as { system_prompt?: string } | null)?.system_prompt ?? null
  return {
    systemPrompt: projectAddend
      ? `${base}\n\n## Project-specific notes\n${projectAddend}`
      : base,
    globalSource:       useFallback ? 'fallback' : 'db',
    hasProjectAddendum: !!projectAddend,
  }
}
