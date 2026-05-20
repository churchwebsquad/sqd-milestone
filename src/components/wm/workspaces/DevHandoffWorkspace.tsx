/**
 * Web Manager — Dev Handoff workspace.
 *
 * The end-of-project deliverable for the WordPress + Bricks + ACSS Pro
 * dev team. Each section below produces a single artifact:
 *
 *   1. ACSS variables  — `<project>-acss-variables.json` (Global
 *      Variable Manager import). Reads the project's design system
 *      spec, generates the full color × shade scale (HSL), typography
 *      clamps, spacing, radius. Devs drag-drop into ACSS Pro GVM.
 *
 *   2. Handoff doc       — (placeholder, future) Markdown doc per the
 *      Dev Handoff SOP skill: sitemap, CTA inventory, ACSS spec,
 *      Brixies inventory, SEO metadata, asset bundle checklist.
 *
 *   3. Asset bundle list — (placeholder, future) Checkbox list of
 *      assets the dev needs from design/content before launch.
 *
 * For now the tab ships with #1 only. The other sections appear as
 * "coming soon" placeholders so the surface is visible end-to-end.
 */

import { useMemo } from 'react'
import { Cog, Download, FileText, AlertCircle } from 'lucide-react'
import { WMButton } from '../Button'
import { WMCard } from '../Card'
import {
  parseDesignSystemSpec, emptyDesignSystemSpec, toAcssGvmJson,
  ACSS_ROLES,
  type DesignSystemSpec,
} from '../../../lib/designSystemSpec'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

export function DevHandoffWorkspace({ project }: Props) {
  const spec: DesignSystemSpec = useMemo(
    () => parseDesignSystemSpec(project.design_system) ?? emptyDesignSystemSpec(),
    [project.design_system],
  )

  // Coverage report — how many roles have a medium anchor set?
  const rolesWithAnchor = useMemo(() => {
    return ACSS_ROLES.filter(r => !!spec.role_shades[r]?.medium)
  }, [spec])

  const projectSlug = (project.church_short_name || project.name || 'project')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  const downloadAcssJson = () => {
    const json = JSON.stringify(toAcssGvmJson(spec), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectSlug}-acss-variables.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const acssReady = rolesWithAnchor.length > 0

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <Cog size={13} />
            <p className="text-[11px] font-bold uppercase tracking-widest">Dev Handoff</p>
          </div>
          <h1 className="text-2xl font-semibold text-wm-text">Developer handoff</h1>
          <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
            Artifacts the WordPress + Bricks + ACSS Pro dev team needs to ship
            the site. Generated from the project's design system, sections,
            and brief.
          </p>
        </header>

        <div className="space-y-5">
          {/* ── ACSS variables export ──────────────────────────── */}
          <WMCard padding="loose">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
                  <FileText size={13} />
                  <h2 className="text-[13px] font-bold uppercase tracking-widest">
                    ACSS Pro variables
                  </h2>
                </div>
                <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
                  JSON file the dev imports into ACSS Pro's Global Variable
                  Manager (Bricks → ACSS → Variables → Import). Contains the
                  full color × shade matrix (HSL components, mirrored alt
                  scheme), fluid typography min/max per H-level, base spacing
                  anchors, and base radius — derived from the Design workspace.
                </p>
              </div>
              <WMButton
                variant="primary"
                size="md"
                iconLeft={<Download size={13} />}
                onClick={downloadAcssJson}
                disabled={!acssReady}
              >
                Download ACSS JSON
              </WMButton>
            </div>

            {acssReady ? (
              <div className="text-[11px] text-wm-text-subtle">
                <span className="font-semibold text-wm-text">{rolesWithAnchor.length}</span> of {ACSS_ROLES.length} roles bound
                <span> · {rolesWithAnchor.join(', ')}</span>
              </div>
            ) : (
              <div className="rounded-md border border-wm-border bg-wm-bg-hover px-3 py-2 text-[12px] text-wm-text-muted flex items-start gap-2">
                <AlertCircle size={13} className="text-wm-warn mt-0.5 shrink-0" />
                <div>
                  No role anchors set yet. Open the <span className="font-semibold">Design</span> tab,
                  add brand anchors, and pick an anchor for at least one role
                  (primary, base, etc.) before exporting.
                </div>
              </div>
            )}

            <details className="mt-3 group">
              <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-wm-text-subtle hover:text-wm-accent-strong">
                How the dev imports this
              </summary>
              <ol className="mt-2 list-decimal pl-5 space-y-1 text-[12px] text-wm-text-muted">
                <li>Open the WordPress site → Bricks Builder → ACSS settings.</li>
                <li>Navigate to <span className="font-mono">Variables → Global Variables Manager</span>.</li>
                <li>Click the <span className="font-semibold">Import</span> button at the top.</li>
                <li>Drag-and-drop the downloaded JSON file into the popup.</li>
                <li>ACSS Pro merges the imported variables on top of the project's existing values. Keys it doesn't recognize are skipped silently.</li>
              </ol>
            </details>
          </WMCard>

          {/* ── Placeholder: full handoff doc ───────────────────── */}
          <WMCard padding="loose">
            <div className="flex items-center gap-2 mb-1 text-wm-text-subtle">
              <FileText size={13} />
              <h2 className="text-[13px] font-bold uppercase tracking-widest">
                Full handoff document <span className="font-normal normal-case tracking-normal text-wm-text-muted">— coming soon</span>
              </h2>
            </div>
            <p className="text-[12px] text-wm-text-muted mt-1">
              Markdown bundle covering sitemap, CTA inventory, Brixies section
              inventory, SEO metadata per page, and asset bundle checklist.
              Generates per the Dev Handoff SOP — wired in a follow-up.
            </p>
          </WMCard>
        </div>
      </div>
    </div>
  )
}
