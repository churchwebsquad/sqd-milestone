/* eslint-disable @typescript-eslint/no-explicit-any */
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

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Cog, Download, FileText, AlertCircle, Globe, Link as LinkIcon, ExternalLink, AlertTriangle, FolderOpen, Loader2, Server, StickyNote } from 'lucide-react'
import { WMButton } from '../Button'
import { WMCard } from '../Card'
import { supabase } from '../../../lib/supabase'
import {
  parseDesignSystemSpec, emptyDesignSystemSpec, toAcssGvmJson,
  generateAcssShades, anchorShadeStep,
  ACSS_ROLES, ACSS_SHADE_STEPS,
  type DesignSystemSpec,
} from '../../../lib/designSystemSpec'
import {
  normalizeCtaValue, defaultTargetFor, validateCta, CTA_KIND_LABELS,
  isButtonShapedSlot,
} from '../../../lib/cta'
import { GLOBAL_FIELDS } from '../../../lib/webSnippets'
import { composeSectionName } from '../../../lib/webSectionRoles'
import { saveFormationPlan, setSchemaOverride, type ContentModelPlan } from '../../../lib/acfFormationPlan'
import {
  buildRedirectDiff, redirectsToCsv, urlToPath,
  type CrawlUrlRow, type SitemapPage, type RedirectCandidate,
} from '../../../lib/urlRedirects'
import type { DiscoverySection, SchemaName } from '../../../lib/acfFormationPlan/types'
import { CANONICAL_SCHEMAS } from '../../../lib/acfFormationPlan/rules'
import { ApprovedSitemapBanner } from '../sitemapReview/ApprovedSitemapBanner'
import {
  aggregateOpenQuestions,
  buildContentImport,
  renderPlanAsMarkdown,
  toAcfJsonSync,
} from '../../../lib/acfFormationPlan/render'
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
  /** Partner-facing section identifier — page name + ordinal + role
   *  label, e.g. "Give · Section 2 · Hero home". This is what reads
   *  naturally in conversation; the technical Brixies layout name
   *  rides alongside as the secondary identifier. */
  sectionLabel: string
  /** The Brixies layout the section is bound to — typically the
   *  template's layer_name (e.g. "Hero Section 12"). When the
   *  designer has set a Style Guide swap, this carries the SWAP
   *  TARGET'S layer name instead so the dev sees the layout the
   *  Figma file actually contains. */
  brixiesLayout: string | null
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
  // URL redirects — crawled URLs that need to be mapped to the new
  // sitemap. Computed client-side from web_project_topics +
  // web_pages; no schema additions needed.
  const [redirectCandidates, setRedirectCandidates] = useState<RedirectCandidate[]>([])
  const [redirectsLoading,   setRedirectsLoading]   = useState(false)
  // Software-in-use, surfaced from roadmap_state.strategic_goals (Phase 3).
  // Shown prominently at the top so the dev knows what integrations
  // the build has to plug into BEFORE reading the rest.
  const [softwareInUse, setSoftwareInUse]   = useState<{ value: string; status: string } | null>(null)
  // Content collection page 2 form answers — surfaced on Dev Handoff
  // under 'Content Inventory: Technical Details'. The cowork session
  // is keyed on web_project_id; if multiple, take the most recent.
  const [contentSession, setContentSession] = useState<Record<string, unknown> | null>(null)

  // Account-level photo library URLs from strategy_account_progress.
  // Two separate fields: the intake-questionnaire photos and the
  // legacy library kept as a fallback when the partner didn't attach
  // anything during Discovery. Both surface as buttons in the Photos
  // section below so the designer can grab whichever is populated.
  const [accountPhotos, setAccountPhotos] = useState<{
    discovery: string | null
    backup:    string | null
  } | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (project.member == null) { setAccountPhotos(null); return }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('strategy_account_progress')
        .select('photos_from_all_in_discovery_form, legacy_photo_library')
        .eq('member', project.member)
        .maybeSingle()
      if (cancelled) return
      const row = data as { photos_from_all_in_discovery_form?: string | null; legacy_photo_library?: string | null } | null
      setAccountPhotos({
        discovery: (row?.photos_from_all_in_discovery_form ?? '').trim() || null,
        backup:    (row?.legacy_photo_library                ?? '').trim() || null,
      })
    })()
    return () => { cancelled = true }
  }, [project.member])

  // Content-model formation plan. Auto-recomputes + persists on every
  // mount so the DevHandoff panel is always a live read of the
  // strategist's current content model (sections, templates, declared
  // content models, discovery answers) with no manual refresh needed.
  // Persists to strategy_web_projects.roadmap_state.content_model_plan
  // so setSchemaOverride can read + mutate it. Open-question answers
  // persist SEPARATELY under .content_model_plan_answers so this
  // recompute never wipes them.
  const [cmStatus, setCmStatus] = useState<'refreshing' | 'live' | 'error'>('refreshing')
  const [cmError,  setCmError]  = useState<string | null>(null)
  const [cmPlan,   setCmPlan]   = useState<ContentModelPlan | null>(null)
  const [cmAnswers, setCmAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    const rs = project.roadmap_state as Record<string, unknown> | null
    // Seed from the persisted plan immediately so the panel doesn't
    // flash blank while the fresh compute runs in the background.
    const existing = rs?.content_model_plan as ContentModelPlan | undefined
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (existing?.schema_version === 1) setCmPlan(existing)

    const persistedAnswers = rs?.content_model_plan_answers as Record<string, string> | undefined
    if (persistedAnswers && typeof persistedAnswers === 'object') setCmAnswers(persistedAnswers)

    // Always recompute + persist so the panel is a live read. skipLlm
    // keeps the cost tight (deterministic rules only); the LLM
    // enrichment path was tied to the retired manual-compute workflow.
    let cancelled = false
    setCmStatus('refreshing')
    setCmError(null)
    void (async () => {
      try {
        const plan = await saveFormationPlan(project.id, supabase, { skipLlm: true })
        if (cancelled) return
        setCmPlan(plan)
        setCmStatus('live')
      } catch (e) {
        if (cancelled) return
        setCmError(e instanceof Error ? e.message : String(e))
        setCmStatus('error')
        console.warn('[DevHandoff] content-model recompute failed:', e)
      }
    })()
    return () => { cancelled = true }
  }, [project.roadmap_state, project.id])

  /** Persist one open-question answer. Writes to
   *  roadmap_state.content_model_plan_answers as a flat
   *  question_id → text map. Survives recomputes because the
   *  analyzer never touches this key. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _saveCmAnswer = async (questionId: string, answer: string) => {
    const next = { ...cmAnswers, [questionId]: answer }
    setCmAnswers(next)
    const { data: row } = await supabase
      .from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', project.id)
      .maybeSingle()
    const rs = ((row as unknown as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state) ?? {}
    const nextRs = { ...rs, content_model_plan_answers: next }
    await supabase
      .from('strategy_web_projects')
      .update({ roadmap_state: nextRs } as never)
      .eq('id', project.id)
  }
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
      // /staff/<name> pages are auto-generated stubs that share the
      // source-of-truth bio with the parent Team Section. Surfacing
      // them across the Dev Handoff (SEO, CTA inventory, URL
      // redirects, dev notes, content model) muddies the doc with N
      // identical rows that the dev can't act on independently. Drop
      // them at the source so downstream slices don't have to repeat
      // the filter.
      const pages = ((pageRows ?? []) as Array<Pick<WebPage, 'id' | 'name' | 'slug' | 'seo' | 'dev_notes'>>)
        .filter(p => !p.slug.startsWith('staff/'))

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
      setCtaRows(extractCtaInventory({
        pages, sections, templates,
        swaps: project.figma_layout_swaps,
      }))

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
          .filter(p => !p.slug.startsWith('staff/'))
          .filter(p => typeof p.dev_notes === 'string' && p.dev_notes.trim().length > 0)
          .map(p => ({
            pageId: p.id, pageName: p.name, pageSlug: p.slug,
            notes: (p.dev_notes ?? '').trim(),
          })),
      )

      // URL redirects — pull every source_page_url from the project's
      // crawl topics and diff against the new sitemap.
      setRedirectsLoading(true)
      const { data: topicRows } = await supabase
        .from('web_project_topics')
        .select('topic_key, topic_label, source_page_urls')
        .eq('web_project_id', project.id)
      const crawlUrls: CrawlUrlRow[] = []
      for (const t of (topicRows ?? []) as Array<{
        topic_key: string; topic_label: string; source_page_urls: string[] | null
      }>) {
        for (const url of t.source_page_urls ?? []) {
          const path = urlToPath(url)
          if (!path) continue
          crawlUrls.push({
            url, path,
            topic_key:   t.topic_key,
            topic_label: t.topic_label,
          })
        }
      }
      const sitemap: SitemapPage[] = pages
        .filter(p => !p.slug.startsWith('staff/'))
        .map(p => ({
          id:               p.id,
          name:             p.name,
          slug:             p.slug,
          nav_group_label:  (p as { nav_group_label?: string | null }).nav_group_label ?? null,
        }))
      setRedirectCandidates(buildRedirectDiff(crawlUrls, sitemap))
      setRedirectsLoading(false)

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
          <div className="mt-3">
            <ApprovedSitemapBanner
              projectId={project.id}
              churchName={project.church_name ?? undefined}
              showAllStatuses
            />
          </div>
        </header>

        <div className="space-y-5">
          {/* Section order (per strategist, 2026-07-02):
              1. Page notes
              2. ACSS details (variables export + preview)
              3. Church settings
              4. Content model + content inventory (+ CTA inventory)
              5. Photos
              6. SEO
              Software in use stays at the very top as a preamble;
              URL Redirects tails at the bottom. */}

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

          {/* ── 1. Page notes ──────────────────────────────────── */}
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

          {/* ── 2. ACSS details — variables export ─────────────── */}
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

          {/* ── ACSS details — variable preview ────────────────── */}
          <AcssVariablePreviewCard spec={spec} />

          {/* ── 3. Church settings (site snippets) ─────────────── */}
          <ChurchSettingsCard
            snippets={globalSnippets}
            projectSlug={projectSlug}
            loading={seoCtaLoading}
          />

          {/* ── 4. Content model + content inventory ───────────── */}
          {/* Content Inventory first — the strategist's cowork
              content-collection form answers (events / sermons /
              groups / blog / domain / hosting / discipleship pathway).
              Then the analyzer's Content Model plan, then CTA inventory.
              Grouped together so the dev sees content shape holistically. */}
          <ContentInventoryTechnicalCard session={contentSession} />

          {/* ── Content model plan (live) ─────────────────────────── */}
          <WMCard padding="loose">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
                  <Cog size={13} />
                  <h2 className="text-[13px] font-bold uppercase tracking-widest">
                    Content model plan
                  </h2>
                </div>
                <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
                  Live read of the strategist's content model, reads every
                  approved page's sections + template field schema and
                  recommends a WordPress content model (CPTs, Options page,
                  ACF field groups, Bricks Nestable vs ACF Flexible Content).
                  Auto-refreshes when you open this tab.
                </p>
              </div>
              <span
                className={
                  'shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ' +
                  (cmStatus === 'refreshing'
                    ? 'bg-wm-accent-tint text-wm-accent-strong'
                    : cmStatus === 'error'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-wm-success-bg text-wm-success')
                }
                title={cmPlan ? `Last synced ${new Date(cmPlan._meta.generated_at).toLocaleString()}` : undefined}
              >
                {cmStatus === 'refreshing' && <><Loader2 size={11} className="animate-spin" /> Refreshing…</>}
                {cmStatus === 'live'       && <><Check      size={11} /> Live</>}
                {cmStatus === 'error'      && <><AlertTriangle size={11} /> Refresh failed</>}
              </span>
            </div>
            {cmStatus === 'error' && cmError && (
              <p className="text-[12px] text-red-600">Error refreshing: {cmError}</p>
            )}
            {cmPlan && (
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
                <CmStat label="Classifications"     value={cmPlan._meta.counts.classifications} />
                <CmStat
                  label="Custom Post Types"
                  value={cmPlan.layer_2_wp_objects.filter(o => o.kind === 'custom_post_type').length}
                />
                <CmStat label="ACF field groups"    value={cmPlan._meta.counts.acf_field_groups} />
                <CmStat label="Low confidence"      value={cmPlan._meta.counts.low_confidence} />
              </div>
            )}
            {cmPlan && <CmDownloadRow plan={cmPlan} answers={cmAnswers} projectSlug={projectSlug} />}
            {cmPlan && <CmPartnerIntentPanel plan={cmPlan} />}
            {cmPlan && (
              <CmConceptsFoundPanel
                plan={cmPlan}
                projectId={project.id}
                onPlanChange={setCmPlan}
              />
            )}
            {cmPlan && <CmWpObjectsPanel plan={cmPlan} />}
          </WMCard>

          {/* ── CTA inventory (part of Content model + inventory) ─── */}
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

          {/* ── 5. Photos — organized images + account photo libraries ── */}
          {/* Three possible sources the designer wants one-click access
              to: the strategist's organized folder (authored on Design
              Handoff), the partner's photos from Discovery, and the
              legacy backup library. Each button only renders when its
              URL is populated so the row stays focused on what actually
              exists for this partner. */}
          <WMCard padding="loose">
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
                <FolderOpen size={13} />
                <h2 className="text-[13px] font-bold uppercase tracking-widest">
                  Photos
                </h2>
              </div>
              <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
                Prepared imagery for this build. The organized folder is
                authored on Design Handoff; the two library links come
                straight from the partner's account.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <PhotoLinkButton
                label="Organized images folder"
                url={spec.organized_images_folder_url ?? null}
                tone="primary"
              />
              <PhotoLinkButton
                label="Photos from Discovery"
                url={accountPhotos?.discovery ?? null}
                tone="secondary"
              />
              <PhotoLinkButton
                label="Photo library backup"
                url={accountPhotos?.backup ?? null}
                tone="secondary"
              />
            </div>
          </WMCard>

          {/* ── 6. SEO / AEO / GEO ─────────────────────────────── */}
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

          <UrlRedirectsCard
            loading={redirectsLoading}
            candidates={redirectCandidates}
            projectSlug={projectSlug}
            sitemapEmpty={seoRows.length === 0}
          />

        </div>
      </div>
    </div>
  )
}

/** URL redirects card — diffs every crawled URL against the new
 *  sitemap and emits a CSV the dev imports into the WP redirect
 *  plugin (Redirection, Rank Math, Yoast). 'Exact' rows aren't real
 *  redirects but stay visible so the dev can confirm nothing moved
 *  silently. */
function UrlRedirectsCard({
  loading, candidates, projectSlug, sitemapEmpty,
}: {
  loading:      boolean
  candidates:   RedirectCandidate[]
  projectSlug:  string
  sitemapEmpty: boolean
}) {
  // Per-row manual mappings. Local-only state for now — the dev edits
  // a row, downloads the CSV with the override applied, imports into
  // the WP redirect plugin. Survives the session; not persisted.
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const setOverride = (fromPath: string, target: string) => {
    setOverrides(prev => {
      const next = { ...prev }
      const trimmed = target.trim()
      if (!trimmed) delete next[fromPath]
      else next[fromPath] = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
      return next
    })
  }
  const counts = useMemo(() => {
    const c = { exact: 0, high: 0, medium: 0, low: 0 }
    for (const r of candidates) c[r.confidence]++
    return c
  }, [candidates])
  const downloadCsv = () => {
    // Apply overrides to the candidates before serializing so the CSV
    // reflects what the dev actually wants to import.
    const merged = candidates.map(c => {
      const override = overrides[c.from_path]
      if (!override) return c
      const slugOnly = override.replace(/^\//, '')
      return {
        ...c,
        to_slug:    slugOnly || null,
        confidence: 'high' as const,
        reason:     `Strategist-mapped (was ${c.confidence === 'low' ? 'unmapped' : c.confidence + ' confidence'})`,
      }
    })
    const csv = redirectsToCsv(merged)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `${projectSlug}-redirects.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  const realRedirects = candidates.filter(c => c.confidence !== 'exact')
  return (
    <WMCard padding="loose">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <LinkIcon size={13} />
            <h2 className="text-[13px] font-bold uppercase tracking-widest">
              URL redirects
            </h2>
          </div>
          <p className="text-[12px] text-wm-text-muted mt-1 max-w-xl">
            Every URL the crawl found vs the new sitemap. Exact matches
            don't need redirects; everything else is a candidate for the
            dev's WP redirect plugin. Low-confidence rows need manual
            mapping before import.
          </p>
        </div>
        {realRedirects.length > 0 && (
          <WMButton
            variant="primary"
            size="md"
            iconLeft={<Download size={13} />}
            onClick={downloadCsv}
          >
            Download CSV
          </WMButton>
        )}
      </div>
      {loading ? (
        <p className="text-[12px] text-wm-text-muted">Computing diff…</p>
      ) : candidates.length === 0 ? (
        <p className="text-[12px] text-wm-text-muted">
          No crawl URLs found — this project may predate the crawl, or
          the partner's site was net-new with no prior URLs to preserve.
        </p>
      ) : sitemapEmpty ? (
        <p className="text-[12px] text-wm-warn-strong">
          {candidates.length} crawled URL{candidates.length === 1 ? '' : 's'} found, but the new sitemap is empty — no approved pages to map to. Approve pages in the Pages workspace first; redirects will populate automatically once a sitemap exists.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px] mb-3">
            <CmStat label="Exact (no redirect)" value={counts.exact} />
            <CmStat label="High confidence"     value={counts.high} />
            <CmStat label="Medium confidence"   value={counts.medium} />
            <CmStat label="Needs manual"        value={counts.low} />
          </div>
          <RedirectTable candidates={candidates} overrides={overrides} onOverride={setOverride} />
        </>
      )}
    </WMCard>
  )
}

function RedirectTable({
  candidates, overrides, onOverride,
}: {
  candidates: RedirectCandidate[]
  /** Per-row manual mappings keyed by `from_path`. Override wins over
   *  the analyzer's `to_slug` so the dev can hand-fix low-confidence
   *  rows in place. */
  overrides:  Record<string, string>
  onOverride: (fromPath: string, nextTarget: string) => void
}) {
  const [showExact, setShowExact] = useState(false)
  const visible = showExact ? candidates : candidates.filter(c => c.confidence !== 'exact')
  const exactCount = candidates.length - candidates.filter(c => c.confidence !== 'exact').length
  return (
    <>
      {exactCount > 0 && (
        <button
          type="button"
          className="text-[11px] text-wm-accent-strong hover:underline mb-2"
          onClick={() => setShowExact(s => !s)}
        >
          {showExact ? 'Hide' : 'Show'} {exactCount} exact match{exactCount === 1 ? '' : 'es'}
        </button>
      )}
      <div className="border border-wm-border rounded-md overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-wm-bg-elevated text-[10px] uppercase tracking-wider text-wm-text-subtle">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">From (crawled)</th>
              <th className="text-left px-3 py-2 font-semibold">To (new) — click to edit</th>
              <th className="text-left px-3 py-2 font-semibold">Topic</th>
              <th className="text-left px-3 py-2 font-semibold w-28">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const override = overrides[r.from_path]
              const effective = override ?? (r.to_slug ? `/${r.to_slug}` : '')
              return (
                <tr
                  key={`${r.from_path}-${i}`}
                  className={`border-t border-wm-border ${
                    r.confidence === 'low'    ? 'bg-wm-warn-bg/40' :
                    r.confidence === 'medium' ? 'bg-wm-bg-hover/40' : ''
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-wm-text break-all">{r.from_path}</td>
                  <td className="px-3 py-2">
                    <RedirectTargetCell
                      candidate={r}
                      value={effective}
                      isOverride={override != null}
                      onChange={(next) => onOverride(r.from_path, next)}
                    />
                  </td>
                  <td className="px-3 py-2 text-wm-text-muted">{r.topic_label}</td>
                  <td className="px-3 py-2">
                    <span className={
                      r.confidence === 'exact'   ? 'inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold bg-wm-success-bg/60 text-wm-success border border-wm-success/30' :
                      r.confidence === 'high'    ? 'inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30' :
                      r.confidence === 'medium'  ? 'inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold bg-wm-bg-elevated text-wm-text border border-wm-border' :
                                                    'inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold bg-wm-warn-bg text-wm-warn-strong border border-wm-warn/40'
                    }>
                      {r.confidence}
                    </span>
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-wm-text-muted italic">
                  Every crawled URL maps to the same path on the new site — no redirects needed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Editable "To (new)" cell. Shows the current target (override or
 *  analyzer suggestion) as text; click reveals an inline input. Empty
 *  + low-confidence rows surface as warning text so the dev can
 *  spot what still needs mapping at a glance. */
function RedirectTargetCell({
  candidate, value, isOverride, onChange,
}: {
  candidate:  RedirectCandidate
  value:      string
  isOverride: boolean
  onChange:   (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) onChange(draft.trim()) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { setEditing(false); if (draft !== value) onChange(draft.trim()) }
          if (e.key === 'Escape') { setEditing(false); setDraft(value) }
        }}
        placeholder="/new-page-slug"
        className="w-full text-[11.5px] font-mono text-wm-text bg-wm-bg border border-wm-accent rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-wm-accent"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-left w-full font-mono text-[11px] break-all hover:bg-wm-bg-hover rounded px-1 py-0.5 group inline-flex items-center gap-1.5"
      title="Click to edit the redirect target"
    >
      {value ? (
        <span className="text-wm-text">{value}</span>
      ) : candidate.confidence === 'low' ? (
        <span className="text-wm-warn-strong italic">needs mapping</span>
      ) : (
        <span className="text-wm-text-subtle italic">click to set</span>
      )}
      {isOverride && (
        <span className="text-[8.5px] uppercase tracking-widest font-bold text-wm-accent-strong bg-wm-accent-tint px-1.5 py-0.5 rounded-full not-italic">
          edited
        </span>
      )}
      <span className="text-[10px] text-wm-text-subtle opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
    </button>
  )
}

/** One photo-source button on the Photos card. When `url` is
 *  populated, renders a labeled pill that opens the link in a new tab;
 *  when null, renders a disabled placeholder with a "Not set" hint so
 *  the designer can see at a glance which sources this partner has
 *  and which are still empty. */
function PhotoLinkButton({
  label, url, tone,
}: {
  label: string
  url:   string | null
  tone:  'primary' | 'secondary'
}) {
  if (url) {
    const cls = tone === 'primary'
      ? 'bg-wm-accent text-white hover:bg-wm-accent-hover'
      : 'bg-wm-bg-elevated border border-wm-border text-wm-text hover:border-wm-accent hover:text-wm-accent-strong'
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold px-3 py-1.5 transition-colors ${cls}`}
      >
        <ExternalLink size={12} /> {label}
      </a>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium px-3 py-1.5 border border-dashed border-wm-border text-wm-text-subtle italic">
      {label} · not set
    </span>
  )
}

function CmStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-wm-bg-elevated border border-wm-border rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-wm-text-subtle">{label}</div>
      <div className="text-[18px] font-bold text-wm-text">{value}</div>
    </div>
  )
}

/** Download row — produces the four artifacts the dev needs in his
 *  WP-build workflow:
 *
 *   1. Markdown handoff   — human-readable structural plan + open
 *                            questions + per-CPT detail
 *   2. Plan JSON          — full raw analyzer output, useful for
 *                            replaying / diffing
 *   3. Content import     — sidecar AI / wp-cli can consume to seed
 *                            WP records after the CPT/Options page
 *                            is registered
 *   4. ACF JSON Sync      — field-group definitions ready to drop
 *                            into wp-content/acf-json/ or paste into
 *                            ACF Pro Tools > Import Field Groups */
function CmDownloadRow({ plan, answers, projectSlug }: { plan: ContentModelPlan; answers: Record<string, string>; projectSlug: string }) {
  const download = (filename: string, mime: string, content: string) => {
    const blob = new Blob([content], { type: mime })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  const base = projectSlug || 'project'
  const btn  = 'inline-flex items-center gap-1.5 text-[11px] font-semibold text-wm-accent-strong border border-wm-border rounded-md px-2.5 py-1.5 hover:bg-wm-accent-tint/40'
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-wm-text-subtle">Downloads</span>
      <button
        type="button"
        className={btn}
        onClick={() => download(`${base}-formation-plan.md`, 'text/markdown', renderPlanAsMarkdown(plan, { sourceHint: `${base}.json`, answers }))}
      ><Download size={11} /> Markdown handoff</button>
      <button
        type="button"
        className={btn}
        onClick={() => download(`${base}-formation-plan.json`, 'application/json', JSON.stringify(plan, null, 2))}
      ><Download size={11} /> Plan JSON</button>
      <button
        type="button"
        className={btn}
        onClick={() => download(`${base}-content-import.json`, 'application/json', JSON.stringify(buildContentImport(plan), null, 2))}
      ><Download size={11} /> Content import JSON</button>
      <button
        type="button"
        className={btn}
        onClick={() => download(`${base}-acf-json-sync.json`, 'application/json', JSON.stringify(toAcfJsonSync(plan), null, 2))}
      ><Download size={11} /> ACF JSON Sync</button>
    </div>
  )
}

/** Open questions panel — surfaces what's blocking the build. Owner-
 *  tagged (Strategist vs McNeel). Each question has an editable
 *  answer textarea that persists to roadmap_state via onSaveAnswer.
 *  Answers flow into the markdown download too. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CmOpenQuestionsPanel({
  plan, answers, onSaveAnswer,
}: {
  plan: ContentModelPlan
  answers: Record<string, string>
  onSaveAnswer: (questionId: string, answer: string) => Promise<void>
}) {
  const all = useMemo(() => aggregateOpenQuestions(plan), [plan])
  if (all.length === 0) return null
  const strategist = all.filter(q => q.owner === 'Strategist')
  const developer  = all.filter(q => q.owner === 'Developer')
  return (
    <div className="mt-5 pt-4 border-t border-wm-border">
      <div className="text-[10px] uppercase tracking-wider text-wm-text-subtle mb-2">Open questions ({all.length})</div>
      <p className="text-[11px] text-wm-text-muted mb-3">Each question has an answer field — type your decision and it persists on the project. Answers flow into the Markdown download.</p>
      {strategist.length > 0 && (
        <div className="mb-4">
          <p className="text-[12px] font-semibold text-wm-text mb-2">For the strategist ({strategist.length}) — content / modelling decisions</p>
          <div className="space-y-2">
            {strategist.map((q, i) => (
              <OpenQuestionRow key={q.id} num={`Q${i + 1}`} q={q} answer={answers[q.id] ?? ''} onSave={onSaveAnswer} />
            ))}
          </div>
        </div>
      )}
      {developer.length > 0 && (
        <div className="mb-3">
          <p className="text-[12px] font-semibold text-wm-text mb-2">For the Developer ({developer.length}) — implementation decisions</p>
          <div className="space-y-2">
            {developer.map((q, i) => (
              <OpenQuestionRow key={q.id} num={`Q${i + 1}`} q={q} answer={answers[q.id] ?? ''} onSave={onSaveAnswer} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OpenQuestionRow({
  num, q, answer, onSave,
}: {
  num:    string
  q:      { id: string; text: string; sources: string[] }
  answer: string
  onSave: (id: string, answer: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(answer)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(answer) }, [answer])
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-2.5">
      <p className="text-[12px] text-wm-text"><strong>{num}.</strong> {q.text}</p>
      <p className="text-[10px] text-wm-text-subtle mt-1">
        Affects: {q.sources.slice(0, 6).map(s => <code key={s} className="text-[10px] mr-1">{s}</code>)}
        {q.sources.length > 6 && <span>(+{q.sources.length - 6} more)</span>}
      </p>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft === answer) return
          setSaving(true)
          await onSave(q.id, draft)
          setSaving(false)
        }}
        placeholder="Type your answer here…"
        rows={2}
        className="mt-2 w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1.5 outline-none focus:border-wm-accent"
      />
      {saving && <p className="text-[10px] text-wm-text-subtle mt-1">Saving…</p>}
      {!saving && answer && draft === answer && <p className="text-[10px] text-wm-success mt-1">✓ Saved</p>}
    </div>
  )
}

/** Order a sample record's entries by the schema's declared order,
 *  then append any auxiliary keys (cta_label, cta_url, cta_kind etc.)
 *  produced by the projection. Mirrors render.ts so the in-app and
 *  markdown views show identical sample shapes. */
function orderedSampleEntries(
  record: Record<string, unknown>,
  schema: string[],
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = []
  const seen = new Set<string>()
  for (const s of schema) {
    if (s in record) { out.push([s, record[s]]); seen.add(s) }
    for (const k of Object.keys(record)) {
      if (seen.has(k)) continue
      if (k === `${s}_label` || k === `${s}_url` || k === `${s}_kind`) {
        out.push([k, record[k]]); seen.add(k)
      }
    }
  }
  // Filter blank auxiliary keys but keep blank schema keys (so the
  // dev sees fields the partner left empty).
  return out.filter(([k, v]) => {
    const isBlank = v == null || (typeof v === 'string' && v.trim() === '')
    if (isBlank && !schema.includes(k)) return false
    return true
  })
}

function renderSampleCell(v: unknown): ReactNode {
  if (v == null) return <em className="text-wm-text-subtle">(blank)</em>
  if (typeof v === 'boolean') return <span className="text-wm-text">{v ? 'Yes' : 'No'}</span>
  if (Array.isArray(v)) return <em className="text-wm-text-subtle">[{v.length} items]</em>
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return <code className="text-[10.5px]">{s.length > 60 ? s.slice(0, 57) + '…' : s}</code>
  }
  const s = String(v).trim()
  if (!s) return <em className="text-wm-text-subtle">(blank)</em>
  const stripped = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^https?:\/\//i.test(stripped)) {
    return <a href={stripped} target="_blank" rel="noopener noreferrer" className="text-wm-accent underline">{stripped.length > 80 ? stripped.slice(0, 77) + '…' : stripped}</a>
  }
  if (stripped.startsWith('mailto:') || stripped.startsWith('tel:')) {
    return <code className="text-[10.5px]">{stripped}</code>
  }
  if (stripped.length > 200) {
    return <span className="text-wm-text">"{stripped.slice(0, 197)}…" <em className="text-wm-text-subtle">({stripped.length} chars total)</em></span>
  }
  return <span className="text-wm-text">"{stripped}"</span>
}

/** Partner-intent panel — surfaces the verbatim Content Collection
 *  answers for events / sermons / groups even when no section on the
 *  site has been bound to them yet. Dev knows what to model toward. */
function CmPartnerIntentPanel({ plan }: { plan: ContentModelPlan }) {
  const cpts = plan.layer_2_wp_objects.filter(o => o.kind === 'custom_post_type')
  const targets = (['event', 'sermon', 'group'] as const).map(slug => {
    const c = cpts.find(o => o.kind === 'custom_post_type' && o.slug === slug)
    if (c?.kind !== 'custom_post_type') return null
    if (!c._content_collection_answers) return null
    const filled = c._content_collection_answers.fields.filter(({ value }) =>
      value != null && String(value).trim() !== '' && String(value).trim() !== '-'
    )
    if (filled.length === 0) return null
    const labelMap: Record<string, string> = { event: 'Events', sermon: 'Sermons', group: 'Groups' }
    return { label: labelMap[slug], filled }
  }).filter(Boolean) as Array<{ label: string; filled: Array<{ field: string; label: string; value: unknown }> }>
  if (targets.length === 0) return null

  return (
    <div className="mt-5 pt-4 border-t border-wm-border">
      <div className="text-[10px] uppercase tracking-wider text-wm-text-subtle mb-1">Partner intent — events / sermons / groups</div>
      <p className="text-[11px] text-wm-text-muted mb-3">
        Verbatim partner answers from the Content Collection form. Surfaces here even when no section on the site has been bound to these concepts yet — so the dev knows what the partner expects.
      </p>
      <div className="space-y-3">
        {targets.map(t => (
          <details key={t.label} className="rounded-md border border-wm-border bg-wm-bg-elevated" open>
            <summary className="px-3 py-2 cursor-pointer text-[12.5px] font-semibold text-wm-text">{t.label}</summary>
            <ul className="border-t border-wm-border/60 px-3 py-2 text-[11.5px] text-wm-text-muted space-y-0.5">
              {t.filled.map(({ field, label, value }) => (
                <li key={field}>
                  <span className="text-wm-text-subtle">{label}:</span>{' '}
                  {Array.isArray(value)
                    ? value.length === 0 ? <em>(empty)</em> : value.map(v => <code key={String(v)} className="text-[10.5px] mr-1">{String(v)}</code>)
                    : typeof value === 'boolean' ? (value ? 'Yes' : 'No')
                    : /^https?:\/\//i.test(String(value)) ? <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-wm-accent underline">{String(value).length > 60 ? String(value).slice(0, 57) + '…' : String(value)}</a>
                    : <span className="text-wm-text">{String(value)}</span>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  )
}

/** "What's sitting here to be organized" — per-section discovery
 *  panel. Groups by PAGE; within each page shows one row per content
 *  section with its heading + item count + schema + sample. Mirrors
 *  the markdown's discovery framing — section-anchored, not CPT-
 *  anchored, so the strategist sees Pastors / Ministry Leaders /
 *  Elders / Board as separate even when they all roll up to the
 *  same suggested staff CPT. */
/** Per-section strategist override control: confirm classification,
 *  change to a different canonical schema, or clear an existing
 *  override. Persists via setSchemaOverride and updates plan state
 *  optimistically. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SchemaOverrideControl({
  section,
  projectId,
  plan,
  onPlanChange,
}: {
  section: DiscoverySection
  projectId: string
  plan: ContentModelPlan
  onPlanChange: (next: ContentModelPlan) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SchemaName | null | '__none__'>(
    section.schema_name ?? '__none__',
  )

  const isOverridden = !!section.schema_override
  const schemaOptions = Object.keys(CANONICAL_SCHEMAS) as SchemaName[]

  async function persist(value: SchemaName | null, clear: boolean) {
    setSaving(true)
    setError(null)
    try {
      const result = await setSchemaOverride({
        webProjectId: projectId,
        sectionId:    section.section_id,
        schemaName:   value,
        userId:       'current-user',  // TODO: thread real userId from auth context
        clear,
      })
      if (!result.ok) throw new Error(result.error)
      // Optimistic local update.
      const nextPlan: ContentModelPlan = JSON.parse(JSON.stringify(plan))
      const target = nextPlan.discovery_sections?.find(s => s.section_id === section.section_id)
      if (target) {
        if (clear) {
          delete target.schema_override
        } else {
          target.schema_name = value
          target.schema_confidence = 'high'
          target.schema_override = {
            schema_name:  value,
            confirmed_at: new Date().toISOString(),
            confirmed_by: 'current-user',
          }
        }
      }
      onPlanChange(nextPlan)
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-1 ml-3 flex items-center gap-2 text-[10.5px]">
        {isOverridden ? (
          <>
            <span className="text-blue-700">✓ override saved</span>
            <button
              type="button"
              className="text-wm-text-subtle underline hover:text-wm-accent"
              onClick={() => persist(null, true)}
              disabled={saving}
            >
              clear
            </button>
            <button
              type="button"
              className="text-wm-text-subtle underline hover:text-wm-accent"
              onClick={() => setOpen(true)}
            >
              change
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="text-wm-text-subtle hover:text-wm-accent underline"
              onClick={() => persist(section.schema_name ?? null, false)}
              disabled={saving || !section.schema_name}
              title={section.schema_name ? 'Confirm this classification' : 'No classification to confirm'}
            >
              confirm
            </button>
            <span className="text-wm-text-subtle">·</span>
            <button
              type="button"
              className="text-wm-text-subtle hover:text-wm-accent underline"
              onClick={() => setOpen(true)}
            >
              change…
            </button>
          </>
        )}
        {error && <span className="text-red-600 ml-2">err: {error}</span>}
      </div>
    )
  }

  return (
    <div className="mt-1 ml-3 flex items-center flex-wrap gap-2 text-[10.5px]">
      <span className="text-wm-text-subtle">change to:</span>
      <select
        value={selected ?? '__none__'}
        onChange={e => setSelected(e.target.value === '__none__' ? '__none__' : e.target.value as SchemaName)}
        className="text-[10.5px] border border-wm-border rounded px-1 py-0.5 bg-white"
      >
        <option value="__none__">(no schema — copy block)</option>
        {schemaOptions.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <button
        type="button"
        className="text-wm-accent underline hover:text-wm-accent disabled:opacity-50"
        disabled={saving}
        onClick={() => persist(selected === '__none__' ? null : selected, false)}
      >
        {saving ? 'saving…' : 'save'}
      </button>
      <button
        type="button"
        className="text-wm-text-subtle underline hover:text-wm-text"
        disabled={saving}
        onClick={() => { setOpen(false); setError(null) }}
      >
        cancel
      </button>
      {error && <span className="text-red-600">err: {error}</span>}
    </div>
  )
}

/** Human-readable "5 min ago" / "2 days ago" relative time. */
function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (!t) return iso
  const seconds = Math.max(0, (Date.now() - t) / 1000)
  if (seconds < 60)    return `${Math.round(seconds)}s ago`
  if (seconds < 3600)  return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CmConceptsFoundPanel({
  plan,
  projectId: _projectId, // eslint-disable-line @typescript-eslint/no-unused-vars
  onPlanChange: _onPlanChange, // eslint-disable-line @typescript-eslint/no-unused-vars
}: {
  plan: ContentModelPlan
  projectId?: string
  onPlanChange?: (next: ContentModelPlan) => void
}) {
  const ds = plan.discovery_sections ?? []
  const options = plan.layer_2_wp_objects.filter(o => o.kind === 'options_page')
  if (ds.length === 0 && options.length === 0) return null

  // Sections in the per-page accordion exclude those already covered
  // by a declared model — those roll up into the
  // DeclaredContentModelsBlock above. When no declared models exist,
  // every section flows through here as before (back-compat for older
  // projects). The strategist's declarations are the canonical group;
  // showing the same section twice (once under its model, once under
  // its page) is duplicate noise.
  const hasDeclaredModels = (plan.declared_content_models?.length ?? 0) > 0
  const unboundSections = hasDeclaredModels
    ? ds.filter(s => !s.declared_content_model)
    : ds

  // Group sections by page slug
  const byPage = new Map<string, typeof ds>()
  for (const s of unboundSections) {
    const list = byPage.get(s.page_slug) ?? []
    list.push(s)
    byPage.set(s.page_slug, list)
  }
  const pagesSorted = [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)

  const targetLabel: Record<string, string> = {
    'individual-page': 'individual detail page per item',
    'flat-list':       'flat list, no individual pages',
    'embed':           'embedded from third-party',
    'external':        'linked out to third-party',
    'mailto':          'mailto contact',
    'unknown':         'strategist confirms',
  }

  // Diagnostic stats for the header. Counts are over all bound rows
  // (the inventory rows are surfaced separately further down).
  const totalBound       = ds.length
  const classifiedBound  = ds.filter(s => s.schema_name).length
  const overriddenBound  = ds.filter(s => s.schema_override).length
  const buildIssueCount  = ds.reduce((sum, s) => sum + (s.build_time_issues?.length ?? 0), 0)
  const upstreamLossCount = ds.reduce((sum, s) => sum + ((s.build_time_issues ?? []).filter(i => i.kind === 'upstream_compression_loss').length), 0)
  const inventoryRows    = (plan as ContentModelPlan & { inventory_discovery?: Array<DiscoverySection> }).inventory_discovery ?? []
  const generatedAt      = plan._meta?.generated_at
  // Strategist-declared content model coverage — distinct model ids
  // touched, total sections bound. Tells the strategist at a glance
  // "of the N sections here, M are explicitly bound to a declared
  // model." Models the strategist hasn't declared yet (the bulk on
  // most projects today) don't appear in this count.
  const declaredModelIds   = new Set<string>()
  let declaredSectionCount = 0
  for (const s of ds) {
    if (s.declared_content_model) {
      declaredModelIds.add(s.declared_content_model.id)
      declaredSectionCount++
    }
  }

  return (
    <div className="mt-5 pt-4 border-t border-wm-border">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-wm-text-subtle">What's sitting here to be organized</div>
        {generatedAt && (
          <div className="text-[9.5px] text-wm-text-subtle font-normal" title={generatedAt}>
            diagnosed {timeAgo(generatedAt)}
          </div>
        )}
      </div>
      {/* Header chips: at-a-glance diagnostic state */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-wm-bg-elevated border border-wm-border text-wm-text-muted">
          {classifiedBound}/{totalBound} classified
        </span>
        {overriddenBound > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700">
            {overriddenBound} strategist override{overriddenBound === 1 ? '' : 's'}
          </span>
        )}
        {declaredModelIds.size > 0 && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full bg-wm-accent-tint border border-wm-accent/40 text-wm-accent-strong"
            title={`Strategist declared ${declaredModelIds.size} content model${declaredModelIds.size === 1 ? '' : 's'} covering ${declaredSectionCount} section${declaredSectionCount === 1 ? '' : 's'}. Sections bound to a declared model show the model name in their header; the analyzer respects per-card bindings (only the bound cards are reflected in the row's counts and sample).`}
          >
            {declaredSectionCount} section{declaredSectionCount === 1 ? '' : 's'} bound to {declaredModelIds.size} declared model{declaredModelIds.size === 1 ? '' : 's'}
          </span>
        )}
        {inventoryRows.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700">
            {inventoryRows.length} inventory concept{inventoryRows.length === 1 ? '' : 's'}
          </span>
        )}
        {buildIssueCount > 0 && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${upstreamLossCount > 0 ? 'bg-red-50 border-red-300 text-red-800' : 'bg-orange-50 border-orange-200 text-orange-700'}`}>
            🔴 {buildIssueCount} build-time issue{buildIssueCount === 1 ? '' : 's'}
            {upstreamLossCount > 0 && ` (${upstreamLossCount} upstream loss${upstreamLossCount === 1 ? '' : 'es'})`}
          </span>
        )}
      </div>
      <p className="text-[13px] text-wm-text mb-4 leading-relaxed">
        Each section on every approved page, with a recommended content
        type and the partner content already filled in. Trivial chrome
        (heros, intros, single-CTA banners) is hidden so this list
        focuses on the sections the dev actually needs to wire up.
      </p>

      {/* Declared content models — the strategist's authoritative groups.
          This is now the sole "what to build" surface on the dev
          handoff. The per-page analyzer view (previously rendered
          below) was removed because it duplicated the declared-model
          view and added noise for sections the strategist had already
          organized. When the strategist hasn't declared anything yet,
          the analyzer's per-page inference still renders as a
          fallback so older projects don't lose their view. */}
      <DeclaredContentModelsBlock plan={plan} />

      {/* Fallback per-page view — ONLY renders when no declared
          models exist. Once the strategist declares at least one,
          the declared-models block above is authoritative and this
          block is hidden entirely. */}
      {(plan.declared_content_models?.length ?? 0) === 0 && (
      <div className="space-y-4">
        {pagesSorted.map(([pageSlug, sections]) => (
          <details key={pageSlug} className="rounded-md border border-wm-border bg-wm-bg-elevated" open>
            <summary className="px-4 py-3 cursor-pointer text-[14px] font-semibold text-wm-text">
              {sections[0]?.page_name ?? pageSlug}
              <code className="text-[12px] text-wm-text-muted ml-2 font-mono">/{pageSlug}</code>
              <span className="ml-2 text-[12px] text-wm-text-muted font-normal">· {sections.length} section{sections.length === 1 ? '' : 's'}</span>
            </summary>
            <div className="border-t border-wm-border/60 px-4 py-3">
              <ul className="space-y-5">
                {sections.map(s => {
                  const suggestedCpt = s.cpt_subroutine_ref
                    ? plan.layer_2_wp_objects.find(o => o.id === s.cpt_subroutine_ref)
                    : null
                  const cptSuggestion = suggestedCpt?.kind === 'custom_post_type' ? suggestedCpt.slug : null
                  const ctx = s.partner_context
                  return (
                    <li key={s.section_id} className="border-l-2 border-wm-border pl-4">
                      {/* Section header — heading prominent. Confidence
                          + confirm/change controls live on the Pages
                          workspace's Content Model panel now (where
                          the strategist owns the model up-front);
                          this page is a read-only handoff for the
                          dev. */}
                      <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1 mb-2">
                        <h4 className="text-[15px] font-bold text-wm-text leading-tight">{s.heading}</h4>
                        {s.declared_content_model && (
                          <span
                            className="inline-flex items-center gap-1.5 text-[11px]"
                            title={
                              s.declared_content_model.item_indices && s.declared_content_model.item_indices_applied === false
                                ? `Strategist scoped to indices ${s.declared_content_model.item_indices.join(', ')} but the analyzer couldn't apply per-card filtering safely (nested-group drilling). Counts below reflect all items, not just the bound subset.`
                                : s.declared_content_model.item_indices
                                  ? `Strategist bound ${s.declared_content_model.item_indices.length} of this section's cards to the model. Counts and sample below are filtered to the bound cards.`
                                  : 'Strategist declared this entire section feeds the model.'
                            }
                          >
                            <span className="text-wm-text-subtle">bound to model</span>
                            <code className="text-[11.5px] font-mono bg-wm-accent text-white px-1.5 py-0.5 rounded">{s.declared_content_model.name}</code>
                            {s.declared_content_model.item_indices && (
                              <span className={`text-[10.5px] ${s.declared_content_model.item_indices_applied === false ? 'text-orange-600' : 'text-wm-text-muted'}`}>
                                {s.declared_content_model.item_indices_applied === false
                                  ? `· ${s.declared_content_model.item_indices.length} card(s) — filter not applied`
                                  : `· ${s.declared_content_model.item_indices.length} of section's cards`}
                              </span>
                            )}
                          </span>
                        )}
                        {s.schema_name && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-wm-text-muted">
                            <span className="text-wm-text-subtle">looks like</span>
                            <code className="text-[11.5px] text-wm-text font-mono bg-wm-bg-hover px-1.5 py-0.5 rounded">{s.schema_name}</code>
                          </span>
                        )}
                        {cptSuggestion && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-wm-text-muted">
                            <span className="text-wm-text-subtle">·</span>
                            <span className="text-wm-text-subtle">suggested CPT</span>
                            <code className="text-[11.5px] text-wm-text font-mono bg-wm-accent-tint text-wm-accent-strong px-1.5 py-0.5 rounded">{cptSuggestion}</code>
                          </span>
                        )}
                      </div>

                      {/* Body: 2-column grid of labeled facts so the dev
                          can scan instead of read a wall of small grey
                          text. Each label is the plain-English question
                          ("How many?", "What fields the partner filled
                          in"), each value is full-contrast wm-text. */}
                      <dl className="grid grid-cols-1 md:grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12.5px]">
                        <dt className="text-wm-text-muted">How many entries</dt>
                        <dd className="text-wm-text">{s.item_count} item{s.item_count === 1 ? '' : 's'}</dd>

                        {s.schema.length > 0 && (
                          <>
                            <dt className="text-wm-text-muted">Fields the partner filled in</dt>
                            <dd className="text-wm-text">
                              {s.schema.slice(0, 12).map((k, i) => (
                                <span key={k}>
                                  {i > 0 && <span className="text-wm-text-subtle mx-1">·</span>}
                                  <code className="text-[12px] font-mono text-wm-text">{k}</code>
                                </span>
                              ))}
                              {s.schema.length > 12 && <span className="text-wm-text-subtle ml-1">· +{s.schema.length - 12} more</span>}
                            </dd>
                          </>
                        )}

                        {s.cta_target_breakdown && Object.keys(s.cta_target_breakdown).length > 0 && (
                          <>
                            <dt className="text-wm-text-muted">Where the buttons link</dt>
                            <dd className="text-wm-text">
                              {Object.entries(s.cta_target_breakdown).map(([kind, n], i) => (
                                <span key={kind}>
                                  {i > 0 && <span className="text-wm-text-subtle mx-1">·</span>}
                                  <span><code className="text-[12px] font-mono text-wm-text">{kind}</code> ({n})</span>
                                </span>
                              ))}
                            </dd>
                          </>
                        )}

                        <dt className="text-wm-text-muted">How visitors reach each entry</dt>
                        <dd className="text-wm-text">{targetLabel[s.target_hint] ?? s.target_hint}</dd>

                        {s.section_role && (
                          <>
                            <dt className="text-wm-text-muted">Brixies section role</dt>
                            <dd><code className="text-[12px] font-mono text-wm-text">{s.section_role}</code></dd>
                          </>
                        )}
                      </dl>

                      {/* Sample record — own block so the dev can study
                          the actual partner content without it being
                          buried in the meta list. */}
                      {s.sample_record && Object.keys(s.sample_record).length > 0 && (
                        <div className="mt-3 rounded-md border border-wm-border/60 bg-wm-bg/40 px-3 py-2">
                          <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">Sample entry — first record</p>
                          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                            {orderedSampleEntries(s.sample_record, s.schema).map(([k, v]) => (
                              <span key={k} className="contents">
                                <dt className="text-wm-text-muted font-mono text-[11.5px]">{k}</dt>
                                <dd className="text-wm-text break-words">{renderSampleCell(v)}</dd>
                              </span>
                            ))}
                          </dl>
                          {s.sample_names.length > 1 && s.item_count > 1 && (
                            <p className="mt-2 pt-2 border-t border-wm-border/40 text-[11.5px] text-wm-text-muted">
                              <span className="text-wm-text-subtle">Other entries: </span>
                              <span className="text-wm-text">{s.sample_names.slice(1).join(' · ')}</span>
                              {s.item_count > s.sample_names.length && <span className="text-wm-text-subtle"> · +{s.item_count - s.sample_names.length} more</span>}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Partner-Content-Collection context — separate
                          callout when present so it stands out from
                          structural facts. */}
                      {ctx && (
                        <div className="mt-3 rounded-md border border-wm-accent/30 bg-wm-accent-tint/30 px-3 py-2">
                          <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1.5">
                            What the partner asked for in Content Collection
                          </p>
                          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
                            {ctx.display_preference && <>
                              <dt className="text-wm-text-muted">Display preference</dt>
                              <dd className="text-wm-text"><code className="text-[12px] font-mono">{ctx.display_preference}</code></dd>
                            </>}
                            {ctx.display_format && <>
                              <dt className="text-wm-text-muted">Display format</dt>
                              <dd className="text-wm-text">{ctx.display_format}</dd>
                            </>}
                            {ctx.external_url && <>
                              <dt className="text-wm-text-muted">{ctx.display_preference === 'embed' || ctx.display_preference === 'external' ? 'Embed / external source' : 'Partner sample URL'}</dt>
                              <dd>
                                <a href={ctx.external_url} target="_blank" rel="noopener noreferrer" className="text-wm-accent-strong underline break-all">
                                  {ctx.external_url.length > 80 ? ctx.external_url.slice(0, 77) + '…' : ctx.external_url}
                                </a>
                              </dd>
                            </>}
                            {ctx.playlist_url && <>
                              <dt className="text-wm-text-muted">YouTube playlist</dt>
                              <dd>
                                <a href={ctx.playlist_url} target="_blank" rel="noopener noreferrer" className="text-wm-accent-strong underline break-all">
                                  {ctx.playlist_url.length > 80 ? ctx.playlist_url.slice(0, 77) + '…' : ctx.playlist_url}
                                </a>
                              </dd>
                            </>}
                            {ctx.archive_features && ctx.archive_features.length > 0 && <>
                              <dt className="text-wm-text-muted">Archive features wanted</dt>
                              <dd className="text-wm-text">{ctx.archive_features.map((f, i) => (
                                <span key={f}>
                                  {i > 0 && <span className="text-wm-text-subtle mx-1">·</span>}
                                  <code className="text-[12px] font-mono">{f}</code>
                                </span>
                              ))}</dd>
                            </>}
                            {ctx.source_of_truth && <>
                              <dt className="text-wm-text-muted">Partner's current system</dt>
                              <dd className="text-wm-text">{ctx.source_of_truth}</dd>
                            </>}
                            {ctx.frustration && ctx.frustration.trim() !== '-' && <>
                              <dt className="text-wm-text-muted">Partner note</dt>
                              <dd className="text-wm-text italic">{ctx.frustration}</dd>
                            </>}
                          </dl>
                        </div>
                      )}

                      {/* Build-time issues + schema-override controls
                          were removed from this surface. The dev
                          handoff is a READ view of finalized models;
                          flagging "field X is missing on this binding"
                          here is too late in the flow — by the time the
                          dev opens this tab, the content model needs
                          should already be locked. The strategist owns
                          the model up-front via the Pages workspace
                          Content Model panel, which is where any
                          confirm / change / merge happens. */}
                    </li>
                  )
                })}
              </ul>
            </div>
          </details>
        ))}
        {options.map(o => {
          if (o.kind !== 'options_page') return null
          const group = plan.layer_3_acf_field_groups.find(g =>
            g.location.some(or => or.some(r => r.param === 'options_page' && r.value === o.slug))
          )
          const row = group?._content_rows?.[0] ?? {}
          const filled = Object.entries(row).filter(([k, v]) => !k.startsWith('_') && v != null && String(v).trim() !== '')
          return (
            <div key={o.id} className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
              <p className="text-[12px] font-semibold text-wm-text">Site-wide globals <span className="text-[10px] font-normal text-wm-text-subtle">(not page-specific)</span></p>
              <p className="text-[10.5px] text-wm-text-muted mt-0.5">Single-source values reused across the site (church name, contact, socials).</p>
              <p className="text-[10.5px] text-wm-text-subtle mt-0.5">
                <strong className="text-wm-text">{filled.length}</strong> value{filled.length === 1 ? '' : 's'} filled in
                {filled.length > 0 && <>: {filled.slice(0, 6).map(([k]) => <code key={k} className="text-[10px] mr-1">{k}</code>)}{filled.length > 6 && <span>+{filled.length - 6}</span>}</>}
              </p>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

/** Strategist's declared content models — the canonical "what is this
 *  partner's site made of" view. Rolls up the section_ids the
 *  strategist bound to each model, shows the model's schema +
 *  cta_target + a sample of bound content. The dev builds from THIS,
 *  not from the analyzer's per-section inference (which lives below
 *  as a fallback). Hidden entirely when the strategist hasn't declared
 *  anything yet — older projects keep their per-page analyzer view as
 *  the only surface, unchanged. */
function DeclaredContentModelsBlock({ plan }: { plan: ContentModelPlan }) {
  const models = plan.declared_content_models ?? []
  if (models.length === 0) return null
  const ds = plan.discovery_sections ?? []
  const sectionsById = new Map(ds.map(s => [s.section_id, s]))

  // Pretty labels for cta_target. 'na' is the explicit "no buttons"
  // choice the strategist makes (vs null = "not decided yet").
  const ctaLabel: Record<string, string> = {
    'internal-page': 'Individual page per entry',
    external:        'External link',
    mailto:          'Email (mailto:)',
    tel:             'Phone (tel:)',
    anchor:          'Anchor on this page',
    na:              'No buttons on this model',
  }

  return (
    <div className="mb-6">
      <h4 className="text-[12px] font-bold text-wm-accent-strong uppercase tracking-wider mb-2">
        Declared content models — strategist's groupings
      </h4>
      <p className="text-[11.5px] text-wm-text-muted mb-3 leading-relaxed">
        Build the WP structure from these. Each card is a content model
        the strategist declared in the Pages workspace, with the
        sections it pulls from rolled up across the site.
      </p>
      <div className="space-y-3">
        {models.map(m => {
          const boundRows = m.section_ids
            .map(id => sectionsById.get(id))
            .filter((s): s is NonNullable<typeof s> => Boolean(s))
          const totalItems = boundRows.reduce((sum, s) => sum + s.item_count, 0)
          // Sample = first bound section's sample_record (already
          // filtered to the bound indices when per-card binding applied
          // — see buildDiscoverySections).
          const firstSample = boundRows.find(s => s.sample_record && Object.keys(s.sample_record).length > 0)
          const sample = firstSample?.sample_record ?? null
          const sampleFields = sample
            ? Object.entries(sample).filter(([, v]) => v != null && String(v).trim() !== '')
            : []
          const ctaText = m.cta_target ? (ctaLabel[m.cta_target] ?? m.cta_target) : 'Strategist confirms later'
          return (
            <details key={m.id} className="rounded-md border-2 border-wm-accent/40 bg-wm-accent-tint/20" open>
              <summary className="px-4 py-3 cursor-pointer flex items-baseline gap-2 flex-wrap">
                <span className="text-[15px] font-bold text-wm-text">{m.name}</span>
                <span className="text-[11.5px] text-wm-text-muted">
                  · {boundRows.length} source section{boundRows.length === 1 ? '' : 's'}
                  · {totalItems} total item{totalItems === 1 ? '' : 's'}
                </span>
              </summary>
              <div className="border-t border-wm-accent/30 px-4 py-3 space-y-3">
                {/* Schema — the strategist's declared field list. Button
                    target sits at the top of this section as a first-
                    class row, since it's part of the model's shape
                    (what happens when the CTA is clicked) — same
                    editorial weight as the fields themselves. */}
                <div>
                  <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">Schema (strategist-declared)</p>
                  <div className="mb-2 flex items-baseline gap-2 min-w-0 rounded-md border border-wm-accent/30 bg-wm-accent-tint/40 px-3 py-2">
                    <span className="text-[13.5px] font-semibold text-wm-text truncate">Button target</span>
                    <span className="text-[12px] font-semibold text-wm-accent-strong bg-white border border-wm-accent/40 px-2.5 py-0.5 rounded-full shrink-0">
                      {ctaText}
                    </span>
                  </div>
                  {m.schema.length === 0 ? (
                    <p className="text-[12px] text-wm-text-muted italic">No fields declared yet.</p>
                  ) : (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                      {m.schema.map(f => (
                        <li key={f.key} className="flex items-baseline gap-2 min-w-0">
                          <span className="text-[13.5px] text-wm-text truncate">{f.label || f.key}</span>
                          <span className="text-[11px] font-semibold text-wm-accent-strong bg-wm-accent-tint border border-wm-accent/30 px-2 py-0.5 rounded-full shrink-0">
                            {f.type}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Sources — list of bound sections across pages */}
                <div>
                  <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                    Sources ({boundRows.length})
                  </p>
                  {boundRows.length === 0 ? (
                    <p className="text-[12px] text-wm-text-muted italic">
                      No sections bound yet. Use the Content Model panel on the Pages workspace to connect sections.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-[12px]">
                      {boundRows.map(s => {
                        const indices = s.declared_content_model?.item_indices
                        const applied = s.declared_content_model?.item_indices_applied !== false
                        return (
                          <li key={s.section_id} className="flex items-baseline gap-2 flex-wrap">
                            <code className="text-[11px] font-mono text-wm-text-muted">/{s.page_slug}</code>
                            <span className="text-wm-text">{s.heading}</span>
                            <span className="text-[10.5px] text-wm-text-subtle">
                              · {s.item_count} item{s.item_count === 1 ? '' : 's'}
                              {indices && (
                                applied
                                  ? ` · ${indices.length} of section's cards`
                                  : ` · ${indices.length} indices — filter not applied`
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                {/* Partner Content Collection callout — shown here on
                    the declared-model card when the strategist paired
                    this model with a content-collection topic (Events,
                    Sermons, Groups). Same fields that used to appear
                    on individual section rows; relocating here means
                    the dev sees the partner's intent alongside the
                    model that will carry it, not scattered per section. */}
                {m.paired_content_context && (
                  <div className="rounded-md border border-wm-accent/50 bg-wm-accent-tint/50 px-3 py-2">
                    <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1.5">
                      What the partner asked for in Content Collection ({m.paired_content_context.content_kind})
                    </p>
                    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
                      {m.paired_content_context.display_preference && <>
                        <dt className="text-wm-text-muted">Display preference</dt>
                        <dd className="text-wm-text"><code className="text-[12px] font-mono">{m.paired_content_context.display_preference}</code></dd>
                      </>}
                      {m.paired_content_context.display_format && <>
                        <dt className="text-wm-text-muted">Display format</dt>
                        <dd className="text-wm-text">{m.paired_content_context.display_format}</dd>
                      </>}
                      {m.paired_content_context.external_url && <>
                        <dt className="text-wm-text-muted">
                          {m.paired_content_context.display_preference === 'embed' || m.paired_content_context.display_preference === 'external' ? 'Embed / external source' : 'Partner sample URL'}
                        </dt>
                        <dd>
                          <a href={m.paired_content_context.external_url} target="_blank" rel="noopener noreferrer" className="text-wm-accent-strong underline break-all">
                            {m.paired_content_context.external_url.length > 80 ? m.paired_content_context.external_url.slice(0, 77) + '…' : m.paired_content_context.external_url}
                          </a>
                        </dd>
                      </>}
                      {m.paired_content_context.playlist_url && <>
                        <dt className="text-wm-text-muted">YouTube playlist</dt>
                        <dd>
                          <a href={m.paired_content_context.playlist_url} target="_blank" rel="noopener noreferrer" className="text-wm-accent-strong underline break-all">
                            {m.paired_content_context.playlist_url.length > 80 ? m.paired_content_context.playlist_url.slice(0, 77) + '…' : m.paired_content_context.playlist_url}
                          </a>
                        </dd>
                      </>}
                      {m.paired_content_context.archive_features && m.paired_content_context.archive_features.length > 0 && <>
                        <dt className="text-wm-text-muted">Archive features wanted</dt>
                        <dd className="text-wm-text">{m.paired_content_context.archive_features.map((f, i) => (
                          <span key={f}>
                            {i > 0 && <span className="text-wm-text-subtle mx-1">·</span>}
                            <code className="text-[12px] font-mono">{f}</code>
                          </span>
                        ))}</dd>
                      </>}
                      {m.paired_content_context.source_of_truth && <>
                        <dt className="text-wm-text-muted">Partner's current system</dt>
                        <dd className="text-wm-text">{m.paired_content_context.source_of_truth}</dd>
                      </>}
                      {m.paired_content_context.frustration && m.paired_content_context.frustration.trim() !== '-' && <>
                        <dt className="text-wm-text-muted">Partner note</dt>
                        <dd className="text-wm-text italic">{m.paired_content_context.frustration}</dd>
                      </>}
                    </dl>
                  </div>
                )}

                {/* Sample entry from one of the bound sources */}
                {sample && sampleFields.length > 0 && (
                  <div className="rounded-md border border-wm-border/60 bg-wm-bg-elevated/60 px-3 py-2">
                    <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
                      Sample entry — from <code className="text-[10.5px] font-mono">/{firstSample?.page_slug}</code>
                    </p>
                    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                      {sampleFields.slice(0, 8).map(([k, v]) => (
                        <span key={k} className="contents">
                          <dt className="text-wm-text-muted font-mono text-[11.5px]">{k}</dt>
                          <dd className="text-wm-text break-words">{renderSampleCell(v)}</dd>
                        </span>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

/** Analyzer's suggested model panel. Renders BELOW the discovery
 *  view as a "here's what I'd build" reference McNeel can disagree
 *  with freely. Detailed registration args + ACF field structures
 *  live in the downloadable markdown. */
function CmWpObjectsPanel({ plan }: { plan: ContentModelPlan }) {
  const cpts    = plan.layer_2_wp_objects.filter(o => o.kind === 'custom_post_type')
  const options = plan.layer_2_wp_objects.filter(o => o.kind === 'options_page')
  const reps    = plan.layer_2_wp_objects.filter(o => o.kind === 'repeater')
  const exts    = plan.layer_2_wp_objects.filter(o => o.kind === 'external')
  return (
    <div className="mt-5 pt-4 border-t border-wm-border">
      <div className="text-[10px] uppercase tracking-wider text-wm-text-subtle mb-1">Analyzer's recommended model (review + adjust)</div>
      <p className="text-[11px] text-wm-text-muted mb-2">Suggested WP structure for the concepts above. Disagree freely — registration args, field types, and taxonomy slugs are all editable. Full detail in the Markdown handoff.</p>
      {cpts.length > 0 && (
        <details className="mb-2" open>
          <summary className="text-[12px] font-semibold text-wm-text cursor-pointer">Custom Post Types ({cpts.length})</summary>
          <ul className="mt-1 ml-3 text-[12px] text-wm-text-muted space-y-1">
            {cpts.map(c => {
              if (c.kind !== 'custom_post_type') return null
              const single   = c.single_template.enabled ? '✅ single' : '❌ no single'
              const archive  = c.archive.enabled ? '✅ archive' : '❌ no archive'
              const headless = c.headless ? ' · 🔒 headless' : ''
              const taxList  = c.taxonomies.map(t => t.slug).join(', ')
              return (
                <li key={c.id}>
                  <code className="text-wm-accent-strong">{c.slug}</code> ({c.labels.singular}/{c.labels.plural}) — {single} · {archive}{headless}
                  {taxList && <span className="text-wm-text-subtle"> · tax: {taxList}</span>}
                </li>
              )
            })}
          </ul>
        </details>
      )}
      {options.length > 0 && (
        <details className="mb-2">
          <summary className="text-[12px] font-semibold text-wm-text cursor-pointer">Options Page ({options.length})</summary>
          <ul className="mt-1 ml-3 text-[12px] text-wm-text-muted space-y-1">
            {options.map(o => o.kind === 'options_page' ? (
              <li key={o.id}>
                <code className="text-wm-accent-strong">{o.slug}</code> — {o.menu_title} · seeded with {o.seeded_from_project_columns.length} project columns
              </li>
            ) : null)}
          </ul>
        </details>
      )}
      {reps.length > 0 && (
        <details className="mb-2">
          <summary className="text-[12px] font-semibold text-wm-text cursor-pointer">Page-scoped Repeaters ({reps.length})</summary>
          <ul className="mt-1 ml-3 text-[12px] text-wm-text-muted space-y-0.5">
            {reps.map(r => r.kind === 'repeater' ? (
              <li key={r.id}>
                <code className="text-[11px]">/{r.on_page_slug}</code> · <code className="text-[11px]">{r.field_group_ref}</code>
              </li>
            ) : null)}
          </ul>
        </details>
      )}
      {exts.length > 0 && (
        <details className="mb-2">
          <summary className="text-[12px] font-semibold text-wm-text cursor-pointer">External (managed elsewhere) ({exts.length})</summary>
          <ul className="mt-1 ml-3 text-[12px] text-wm-text-muted space-y-1">
            {exts.map(e => e.kind === 'external' ? (
              <li key={e.id}><code>{e.id}</code> — {e.display_mode}{e.rationale ? `: ${e.rationale}` : ''}</li>
            ) : null)}
          </ul>
        </details>
      )}
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
        {filledRoles.map(({ role, anchor, scale }) => {
          // The "Anchor" highlight must land on the step where the
          // strategist's chosen hex naturally classifies — NOT always
          // `medium`. Light brand colors land at `light` / `lighter` /
          // `ultra-light`; dark brand colors land at `dark` / `darker`.
          // The exporter already uses this step to reference the brand
          // variable (designSystemSpec.ts:591); this preview now matches.
          const anchorStep = anchorShadeStep(anchor.hex)
          return (
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
                const isAnchor = step === anchorStep
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
        )})}
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
                    <span className={`inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5 border ${ctaKindClass(c.cta.kind)}`}>
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
                  <td className="px-2 py-2 max-w-[220px] align-top">
                    <p className="text-wm-text break-words" title={c.sectionLabel}>{c.sectionLabel}</p>
                    {c.brixiesLayout && (
                      <p className="text-[10px] text-wm-text-subtle break-words font-mono" title={`Brixies layout: ${c.brixiesLayout}`}>
                        {c.brixiesLayout}
                      </p>
                    )}
                    {c.fieldLabel && c.fieldLabel !== c.fieldKey && (
                      <p className="text-[10px] text-wm-text-subtle break-words mt-0.5" title={c.fieldLabel}>{c.fieldLabel}</p>
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

/** Tailwind class set for the CTA-kind pill — one color per destination
 *  family so the dev can scan the inventory and immediately see where
 *  the partner is sending visitors. Internal routes = green (stays on
 *  site), externals = blue (leaves), mailto/tel = orange (contact),
 *  file/video = indigo/red (asset), application_form = teal (lead),
 *  anchor = purple (same-page), snippet = gray (token-resolved). */
function ctaKindClass(kind: import('../../../types/database').CtaKind): string {
  switch (kind) {
    case 'internal_route':   return 'bg-green-50 text-green-800 border-green-300'
    case 'external_url':     return 'bg-blue-50 text-blue-800 border-blue-300'
    case 'mailto':           return 'bg-orange-50 text-orange-800 border-orange-300'
    case 'tel':              return 'bg-amber-50 text-amber-800 border-amber-300'
    case 'file_download':    return 'bg-indigo-50 text-indigo-800 border-indigo-300'
    case 'video_link':       return 'bg-red-50 text-red-800 border-red-300'
    case 'application_form': return 'bg-teal-50 text-teal-800 border-teal-300'
    case 'anchor':           return 'bg-purple-50 text-purple-800 border-purple-300'
    case 'snippet':          return 'bg-gray-100 text-gray-700 border-gray-300'
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function extractCtaInventory(opts: {
  pages:     Array<Pick<WebPage, 'id' | 'name' | 'slug'>>
  sections:  WebSection[]
  templates: Record<string, WebContentTemplate>
  /** Project's figma_layout_swaps map — when a swap target is set for
   *  a template, the Brixies layout label in the CTA inventory carries
   *  the SWAP TARGET'S name (what's actually in the Figma file) instead
   *  of the original Brixies template. */
  swaps?:    StrategyWebProject['figma_layout_swaps']
}): CtaRow[] {
  const pageById: Record<string, { name: string; slug: string }> = {}
  for (const p of opts.pages) pageById[p.id] = { name: p.name, slug: p.slug }
  const slugSet = new Set(opts.pages.map(p => p.slug))
  const swaps = opts.swaps ?? {}

  const rows: CtaRow[] = []
  for (const s of opts.sections) {
    const page = pageById[s.web_page_id]
    if (!page) continue
    const template = s.content_template_id ? opts.templates[s.content_template_id] : null
    // Friendly section identifier first — the partner-facing label
    // (page + ordinal + role) reads naturally in conversation. The
    // technical Brixies layout rides alongside as a secondary
    // identifier, swapped if the Style Guide has redirected it.
    const sectionLabel = composeSectionName({
      page:    { name: page.name },
      section: s,
    })
    const swapEntry = template ? swaps[template.id] : null
    const swapTarget = swapEntry?.to_template_id
      ? opts.templates[swapEntry.to_template_id]
      : null
    const brixiesLayout =
      swapEntry?.to_template_label ??
      swapTarget?.layer_name ??
      template?.layer_name ??
      null
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
          brixiesLayout,
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
          brixiesLayout,
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
    ['Page', 'Slug', 'Section', 'Brixies layout', 'Field', 'Label', 'Kind', 'Source', 'URL', 'Target', 'Status']
      .map(cells).join(','),
  ]
  for (const r of rows) {
    const target = r.cta.target ?? defaultTargetFor(r.cta.kind)
    csv.push([
      r.pageName, `/${r.pageSlug}`, r.sectionLabel, r.brixiesLayout ?? '',
      r.fieldLabel || r.fieldKey,
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
  // Filter unset rows — the dev doesn't need to see "— not set —" 30
  // times; the table reads as actionable when only filled rows show.
  // Strategist still sees the empties on the church-settings editor;
  // this card is purely the dev's reference for what's available.
  const ordered = [...snippets]
    .filter(s => typeof s.value === 'string' && s.value.trim().length > 0)
    .sort((a, b) => a.token.localeCompare(b.token))
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
