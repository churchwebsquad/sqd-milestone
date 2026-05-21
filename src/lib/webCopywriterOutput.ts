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

// ── Import ──────────────────────────────────────────────────────────

export interface CopywriterImportResult {
  page_id:          string
  created:          boolean
  sections_created: number
  sections_replaced: number
  seo_written:      boolean
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
function normalizeFieldValuesForTemplate(
  template: WebContentTemplate | null,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!template?.fields) return values
  return walkFieldsNormalize(template.fields, values)
}

function walkFieldsNormalize(
  fields: WebFieldDef[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.kind === 'slot') {
      const v = values[f.key]
      // Button-shaped slot with a bare-string value → upgrade to
      // {label, url} pulling the URL from a sibling key when present.
      // Common copywriter convention: button label lives at `<slot_key>`
      // and the URL lives at sibling `url`.
      if (isButtonShapedSlot(f) && typeof v === 'string') {
        const sibling = values['url']
        out[f.key] = {
          label: v,
          url:   typeof sibling === 'string' ? sibling : '',
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
      const arr = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
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

export async function importCopywriterPageOutput(
  out: CopywriterPageOutput,
  project: StrategyWebProject,
  opts: {
    /** Map of `sort_order` → replacement template_id. Lets the import
     *  modal apply user-picked template swaps without mutating the
     *  original payload. */
    templateOverrides?: Record<number, string>
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

  // 2. Replace sections. Delete every existing section, then insert
  //    one row per copywriter section in sort_order order.
  let sectionsReplaced = 0
  if (!created) {
    const { data: oldSections } = await supabase
      .from('web_sections')
      .select('id')
      .eq('web_page_id', pageId)
    sectionsReplaced = ((oldSections ?? []) as Array<{ id: string }>).length
    if (sectionsReplaced > 0) {
      const { error: delErr } = await supabase
        .from('web_sections')
        .delete()
        .eq('web_page_id', pageId)
      if (delErr) return { error: `section wipe failed: ${delErr.message}` }
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
    const { data: tplRows } = await supabase
      .from('web_content_templates')
      .select('id, fields')
      .in('id', tplIds)
    for (const t of ((tplRows ?? []) as Array<{ id: string; fields: WebFieldDef[] }>)) {
      templatesById[t.id] = t as unknown as WebContentTemplate
    }
  }

  const sectionRows = sectionsWithOverrides
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s) => {
      const tpl = templatesById[s.template_id] ?? null
      const normalized = normalizeFieldValuesForTemplate(tpl, s.field_values ?? {})
      return {
        web_page_id:         pageId,
        content_template_id: s.template_id,
        field_values:        normalized,
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
    sectionsCreated = ((insertedSecs ?? []) as Array<{ id: string }>).length
  }

  return {
    result: {
      page_id:           pageId,
      created,
      sections_created:  sectionsCreated,
      sections_replaced: sectionsReplaced,
      seo_written:       !!(out.strategic_setup),
    },
  }
}
