/**
 * Copywriter page output importer.
 *
 * The "page brief" format that cowork emits has been superseded for
 * pages where the copywriter has already done the binding work — the
 * new format ships page-level metadata + a flat list of sections
 * where each section already names its target template and ships
 * ready-to-write field_values. We import it directly: look up the
 * template by id, write the values, no auto-bind step needed.
 *
 * Detection is heuristic — the strategist can paste either format
 * into the same modal. We sniff `strategic_setup` + per-section
 * `template_id` + `field_values` to decide whether this is a
 * copywriter output vs a legacy brief.
 *
 * The format also carries:
 *   · strategic_setup → SEO / AEO data → web_pages.seo
 *   · section_job / voice_notes_from_copywriter / alternatives_considered
 *     / atoms_lifted_canonical → stashed onto web_sections.notes as a
 *     JSON blob keyed under `copywriter_context`
 *   · mechanical_scan_log / gaps_flagged / kickbacks_to_copywriter →
 *     surfaced as validation messages in the import modal (informational
 *     only; do not block import)
 */

import { supabase } from './supabase'
import { isButtonShapedSlot } from './cta'
import { parseCuratedLibrary, getEffectiveLibraryIds } from './webCuratedLibrary'
import { augmentTemplate } from './webBrixiesSchemaAugment'
import {
  pairSections, loadProjectSiteState, augmentCatalog,
  type SectionPairResult, type SectionPairInput,
} from './webBrixiesPairer'
import {
  recordBindTelemetry, computeMatchedSlotKeys, collectPaletteTemplateIds,
  emptyReconcileTelemetry, type BindTelemetryRecord,
} from './webBindTelemetry'
import {
  reconcileFieldValuesAcrossTemplates,
  valuesToDocHtmlByShape,
  docHtmlToFieldValues,
  computeUnmappedValues,
  computeDroppedDeepPaths,
  mergeFieldValuesPreferNonEmpty,
} from './webBrixiesDoc'
import type {
  StrategyWebProject, WebPageSeo, WebPageContentStatus,
  WebContentTemplate, WebFieldDef,
} from '../types/database'

// ── Format ──────────────────────────────────────────────────────────

export interface CopywriterSection {
  sort_order:    number
  concept_id?:   string
  template_id:   string
  section_job?:  string
  tagline_strategy?: string | null
  field_values:  Record<string, unknown>
  alternatives_considered?: Record<string, unknown>
  atoms_lifted_canonical?:  string[]
  voice_notes_from_copywriter?: string
  [k: string]: unknown
}

export interface CopywriterStrategicSetup {
  metadata_title?:       string
  metadata_description?: string
  aeo_smart_snippet?:    string
  [k: string]: unknown
}

export interface CopywriterMechanicalScanEntry {
  section_sort: number
  slot:         string
  issue:        string
  fix?:         string
}

/** Plain-language rewrite of a mechanical_scan_log entry. The raw
 *  `issue` / `fix` strings the copywriter emits are written for the
 *  next pipeline stage to consume — they reference internal field
 *  names (default_count, schema, slot) that aren't strategist-
 *  friendly. The modal prefers `headline` + `advice`; both surfaces
 *  expose the raw `issue` behind a "Technical detail" expander. */
export interface FriendlyScanMessage {
  /** One-sentence headline framed as what the user is looking at. */
  headline: string
  /** What the user should DO (or do nothing — just verify after import). */
  advice:   string
  /** Severity gate for the UI — 'verify' means "probably fine, eyeball
   *  it"; 'action' means "this won't render without a swap". */
  severity: 'verify' | 'action'
  /** Untouched copy from the copywriter, kept for the technical-detail
   *  expander so power users see exactly what was flagged. */
  technical: string
}

export function friendlyScanMessage(entry: CopywriterMechanicalScanEntry): FriendlyScanMessage {
  const issue = entry.issue ?? ''
  const technical = entry.fix ? `${issue}\n${entry.fix}` : issue

  // Pattern 1: default_count mismatch — the renderer reads however
  // many items are in the array, so this is almost always fine.
  // Flag for verification, not action.
  if (/default_count/i.test(issue) || /variable-count repeats/i.test(issue)) {
    const countMatch = issue.match(/\b(\d+)\s+(?:step|item|card)/i)
    const provided = countMatch ? countMatch[1] : 'more'
    return {
      headline: `Section ${entry.section_sort} has ${provided} items in "${entry.slot}", more than this template's default.`,
      advice:   `Should render fine — our editor accepts any item count. After import, scan the section to confirm all items show. If they're cut off, use the template dropdown above to pick a layout sized for ${provided} items.`,
      severity: 'verify',
      technical,
    }
  }

  // Pattern 2: missing slot — the template literally has no place
  // for this content, so the data is lost unless they swap.
  if (/no\s+\w*\s*slot/i.test(issue) || /no buttons or CTA slot/i.test(issue) || /no matching slot/i.test(issue)) {
    return {
      headline: `Section ${entry.section_sort}: this template has no slot for "${entry.slot}".`,
      advice:   `The content the copywriter wrote for "${entry.slot}" won't render with this template. Use the template dropdown above to pick a variant that includes a ${entry.slot.toLowerCase()} slot before importing.`,
      severity: 'action',
      technical,
    }
  }

  // Generic fallback — show the issue verbatim but at least frame it
  // as "the copywriter flagged this".
  return {
    headline: `Section ${entry.section_sort}: the copywriter flagged "${entry.slot}".`,
    advice:   'Review the technical detail below and decide whether to swap templates.',
    severity: 'action',
    technical,
  }
}

export interface CopywriterGap {
  section_sort: number
  note:         string
}

export interface CopywriterKickback {
  section_sort?: number
  note?:         string
  [k: string]:   unknown
}

export interface CopywriterPageOutput {
  page_title:        string
  page_slug:         string
  primary_persona?:  string
  strategic_setup?:  CopywriterStrategicSetup
  sections:          CopywriterSection[]
  mechanical_scan_log?:    CopywriterMechanicalScanEntry[]
  kickbacks_to_copywriter?: CopywriterKickback[]
  gaps_flagged?:           CopywriterGap[]
  [k: string]: unknown
}

/** True when the parsed JSON looks like a copywriter output (vs the
 *  legacy brief format). Detection markers, in priority order:
 *  - has `strategic_setup`
 *  - has `sections` whose elements carry `template_id` + `field_values`
 *  - has `mechanical_scan_log` or `gaps_flagged` (cowriter-only) */
export function isCopywriterPageOutput(parsed: unknown): parsed is CopywriterPageOutput {
  if (!parsed || typeof parsed !== 'object') return false
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.sections) || obj.sections.length === 0) return false
  if (typeof obj.page_slug !== 'string') return false
  if (obj.strategic_setup && typeof obj.strategic_setup === 'object') return true
  if (Array.isArray(obj.mechanical_scan_log)) return true
  if (Array.isArray(obj.gaps_flagged))        return true
  const first = obj.sections[0] as Record<string, unknown>
  return typeof first.template_id === 'string'
      && typeof first.field_values === 'object'
      && first.field_values !== null
}

/** Multi-page copywriter output — same shape the legacy brief bundle
 *  uses (`{pages: [...]}`), but each page carries the copywriter
 *  output structure. */
export interface CopywriterPageBundle {
  pages: CopywriterPageOutput[]
  [k: string]: unknown
}

/** True when the JSON is `{pages: [...]}` AND every page looks like a
 *  copywriter output (so we can route it through the copywriter import
 *  path instead of the legacy brief bundle importer). */
export function isCopywriterPageBundle(parsed: unknown): parsed is CopywriterPageBundle {
  if (!parsed || typeof parsed !== 'object') return false
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.pages) || obj.pages.length === 0) return false
  return obj.pages.every(p => isCopywriterPageOutput(p))
}

// ── Normalization ───────────────────────────────────────────────────

/** Best-effort derivation of a human page title from copywriter output
 *  that didn't ship a top-level `page_title`. Cowork's web-page-
 *  formatter-v2 puts the title under `strategic_setup.metadata_title`
 *  instead (with a " | Church Name" suffix), and some pages only ship a
 *  slug. Resolution order:
 *    1. Top-level `page_title` if non-empty.
 *    2. First " | "-delimited segment of `strategic_setup.metadata_title`
 *       — strips the SEO suffix so we get "Plan Your Visit" not
 *       "Plan Your Visit | Church Name | City".
 *    3. Humanized `page_slug` — e.g. "/about/our-story" → "Our Story".
 *    4. Empty string when nothing usable is available; the validator
 *       will then surface a hard error. */
export function derivePageTitle(out: CopywriterPageOutput): string {
  const fromTitle = out.page_title?.trim()
  if (fromTitle) return fromTitle

  const meta = out.strategic_setup?.metadata_title?.trim()
  if (meta) {
    const first = meta.split('|')[0]?.trim()
    if (first) return first
  }

  const slug = out.page_slug?.trim() ?? ''
  if (slug) {
    const last = slug.split('/').filter(Boolean).pop() ?? ''
    if (last) {
      return last
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    }
  }
  return ''
}

/** In-place fill of derivable defaults the copywriter output can omit.
 *  Today: `page_title`. Run before validation + import so both surfaces
 *  see the resolved title. Idempotent. */
export function normalizeCopywriterPageOutput(out: CopywriterPageOutput): CopywriterPageOutput {
  if (!out.page_title?.trim()) {
    const derived = derivePageTitle(out)
    if (derived) out.page_title = derived
  }
  return out
}

// ── Validation ──────────────────────────────────────────────────────

export interface CopywriterValidationIssue {
  severity: 'error' | 'warning' | 'info'
  scope:    string
  message:  string
}

export interface CopywriterValidationReport {
  valid:  boolean
  issues: CopywriterValidationIssue[]
  /** Section template_ids that didn't resolve to a real
   *  web_content_templates row. */
  unresolved_template_ids: string[]
  /** Template ids that resolved successfully (id → layer_name). */
  resolved_templates: Record<string, string>
}

export async function validateCopywriterPageOutput(
  out: CopywriterPageOutput,
  project: StrategyWebProject,
): Promise<CopywriterValidationReport> {
  void project
  const issues: CopywriterValidationIssue[] = []
  if (!out.page_slug?.trim()) {
    issues.push({ severity: 'error', scope: 'page', message: 'page_slug is required.' })
  }
  if (!out.page_title?.trim()) {
    issues.push({ severity: 'error', scope: 'page', message: 'page_title is required.' })
  }
  // Resolve every section's template_id in one go.
  const tplIds = Array.from(new Set(out.sections.map(s => s.template_id).filter(Boolean)))
  let resolved: Record<string, string> = {}
  let unresolved: string[] = []
  if (tplIds.length > 0) {
    const { data, error } = await supabase
      .from('web_content_templates')
      .select('id, layer_name')
      .in('id', tplIds)
    if (error) {
      issues.push({ severity: 'error', scope: 'templates', message: `Template lookup failed: ${error.message}` })
    } else {
      const rows = (data ?? []) as Array<{ id: string; layer_name: string }>
      resolved = Object.fromEntries(rows.map(r => [r.id, r.layer_name]))
      unresolved = tplIds.filter(id => !resolved[id])
      for (const id of unresolved) {
        issues.push({
          severity: 'error',
          scope:    `section.template_id="${id}"`,
          message:  `No template found with id "${id}". The copywriter output references a Brixies template that isn't in the catalog.`,
        })
      }
    }
  }
  // Surface mechanical_scan_log entries via the plain-language
  // translator so the issues list isn't full of internal jargon.
  // `verify` severity drops to 'info' (not action-required);
  // `action` stays a warning.
  for (const m of (out.mechanical_scan_log ?? [])) {
    const f = friendlyScanMessage(m)
    issues.push({
      severity: f.severity === 'action' ? 'warning' : 'info',
      scope:    `section ${m.section_sort}`,
      message:  `${f.headline} — ${f.advice}`,
    })
  }
  for (const g of (out.gaps_flagged ?? [])) {
    issues.push({
      severity: 'info',
      scope:    `section ${g.section_sort}`,
      message:  g.note,
    })
  }
  for (const k of (out.kickbacks_to_copywriter ?? [])) {
    issues.push({
      severity: 'warning',
      scope:    k.section_sort != null ? `section ${k.section_sort}` : 'page',
      message:  typeof k.note === 'string' ? k.note : JSON.stringify(k),
    })
  }
  return {
    valid:                   issues.filter(i => i.severity === 'error').length === 0,
    issues,
    unresolved_template_ids: unresolved,
    resolved_templates:      resolved,
  }
}

// ── Pre-import diagnostic ───────────────────────────────────────────
//
// Runs the bind pipeline in dry-run mode (no DB I/O) per section so
// the import modal can render a fit indicator next to each section
// before the user commits. Same function the importer uses for the
// real bind — so the diagnostic matches reality, not an approximation.

export interface SectionFitDiagnostic {
  sort_order:           number
  template_id:          string
  matched_slot_keys:    string[]
  unmapped_source_keys: string[]
  dropped_paths:        string[]
  used_shape_align:     boolean
  health: 'clean' | 'partial' | 'attention'
}

/** Classify a section's bind outcome into a tri-state health signal:
 *    'clean'     → no unmapped source keys, no dropped paths.
 *    'partial'   → some content moved into __unmapped or got dropped
 *                  but the section bound to a real template.
 *    'attention' → most/all source content failed to land — likely
 *                  wrong template selection. */
function classifyFit(b: SectionBindResult): SectionFitDiagnostic['health'] {
  const unmappedCount = Object.keys(b.unmapped).length
  const droppedCount  = b.droppedPaths.length
  if (unmappedCount === 0 && droppedCount === 0) return 'clean'
  if (b.matchedSlotKeys.length === 0) return 'attention'
  return 'partial'
}

// ── Bundle pairing (master pairer entrypoint) ──────────────────────────

export interface BundlePairResult {
  /** Map page-index → sort_order → picked template id. Drop-in for the
   *  modal's `templateOverridesByPage` state — applying this object
   *  swaps every cowork pick that the pairer beat. */
  overridesByPage: Record<number, Record<number, string>>
  /** Per-page list of pair results (kept for the modal's "See what I
   *  changed" panel — every override carries a one-line rationale). */
  resultsByPage:   Record<number, SectionPairResult[]>
}

/** Re-pair every section in the bundle against the full catalog with
 *  site-wide cohesion (heroes/team/footer locked to one family
 *  across the project). Cowork's `template_id` is treated as a hint
 *  only — overridden whenever the pairer finds a materially better
 *  shape match.
 *
 *  The modal calls this once when the bundle loads and applies the
 *  resulting overrides automatically. The strategist sees what was
 *  changed in the "See what I changed" panel; manual variant swaps
 *  layer on top through the existing `templateOverridesByPage` state. */
export async function pairBundleTemplates(
  bundle: CopywriterPageOutput[],
  project: StrategyWebProject,
): Promise<BundlePairResult> {
  if (bundle.length === 0) return { overridesByPage: {}, resultsByPage: {} }

  // 1. Load full catalog. We need every content/component/chrome
  //    template so the pairer can score across families.
  const { data: catalogRows } = await supabase
    .from('web_content_templates')
    .select('id, layer_name, family, kind, fields, source_html')
    .in('kind', ['content', 'component', 'media', 'post_template', 'chrome', 'functional'])
  const catalog = augmentCatalog((catalogRows ?? []) as WebContentTemplate[])

  // 2. Build site state from the project's existing sections.
  const librarySet = getEffectiveLibraryIds(parseCuratedLibrary(project.curated_library))
  const siteState = await loadProjectSiteState(project, librarySet)

  // 3. Flatten bundle into pair inputs.
  const inputs: Array<SectionPairInput & { _pageIdx: number }> = []
  for (let pi = 0; pi < bundle.length; pi++) {
    const page = bundle[pi]
    const total = page.sections.length
    for (let si = 0; si < page.sections.length; si++) {
      const s = page.sections[si]
      inputs.push({
        _pageIdx:           pi,
        sort_order:         s.sort_order,
        page_slug:          page.page_slug,
        position:           si,
        total_sections:     total,
        concept_id:         (typeof s.concept_id === 'string' ? s.concept_id : null) ?? null,
        template_id_hint:   (typeof s.template_id === 'string' ? s.template_id : null) ?? null,
        field_values:       s.field_values ?? {},
      })
    }
  }

  const results = pairSections(
    inputs.map(({ _pageIdx: _, ...rest }) => rest),
    catalog,
    librarySet,
    siteState,
  )

  // 4. Group results back per page; build overridesByPage.
  const overridesByPage: Record<number, Record<number, string>> = {}
  const resultsByPage:   Record<number, SectionPairResult[]>   = {}
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const pageIdx = inputs[i]._pageIdx
    ;(resultsByPage[pageIdx] ??= []).push(r)
    if (r.picked_id && r.picked_id !== r.cowork_id) {
      (overridesByPage[pageIdx] ??= {})[r.sort_order] = r.picked_id
    }
  }
  return { overridesByPage, resultsByPage }
}

/** Run computeSectionBind across every section in a copywriter page
 *  bundle and return per-section diagnostics. Loads referenced
 *  templates + palette templates once. */
export async function analyzeBundleFit(
  bundle: CopywriterPageOutput[],
  templateOverridesByPage: Record<number, Record<number, string>> = {},
): Promise<Record<number, Record<number, SectionFitDiagnostic>>> {
  // Collect every template id we'll actually bind against (with overrides applied).
  const tplIds = new Set<string>()
  for (let i = 0; i < bundle.length; i++) {
    const page = bundle[i]
    const pageOverrides = templateOverridesByPage[i] ?? {}
    for (const s of page.sections) {
      const id = pageOverrides[s.sort_order] ?? s.template_id
      if (id) tplIds.add(id)
    }
  }
  if (tplIds.size === 0) return {}

  const { data: tplRows } = await supabase
    .from('web_content_templates')
    .select('id, fields, source_html, layer_name, family, kind')
    .in('id', Array.from(tplIds))
  const templatesById: Record<string, WebContentTemplate> = {}
  for (const t of ((tplRows ?? []) as WebContentTemplate[])) {
    templatesById[t.id] = augmentTemplate(t)
  }

  // Palette pass — same logic as the importer's: any group with an
  // item_template_ref needs its referenced template available so the
  // compatible-shape matcher can resolve effective item_schema.
  const paletteIds = new Set<string>()
  const collect = (fields?: ReadonlyArray<WebFieldDef>): void => {
    if (!Array.isArray(fields)) return
    for (const f of fields) {
      if (f.kind === 'group' && f.item_template_ref && f.referenced_template_id) {
        paletteIds.add(f.referenced_template_id)
      }
      if (f.kind === 'group' && Array.isArray(f.item_schema)) collect(f.item_schema)
    }
  }
  for (const t of Object.values(templatesById)) collect(t.fields)
  const paletteTemplatesById: Record<string, WebContentTemplate> = {}
  if (paletteIds.size > 0) {
    const { data: palRows } = await supabase
      .from('web_content_templates')
      .select('id, fields, source_html, layer_name, family, kind')
      .in('id', Array.from(paletteIds))
    for (const t of ((palRows ?? []) as WebContentTemplate[])) {
      paletteTemplatesById[t.id] = augmentTemplate(t)
    }
  }

  const out: Record<number, Record<number, SectionFitDiagnostic>> = {}
  for (let i = 0; i < bundle.length; i++) {
    const page = bundle[i]
    const pageOverrides = templateOverridesByPage[i] ?? {}
    const perSection: Record<number, SectionFitDiagnostic> = {}
    for (const s of page.sections) {
      const effectiveId = pageOverrides[s.sort_order] ?? s.template_id
      const tpl = effectiveId ? templatesById[effectiveId] ?? null : null
      const bind = computeSectionBind(s.field_values ?? {}, tpl, paletteTemplatesById)
      perSection[s.sort_order] = {
        sort_order:           s.sort_order,
        template_id:          effectiveId,
        matched_slot_keys:    bind.matchedSlotKeys,
        unmapped_source_keys: Object.keys(bind.unmapped),
        dropped_paths:        bind.droppedPaths,
        used_shape_align:     bind.usedShapeAlign,
        health:               classifyFit(bind),
      }
    }
    out[i] = perSection
  }
  return out
}

// ── Import ──────────────────────────────────────────────────────────

export interface CopywriterImportResult {
  page_id:          string
  created:          boolean
  sections_created: number
  sections_replaced: number
  /** Sections whose source content was unchanged from a prior import,
   *  so their existing rows (and any in-editor user edits) were kept
   *  intact. Surfaced in the import summary so strategists know their
   *  work survived. */
  sections_preserved?: number
  seo_written:      boolean
  /** Sections where the copywriter didn't ship a usable template_id
   *  and the importer auto-picked one from the project's site library
   *  (or, if the library was empty, the broader catalog). Surfaced so
   *  the import message can name the picks. */
  library_fallbacks: Array<{
    sort_order:    number
    original_id:   string | null
    fallback_id:   string
    fallback_name: string
    source:        'site_library' | 'catalog'
  }>
  /** Pairer overrides — every section where the master pairer replaced
   *  cowork's pick with a better shape match. Populated by the
   *  aggressive re-pair pass that runs before normalize+bind. The
   *  modal renders these in the "See what I changed" panel. */
  pairer_overrides?: Array<{
    sort_order:        number
    cowork_template:   string | null
    cowork_name:       string | null
    picked_template:   string
    picked_name:       string
    picked_family:     string
    archetype:         string
    rationale:         string
  }>
}

/** Resolve a template by id. Returns id, layer_name, family for use
 *  in the import modal's template-swap dropdown. */
export interface TemplateRef {
  id:         string
  layer_name: string
  family:     string | null
}

/** Load every template in the same family as the input set, plus the
 *  inputs themselves. Used by the import modal so the user can swap
 *  any section's selected template for an alternate in the same
 *  family (e.g., swap banner-section-1 → banner-section-3 if the
 *  default doesn't have a CTA slot the copywriter needs). */
export async function loadFamilyAlternates(
  templateIds: string[],
): Promise<{ byId: Record<string, TemplateRef>; byFamily: Record<string, TemplateRef[]> }> {
  if (templateIds.length === 0) return { byId: {}, byFamily: {} }
  // 1. Pull the input templates first to learn their families.
  const { data: inputs } = await supabase
    .from('web_content_templates')
    .select('id, layer_name, family')
    .in('id', templateIds)
  const families = Array.from(new Set(((inputs ?? []) as TemplateRef[]).map(t => t.family).filter((f): f is string => !!f)))
  // 2. Pull every template in those families.
  let all: TemplateRef[] = (inputs ?? []) as TemplateRef[]
  if (families.length > 0) {
    const { data: fam } = await supabase
      .from('web_content_templates')
      .select('id, layer_name, family')
      .in('family', families)
      .order('layer_name')
    all = (fam ?? []) as TemplateRef[]
  }
  const byId: Record<string, TemplateRef> = {}
  for (const t of all) byId[t.id] = t
  const byFamily: Record<string, TemplateRef[]> = {}
  for (const t of all) {
    const f = t.family ?? 'Other'
    ;(byFamily[f] ??= []).push(t)
  }
  return { byId, byFamily }
}

/** Map strategic_setup → web_pages.seo. The copywriter's
 *  `aeo_smart_snippet` lands as the answer_intent on the AEO side. */
function strategicSetupToSeo(setup: CopywriterStrategicSetup | undefined): WebPageSeo {
  return {
    seo: {
      title:            setup?.metadata_title?.trim() || undefined,
      meta_description: setup?.metadata_description?.trim() || undefined,
    },
    aeo: {
      answer_intent: setup?.aeo_smart_snippet?.trim() || undefined,
    },
  }
}

/** Walk a section's field_values against the bound template's field
 *  schema and translate copywriter conventions into the canonical
 *  shape the editor + renderer expect. Two normalizations:
 *
 *    1. Group values shipped as `{ items: [...] }` get unwrapped to
 *       bare arrays. The copywriter wraps every group; the renderer
 *       reads them as `Array<Record<string, unknown>>` directly.
 *
 *    2. Button-shaped slots inside group items can arrive flat —
 *       e.g. `{contact: "Walk in", url: null}` — when the item schema
 *       only has one button-shaped slot (`contact`). We rebuild this
 *       to `{contact: {label: "Walk in", url: ""}}` so ButtonInput +
 *       the inventory reader see the right shape. */
/** Result of running the three-phase bind on a section's raw source
 *  values. Used by both the importer (to build the insert row +
 *  telemetry) and the pre-import diagnostic (to surface fit). Pure —
 *  no DB writes. */
export interface SectionBindResult {
  /** Final field_values payload, including the `__unmapped` stash. */
  fieldValues: Record<string, unknown>
  /** Top-level source keys that didn't land in any slot. */
  unmapped: Record<string, unknown>
  /** Deep paths in source whose leaf values aren't represented in fieldValues. */
  droppedPaths: string[]
  /** Top-level template slot keys that ended up populated. */
  matchedSlotKeys: string[]
  /** True if the compatible-shape matcher (cross-key item re-key) fired. */
  usedShapeAlign: boolean
  /** True if the bound template has a FAQ-shaped item group (question + answer). */
  usedFaqInference: boolean
  /** Free-form warnings raised during bind (e.g. value-shape phase failures). */
  bindNotes: string[]
}

/** Pure three-phase bind: normalize → value-shape doc → canonical
 *  reconcile, with the compatible-shape matcher backstopping any
 *  unfilled groups. No DB I/O. The importer uses this to build
 *  section rows; the pre-import diagnostic uses it to predict fit per
 *  section so strategists can pick a better template BEFORE persisting. */
export function computeSectionBind(
  rawValues: Record<string, unknown>,
  template: WebContentTemplate | null,
  paletteTemplates: Record<string, WebContentTemplate> = {},
  override?: Record<string, unknown>,
): SectionBindResult {
  const reconcileTele = emptyReconcileTelemetry()
  const bindNotes: string[] = []
  let fieldValues: Record<string, unknown>

  if (override) {
    fieldValues = override
  } else if (template) {
    const normalized = normalizeFieldValuesForTemplate(template, rawValues)
    let shapeFilled: Record<string, unknown> = {}
    try {
      const docHtml = valuesToDocHtmlByShape(rawValues)
      shapeFilled = docHtmlToFieldValues(docHtml, template, rawValues).field_values
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      bindNotes.push(`value-shape phase failed: ${msg}`)
    }
    fieldValues = mergeFieldValuesPreferNonEmpty(normalized, shapeFilled, template)
    fieldValues = reconcileFieldValuesAcrossTemplates(
      rawValues, template, fieldValues, paletteTemplates, reconcileTele,
    )
  } else {
    fieldValues = normalizeFieldValuesForTemplate(null, rawValues)
  }

  const unmapped = computeUnmappedValues(rawValues, fieldValues, template)
  const fieldValuesWithUnmapped = Object.keys(unmapped).length > 0
    ? { ...fieldValues, __unmapped: unmapped }
    : fieldValues

  return {
    fieldValues: fieldValuesWithUnmapped,
    unmapped,
    droppedPaths: computeDroppedDeepPaths(rawValues, fieldValues),
    matchedSlotKeys: computeMatchedSlotKeys(template, fieldValues),
    usedShapeAlign: reconcileTele.used_shape_align,
    usedFaqInference: Boolean(template && Array.isArray(template.fields) && template.fields.some(
      f => f.kind === 'group' && Array.isArray(f.item_schema)
        && f.item_schema.some(s => s.kind === 'slot' && s.key === 'question')
        && f.item_schema.some(s => s.kind === 'slot' && s.key === 'answer'),
    )),
    bindNotes,
  }
}

/** Deterministic JSON.stringify — sorts object keys recursively so two
 *  payloads with the same content compare equal regardless of key
 *  insertion order. Used by the diff-based re-import to decide
 *  "source unchanged → preserve user edits" vs "source changed →
 *  replace." Arrays preserve order (intentional — sort_order matters). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) {
    return '[' + v.map(stableStringify).join(',') + ']'
  }
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

export function normalizeFieldValuesForTemplate(
  template: WebContentTemplate | null,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!template?.fields) return values
  return walkFieldsNormalize(template.fields, values)
}

/** Detect bare-string CTA values the copywriter shipped as a URL/route
 *  rather than a label. We treat anything starting with `/`, an http(s)
 *  scheme, a `mailto:` / `tel:` scheme, or an `{{token}}` snippet
 *  reference as a URL. Whitespace-containing strings are always
 *  labels — paths never have spaces. */
function looksLikeUrl(v: string): boolean {
  const trimmed = v.trim()
  if (!trimmed) return false
  if (/\s/.test(trimmed)) return false
  if (trimmed.startsWith('/')) return true
  if (/^https?:\/\//i.test(trimmed)) return true
  if (/^mailto:/i.test(trimmed)) return true
  if (/^tel:/i.test(trimmed)) return true
  if (/^\{\{[a-z0-9_]+\}\}$/i.test(trimmed)) return true
  return false
}

function walkFieldsNormalize(
  fields: WebFieldDef[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const coerceButtonShape = (v: unknown, siblingUrl?: unknown): { label: string; url: string } => {
    if (typeof v === 'string') {
      // A bare-string CTA can be either a label ("Plan Your Visit") or a
      // URL/route the copywriter put in the wrong field
      // ("/connect/kids-ministry", "{{kids_check_in_url}}", "mailto:…").
      // Treat URL-shaped strings as the url, not the label, so the
      // editor doesn't render a button labeled with a path.
      if (looksLikeUrl(v)) {
        return { label: '', url: v }
      }
      return { label: v, url: typeof siblingUrl === 'string' ? siblingUrl : '' }
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      const label = typeof o.label    === 'string' ? o.label
                  : typeof o.text     === 'string' ? o.text
                  : typeof o.title    === 'string' ? o.title
                  : typeof o.contact  === 'string' ? o.contact
                  : typeof o.cta_label === 'string' ? o.cta_label : ''
      const url   = typeof o.url      === 'string' ? o.url
                  : typeof o.href     === 'string' ? o.href : ''
      return { label, url }
    }
    return { label: '', url: '' }
  }
  for (const f of fields) {
    if (f.kind === 'slot') {
      const v = values[f.key]
      // Button-shaped slot: tolerate four shapes from the copywriter:
      //  · bare string (label only; URL falls back to a sibling `url`)
      //  · `{label, url}` (canonical)
      //  · `{text|title|contact|cta_label, url|href}` (variant keys)
      // All collapse to the canonical `{label, url}` shape.
      if (isButtonShapedSlot(f)) {
        const coerced = coerceButtonShape(v, values['url'])
        if (coerced.label || coerced.url) {
          out[f.key] = coerced
        } else {
          out[f.key] = v
        }
      } else {
        out[f.key] = v
      }
      continue
    }
    if (f.kind === 'group') {
      let raw: unknown = values[f.key]
      // Unwrap { items: [...] } wrapper.
      if (raw && typeof raw === 'object' && !Array.isArray(raw)
          && 'items' in (raw as Record<string, unknown>)) {
        raw = (raw as { items: unknown }).items
      }
      // Copywriter sometimes ships a singleton CTA inline — e.g.
      // `buttons: { label: "Our Story", url: "..." }` — when the
      // template's `buttons` field is a group. Wrap it as a one-item
      // list so the single button survives normalize.
      if (!Array.isArray(raw) && raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>
        const hasButtonShape =
          typeof o.label === 'string' || typeof o.text === 'string'
            || typeof o.title === 'string' || typeof o.contact === 'string'
            || typeof o.cta_label === 'string'
            || typeof o.url === 'string' || typeof o.href === 'string'
        if (hasButtonShape) raw = [raw]
      }
      const arr = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []

      // Singleton-button-group adapter. When item_schema is exactly one
      // button-shaped slot (e.g. hero-section-1's `buttons` group whose
      // item_schema is [{key:"contact", scope:"button"}]) AND the source
      // items ship under aliased keys (`{label, url}` instead of
      // `{contact, url}`), the per-item walker would look up
      // `item['contact']`, find undefined, and drop the label/url. Bypass
      // the walker and coerce the WHOLE source item to the canonical
      // {label,url} button shape, storing it under the slot's key.
      const isSingletonButtonGroup =
        Array.isArray(f.item_schema)
        && f.item_schema.length === 1
        && f.item_schema[0].kind === 'slot'
        && isButtonShapedSlot(f.item_schema[0] as import('../types/database').WebSlotDef)
      if (isSingletonButtonGroup) {
        const slot = f.item_schema![0] as import('../types/database').WebSlotDef
        out[f.key] = arr.map(item => {
          const coerced = coerceButtonShape(item, (item as Record<string, unknown>)?.url)
          if (coerced.label || coerced.url) {
            return { [slot.key]: coerced }
          }
          return walkFieldsNormalize(f.item_schema ?? [], item ?? {})
        })
        continue
      }

      out[f.key] = arr.map(item =>
        walkFieldsNormalize(f.item_schema ?? [], item ?? {}),
      )
    }
  }
  return out
}

/** Bundle the per-section copywriter context (job, voice notes,
 *  alternatives, atom refs) into the section.notes column. Stored as
 *  a JSON string under a known key so the editor + downstream tools
 *  can parse it back. */
function sectionNotes(s: CopywriterSection): string {
  const payload = {
    copywriter_context: {
      concept_id:                  s.concept_id ?? null,
      section_job:                 s.section_job ?? null,
      tagline_strategy:            s.tagline_strategy ?? null,
      voice_notes_from_copywriter: s.voice_notes_from_copywriter ?? null,
      alternatives_considered:     s.alternatives_considered ?? null,
      atoms_lifted_canonical:      s.atoms_lifted_canonical ?? null,
    },
  }
  return JSON.stringify(payload)
}

/** Score how well a template's schema covers a set of field_value keys.
 *  Higher = better match. Used by the library-fallback path when a
 *  copywriter section has no template_id (or an unresolved one) and we
 *  need to auto-pick a section from the project's site library. */
function scoreTemplateForFieldKeys(
  template: WebContentTemplate,
  fieldKeysCanonical: ReadonlySet<string>,
): number {
  if (fieldKeysCanonical.size === 0) return 0
  const canon = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, '')
  let hits = 0
  let templateKeys = 0
  for (const f of template.fields) {
    templateKeys++
    if (fieldKeysCanonical.has(canon(f.key))) hits++
  }
  // hit-count is the primary signal; subtract a small penalty for
  // unused template slots so a tightly-matching template beats a
  // sprawling one with the same hits.
  const unusedPenalty = Math.max(0, templateKeys - hits) * 0.05
  return hits - unusedPenalty
}

/** Pick the site library template that best matches the shape of a
 *  copywriter section's field_values. Returns null when nothing in the
 *  library scores at least one matching slot. */
function pickLibraryFallback(
  section: CopywriterSection,
  libraryTemplates: WebContentTemplate[],
): WebContentTemplate | null {
  if (libraryTemplates.length === 0) return null
  const canon = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, '')
  const fieldKeys = new Set(Object.keys(section.field_values ?? {}).map(canon))
  if (fieldKeys.size === 0) return null
  let best: { tpl: WebContentTemplate; score: number } | null = null
  for (const tpl of libraryTemplates) {
    const score = scoreTemplateForFieldKeys(tpl, fieldKeys)
    if (score <= 0) continue
    if (!best || score > best.score) best = { tpl, score }
  }
  return best?.tpl ?? null
}

export async function importCopywriterPageOutput(
  out: CopywriterPageOutput,
  project: StrategyWebProject,
  opts: {
    /** Map of `sort_order` → replacement template_id. Lets the import
     *  modal apply user-picked template swaps without mutating the
     *  original payload. */
    templateOverrides?: Record<number, string>
    /** Map of `sort_order` → field_values pre-remapped to the new
     *  template's schema. Set by the modal when the user changes a
     *  variant via the catalog picker — preserves any cross-family
     *  remapping (e.g. banner → cta) so the import doesn't dump
     *  copy that doesn't match the original template anymore. */
    fieldValuesOverrides?: Record<number, Record<string, unknown>>
  } = {},
): Promise<{ result?: CopywriterImportResult; error?: string }> {
  // 1. Find or create the page (by project + slug).
  const slug = out.page_slug.replace(/^\/+/, '').trim()
  if (!slug) return { error: 'page_slug is empty after trimming.' }

  // Lookup is tolerant of dupes: if a previous archived row + a live
  // row both carry the same slug, we want the live one. Sort archived
  // last so we land on the active row at index 0. We don't use
  // .maybeSingle() here — it errors on > 1 rows even when one is
  // archived and irrelevant.
  const { data: existingRows, error: findErr } = await supabase
    .from('web_pages')
    .select('id, content_status, sort_order, archived')
    .eq('web_project_id', project.id)
    .eq('slug', slug)
    .order('archived', { ascending: true })  // false < true → live first
    .order('updated_at', { ascending: false })
  if (findErr) return { error: `page lookup failed: ${findErr.message}` }
  const existing = (existingRows ?? []).find(r => !(r as { archived?: boolean }).archived)
    ?? ((existingRows ?? [])[0] ?? null)

  const seo = strategicSetupToSeo(out.strategic_setup)

  // Apply template overrides (from the import modal's swap dropdown)
  // BEFORE we look up templates for normalization. Sections get a
  // shallow clone with `template_id` replaced.
  const overrides = opts.templateOverrides ?? {}
  const sectionsWithOverrides: CopywriterSection[] = out.sections.map(s => {
    const replacement = overrides[s.sort_order]
    return replacement && replacement !== s.template_id
      ? { ...s, template_id: replacement }
      : s
  })

  // Persist the copywriter top-level meta on web_pages.brief so the
  // page editor can surface mechanical_scan_log + gaps_flagged +
  // kickbacks for review AFTER import. The legacy PageBrief shape
  // also lives here for non-copywriter imports — we namespace this
  // under `copywriter_meta` so the two coexist.
  const briefPayload = {
    copywriter_meta: {
      imported_at:               new Date().toISOString(),
      page_title:                out.page_title,
      primary_persona:           out.primary_persona ?? null,
      strategic_setup:           out.strategic_setup ?? null,
      mechanical_scan_log:       out.mechanical_scan_log ?? [],
      gaps_flagged:              out.gaps_flagged ?? [],
      kickbacks_to_copywriter:   out.kickbacks_to_copywriter ?? [],
      template_overrides_applied: Object.entries(overrides).map(([sort, tid]) => ({
        sort_order: Number(sort),
        template_id: tid,
      })),
    },
  }

  let pageId: string
  let created = false
  if (existing) {
    pageId = (existing as { id: string }).id
    // If we matched an archived dupe (e.g. an earlier import that
    // got abandoned), un-archive it on update — beats inserting a
    // second row with the same slug.
    const wasArchived = !!(existing as { archived?: boolean }).archived
    const { error: updErr } = await supabase
      .from('web_pages')
      .update({
        name: out.page_title,
        seo,
        brief: briefPayload,
        archived: wasArchived ? false : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pageId)
    if (updErr) return { error: `page update failed: ${updErr.message}` }
  } else {
    // New page → land in 'draft' until comments/reviews bump it. Pick
    // a sort_order at the end of the current list.
    const { data: maxRow } = await supabase
      .from('web_pages')
      .select('sort_order')
      .eq('web_project_id', project.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextSort = ((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1
    const draftStatus: WebPageContentStatus = 'draft'
    const { data: insertRow, error: insErr } = await supabase
      .from('web_pages')
      .insert({
        web_project_id:  project.id,
        name:            out.page_title,
        slug,
        phase:           '1',
        sort_order:      nextSort,
        archived:        false,
        content_status:  draftStatus,
        edited_since_ai: false,
        seo,
        brief:           briefPayload,
      } as never)
      .select('id')
      .single()
    if (insErr || !insertRow) return { error: `page create failed: ${insErr?.message ?? 'unknown'}` }
    pageId = (insertRow as { id: string }).id
    created = true
  }

  // 2. Diff-based re-import. Load existing sections (when not a fresh
  //    page) with their frozen source_field_values + current template
  //    binding. We'll compare each against the incoming copywriter
  //    section at the same sort_order and only replace rows whose
  //    source actually changed — preserving user edits on sections
  //    whose underlying content the copywriter didn't touch.
  interface ExistingSection {
    id: string
    sort_order: number
    source_field_values: Record<string, unknown> | null
    content_template_id: string | null
  }
  const existingByOrder = new Map<number, ExistingSection>()
  if (!created) {
    const { data: oldSecs } = await supabase
      .from('web_sections')
      .select('id, sort_order, source_field_values, content_template_id')
      .eq('web_page_id', pageId)
    for (const s of ((oldSecs ?? []) as ExistingSection[])) {
      existingByOrder.set(s.sort_order, s)
    }
  }

  // Pull the templates referenced by these sections so we can
  // normalize each section's field_values against the template's
  // schema before writing. Without this step the copywriter's
  // {items: [...]} group wrappers + flat button-shape items don't
  // bind, and the section renders empty.
  const tplIds = Array.from(new Set(sectionsWithOverrides.map(s => s.template_id).filter(Boolean)))
  const templatesById: Record<string, WebContentTemplate> = {}
  if (tplIds.length > 0) {
    // We pull `source_html` alongside `fields` so the runtime schema
    // augmenter can surface slots the static `fields` blob doesn't
    // include — notably FAQ accordion items (faq-section-1 has only
    // heading+description in `fields`, but its source_html contains
    // five Q/A frames the augmenter exposes as a repeatable group).
    // Without augmentation, source-shipped `faq_items` arrays land in
    // `__unmapped` because the binder sees no items slot to fill.
    const { data: tplRows } = await supabase
      .from('web_content_templates')
      .select('id, fields, source_html, layer_name, family, kind')
      .in('id', tplIds)
    for (const t of ((tplRows ?? []) as WebContentTemplate[])) {
      templatesById[t.id] = augmentTemplate(t)
    }
  }

  // Palette-referenced item templates — the importer needs these to
  // resolve the *effective* item_schema for groups whose item layout
  // comes from a card/component template (feature-section-2's `card`
  // group references card-213; its real item keys are `heading_card` /
  // `description_card` etc., not the placeholder `item_schema: []`).
  // reconcileFieldValuesAcrossTemplates uses this lookup to align
  // source-item keys (e.g. cowork's `container_left.items` with
  // `{heading, description}`) to the palette card's keys.
  const paletteTemplatesById: Record<string, WebContentTemplate> = {}
  const collectPaletteIds = (fields: ReadonlyArray<WebFieldDef> | undefined): string[] => {
    const out: string[] = []
    if (!Array.isArray(fields)) return out
    for (const f of fields) {
      if (f.kind === 'group' && f.item_template_ref && f.referenced_template_id) {
        out.push(f.referenced_template_id)
      }
      if (f.kind === 'group' && Array.isArray(f.item_schema)) {
        out.push(...collectPaletteIds(f.item_schema))
      }
    }
    return out
  }
  const paletteIds = Array.from(new Set(
    Object.values(templatesById).flatMap(t => collectPaletteIds(t.fields)),
  ))
  if (paletteIds.length > 0) {
    const { data: palRows } = await supabase
      .from('web_content_templates')
      .select('id, fields, source_html, layer_name, family, kind')
      .in('id', paletteIds)
    for (const t of ((palRows ?? []) as WebContentTemplate[])) {
      paletteTemplatesById[t.id] = augmentTemplate(t)
    }
  }

  // Library fallback — for sections where the copywriter didn't
  // specify a Brixies layout (empty template_id) OR named a layout
  // that isn't in the catalog, pick the closest-matching template
  // from the project's site library by scoring slot-key overlap.
  // Falls back to the catalog's full kind=content pool if the library
  // is empty.
  const libraryIds = Array.from(getEffectiveLibraryIds(parseCuratedLibrary(project.curated_library)))
  const libraryTemplates: WebContentTemplate[] = []
  if (libraryIds.length > 0) {
    const { data: libRows } = await supabase
      .from('web_content_templates')
      .select('id, layer_name, family, fields')
      .in('id', libraryIds)
    for (const t of ((libRows ?? []) as Array<WebContentTemplate>)) {
      libraryTemplates.push(t)
    }
  }
  const sectionsNeedingFallback = sectionsWithOverrides.filter(
    s => !s.template_id || !templatesById[s.template_id],
  )
  const libraryFallbacks: CopywriterImportResult['library_fallbacks'] = []
  if (sectionsNeedingFallback.length > 0) {
    // If the project library is empty or no match scores, widen the
    // search to any kind=content/media/post_template template in the
    // catalog so we still pick a sensible default rather than dumping
    // an unbound section.
    let widenedPool: WebContentTemplate[] = []
    const needsWiden = libraryTemplates.length === 0
      || sectionsNeedingFallback.some(s => !pickLibraryFallback(s, libraryTemplates))
    if (needsWiden) {
      const { data: catRows } = await supabase
        .from('web_content_templates')
        .select('id, layer_name, family, fields')
        .in('kind', ['content', 'media', 'post_template'])
      widenedPool = (catRows ?? []) as Array<WebContentTemplate>
    }
    for (const s of sectionsNeedingFallback) {
      const originalId = s.template_id || null
      const libraryPick = pickLibraryFallback(s, libraryTemplates)
      const pick = libraryPick ?? pickLibraryFallback(s, widenedPool)
      if (pick) {
        s.template_id = pick.id
        templatesById[pick.id] = pick
        libraryFallbacks.push({
          sort_order:    s.sort_order,
          original_id:   originalId,
          fallback_id:   pick.id,
          fallback_name: pick.layer_name,
          source:        libraryPick ? 'site_library' : 'catalog',
        })
      }
    }
  }

  // Per-section telemetry drafts are accumulated in parallel with
  // sectionRows so we can record one bind event per inserted section
  // after we know its DB id. Telemetry never affects the bind result.
  const telemetryDrafts: Array<Omit<BindTelemetryRecord, 'web_section_id'>> = []

  // Diff-based decisions per incoming sort_order. A section is
  // PRESERVED when the existing row's `source_field_values` is byte-
  // identical to the incoming `field_values` AND the bound template
  // hasn't moved. Preserved rows skip the build/insert pipeline
  // entirely, keeping any user edits made in the editor since the last
  // import. Sections whose source changed land in `sectionsToReplace`
  // (delete-then-insert) and any existing sections whose sort_order
  // the incoming bundle doesn't cover land in `sectionsToOrphanDelete`.
  const preservedOrders = new Set<number>()
  const sectionsToReplace: string[] = []
  for (const s of sectionsWithOverrides) {
    const existing = existingByOrder.get(s.sort_order)
    const rawValues = s.field_values ?? {}
    const incomingTplId = s.template_id || null
    const sourceMatches = !!existing
      && existing.source_field_values !== null
      && stableStringify(existing.source_field_values) === stableStringify(rawValues)
    const templateMatches = !!existing && existing.content_template_id === incomingTplId
    if (sourceMatches && templateMatches) {
      preservedOrders.add(s.sort_order)
    } else if (existing) {
      sectionsToReplace.push(existing.id)
    }
  }
  // Orphans: existing rows at sort_orders the incoming bundle didn't address.
  const sectionsToOrphanDelete: string[] = []
  for (const [order, existing] of existingByOrder) {
    if (preservedOrders.has(order)) continue
    if (sectionsToReplace.includes(existing.id)) continue
    sectionsToOrphanDelete.push(existing.id)
  }
  const sectionsToDelete = [...sectionsToReplace, ...sectionsToOrphanDelete]
  if (sectionsToDelete.length > 0) {
    const { error: delErr } = await supabase
      .from('web_sections')
      .delete()
      .in('id', sectionsToDelete)
    if (delErr) return { error: `section diff-replace failed: ${delErr.message}` }
  }

  const fieldOverrides = opts.fieldValuesOverrides ?? {}
  const sectionRows = sectionsWithOverrides
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .filter(s => !preservedOrders.has(s.sort_order))
    .map((s) => {
      const tpl      = templatesById[s.template_id] ?? null
      const override = fieldOverrides[s.sort_order]
      const rawValues = s.field_values ?? {}
      const bindStart = Date.now()
      const bind = computeSectionBind(rawValues, tpl, paletteTemplatesById, override)
      if (bind.bindNotes.length > 0) {
        console.warn(`[import] section ${s.sort_order} bind notes:`, bind.bindNotes)
      }

      // Telemetry draft — section_id filled in after insert.
      telemetryDrafts.push({
        web_project_id:       project.id,
        bind_source:          'import',
        template_id:          s.template_id || '',
        palette_template_ids: collectPaletteTemplateIds(tpl?.fields),
        matched_slot_keys:    bind.matchedSlotKeys,
        unmapped_source_keys: Object.keys(bind.unmapped),
        dropped_paths:        bind.droppedPaths,
        used_shape_align:     bind.usedShapeAlign,
        used_faq_inference:   bind.usedFaqInference,
        source_field_values_size_bytes: JSON.stringify(rawValues).length,
        bind_duration_ms:     Date.now() - bindStart,
        notes:                bind.bindNotes.length > 0 ? bind.bindNotes.join(' · ') : undefined,
      })

      return {
        web_page_id:         pageId,
        content_template_id: s.template_id || null,
        field_values:        bind.fieldValues,
        // Freeze the copywriter's original shape so future variant
        // swaps can re-derive against any new template directly from
        // the source instead of compounding remaps off the current
        // (already-transformed) field_values.
        source_field_values: rawValues,
        sort_order:          s.sort_order ?? 0,
        content_status:      'draft' as const,
        notes:               sectionNotes(s),
      }
    })

  let sectionsCreated = 0
  if (sectionRows.length > 0) {
    const { error: secErr, data: insertedSecs } = await supabase
      .from('web_sections')
      .insert(sectionRows as never)
      .select('id')
    if (secErr) return { error: `section insert failed: ${secErr.message}` }
    const insertedIds = ((insertedSecs ?? []) as Array<{ id: string }>).map(r => r.id)
    sectionsCreated = insertedIds.length

    // Fire bind telemetry — one row per inserted section. Postgres
    // INSERT ... RETURNING preserves the input order, so zipping
    // telemetryDrafts to insertedIds by index is safe.
    void Promise.all(insertedIds.map((sectionId, i) => {
      const draft = telemetryDrafts[i]
      if (!draft) return
      return recordBindTelemetry({ ...draft, web_section_id: sectionId })
    })).catch(err => console.warn('[bind-telemetry] import batch failed', err))
  }

  return {
    result: {
      page_id:           pageId,
      created,
      sections_created:  sectionsCreated,
      // Replaced = pre-existing rows we displaced because their source
      // changed. Orphan deletes (sort_orders the new bundle dropped)
      // roll up here too so the summary count covers all swap-outs.
      sections_replaced: sectionsToDelete.length,
      sections_preserved: preservedOrders.size,
      seo_written:       !!(out.strategic_setup),
      library_fallbacks: libraryFallbacks,
    },
  }
}
