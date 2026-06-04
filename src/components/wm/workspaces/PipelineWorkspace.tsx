/**
 * Web Manager — Copywriting pipeline stepper.
 *
 * Eight stages, each with Run/Redo/Approve/Edit-prompt controls.
 * Outputs read from strategy_web_projects.roadmap_state.stage_N,
 * status pills derived from the embedded _meta + presence of the
 * next stage's output.
 *
 * Approval is currently a UI-only marker (stored in roadmap_state
 * under stage_<n>._meta.status). Each stage's API agent writes
 * status='draft'; user-click "Approve" flips it to 'approved' which
 * unlocks the next stage's Run button.
 */
import { useCallback, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { WMCard } from '../Card'
import { supabase } from '../../../lib/supabase'
import {
  PIPELINE_STAGES,
  STAGE_NUMBER,
  type PipelineStage,
} from '../../../lib/pipelinePromptsCore'
import { StageCard, type StageState } from '../pipeline/StageCard'
import { PromptDrawer } from '../pipeline/PromptDrawer'
import { PreviewDrawer } from '../pipeline/PreviewDrawer'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project:  StrategyWebProject
  onChange: () => void | Promise<void>
}

// Map each stage to its API endpoint slug.
const STAGE_ENDPOINTS: Record<PipelineStage, string> = {
  normalize:      '/api/web/agents/normalize-intake',
  synthesize:     '/api/web/agents/extract-strategy',
  sitemap:        '/api/web/agents/draft-sitemap',
  page_inventory: '/api/web/agents/page-inventory',
  outlines:       '/api/web/agents/page-outlines',
  bind:           '/api/web/agents/auto-bind-page',
  coverage_qa:    '/api/web/agents/coverage-audit',
  voice_pass:     '/api/web/agents/voice-pass',
  final_qa:       '/api/web/agents/final-qa',
}

export function PipelineWorkspace({ project, onChange }: Props) {
  const [running,  setRunning]  = useState<PipelineStage | null>(null)
  const [drawer,   setDrawer]   = useState<PipelineStage | null>(null)
  const [preview,  setPreview]  = useState<PipelineStage | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  // Voice-pass apply is a separate post-manifest step. Tracks its own
  // in-flight + result so the card can show "applied X / blocked Y".
  const [applyingVoice, setApplyingVoice] = useState(false)
  const [voiceApplyResult, setVoiceApplyResult] = useState<
    { applied: number; blocked_by_override: number } | null
  >(null)

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>

  // Helpers to read output + status from roadmap_state.stage_N.
  const getOutput = useCallback((s: PipelineStage): Record<string, any> | null => {
    const key = `stage_${STAGE_NUMBER[s]}`
    const v = roadmapState[key]
    return v && typeof v === 'object' ? v : null
  }, [roadmapState])
  const getStatus = useCallback((s: PipelineStage): 'draft'|'approved'|null => {
    const out = getOutput(s)
    if (!out) return null
    const meta = out._meta ?? {}
    return meta.status === 'approved' ? 'approved' : 'draft'
  }, [getOutput])

  const stageState = useCallback((s: PipelineStage): StageState => {
    if (running === s) return 'running'
    const status = getStatus(s)
    if (status === 'approved') return 'approved'
    if (status === 'draft')    return 'draft'
    // Locked unless previous stage is approved (or first stage).
    const idx = PIPELINE_STAGES.indexOf(s)
    if (idx === 0) return 'ready'
    const prev = PIPELINE_STAGES[idx - 1]
    return getStatus(prev) === 'approved' ? 'ready' : 'locked'
  }, [running, getStatus])

  const runStage = useCallback(async (stage: PipelineStage, feedback?: string) => {
    setRunning(stage); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch(STAGE_ENDPOINTS[stage], {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          projectId:   project.id,
          redoContext: feedback ?? undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunning(null)
    }
  }, [project.id, onChange])

  // Voice-pass two-step: the agent's first call writes the rewrite
  // manifest; this second call (apply=true) walks the manifest and
  // writes new_value back into web_sections.field_values, skipping
  // any field marked field_provenance='override' so locked-by-
  // strategist content survives.
  const applyVoicePass = useCallback(async () => {
    setApplyingVoice(true); setError(null); setVoiceApplyResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/web/agents/voice-pass', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body:    JSON.stringify({ projectId: project.id, apply: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setVoiceApplyResult({
        applied:             Number(json.applied ?? 0),
        blocked_by_override: Number(json.blocked_by_override ?? 0),
      })
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplyingVoice(false)
    }
  }, [project.id, onChange])

  const approveStage = useCallback(async (stage: PipelineStage) => {
    const key = `stage_${STAGE_NUMBER[stage]}`
    const current = roadmapState[key] ?? {}
    const next = { ...current, _meta: { ...(current._meta ?? {}), status: 'approved' } }
    const { error: err } = await supabase
      .from('strategy_web_projects')
      .update({ roadmap_state: { ...roadmapState, [key]: next } })
      .eq('id', project.id)
    if (err) {
      setError(err.message)
      return
    }
    await onChange()
  }, [project.id, roadmapState, onChange])

  const stages = useMemo(() => PIPELINE_STAGES.map(s => {
    const out = getOutput(s)
    const meta = out?._meta ?? {}
    return {
      stage:        s,
      state:        stageState(s),
      output:       out,
      redoCount:    Number(meta.redo_count ?? 0),
      promptSource: (meta.prompt_source as 'db'|'fallback'|undefined) ?? null,
      hasAddendum:  !!meta.has_project_addendum,
    }
  }), [getOutput, stageState])

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-3">
        <header className="mb-2">
          <p className="text-[11px] uppercase tracking-widest font-bold text-wm-accent-strong">Copywriting pipeline</p>
          <h1 className="text-2xl font-semibold text-wm-text mt-1">Eight focused stages, end to end</h1>
          <p className="text-sm text-wm-text-muted mt-1">
            Each stage runs as its own model call with an editable system
            prompt. Approve a stage to unlock the next one. Edit a project
            addendum to tune a stage for this project without changing the
            global default.
          </p>
        </header>

        {error && (
          <WMCard padding="loose" className="border-wm-danger/40 bg-wm-danger-bg">
            <p className="text-[12px] text-wm-danger">{error}</p>
          </WMCard>
        )}

        {voiceApplyResult && (
          <div className="rounded-md border border-wm-success/30 bg-wm-success-bg px-3 py-2 text-[12px] text-wm-success">
            Voice rewrites applied: <strong>{voiceApplyResult.applied}</strong> field
            {voiceApplyResult.applied === 1 ? '' : 's'} updated
            {voiceApplyResult.blocked_by_override > 0 && (
              <> · <strong>{voiceApplyResult.blocked_by_override}</strong> skipped
                (field_provenance='override' protected)</>
            )}.
          </div>
        )}

        <div className="space-y-2">
          {stages.map(s => {
            // Voice-pass gets a secondary CTA that writes the
            // manifest's rewrites back into web_sections. Available
            // only when a draft manifest exists.
            const isVoice = s.stage === 'voice_pass'
            const hasManifest = isVoice && s.output
              && Array.isArray((s.output as any).rewrites)
              && (s.output as any).rewrites.length > 0
            const extraAction = isVoice && hasManifest
              ? {
                  label: applyingVoice
                    ? 'Applying…'
                    : `Apply ${(s.output as any).rewrites.length} rewrites`,
                  title: 'Write the manifest into web_sections.field_values. Fields marked override are skipped.',
                  loading: applyingVoice,
                  onClick: applyVoicePass,
                }
              : undefined
            return (
              <StageCard
                key={s.stage}
                stage={s.stage}
                state={s.state}
                output={s.output}
                redoCount={s.redoCount}
                promptSource={s.promptSource}
                hasAddendum={s.hasAddendum}
                onRun={(fb) => runStage(s.stage, fb)}
                onApprove={s.state === 'draft' ? () => approveStage(s.stage) : undefined}
                onEditPrompt={() => setDrawer(s.stage)}
                onViewOutput={s.output ? () => setPreview(s.stage) : undefined}
                extraAction={extraAction}
              />
            )
          })}
        </div>

        {running && (
          <div className="rounded-md border border-wm-accent/30 bg-wm-accent-tint px-3 py-2 text-[12px] text-wm-text flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-wm-accent" />
            Stage {STAGE_NUMBER[running]} is running — keep this tab open.
          </div>
        )}
      </div>

      {drawer && (
        <PromptDrawer
          stage={drawer}
          projectId={project.id}
          onClose={() => setDrawer(null)}
          onSaved={() => { void onChange() }}
        />
      )}

      {preview && getOutput(preview) && (
        <PreviewDrawer
          stage={preview}
          output={getOutput(preview)!}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
