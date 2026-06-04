/**
 * Browser-side prompt resolver + admin helpers for the copywriting
 * pipeline. Constants + fallback prompts live in
 * `./pipelinePromptsCore.ts` so server-side Vercel agents can reuse
 * them without pulling in the Vite-only Supabase client.
 */
import { supabase } from './supabase'
import {
  FALLBACK_PROMPTS,
  PLACEHOLDER_MARKER,
  type PipelineStage,
} from './pipelinePromptsCore'

export {
  PIPELINE_STAGES,
  STAGE_LABELS,
  STAGE_NUMBER,
  STAGE_DESCRIPTIONS,
  FALLBACK_PROMPTS,
  PLACEHOLDER_MARKER,
  type PipelineStage,
} from './pipelinePromptsCore'

export interface ResolvedPrompt {
  systemPrompt:       string
  globalSource:       'db' | 'fallback'
  hasProjectAddendum: boolean
}

/** Resolve a stage's effective system prompt for a project from the
 *  browser. Global default + optional project addendum appended. */
export async function resolvePrompt(
  stage:     PipelineStage,
  projectId: string,
): Promise<ResolvedPrompt> {
  const [globalRow, projectRow] = await Promise.all([
    supabase.from('web_pipeline_prompts')
      .select('system_prompt').eq('stage', stage).eq('scope', 'global')
      .is('web_project_id', null).maybeSingle(),
    supabase.from('web_pipeline_prompts')
      .select('system_prompt').eq('stage', stage).eq('scope', 'project')
      .eq('web_project_id', projectId).maybeSingle(),
  ])
  const dbGlobal      = globalRow.data?.system_prompt ?? null
  const useFallback   = !dbGlobal || dbGlobal === PLACEHOLDER_MARKER
  const base          = useFallback ? FALLBACK_PROMPTS[stage] : dbGlobal
  const projectAddend = projectRow.data?.system_prompt ?? null
  return {
    systemPrompt: projectAddend
      ? `${base}\n\n## Project-specific notes\n${projectAddend}`
      : base,
    globalSource:       useFallback ? 'fallback' : 'db',
    hasProjectAddendum: !!projectAddend,
  }
}

/** Admin — replace the global prompt for a stage. */
export async function updateGlobalPrompt(
  stage:        PipelineStage,
  systemPrompt: string,
  notes?:       string | null,
): Promise<{ error?: string }> {
  const { error } = await supabase.from('web_pipeline_prompts')
    .update({
      system_prompt: systemPrompt,
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('stage', stage).eq('scope', 'global').is('web_project_id', null)
  return error ? { error: error.message } : {}
}

/** Per-project — set or replace the addendum for a stage. */
export async function upsertProjectAddendum(
  stage:        PipelineStage,
  projectId:    string,
  systemPrompt: string,
): Promise<{ error?: string }> {
  const { data: existing } = await supabase.from('web_pipeline_prompts')
    .select('id').eq('stage', stage).eq('scope', 'project')
    .eq('web_project_id', projectId).maybeSingle()
  if (existing?.id) {
    const { error } = await supabase.from('web_pipeline_prompts')
      .update({ system_prompt: systemPrompt, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return error ? { error: error.message } : {}
  }
  const { error } = await supabase.from('web_pipeline_prompts').insert({
    stage, scope: 'project', web_project_id: projectId, system_prompt: systemPrompt,
  })
  return error ? { error: error.message } : {}
}

/** Per-project — remove the addendum so the project reverts to the
 *  pure global default on next resolve. */
export async function clearProjectAddendum(
  stage:     PipelineStage,
  projectId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.from('web_pipeline_prompts')
    .delete().eq('stage', stage).eq('scope', 'project')
    .eq('web_project_id', projectId)
  return error ? { error: error.message } : {}
}

/** Admin listing for the global prompts page. */
export async function listGlobalPrompts(): Promise<Array<{
  stage:          PipelineStage
  system_prompt:  string
  notes:          string | null
  updated_at:     string
  is_placeholder: boolean
}>> {
  const { data } = await supabase.from('web_pipeline_prompts')
    .select('stage, system_prompt, notes, updated_at')
    .eq('scope', 'global').is('web_project_id', null).order('stage')
  return ((data ?? []) as Array<{
    stage: PipelineStage; system_prompt: string; notes: string | null; updated_at: string
  }>).map(r => ({
    ...r,
    is_placeholder: r.system_prompt === PLACEHOLDER_MARKER,
  }))
}

/** Look up just the project addendum (no global merge) — used by the
 *  prompt drawer to display the current override text. */
export async function getProjectAddendum(
  stage:     PipelineStage,
  projectId: string,
): Promise<string | null> {
  const { data } = await supabase.from('web_pipeline_prompts')
    .select('system_prompt').eq('stage', stage).eq('scope', 'project')
    .eq('web_project_id', projectId).maybeSingle()
  return data?.system_prompt ?? null
}
