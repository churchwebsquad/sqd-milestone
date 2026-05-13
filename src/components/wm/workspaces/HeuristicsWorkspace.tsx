/**
 * Web Manager — Heuristics workspace.
 *
 * Three layered guidance systems:
 *   1. Global writing rules — read-only summary (full content in
 *      references/web-writing-rules.md, applied automatically by AI).
 *   2. Project writing rules — extracted from strategy brief at Stage 1;
 *      editable inline. Overlay on top of global rules.
 *   3. Denominational filter — active filter applied to AI generation.
 *      Switchable per project.
 *   4. Personas — per-project archetypes from the strategy brief.
 *      Read-only in Phase A; editor lands when AI fills in Stage 1.
 */

import { useEffect, useState } from 'react'
import { BookOpen, Loader2, Save, ExternalLink } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMCard } from '../Card'
import { WMButton } from '../Button'
import { WMStatusPill } from '../StatusPill'
import type { StrategyWebProject, WebPersona } from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

const GLOBAL_RULES_SUMMARY = [
  'No em dashes (— or –). Use a period or comma instead.',
  'No three-adjective clusters. Pick the single strongest word.',
  'No filler intensifiers: truly, really, deeply, incredibly, very, amazing, just.',
  "No 'We / Our' framing. The church refers to itself as 'this community' or by its proper name.",
  'No AI cliché vocabulary: delve, tapestry, unlock, elevate, beacon, embark, resonate, dynamic.',
  'StoryBrand frame: visitor is the hero, church is the guide, Jesus named at least once per major section.',
  'Every CTA carries its destination URL. No vague "click here."',
  'Same destination, same label. CTAs to the same place say the same thing.',
  'H1 = page name. Save the emotive framing for the tagline above or subheading below.',
  'Hero body copy ≤ 30 words. When in doubt, drop it.',
  'Listings group by shape, not topic. Cards in a group share a schema; missing fields render nothing.',
]

const DENOMINATIONAL_FILTERS = [
  'Evangelical / Non-Denominational',
  'Reformed / Calvinist',
  'Pentecostal / Charismatic',
  'Methodist / Wesleyan',
  'Baptist',
  'Lutheran',
  'Catholic',
  'Anglican / Episcopal',
] as const

export function HeuristicsWorkspace({ project }: Props) {
  const [projectRules, setProjectRules] = useState(project.project_writing_rules ?? '')
  const [filter, setFilter] = useState(project.denominational_filter ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setProjectRules(project.project_writing_rules ?? '')
    setFilter(project.denominational_filter ?? '')
    setDirty(false)
  }, [project.id, project.project_writing_rules, project.denominational_filter])

  const save = async () => {
    setSaving(true)
    await supabase
      .from('strategy_web_projects')
      .update({
        project_writing_rules: projectRules.trim() || null,
        denominational_filter: filter.trim() || null,
      })
      .eq('id', project.id)
    setSaving(false)
    setDirty(false)
  }

  const personas: WebPersona[] = Array.isArray(project.personas) ? project.personas : []

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <BookOpen size={13} />
            <p className="text-[11px] font-bold uppercase tracking-widest">Heuristics</p>
          </div>
          <h1 className="text-2xl font-semibold text-wm-text">Rules, filter, and personas</h1>
          <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
            What guides every word AI generates. Global rules apply to every project; the rest tailors
            to this church specifically.
          </p>
        </div>

        {/* Global writing rules */}
        <WMCard padding="loose" className="mb-4">
          <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h2 className="text-[15px] font-semibold text-wm-text">Global writing rules</h2>
              <p className="text-[12px] text-wm-text-muted">Apply to every project. Read-only.</p>
            </div>
            <a
              href="https://github.com"  // placeholder — points to references/web-writing-rules.md in repo when committed
              className="text-[12px] font-semibold text-wm-accent-strong hover:underline inline-flex items-center gap-0.5"
            >
              Full ruleset <ExternalLink size={11} />
            </a>
          </div>
          <ul className="space-y-1.5">
            {GLOBAL_RULES_SUMMARY.map((rule, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] text-wm-text-muted">
                <span className="text-wm-accent mt-1 shrink-0">·</span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </WMCard>

        {/* Project writing rules */}
        <WMCard padding="loose" className="mb-4">
          <div className="mb-3">
            <h2 className="text-[15px] font-semibold text-wm-text">Project writing rules</h2>
            <p className="text-[12px] text-wm-text-muted">
              Extracted from the strategy brief at Stage 1 — partner-specific avoid-language,
              vocabulary preferences, tone constraints. Editable as you refine.
            </p>
          </div>
          <textarea
            value={projectRules}
            onChange={e => { setProjectRules(e.target.value); setDirty(true) }}
            rows={6}
            placeholder={`Examples (drawn from Evangel Christian Churches strategy brief):
• Avoid politics — community is multicultural and divisive language alienates
• Avoid hell, fire and brimstone language — saved by grace not condemnation
• Use "Disciples Serve" for volunteer language
• Tone should be Bold Truth + Grace-Filled + Detroit Grit`}
            className="w-full rounded-md bg-wm-bg border border-wm-border px-3 py-2 text-sm text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          />
        </WMCard>

        {/* Denominational filter */}
        <WMCard padding="loose" className="mb-4">
          <div className="mb-3">
            <h2 className="text-[15px] font-semibold text-wm-text">Denominational filter</h2>
            <p className="text-[12px] text-wm-text-muted">
              The theological tradition AI calibrates vocabulary against. Switchable when intake reveals
              a clearer fit. Each filter has its own Name explicitly / Avoid / Vocabulary swap rules.
            </p>
          </div>
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); setDirty(true) }}
            className="w-full md:w-auto h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
          >
            <option value="">— Not set (defaults to Evangelical / Non-Denominational) —</option>
            {DENOMINATIONAL_FILTERS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </WMCard>

        {/* Personas */}
        <WMCard padding="loose" className="mb-4">
          <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-[15px] font-semibold text-wm-text">Personas</h2>
              <p className="text-[12px] text-wm-text-muted">
                Per-project archetypes from the strategy brief. AI tailors copy to address them by name.
              </p>
            </div>
            <WMStatusPill tone={personas.length > 0 ? 'success' : 'neutral'} size="sm">
              {personas.length} {personas.length === 1 ? 'persona' : 'personas'}
            </WMStatusPill>
          </div>

          {personas.length === 0 ? (
            <div className="rounded-md border border-dashed border-wm-border bg-wm-bg p-5 text-center">
              <p className="text-[12px] font-semibold text-wm-text">No personas yet</p>
              <p className="text-[11px] text-wm-text-muted mt-1">
                AI extracts these from the strategy brief at Stage 1. After that, you can refine them here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {personas.map((p, i) => <PersonaCard key={p.id ?? i} persona={p} />)}
            </div>
          )}
        </WMCard>

        {/* Save */}
        {dirty && (
          <div className="sticky bottom-4 flex justify-end">
            <WMButton variant="primary" loading={saving} onClick={save} iconLeft={<Save size={13} />}>
              Save changes
            </WMButton>
          </div>
        )}
      </div>
    </div>
  )
}

function PersonaCard({ persona }: { persona: WebPersona }) {
  return (
    <div className="rounded-md bg-wm-bg border border-wm-border p-4">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
        {persona.archetype}
      </p>
      <h3 className="text-[14px] font-semibold text-wm-text mb-1">{persona.name}</h3>
      <p className="text-[12px] text-wm-text-muted line-clamp-3 leading-snug">{persona.description}</p>
      {persona.message && (
        <blockquote className="mt-3 text-[12px] italic text-wm-text border-l-2 border-wm-accent pl-3">
          {persona.message}
        </blockquote>
      )}
    </div>
  )
}
