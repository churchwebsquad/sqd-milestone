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

import { useEffect, useMemo, useState } from 'react'
import { Cog, Download, FileText, AlertCircle, Globe, Link as LinkIcon, ExternalLink, AlertTriangle } from 'lucide-react'
import { WMButton } from '../Button'
import { WMCard } from '../Card'
import { supabase } from '../../../lib/supabase'
import {
  parseDesignSystemSpec, emptyDesignSystemSpec, toAcssGvmJson,
  ACSS_ROLES,
  type DesignSystemSpec,
} from '../../../lib/designSystemSpec'
import {
  normalizeCtaValue, defaultTargetFor, validateCta, CTA_KIND_LABELS,
} from '../../../lib/cta'
import type {
  StrategyWebProject, WebPage, WebSection, WebContentTemplate,
  WebPageSeo, WebFieldDef, CtaValue,
} from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

interface CtaRow {
  pageId:      string
  pageName:    string
  pageSlug:    string
  sectionId:   string
  sectionLabel: string
  fieldKey:    string
  fieldLabel:  string
  cta:         CtaValue
  /** null when valid, otherwise the validation error message. */
  validationError: string | null
}

interface PageSeoRow {
  pageId:   string
  pageName: string
  pageSlug: string
  seo:      WebPageSeo | null
}

export function DevHandoffWorkspace({ project }: Props) {
  const spec: DesignSystemSpec = useMemo(
    () => parseDesignSystemSpec(project.design_system) ?? emptyDesignSystemSpec(),
    [project.design_system],
  )

  // Load pages + sections + templates so we can extract SEO data
  // per page and walk every CTA slot across the project.
  const [seoRows, setSeoRows] = useState<PageSeoRow[]>([])
  const [ctaRows, setCtaRows] = useState<CtaRow[]>([])
  const [seoCtaLoading, setSeoCtaLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setSeoCtaLoading(true)
      const { data: pageRows } = await supabase
        .from('web_pages')
        .select('id, name, slug, seo')
        .eq('web_project_id', project.id)
        .eq('archived', false)
        .order('sort_order')
      const pages = (pageRows ?? []) as Array<Pick<WebPage, 'id' | 'name' | 'slug' | 'seo'>>

      const pageIds = pages.map(p => p.id)
      let sections: WebSection[] = []
      if (pageIds.length > 0) {
        const { data: secRows } = await supabase
          .from('web_sections')
          .select('*')
          .in('web_page_id', pageIds)
          .order('sort_order')
        sections = (secRows ?? []) as WebSection[]
      }
      const tplIds = Array.from(new Set(
        sections.map(s => s.content_template_id).filter((x): x is string => !!x),
      ))
      const templates: Record<string, WebContentTemplate> = {}
      if (tplIds.length > 0) {
        const { data: tplRows } = await supabase
          .from('web_content_templates')
          .select('id, layer_name, fields, family')
          .in('id', tplIds)
        for (const t of (tplRows ?? []) as WebContentTemplate[]) templates[t.id] = t
      }

      setSeoRows(pages.map(p => ({
        pageId: p.id, pageName: p.name, pageSlug: p.slug, seo: p.seo ?? null,
      })))
      setCtaRows(extractCtaInventory({ pages, sections, templates }))
      setSeoCtaLoading(false)
    })()
  }, [project.id])

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

          {/* ── SEO / AEO / GEO ─────────────────────────────────── */}
          <WMCard padding="loose">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
                  <Globe size={13} />
                  <h2 className="text-[13px] font-bold uppercase tracking-widest">
                    SEO · AEO · GEO export
                  </h2>
                </div>
                <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
                  Page-by-page SEO title + meta description, focus keywords,
                  AEO answer intent + Q&A, and GEO service areas. Authored
                  from the Pages tab's SEO panel. Download as Markdown so
                  the dev team can paste straight into the WordPress page
                  template / Yoast / Rank Math fields.
                </p>
              </div>
              <WMButton
                variant="primary"
                size="md"
                iconLeft={<Download size={13} />}
                onClick={() => downloadSeoMarkdown(projectSlug, project.name, seoRows)}
                disabled={seoRows.length === 0 || seoCtaLoading}
              >
                Download SEO doc
              </WMButton>
            </div>
            {seoCtaLoading ? (
              <p className="text-[12px] text-wm-text-subtle">Loading…</p>
            ) : seoRows.length === 0 ? (
              <p className="text-[12px] text-wm-text-subtle italic">No pages on this project yet.</p>
            ) : (
              <SeoSummaryTable rows={seoRows} />
            )}
          </WMCard>

          {/* ── CTA inventory ────────────────────────────────────── */}
          <WMCard padding="loose">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
                  <LinkIcon size={13} />
                  <h2 className="text-[13px] font-bold uppercase tracking-widest">
                    CTA inventory
                  </h2>
                </div>
                <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
                  Every CTA across the site — page, section, label, and
                  destination URL. Useful for the dev team's button-routing
                  audit and the launch checklist (broken links / missing
                  targets).
                </p>
              </div>
              <WMButton
                variant="primary"
                size="md"
                iconLeft={<Download size={13} />}
                onClick={() => downloadCtaCsv(projectSlug, ctaRows)}
                disabled={ctaRows.length === 0 || seoCtaLoading}
              >
                Download CSV
              </WMButton>
            </div>
            {seoCtaLoading ? (
              <p className="text-[12px] text-wm-text-subtle">Loading…</p>
            ) : ctaRows.length === 0 ? (
              <p className="text-[12px] text-wm-text-subtle italic">No CTAs bound on any section yet.</p>
            ) : (
              <CtaInventoryTable rows={ctaRows} />
            )}
          </WMCard>
        </div>
      </div>
    </div>
  )
}

// ── Sub-views ──────────────────────────────────────────────────────

function SeoSummaryTable({ rows }: { rows: PageSeoRow[] }) {
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-left text-wm-text-subtle">
            <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Page</th>
            <th className="px-2 py-1.5 font-bold uppercase tracking-widest">SEO title</th>
            <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Meta description</th>
            <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Focus / Geo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const s = r.seo?.seo ?? {}
            const g = r.seo?.geo ?? {}
            return (
              <tr key={r.pageId} className="border-t border-wm-border/40 align-top">
                <td className="px-2 py-2">
                  <p className="font-semibold text-wm-text">{r.pageName}</p>
                  <p className="text-[10px] text-wm-text-subtle font-mono">/{r.pageSlug}</p>
                </td>
                <td className="px-2 py-2 text-wm-text max-w-[200px] truncate" title={s.title ?? ''}>
                  {s.title || <span className="text-wm-text-subtle italic">—</span>}
                </td>
                <td className="px-2 py-2 text-wm-text-muted leading-snug max-w-[260px]">
                  {s.meta_description || <span className="text-wm-text-subtle italic">—</span>}
                </td>
                <td className="px-2 py-2 text-wm-text-muted leading-snug max-w-[200px]">
                  {(s.focus_keywords ?? []).slice(0, 3).join(', ')}
                  {(g.service_areas ?? []).length > 0 && (
                    <p className="text-[10px] text-wm-text-subtle mt-0.5">
                      ▸ {g.service_areas?.join(', ')}
                    </p>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CtaInventoryTable({ rows }: { rows: CtaRow[] }) {
  // Group by page for readability.
  const byPage: Record<string, { name: string; slug: string; items: CtaRow[] }> = {}
  for (const r of rows) {
    const grp = byPage[r.pageId] ?? { name: r.pageName, slug: r.pageSlug, items: [] }
    grp.items.push(r)
    byPage[r.pageId] = grp
  }
  const ordered = Object.entries(byPage)
  const brokenCount = rows.filter(r => r.validationError != null).length

  return (
    <div className="space-y-3">
      {/* Summary bar — at-a-glance count of broken links so the dev
          team knows whether the inventory needs cleanup before launch. */}
      {brokenCount > 0 && (
        <div className="rounded-md border border-wm-warn/40 bg-wm-warn-bg px-2.5 py-1.5 text-[11px] text-wm-warn flex items-center gap-1.5">
          <AlertTriangle size={11} />
          <span>
            <span className="font-semibold">{brokenCount}</span> CTA{brokenCount === 1 ? '' : 's'} need
            {brokenCount === 1 ? 's' : ''} attention — broken internal route, missing URL,
            or wrong scheme.
          </span>
        </div>
      )}
      {ordered.map(([pageId, grp]) => (
        <div key={pageId}>
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
            {grp.name} <span className="font-mono text-wm-text-subtle">/{grp.slug}</span> · {grp.items.length}
          </p>
          <ul className="space-y-0.5">
            {grp.items.map((c, idx) => {
              const target = c.cta.target ?? defaultTargetFor(c.cta.kind)
              const broken = c.validationError != null
              return (
                <li
                  key={`${c.sectionId}-${c.fieldKey}-${idx}`}
                  className={[
                    'flex items-start gap-2 text-[11px] rounded-md border bg-wm-bg-elevated px-2 py-1.5',
                    broken ? 'border-wm-warn/40' : 'border-wm-border',
                  ].join(' ')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="font-semibold text-wm-text truncate">
                        {c.cta.label || <span className="italic text-wm-text-subtle">(no label)</span>}
                      </p>
                      <span className="inline-flex shrink-0 items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 bg-lavender-tint text-primary-purple border border-primary-purple/20">
                        {CTA_KIND_LABELS[c.cta.kind]}
                      </span>
                      {target === '_blank' && (
                        <span className="inline-flex shrink-0 items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 bg-wm-bg-hover text-wm-text-subtle border border-wm-border">
                          New tab
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-wm-text-subtle truncate">
                      {c.sectionLabel} · {c.fieldLabel || c.fieldKey}
                    </p>
                    {broken && (
                      <p className="text-[10px] text-wm-warn mt-0.5 inline-flex items-center gap-1">
                        <AlertTriangle size={9} /> {c.validationError}
                      </p>
                    )}
                  </div>
                  <a
                    href={c.cta.url || '#'}
                    target={target}
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-wm-accent-strong hover:underline shrink-0 max-w-[40%] truncate"
                    title={c.cta.url}
                  >
                    {target === '_blank' && <ExternalLink size={9} />}
                    {c.cta.url || <span className="italic text-wm-text-subtle">no url</span>}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

function extractCtaInventory(opts: {
  pages:     Array<Pick<WebPage, 'id' | 'name' | 'slug'>>
  sections:  WebSection[]
  templates: Record<string, WebContentTemplate>
}): CtaRow[] {
  const pageById: Record<string, { name: string; slug: string }> = {}
  for (const p of opts.pages) pageById[p.id] = { name: p.name, slug: p.slug }
  const slugSet = new Set(opts.pages.map(p => p.slug))

  const rows: CtaRow[] = []
  for (const s of opts.sections) {
    const page = pageById[s.web_page_id]
    if (!page) continue
    const template = s.content_template_id ? opts.templates[s.content_template_id] : null
    const sectionLabel = template?.layer_name ?? `Section · ${s.sort_order + 1}`
    const values = (s.field_values ?? {}) as Record<string, unknown>
    walkFieldsForCtas(template?.fields ?? [], values, (entry) => {
      const cta = normalizeCtaValue(entry.rawValue)
      rows.push({
        pageId:          s.web_page_id,
        pageName:        page.name,
        pageSlug:         page.slug,
        sectionId:       s.id,
        sectionLabel,
        fieldKey:        entry.fieldKey,
        fieldLabel:      entry.fieldLabel,
        cta,
        validationError: validateCta(cta, slugSet),
      })
    })
  }
  return rows
}

/** Recursive walker for template field schemas. Calls `onCta` for every
 *  slot of type 'cta' encountered, with the raw bound value from the
 *  section's field_values (including group items). The caller is
 *  responsible for normalizing the raw value via normalizeCtaValue. */
function walkFieldsForCtas(
  fields: WebFieldDef[],
  values: Record<string, unknown>,
  onCta: (entry: { fieldKey: string; fieldLabel: string; rawValue: unknown }) => void,
  pathPrefix: string = '',
  labelPrefix: string = '',
): void {
  for (const f of fields) {
    if (f.kind === 'slot') {
      if (f.type !== 'cta') continue
      onCta({
        fieldKey:   `${pathPrefix}${f.key}`,
        fieldLabel: labelPrefix ? `${labelPrefix} › ${f.layer_name ?? f.key}` : (f.layer_name ?? f.key),
        rawValue:   values[f.key],
      })
      continue
    }
    if (f.kind === 'group') {
      const items = Array.isArray(values[f.key]) ? (values[f.key] as Array<Record<string, unknown>>) : []
      items.forEach((item, idx) => {
        walkFieldsForCtas(
          f.item_schema ?? [],
          item,
          onCta,
          `${pathPrefix}${f.key}.${idx}.`,
          labelPrefix
            ? `${labelPrefix} › ${f.layer_name ?? f.key} #${idx + 1}`
            : `${f.layer_name ?? f.key} #${idx + 1}`,
        )
      })
    }
  }
}

function downloadSeoMarkdown(projectSlug: string, projectName: string, rows: PageSeoRow[]): void {
  const lines: string[] = [
    `# ${projectName} — SEO / AEO / GEO`,
    '',
    `Generated ${new Date().toLocaleString()}.`,
    '',
  ]
  for (const r of rows) {
    lines.push(`## ${r.pageName}`)
    lines.push(`Slug: \`/${r.pageSlug}\``)
    lines.push('')
    const s = r.seo?.seo ?? {}
    const a = r.seo?.aeo ?? {}
    const g = r.seo?.geo ?? {}
    lines.push('### SEO')
    lines.push(`- **Title:** ${s.title ?? '—'}`)
    lines.push(`- **Meta description:** ${s.meta_description ?? '—'}`)
    lines.push(`- **Focus keywords:** ${(s.focus_keywords ?? []).join(', ') || '—'}`)
    if (s.canonical_url) lines.push(`- **Canonical URL:** ${s.canonical_url}`)
    lines.push('')
    if (a.answer_intent || (a.structured_qa ?? []).length > 0) {
      lines.push('### AEO')
      if (a.answer_intent) lines.push(`- **Answer intent:** ${a.answer_intent}`)
      for (const qa of (a.structured_qa ?? [])) {
        lines.push(`- **Q:** ${qa.q}`)
        lines.push(`  **A:** ${qa.a}`)
      }
      lines.push('')
    }
    if ((g.service_areas ?? []).length > 0 || (g.local_keywords ?? []).length > 0 || g.local_landmarks) {
      lines.push('### GEO')
      if ((g.service_areas ?? []).length > 0)  lines.push(`- **Service areas:** ${g.service_areas?.join(', ')}`)
      if ((g.local_keywords ?? []).length > 0) lines.push(`- **Local keywords:** ${g.local_keywords?.join(', ')}`)
      if (g.local_landmarks)                    lines.push(`- **Landmarks / context:** ${g.local_landmarks}`)
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }
  triggerDownload(`${projectSlug}-seo.md`, lines.join('\n'), 'text/markdown')
}

function downloadCtaCsv(projectSlug: string, rows: CtaRow[]): void {
  const cells = (s: string) => `"${s.replace(/"/g, '""')}"`
  const csv: string[] = [
    ['Page', 'Slug', 'Section', 'Field', 'Label', 'Kind', 'URL', 'Target', 'Status']
      .map(cells).join(','),
  ]
  for (const r of rows) {
    const target = r.cta.target ?? defaultTargetFor(r.cta.kind)
    csv.push([
      r.pageName, `/${r.pageSlug}`, r.sectionLabel, r.fieldLabel || r.fieldKey,
      r.cta.label, CTA_KIND_LABELS[r.cta.kind], r.cta.url,
      target === '_blank' ? 'new tab' : 'same tab',
      r.validationError ?? 'ok',
    ].map(cells).join(','))
  }
  triggerDownload(`${projectSlug}-ctas.csv`, csv.join('\n'), 'text/csv')
}

function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
