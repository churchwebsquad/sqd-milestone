/**
 * Web Manager — Design workspace.
 *
 * Authoring surface for the project's design system spec. The
 * strategist enters brand anchors (named hexes from the brand guide),
 * assigns ACSS roles, then sets the desktop + mobile values for
 * typography / spacing / radius. The workspace generates tonal scales
 * from anchors (HSL perceptual stepping) and emits two downstream
 * artifacts on demand:
 *
 *   • `tokens.figma.json` — Tokens Studio plugin format. Import into
 *     Figma → Tokens Studio → "Create variables" to land every
 *     variable in a `global` collection. Brand updates cascade because
 *     role scales reference the brand anchor by name.
 *
 *   • (Phase 2) ACSS overrides `:root` CSS block for Bricks. ACSS Pro
 *     auto-derives tonal scales, so the CSS emit is leaner than the
 *     Figma JSON.
 *
 * Spec persists on `strategy_web_projects.design_system` jsonb.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Palette, Plus, Trash2, Download, Save, Loader2, Type, Move, Square,
  Sparkles, ExternalLink, Check, AlertCircle, Layers, FileCode, FileText,
  FolderOpen,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMButton } from '../Button'
import { WMCard } from '../Card'
import {
  emptyDesignSystemSpec, parseDesignSystemSpec,
  toClamp, toTokensStudioJson, populateFromBrandGuide,
  parseFigmaUrl, normalizeFigmaBinding,
  generateAcssShades, anchorShadeStep,
  ACSS_ROLES, ACSS_SHADE_STEPS,
  type DesignSystemSpec, type BrandAnchor, type TypographyRole,
  type SpacingStep, type BrandColorRow, type BrandTypographyRow,
  type FontResource, type AcssRole,
  type RoleShadeMatrix, type FigmaBinding,
} from '../../../lib/designSystemSpec'
import {
  toPluginTemplateRow, buildPageData,
  generateStyleGuidePlugin, generatePagesPlugin,
} from '../../../lib/figmaPluginGenerator'
import { loadEditorSnippets } from '../../../lib/webSnippets'
import { augmentTemplate } from '../../../lib/webBrixiesSchemaAugment'
import type { StrategyWebProject, WebContentTemplate, WebPage, WebSection } from '../../../types/database'

interface Props {
  project: StrategyWebProject
  onChange: () => Promise<void>
}

export function DesignWorkspace({ project, onChange }: Props) {
  const [spec, setSpec] = useState<DesignSystemSpec>(
    () => parseDesignSystemSpec(project.design_system) ?? emptyDesignSystemSpec(),
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [populating, setPopulating] = useState(false)
  const [populateStatus, setPopulateStatus] = useState<{
    kind: 'success' | 'empty' | 'error'
    summary: string[]
    message?: string
  } | null>(null)

  // Force-reset on project switch — different project = fresh spec.
  useEffect(() => {
    setSpec(parseDesignSystemSpec(project.design_system) ?? emptyDesignSystemSpec())
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  // Re-hydrate when the project row reloads externally — but ONLY
  // when there are no unsaved local edits. The parent page polls
  // `web_projects` every 5s and hands us a fresh object reference on
  // every tick; without the dirty guard the polling would silently
  // overwrite unsaved checkbox toggles, anchor edits, etc.
  useEffect(() => {
    if (dirty) return
    setSpec(parseDesignSystemSpec(project.design_system) ?? emptyDesignSystemSpec())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.design_system])

  const update = (next: DesignSystemSpec) => {
    setSpec({ ...next, meta: { ...next.meta, updated_at: new Date().toISOString() } })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ design_system: spec } as never)
      .eq('id', project.id)
    setSaving(false)
    if (error) {
      console.error('[Design] save failed:', error.message)
      return
    }
    setDirty(false)
    await onChange()
  }

  // Auto-save path used by low-stakes toggles (e.g. the Figma load
  // checklist). Persists the entire current spec immediately and
  // clears `dirty` on success — the user never sees a save button.
  // If other edits were pending, they get persisted alongside; this
  // is by design (the checklist toggle acts as an implicit Save).
  const autoSave = async (next: DesignSystemSpec) => {
    const stamped: DesignSystemSpec = {
      ...next,
      meta: { ...next.meta, updated_at: new Date().toISOString() },
    }
    setSpec(stamped)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ design_system: stamped } as never)
      .eq('id', project.id)
    if (error) {
      console.error('[Design] auto-save failed:', error.message)
      return
    }
    setDirty(false)
    await onChange()
  }

  const populateFromIntake = async () => {
    setPopulating(true)
    setPopulateStatus(null)
    try {
      // Brand-guide rows are keyed by member (integer). Project carries
      // the member as `member`. Find the matching brand guide first;
      // if multiple guides exist for the member, prefer the published
      // one, then the most recently updated.
      const { data: guides, error: guideErr } = await supabase
        .from('strategy_brand_guides')
        .select('id, is_published, last_updated_at, updated_at')
        .eq('member', project.member)
        .order('is_published', { ascending: false })
        .order('last_updated_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false, nullsFirst: false })
      if (guideErr) throw new Error(guideErr.message)
      const guide = guides?.[0]
      if (!guide) {
        setPopulateStatus({
          kind: 'empty',
          summary: [],
          message: `No brand guide found for member ${project.member}. Have intake load the brand colors + typography first.`,
        })
        return
      }

      const [{ data: colors, error: colorsErr }, { data: typography, error: typeErr }] =
        await Promise.all([
          supabase
            .from('strategy_brand_colors')
            .select('name, tier, hex, proportion_pct, sort_order')
            .eq('brand_guide_id', guide.id),
          supabase
            .from('strategy_brand_typography')
            .select('tier, family_name, web_font_family, font_url, free_alt_family, free_alt_font_url, suggested_use, weight, letter_case, sort_order')
            .eq('brand_guide_id', guide.id),
        ])
      if (colorsErr) throw new Error(colorsErr.message)
      if (typeErr) throw new Error(typeErr.message)

      const result = populateFromBrandGuide(
        spec,
        (colors ?? []) as BrandColorRow[],
        (typography ?? []) as BrandTypographyRow[],
      )

      if (!result.populated) {
        setPopulateStatus({
          kind: 'empty',
          summary: result.summary,
          message: 'Brand guide exists but no colors or typography rows are filled in yet.',
        })
        return
      }

      setSpec(result.spec)
      setDirty(true)
      setPopulateStatus({ kind: 'success', summary: result.summary })
    } catch (err) {
      setPopulateStatus({
        kind: 'error',
        summary: [],
        message: err instanceof Error ? err.message : 'Unknown error.',
      })
    } finally {
      setPopulating(false)
    }
  }

  const downloadTokensJson = () => {
    const json = JSON.stringify(toTokensStudioJson(spec), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const slug = (project.church_short_name || project.name || 'project')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    a.download = `${slug}-tokens.figma.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
              <Palette size={13} />
              <p className="text-[11px] font-bold uppercase tracking-widest">Design</p>
            </div>
            <h1 className="text-2xl font-semibold text-wm-text">Design system</h1>
            <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
              Brand anchors and the role scales they drive. Authored here, exported as
              Tokens Studio JSON for Figma and (Phase 2) as ACSS overrides for Bricks.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <WMButton
              variant="secondary"
              size="md"
              iconLeft={populating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              onClick={populateFromIntake}
              disabled={populating}
              title="Read strategy_brand_colors + strategy_brand_typography for this member and merge into the spec"
            >
              Auto-populate from brand guide
            </WMButton>
            <WMButton
              variant="secondary"
              size="md"
              iconLeft={<Download size={13} />}
              onClick={downloadTokensJson}
              disabled={spec.brand_anchors.length === 0}
            >
              Download tokens.figma.json
            </WMButton>
            <WMButton
              variant="primary"
              size="md"
              iconLeft={saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              onClick={save}
              disabled={!dirty || saving}
            >
              {dirty ? 'Save' : 'Saved'}
            </WMButton>
          </div>
        </div>

        {populateStatus && (
          <div
            className={[
              'mb-5 rounded-md border px-3 py-2 text-[12px]',
              populateStatus.kind === 'success'
                ? 'border-wm-success/30 bg-wm-success-bg text-wm-success'
                : populateStatus.kind === 'error'
                  ? 'border-wm-danger/30 bg-wm-danger-bg text-wm-danger'
                  : 'border-wm-border bg-wm-bg-hover text-wm-text-muted',
            ].join(' ')}
          >
            <p className="font-semibold mb-0.5">
              {populateStatus.kind === 'success'
                ? 'Populated from brand guide'
                : populateStatus.kind === 'empty'
                  ? 'Nothing to populate'
                  : 'Populate failed'}
            </p>
            {populateStatus.message && <p>{populateStatus.message}</p>}
            {populateStatus.summary.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {populateStatus.summary.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
            {populateStatus.kind === 'success' && (
              <p className="mt-1.5 text-wm-text-muted">
                Review the anchors and roles below, then Save to persist.
              </p>
            )}
          </div>
        )}

        <div className="space-y-5">
          <BrandAnchorsSection spec={spec} onChange={update} />
          <RoleAnchorsSection spec={spec} onChange={update} />
          <TonalPreviewSection spec={spec} />
          <TypographySection spec={spec} onChange={update} />
          <SpacingSection spec={spec} onChange={update} />
          <RadiusSection spec={spec} onChange={update} />
          <FigmaStyleGuideSection projectId={project.id} spec={spec} onChange={update} onAutoSave={autoSave} />
          <OrganizedImagesFolderSection spec={spec} onAutoSave={autoSave} />
          <FigmaPluginGeneratorSection project={project} spec={spec} />
        </div>
      </div>
    </div>
  )
}

// ── Brand anchors ───────────────────────────────────────────────────

function BrandAnchorsSection({
  spec, onChange,
}: { spec: DesignSystemSpec; onChange: (s: DesignSystemSpec) => void }) {
  const setAnchor = (idx: number, patch: Partial<BrandAnchor>) => {
    const next = [...spec.brand_anchors]
    next[idx] = { ...next[idx], ...patch }
    onChange({ ...spec, brand_anchors: next })
  }
  const addAnchor = () => {
    const baseId = `color-${spec.brand_anchors.length + 1}`
    onChange({
      ...spec,
      brand_anchors: [
        ...spec.brand_anchors,
        { id: baseId, name: 'New color', hex: '#888888' },
      ],
    })
  }
  const removeAnchor = (idx: number) => {
    const removed = spec.brand_anchors[idx]
    // Also clear any role-shade slot that pointed at this anchor.
    const nextMatrix: RoleShadeMatrix = {}
    for (const role of ACSS_ROLES) {
      const shadeMap = spec.role_shades[role]
      if (!shadeMap) { nextMatrix[role] = {}; continue }
      const cleaned: Partial<Record<AcssShadeStep, string>> = {}
      for (const [step, anchorId] of Object.entries(shadeMap)) {
        if (anchorId && anchorId !== removed?.id) cleaned[step as AcssShadeStep] = anchorId
      }
      nextMatrix[role] = cleaned
    }
    onChange({
      ...spec,
      brand_anchors: spec.brand_anchors.filter((_, i) => i !== idx),
      role_shades: nextMatrix,
    })
  }

  return (
    <Section title="Brand anchors" icon={<Palette size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Canonical named colors from the brand guide. Pure inputs — names and
        hexes only. ACSS tokens materialize when you place an anchor into a
        role × shade slot below.
      </p>
      <div className="space-y-2">
        {spec.brand_anchors.map((anchor, idx) => (
          <div key={idx} className="flex items-center gap-2 group/row">
            <input
              type="color"
              value={anchor.hex}
              onChange={(e) => setAnchor(idx, { hex: e.target.value })}
              className="w-10 h-9 rounded-md border border-wm-border cursor-pointer overflow-hidden"
              aria-label="Color picker"
            />
            <input
              type="text"
              value={anchor.name}
              onChange={(e) => setAnchor(idx, { name: e.target.value })}
              placeholder="Display name (e.g., Oxblood)"
              className="flex-1 min-w-0 text-[13px] px-2.5 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
            />
            <input
              type="text"
              value={anchor.hex.toUpperCase()}
              onChange={(e) => setAnchor(idx, { hex: e.target.value })}
              className="w-28 text-[12px] font-mono px-2.5 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => removeAnchor(idx)}
              className="h-8 w-8 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-danger-bg hover:text-wm-danger opacity-0 group-hover/row:opacity-100 transition-opacity"
              title="Remove anchor"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <WMButton variant="secondary" size="sm" iconLeft={<Plus size={11} />} onClick={addAnchor}>
          Add color
        </WMButton>
      </div>
    </Section>
  )
}

// ── Role anchors ───────────────────────────────────────────────────

const ROLE_HINTS: Record<AcssRole, string> = {
  primary:   'Headlines, primary CTAs, focus accents',
  secondary: 'Supporting CTAs, secondary brand voice',
  tertiary:  'Optional third brand voice — leave empty if unused',
  accent:    '"One fun accent" — warm signature pop',
  action:    'Conversion CTAs distinct from the primary brand color',
  base:      'LIGHT neutral — page background scale (cream, off-white)',
  neutral:   'MID neutral — UI chrome, borders, dividers (often gray)',
  shade:     'DARK neutral — body text, shadows, overlays, deep dark surfaces',
}

function RoleAnchorsSection({
  spec, onChange,
}: { spec: DesignSystemSpec; onChange: (s: DesignSystemSpec) => void }) {
  const setRoleAnchor = (role: AcssRole, anchorId: string | null) => {
    const next: RoleShadeMatrix = { ...spec.role_shades }
    const shadeMap = { ...(next[role] ?? {}) }
    if (anchorId) shadeMap.medium = anchorId
    else delete shadeMap.medium
    next[role] = shadeMap
    onChange({ ...spec, role_shades: next })
  }

  return (
    <Section title="Role anchors" icon={<Palette size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Pick one brand anchor per ACSS role. The app auto-generates the
        7-step shade scale from each anchor and exports tokens for both
        Figma (Tokens Studio JSON) and Bricks (ACSS Pro GVM JSON).
      </p>
      <div className="mb-3 rounded-md border border-wm-border bg-wm-bg-hover px-3 py-2 text-[11px] text-wm-text-muted leading-relaxed">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
          About the three neutral roles
        </p>
        <p>
          <span className="font-semibold text-wm-text">base</span> · <span className="font-semibold text-wm-text">neutral</span> · <span className="font-semibold text-wm-text">shade</span> each
          anchor on a different lightness range. Pick a <span className="font-semibold">light</span> color
          (cream / off-white) for <span className="font-mono">base</span>, a <span className="font-semibold">mid gray</span> for{' '}
          <span className="font-mono">neutral</span>, and a <span className="font-semibold">near-black</span> for{' '}
          <span className="font-mono">shade</span>. ACSS emits all 7 shades for each role, but
          typical use stays inside each role's natural range — dark backgrounds pull
          from <span className="font-mono">shade-*</span>, body text usually pulls from <span className="font-mono">shade</span>, light surfaces
          from <span className="font-mono">base-*</span>.
        </p>
      </div>
      {spec.brand_anchors.length === 0 ? (
        <p className="text-[12px] text-wm-text-subtle italic">
          Add at least one brand anchor above to assign roles.
        </p>
      ) : (
        <div className="space-y-2">
          {ACSS_ROLES.map(role => {
            const anchorId = spec.role_shades[role]?.medium
            const anchor = anchorId ? spec.brand_anchors.find(a => a.id === anchorId) : undefined
            return (
              <div key={role} className="flex items-center gap-3 px-3 py-2 rounded-md border border-wm-border bg-wm-bg-elevated">
                <div className="min-w-0 w-40 shrink-0">
                  <div className="text-[11px] uppercase tracking-widest font-bold text-wm-accent-strong">
                    {role}
                  </div>
                  <div className="text-[10px] text-wm-text-muted truncate">
                    {ROLE_HINTS[role]}
                  </div>
                </div>
                <select
                  value={anchorId ?? ''}
                  onChange={(e) => setRoleAnchor(role, e.target.value || null)}
                  className={[
                    'w-56 text-[12px] px-2 py-1 rounded border bg-wm-bg-elevated focus:outline-none focus:border-wm-accent',
                    anchor ? 'border-wm-accent/40' : 'border-wm-border',
                  ].join(' ')}
                  title={anchor ? `${anchor.name} (${anchor.hex.toUpperCase()})` : 'Unset'}
                >
                  <option value="">— Unset —</option>
                  {spec.brand_anchors.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                {/* Generated 7-step preview strip — the anchor's natural
                    slot is highlighted with a top accent stripe so the
                    designer sees where their picked color lives. */}
                <div className="flex items-center gap-0.5 flex-1 min-w-0">
                  {anchor
                    ? (() => {
                        const scale = generateAcssShades(anchor.hex)
                        const anchorSlot = anchorShadeStep(anchor.hex)
                        return ACSS_SHADE_STEPS.map(step => {
                          const shade = scale[step]
                          const isAnchor = step === anchorSlot
                          return (
                            <div
                              key={step}
                              className={[
                                'flex-1 h-7 first:rounded-l last:rounded-r border-y border-wm-border first:border-l last:border-r relative',
                                isAnchor ? 'ring-2 ring-wm-accent ring-inset' : '',
                              ].join(' ')}
                              style={{ background: shade.hex }}
                              title={isAnchor
                                ? `${role}-${step} · ${shade.hex.toUpperCase()} · ${anchor.name} (anchor)`
                                : `${role}-${step} · ${shade.hex.toUpperCase()} · L=${Math.round(shade.l)}`}
                            >
                              {isAnchor && (
                                <span
                                  className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-wm-accent-strong leading-none"
                                  style={{ color: shade.l > 60 ? '#341756' : '#FFFFFF' }}
                                >
                                  ✦
                                </span>
                              )}
                            </div>
                          )
                        })
                      })()
                    : (
                      <span className="text-[10px] text-wm-text-subtle italic">
                        Pick an anchor to preview the generated shade scale.
                      </span>
                    )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ── Tonal preview ───────────────────────────────────────────────────
//
// Compact preview of the role × shade grid: shows the colors the
// export will actually emit, in ACSS shade order.

function TonalPreviewSection({ spec }: { spec: DesignSystemSpec }) {
  const filledRoles = useMemo(() => {
    return ACSS_ROLES
      .map(role => {
        const anchorId = spec.role_shades[role]?.medium
        if (!anchorId) return null
        const anchor = spec.brand_anchors.find(a => a.id === anchorId)
        if (!anchor) return null
        return { role, anchor, scale: generateAcssShades(anchor.hex) }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [spec.role_shades, spec.brand_anchors])

  if (filledRoles.length === 0) return null

  return (
    <Section title="ACSS variable preview" icon={<Palette size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        What both exports will emit — full 7-step shade scale per role,
        generated from the role anchor (HSL stepping at ACSS Pro's standard
        lightness targets: 95 / 85 / 65 / 50 / 35 / 25 / 10).
      </p>
      <div className="space-y-3">
        {filledRoles.map(({ role, anchor, scale }) => (
          <div key={role}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-wm-text-subtle mb-1.5">
              --{role}
              <span className="ml-2 font-normal normal-case tracking-normal text-wm-text-muted">→ {anchor.name}</span>
            </p>
            <div className="flex gap-1 flex-wrap">
              {ACSS_SHADE_STEPS.map(step => {
                const sh = scale[step]
                const tokenName = step === 'medium' ? `--${role}` : `--${role}-${step}`
                return (
                  <div
                    key={step}
                    className="flex flex-col items-center"
                    title={`${tokenName} · ${sh.hex.toUpperCase()} · H${Math.round(sh.h)} S${Math.round(sh.s)} L${Math.round(sh.l)}`}
                  >
                    <div
                      className="w-14 h-10 rounded border border-wm-border"
                      style={{ background: sh.hex }}
                    />
                    <p className="text-[9px] font-mono text-wm-text-subtle mt-0.5 max-w-[60px] truncate">{step}</p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Typography ──────────────────────────────────────────────────────

const TYPOGRAPHY_ROLES: TypographyRole[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'body', 'small', 'eyebrow']

function TypographySection({
  spec, onChange,
}: { spec: DesignSystemSpec; onChange: (s: DesignSystemSpec) => void }) {
  return (
    <Section title="Typography" icon={<Type size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Per-role font sizes (desktop and mobile px). Exported as fluid <code>clamp()</code> values.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <FontField
          label="Heading font"
          value={spec.typography.font_heading}
          resource={spec.typography.heading_resource}
          onChange={(v) => onChange({
            ...spec,
            typography: { ...spec.typography, font_heading: v },
          })}
        />
        <FontField
          label="Body font"
          value={spec.typography.font_body}
          resource={spec.typography.body_resource}
          onChange={(v) => onChange({
            ...spec,
            typography: { ...spec.typography, font_body: v },
          })}
        />
      </div>
      <PxScaleEditor
        labelHead="Role"
        rows={TYPOGRAPHY_ROLES.map(role => ({
          key: role,
          label: role,
          vals: spec.typography.sizes[role],
        }))}
        onChange={(key, vals) => onChange({
          ...spec,
          typography: {
            ...spec.typography,
            sizes: { ...spec.typography.sizes, [key]: vals },
          },
        })}
      />
    </Section>
  )
}

// ── Spacing ─────────────────────────────────────────────────────────

const SPACING_STEPS: SpacingStep[] = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl']

function SpacingSection({
  spec, onChange,
}: { spec: DesignSystemSpec; onChange: (s: DesignSystemSpec) => void }) {
  return (
    <Section title="Spacing" icon={<Move size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Semantic spacing scale (xxs–xxl) with desktop and mobile px. Exported as fluid <code>clamp()</code>.
      </p>
      <PxScaleEditor
        labelHead="Step"
        rows={SPACING_STEPS.map(step => ({
          key: step,
          label: step,
          vals: spec.spacing.steps[step],
        }))}
        onChange={(key, vals) => onChange({
          ...spec,
          spacing: {
            ...spec.spacing,
            steps: { ...spec.spacing.steps, [key as SpacingStep]: vals },
          },
        })}
      />
    </Section>
  )
}

// ── Radius ──────────────────────────────────────────────────────────

function RadiusSection({
  spec, onChange,
}: { spec: DesignSystemSpec; onChange: (s: DesignSystemSpec) => void }) {
  const setRadius = (key: 'sm' | 'md' | 'lg', vals: { desktop: number; mobile: number }) => {
    onChange({ ...spec, radius: { ...spec.radius, [key]: vals } })
  }
  return (
    <Section title="Border radius" icon={<Square size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Role-based radius scale. Per design-system-builder skill: never t-shirt sized.
      </p>
      <PxScaleEditor
        labelHead="Token"
        rows={[
          { key: 'sm', label: 'sm · buttons / inputs',          vals: spec.radius.sm },
          { key: 'md', label: 'md · cards / content surfaces',  vals: spec.radius.md },
          { key: 'lg', label: 'lg · atmospheric surfaces',      vals: spec.radius.lg },
        ]}
        onChange={(key, vals) => setRadius(key as 'sm' | 'md' | 'lg', vals)}
      />
      <div className="mt-2.5">
        <label className="flex items-center gap-2 text-[12px]">
          <span className="text-wm-text-muted">full · circular / pill (static px)</span>
          <input
            type="number"
            value={spec.radius.full}
            onChange={(e) => onChange({
              ...spec, radius: { ...spec.radius, full: Number(e.target.value) || 9999 },
            })}
            className="w-20 text-[12px] font-mono px-2 py-1 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
          />
        </label>
      </div>
    </Section>
  )
}

// ── Reusable px scale editor ────────────────────────────────────────

interface PxRow { key: string; label: string; vals: { desktop: number; mobile: number } }

function PxScaleEditor({
  labelHead, rows, onChange,
}: {
  labelHead: string
  rows: PxRow[]
  onChange: (key: string, vals: { desktop: number; mobile: number }) => void
}) {
  return (
    <div className="overflow-hidden border border-wm-border rounded-md">
      <table className="w-full text-[12px]">
        <thead className="bg-wm-bg-hover">
          <tr>
            <th className="text-left px-3 py-1.5 font-bold text-[10px] uppercase tracking-widest text-wm-text-subtle">{labelHead}</th>
            <th className="text-right px-3 py-1.5 font-bold text-[10px] uppercase tracking-widest text-wm-text-subtle">Desktop (px)</th>
            <th className="text-right px-3 py-1.5 font-bold text-[10px] uppercase tracking-widest text-wm-text-subtle">Mobile (px)</th>
            <th className="text-left px-3 py-1.5 font-bold text-[10px] uppercase tracking-widest text-wm-text-subtle">Exported value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-wm-border">
          {rows.map(row => (
            <tr key={row.key} className="hover:bg-wm-bg-hover/40">
              <td className="px-3 py-1.5 text-wm-text font-semibold">{row.label}</td>
              <td className="px-3 py-1.5 text-right">
                <input
                  type="number"
                  value={row.vals.desktop}
                  onChange={(e) => onChange(row.key, { ...row.vals, desktop: Number(e.target.value) || 0 })}
                  className="w-20 text-[12px] font-mono px-2 py-0.5 rounded border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none text-right"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <input
                  type="number"
                  value={row.vals.mobile}
                  onChange={(e) => onChange(row.key, { ...row.vals, mobile: Number(e.target.value) || 0 })}
                  className="w-20 text-[12px] font-mono px-2 py-0.5 rounded border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none text-right"
                />
              </td>
              <td className="px-3 py-1.5 font-mono text-[11px] text-wm-text-muted">
                {toClamp(row.vals.desktop, row.vals.mobile)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Figma Style Guide source ───────────────────────────────────────
//
// The project's Figma file holds a local "Style Guide" frame whose
// children are local components for each used Brixies layout. The
// designer follows the documented workflow (detach team-library
// instances → re-componentize locally → drop into one frame), pastes
// the frame's Figma URL here, and the plugin generators below use
// that node id to walk the frame's children by name.
//
// The URL is also useful as-is for handoff to the Figma MCP server
// when an AI agent needs structural access to the Style Guide.

function FigmaStyleGuideSection({
  projectId, spec, onChange, onAutoSave,
}: {
  projectId: string
  spec: DesignSystemSpec
  onChange: (s: DesignSystemSpec) => void
  /** Persist-and-clear-dirty path used by low-friction toggles like
   *  the load checklist below. The URL input + family lists stay on
   *  `onChange` (Save button required) since they're higher-stakes. */
  onAutoSave: (s: DesignSystemSpec) => Promise<void>
}) {
  const binding: FigmaBinding = spec.figma ?? {}
  const [urlDraft, setUrlDraft] = useState(binding.style_guide_url ?? '')
  const [focused, setFocused] = useState(false)

  // Re-sync the draft when the spec reloads externally — unless the
  // designer is actively typing, in which case we leave them alone.
  useEffect(() => {
    if (!focused) setUrlDraft(spec.figma?.style_guide_url ?? '')
  }, [spec.figma?.style_guide_url, focused])

  const parsed = parseFigmaUrl(urlDraft)
  const looksValid = !!parsed.file_key && !!parsed.node_id
  const empty = urlDraft.trim() === ''

  const commit = () => {
    const next = normalizeFigmaBinding({ style_guide_url: urlDraft })
    onChange({ ...spec, figma: next })
  }

  // List the project's used templates so the designer knows what to
  // bring into Figma (with sane counts + family grouping).
  const [used, setUsed] = useState<WebContentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const loadUsed = useCallback(async () => {
    // Design handoff enumerates ACTUAL page implementations + chrome
    // bindings (header/footer/megamenu/offcanvas) — never the curated
    // library wholesale. If a library pick was never placed on a real
    // page, the designer doesn't need to prep it in Figma.
    setLoading(true)
    const { data: sectionRows } = await supabase
      .from('web_sections')
      .select('content_template_id, web_pages!inner(web_project_id)')
      .eq('web_pages.web_project_id', projectId)
      .not('content_template_id', 'is', null)
    const ids = new Set<string>()
    for (const r of (sectionRows ?? []) as Array<{ content_template_id: string | null }>) {
      if (r.content_template_id) ids.add(r.content_template_id)
    }
    const { data: project } = await supabase
      .from('strategy_web_projects')
      .select('primary_header_template_id, primary_footer_template_id, megamenu_template_ids, offcanvas_template_ids')
      .eq('id', projectId)
      .maybeSingle()
    if (project) {
      if (project.primary_header_template_id) ids.add(project.primary_header_template_id)
      if (project.primary_footer_template_id) ids.add(project.primary_footer_template_id)
      for (const id of (project.megamenu_template_ids ?? []) as string[]) ids.add(id)
      for (const id of (project.offcanvas_template_ids ?? []) as string[]) ids.add(id)
    }
    if (ids.size === 0) {
      setUsed([])
      setLoading(false)
      return
    }
    const { data: tpls } = await supabase
      .from('web_content_templates')
      .select('id, layer_name, family, preview_image_url')
      .in('id', [...ids])
      .order('family')
      .order('layer_name')
    setUsed((tpls ?? []) as WebContentTemplate[])
    setLoading(false)
  }, [projectId])
  useEffect(() => { void loadUsed() }, [loadUsed])

  const byFamily = useMemo(() => {
    const m = new Map<string, WebContentTemplate[]>()
    for (const t of used) {
      if (!m.has(t.family)) m.set(t.family, [])
      m.get(t.family)!.push(t)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [used])

  return (
    <Section title="Figma Style Guide source" icon={<Layers size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        One Figma frame this project depends on. Local components inside it
        (named after each Brixies layout) get instantiated by the assembler
        plugins below.
      </p>

      <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3 mb-3">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
          Setup steps (do this in Figma)
        </p>
        <ol className="list-decimal pl-5 space-y-1 text-[12px] text-wm-text-muted">
          <li>Open this project's Figma file (or create a fresh one).</li>
          <li>From the Brixies team library, drag every layout listed below into the file.</li>
          <li>Right-click each → <span className="font-semibold">Detach instance</span>.</li>
          <li>Wrap each detached layout in a new local component
            (<span className="font-mono">Cmd&nbsp;+&nbsp;Opt&nbsp;+&nbsp;K</span>). Name it exactly the layer name
            (e.g. <span className="font-mono">Feature Section 2</span>).</li>
          <li>Drop every new component into one big auto-layout frame named <span className="font-semibold">Style Guide</span>.</li>
          <li>Select that frame → right-click → <span className="font-semibold">Copy link to selection</span>. Paste below.</li>
        </ol>
        <p className="text-[11px] text-wm-text-muted mt-2">
          The plugin uses <span className="font-mono">figma.getNodeByIdAsync</span> against this same file — no team-library
          component keys are needed.
        </p>
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Style Guide frame URL
        </span>
        <input
          type="text"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit() }}
          placeholder="https://www.figma.com/design/<FILEKEY>/<filename>?node-id=…"
          className={[
            'mt-1 w-full text-[12px] font-mono px-2.5 py-1.5 rounded-md border bg-wm-bg-elevated focus:outline-none',
            empty
              ? 'border-wm-border focus:border-wm-accent'
              : looksValid
                ? 'border-wm-success/40 focus:border-wm-success'
                : 'border-wm-danger focus:border-wm-danger',
          ].join(' ')}
        />
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          {empty ? (
            <span className="text-wm-text-subtle italic">Paste the Style Guide frame URL — the parser will pull out the file + node id.</span>
          ) : looksValid ? (
            <>
              <Check size={11} className="text-wm-success" />
              <span className="text-wm-text-muted font-mono">file&nbsp;{parsed.file_key} · node&nbsp;{parsed.node_id}</span>
              {binding.style_guide_url && (
                <a
                  href={binding.style_guide_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-wm-accent-strong hover:underline"
                >
                  <ExternalLink size={10} /> Open in Figma
                </a>
              )}
            </>
          ) : (
            <>
              <AlertCircle size={11} className="text-wm-danger" />
              <span className="text-wm-danger">Couldn't extract a file key + node id from that URL.</span>
            </>
          )}
        </div>
      </label>

      <TemplateLoadChecklist
        loading={loading}
        used={used}
        byFamily={byFamily}
        loadedIds={spec.figma?.loaded_template_ids ?? []}
        onToggle={(id, next) => {
          const current = new Set(spec.figma?.loaded_template_ids ?? [])
          if (next) current.add(id); else current.delete(id)
          void onAutoSave({
            ...spec,
            figma: { ...(spec.figma ?? {}), loaded_template_ids: [...current] },
          })
        }}
        onSetAll={(ids, next) => {
          const current = new Set(spec.figma?.loaded_template_ids ?? [])
          if (next) for (const id of ids) current.add(id)
          else for (const id of ids) current.delete(id)
          void onAutoSave({
            ...spec,
            figma: { ...(spec.figma ?? {}), loaded_template_ids: [...current] },
          })
        }}
      />
    </Section>
  )
}

function TemplateLoadChecklist({
  loading, used, byFamily, loadedIds, onToggle, onSetAll,
}: {
  loading: boolean
  used: WebContentTemplate[]
  byFamily: Array<[string, WebContentTemplate[]]>
  loadedIds: string[]
  onToggle: (id: string, next: boolean) => void
  onSetAll: (ids: string[], next: boolean) => void
}) {
  const loadedSet = useMemo(() => new Set(loadedIds), [loadedIds])
  const loadedCount = used.filter(t => loadedSet.has(t.id)).length

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Templates this project uses ({loading ? '…' : used.length})
        </p>
        {!loading && used.length > 0 && (
          <p className="text-[11px] text-wm-text-muted">
            <span className="font-semibold text-wm-text">{loadedCount}</span> of {used.length} loaded
            {loadedCount > 0 && loadedCount === used.length && (
              <span className="ml-1.5 text-wm-success">· all set</span>
            )}
          </p>
        )}
      </div>
      {loading ? (
        <div className="py-3 grid place-items-center text-wm-text-muted">
          <Loader2 size={14} className="animate-spin" />
        </div>
      ) : used.length === 0 ? (
        <p className="text-[12px] text-wm-text-subtle italic">
          No sections bound yet. Add sections in Pages, then return here.
        </p>
      ) : (
        <div className="space-y-2">
          {byFamily.map(([family, tpls]) => {
            const familyIds = tpls.map(t => t.id)
            const familyLoaded = tpls.filter(t => loadedSet.has(t.id)).length
            const familyState: 'none' | 'partial' | 'all' =
              familyLoaded === 0 ? 'none'
              : familyLoaded === tpls.length ? 'all'
              : 'partial'
            return (
              <div key={family} className="rounded border border-wm-border bg-wm-bg-elevated">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-wm-border/60">
                  <input
                    type="checkbox"
                    checked={familyState === 'all'}
                    ref={(el) => {
                      if (el) el.indeterminate = familyState === 'partial'
                    }}
                    onChange={(e) => onSetAll(familyIds, e.target.checked)}
                    className="accent-wm-accent cursor-pointer"
                    aria-label={`Mark all ${family} templates as loaded`}
                  />
                  <p className="text-[11px] font-semibold text-wm-text">
                    {family}
                  </p>
                  <p className="ml-auto text-[10px] font-mono text-wm-text-subtle">
                    {familyLoaded} / {tpls.length}
                  </p>
                </div>
                <ul className="divide-y divide-wm-border/40">
                  {tpls.map(t => {
                    const checked = loadedSet.has(t.id)
                    return (
                      <li key={t.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-wm-bg-hover/40 transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => onToggle(t.id, e.target.checked)}
                            className="accent-wm-accent cursor-pointer"
                          />
                          <span className={[
                            'text-[11px] font-mono',
                            checked ? 'text-wm-text-subtle line-through' : 'text-wm-text',
                          ].join(' ')}>
                            {t.layer_name}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Figma plugin generators ────────────────────────────────────────
//
// Reads the project's bound Brixies templates + (for Pages) every
// page's sections, emits two paste-into-console plugin scripts:
//
//   • Style Guide — one instance of every used template in a single
//     auto-layout frame grouped by family.
//   • Pages — one frame per project page, sections stacked in
//     sort_order, text populated from each section's field_values.
//
// Both rely on figma_component_key being set on every used template
// (in the Figma Library Bindings section above). Templates without a
// key get skipped at assembly time with a console warning.

function FigmaPluginGeneratorSection({
  project, spec,
}: {
  project: StrategyWebProject
  spec: DesignSystemSpec
}) {
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<{
    templates: WebContentTemplate[]
    pages: Array<{ page: WebPage; sections: Array<{ section: WebSection; template: WebContentTemplate }> }>
    snippetMap: Record<string, string>
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Pages + their sections, ordered.
    const { data: pagesRows } = await supabase
      .from('web_pages')
      .select('*')
      .eq('web_project_id', project.id)
      .eq('archived', false)
      .order('sort_order')
    const pages = (pagesRows ?? []) as WebPage[]
    const pageIds = pages.map(p => p.id)
    const { data: sectionRows } = pageIds.length > 0
      ? await supabase
          .from('web_sections')
          .select('*')
          .in('web_page_id', pageIds)
          .order('sort_order')
      : { data: [] as WebSection[] } as { data: WebSection[] }
    const allSections = (sectionRows ?? []) as WebSection[]

    // Unique template ids across sections + project chrome.
    const usedTemplateIds = new Set<string>()
    for (const s of allSections) {
      if (s.content_template_id) usedTemplateIds.add(s.content_template_id)
    }
    if (project.primary_header_template_id) usedTemplateIds.add(project.primary_header_template_id)
    if (project.primary_footer_template_id) usedTemplateIds.add(project.primary_footer_template_id)
    for (const id of project.megamenu_template_ids ?? []) usedTemplateIds.add(id)
    for (const id of project.offcanvas_template_ids ?? []) usedTemplateIds.add(id)

    const { data: tplRows } = usedTemplateIds.size > 0
      ? await supabase
          .from('web_content_templates')
          .select('*')
          .in('id', [...usedTemplateIds])
      : { data: [] as WebContentTemplate[] } as { data: WebContentTemplate[] }
    const templatesById: Record<string, WebContentTemplate> = {}
    for (const t of (tplRows ?? []) as WebContentTemplate[]) {
      templatesById[t.id] = augmentTemplate(t)
    }

    // Group sections per page with their resolved template.
    const pagesGrouped = pages.map(page => ({
      page,
      sections: allSections
        .filter(s => s.web_page_id === page.id && s.content_template_id && templatesById[s.content_template_id])
        .map(section => ({
          section,
          template: templatesById[section.content_template_id!],
        })),
    }))

    const snippetList = await loadEditorSnippets(project)
    const snippetMap: Record<string, string> = {}
    for (const s of snippetList) snippetMap[s.token] = s.resolvedValue

    setReport({
      templates: Object.values(templatesById),
      pages: pagesGrouped,
      snippetMap,
    })
    setLoading(false)
  }, [project.id, project.primary_header_template_id, project.primary_footer_template_id, project.megamenu_template_ids, project.offcanvas_template_ids])

  useEffect(() => { void load() }, [load])

  const templateRows = useMemo(() => {
    if (!report) return []
    return report.templates.map(toPluginTemplateRow)
  }, [report])

  const styleGuideNodeId = spec.figma?.style_guide_node_id
  const styleGuideFileKey = spec.figma?.file_key

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const projectSlug = (project.church_short_name || project.name || 'project')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  const downloadStyleGuide = () => {
    if (!styleGuideNodeId || templateRows.length === 0) return
    const script = generateStyleGuidePlugin(templateRows, {
      projectName: project.name,
      generatedAt: new Date().toISOString(),
      styleGuideNodeId,
      figmaFileKey: styleGuideFileKey ?? undefined,
    })
    downloadFile(script, `${projectSlug}-style-guide-plugin.js`)
  }

  const downloadPages = () => {
    if (!styleGuideNodeId || !report) return
    const pageData = report.pages.map(({ page, sections }) =>
      buildPageData(page.name, page.slug, sections, report.snippetMap),
    )
    const script = generatePagesPlugin(templateRows, pageData, {
      projectName: project.name,
      generatedAt: new Date().toISOString(),
      styleGuideNodeId,
      figmaFileKey: styleGuideFileKey ?? undefined,
    })
    downloadFile(script, `${projectSlug}-pages-plugin.js`)
  }

  const ready = !!styleGuideNodeId
  const pagesCount = report?.pages.length ?? 0

  return (
    <Section title="Figma plugin scripts" icon={<FileCode size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Scripts you paste into your Figma file's plugin console. They walk
        the Style Guide frame above to find each Brixies layout by name and
        build (1) a side-by-side overview frame and (2) one fully-populated
        frame per project page.
      </p>
      {loading ? (
        <div className="py-6 grid place-items-center text-wm-text-muted">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : (
        <>
          <div className="mb-3 text-[11px] text-wm-text-subtle">
            <span className="font-semibold text-wm-text">{templateRows.length}</span> template{templateRows.length === 1 ? '' : 's'} used
            {report && <span> · {pagesCount} project page{pagesCount === 1 ? '' : 's'}</span>}
            {ready
              ? <span> · <span className="text-wm-success">Style Guide frame bound</span></span>
              : <span> · <span className="text-wm-danger">Style Guide URL missing</span></span>}
          </div>
          {!ready && (
            <div className="mb-3 rounded-md border border-wm-border bg-wm-bg-hover px-3 py-2 text-[11px] text-wm-text-muted">
              Paste the Style Guide frame URL above to enable the assembler downloads.
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <WMButton
              variant="primary"
              size="md"
              iconLeft={<FileText size={13} />}
              onClick={downloadStyleGuide}
              disabled={!ready || templateRows.length === 0}
            >
              Download Style Guide plugin
            </WMButton>
            <WMButton
              variant="primary"
              size="md"
              iconLeft={<FileText size={13} />}
              onClick={downloadPages}
              disabled={!ready || templateRows.length === 0 || pagesCount === 0}
            >
              Download Pages plugin
            </WMButton>
            <WMButton
              variant="ghost"
              size="md"
              iconLeft={<Loader2 size={13} className={loading ? 'animate-spin' : 'hidden'} />}
              onClick={() => void load()}
            >
              Refresh
            </WMButton>
          </div>
        </>
      )}
    </Section>
  )
}

// ── Font field with auto-populated resource link ───────────────────

function FontField({
  label, value, resource, onChange,
}: {
  label: string
  value: string
  resource?: FontResource
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full text-[13px] px-2.5 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
        />
      </label>
      {resource && (
        <div className="mt-1.5 text-[11px] text-wm-text-muted leading-snug">
          {resource.family_name && (
            <p>
              Brand specifies <span className="font-semibold text-wm-text">{resource.family_name}</span>
              {resource.notes ? <span> · {resource.notes}</span> : null}
            </p>
          )}
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            {resource.font_url && (
              <a
                href={resource.font_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-wm-accent-strong hover:underline"
              >
                <ExternalLink size={10} />
                Get web font
              </a>
            )}
            {resource.free_alt_family && (
              <span className="text-wm-text-subtle">
                Free alt: <span className="font-semibold text-wm-text">{resource.free_alt_family}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section card ────────────────────────────────────────────────────

function Section({
  title, icon, children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <WMCard padding="loose">
      <div className="flex items-center gap-2 mb-3 text-wm-accent-strong">
        {icon}
        <h2 className="text-[13px] font-bold uppercase tracking-widest">{title}</h2>
      </div>
      {children}
    </WMCard>
  )
}

// ── Organized images folder ────────────────────────────────────────
//
// A single external URL pointing to the project's prepared imagery —
// Drive, Dropbox, Notion, etc. Shown on both Design Handoff (here) and
// Dev Handoff (via OrganizedImagesFolderCard) so the same link is one
// click away no matter which role opens the workspace.

function OrganizedImagesFolderSection({
  spec, onAutoSave,
}: {
  spec: DesignSystemSpec
  onAutoSave: (s: DesignSystemSpec) => Promise<void>
}) {
  const [draft, setDraft] = useState(spec.organized_images_folder_url ?? '')
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(spec.organized_images_folder_url ?? '')
  }, [spec.organized_images_folder_url, focused])

  const trimmed = draft.trim()
  const looksUrl = /^https?:\/\//i.test(trimmed)

  const commit = () => {
    void onAutoSave({ ...spec, organized_images_folder_url: trimmed || undefined })
  }

  return (
    <Section title="Organized images folder" icon={<FolderOpen size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        One link to the prepared imagery for this project (Drive, Dropbox,
        Notion gallery, etc.). Surfaced on Dev Handoff as well so the same
        URL is one click away no matter who's pulling assets.
      </p>
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Folder URL
        </span>
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit() }}
          placeholder="https://drive.google.com/drive/folders/…"
          className={[
            'mt-1 w-full text-[12px] font-mono px-2.5 py-1.5 rounded-md border bg-wm-bg-elevated focus:outline-none',
            !trimmed
              ? 'border-wm-border focus:border-wm-accent'
              : looksUrl
                ? 'border-wm-success/40 focus:border-wm-success'
                : 'border-wm-danger focus:border-wm-danger',
          ].join(' ')}
        />
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          {!trimmed ? (
            <span className="text-wm-text-subtle italic">
              Paste the folder URL when imagery is organized.
            </span>
          ) : looksUrl ? (
            <a
              href={trimmed}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-wm-accent-strong hover:underline"
            >
              <ExternalLink size={10} /> Open folder
            </a>
          ) : (
            <span className="text-wm-danger">URL must start with http(s)://</span>
          )}
        </div>
      </label>
    </Section>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'token'
}
