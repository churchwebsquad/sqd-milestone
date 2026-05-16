/**
 * Auto-bind orchestrator — runs at brief import time.
 *
 * Each newly-created freehand web_section gets a template binding
 * picked from (in order of preference):
 *   1. The site's curated library — concepts whose familyFilter
 *      matches the brief's suggested_template_family, and which
 *      have one or more templates already bound on this project.
 *   2. The global catalog — every template matching the family,
 *      ranked by rankVariantsByBrief() against the brief section's
 *      content shape.
 *
 * After picking a template, composeBind() resolves field_values
 * from the brief's structured fields + the freehand body HTML,
 * and the section row is upgraded from freehand → template-bound.
 * The original freehand body is preserved under `__overflow_html`
 * so nothing is lost.
 */
import { supabase } from './supabase'
import { LIBRARY_CONCEPTS, parseCuratedLibrary } from './webCuratedLibrary'
import {
  composeBind, rankVariantsByBrief, extractSectionIdFromNotes,
} from './webBindTemplate'
import type { BriefSection, BriefHero, PageBrief } from './webPageBrief'
import type {
  WebContentTemplate, WebSection, StrategyWebProject,
} from '../types/database'

export interface SectionAutoBindResult {
  /** The web_sections.id we updated. */
  web_section_id: string
  /** Display name pulled from brief's section_id or hero. */
  section_label: string
  /** null when no template fit was found. */
  template_id: string | null
  template_layer_name: string | null
  source: 'curated' | 'catalog' | 'none'
  /** Short, user-facing why-this-fits string. */
  rationale: string
}

export interface PageAutoBindResult {
  bindings: SectionAutoBindResult[]
  curated_used: number
  catalog_used: number
  unbound: number
}

function normalizeFamily(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function familyMatches(a: string, b: string): boolean {
  const na = normalizeFamily(a)
  const nb = normalizeFamily(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** Convert a BriefHero into a synthetic BriefSection so the same
 *  scoring + binding path works for both. */
function heroAsBriefSection(hero: BriefHero): BriefSection {
  return {
    section_id: '__hero__',
    suggested_template_family: 'Hero Section',
    purpose: 'Hero block',
    fields: hero as unknown as Record<string, unknown>,
  }
}

/** Pick the curated concept that best matches a brief section given
 *  page context. When multiple concepts share a family (Homepage Hero,
 *  Inner Page Hero, Featured Page Hero all share Hero Section), we
 *  break ties on page slug / intent. */
function pickConceptForBriefSection(
  briefSection: BriefSection,
  pageSlug: string,
  briefPhase: string,
): string | null {
  const family = briefSection.suggested_template_family ?? ''
  if (!family) return null
  const matching = LIBRARY_CONCEPTS.filter(c =>
    c.familyFilter?.some(f => familyMatches(f, family))
  )
  if (matching.length === 0) return null
  if (matching.length === 1) return matching[0].id

  // Tie-breakers based on concept id keywords + page context.
  const slug = pageSlug.toLowerCase()
  const isHomepage = slug === 'home' || slug === '' || slug === '/'
  const intentish = /(plan|visit|next|join|give|donate|register)/.test(slug)

  // Hero variant selection
  if (matching.some(c => c.id.startsWith('hero_'))) {
    if (isHomepage) return 'hero_homepage'
    if (intentish) return 'hero_featured'
    return 'hero_inner'
  }
  // Default — first match (most concept families have 1 entry anyway).
  // Phase tie-breaker: prefer concepts whose label hints at the brief's
  // touch_level if any are present.
  void briefPhase
  return matching[0].id
}

/** Auto-bind every just-imported freehand section on a page. Idempotent
 *  per page — re-running re-applies bindings to anything currently
 *  freehand and doesn't disturb sections that already have a template. */
export async function autoBindPageSections(
  pageId: string,
  brief: PageBrief,
  project: StrategyWebProject,
): Promise<PageAutoBindResult> {
  const { data: sectionRows } = await supabase
    .from('web_sections')
    .select('*')
    .eq('web_page_id', pageId)
    .order('sort_order')
  const sections = (sectionRows ?? []) as WebSection[]

  // Pull the full catalog once — we'll filter per section. 257 templates
  // is small enough that one fetch is cheaper than N filtered queries.
  const { data: allTemplates } = await supabase
    .from('web_content_templates')
    .select('*')
  const catalog = (allTemplates ?? []) as WebContentTemplate[]

  const curatedLibrary = parseCuratedLibrary(project.curated_library)
  const briefSections = brief.sections ?? []
  const pageSlug = brief.page_slug ?? ''
  const briefPhase = brief.phase ?? '1'

  const bindings: SectionAutoBindResult[] = []

  for (const webSection of sections) {
    // Skip sections that already have a template — auto-bind only
    // touches freehand rows. (Re-runs of the importer wipe sections,
    // so this is defensive; manual edits to existing pages stay safe.)
    if (webSection.content_template_id) continue

    // Map the web_section back to its brief source — Section ID in notes
    // for normal sections, or the hero by its sentinel notes string.
    let briefSection: BriefSection | null = null
    const sectionLabel = (() => {
      const briefId = extractSectionIdFromNotes(webSection.notes)
      if (briefId) {
        briefSection = briefSections.find(s => s.section_id === briefId) ?? null
        return briefId
      }
      if (webSection.notes === 'Imported hero block from page brief' && brief.hero) {
        briefSection = heroAsBriefSection(brief.hero)
        return 'Hero'
      }
      return webSection.id
    })()

    if (!briefSection) {
      bindings.push({
        web_section_id: webSection.id,
        section_label: sectionLabel,
        template_id: null,
        template_layer_name: null,
        source: 'none',
        rationale: 'No matching brief section',
      })
      continue
    }

    const family = briefSection.suggested_template_family ?? ''
    if (!family) {
      bindings.push({
        web_section_id: webSection.id,
        section_label: sectionLabel,
        template_id: null,
        template_layer_name: null,
        source: 'none',
        rationale: 'No suggested_template_family in brief',
      })
      continue
    }

    // Curated-library candidates: pick the most-specific concept,
    // then filter the catalog to templates the strategist bound to it.
    const conceptId = pickConceptForBriefSection(briefSection, pageSlug, briefPhase)
    const curatedIds = conceptId ? (curatedLibrary[conceptId] ?? []) : []
    const curatedCandidates = catalog.filter(t => curatedIds.includes(t.id))

    // Catalog fallback — every template matching the family.
    const catalogCandidates = catalog.filter(t => familyMatches(t.family, family))

    let chosen:
      | { template: WebContentTemplate; source: 'curated' | 'catalog'; rationale: string }
      | null = null

    if (curatedCandidates.length > 0) {
      const ranked = rankVariantsByBrief(briefSection, curatedCandidates)
      if (ranked.length > 0) {
        chosen = {
          template: ranked[0].template,
          source: 'curated',
          rationale: `Site library · ${ranked[0].rationale}`,
        }
      }
    }
    if (!chosen && catalogCandidates.length > 0) {
      const ranked = rankVariantsByBrief(briefSection, catalogCandidates)
      if (ranked.length > 0) {
        chosen = {
          template: ranked[0].template,
          source: 'catalog',
          rationale: `Catalog · ${ranked[0].rationale}`,
        }
      }
    }

    if (!chosen) {
      bindings.push({
        web_section_id: webSection.id,
        section_label: sectionLabel,
        template_id: null,
        template_layer_name: null,
        source: 'none',
        rationale: `No templates matched family "${family}"`,
      })
      continue
    }

    // Resolve field_values from brief + body HTML using the same
    // composeBind path as the manual bind flow. The freehand body
    // becomes __overflow_html so the strategist can verify nothing
    // was dropped and clear it when satisfied.
    const currentValues = (webSection.field_values ?? {}) as Record<string, unknown>
    const overflowHtml = typeof currentValues.body === 'string' ? currentValues.body : ''
    const composed = composeBind(briefSection, overflowHtml, chosen.template)
    const nextValues: Record<string, unknown> = { ...composed.field_values }
    if (overflowHtml) nextValues.__overflow_html = overflowHtml
    if (composed.source_report.missing_slots.length > 0
        || composed.source_report.unmatched_brief_keys.length > 0) {
      nextValues.__bind_report = composed.source_report
    }

    const { error: updateErr } = await supabase
      .from('web_sections')
      .update({
        content_template_id: chosen.template.id,
        field_values: nextValues,
      } as never)
      .eq('id', webSection.id)
    if (updateErr) {
      bindings.push({
        web_section_id: webSection.id,
        section_label: sectionLabel,
        template_id: null,
        template_layer_name: null,
        source: 'none',
        rationale: `DB write failed: ${updateErr.message}`,
      })
      continue
    }

    bindings.push({
      web_section_id: webSection.id,
      section_label: sectionLabel,
      template_id: chosen.template.id,
      template_layer_name: chosen.template.layer_name,
      source: chosen.source,
      rationale: chosen.rationale,
    })
  }

  return {
    bindings,
    curated_used: bindings.filter(b => b.source === 'curated').length,
    catalog_used: bindings.filter(b => b.source === 'catalog').length,
    unbound: bindings.filter(b => b.source === 'none').length,
  }
}
