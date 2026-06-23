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
import { Cog, Download, FileText, AlertCircle, Globe, Link as LinkIcon, ExternalLink, AlertTriangle, FolderOpen, Server, StickyNote } from 'lucide-react'
import { WMButton } from '../Button'
import { WMCard } from '../Card'
import { supabase } from '../../../lib/supabase'
import {
  parseDesignSystemSpec, emptyDesignSystemSpec, toAcssGvmJson,
  generateAcssShades,
  ACSS_ROLES, ACSS_SHADE_STEPS,
  type DesignSystemSpec,
} from '../../../lib/designSystemSpec'
import {
  normalizeCtaValue, defaultTargetFor, validateCta, CTA_KIND_LABELS,
  isButtonShapedSlot,
} from '../../../lib/cta'
import { GLOBAL_FIELDS } from '../../../lib/webSnippets'
import type {
  StrategyWebProject, WebPage, WebSection, WebContentTemplate,
  WebPageSeo, WebFieldDef, CtaValue, WebProjectSnippet,
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
  /** True when this row was extracted from an inline `<a>` / markdown
   *  link inside a body/richtext slot rather than a structured button
   *  slot. Surfaced as a badge in the inventory so the dev team can
   *  audit them alongside button CTAs. */
  isInline?:       boolean
}

interface PageSeoRow {
  pageId:   string
  pageName: string
  pageSlug: string
  seo:      WebPageSeo | null
}

interface DevNotesRow {
  pageId:   string
  pageName: string
  pageSlug: string
  notes:    string
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
  const [devNotesRows, setDevNotesRows] = useState<DevNotesRow[]>([])
  const [snippets, setSnippets] = useState<WebProjectSnippet[]>([])
  const [seoCtaLoading, setSeoCtaLoading] = useState(true)
  // Software-in-use, surfaced from roadmap_state.strategic_goals (Phase 3).
  // Shown prominently at the top so the dev knows what integrations
  // the build has to plug into BEFORE reading the rest.
  const [softwareInUse, setSoftwareInUse]   = useState<{ value: string; status: string } | null>(null)
  // Content collection page 2 form answers — surfaced on Dev Handoff
  // under 'Content Inventory: Technical Details'. The cowork session
  // is keyed on web_project_id; if multiple, take the most recent.
  const [contentSession, setContentSession] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', project.id)
        .maybeSingle()
      const sg = (data as any)?.roadmap_state?.strategic_goals
      const field = sg?.display_and_technical?.software_in_use
      if (field && typeof field.value === 'string' && field.value.trim() && field.status !== 'archived') {
        setSoftwareInUse({ value: field.value, status: field.status ?? 'draft' })
      } else {
        setSoftwareInUse(null)
      }
      // Content collection page 2 — events / sermons / groups / blog /
      // domain / hosting / discipleship-pathway answers the strategist
      // submitted via the cowork form. One row per project; latest
      // wins if there's more than one.
      const { data: cc } = await supabase
        .from('strategy_content_collection_sessions')
        .select('*')
        .eq('web_project_id', project.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setContentSession(cc as Record<string, unknown> | null)
    })()
  }, [project.id])

  useEffect(() => {
    void (async () => {
      setSeoCtaLoading(true)
      const { data: pageRows } = await supabase
        .from('web_pages')
        .select('id, name, slug, seo, dev_notes')
        .eq('web_project_id', project.id)
        .eq('archived', false)
        .order('sort_order')
      const pages = (pageRows ?? []) as Array<Pick<WebPage, 'id' | 'name' | 'slug' | 'seo' | 'dev_notes'>>

      const pageIds = pages.map(p => p.id)
      // Dev handoff enumerates ACTUAL page implementations, not the
      // project's curated_library. Every template the spec references
      // comes from web_sections.content_template_id; library bindings
      // that were never used on a real page don't show up in the
      // handoff doc.
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

      // /staff/* are per-staff bio pages auto-created by the team-link
       // toggle. They share the source-of-truth bio with the parent
       // team section and don't carry their own SEO/AEO/GEO — drop
       // them from the SEO export to keep the dev-facing doc clean.
      setSeoRows(pages
        .filter(p => !p.slug.startsWith('staff/'))
        .map(p => ({
          pageId: p.id, pageName: p.name, pageSlug: p.slug, seo: p.seo ?? null,
        })))
      setCtaRows(extractCtaInventory({ pages, sections, templates }))

      // Snippets — surfaced in Church Settings and used to resolve
      // any CTA whose route is a {{token}} so the dev can see the
      // expansion at a glance.
      const { data: snipRows } = await supabase
        .from('web_project_snippets')
        .select('*')
        .eq('web_project_id', project.id)
        .eq('archived', false)
        .order('token')
      setSnippets((snipRows ?? []) as WebProjectSnippet[])

      setDevNotesRows(
        pages
          .filter(p => typeof p.dev_notes === 'string' && p.dev_notes.trim().length > 0)
          .map(p => ({
            pageId: p.id, pageName: p.name, pageSlug: p.slug,
            notes: (p.dev_notes ?? '').trim(),
          })),
      )
      setSeoCtaLoading(false)
    })()
  }, [project.id])

  // Coverage report — how many roles have a medium anchor set?
  const rolesWithAnchor = useMemo(() => {
    return ACSS_ROLES.filter(r => !!spec.role_shades[r]?.medium)
  }, [spec])

  const projectSlug = (project.church_short_name || project.name || 'project')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  // Token → expansion map. Combines the project's global merge fields
  // (church_name, podcast_*, etc.) with custom web_project_snippets so
  // the CTA inventory can resolve either kind inline.
  const snippetMap = useMemo<Record<string, ResolvedSnippet>>(() => {
    const m: Record<string, ResolvedSnippet> = {}
    for (const g of GLOBAL_FIELDS) {
      m[g.token] = {
        token: g.token,
        label: g.label,
        value: (project[g.column] as string | null) ?? '',
        source: 'global',
      }
    }
    for (const s of snippets) {
      m[s.token] = {
        token: s.token,
        label: s.label,
        value: s.expansion,
        source: 'custom',
        description: s.description,
      }
    }
    return m
  }, [snippets, project])

  // Globals — surfaced standalone in the Church settings card. Reads
  // the project's column values for each global field.
  const globalSnippets = useMemo<ResolvedSnippet[]>(() =>
    GLOBAL_FIELDS.map(g => ({
      token: g.token,
      label: g.label,
      value: (project[g.column] as string | null) ?? '',
      source: 'global' as const,
    })),
  [project])

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
          {/* ── Software in use (from strategic_goals) ─────────── */}
          {softwareInUse && (
            <WMCard padding="loose">
              <div className="flex items-start gap-2.5">
                <Server size={14} className="shrink-0 mt-0.5 text-wm-accent-strong" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-[13px] font-bold uppercase tracking-widest text-wm-accent-strong">Software in use</h2>
                    {softwareInUse.status === 'draft' && (
                      <span className="text-[10px] uppercase tracking-wider text-wm-text-subtle">draft — strategist hasn't approved</span>
                    )}
                  </div>
                  <p className="text-[12px] text-wm-text-muted mb-2 max-w-2xl">
                    Existing tools the dev team has to integrate with. From Discovery; surfaced here so integrations are visible BEFORE you read the rest of the handoff.
                  </p>
                  <p className="text-[12.5px] text-wm-text leading-snug whitespace-pre-wrap break-words">{softwareInUse.value}</p>
                </div>
              </div>
            </WMCard>
          )}

          {/* ── Dev notes per page (moved to top per strategist) ── */}
          <WMCard padding="loose">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
                  <StickyNote size={13} />
                  <h2 className="text-[13px] font-bold uppercase tracking-widest">
                    Dev notes per page
                  </h2>
                </div>
                <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
                  Free-form notes the strategist left at the bottom of each
                  page editor — caveats, special routing, embed quirks,
                  redirects, anything the dev needs to know before building
                  that page. Authored in the Pages tab and rolled up here.
                </p>
              </div>
              <WMButton
                variant="primary"
                size="md"
                iconLeft={<Download size={13} />}
                onClick={() => downloadDevNotesMarkdown(projectSlug, project.name, devNotesRows)}
                disabled={devNotesRows.length === 0 || seoCtaLoading}
              >
                Download notes
              </WMButton>
            </div>
            {seoCtaLoading ? (
              <p className="text-[12px] text-wm-text-subtle">Loading…</p>
            ) : devNotesRows.length === 0 ? (
              <p className="text-[12px] text-wm-text-subtle italic">
                No dev notes yet. Add them at the bottom of each page in the Pages tab.
              </p>
            ) : (
              <DevNotesPerPage rows={devNotesRows} />
            )}
          </WMCard>

          {/* ── Content Inventory: Technical Details ───────────── */}
          {/* Page 2 of the strategist's cowork content-collection form
              (events / sermons / groups / blog / domain / hosting /
              discipleship pathway). All the technical context the dev
              team needs before they bind sections to CMS post types. */}
          <ContentInventoryTechnicalCard session={contentSession} />

          {/* ── Organized images folder ────────────────────────── */}
          {/* Authored on the Design Handoff tab; mirrored here so the dev
              team has the same link one click away without bouncing
              tabs. Read-only view — editing happens on Design. */}
          <WMCard padding="loose">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
                  <FolderOpen size={13} />
                  <h2 className="text-[13px] font-bold uppercase tracking-widest">
                    Organized images folder
                  </h2>
                </div>
                <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
                  Prepared imagery for this build (Drive, Dropbox, Notion).
                  Authored on the Design Handoff tab.
                </p>
              </div>
              {spec.organized_images_folder_url ? (
                <a
                  href={spec.organized_images_folder_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-wm-accent text-white text-[12px] font-semibold px-3 py-1.5 hover:bg-wm-accent-hover transition-colors shrink-0"
                >
                  <ExternalLink size={12} /> Open folder
                </a>
              ) : (
                <span className="text-[11px] text-wm-text-subtle italic shrink-0">
                  Not yet set
                </span>
              )}
            </div>
          </WMCard>

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

          {/* ── ACSS variable preview ──────────────────────────── */}
          <AcssVariablePreviewCard spec={spec} />

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

          {/* ── Church settings (site snippets) ───────────────────── */}
          <ChurchSettingsCard
            snippets={globalSnippets}
            projectSlug={projectSlug}
            loading={seoCtaLoading}
          />

          {/* ── CTA inventory ─────────────────────────────────────── */}
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
                  Every CTA across the site grouped by page. Entries with
                  no URL set are dropped (those are partner placeholders,
                  not real routes). Useful for the dev team's button-
                  routing audit at launch.
                </p>
              </div>
              <WMButton
                variant="primary"
                size="md"
                iconLeft={<Download size={13} />}
                onClick={() => downloadCtaCsv(projectSlug, ctaRows.filter(r => r.cta.url && r.cta.url.trim()))}
                disabled={ctaRows.length === 0 || seoCtaLoading}
              >
                Download CSV
              </WMButton>
            </div>
            {seoCtaLoading ? (
              <p className="text-[12px] text-wm-text-subtle">Loading…</p>
            ) : ctaRows.filter(r => r.cta.url && r.cta.url.trim()).length === 0 ? (
              <p className="text-[12px] text-wm-text-subtle italic">No CTAs with destinations bound yet.</p>
            ) : (
              <CtaInventoryTable
                rows={ctaRows.filter(r => r.cta.url && r.cta.url.trim())}
                snippetMap={snippetMap}
              />
            )}
          </WMCard>

        </div>
      </div>
    </div>
  )
}

// ── Sub-views ──────────────────────────────────────────────────────

/** Per-role ACSS shade preview, dev-handoff edition. Same data the
 *  Design tab's tonal preview shows, but with the hex value rendered
 *  visibly under every swatch (no hover-to-read) and the role's
 *  anchor (medium step) highlighted with a stronger ring + label.
 *  Helps the dev verify what got exported into the GVM JSON without
 *  bouncing back to the Design tab. */
function AcssVariablePreviewCard({ spec }: { spec: DesignSystemSpec }) {
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
    <WMCard padding="loose">
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
          <FileText size={13} />
          <h2 className="text-[13px] font-bold uppercase tracking-widest">
            ACSS variable preview
          </h2>
        </div>
        <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
          The full 7-step shade scale per role — exactly what the ACSS
          JSON exports. Each role's <span className="font-semibold">anchor</span>{' '}
          (the medium step) is the brand color the strategist picked;
          the surrounding shades are HSL-stepped from that anchor at
          ACSS Pro's standard lightness targets (95 / 85 / 65 / 50 /
          35 / 25 / 10).
        </p>
      </div>
      <div className="space-y-4">
        {filledRoles.map(({ role, anchor, scale }) => (
          <div key={role} className="rounded border border-wm-border bg-wm-bg-elevated/40 p-3">
            <div className="flex items-baseline gap-2 mb-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-wm-text">--{role}</p>
              <p className="text-[11px] text-wm-text-muted">→ {anchor.name}</p>
              <p className="ml-auto text-[10.5px] font-mono text-wm-text-subtle">
                anchor {anchor.hex.toUpperCase()}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {ACSS_SHADE_STEPS.map(step => {
                const sh = scale[step]
                const isAnchor = step === 'medium'
                const tokenName = isAnchor ? `--${role}` : `--${role}-${step}`
                return (
                  <div
                    key={step}
                    className={[
                      'flex flex-col items-stretch rounded-md overflow-hidden border',
                      isAnchor
                        ? 'border-wm-accent-strong ring-2 ring-wm-accent-strong/30'
                        : 'border-wm-border',
                    ].join(' ')}
                    style={{ width: 76 }}
                    title={tokenName}
                  >
                    <div className="h-12" style={{ background: sh.hex }} />
                    <div className={[
                      'px-1 py-1 text-center',
                      isAnchor ? 'bg-wm-accent-tint/80' : 'bg-wm-bg-elevated',
                    ].join(' ')}>
                      <p className={[
                        'text-[9px] font-mono uppercase tracking-widest',
                        isAnchor ? 'text-wm-accent-strong font-bold' : 'text-wm-text-subtle',
                      ].join(' ')}>
                        {isAnchor ? 'Anchor' : step}
                      </p>
                      <p className="text-[9.5px] font-mono text-wm-text mt-0.5">{sh.hex.toUpperCase()}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </WMCard>
  )
}

/** Content Inventory: Technical Details card. Surfaces the page-2
 *  cowork content-collection form answers (events / sermons / groups
 *  / blog / domain / hosting / discipleship pathway) for the dev team.
 *  Empty-string + null values are skipped so the dev sees only fields
 *  the strategist actually filled in. */
function ContentInventoryTechnicalCard({ session }: { session: Record<string, unknown> | null }) {
  // Field order + labels for the technical-details rollup. Grouped by
  // CMS post type so the dev can scan event/sermon/group/blog/domain
  // sections without hunting through one long list.
  const groups: Array<{ heading: string; fields: Array<{ key: string; label: string }> }> = [
    { heading: 'Events', fields: [
      { key: 'events_display_preference',        label: 'Display preference' },
      { key: 'events_display_format',            label: 'Display format' },
      { key: 'events_external_url',              label: 'External URL' },
      { key: 'events_wordpress_source_of_truth', label: 'WordPress source of truth' },
      { key: 'events_wordpress_frustration',     label: 'WordPress frustration' },
      { key: 'events_wordpress_recurring_needed',label: 'Recurring events needed?' },
    ]},
    { heading: 'Sermons', fields: [
      { key: 'sermons_display_preference',       label: 'Display preference' },
      { key: 'sermons_external_url',             label: 'External URL' },
      { key: 'sermon_archive_features',          label: 'Archive features' },
      { key: 'sermon_filters_text',              label: 'Filters' },
      { key: 'sermon_youtube_playlist_exists',   label: 'YouTube playlist exists?' },
      { key: 'sermon_youtube_playlist_url',      label: 'YouTube playlist URL' },
    ]},
    { heading: 'Groups', fields: [
      { key: 'groups_display_preference',        label: 'Display preference' },
      { key: 'groups_external_url',              label: 'External URL' },
      { key: 'groups_wordpress_source_of_truth', label: 'WordPress source of truth' },
      { key: 'groups_wordpress_frustration',     label: 'WordPress frustration' },
    ]},
    { heading: 'Blog', fields: [
      { key: 'blog_handling',          label: 'Handling' },
      { key: 'blog_existing_url',      label: 'Existing URL' },
      { key: 'blog_new_description',   label: 'New blog description' },
      { key: 'blog_new_filters',       label: 'Filters' },
    ]},
    { heading: 'Ministries & Discipleship', fields: [
      { key: 'ministries_to_grow',         label: 'Ministries to grow' },
      { key: 'ministries_list_html',       label: 'Ministries list (HTML)' },
      { key: 'discipleship_pathway_html',  label: 'Discipleship pathway (HTML)' },
    ]},
    { heading: 'Site-wide', fields: [
      { key: 'cms_managed_types',                label: 'CMS-managed post types' },
      { key: 'high_maintenance_pages_context',   label: 'High-maintenance pages context' },
      { key: 'merch_store_url',                  label: 'Merch store URL' },
      { key: 'additional_context',               label: 'Additional context' },
    ]},
    { heading: 'Domain & Hosting', fields: [
      { key: 'domain_registrar_url',          label: 'Domain registrar URL' },
      { key: 'domain_credential_method',      label: 'Credential method' },
      { key: 'domain_invite_confirmed',       label: 'Invite confirmed?' },
      { key: 'domain_one_password_invite_url',label: '1Password invite URL' },
      { key: 'hosting_approved',              label: 'Hosting approved?' },
    ]},
  ]

  const fmt = (v: unknown): string | null => {
    if (v == null) return null
    if (typeof v === 'string') return v.trim() || null
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (Array.isArray(v)) return v.length === 0 ? null : v.join(', ')
    return JSON.stringify(v)
  }

  const renderedGroups = session ? groups.map(g => ({
    ...g,
    rows: g.fields
      .map(f => ({ ...f, value: fmt(session[f.key]) }))
      .filter(r => r.value != null),
  })).filter(g => g.rows.length > 0) : []

  return (
    <WMCard padding="loose">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <FileText size={13} />
            <h2 className="text-[13px] font-bold uppercase tracking-widest">
              Content Inventory: Technical Details
            </h2>
          </div>
          <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
            Page-2 answers from the strategist's cowork content-collection
            form. Tells the dev how the church wants events, sermons,
            groups, blog, and domain/hosting set up before any post-type
            wiring begins.
          </p>
        </div>
      </div>
      {!session ? (
        <p className="text-[12px] text-wm-text-subtle italic">
          Content-collection session not started. Have the strategist
          complete page 2 of the Crawl &amp; Inventory workflow.
        </p>
      ) : renderedGroups.length === 0 ? (
        <p className="text-[12px] text-wm-text-subtle italic">
          Session exists but page 2 has no answers yet.
        </p>
      ) : (
        <div className="space-y-4">
          {renderedGroups.map(g => (
            <div key={g.heading} className="rounded border border-wm-border/60 bg-wm-bg-elevated/40 p-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-wm-accent-strong mb-2">{g.heading}</p>
              <dl className="space-y-2">
                {g.rows.map(r => (
                  <div key={r.key} className="grid grid-cols-[160px_1fr] gap-3 items-start">
                    <dt className="text-[11px] font-semibold text-wm-text-muted">{r.label}</dt>
                    <dd className="text-[12px] text-wm-text whitespace-pre-wrap break-words">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </WMCard>
  )
}

function DevNotesPerPage({ rows }: { rows: DevNotesRow[] }) {
  return (
    <ul className="space-y-3">
      {rows.map(r => (
        <li
          key={r.pageId}
          className="rounded-lg border border-wm-border/60 bg-wm-bg-elevated/40 p-3"
        >
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <p className="font-semibold text-wm-text text-[12px]">{r.pageName}</p>
            <p className="text-[10px] text-wm-text-subtle font-mono shrink-0">/{r.pageSlug}</p>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-wm-text-muted m-0">
            {r.notes}
          </pre>
        </li>
      ))}
    </ul>
  )
}

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

function CtaInventoryTable({
  rows, snippetMap,
}: { rows: CtaRow[]; snippetMap: Record<string, ResolvedSnippet> }) {
  const brokenCount = rows.filter(r => r.validationError != null).length

  // Group rows by page (alphabetical by name).  Each page becomes its
  // own header + table so the dev team can step through page-by-page
  // instead of scanning one flat list.
  const byPage = new Map<string, { pageName: string; pageSlug: string; rows: CtaRow[] }>()
  for (const r of rows) {
    const key = r.pageId
    if (!byPage.has(key)) byPage.set(key, { pageName: r.pageName, pageSlug: r.pageSlug, rows: [] })
    byPage.get(key)!.rows.push(r)
  }
  const pages = [...byPage.values()].sort((a, b) => a.pageName.localeCompare(b.pageName))

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

      <div className="space-y-4">
      {pages.map(p => (
        <div key={p.pageSlug} className="rounded border border-wm-border/60 bg-wm-bg-elevated/40 p-3">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="text-[12px] font-bold text-wm-text">{p.pageName}</p>
            <p className="text-[10px] text-wm-text-subtle font-mono">/{p.pageSlug} · {p.rows.length} CTA{p.rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="overflow-x-auto -mx-2">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-left text-wm-text-subtle">
              <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Route</th>
              <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Button label</th>
              <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Kind</th>
              <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Section</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((c, idx) => {
              const target = c.cta.target ?? defaultTargetFor(c.cta.kind)
              const broken = c.validationError != null
              return (
                <tr
                  key={`${c.sectionId}-${c.fieldKey}-${idx}`}
                  className={[
                    'border-t border-wm-border/40 align-top',
                    broken && 'bg-wm-warn-bg/40',
                  ].filter(Boolean).join(' ')}
                >
                  <td className="px-2 py-2 max-w-[280px] align-top">
                    {c.cta.url ? (
                      <a
                        href={c.cta.url}
                        target={target}
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1 font-mono text-wm-accent-strong hover:underline break-all"
                        title={c.cta.url}
                      >
                        {target === '_blank' && <ExternalLink size={9} className="shrink-0 mt-0.5" />}
                        <span className="break-all">{c.cta.url}</span>
                      </a>
                    ) : (
                      <span className="italic text-wm-text-subtle">no url</span>
                    )}
                    {/* Resolved snippet expansion — when the route is a
                        {{token}} or contains tokens, render the expansion
                        right below the raw route so the dev sees the
                        actual destination without a context switch. */}
                    {c.cta.kind === 'snippet' && c.cta.url && (
                      <SnippetRouteResolved url={c.cta.url} snippetMap={snippetMap} />
                    )}
                    {broken && (
                      <p className="text-[10px] text-wm-warn mt-0.5 inline-flex items-start gap-1">
                        <AlertTriangle size={9} className="mt-0.5 shrink-0" /> {c.validationError}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 max-w-[200px] align-top">
                    <p className="text-wm-text break-words" title={c.cta.label}>
                      {c.cta.label || <span className="italic text-wm-text-subtle">(no label)</span>}
                    </p>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 bg-lavender-tint text-primary-purple border border-primary-purple/20">
                      {CTA_KIND_LABELS[c.cta.kind]}
                    </span>
                    {c.isInline && (
                      <span className="ml-1 inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-300/60" title="Embedded link inside body copy, not a structured CTA button">
                        Inline
                      </span>
                    )}
                    {target === '_blank' && (
                      <span className="ml-1 inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 bg-wm-bg-hover text-wm-text-subtle border border-wm-border">
                        New tab
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 max-w-[200px] align-top">
                    <p className="text-wm-text break-words" title={c.sectionLabel}>{c.sectionLabel}</p>
                    {c.fieldLabel && c.fieldLabel !== c.fieldKey && (
                      <p className="text-[10px] text-wm-text-subtle break-words" title={c.fieldLabel}>{c.fieldLabel}</p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
          </div>
        </div>
      ))}
      </div>
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
      if (entry.kind === 'button') {
        const cta = normalizeCtaValue(entry.rawValue)
        rows.push({
          pageId:          s.web_page_id,
          pageName:        page.name,
          pageSlug:        page.slug,
          sectionId:       s.id,
          sectionLabel,
          fieldKey:        entry.fieldKey,
          fieldLabel:      entry.fieldLabel,
          cta,
          validationError: validateCta(cta, slugSet),
        })
        return
      }
      // entry.kind === 'inline' — each inline link inside the body/
      // richtext slot is its own row, sharing the slot's fieldKey but
      // distinguished by `isInline` + index in fieldLabel.
      for (const [idx, link] of entry.inlineLinks.entries()) {
        const cta = normalizeCtaValue({ label: link.label, url: link.url })
        rows.push({
          pageId:          s.web_page_id,
          pageName:        page.name,
          pageSlug:        page.slug,
          sectionId:       s.id,
          sectionLabel,
          fieldKey:        `${entry.fieldKey}.inline.${idx}`,
          fieldLabel:      `${entry.fieldLabel} › inline link${entry.inlineLinks.length > 1 ? ` #${idx + 1}` : ''}`,
          cta,
          validationError: validateCta(cta, slugSet),
          isInline:        true,
        })
      }
    })
  }
  return rows
}

type WalkEntry =
  | { kind: 'button'; fieldKey: string; fieldLabel: string; rawValue: unknown }
  | { kind: 'inline'; fieldKey: string; fieldLabel: string; inlineLinks: Array<{ label: string; url: string }> }

/** Recursive walker for template field schemas. Calls `onCta` for:
 *   - every button-shaped slot (type='cta', or type='text' with scope=
 *     'button', or a text slot labelled like a button), and
 *   - every text/richtext slot whose bound value contains inline anchors
 *     (markdown `[label](url)` or HTML `<a href="…">label</a>`). Each
 *     inline link is surfaced separately so the dev team's CTA audit
 *     catches body-embedded links alongside structured buttons. */
function walkFieldsForCtas(
  fields: WebFieldDef[],
  values: Record<string, unknown>,
  onCta: (entry: WalkEntry) => void,
  pathPrefix: string = '',
  labelPrefix: string = '',
): void {
  for (const f of fields) {
    if (f.kind === 'slot') {
      const fieldKey   = `${pathPrefix}${f.key}`
      const fieldLabel = labelPrefix ? `${labelPrefix} › ${f.layer_name ?? f.key}` : (f.layer_name ?? f.key)
      if (isButtonShapedSlot(f)) {
        onCta({ kind: 'button', fieldKey, fieldLabel, rawValue: values[f.key] })
        continue
      }
      // Text/richtext: scan for inline anchors.
      if (f.type === 'text' || f.type === 'richtext' || f.type === 'url') {
        const raw = values[f.key]
        if (typeof raw === 'string' && raw.length > 0) {
          const inlineLinks = extractInlineLinks(raw)
          if (inlineLinks.length > 0) {
            onCta({ kind: 'inline', fieldKey, fieldLabel, inlineLinks })
          }
        }
      }
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

/** Extract every inline link from a body/richtext value. Supports both:
 *   - HTML anchors: `<a href="url">label</a>` (what the renderer stores
 *     for richtext slots after handoff translation)
 *   - Markdown links: `[label](url)` (what cowork drafts often produce
 *     before the translator's ensureHtml() wraps them)
 *  Whitespace is normalized; empty/blank labels degrade gracefully to
 *  the URL itself so the dev table still has something to show.
 *  Filters out anchors with no href or with `href="#"` since those
 *  aren't actionable destinations the dev team needs to audit. */
function extractInlineLinks(text: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = []
  // 1. HTML <a href="…">label</a> — handles single + double quotes,
  // case-insensitive attribute name, allows other attributes around it.
  const htmlRe = /<a\s+[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = htmlRe.exec(text)) !== null) {
    const url = (m[1] ?? m[2] ?? '').trim()
    if (!url || url === '#') continue
    const label = (m[3] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || url
    out.push({ label, url })
  }
  // 2. Markdown [label](url) — be tolerant of nested brackets in label
  // by using a lazy match; the trailing `)` matches the first close-paren.
  // Skip image-style `![label](url)` (those are media, not links).
  const mdRe = /(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g
  while ((m = mdRe.exec(text)) !== null) {
    const url = (m[3] ?? '').trim()
    if (!url || url === '#') continue
    const label = (m[2] ?? '').replace(/\s+/g, ' ').trim() || url
    out.push({ label, url })
  }
  return out
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

function downloadDevNotesMarkdown(projectSlug: string, projectName: string, rows: DevNotesRow[]): void {
  const lines: string[] = [
    `# ${projectName} — Dev notes per page`,
    '',
    `Per-page notes left by the strategist for the dev team. Pulled from`,
    `\`web_pages.dev_notes\` on ${new Date().toLocaleString()}.`,
    '',
  ]
  for (const r of rows) {
    lines.push(`## ${r.pageName}`)
    lines.push(`Slug: \`/${r.pageSlug}\``)
    lines.push('')
    lines.push(r.notes)
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  triggerDownload(`${projectSlug}-dev-notes.md`, lines.join('\n'), 'text/markdown')
}

function downloadCtaCsv(projectSlug: string, rows: CtaRow[]): void {
  const cells = (s: string) => `"${s.replace(/"/g, '""')}"`
  const csv: string[] = [
    ['Page', 'Slug', 'Section', 'Field', 'Label', 'Kind', 'Source', 'URL', 'Target', 'Status']
      .map(cells).join(','),
  ]
  for (const r of rows) {
    const target = r.cta.target ?? defaultTargetFor(r.cta.kind)
    csv.push([
      r.pageName, `/${r.pageSlug}`, r.sectionLabel, r.fieldLabel || r.fieldKey,
      r.cta.label, CTA_KIND_LABELS[r.cta.kind],
      r.isInline ? 'inline body link' : 'button',
      r.cta.url,
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

// ── Church settings ────────────────────────────────────────────────

/** Unified snippet shape — covers both the project's global merge
 *  fields (church_name, podcast_*, etc.) and the custom rows from
 *  web_project_snippets. Source distinguishes the two when needed. */
interface ResolvedSnippet {
  token:       string
  label:       string
  value:       string
  source:      'global' | 'custom'
  description?: string | null
}

/** Renders the project's GLOBAL merge fields (church_name, address,
 *  social_*, podcast_*, mission_statement, etc.) as a flat snippet
 *  table. The custom web_project_snippets list lives on the Snippets
 *  tab — Dev Handoff shows the canonical project-scoped values the
 *  dev team will wire into WP/ACF. Download JSON is shaped for direct
 *  ingest. */
function ChurchSettingsCard({
  snippets, projectSlug, loading,
}: { snippets: ResolvedSnippet[]; projectSlug: string; loading: boolean }) {
  const ordered = [...snippets].sort((a, b) => a.token.localeCompare(b.token))
  const downloadJson = () => {
    // Shape: { "<token>": { value, label } } — flat key/value so WP /
    // ACF can ingest directly without a post-process step.
    const out: Record<string, { value: string; label: string }> = {}
    for (const s of ordered) {
      out[s.token] = { value: s.value, label: s.label }
    }
    triggerDownload(`${projectSlug}-church-settings.json`, JSON.stringify(out, null, 2), 'application/json')
  }
  return (
    <WMCard padding="loose">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <Globe size={13} />
            <h2 className="text-[13px] font-bold uppercase tracking-widest">Church settings</h2>
          </div>
          <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
            The project's global merge fields — church name, address, socials,
            podcast, mission. Referenced anywhere in body copy or button routes
            as <code className="font-mono text-[11px]">{`{{token}}`}</code>. Download as JSON for direct WP/ACF ingest.
          </p>
        </div>
        <WMButton
          variant="primary"
          size="md"
          iconLeft={<Download size={13} />}
          onClick={downloadJson}
          disabled={ordered.length === 0 || loading}
        >
          Download JSON
        </WMButton>
      </div>
      {loading ? (
        <p className="text-[12px] text-wm-text-subtle">Loading…</p>
      ) : ordered.length === 0 ? (
        <p className="text-[12px] text-wm-text-subtle italic">No global fields set yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-[11.5px] border-collapse">
            <thead>
              <tr className="text-left text-wm-text-subtle">
                <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Token</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Label</th>
                <th className="px-2 py-1.5 font-bold uppercase tracking-widest">Value</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(s => (
                <tr key={s.token} className="border-t border-wm-border/40 align-top">
                  <td className="px-2 py-2 font-mono text-deep-plum whitespace-nowrap">
                    {`{{${s.token}}}`}
                  </td>
                  <td className="px-2 py-2 text-wm-text">{s.label}</td>
                  <td className="px-2 py-2 max-w-[320px]">
                    {s.value
                      ? <span className="font-mono text-[11px] text-wm-text break-all">{s.value}</span>
                      : <span className="italic text-wm-text-subtle">— not set —</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WMCard>
  )
}

/** Renders the resolved value of a snippet-shaped route — e.g. a CTA
 *  with url `{{social_facebook_url}}` shows the actual URL below.
 *  Multi-token routes like `{{base_url}}/contact` are partially
 *  resolved per token. Tokens with no matching snippet (neither global
 *  nor custom) are flagged so the dev sees exactly what's unbound. */
function SnippetRouteResolved({
  url, snippetMap,
}: { url: string; snippetMap: Record<string, ResolvedSnippet> }) {
  const tokenRe = /\{\{\s*([\w.]+)\s*\}\}/g
  const tokens = Array.from(url.matchAll(tokenRe), m => m[1])
  if (tokens.length === 0) return null
  const allBound = tokens.every(t => snippetMap[t]?.value)
  if (allBound) {
    const resolved = url.replace(tokenRe, (_, t) => snippetMap[t]?.value ?? '')
    return (
      <p className="text-[10.5px] text-wm-text-muted mt-1 break-all" title={`Resolved from ${url}`}>
        → <span className="font-mono text-deep-plum">{resolved}</span>
      </p>
    )
  }
  return (
    <ul className="text-[10.5px] text-wm-text-muted mt-1 space-y-0.5">
      {tokens.map((t, i) => {
        const s = snippetMap[t]
        return (
          <li key={`${t}-${i}`} className="break-all">
            <span className="font-mono">{`{{${t}}}`}</span>
            {' → '}
            {s?.value ? (
              <span className="font-mono text-deep-plum">{s.value}</span>
            ) : (
              <span className="text-wm-warn italic">not set</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
