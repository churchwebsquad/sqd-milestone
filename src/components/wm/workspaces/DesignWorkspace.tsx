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
  Sparkles, ExternalLink, Check, AlertCircle, Layers,
  FolderOpen, Lightbulb, X, KeyRound, RefreshCw, Image as ImageIcon,
  ArrowRight,
} from 'lucide-react'
import { scanStrategicPhrases, extractInspirationalUrls } from '../../../lib/cowork/strategicPhraseScanner'
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
import type {
  StrategyWebProject, WebContentTemplate,
  StrategyBrandLogo, StrategyBrandElement,
} from '../../../types/database'
import { setProjectSwap, clearProjectSwap } from '../../../lib/webFigmaLayoutSwap'
import { loadBrandGuidesForMember, type MemberBrandGuides, type BrandGuideEntry } from '../../../lib/brandGuides'
import { loadMainGuideByMember, type BrandGuideBundle } from '../../../lib/brandGuide'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'

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
  // Inspirational-sites snapshot (Phase 3). Pulled from
  // roadmap_state.strategic_goals.inspiration_and_notes.inspirational_websites.
  // Surfaced to the designer with a scanned-phrase taxonomy so they
  // see the strategic ASKS, not just URLs.
  const [inspirational, setInspirational] = useState<{ value: string; status: string } | null>(null)

  // Brand handoff cross-load — brand guide library + main guide bundle
  // (logos + elements) keyed on project.member. Surfaces the SAME
  // visuals the Brand Squad's BrandHandoffPage shows so the designer
  // has the asset library + element references on the same surface
  // they're authoring the design system on.
  const [brandGuides,  setBrandGuides]  = useState<MemberBrandGuides | null>(null)
  const [guideBundle,  setGuideBundle]  = useState<BrandGuideBundle | null>(null)
  useEffect(() => {
    if (!project.member) return
    let cancelled = false
    void (async () => {
      try {
        const [libRes, bundleRes] = await Promise.all([
          loadBrandGuidesForMember(project.member),
          loadMainGuideByMember(project.member),
        ])
        if (cancelled) return
        setBrandGuides(libRes)
        setGuideBundle(bundleRes)
      } catch {
        // Surface nothing — these sections are additive; a load failure
        // on a project without a brand guide is normal.
      }
    })()
    return () => { cancelled = true }
  }, [project.member])
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('strategy_web_projects')
        .select('roadmap_state')
        .eq('id', project.id)
        .maybeSingle()
      const sg = (data as any)?.roadmap_state?.strategic_goals
      const field = sg?.inspiration_and_notes?.inspirational_websites
      if (field && typeof field.value === 'string' && field.value.trim() && field.status !== 'archived') {
        setInspirational({ value: field.value, status: field.status ?? 'draft' })
      } else {
        setInspirational(null)
      }
    })()
  }, [project.id])

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
      // A single member can carry multiple brand_guides rows (legacy
      // duplicates, drafts the AM never deleted, etc.). Date-based
      // tie-breaking is unreliable — a more-recently-touched row may
      // be the WIP scratch guide while the canonical, colors-filled
      // one is older. Score every candidate by (a) published status,
      // (b) how many color rows it has filled in, (c) date as final
      // tiebreaker. The "most complete" guide wins.
      const { data: guides, error: guideErr } = await supabase
        .from('strategy_brand_guides')
        .select('id, is_published, last_updated_at, updated_at')
        .eq('member', project.member)
      if (guideErr) throw new Error(guideErr.message)
      if (!guides || guides.length === 0) {
        setPopulateStatus({
          kind: 'empty',
          summary: [],
          message: `No brand guide found for member ${project.member}. Have intake load the brand colors + typography first.`,
        })
        return
      }

      const guideIds = guides.map(g => g.id)
      const { data: colorRowsForRank } = await supabase
        .from('strategy_brand_colors')
        .select('brand_guide_id')
        .in('brand_guide_id', guideIds)
      const colorCount = new Map<string, number>()
      for (const r of (colorRowsForRank ?? []) as Array<{ brand_guide_id: string }>) {
        colorCount.set(r.brand_guide_id, (colorCount.get(r.brand_guide_id) ?? 0) + 1)
      }
      const scored = guides.map(g => ({
        g,
        score:
          (g.is_published ? 1_000_000 : 0) +
          (colorCount.get(g.id) ?? 0) * 1_000 +
          new Date(g.last_updated_at ?? g.updated_at ?? 0).getTime() / 1_000_000_000,
      }))
      scored.sort((a, b) => b.score - a.score)
      const guide = scored[0].g

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

  // ── Logo zip download ──────────────────────────────────────────────
  // Pulls every logo in strategy_brand_logos for the project's brand
  // guide and packages them client-side. If the brand guide has an
  // assets_zip_url already published, we surface it as a direct link
  // instead of re-zipping (saves a few seconds on large libraries and
  // keeps the staff version-controlled link).
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoStatus, setLogoStatus] = useState<{ kind: 'error' | 'empty'; message: string } | null>(null)
  const downloadLogosZip = useCallback(async () => {
    setLogoBusy(true)
    setLogoStatus(null)
    try {
      // Match the same scoring used by populateFromIntake so we hit the
      // same brand guide row both surfaces have agreed is canonical.
      const { data: guides, error: guideErr } = await supabase
        .from('strategy_brand_guides')
        .select('id, is_published, last_updated_at, updated_at, assets_zip_url')
        .eq('member', project.member)
      if (guideErr) throw new Error(guideErr.message)
      if (!guides || guides.length === 0) {
        setLogoStatus({ kind: 'empty', message: `No brand guide found for member ${project.member}.` })
        return
      }

      const guideIds = guides.map(g => g.id)
      const { data: logoRowsForRank } = await supabase
        .from('strategy_brand_logos')
        .select('brand_guide_id')
        .in('brand_guide_id', guideIds)
      const logoCount = new Map<string, number>()
      for (const r of (logoRowsForRank ?? []) as Array<{ brand_guide_id: string }>) {
        logoCount.set(r.brand_guide_id, (logoCount.get(r.brand_guide_id) ?? 0) + 1)
      }
      const scored = guides.map(g => ({
        g,
        score:
          (g.is_published ? 1_000_000 : 0) +
          (logoCount.get(g.id) ?? 0) * 1_000 +
          new Date(g.last_updated_at ?? g.updated_at ?? 0).getTime() / 1_000_000_000,
      }))
      scored.sort((a, b) => b.score - a.score)
      const guide = scored[0].g

      const slug = (project.church_short_name || project.name || 'project')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

      // Fast path — guide carries a pre-made assets zip. Open in a new
      // tab so the AM doesn't lose context if download is blocked.
      if (guide.assets_zip_url) {
        window.open(guide.assets_zip_url, '_blank', 'noopener,noreferrer')
        return
      }

      const { data: logos, error: logosErr } = await supabase
        .from('strategy_brand_logos')
        .select('id, kind, label, preview_url, download_url, sort_order')
        .eq('brand_guide_id', guide.id)
        .order('sort_order')
      if (logosErr) throw new Error(logosErr.message)
      const logoList = (logos ?? []) as Array<{
        id: string; kind: string; label: string | null
        preview_url: string; download_url: string | null; sort_order: number | null
      }>
      if (logoList.length === 0) {
        setLogoStatus({ kind: 'empty', message: 'Brand guide has no logos uploaded yet.' })
        return
      }

      // Build the zip. Fetch each logo in parallel and bail loudly on
      // any failure — partial zips are worse than no zip.
      const { zipSync } = await import('fflate')
      const usedNames = new Set<string>()
      const files: Record<string, Uint8Array> = {}
      const failures: string[] = []

      const results = await Promise.allSettled(logoList.map(async (logo) => {
        const url = logo.download_url || logo.preview_url
        const res = await fetch(url, { credentials: 'omit' })
        if (!res.ok) throw new Error(`${logo.kind}${logo.label ? ` (${logo.label})` : ''}: HTTP ${res.status}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        const ext = (() => {
          const fromUrl = url.split('?')[0].split('.').pop()
          if (fromUrl && /^[a-z0-9]{2,5}$/i.test(fromUrl)) return fromUrl.toLowerCase()
          const mime = res.headers.get('content-type') ?? ''
          if (mime.includes('svg')) return 'svg'
          if (mime.includes('png')) return 'png'
          if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
          return 'bin'
        })()
        const base = logo.label
          ? logo.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
          : logo.kind
        let name = `${logo.kind}-${base}.${ext}`
        // Disambiguate filename collisions (two "primary" logos in the
        // same guide is rare but real — preserve both).
        let n = 2
        while (usedNames.has(name)) { name = `${logo.kind}-${base}-${n}.${ext}`; n++ }
        usedNames.add(name)
        files[`${slug}-logos/${name}`] = buf
      }))
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const logo = logoList[i]
          failures.push(r.reason instanceof Error ? r.reason.message : `${logo.kind} logo failed`)
        }
      })
      if (Object.keys(files).length === 0) {
        throw new Error(failures.length ? failures.join('; ') : 'All logo fetches failed.')
      }
      if (failures.length) {
        console.warn('[logos-zip] partial failures', failures)
      }

      const zipped = zipSync(files)
      const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}-logos.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setLogoStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setLogoBusy(false)
    }
  }, [project])

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
              variant="secondary"
              size="md"
              iconLeft={logoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
              onClick={() => void downloadLogosZip()}
              disabled={logoBusy}
              title="Bundle every logo from the partner's brand guide into a single .zip for design handoff"
            >
              Download logos (.zip)
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

        {logoStatus && (
          <div
            className={[
              'mb-5 rounded-md border px-3 py-2 text-[12px]',
              logoStatus.kind === 'error'
                ? 'border-wm-danger/30 bg-wm-danger-bg text-wm-danger'
                : 'border-wm-border bg-wm-bg-hover text-wm-text-muted',
            ].join(' ')}
          >
            <p className="font-semibold mb-0.5">
              {logoStatus.kind === 'error' ? 'Logo download failed' : 'No logos to download'}
            </p>
            <p>{logoStatus.message}</p>
          </div>
        )}

        <div className="space-y-5">
          {/* Brand handoff cross-load — library + logos + elements
              pulled from the Brand Squad's brand guide so the designer
              has source material on the same surface as the spec. */}
          {brandGuides && brandGuides.entries.length > 0 && (
            <BrandGuideLibraryDesignSection guides={brandGuides} />
          )}
          {guideBundle && guideBundle.logos.length > 0 && (
            <BrandLogosDesignSection
              logos={guideBundle.logos}
              assetsZipUrl={guideBundle.guide?.assets_zip_url ?? null}
            />
          )}
          {guideBundle && guideBundle.elements.length > 0 && (
            <BrandElementsDesignSection elements={guideBundle.elements} />
          )}
          {inspirational && <InspirationalSitesSection value={inspirational.value} status={inspirational.status} />}
          <BrandAnchorsSection spec={spec} onChange={update} />
          <RoleAnchorsSection spec={spec} onChange={update} />
          <TonalPreviewSection spec={spec} />
          <TypographySection spec={spec} onChange={update} />
          <SpacingSection spec={spec} onChange={update} />
          <RadiusSection spec={spec} onChange={update} />
          <FigmaStyleGuideSection
            project={project}
            spec={spec}
            onChange={update}
            onAutoSave={autoSave}
            onProjectChange={onChange}
          />
          <ImagesSection projectId={project.id} spec={spec} onAutoSave={autoSave} />
          <SquadFigmaPluginSection project={project} onChange={onChange} />
          <DesignerNotesRollup projectId={project.id} />
        </div>
      </div>
    </div>
  )
}

/** Designer Notes rollup — pulls web_pages.designer_notes for every
 *  non-archived page on the project and lists them per page. Mirrors
 *  the Dev Handoff dev_notes rollup but scoped to the designer. */
function DesignerNotesRollup({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; slug: string; notes: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data } = await supabase
        .from('web_pages')
        .select('id, name, slug, designer_notes')
        .eq('web_project_id', projectId)
        .eq('archived', false)
        .order('sort_order')
      if (cancelled) return
      const filtered = ((data ?? []) as Array<{ id: string; name: string; slug: string; designer_notes: string | null }>)
        .filter(p => !p.slug.startsWith('staff/'))
        .filter(p => typeof p.designer_notes === 'string' && p.designer_notes.trim().length > 0)
        .map(p => ({ id: p.id, name: p.name, slug: p.slug, notes: (p.designer_notes ?? '').trim() }))
      setRows(filtered)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [projectId])

  return (
    <WMCard padding="loose">
      <div className="flex items-center gap-2 mb-2 text-wm-accent-strong">
        <Palette size={13} />
        <h2 className="text-[13px] font-bold uppercase tracking-widest">
          Designer notes
        </h2>
      </div>
      <p className="text-[12px] text-wm-text-muted mb-3 max-w-xl">
        Per-page notes written by the strategist for the designer. Edit
        any page's notes from the Pages workspace; they roll up here so
        the designer has a single punch list before kicking off the
        visual pass.
      </p>
      {loading ? (
        <p className="text-[12px] text-wm-text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-wm-text-muted italic">
          No designer notes on any page yet. Add notes per page in the Pages workspace.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.id} className="rounded-md border border-wm-border bg-wm-bg-elevated/40 p-3">
              <div className="flex items-baseline gap-2 mb-1.5">
                <p className="text-[12.5px] font-semibold text-wm-text">{r.name}</p>
                <code className="text-[10.5px] text-wm-text-subtle">/{r.slug}</code>
              </div>
              <p className="text-[12px] text-wm-text whitespace-pre-wrap font-mono leading-relaxed">{r.notes}</p>
            </li>
          ))}
        </ul>
      )}
    </WMCard>
  )
}

// ── Brand anchors ───────────────────────────────────────────────────

function InspirationalSitesSection({ value, status }: { value: string; status: string }) {
  const urls    = useMemo(() => extractInspirationalUrls(value),    [value])
  const phrases = useMemo(() => scanStrategicPhrases(value),        [value])
  return (
    <WMCard padding="loose">
      <div className="flex items-start gap-2.5">
        <Lightbulb size={14} className="shrink-0 mt-0.5 text-wm-accent-strong" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-[13px] font-bold uppercase tracking-widest text-wm-accent-strong">Inspirational sites</h2>
            {status === 'draft' && (
              <span className="text-[10px] uppercase tracking-wider text-wm-text-subtle">draft — strategist hasn't approved</span>
            )}
          </div>
          <p className="text-[12px] text-wm-text-muted max-w-2xl mb-3">
            The partner's reference sites + the strategic phrases scanned out of their notes. Treat the phrases as design asks, not just visual cues.
          </p>
          {urls.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {urls.map(u => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-wm-accent-strong hover:underline">
                  <ExternalLink size={11} />
                  {u.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 60)}
                </a>
              ))}
            </div>
          )}
          {phrases.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {phrases.map(p => (
                <span
                  key={p.phrase}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-wm-accent-tint text-wm-accent-strong"
                  title={p.implication}
                >
                  {p.phrase}
                </span>
              ))}
            </div>
          )}
          {phrases.length > 0 && (
            <details className="mt-2">
              <summary className="text-[11px] text-wm-text-muted cursor-pointer hover:text-wm-text">What each phrase means for design</summary>
              <ul className="mt-2 space-y-1.5">
                {phrases.map(p => (
                  <li key={p.phrase} className="text-[11.5px] text-wm-text leading-snug">
                    <span className="font-semibold text-wm-accent-strong">{p.phrase}:</span> {p.implication}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="mt-3">
            <summary className="text-[11px] text-wm-text-muted cursor-pointer hover:text-wm-text">Original notes</summary>
            <p className="mt-2 text-[12px] text-wm-text-muted leading-snug whitespace-pre-wrap break-words">{value}</p>
          </details>
        </div>
      </div>
    </WMCard>
  )
}

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
  project, spec, onChange, onAutoSave, onProjectChange,
}: {
  project: StrategyWebProject
  spec: DesignSystemSpec
  onChange: (s: DesignSystemSpec) => void
  /** Persist-and-clear-dirty path used by low-friction toggles like
   *  the load checklist below. The URL input + family lists stay on
   *  `onChange` (Save button required) since they're higher-stakes. */
  onAutoSave: (s: DesignSystemSpec) => Promise<void>
  /** Reload the project row from the host after the swap map writes —
   *  same hook the rest of DesignWorkspace uses for project refreshes. */
  onProjectChange: () => Promise<void>
}) {
  const projectId = project.id
  const binding: FigmaBinding = spec.figma ?? {}
  const [urlDraft, setUrlDraft] = useState(binding.style_guide_url ?? '')
  const [focused, setFocused] = useState(false)

  // Per-template Figma layout swap (merged in from the old standalone
  // LayoutSwapBoard — same storage on strategy_web_projects.figma_layout_swaps).
  // Designer types a Brixies replacement layout name per row on the
  // checklist; that name carries forward to the dev handoff + Figma
  // plugin without making them leave the style-guide surface.
  const [swaps, setSwaps] = useState<StrategyWebProject['figma_layout_swaps']>(project.figma_layout_swaps ?? {})
  const [savingSwap, setSavingSwap] = useState<string | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)
  useEffect(() => { setSwaps(project.figma_layout_swaps ?? {}) }, [project.figma_layout_swaps])

  const saveSwapMap = useCallback(async (
    next: StrategyWebProject['figma_layout_swaps'],
    fromTemplateId: string,
  ) => {
    setSavingSwap(fromTemplateId)
    setSwaps(next)
    setSwapError(null)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ figma_layout_swaps: next })
      .eq('id', projectId)
    setSavingSwap(null)
    if (error) {
      console.error('[FigmaStyleGuideSection] swap save failed:', error)
      setSwapError(`Couldn't save swap: ${error.message}`)
      setSwaps(project.figma_layout_swaps ?? {})
      return
    }
    await onProjectChange()
  }, [projectId, project.figma_layout_swaps, onProjectChange])

  /** Set / clear the swap target for one wireframe template id from a
   *  free-text input. Matches the typed name against the catalog by
   *  layer_name (case-insensitive); preserves the raw label so designer
   *  edits survive even when the catalog has no exact match. */
  const handleSwapText = useCallback(async (
    fromTemplateId: string,
    text: string,
    catalog: Record<string, WebContentTemplate>,
  ) => {
    const trimmed = text.trim()
    if (!trimmed) {
      const next = clearProjectSwap(swaps, fromTemplateId)
      await saveSwapMap(next, fromTemplateId)
      return
    }
    const lower = trimmed.toLowerCase()
    const match = Object.values(catalog).find(t => t.layer_name.toLowerCase() === lower)
    const { data: { session } } = await supabase.auth.getSession()
    const next = setProjectSwap(swaps, fromTemplateId, {
      to_template_id:    match?.id ?? '',
      to_template_label: trimmed,
      note:              swaps[fromTemplateId]?.note ?? null,
      swapped_at:        new Date().toISOString(),
      swapped_by:        session?.user?.id ?? '',
    })
    await saveSwapMap(next, fromTemplateId)
  }, [swaps, saveSwapMap])

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
  // Per-template usage map: template_id → unique page names + total
  // instance count. Surfaced under each row in the checklist so the
  // designer sees the actual on-page context, not just the family
  // rollup. Templates from chrome bindings (header/footer/megamenu)
  // get a synthetic '(project chrome)' entry so they're still
  // distinguishable from per-page sections.
  const [usageByTemplate, setUsageByTemplate] = useState<
    Record<string, { pageNames: string[]; instances: number; isChrome: boolean }>
  >({})
  const [loading, setLoading] = useState(true)
  const loadUsed = useCallback(async () => {
    // Design handoff enumerates ACTUAL page implementations + chrome
    // bindings (header/footer/megamenu/offcanvas) — never the curated
    // library wholesale. If a library pick was never placed on a real
    // page, the designer doesn't need to prep it in Figma.
    //
    // Skip archived pages: removed pages still own their sections,
    // but the designer/dev shouldn't need to prep templates that
    // only appear on a removed page. Surface a separate count for
    // any chrome bindings (project-level header/footer/megamenu) so
    // the per-template usage row can label them differently from
    // per-page sections.
    setLoading(true)
    const { data: sectionRows } = await supabase
      .from('web_sections')
      .select('content_template_id, web_pages!inner(name, archived, web_project_id)')
      .eq('web_pages.web_project_id', projectId)
      .eq('web_pages.archived', false)
      .not('content_template_id', 'is', null)
    type Row = { content_template_id: string | null; web_pages: { name: string } | { name: string }[] | null }
    const usage = new Map<string, { pageNames: Set<string>; instances: number; isChrome: boolean }>()
    for (const r of (sectionRows ?? []) as Row[]) {
      const tplId = r.content_template_id
      if (!tplId) continue
      // PostgREST returns the joined row as an object OR an array
      // depending on the relationship cardinality; normalize both.
      const pageObj = Array.isArray(r.web_pages) ? r.web_pages[0] : r.web_pages
      const pageName = pageObj?.name ?? '(unnamed page)'
      const entry = usage.get(tplId) ?? { pageNames: new Set<string>(), instances: 0, isChrome: false }
      entry.pageNames.add(pageName)
      entry.instances += 1
      usage.set(tplId, entry)
    }
    const { data: project } = await supabase
      .from('strategy_web_projects')
      .select('primary_header_template_id, primary_footer_template_id, megamenu_template_ids, offcanvas_template_ids')
      .eq('id', projectId)
      .maybeSingle()
    if (project) {
      const chromeIds: string[] = []
      if (project.primary_header_template_id) chromeIds.push(project.primary_header_template_id)
      if (project.primary_footer_template_id) chromeIds.push(project.primary_footer_template_id)
      for (const id of (project.megamenu_template_ids ?? []) as string[]) chromeIds.push(id)
      for (const id of (project.offcanvas_template_ids ?? []) as string[]) chromeIds.push(id)
      for (const id of chromeIds) {
        const entry = usage.get(id) ?? { pageNames: new Set<string>(), instances: 0, isChrome: false }
        entry.isChrome = true
        usage.set(id, entry)
      }
    }
    const ids = [...usage.keys()]
    const dbTpls: WebContentTemplate[] = ids.length > 0
      ? ((await supabase
          .from('web_content_templates')
          .select('id, layer_name, family, preview_image_url')
          .in('id', ids)
          .order('family')
          .order('layer_name')).data as WebContentTemplate[] | null ?? [])
      : []
    // Synthetic nav checklist items — these aren't bound templates,
    // but every Figma style guide needs them prepped (desktop nav,
    // mobile nav, offcanvas / mega menu). Surfacing them on the
    // same checklist keeps the designer's "what do I need to load"
    // punch list in one place; the synthetic ids ride alongside
    // real template ids in spec.figma.loaded_template_ids so the
    // checked state persists.
    const navChecklist: WebContentTemplate[] = [
      { id: '__nav_desktop',   layer_name: 'Desktop Navigation',           family: 'Navigation' } as WebContentTemplate,
      { id: '__nav_mobile',    layer_name: 'Mobile Navigation',            family: 'Navigation' } as WebContentTemplate,
      { id: '__nav_offcanvas', layer_name: 'Offcanvas / Mega Menu',        family: 'Navigation' } as WebContentTemplate,
    ]
    setUsed([...dbTpls, ...navChecklist])
    const flat: Record<string, { pageNames: string[]; instances: number; isChrome: boolean }> = {}
    for (const [id, entry] of usage.entries()) {
      flat[id] = {
        pageNames: [...entry.pageNames].sort((a, b) => a.localeCompare(b)),
        instances: entry.instances,
        isChrome: entry.isChrome,
      }
    }
    setUsageByTemplate(flat)
    setLoading(false)
  }, [projectId])
  useEffect(() => { void loadUsed() }, [loadUsed])

  // Designer-curated extras (templates they pulled into Figma that
  // aren't bound to a section) + exclusions (auto-derived ones they
  // chose not to use). Joined onto the auto-derived `used` set so the
  // checklist accurately reflects what's actually in their Figma file.
  const [extraTemplates, setExtraTemplates] = useState<WebContentTemplate[]>([])
  const extraIds = useMemo(() => spec.figma?.extra_template_ids ?? [], [spec.figma])
  const excludedIds = useMemo(() => new Set(spec.figma?.excluded_template_ids ?? []), [spec.figma])
  useEffect(() => {
    if (extraIds.length === 0) { setExtraTemplates([]); return }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('web_content_templates')
        .select('id, layer_name, family, preview_image_url')
        .in('id', extraIds)
      if (!cancelled) setExtraTemplates((data ?? []) as WebContentTemplate[])
    })()
    return () => { cancelled = true }
  }, [extraIds])

  const effectiveUsed = useMemo(() => {
    const filteredAuto = used.filter(t => !excludedIds.has(t.id))
    const autoIds = new Set(filteredAuto.map(t => t.id))
    const dedupedExtras = extraTemplates.filter(t => !autoIds.has(t.id))
    return [...filteredAuto, ...dedupedExtras]
  }, [used, extraTemplates, excludedIds])

  // Full Brixies catalog for the swap-target autocomplete on each row.
  // The "used" set above only carries templates that already appear on
  // a page; the designer's swap target may point at a layout that isn't
  // bound yet (the whole point of the swap is to indicate a future
  // template change). Lightweight columns only — `family` so the
  // datalist can show the family name as a hint.
  const [allTemplatesById, setAllTemplatesById] = useState<Record<string, WebContentTemplate>>({})
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('web_content_templates')
        .select('id, layer_name, family')
        .eq('is_published', true)
      if (cancelled) return
      const map: Record<string, WebContentTemplate> = {}
      for (const t of (data ?? []) as WebContentTemplate[]) map[t.id] = t
      setAllTemplatesById(map)
    })()
    return () => { cancelled = true }
  }, [])
  const allTemplatesSorted = useMemo(() =>
    Object.values(allTemplatesById).slice().sort((a, b) =>
      (a.layer_name ?? '').localeCompare(b.layer_name ?? '')),
    [allTemplatesById],
  )

  const byFamily = useMemo(() => {
    const m = new Map<string, WebContentTemplate[]>()
    for (const t of effectiveUsed) {
      if (!m.has(t.family)) m.set(t.family, [])
      m.get(t.family)!.push(t)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [effectiveUsed])

  /** Mutator wrappers used by the checklist UI. */
  const addExtraTemplate = (id: string) => {
    const current = new Set(spec.figma?.extra_template_ids ?? [])
    if (current.has(id)) return
    current.add(id)
    // If the designer is re-adding an auto-derived template they had
    // previously excluded, clear the exclusion too.
    const exclude = new Set(spec.figma?.excluded_template_ids ?? [])
    exclude.delete(id)
    void onAutoSave({
      ...spec,
      figma: {
        ...(spec.figma ?? {}),
        extra_template_ids:    [...current],
        excluded_template_ids: [...exclude],
      },
    })
  }
  const removeTemplate = (id: string, isAutoDerived: boolean) => {
    if (isAutoDerived) {
      // Auto-derived: add to excluded list so it filters out.
      const exclude = new Set(spec.figma?.excluded_template_ids ?? [])
      exclude.add(id)
      void onAutoSave({
        ...spec,
        figma: { ...(spec.figma ?? {}), excluded_template_ids: [...exclude] },
      })
    } else {
      // Extra: drop from extras + clear loaded-state.
      const extras = (spec.figma?.extra_template_ids ?? []).filter(x => x !== id)
      const loaded = (spec.figma?.loaded_template_ids ?? []).filter(x => x !== id)
      void onAutoSave({
        ...spec,
        figma: {
          ...(spec.figma ?? {}),
          extra_template_ids:  extras,
          loaded_template_ids: loaded,
        },
      })
    }
  }
  const usedIdsSet = useMemo(() => new Set(used.map(t => t.id)), [used])

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

      <p className="mt-4 text-[11.5px] text-wm-text-muted">
        The per-template <span className="font-semibold">load checklist + swap controls</span> now live on the
        dedicated <span className="font-semibold">Style Guide</span> tab — each row renders a live preview
        of an actual section using the layout so you can see partner content
        in context before checking it off or swapping.
      </p>
    </Section>
  )
}

/** Human-readable "where this template lands on the site" label.
 *
 *  - Pure chrome bindings (header/footer/megamenu/offcanvas) render
 *    as "Project chrome" so the designer knows they're not tied to
 *    any one page.
 *  - Per-page bindings list the pages by name. Truncate to the first
 *    5 to avoid blowing out the row height; remainder shown as
 *    "+N more".
 *  - Total instance count surfaces in parens when > 1 so the
 *    designer sees "this layout appears multiple times" without
 *    having to count the page list. */
function buildUsageLabel(usage: { pageNames: string[]; instances: number; isChrome: boolean }): string | null {
  const parts: string[] = []
  if (usage.pageNames.length > 0) {
    const headPages = usage.pageNames.slice(0, 5)
    const tail = usage.pageNames.length - headPages.length
    const pages = headPages.join(', ') + (tail > 0 ? ` +${tail} more` : '')
    const inst = usage.instances > usage.pageNames.length
      ? ` (${usage.instances} instances)`
      : ''
    parts.push(`Used on: ${pages}${inst}`)
  }
  if (usage.isChrome) {
    parts.push(usage.pageNames.length > 0 ? 'and project chrome' : 'Project chrome (header / footer / megamenu)')
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function TemplateLoadChecklist({
  loading, used, byFamily, usageByTemplate, usedIdsSet, loadedIds,
  swaps, savingSwap, onSwapText, allTemplates,
  onToggle, onSetAll, onAdd, onRemove,
}: {
  loading: boolean
  used: WebContentTemplate[]
  byFamily: Array<[string, WebContentTemplate[]]>
  usageByTemplate: Record<string, { pageNames: string[]; instances: number; isChrome: boolean }>
  /** Ids that come from the auto-derived `used` set (web_sections +
   *  chrome bindings). Used to know whether a row is auto OR designer-
   *  added so the remove button labels differently. */
  usedIdsSet: Set<string>
  loadedIds: string[]
  /** Site-wide layout swap map: { from_template_id: { to_template_id,
   *  to_template_label, ... } }. Merged in from the old standalone
   *  LayoutSwapBoard so designers can update layouts inline as they
   *  walk the load checklist. */
  swaps: StrategyWebProject['figma_layout_swaps']
  /** Template id currently being saved — shows a spinner next to its
   *  swap input until the write completes. */
  savingSwap: string | null
  /** Save / clear a swap target by free-text input. Empty string
   *  clears. Non-empty string is matched against the catalog by
   *  layer_name; an unmatched string is kept as a free-text label. */
  onSwapText: (fromTemplateId: string, text: string) => void
  /** Full catalog for the row-level swap autocomplete (datalist). */
  allTemplates: WebContentTemplate[]
  onToggle: (id: string, next: boolean) => void
  onSetAll: (ids: string[], next: boolean) => void
  onAdd: (id: string) => void
  onRemove: (id: string, isAutoDerived: boolean) => void
}) {
  const loadedSet = useMemo(() => new Set(loadedIds), [loadedIds])
  const loadedCount = used.filter(t => loadedSet.has(t.id)).length
  const [showAdd, setShowAdd] = useState(false)

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
                    const usage = usageByTemplate[t.id]
                    const isAutoDerived = usedIdsSet.has(t.id)
                    const isSynthetic   = t.id.startsWith('__')
                    const pageLabel = usage
                      ? buildUsageLabel(usage)
                      : (isAutoDerived || isSynthetic
                          ? null
                          : 'Designer-added (not bound to a section)')
                    // Swap input visibility: only real Brixies templates
                    // can be swapped (synthetic nav rows have no source
                    // layout to replace).
                    const swapEntry = !isSynthetic && (swaps?.[t.id] ?? null)
                    const swapDisplayValue = swapEntry
                      ? (swapEntry.to_template_label ?? '')
                      : ''
                    const isSavingSwap = savingSwap === t.id
                    return (
                      <li key={t.id} className="group">
                        <div className="flex items-stretch">
                          <label className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-wm-bg-hover/40 transition-colors flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => onToggle(t.id, e.target.checked)}
                              className="accent-wm-accent cursor-pointer mt-[3px]"
                            />
                            <div className="min-w-0 flex-1">
                              <p className={[
                                'text-[11px] font-mono',
                                checked ? 'text-wm-text-subtle line-through' : 'text-wm-text',
                              ].join(' ')}>
                                {t.layer_name}
                                {!isAutoDerived && !isSynthetic && (
                                  <span className="ml-2 text-[9px] uppercase tracking-widest font-bold text-wm-accent">added</span>
                                )}
                              </p>
                              {pageLabel && (
                                <p className="text-[10px] text-wm-text-muted leading-snug mt-0.5">
                                  {pageLabel}
                                </p>
                              )}
                            </div>
                          </label>
                          {!isSynthetic && (
                            <button
                              type="button"
                              onClick={() => onRemove(t.id, isAutoDerived)}
                              title={isAutoDerived
                                ? 'Remove from checklist (the section binding stays; this template just won\'t appear here).'
                                : 'Remove this designer-added template from the checklist.'}
                              className="px-2 text-wm-text-subtle hover:text-wm-danger opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label={`Remove ${t.layer_name} from checklist`}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                        {!isSynthetic && (
                          <div className="px-3 pb-2 -mt-0.5 flex items-center gap-2">
                            <ArrowRight size={11} className="text-wm-text-subtle shrink-0 ml-5" />
                            <span className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle shrink-0">Swap to</span>
                            <input
                              type="text"
                              list={`tpl-options-${t.id}`}
                              defaultValue={swapDisplayValue}
                              key={swapDisplayValue}
                              onBlur={e => onSwapText(t.id, e.target.value)}
                              placeholder="Type a Brixies template name (or leave blank to keep this layout)"
                              disabled={isSavingSwap}
                              className="flex-1 min-w-0 text-[11px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-0.5 focus:border-wm-accent focus:outline-none disabled:opacity-50"
                            />
                            <datalist id={`tpl-options-${t.id}`}>
                              {allTemplates.map(opt => (
                                <option key={opt.id} value={opt.layer_name}>{opt.family ?? '(uncategorized)'}</option>
                              ))}
                            </datalist>
                            {swapEntry && (
                              <button
                                type="button"
                                onClick={() => onSwapText(t.id, '')}
                                className="text-wm-text-muted hover:text-wm-danger shrink-0"
                                title="Clear swap"
                              >
                                <X size={11} />
                              </button>
                            )}
                            {isSavingSwap && <Loader2 size={11} className="animate-spin text-wm-accent shrink-0" />}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
          <div className="pt-1">
            {showAdd ? (
              <AddTemplateRow
                onAdd={(id) => { onAdd(id); setShowAdd(false) }}
                onCancel={() => setShowAdd(false)}
                excludeIds={used.map(t => t.id)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="text-[11px] font-medium text-wm-accent hover:text-wm-accent-strong inline-flex items-center gap-1"
              >
                <Plus size={11} /> Add template the designer used
              </button>
            )}
            <p className="mt-1 text-[10.5px] text-wm-text-subtle leading-snug">
              Designer-added templates show in the checklist alongside auto-derived ones.
              Hover any row + click <X size={9} className="inline" /> to remove from the checklist
              if a template was swapped during design.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline search-and-pick for designer-added templates. Queries
 *  web_content_templates by layer_name; excludes ids already on the
 *  checklist so duplicates don't appear. */
function AddTemplateRow({ onAdd, onCancel, excludeIds }: {
  onAdd: (id: string) => void
  onCancel: () => void
  excludeIds: string[]
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; layer_name: string; family: string }>>([])
  const [searching, setSearching] = useState(false)
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds])
  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('web_content_templates')
        .select('id, layer_name, family')
        .eq('is_published', true)
        .ilike('layer_name', `%${q.trim()}%`)
        .order('layer_name')
        .limit(15)
      if (!cancelled) {
        setResults(((data ?? []) as Array<{ id: string; layer_name: string; family: string }>)
          .filter(r => !excludeSet.has(r.id)))
        setSearching(false)
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, excludeSet])
  return (
    <div className="rounded border border-wm-accent/40 bg-wm-accent-tint/20 p-2">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Brixies templates by layer name…"
          className="flex-1 text-[12px] font-mono px-2 py-1 rounded border border-wm-border bg-wm-bg-elevated focus:outline-none focus:border-wm-accent"
          autoFocus
        />
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-wm-text-muted hover:text-wm-text"
        >
          Cancel
        </button>
      </div>
      {searching && <p className="text-[11px] text-wm-text-subtle">Searching…</p>}
      {!searching && q.trim() && results.length === 0 && (
        <p className="text-[11px] text-wm-text-subtle italic">No matches.</p>
      )}
      {results.length > 0 && (
        <ul className="divide-y divide-wm-border/40 border border-wm-border rounded bg-wm-bg-elevated">
          {results.map(r => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onAdd(r.id)}
                className="flex items-center justify-between gap-2 w-full px-2.5 py-1.5 text-left hover:bg-wm-bg-hover/40"
              >
                <span className="text-[11px] font-mono text-wm-text truncate">{r.layer_name}</span>
                <span className="text-[10px] text-wm-text-subtle shrink-0">{r.family}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Figma plugin generators ────────────────────────────────────────
// (Removed FigmaPluginGeneratorSection — replaced by SquadFigmaPluginSection
//  below, which ships a real per-project Figma plugin via manifest import
//  instead of paste-into-console scripts.)

// ── Squad — Web Builder (Figma plugin, next-gen) ───────────────────
//
// Next-gen Figma plugin distributed as a local-dev manifest. Replaces
// the paste-into-console scripts above with a proper Figma plugin that
// imports Brixies templates via the public API (importComponentByKey /
// importComponentSetByKey), detaches the team-library instance, and
// promotes each to a local component stamped with the original Brixies
// key. The plugin authenticates against /api/figma/project-export with
// a per-project bearer token surfaced from this card.
//
// Token is stored on strategy_web_projects.figma_share_token. Generate
// mints a fresh uuid; Revoke sets it back to NULL.

function SquadFigmaPluginSection({
  project, onChange,
}: {
  project: StrategyWebProject
  onChange: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const token = project.figma_share_token ?? null

  /** Personalize + zip the plugin folder client-side. Replaces the
   *  __SQD_*__ placeholders inside manifest.json / code.js / README.md
   *  with the project's values so the designer pastes nothing in
   *  Figma. If no token exists yet, mints one as part of the click —
   *  one button does the whole "generate + download" flow. */
  const downloadPlugin = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // Ensure we have a token; mint one on demand.
      let activeToken = token
      if (!activeToken) {
        activeToken = crypto.randomUUID()
        const { error: tokenErr } = await supabase
          .from('strategy_web_projects')
          .update({ figma_share_token: activeToken })
          .eq('id', project.id)
        if (tokenErr) throw new Error(tokenErr.message)
      }

      const rawName = project.church_short_name || project.name || 'Project'
      // Strip characters that would need different escaping rules in
      // JSON vs JS-single-quoted contexts. Real project names don't
      // contain quotes/backslashes — strip defensively rather than
      // emit per-context escapes.
      const projectName = rawName.replace(/[\\"'\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim() || 'Project'
      const projectIdShort = project.id.slice(0, 8)
      const host = window.location.origin

      // Raw-import the plugin file templates at build time so they
      // ship inside the bundle — no repo clone, no deploy step.
      const [{ zipSync, strToU8 }, manifestText, codeText, uiText, readmeText] = await Promise.all([
        import('fflate'),
        import('../../../../figma-plugin/manifest.json?raw').then(m => m.default),
        import('../../../../figma-plugin/code.js?raw').then(m => m.default),
        import('../../../../figma-plugin/ui.html?raw').then(m => m.default),
        import('../../../../figma-plugin/README.md?raw').then(m => m.default),
      ])

      const replacements: Record<string, string> = {
        __SQD_HOST__:              host,
        __SQD_PROJECT_ID__:        project.id,
        __SQD_PROJECT_ID_SHORT__:  projectIdShort,
        __SQD_TOKEN__:             activeToken,
        __SQD_PROJECT_NAME__:      projectName,
      }
      const fill = (s: string) => Object.entries(replacements).reduce(
        (acc, [k, v]) => acc.split(k).join(v),
        s,
      )

      const folderSlug = `sqd-web-${projectIdShort}`
      const zipped = zipSync({
        [`${folderSlug}/manifest.json`]: strToU8(fill(manifestText)),
        [`${folderSlug}/code.js`]:       strToU8(fill(codeText)),
        [`${folderSlug}/ui.html`]:       strToU8(fill(uiText)),
        [`${folderSlug}/README.md`]:     strToU8(fill(readmeText)),
      })
      const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${folderSlug}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      if (!token) await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [project, token, onChange])

  const regenerate = useCallback(async () => {
    if (!confirm(
      "Regenerate the share token?\n\nThe currently-installed plugin folder (with the old token baked in) will stop working. " +
      "You'll need to re-download the zip and replace the folder on every machine that has it installed.",
    )) return
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ figma_share_token: crypto.randomUUID() })
      .eq('id', project.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    await onChange()
  }, [project.id, onChange])

  const revoke = useCallback(async () => {
    if (!confirm(
      'Revoke the share token?\n\nAny installed plugin folder will stop working immediately. ' +
      'Re-issue by clicking Download plugin again.',
    )) return
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ figma_share_token: null })
      .eq('id', project.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    await onChange()
  }, [project.id, onChange])

  return (
    <Section title="Squad — Web Builder (Figma plugin)" icon={<KeyRound size={13} />}>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Per-project Figma plugin. The zip below is personalized for this
        project — its API credentials are baked into the files inside, so
        the designer pastes nothing in Figma. Each project gets its own
        zip, its own plugin install, and its own bearer token.
      </p>

      <div className="rounded-md border border-wm-border bg-wm-bg-hover px-3 py-2 text-[12px] text-wm-text mb-3">
        <p className="font-semibold mb-1">Install (per project, per machine)</p>
        <ol className="list-decimal pl-5 space-y-0.5 text-wm-text-muted">
          <li>Click <span className="text-wm-text">Download plugin</span> below.</li>
          <li>Unzip the folder somewhere stable (e.g. <code className="text-[11px]">~/Figma Plugins/&lt;project&gt;/</code>). Figma reads from disk every run, so don't move or delete it.</li>
          <li>Figma <span className="text-wm-text">desktop</span> → Menu → Plugins → Development → <span className="text-wm-text">Import plugin from manifest…</span> → pick <code className="text-[11px]">manifest.json</code> inside the folder.</li>
          <li>Open the Figma file you want to design in. Enable <span className="text-wm-text">Brixies Library ACSS [PRO]</span> in Assets → Libraries.</li>
          <li>Plugins → Development → <span className="text-wm-text">Squad — {project.church_short_name || project.name}</span>. Run it. No paste required.</li>
        </ol>
        <p className="mt-2 text-wm-text-subtle">If the token is regenerated or revoked, re-download and replace the folder in place — keep the path the same so Figma's import still resolves.</p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 text-[11.5px] text-wm-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <WMButton
          variant="primary"
          size="md"
          iconLeft={busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          onClick={() => void downloadPlugin()}
          disabled={busy}
        >
          {token ? 'Download plugin (.zip)' : 'Generate token & download'}
        </WMButton>
        {token && (
          <>
            <WMButton
              variant="ghost"
              size="md"
              iconLeft={<RefreshCw size={13} />}
              onClick={() => void regenerate()}
              disabled={busy}
            >
              Regenerate token
            </WMButton>
            <WMButton
              variant="ghost"
              size="md"
              iconLeft={<X size={13} />}
              onClick={() => void revoke()}
              disabled={busy}
            >
              Revoke
            </WMButton>
          </>
        )}
      </div>
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

/** Images — top-level section wrapping the folder URL field + the
 *  per-page image count rollup. The folder URL stayed the same; the
 *  per-page count is computed by walking every page's bound sections
 *  and counting `image`-typed slots in each section's template fields. */
function ImagesSection({
  projectId, spec, onAutoSave,
}: {
  projectId: string
  spec: DesignSystemSpec
  onAutoSave: (s: DesignSystemSpec) => Promise<void>
}) {
  return (
    <Section title="Images" icon={<FolderOpen size={13} />}>
      <OrganizedImagesFolderSubsection spec={spec} onAutoSave={onAutoSave} />
      <div className="h-px bg-wm-border my-5" />
      <ImageCountChecklist projectId={projectId} />
    </Section>
  )
}

function OrganizedImagesFolderSubsection({
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
    <div>
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
        Organized image folder
      </p>
      <p className="text-[12px] text-wm-text-muted mb-3">
        One link to the prepared imagery for this project (Drive, Dropbox,
        Notion gallery, etc.). Surfaced on Dev Handoff as well.
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
    </div>
  )
}

/** Per-page rollup of image slots needed. For each page in the
 *  project, walks its bound sections + the section's content_template
 *  schema to count slots with `type: 'image'`. Renders as a checklist:
 *  page name + total image slots + a "done" toggle the designer can
 *  flip once the folder has all the assets. The toggle is persisted
 *  on the page itself via web_pages.images_ready boolean (added in
 *  v87 — additive nullable). */
function ImageCountChecklist({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Array<{
    page_id: string; name: string; slug: string;
    image_count: number; images_ready: boolean;
  }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyPageId, setBusyPageId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: pageRows } = await supabase
      .from('web_pages')
      .select('id, name, slug, sort_order, images_ready')
      .eq('web_project_id', projectId)
      .eq('archived', false)
      .order('sort_order')
    // Drop single-* catch-all template pages (single-event, single-staff,
    // single-sermon, etc.). Their image slots are shared with their
    // parent listing — counting them inflates the per-project total and
    // confuses the designer about what they actually need to produce.
    const allPages = (pageRows ?? []) as Array<{ id: string; name: string; slug: string; sort_order: number; images_ready: boolean | null }>
    const pages = allPages.filter(p => !p.slug.startsWith('single-'))
    if (pages.length === 0) {
      setRows([])
      setLoading(false)
      return
    }
    const { data: secRows } = await supabase
      .from('web_sections')
      .select('id, web_page_id, content_template_id')
      .in('web_page_id', pages.map(p => p.id))
    const sections = (secRows ?? []) as Array<{ id: string; web_page_id: string; content_template_id: string | null }>
    const tplIds = Array.from(new Set(sections.map(s => s.content_template_id).filter(Boolean) as string[]))
    const tplFieldsById = new Map<string, unknown>()
    if (tplIds.length > 0) {
      const { data: tplRows } = await supabase
        .from('web_content_templates')
        .select('id, fields')
        .in('id', tplIds)
      for (const t of (tplRows ?? []) as Array<{ id: string; fields: unknown }>) {
        tplFieldsById.set(t.id, t.fields)
      }
    }
    const out = pages.map(p => {
      const pageSections = sections.filter(s => s.web_page_id === p.id)
      let count = 0
      for (const s of pageSections) {
        if (!s.content_template_id) continue
        const fields = tplFieldsById.get(s.content_template_id)
        count += countImageSlots(fields)
      }
      return {
        page_id: p.id, name: p.name, slug: p.slug,
        image_count: count,
        images_ready: !!p.images_ready,
      }
    })
    setRows(out)
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const toggleReady = async (pageId: string, next: boolean) => {
    setBusyPageId(pageId)
    const { error } = await supabase.from('web_pages').update({ images_ready: next }).eq('id', pageId)
    if (!error) {
      setRows(prev => prev?.map(r => r.page_id === pageId ? { ...r, images_ready: next } : r) ?? null)
    }
    setBusyPageId(null)
  }

  const totalImages = rows?.reduce((sum, r) => sum + r.image_count, 0) ?? 0
  const totalReady  = rows?.filter(r => r.images_ready).length ?? 0
  const totalPagesWithImages = rows?.filter(r => r.image_count > 0).length ?? 0

  // Split per-staff bio pages out of the main flat list — they share a
  // common template + bio image, and 12+ identical rows in a per-page
  // checklist crowd out the unique pages the designer actually needs
  // to triage. Roll them under one accordion that toggles to reveal
  // the individual rows.
  const mainRows  = (rows ?? []).filter(r => !r.slug.startsWith('staff/'))
  const staffRows = (rows ?? []).filter(r =>  r.slug.startsWith('staff/'))
  const staffImageCount = staffRows.reduce((sum, r) => sum + r.image_count, 0)
  const staffReadyCount = staffRows.filter(r => r.images_ready).length
  const [staffOpen, setStaffOpen] = useState(false)

  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
        Image count
      </p>
      <p className="text-[12px] text-wm-text-muted mb-3">
        Per-page count of image slots in bound section templates. Check off
        each page once the corresponding images are in the folder.
        Single-* templates (single-event, single-staff, etc.) aren't
        counted — their image slots are shared with the listing page they
        pair with.
      </p>
      {loading && <p className="text-[12px] text-wm-text-subtle">Loading…</p>}
      {!loading && rows && rows.length === 0 && (
        <p className="text-[12px] text-wm-text-subtle italic">No pages yet on this project.</p>
      )}
      {!loading && rows && rows.length > 0 && (
        <>
          <div className="mb-2 text-[11px] text-wm-text-muted">
            <strong>{totalImages}</strong> image{totalImages === 1 ? '' : 's'} across{' '}
            <strong>{totalPagesWithImages}</strong> page{totalPagesWithImages === 1 ? '' : 's'} ·{' '}
            <strong>{totalReady}</strong> / {totalPagesWithImages} marked ready
          </div>
          <ul className="divide-y divide-wm-border border border-wm-border rounded-md bg-wm-bg-elevated">
            {mainRows.map(r => (
              <li key={r.page_id} className="flex items-center justify-between px-3 py-2 gap-3">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.images_ready}
                    disabled={busyPageId === r.page_id || r.image_count === 0}
                    onChange={(e) => void toggleReady(r.page_id, e.target.checked)}
                    className="rounded border-wm-border accent-wm-accent"
                  />
                  <span className={`text-[13px] truncate ${r.image_count === 0 ? 'text-wm-text-subtle' : 'text-wm-text'}`}>
                    {r.name}
                    <span className="text-wm-text-subtle ml-1">/{r.slug}</span>
                  </span>
                </label>
                <span className={`text-[11px] font-mono ${r.image_count === 0 ? 'text-wm-text-subtle' : 'text-wm-text-muted'}`}>
                  {r.image_count} image{r.image_count === 1 ? '' : 's'}
                </span>
              </li>
            ))}
            {staffRows.length > 0 && (
              <li className="bg-wm-bg-hover/30">
                <button
                  type="button"
                  onClick={() => setStaffOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 gap-3 text-left hover:bg-wm-bg-hover/60 transition-colors"
                  aria-expanded={staffOpen}
                >
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    {staffOpen
                      ? <ChevronDown size={12} className="text-wm-text-muted shrink-0" />
                      : <ChevronRight size={12} className="text-wm-text-muted shrink-0" />}
                    <span className="text-[13px] font-semibold text-wm-text">
                      Individual staff bio pages
                      <span className="ml-1.5 text-[11px] font-normal text-wm-text-subtle">
                        ({staffRows.length} page{staffRows.length === 1 ? '' : 's'} · {staffReadyCount} / {staffRows.length} ready)
                      </span>
                    </span>
                  </span>
                  <span className="text-[11px] font-mono text-wm-text-muted shrink-0">
                    {staffImageCount} image{staffImageCount === 1 ? '' : 's'}
                  </span>
                </button>
                {staffOpen && (
                  <ul className="divide-y divide-wm-border/40 border-t border-wm-border/40">
                    {staffRows.map(r => (
                      <li key={r.page_id} className="flex items-center justify-between px-3 py-1.5 gap-3 pl-9">
                        <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={r.images_ready}
                            disabled={busyPageId === r.page_id || r.image_count === 0}
                            onChange={(e) => void toggleReady(r.page_id, e.target.checked)}
                            className="rounded border-wm-border accent-wm-accent"
                          />
                          <span className={`text-[12.5px] truncate ${r.image_count === 0 ? 'text-wm-text-subtle' : 'text-wm-text'}`}>
                            {r.name}
                            <span className="text-wm-text-subtle ml-1">/{r.slug}</span>
                          </span>
                        </label>
                        <span className={`text-[11px] font-mono ${r.image_count === 0 ? 'text-wm-text-subtle' : 'text-wm-text-muted'}`}>
                          {r.image_count} image{r.image_count === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}

/** Recursive: count every `type: 'image'` slot in a template's
 *  fields[]. Descends into `item_schema` for groups so cards with
 *  image slots register. */
function countImageSlots(fields: unknown): number {
  if (!Array.isArray(fields)) return 0
  let n = 0
  for (const f of fields as Array<Record<string, unknown>>) {
    if (f.kind === 'slot' && f.type === 'image') n += 1
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      n += countImageSlots(f.item_schema)
    }
  }
  return n
}

// ── Brand handoff cross-load sections ───────────────────────────────
//
// Three cards lifted from the Brand Squad's BrandHandoffPage so the
// designer working in the Web Manager sees the same source material
// without bouncing between surfaces. Visual style adapted to the WM
// (WMCard + wm-* tokens) but layout + grouping mirror the brand
// handoff verbatim.

function BrandGuideLibraryDesignSection({ guides }: { guides: MemberBrandGuides }) {
  const sqdEntries = guides.entries.filter(e => e.kind !== 'standards')
  const standardsEntries = guides.entries.filter(e => e.kind === 'standards')
  return (
    <Section title="Brand guide library" icon={<BookOpen size={13} />}>
      {sqdEntries.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1.5">
            New SQD brand guides
          </p>
          <div className="flex flex-col gap-1.5">
            {sqdEntries.map((e, i) => <BrandGuideLibraryRow key={`sqd-${i}`} entry={e} />)}
          </div>
        </div>
      )}
      {standardsEntries.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-amber-700 mb-1.5">
            Live on Standards
          </p>
          <div className="flex flex-col gap-1.5">
            {standardsEntries.map((e, i) => <BrandGuideLibraryRow key={`std-${i}`} entry={e} />)}
          </div>
        </div>
      )}
    </Section>
  )
}

function BrandGuideLibraryRow({ entry }: { entry: BrandGuideEntry }) {
  const isSub = entry.kind === 'sqd-sub'
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        entry.legacy
          ? 'border-amber-200 bg-amber-50/40 text-amber-900 hover:border-amber-300'
          : 'border-wm-border bg-wm-bg-elevated text-wm-text hover:border-wm-accent hover:text-wm-accent-strong',
      ].join(' ')}
    >
      {isSub && <span aria-hidden className="text-wm-text-subtle">↳</span>}
      <BookOpen size={12} className={`shrink-0 ${entry.legacy ? 'text-amber-700' : 'text-wm-accent'}`} />
      <span className="flex-1 min-w-0 truncate font-semibold">{entry.label}</span>
      <ExternalLink size={11} className={entry.legacy ? 'text-amber-700/70 shrink-0' : 'text-wm-text-muted shrink-0'} />
    </a>
  )
}

function BrandLogosDesignSection({
  logos, assetsZipUrl,
}: {
  logos: StrategyBrandLogo[]
  assetsZipUrl: string | null
}) {
  return (
    <Section title="Logos" icon={<ImageIcon size={13} />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {logos.map(logo => {
          const src = logo.preview_url
          const dl = logo.download_url ?? logo.preview_url
          const animUrl = logo.animation_url ?? null
          return (
            <div
              key={logo.id}
              className="group rounded-lg border border-wm-border bg-wm-bg-elevated p-3 flex flex-col hover:border-wm-accent transition-colors relative"
            >
              {animUrl && (
                <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-wm-accent-tint text-wm-accent-strong text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 z-10">
                  ▶ Motion
                </span>
              )}
              <a
                href={dl ?? '#'}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <div className="h-20 flex items-center justify-center rounded bg-wm-bg-hover/40 mb-2 overflow-hidden">
                  {src && !src.endsWith('.mp4') && (
                    <img src={src} alt={logo.label ?? logo.kind} className="max-h-full max-w-full object-contain" />
                  )}
                </div>
                <p className="text-[11px] font-semibold text-wm-text truncate">{logo.label ?? logo.kind}</p>
                <p className="text-[10px] text-wm-text-subtle mt-0.5 inline-flex items-center gap-1">
                  <Download size={9} /> Still
                </p>
              </a>
              {animUrl && (
                <a
                  href={animUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-wm-accent-strong mt-0.5 inline-flex items-center gap-1 hover:underline"
                >
                  <Download size={9} /> Animation
                </a>
              )}
            </div>
          )
        })}
      </div>
      {assetsZipUrl && (
        <a
          href={assetsZipUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-full bg-wm-accent-strong text-white px-3 py-1.5 hover:bg-wm-accent transition-colors"
        >
          <Download size={11} /> Full asset package (.zip)
        </a>
      )}
    </Section>
  )
}

function BrandElementsDesignSection({ elements }: { elements: StrategyBrandElement[] }) {
  const KIND_LABEL: Record<string, string> = {
    pattern:     'Pattern',
    texture:     'Texture',
    application: 'Application',
  }
  return (
    <Section title="Elements & application" icon={<Sparkles size={13} />}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {elements.map(el => (
          <div key={el.id} className="rounded-lg border border-wm-border overflow-hidden bg-wm-bg-elevated">
            {el.preview_url && (
              <div className="h-32 bg-wm-bg-hover/40 flex items-center justify-center overflow-hidden">
                <img
                  src={el.preview_url}
                  alt={el.label ?? el.kind}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-0.5">
                {KIND_LABEL[el.kind] ?? el.kind}
              </p>
              {el.label && (
                <p className="text-xs font-semibold text-wm-text truncate">{el.label}</p>
              )}
              {el.download_url && (
                <a
                  href={el.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-[11px] text-wm-accent-strong hover:underline"
                >
                  <Download size={10} /> Download
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'token'
}
